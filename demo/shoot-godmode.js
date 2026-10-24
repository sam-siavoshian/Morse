// God mode screenshots (50-56): the real extension on the demo sites, with
// Playwright playing the user. Direct edits on a news site, then an element
// captured there is rebuilt inside a different app (a chat app with a strict CSP).
//
//   npm run build && node demo/serve.js &   (MORSE_DEMO_PORT moves the ports)
//   DISPLAY=:99 node demo/shoot-godmode.js

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { startHelper, pairExtension } from "./helper.js";
// The default Open Morse hotkey: ⌥Space on macOS, Ctrl+Shift+Space elsewhere (core/hotkeys.js).
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const EXT = path.join(root, "dist", "extension");
const BASE = Number(process.env.MORSE_DEMO_PORT || 8787);
const SITE = { parley: `http://127.0.0.1:${BASE}/demo/sites/parley/`, byte: `http://127.0.0.1:${BASE + 1}/demo/sites/byte/` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-god-"));

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
for (const p of ctx.pages()) if (p.url().includes("/options.html")) await p.close();
// The model (for "rebuild it here") comes from the Morse helper; see demo/helper.js.
await fs.mkdir(OUT, { recursive: true });
const helper = await startHelper(path.join(tmp, "helper-home"));
await pairExtension(ctx, id, helper.code);

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

// ---- The Daily Byte: direct edits
const news = await open(SITE.byte);
await news.keyboard.press(OPEN_KEY);
await sleep(200);

// 50. Select the headline: the toolbar anchors to it; hover shows name + shortcut
await pick(news, "article h1", 0.3, 0.5);
await news.locator(".gm-tb button[data-t=move]").hover();
await sleep(700);
await shot(news, "50-godmode-toolbar.png");

// 55. Capture the masthead for another app (Shift+C), with a note
await news.mouse.move(640, 400);
await pick(news, ".tb", 0.62, 0.5);
await news.keyboard.press("Shift+C");
await sleep(900);
await news.keyboard.type("red masthead, bold white type", { delay: 14 });
await sleep(200);
await shot(news, "55-capture.png");
await news.keyboard.press("Enter");
await sleep(500);

// 53. Rename the headline in place (T)
await pick(news, "article h1", 0.3, 0.5);
await news.keyboard.press("t");
await sleep(150);
await news.keyboard.type("Every app you use is secretly a web page", { delay: 16 });
await sleep(250);
await shot(news, "53-rename.png");
await news.keyboard.press("Enter");
await sleep(300);

// 51. Move the newsletter popup (a fixed element) out of the way; Shift locks the axis
const pop = await pick(news, ".pop", 0.5, 0.2);
await news.keyboard.press("m");
await sleep(150);
const sx = pop.x + pop.width / 2, sy = pop.y + 30;
await news.mouse.move(sx, sy);
await news.mouse.down();
await news.keyboard.down("Shift");
await news.mouse.move(sx - 360, sy + 6, { steps: 14 });
await news.mouse.move(sx - 652, sy + 4, { steps: 14 });
await sleep(200);
await shot(news, "51-move.png");
await news.mouse.up();
await news.keyboard.up("Shift");
await news.keyboard.press("Escape");
await sleep(200);

// 52. Recolor the masthead: Fill, from the palette
await pick(news, ".tb", 0.62, 0.5);
await news.keyboard.press("c");
await sleep(200);
await news.locator(".gm-seg button[data-ch=background]").click();
await news.locator(".gm-sw button[data-c='#262626']").click();
await sleep(150);
await news.locator(".gm-sw button[data-c='#262626']").hover();
await sleep(500);
await shot(news, "52-recolor.png");
await news.keyboard.press("Escape");
await news.keyboard.press("Escape"); // closes the bar: the session is saved as one "Direct edits" mod
await sleep(600);

// 54. Page tools: hide ads and popups, then dark mode
await news.keyboard.press(OPEN_KEY);
await sleep(200);
await news.mouse.move(1000, 120);
await news.locator(".gm-qbtn").click();
await sleep(200);
await news.locator(".gm-menu button[data-k=noads]").click();
await sleep(800);
await news.locator(".gm-qbtn").click();
await sleep(200);
await news.locator(".gm-menu button[data-k=dark]").click();
await sleep(1000);
await news.locator(".gm-qbtn").click();
await sleep(300);
await news.locator(".gm-menu button[data-k=dark]").hover();
await sleep(200);
await shot(news, "54-dark-mode.png");
await news.keyboard.press("Escape");
await news.keyboard.press("Escape");
await sleep(300);

// ---- Parley (another app, strict CSP): rebuild the captured masthead here
const chat = await open(SITE.parley);
await chat.keyboard.press(OPEN_KEY);
await sleep(500);
await pick(chat, 'header[role="banner"]', 0.45, 0.5);
await chat.locator(".gm-chip").first().click();
await sleep(150);
await chat.keyboard.type("make this header look like it", { delay: 14 });
await chat.keyboard.press("Enter");
await waitFor(chat, s => s.phase === "result", 20000);
await sleep(500);
await shot(chat, "56-reuse.png");
await chat.keyboard.press("Enter"); // Keep
await sleep(600);

const { mods } = await sw.evaluate(() => chrome.storage.local.get("mods"));
for (const m of Object.values(mods)) console.log(`  · ${m.title}${m.kind ? ` [${m.kind}]` : ""}${m.from ? ` from ${m.from.app}` : ""}: ${m.prompt}`);
await ctx.close();
helper.stop();
