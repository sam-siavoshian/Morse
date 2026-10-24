// Polish changes, end to end in real Chromium with the real desktop connector
// (CDP) as the host: a change that adds a button is applied, the connector
// takes a picture of that part of the page (Page.captureScreenshot with a
// clip, Morse's own UI hidden), the model gets it with the request and sends
// a fixed version, and the fixed version is what shows. Turning "Polish
// changes" off in Settings skips the picture and the second call.
import { tempDir } from "./helpers/home.js"; // first: a MORSE_HOME of its own, and temp folders removed at exit
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { registerProvider } from "../core/providers.js";
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";

const ROOT = new URL("../", import.meta.url);
let home, browser, page, server, tunes;
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const ui = sel => page.locator(`[data-morse-ui] ${sel}`);
const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
async function waitFor(pred, ms = 30000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) { s = await status(); if (s && pred(s)) return s; await page.waitForTimeout(30); }
  throw new Error("timed out; last status " + JSON.stringify(s));
}
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await page.waitForTimeout(50); }
  throw new Error("timed out waiting for " + fn);
}

// The model: a draft with a foreign red button, and, when it is shown the
// picture, a version in the page's own colors. Every call is recorded.
const calls = [];
const DRAFT = "TITLE: Timer button\n```css\n.pomo { color: rgb(255, 0, 0); }\n```\n```js\nmorse.watch('[data-testid=\"player-controls\"]', c => c.append(morse.el('button', { class: 'pomo', text: '25:00' })));\n```";
const FIXED = "FIX: The red is foreign to the player; use its own text color.\nTITLE: Timer button\n```css\n.pomo { color: rgb(0, 128, 0); }\n```\n```js\nmorse.watch('[data-testid=\"player-controls\"]', c => c.append(morse.el('button', { class: 'pomo', text: '25:00' })));\n```";
registerProvider("demo", async (s, messages, { onToken } = {}) => {
  const pics = messages.flatMap(m => (Array.isArray(m.content) ? m.content.filter(b => b.type === "image") : []));
  calls.push({ pics });
  const r = pics.length ? FIXED : DRAFT;
  onToken?.(r);
  return r;
});

before(async () => {
  if (skip) return;
  home = tempDir("morse-polish-");
  process.env.MORSE_HOME = home;
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
  const port = await freePort();
  server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(await fs.readFile(new URL("." + (p.endsWith("/") ? p + "index.html" : p), ROOT))); }
    catch { res.writeHead(404).end("not found"); }
  }).listen(port, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  tunes = `http://127.0.0.1:${port}/demo/sites/tunes/`;
  const cdp = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${cdp}`] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  page = await ctx.newPage();
  await page.goto(tunes);
  const { Connector } = await import("../daemon/connector.js");
  new Connector({ port: cdp, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
});
after(async () => {
  await browser?.close();
  server?.close();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

const ask = async text => {
  await page.keyboard.press(OPEN_KEY);
  await waitFor(s => s.open);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result");
};
const pomoColor = () => page.evaluate(() => { const b = document.querySelector(".pomo"); return b && getComputedStyle(b).color; });

test("a change that adds UI is looked at once and fixed; turning Polish changes off skips it", { skip, timeout: 120000 }, async () => {
  await ask("add a pomodoro timer button to the player");
  assert.equal(calls.length, 2, "the draft, then the look at it");
  const [pic] = calls[1].pics;
  assert.equal(pic.source.media_type, "image/jpeg");
  const bytes = Buffer.from(pic.source.data, "base64");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], "a real JPEG from the page");
  assert.ok(bytes.length > 2000, "of a real part of the page");
  assert.equal(await pomoColor(), "rgb(0, 128, 0)", "the fixed version is on the page");
  assert.equal(await page.locator(".pomo").count(), 1, "once, not the draft and the fix");
  assert.notEqual(await page.evaluate(() => document.querySelector("[data-morse-ui]").style.visibility), "hidden", "Morse's UI is back after the picture");
  await page.keyboard.press("Enter"); // Save
  await waitFor(s => !s.open);

  // Settings: Polish changes is on; turn it off.
  await page.keyboard.press(OPEN_KEY);
  await waitFor(s => s.open);
  await page.keyboard.press("Control+Comma");
  const sw = ui('.sheet input[data-k="polish"]');
  await sw.waitFor({ state: "attached" });
  assert.equal(await sw.isChecked(), true, "on by default");
  assert.equal(await ui('.sheet .srow:has(input[data-k="polish"]) .lbl span').textContent(), "Polish changes");
  await ui('.sheet .srow:has(input[data-k="polish"]) .sw span').click();
  await until(async () => JSON.parse(await fs.readFile(path.join(home, "settings.json"), "utf8")).polish === false);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitFor(s => !s.open);

  const n = calls.length;
  await ask("add another pomodoro timer button");
  assert.equal(calls.length, n + 1, "one call, no picture");
  assert.equal(calls.at(-1).pics.length, 0);
});
