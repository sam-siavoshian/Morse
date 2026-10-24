// Ask and find screenshots (90-93): the real extension on the demo sites,
// with Playwright playing the user. Ask what a button does, find a setting
// hidden behind a menu, let "Show me" walk through it (the user clicks, never
// Morse), and explain a page from the page tools.
//
//   npm run build && node demo/serve.js &   (MORSE_DEMO_PORT moves the ports)
//   DISPLAY=:99 node demo/shoot-ask.js      (or: xvfb-run -a node demo/shoot-ask.js)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
// The default Open Morse hotkey: ⌥Space on macOS, Ctrl+Shift+Space elsewhere (core/hotkeys.js).
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "docs", "screenshots");
const EXT = path.join(root, "dist", "extension");
const BASE = Number(process.env.MORSE_DEMO_PORT || 8787);
const SITE = {
  parley: `http://127.0.0.1:${BASE}/demo/sites/parley/`,
  byte: `http://127.0.0.1:${BASE + 1}/demo/sites/byte/`,
  tunes: `http://127.0.0.1:${BASE + 2}/demo/sites/tunes/`,
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-ask-"));

const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const setup = await ctx.newPage();
await setup.goto(`chrome://extensions/?id=${id}`);
await setup.locator("#allow-user-scripts").click();
await sleep(400);
await setup.close();

async function open(url) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await page.reload();
  await sleep(900);
  page.on("pageerror", e => console.log("  ! pageerror", e.message));
  return page;
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"));
async function waitFor(page, pred, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await status(page).catch(() => null); if (s && pred(s)) return s; await sleep(40); }
  throw new Error("timeout; last " + JSON.stringify(await status(page)));
}
const answered = page => waitFor(page, s => s.phase === "idle" && /Answered/.test(s.hint));
async function pick(page, sel, fx = 0.5, fy = 0.5) {
  const r = await page.locator(sel).first().boundingBox();
  const x = r.x + r.width * fx, y = r.y + r.height * fy;
  await page.mouse.move(x - 40, y - 20);
  await page.mouse.move(x, y, { steps: 6 });
  await sleep(120);
  await page.mouse.click(x, y);
  await sleep(250);
  return r;
}

// 90. Ask: point at a control, ask what it does
const tunes = await open(SITE.tunes);
await tunes.keyboard.press(OPEN_KEY);
await sleep(200);
await pick(tunes, '[aria-label="Repeat"]');
await tunes.keyboard.type("what does this button do?", { delay: 14 });
await tunes.keyboard.press("Enter");
await answered(tunes);
await tunes.mouse.move(700, 300);
await sleep(1100);
await shot(tunes, "90-ask.png");
await tunes.close();

// 91. Find: a setting that lives behind a menu
const chat = await open(SITE.parley);
await chat.keyboard.press(OPEN_KEY);
await sleep(200);
await chat.mouse.move(640, 520);
await chat.keyboard.type("where do I change notification settings?", { delay: 14 });
await chat.keyboard.press("Enter");
await answered(chat);
await sleep(1100);
await shot(chat, "91-find.png");

// 92. Show me: Morse marks each step; the user does the clicking
await chat.locator(".ask [data-ask=show]").click();
await sleep(600);
await chat.locator('summary[aria-label="Account menu"]').click(); // the user's own click
await sleep(900);
await chat.mouse.move(420, 600);
await sleep(300);
await shot(chat, "92-show-me.png");
await chat.locator('a[href="#settings"]').click();
await sleep(700);
await chat.locator('a[href="#settings-notifications"]').click();
await sleep(500);
await chat.close();

// 93. Explain this page, from the page tools
const news = await open(SITE.byte);
await news.keyboard.press(OPEN_KEY);
await sleep(200);
await news.mouse.move(1000, 120);
await news.locator(".gm-qbtn").click();
await sleep(200);
await news.locator(".gm-menu [data-ask=explain]").click();
await answered(news);
await news.mouse.move(1180, 90);
await sleep(1100);
await shot(news, "93-explain.png");

await ctx.close();
