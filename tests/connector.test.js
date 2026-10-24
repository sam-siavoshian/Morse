// The desktop connector over real CDP: settings in ~/.morse/settings.json,
// history, Stop mid-generation, the microphone grant, and voice going
// MediaRecorder -> CDP binding -> core/transcribe.js -> (fake) OpenAI.
import { home } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { freePort, listen } from "./helpers/net.js";
import { waitFor, waitForStatus, waitForReady } from "./helpers/wait.js";

const skip = noBrowser;
let browser, page, site, openai, conn, running, transcribed = [];
const status = (pred, what) => waitForStatus(page, pred, { what });
const readJson = async f => JSON.parse(await fs.readFile(path.join(home, f), "utf8"));

before(async () => {
  if (skip) return;
  openai = http.createServer(async (req, res) => {
    let n = 0;
    for await (const c of req) n += c.length;
    transcribed.push({ auth: req.headers.authorization, bytes: n });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text: "hide the sidebar" }));
  });
  process.env.OPENAI_API_KEY = "sk-desktop";
  process.env.MORSE_OPENAI_BASE_URL = `http://127.0.0.1:${await listen(openai)}`;
  site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>App</title><body style="background:#111;color:#eee"><div id="sidebar">Sidebar</div><main>Main</main></body>`));
  const sitePort = await listen(site);

  // Playwright owns the browser, so it can't use port 0 + DevToolsActivePort:
  // take an OS-picked free port (never a fixed one).
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, "--use-fake-device-for-media-stream"]; // no fake UI: the connector's grant has to work
  browser = await launchBrowser({ channel: "chromium", args });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("morse:debug", "1");
    globalThis.webkitSpeechRecognition = class extends EventTarget { // as inside Electron
      start() { setTimeout(() => { this.onerror?.(Object.assign(new Event("error"), { error: "network" })); const e = new Event("end"); this.onend?.(e); this.dispatchEvent(e); }, 20); }
      stop() {} abort() {}
    };
  });
  page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${sitePort}/`);
  const { Connector } = await import("../daemon/connector.js");
  // demoMs: a slower demo reply, so Stop reliably lands mid-stream on a busy machine.
  conn = new Connector({ port, app: { id: "testapp", name: "Test App" }, settings: { provider: "demo", model: "demo", demoMs: 60 }, log: () => {} });
  running = conn.run();
  await waitForReady(page);
});
after(async () => {
  await conn?.stop().catch(() => {});
  await running;
  await browser?.close();
  site?.close(); openai?.close();
});

test("settings round-trip through ~/.morse/settings.json", { skip }, async () => {
  await page.keyboard.press("Alt+Space");
  await status(s => s.open, "the bar to open");
  await page.keyboard.press("Control+Comma");
  await status(s => s.pane === "settings", "the settings sheet");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Alt+KeyJ");
  await status(s => s.hotkeys.open === "Alt+KeyJ", "the new hotkey in the bar");
  // The bar updates at once; the host's write lands a moment later.
  await waitFor(async () => (await readJson("settings.json")).hotkeys?.open === "Alt+KeyJ", { what: "settings.json to hold Alt+KeyJ" });
  await page.keyboard.press("Escape");
  await status(s => s.pane === "", "the sheet to close");
  await page.keyboard.press("Escape");
  await status(s => !s.open, "the bar to close");
  await page.reload();
  await waitForReady(page);
  await status(s => s.hotkeys.open === "Alt+KeyJ", "the hotkey from the hello reply");
});

test("Stop mid-generation aborts the model on the desktop host", { skip }, async () => {
  await page.keyboard.press("Alt+KeyJ");
  await status(s => s.open, "the bar to open");
  await page.keyboard.type("add a sleep timer");
  await page.keyboard.press("Enter");
  await status(s => s.phase === "working" && /Writing/.test(s.hint), "the model to be writing");
  await page.keyboard.press("Escape");
  const s = await status(s => s.phase === "idle" && /Stopped/.test(s.hint), "Stopped");
  assert.equal(s.input, "add a sleep timer");
  await waitFor(async () => (await page.locator("style[data-morse-css]").count()) === 0, { what: "partial CSS to be removed" });
  const hist = await waitFor(async () => { const h = await readJson("history.json"); return h.testapp?.length && h; }, { what: "history.json" });
  assert.deepEqual(hist.testapp, ["add a sleep timer"], "history is filed per app");
});

test("grants the microphone and transcribes through the connector", { skip }, async () => {
  await waitFor(() => page.evaluate(async () => (await navigator.permissions.query({ name: "microphone" })).state === "granted"), { what: "the microphone grant" });
  await status(s => s.open, "the bar to be open");
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".in").select());
  await page.keyboard.press("Backspace");
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
  await status(s => s.voice === "listening", "listening");
  await status(s => s.db > -100, "sound from the fake microphone");
  await page.waitForTimeout(1200); // talk for 1.2s: the recording's length, not a wait for the app
  await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
  const s = await status(s => s.voice === "idle" && s.input === "hide the sidebar", "the transcript");
  assert.equal(s.backend, "recorder");
  assert.ok(transcribed.length >= 1);
  assert.equal(transcribed.at(-1).auth, "Bearer sk-desktop");
  assert.ok(transcribed.at(-1).bytes > 500, "real audio was uploaded");
});

