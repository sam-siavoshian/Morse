// Screenshots of first run and help:
//   70-welcome        the welcome page, its practice area mid-change
//   71-coach          the three-step coach in the bar
//   72-help           the help pane
//   73-empty-states   popup and bar states, side by side
//   74-cli-setup      `morse` before setup, then `morse setup`
// The welcome page and popup run in the real unpacked extension (headful, so
// under Xvfb); bar states use demo/bar-playground.html (real runtime, fake host).
//
//   npm run build && DISPLAY=:99 node demo/shoot-onboarding.js [outDir]

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { serveBar } from "./bar-server.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.argv[2] || path.join(root, "docs", "screenshots");
const EXT = path.join(root, "dist", "extension");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-onboarding-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const saved = name => console.log("  📸", name);
const { url: PLAY, close: closeBar } = await serveBar();
const SITE = PLAY.replace("/demo/bar-playground.html", "/demo/sites/byte/");

// ---- 70 + popup states: the real extension
const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  headless: false, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// onInstalled opens the welcome page by itself.
let welcome;
for (let i = 0; i < 50 && !welcome; i++) { welcome = ctx.pages().find(p => p.url().includes("/welcome.html")); await sleep(100); }
if (!welcome) throw new Error("the welcome page didn't open on install");
// Allow User Scripts, as step 2 of the checklist asks.
const setup = await ctx.newPage();
await setup.goto(`chrome://extensions/?id=${id}`);
await setup.locator("#allow-user-scripts").click();
await sleep(300);
await setup.close();

await welcome.bringToFront();
await welcome.setViewportSize({ width: 1280, height: 900 });
await welcome.reload();
await sleep(1200);
const practice = () => welcome.frames().find(f => f.url().includes("practice.html"));
await welcome.click("#try");
await sleep(500);
const art = await practice().locator("article p").first().boundingBox();
await welcome.mouse.move(art.x + 160, art.y + 6, { steps: 5 });
await welcome.mouse.click(art.x + 160, art.y + 6);
await sleep(200);
await welcome.keyboard.type("make this easier to read", { delay: 18 });
await welcome.keyboard.press("Enter");
await sleep(5200); // the demo model streams, then Keep shows
await welcome.mouse.move(1100, 880);
await welcome.screenshot({ path: path.join(OUT, "70-welcome.png") });
saved("70-welcome.png");
await welcome.keyboard.press("Enter"); // Keep
await sleep(800);

// Popup states, opened as pages so they can be captured.
async function popup(name, query) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 348, height: 300 });
  await p.goto(`chrome-extension://${id}/popup.html?${query}`);
  await sleep(700);
  const h = await p.evaluate(() => document.body.scrollHeight);
  await p.setViewportSize({ width: 348, height: Math.min(h, 520) });
  await sleep(100);
  const file = path.join(tmp, name + ".png");
  await p.screenshot({ path: file });
  const state = await p.evaluate(() => document.querySelector(".ps")?.dataset.state || "");
  await p.close();
  return { file, state };
}
const shots = [];
shots.push(["Chrome's own pages", await popup("p-chrome", `url=${encodeURIComponent("chrome://settings/")}`)]);
// A tab that was open before Morse was installed: it has no Morse in it.
const old = await ctx.newPage();
await old.goto(SITE);
await sleep(600);
await old.evaluate(() => { delete document.documentElement.dataset.morseExtension; });
const tabId = await sw.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, SITE);
shots.push(["A tab opened before install", await popup("p-reload", `tab=${tabId}`)]);
// Chromium started with --load-extension may already allow file URLs; then this is the no-model state.
shots.push([null, await popup("p-file", `url=${encodeURIComponent("file:///Users/me/notes.html")}`)]);
shots.push(["The PDF viewer", await popup("p-pdf", `url=${encodeURIComponent("https://example.com/annual-report.pdf")}`)]);
await ctx.close();

// ---- bar states: the playground
const browser = await chromium.launch();
async function scene(query, state, fn, { width = 1280, height = 800 } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await c.addInitScript(s => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    if (s && !localStorage.getItem("fake:onboarding")) localStorage.setItem("fake:onboarding", s);
  }, state ? JSON.stringify(state) : "");
  const page = await c.newPage();
  page.on("pageerror", e => console.error("pageerror", e.message));
  await page.goto(PLAY + query);
  await page.waitForTimeout(500);
  const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
  page.waitStatus = async pred => { for (let i = 0; i < 300; i++) { if (pred(await status())) return; await page.waitForTimeout(30); } throw new Error("timeout"); };
  const r = await fn(page);
  await c.close();
  return r;
}
async function pointAt(page, sel) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 4 });
  await page.mouse.click(b.x + b.width / 2, b.y + 4);
}
// Rests the cursor on the bar, so no hover box is drawn over the page.
async function overBar(page) {
  const r = await page.evaluate(() => { const n = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".status").getBoundingClientRect(); return { x: n.x + n.width * 0.45, y: n.y + n.height / 2 }; });
  await page.mouse.move(r.x, r.y);
}
// Crop around a part of the overlay (shadow DOM), with some page around it.
async function crop(page, sel, file, pad = 24) {
  const r = await page.evaluate(s => { const n = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s).getBoundingClientRect(); return { x: n.x, y: n.y, w: n.width, h: n.height }; }, sel);
  const vp = page.viewportSize();
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  await page.screenshot({ path: file, clip: { x, y, width: Math.min(vp.width - x, r.w + pad * 2), height: Math.min(vp.height - y, r.h + pad * 2) } });
  return file;
}

