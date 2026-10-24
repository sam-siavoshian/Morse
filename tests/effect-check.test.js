// The effect check (core/engine.js `probe`) through the real extension: the
// service worker asks the content script over the bar's port, after the CSS it
// streamed, and a change that matches nothing gets one repair round. The model
// is the demo replay behind a real Morse helper (`morse serve`, daemon/bridge.js).
// (The desktop connector's side is in connector.test.js.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
let skip = !chromium ? "playwright not installed" : !process.env.DISPLAY ? "extensions need a display (run under Xvfb)" : false;
let home, bridge, site, ctx, sw;

// The extension only talks to the helper on its fixed port. Another test run
// may hold it for a moment; wait for it rather than fail.
async function listenOnHelperPort(createBridge) {
  for (let i = 0; i < 60; i++) {
    const b = createBridge({ port: 7457, timeoutMs: 20000 });
    try { await b.listen(); return b; }
    catch (e) { if (e.code !== "EADDRINUSE") throw e; await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

before(async () => {
  if (skip) return;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-effect-"));
  process.env.MORSE_HOME = home;
  process.env.MORSE_PROVIDER = "demo";
  const { createBridge, startPairing } = await import("../daemon/bridge.js");
  bridge = await listenOnHelperPort(createBridge);
  if (!bridge) { skip = "the helper port 7457 stayed busy"; return; }
  site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" })
    .end(`<!doctype html><title>Shop</title><body style="background:#fff;color:#222"><header>Shop</header><main><h1>Deals</h1><p>Today only.</p></main></body>`)).listen(0, "127.0.0.1");
  await new Promise(r => site.on("listening", r));
  ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "morse-effect-profile-")), {
    headless: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const { code } = await startPairing();
  await sw.evaluate(async code => {
    const r = await fetch("http://127.0.0.1:7457/v1/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const { token } = await r.json();
    await chrome.storage.local.set({ helper: { token, url: "http://127.0.0.1:7457" }, model: { backend: "helper" }, welcomed: true });
  }, code);
});
after(async () => {
  await ctx?.close();
  await bridge?.close();
  site?.close();
  delete process.env.MORSE_PROVIDER;
  if (home) await fs.rm(home, { recursive: true, force: true });
});

test("a change that matches nothing gets one repair round (effect check through the extension)", async t => {
  if (skip) return t.skip(skip);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
  const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
  const waitFor = async (pred, ms = 20000) => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) { s = await status(); if (pred(s)) return s; await page.waitForTimeout(30); }
    throw new Error("timed out; last status " + JSON.stringify(s));
  };
  await page.keyboard.press(OPEN_KEY);
  await waitFor(s => s.open);
  await page.keyboard.type("paint the page gold"); // demo model: the first draft's selector matches nothing
  await page.keyboard.press("Enter");
  const s = await waitFor(s => s.phase === "result" || s.phase === "error");
  assert.equal(s.phase, "result", s.hint);
  assert.match(s.hint, /second try/, "the effect check sent it back once");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(255, 215, 0)");
  assert.match(await page.locator("style[data-morse-css]").first().textContent(), /^body \{/, "the repaired CSS replaced the dead one");
  await page.close();
});
