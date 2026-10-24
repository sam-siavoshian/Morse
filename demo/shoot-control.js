// Screenshots of user control, driving the real extension (dist/extension)
// on The Daily Byte demo site:
//   95-off-switch.png     ⌥⇧0 turns every mod on the page off; the toast turns them back on
//   96-install-summary.png the share page says what a mod does before Install
//   97-pause-site.png     "Pause Morse on <site>" in the Mods panel
//   98-popup-pause.png    the same from the toolbar popup, with "Pause everywhere"
//
//   npm run build && DISPLAY=:99 node demo/shoot-control.js [outDir]
// The demo sites run on free ports and show at their usual addresses
// (The Daily Byte at 127.0.0.1:8788).

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createMod, encodeShare } from "../core/mod.js";
import { demoSites, seasonExtension, startHelper, routeHelper, pairExtension } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.argv[2] || process.env.SHOTS || path.join("docs", "screenshots"));
const EXT = path.join(root, "dist", "extension");
const sites = await demoSites();
const BYTE = sites.url("byte");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-ctl-"));

const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
});
await sites.route(ctx);
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
await seasonExtension(sw, { gallery: false });
for (const p of ctx.pages()) if (p.url().includes("/welcome.html")) await p.close();
// Set up like someone who uses Morse: "Allow User Scripts" on, and a model
// connected (the Morse helper with the demo model), so the popup and the
// panel show only what these pictures are about.
{
  const id = sw.url().split("/")[2];
  const p = await ctx.newPage();
  await p.goto(`chrome://extensions/?id=${id}`);
  await p.locator("#allow-user-scripts").click();
  await p.close();
  const helper = await startHelper(path.join(tmp, "helper-home"));
  process.on("exit", helper.stop);
  await routeHelper(ctx, helper);
  await pairExtension(ctx, id, helper.code);
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };

// Three mods on The Daily Byte: two made here, one installed from a friend's link.
const day = d => new Date(Date.UTC(2026, 9, d, 10)).toISOString();
const mods = [
  { ...createMod({ title: "Calm reading", prompt: "hide the ads and make the article easier to read", url: BYTE,
      css: ".ad-slot, aside[aria-label=Sponsored] { display: none !important; }\n.wrap { grid-template-columns: minmax(0, 680px); justify-content: center; }\narticle { font: 17px/1.7 Georgia, serif; }\narticle h1 { font-size: 34px; }",
      js: "", model: "Claude Code · sonnet" }), created: day(18), updated: day(18) },
  { ...createMod({ title: "Reading time", prompt: "show how long the article takes to read", url: BYTE, css: "",
      js: "morse.watch('article .by', by => by.append(morse.el('b', { text: ' · ' + Math.ceil(document.querySelector('article').innerText.split(/\\s+/).length / 230) + ' min left' })));",
      model: "Claude Code · sonnet" }), created: day(20), updated: day(20) },
  { ...createMod({ title: "No newsletter popup", prompt: "get rid of the newsletter popup", url: BYTE, css: ".pop { display: none !important; }", js: "" }),
    created: day(21), updated: day(21), imported: true, importedFrom: "link", importedAt: day(22), author: "Ana" },
];
await sw.evaluate(async list => {
  const all = {};
  for (const m of list) all[m.id] = m;
  await chrome.storage.local.set({ mods: all });
}, mods);

async function openByte() {
  const page = await ctx.newPage();
  await page.goto(BYTE);
  await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  await sleep(1200);
  return page;
}

// 95 · the off switch
{
  const page = await openByte();
  await page.mouse.move(640, 300);
  await page.keyboard.press("Alt+Shift+Digit0");
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ctl-toast:not([hidden])"));
  await sleep(450);
  await shot(page, "95-off-switch.png");
  // and back on, so the next scenes start clean
  await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ctl-toast .ctl-acts button").click());
  await sleep(600);
  await page.close();
}

// 97 · Pause Morse on this site, from the Mods panel
{
  const page = await openByte();
  await page.keyboard.press("Alt+Shift+KeyM");
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector("[data-c=pause-site]"));
  await sleep(300);
  await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector("[data-c=pause-site]").click());
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ctl-toast:not([hidden])"));
  await page.mouse.move(400, 500);
  await sleep(450);
  await shot(page, "97-pause-site.png");
  // the toolbar popup says so too (the real popup, opened as a page)
  const id = sw.url().split("/")[2];
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 348, height: 680 });
  await pop.goto(`chrome-extension://${id}/popup.html?url=${encodeURIComponent(BYTE)}`);
  await sleep(500);
  // Morse rechecks the model every 15 seconds: wait until it knows about the pairing.
  for (let i = 0; i < 20 && await pop.getByText("No model connected").count(); i++) { await sleep(1500); await pop.reload(); await sleep(500); }
  // The picture ends where "Model" starts: the pause switches and this site's mods are what it's about.
  const h = await pop.evaluate(() => { document.documentElement.style.overflow = "hidden"; return Math.ceil(document.querySelector("#model").getBoundingClientRect().top); });
  await pop.setViewportSize({ width: 348, height: h });
  await sleep(200);
  await shot(pop, "98-popup-pause.png");
  await pop.close();
  await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector("[data-c=pause-site]").click());
  await sleep(400);
  await page.close();
}
await ctx.close();

// 96 · the share page: what a shared mod does, before anything is installed
{
  const browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark", deviceScaleFactor: 1 }); // tall enough to show Install under the summary
  await sites.route(bctx);
  const page = await bctx.newPage();
  const mod = createMod({
    title: "Draft keeper", prompt: "keep a copy of what I type in the message box so I never lose a draft", url: "https://chat.example.com/",
    css: ".draft-saved { font-size: 12px; opacity: .6; margin-left: 8px; }",
    js: "morse.watch('textarea', box => {\n  const note = morse.el('span', { class: 'draft-saved' });\n  box.after(note);\n  box.value ||= morse.store.get('draft', '');\n  morse.on(box, 'input', () => {\n    morse.store.set('draft', box.value);\n    fetch('https://drafts.example.net/save', { method: 'POST', body: box.value });\n    note.textContent = 'Draft saved';\n  });\n});",
    model: "Claude Code · sonnet",
  });
  const link = await encodeShare({ ...mod, author: "Sam" });
  await page.goto(sites.url("parley", `/share/install.html#m=${link.split("#m=")[1]}`));
  await page.waitForSelector("ul.i-items li");
  await sleep(300);
  await shot(page, "96-install-summary.png");
  await browser.close();
}
await fs.rm(tmp, { recursive: true, force: true });
await sites.close();
process.exit(0);
