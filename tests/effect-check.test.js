// The effect check (core/engine.js `probe`) through the real extension: the
// service worker asks the content script over the bar's port, after the CSS it
// streamed, and a change that matches nothing gets one repair round. The model
// is the demo replay behind a real Morse helper (`morse serve`, daemon/bridge.js)
// on a free port; the extension's fixed helper address is routed to it.
// (The desktop connector's side is in connector.test.js.)
import { home, tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { chromium, noDisplay } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1"; // route the worker's fetches too
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const HELPER = "http://127.0.0.1:7457";
const skip = noDisplay;
let bridge, port, site, ctx, sw;

before(async () => {
  if (skip) return;
  void home; // own MORSE_HOME (helpers/home.js)
  process.env.MORSE_PROVIDER = "demo";
  const { createBridge, startPairing } = await import("../daemon/bridge.js");
  bridge = createBridge({ port: 0, timeoutMs: 20000 });
  port = await bridge.listen();
  site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" })
    .end(`<!doctype html><title>Shop</title><body style="background:#fff;color:#222"><header>Shop</header><main><h1>Deals</h1><p>Today only.</p></main></body>`)).listen(0, "127.0.0.1");
  await new Promise(r => site.on("listening", r));
  ctx = await chromium.launchPersistentContext(tempDir("morse-effect-profile-"), {
    headless: false, timeout: TIMEOUT * 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  // The helper's fixed address, answered by this test's bridge (streamed NDJSON passes through).
  await ctx.route(`${HELPER}/**`, async route => {
    const url = new URL(route.request().url());
    url.port = String(port);
    try { await route.fulfill({ response: await route.fetch({ url: url.href }) }); } catch { await route.abort().catch(() => {}); }
  });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const { code } = await startPairing();
  await sw.evaluate(async ({ code, HELPER }) => {
    const r = await fetch(`${HELPER}/v1/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const { token } = await r.json();
    await chrome.storage.local.set({ helper: { token, url: HELPER }, model: { backend: "helper" }, welcomed: true });
  }, { code, HELPER });
});
after(async () => {
  await ctx?.close();
  await bridge?.close();
  site?.close();
  delete process.env.MORSE_PROVIDER;
});

test("a change that matches nothing gets one repair round (effect check through the extension)", { skip }, async () => {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  await waitForReady(page);
  const status = (pred, what) => waitForStatus(page, pred, { what });
  await pressOpen(page);
  await status(s => s.open, "the bar to open");
  await page.keyboard.type("paint the page gold"); // demo model: the first draft's selector matches nothing
  await page.keyboard.press("Enter");
  const s = await status(s => s.phase === "result" || s.phase === "error", "the result");
  assert.equal(s.phase, "result", s.hint);
  assert.match(s.hint, /second try/, "the effect check sent it back once");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(255, 215, 0)");
  assert.match(await page.locator("style[data-morse-css]").first().textContent(), /^body \{/, "the repaired CSS replaced the dead one");
  await page.close();
});
