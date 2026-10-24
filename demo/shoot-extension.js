// Drives the browser extension end to end and screenshots each feature.
// The unpacked extension from dist/extension is loaded into Chromium exactly
// as a user would; Playwright only plays the user and takes screenshots.
//
//   npm run build && DISPLAY=:99 node demo/shoot-extension.js

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { toUserscript } from "../core/mod.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "docs", "screenshots");
const EXT = path.join(root, "dist", "extension");
const SITE = { parley: "http://127.0.0.1:8787/demo/sites/parley/", byte: "http://127.0.0.1:8788/demo/sites/byte/" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-ext-"));

async function browserWithMorse(name) {
  const ctx = await chromium.launchPersistentContext(path.join(tmp, name), {
    headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const p = await ctx.newPage();
  await p.goto(`chrome://extensions/?id=${id}`);
  await p.locator("#allow-user-scripts").click();
  await sleep(500);
  return { ctx, sw, id, setup: p };
}
async function open(ctx, url) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await page.reload();
  await sleep(900);
  return page;
}
const helpers = page => ({
  shot: async name => { await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); },
  status: () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")),
  async waitFor(pred, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const s = await this.status().catch(() => null); if (s && pred(s)) return s; await sleep(40); }
    throw new Error("timeout; last " + JSON.stringify(await this.status()));
  },
});

const { ctx, sw, id, setup } = await browserWithMorse("main");

// 20. Installed, with user scripts allowed
await setup.screenshot({ path: path.join(OUT, "20-extension-installed.png") });
console.log("  📸 20-extension-installed.png");

// 21. Point at the composer of a chat app with a strict CSP
const chat = await open(ctx, SITE.parley);
const C = helpers(chat);
await chat.keyboard.press("Alt+Space");
await sleep(200);
const ta = await chat.locator("textarea").boundingBox();
await chat.mouse.move(ta.x + 120, ta.y + 20, { steps: 6 });
await sleep(250);
await C.shot("21-web-point.png");
await chat.mouse.click(ta.x + 120, ta.y + 20);
await chat.keyboard.type("show a live word count and reading time under the message box", { delay: 12 });
await chat.keyboard.press("Enter");
await C.waitFor(s => s.ticker.length > 40);
await sleep(700);
await C.shot("22-web-working.png");
await C.waitFor(s => s.phase === "result");
await sleep(300);
await C.shot("23-web-done.png");
await chat.keyboard.press("Enter"); // Keep
await sleep(400);
await chat.locator("textarea").click();
await chat.keyboard.type("How do CRDTs resolve two people editing the same sentence offline? Assume a text CRDT like RGA, and explain what the merged result looks like.", { delay: 4 });
await sleep(300);
await C.shot("24-web-word-count-works.png");

// 25. Page-wide request: a new button
await chat.keyboard.press("Alt+Space");
await sleep(150);
await chat.mouse.move(640, 400);
await chat.keyboard.type("add a button that copies the whole conversation as markdown", { delay: 10 });
await chat.keyboard.press("Enter");
await C.waitFor(s => s.phase === "result");
await chat.keyboard.press("Enter");
await sleep(400);
await chat.locator(".morse-copy").click();
await sleep(300);
await C.shot("25-web-new-button.png");

// 26-29. A cluttered news site: live CSS, share card
const news = await open(ctx, SITE.byte);
const N = helpers(news);
await N.shot("26-news-before.png");
await news.keyboard.press("Alt+Space");
await sleep(150);
await news.mouse.move(640, 300);
await news.keyboard.type("hide the ads and make the article easier to read", { delay: 10 });
await news.keyboard.press("Enter");
await N.waitFor(s => s.ticker.length > 50);
await sleep(1400);
await N.shot("27-news-restyling-live.png");
await N.waitFor(s => s.phase === "result");
await sleep(300);
await news.locator(".actions [data-a=share]").click();
await sleep(1200);
await N.shot("28-news-share.png");
const link = await news.locator(".link input").inputValue();
await news.keyboard.press("Escape");
await sleep(300);
await N.shot("29-news-after.png");

// 34. Toolbar popup: model settings and this site's mods
const pop = await ctx.newPage();
await pop.setViewportSize({ width: 348, height: 470 });
await pop.goto(`chrome-extension://${id}/popup.html?url=${encodeURIComponent(SITE.parley)}`);
await pop.locator("details").evaluate(d => (d.open = true));
await sleep(500);
await pop.screenshot({ path: path.join(OUT, "34-popup.png") });
console.log("  📸 34-popup.png");

// Grab the stored mods for the userscript check below.
const { mods } = await sw.evaluate(() => chrome.storage.local.get("mods"));
await ctx.close();

// 30-32. Someone else opens the share link in a fresh browser and installs it
const friend = await browserWithMorse("friend");
const install = await friend.ctx.newPage();
await install.goto("http://127.0.0.1:8787/share/install.html");
await install.evaluate(() => localStorage.setItem("morse:debug", "1")); // open shadow root so the script can click
await install.goto(link.replace(/^https:\/\/[^/]+\/RRAA/, "http://127.0.0.1:8787"));
await install.reload();
await sleep(800);
await install.screenshot({ path: path.join(OUT, "30-share-link.png") });
console.log("  📸 30-share-link.png");
await install.locator("#install").click();
await install.locator(".card [data-a=install]").waitFor();
await install.screenshot({ path: path.join(OUT, "30b-confirm-install.png") });
console.log("  📸 30b-confirm-install.png");
await install.locator(".card [data-a=install]").click();
await sleep(800);
await install.screenshot({ path: path.join(OUT, "31-installed.png") });
console.log("  📸 31-installed.png");
const theirs = await friend.ctx.newPage();
await theirs.goto(SITE.byte);
await sleep(1200);
await theirs.screenshot({ path: path.join(OUT, "32-friend-gets-the-mod.png") });
console.log("  📸 32-friend-gets-the-mod.png");
await friend.ctx.close();

// 33. The .user.js export runs with no Morse at all (Tampermonkey path)
const plain = await chromium.launch();
// Userscript managers inject outside the page's CSP; bypassCSP is the equivalent here.
const pp = await plain.newPage({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
await pp.goto(SITE.parley);
const wc = Object.values(mods).find(m => /word/i.test(m.title));
await pp.addScriptTag({ content: toUserscript(wc) });
await pp.locator("textarea").fill("Userscripts exported from Morse run anywhere a userscript manager does.");
await pp.locator("textarea").dispatchEvent("input");
await sleep(300);
await pp.screenshot({ path: path.join(OUT, "33-userscript-runs-without-morse.png") });
console.log("  📸 33-userscript-runs-without-morse.png");
await plain.close();
await fs.writeFile(path.join(tmp, "link.txt"), link);
console.log("share link:", link.slice(0, 90) + "…");