// 71 · the coach, on the second step
await scene("?onboarding", null, async p => {
  await p.keyboard.press("Alt+Space");
  await p.waitForTimeout(250);
  await pointAt(p, "#toolbar");
  await p.waitForTimeout(150);
  await p.keyboard.type("add a sleep timer", { delay: 20 });
  await overBar(p);
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(OUT, "71-coach.png") });
  saved("71-coach.png");
});

// 72 · the help pane
await scene("?onboarding", { coach: "done" }, async p => {
  await p.keyboard.press("Alt+Space");
  await p.waitForTimeout(200);
  await p.keyboard.press("F1");
  await p.waitForTimeout(200);
  await overBar(p);
  await p.waitForTimeout(300);
  await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); // keyboard focus on an example
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(OUT, "72-help.png") });
  saved("72-help.png");
});

// bar states for 73
shots.push(["No model connected", await scene("?onboarding&nomodel", { coach: "done" }, async p => {
  await p.keyboard.press("Alt+Space");
  await p.mouse.move(640, 200);
  await p.waitForTimeout(300);
  return crop(p, ".bar", path.join(tmp, "b-model.png"));
})]);
shots.push(["User scripts off", await scene("?onboarding&noscripts", { coach: "done" }, async p => {
  await p.keyboard.press("Alt+Space");
  await p.mouse.move(640, 200);
  await p.waitForTimeout(300);
  return crop(p, ".bar", path.join(tmp, "b-scripts.png"));
})]);
shots.push(["The model can't be reached", await scene("?onboarding&fail=" + encodeURIComponent("fetch failed: connect ECONNREFUSED 127.0.0.1:7457"), { coach: "done" }, async p => {
  await p.keyboard.press("Alt+Space");
  await p.mouse.move(640, 200);
  await p.keyboard.type("make the toolbar airier");
  await p.keyboard.press("Enter");
  await p.waitStatus(s => s.phase === "error");
  await p.waitForTimeout(500);
  return crop(p, ".bar", path.join(tmp, "b-error.png"));
})]);
shots.push(["No mods yet", await scene("?onboarding", { coach: "done" }, async p => {
  await p.keyboard.press("Alt+Shift+KeyM");
  await p.waitForTimeout(400);
  return crop(p, ".panel", path.join(tmp, "b-empty.png"), 0);
}, { width: 1280, height: 560 })]);

// 73 · every state on one sheet
{
  const CAPTION = { file: "Files without permission", model: "No model connected" };
  const tiles = await Promise.all(shots.map(async ([label, shot]) => {
    const { file, state } = typeof shot === "string" ? { file: shot } : shot;
    return [label || CAPTION[state] || state, "data:image/png;base64," + (await fs.readFile(file)).toString("base64")];
  }));
  const popups = tiles.slice(0, 4), bars = tiles.slice(4, 7), panel = tiles[7];
  const fig = ([label, src]) => `<figure><img src="${src}"><figcaption>${label}</figcaption></figure>`;
  const p = await browser.newPage({ viewport: { width: 2000, height: 900 }, deviceScaleFactor: 1 });
  await p.setContent(`<style>
    body { margin: 0; background: #0b0b0c; font: 500 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; color: #a0a0a8; }
    .sheet { display: flex; gap: 28px; align-items: flex-start; padding: 32px; width: max-content; }
    .popups { display: grid; grid-template-columns: repeat(2, auto); gap: 22px; }
    .col { display: flex; flex-direction: column; gap: 22px; }
    figure { margin: 0; } figcaption { margin-top: 8px; letter-spacing: -0.01em; }
    img { display: block; border: 1px solid #2e2e33; border-radius: 10px; }
    .bars img { width: 728px; }
  </style><div class="sheet"><div class="popups">${popups.map(fig).join("")}</div>
    <div class="col bars">${bars.map(fig).join("")}</div><div class="col">${fig(panel)}</div></div>`);
  await p.waitForTimeout(300);
  await p.locator(".sheet").screenshot({ path: path.join(OUT, "73-empty-states.png") });
  saved("73-empty-states.png");
  await p.close();
}
await browser.close();
await closeBar();

// 74 · the terminal: a bare `morse`, then `morse setup` (choosing the recommendation)
{
  const home = path.join(tmp, "home");
  await fs.mkdir(home, { recursive: true });
  const env = { ...process.env, HOME: home, MORSE_HOME: "" };
  delete env.MORSE_HOME;
  const cli = path.join(root, "daemon", "cli.js");
  const first = spawnSync(process.execPath, [cli], { env, cwd: root, encoding: "utf8" }).stdout;
  const second = spawnSync(process.execPath, [cli, "setup"], { env, cwd: root, encoding: "utf8", input: "\n" }).stdout;
  const log = `\x1b[2m$\x1b[0m morse\n${first}\n\x1b[2m$\x1b[0m morse setup\n${second}`;
  const file = path.join(tmp, "setup.log");
  await fs.writeFile(file, log);
  execFileSync(process.execPath, [path.join(root, "demo", "terminal.js"), file, path.join(OUT, "74-cli-setup.png"), "morse setup"], { stdio: "inherit" });
  saved("74-cli-setup.png");
}
await fs.rm(tmp, { recursive: true, force: true });
