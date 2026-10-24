// The desktop connector over real CDP: settings in ~/.morse/settings.json,
// history, Stop mid-generation, the microphone grant, and voice going
// MediaRecorder -> CDP binding -> core/transcribe.js -> (fake) OpenAI.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
// The default Open Morse hotkey: ⌥Space on macOS, Ctrl+Shift+Space elsewhere (core/hotkeys.js).
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";

let home, browser, page, site, openai, transcribed = [];
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
async function waitFor(pred, ms = 10000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) { s = await status(); if (s && pred(s)) return s; await page.waitForTimeout(30); }
  throw new Error("timed out; last status " + JSON.stringify(s));
}
async function until(get, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await get(); if (v || Date.now() > end) return v; await new Promise(r => setTimeout(r, 30)); }
}

before(async () => {
  if (skip) return;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-home-"));
  process.env.MORSE_HOME = home;
  openai = http.createServer(async (req, res) => {
    let n = 0;
    for await (const c of req) n += c.length;
    transcribed.push({ auth: req.headers.authorization, bytes: n });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text: "hide the sidebar" }));
  }).listen(0, "127.0.0.1");
  await new Promise(r => openai.on("listening", r));
  process.env.OPENAI_API_KEY = "sk-desktop";
  process.env.MORSE_OPENAI_BASE_URL = `http://127.0.0.1:${openai.address().port}`;
  site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>App</title><body style="background:#111;color:#eee"><div id="sidebar">Sidebar</div><main>Main</main></body>`)).listen(0, "127.0.0.1");
  await new Promise(r => site.on("listening", r));

  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, "--use-fake-device-for-media-stream"]; // no fake UI: the connector's grant has to work
  try { browser = await chromium.launch({ channel: "chromium", args }); } catch { browser = await chromium.launch({ args }); }
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("morse:debug", "1");
    globalThis.webkitSpeechRecognition = class extends EventTarget { // as inside Electron (page world only: Morse's isolated world gets Chromium's own, which fails the same way here)
      start() { setTimeout(() => { this.onerror?.(Object.assign(new Event("error"), { error: "network" })); const e = new Event("end"); this.onend?.(e); this.dispatchEvent(e); }, 20); }
      stop() {} abort() {}
    };
  });
  page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  const { Connector } = await import("../daemon/connector.js");
  new Connector({ port, app: { id: "testapp", name: "Test App" }, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
});
after(async () => {
  await browser?.close();
  site?.close(); openai?.close();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

test("settings round-trip through ~/.morse/settings.json", { skip }, async () => {
  await page.keyboard.press(OPEN_KEY);
  await waitFor(s => s.open);
  await page.keyboard.press("Control+Comma");
  await waitFor(s => s.pane === "settings");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Alt+KeyJ");
  await waitFor(s => s.hotkeys.open === "Alt+KeyJ");
  // The bar updates at once; the host's write lands a moment later (slow under a parallel `npm test`).
  let onDisk = null;
  for (let i = 0; i < 100 && !onDisk; i++) { try { onDisk = JSON.parse(await fs.readFile(path.join(home, "settings.json"), "utf8")); } catch { await page.waitForTimeout(50); } }
  assert.equal(onDisk.hotkeys.open, "Alt+KeyJ");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitFor(s => !s.open);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
  await waitFor(s => s.hotkeys.open === "Alt+KeyJ"); // from the hello reply
});

test("Stop mid-generation aborts the model on the desktop host", { skip }, async () => {
  await page.keyboard.press("Alt+KeyJ");
  await waitFor(s => s.open);
  await page.keyboard.type("add a sleep timer");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "working" && /Writing/.test(s.hint));
  await page.keyboard.press("Escape");
  const s = await waitFor(s => s.phase === "idle" && /Stopped/.test(s.hint));
  assert.equal(s.input, "add a sleep timer");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("style[data-morse-css]").count(), 0);
  const hist = await until(async () => JSON.parse(await fs.readFile(path.join(home, "history.json"), "utf8").catch(() => "null")));
  assert.deepEqual(hist.testapp, ["add a sleep timer"], "history is filed per app");
});

test("grants the microphone and transcribes through the connector", { skip }, async () => {
  assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: "microphone" })).state), "granted");
  await waitFor(s => s.open);
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".in").select());
  await page.keyboard.press("Backspace");
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
  await waitFor(s => s.voice === "listening");
  await page.waitForTimeout(1200);
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
  const s = await waitFor(s => s.voice === "idle" && s.input === "hide the sidebar");
  assert.equal(s.backend, "recorder");
  assert.ok(transcribed.length >= 1);
  assert.equal(transcribed.at(-1).auth, "Bearer sk-desktop");
  assert.ok(transcribed.at(-1).bytes > 500, "real audio was uploaded");
});

test("a change that matches nothing gets one repair round (effect check through the connector)", { skip }, async () => {
  await waitFor(s => s.open);
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".in").select());
  await page.keyboard.press("Backspace");
  await page.keyboard.type("paint the page gold"); // demo model: the first draft's selector matches nothing
  await page.keyboard.press("Enter");
  const s = await waitFor(s => s.phase === "result" || s.phase === "error", 20000);
  assert.equal(s.phase, "result", s.hint);
  assert.match(s.hint, /second try/, "the effect check sent it back once");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(255, 215, 0)");
  assert.match(await page.locator("style[data-morse-css]").first().textContent(), /^body \{/, "the repaired CSS replaced the dead one");
});
