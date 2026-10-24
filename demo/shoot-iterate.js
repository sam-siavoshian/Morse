// Keep-iterating screenshots (40-42): the real desktop connector (CDP) and
// the demo model on the demo sites, in a scratch MORSE_HOME, with Playwright
// playing the user. Needs no helper or paired extension.
//   40 · refine: a follow-up typed under a fresh result
//   41 · history: a mod's versions in the Mods panel
//   42 · fix it: a saved mod that stopped working, in plain words
//
//   node demo/serve.js &   (MORSE_DEMO_PORT moves the ports)
//   node demo/shoot-iterate.js

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const BASE = Number(process.env.MORSE_DEMO_PORT || 8787);
const SITE = { parley: `http://127.0.0.1:${BASE}/demo/sites/parley/`, tunes: `http://127.0.0.1:${BASE + 2}/demo/sites/tunes/` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A scratch home: mods, settings and first-run state live here, not in ~/.morse.
const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-iterate-"));
process.env.MORSE_HOME = home;
await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false }));
await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
const MODS = path.join(home, "mods");
const { Connector } = await import("../daemon/connector.js");

const port = await new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();

async function open(url) {
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  ! pageerror", e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
  await sleep(600);
  return page;
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"));
async function waitFor(page, pred, ms = 20000) {
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
}
const readMods = async () => Promise.all((await fs.readdir(MODS)).map(async f => JSON.parse(await fs.readFile(path.join(MODS, f), "utf8"))));
const writeMod = m => fs.writeFile(path.join(MODS, `${m.id}.json`), JSON.stringify(m, null, 2));
// Spreads a mod's version times over the past days, the way a mod people
// keep tuning looks (everything here happens within a minute).
async function age(mod, ago) {
  const t = s => new Date(Date.now() - s * 1000).toISOString();
  mod.created = t(ago[0]);
  (mod.history || []).forEach((v, i) => (v.at = t(ago[i])));
  mod.updated = t(ago[(mod.history || []).length]);
  await writeMod(mod);
}
const ui = (page, sel) => page.locator(`[data-morse-ui] ${sel}`);

// ---- Tunes: a sleep timer, then keep going
const tunes = await open(SITE.tunes);
await tunes.keyboard.press("Alt+Space");
await sleep(200);
await pick(tunes, '[data-testid="player-controls"] .btns', 0.5, 0.5);
await tunes.keyboard.type("add a sleep timer", { delay: 14 });
await tunes.keyboard.press("Enter");
await waitFor(tunes, s => s.phase === "result");
await sleep(400);

// 40 · the result stays open for a follow-up
await tunes.keyboard.type("make it bigger", { delay: 22 });
await sleep(300);
await shot(tunes, "40-refine.png");
await tunes.keyboard.press("Enter");
await waitFor(tunes, s => s.phase === "result" && /version 2/.test(s.hint));
await tunes.keyboard.type("a little smaller", { delay: 14 });
await tunes.keyboard.press("Enter");
await waitFor(tunes, s => s.phase === "result" && /version 3/.test(s.hint));
await tunes.keyboard.press("Enter"); // Save
await sleep(600);

// 41 · its versions in the Mods panel
const [timer] = await readMods();
await age(timer, [3 * 86400, 26 * 3600, 12 * 60]);
await tunes.reload();
await tunes.waitForFunction(() => document.querySelector(".morse-sleep"), null, { timeout: 15000 });
await sleep(400);
await tunes.locator('[data-testid="player-controls"] .morse-sleep').click(); // start a timer, so the change shows
await sleep(300);
await tunes.keyboard.press("Alt+Shift+KeyM");
await ui(tunes, ".panel article").waitFor();
await ui(tunes, ".panel [data-a=history]").click();
await sleep(200);
await ui(tunes, ".panel .versions button").first().hover();
await sleep(400);
await shot(tunes, "41-history.png");
await tunes.keyboard.press("Escape");

// ---- Parley: a mod saved a while ago; the app has since changed
const chat = await open(SITE.parley);
await chat.keyboard.press("Alt+Space");
await sleep(200);
await pick(chat, "form#composer", 0.5, 0.3);
await chat.keyboard.type("show a live word count", { delay: 10 });
await chat.keyboard.press("Enter");
await waitFor(chat, s => s.phase === "result");
await chat.keyboard.press("Enter");
await sleep(500);
const at = new Date(Date.now() - 9 * 86400 * 1000).toISOString();
await writeMod({
  morse: 1, id: "oldcopy", title: "Copy chat as Markdown", prompt: "add a button that copies the chat as markdown",
  match: { hosts: [new URL(SITE.parley).host], app: null }, target: { selector: "header[role=banner] .share", label: "button · “Share”" },
  css: ".morse-copy { border: 1px solid #424242; border-radius: 999px; padding: 6px 14px; }",
  js: `morse.watch("header[role=banner] .share-btn", share => {\n  share.before(morse.el("button", { class: "morse-copy", text: "Copy as Markdown" }));\n});`,
  enabled: true, model: "qwen2.5-coder:7b", created: at, updated: at,
});
await chat.reload();
await chat.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
await sleep(6500); // the 5 second check
await chat.keyboard.press("Alt+Shift+KeyM");
await ui(chat, ".panel article .health").waitFor();
await ui(chat, ".panel .health [data-a=fix]").hover();
await sleep(400);
await shot(chat, "42-fix-it.png");
await ui(chat, ".panel .health [data-a=fix]").click();
await waitFor(chat, s => s.phase === "result" && /version 2/.test(s.hint));
await chat.keyboard.press("Enter");
await sleep(500);
console.log("  fixed:", await chat.locator(".morse-copy").count() === 1);

for (const m of await readMods()) console.log(`  · ${m.title}: ${m.prompt}${m.refined ? ` → ${m.refined}` : ""} (${(m.history || []).length + 1} versions)`);
await browser.close();
await fs.rm(home, { recursive: true, force: true });
process.exit(0);
