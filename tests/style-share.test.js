// Your style, shared between Chrome and the desktop apps (dogfood: a style
// made in Chrome never reached the apps, though the toast said “every site
// and app”). The real built extension in Chromium and a real Morse helper
// (daemon/bridge.js) on a port of this test's own, with this test's
// MORSE_HOME standing in for the desktop:
//   - not paired, Chrome's toast says where the style really goes: every site in Chrome
//   - pairing sends Chrome's style to the desktop (~/.morse/style.json)
//   - a style said on the desktop shows in Chrome on the next page load
//   - paired, the toast says every site and app
//
//   node scripts/build.js && DISPLAY=:99 node --test tests/style-share.test.js
import { home, tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { chromium, noDisplay } from "./helpers/browser.js";
import { startDemoServer, routeDemoOrigins } from "./helpers/demo-server.js";
import { waitFor, waitForStatus, TIMEOUT } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const skip = noDisplay || (!existsSync(EXT) && "run node scripts/build.js first");
const BYTE = "http://127.0.0.1:8788/demo/sites/byte/";
const STYLE_FILE = path.join(home, "style.json");
let ctx, sw, demo, bridge, port, extId;

before(async () => {
  if (skip) return;
  const { createBridge } = await import("../daemon/bridge.js");
  bridge = createBridge({ port: 0 });
  port = await bridge.listen();
  demo = await startDemoServer();
  ctx = await chromium.launchPersistentContext(tempDir("morse-style-share-"), {
    headless: false, timeout: TIMEOUT * 2, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await routeDemoOrigins(ctx, demo);
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: TIMEOUT });
  extId = new URL(sw.url()).host;
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p, welcomed: true, "morse.onboarding": { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } } }), port);
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close().catch(() => {}); // the welcome page
});
after(async () => { await ctx?.close(); await demo?.close(); await bridge?.close(); });

async function open(url = BYTE) {
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.morseExtension === "1");
  return p;
}
const shadow = (p, sel) => p.evaluate(s => { const el = document.querySelector("[data-morse-ui]")?.shadowRoot?.querySelector(s); return el && !el.hidden ? el.textContent : ""; }, sel);
async function sayStyle(p, words) {
  await pressOpen(p);
  await waitForStatus(p, s => s.open && s.ready && s.phase === "idle", { what: "the bar" });
  await p.keyboard.type(words);
  await p.keyboard.press("Enter");
  await waitForStatus(p, s => s.phase === "style" && s.pane === "ys", { what: "the style to show for review" });
  const header = await shadow(p, ".ys-sheet header .dim");
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, `style-share-${header.replace(/\W+/g, "-").toLowerCase()}.png`) });
  await p.keyboard.press("Enter");
  await waitForStatus(p, s => !s.open && s.phase === "idle", { what: "Save" });
  const toast = await waitFor(() => shadow(p, ".toast"), { what: "the toast" });
  return { header, toast };
}
const underlined = p => p.evaluate(() => getComputedStyle(document.querySelector("a[href]")).textDecorationLine === "underline");
const font = p => p.evaluate(() => getComputedStyle(document.querySelector("h1, h2, p")).fontFamily);
// The pairing Chrome would do: a one-time code, swapped for a token bound to this extension.
async function pairChrome() {
  const { startPairing } = await import("../daemon/bridge.js");
  const { code } = await startPairing();
  const token = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ code });
    const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/pair", headers: { "Content-Type": "application/json", "Content-Length": body.length, Origin: `chrome-extension://${extId}` } }, res => {
      let text = "";
      res.on("data", d => (text += d));
      res.on("end", () => { try { resolve(JSON.parse(text).token); } catch (e) { reject(e); } });
    });
    r.on("error", reject);
    r.end(body);
  });
  assert.ok(token);
  await sw.evaluate(token => chrome.storage.local.set({ helper: { token } }), token);
}

test("Your style: Chrome says where it goes, and once paired with the Morse helper it is one style for Chrome and the apps", { skip, timeout: 180000 }, async () => {
  // Not paired: only Chrome has it, and Morse says so.
  let p = await open();
  const said = await sayStyle(p, "underline links everywhere");
  assert.equal(said.header, "Every site in Chrome");
  assert.equal(said.toast, "Saved your style. It follows you to every site in Chrome.");
  assert.ok(await underlined(p));
  assert.ok(!existsSync(STYLE_FILE), "nothing reached the desktop");
  await p.close();

  // Paired: Chrome's style goes to the desktop.
  await pairChrome();
  const stored = await waitFor(() => existsSync(STYLE_FILE) && JSON.parse(readFileSync(STYLE_FILE, "utf8")), { what: "style.json" });
  assert.equal(stored.blocks.underline, true);

  // Said in an app (the desktop's Style host, as the connector serves it):
  // Chrome reads the helper's copy when a page loads (at most every 5 s), and
  // the open page shows it at once, with no reload.
  const { Style } = await import("../daemon/style.js");
  await Style.handle({ type: "style.save", add: "Georgia font everywhere" }, { url: "", app: "obsidian" });
  await new Promise(r => setTimeout(r, 5500));
  p = await open();
  await waitFor(async () => /Georgia/.test(await font(p)), { what: "the desktop's Georgia in Chrome" });
  assert.equal((await sw.evaluate(() => chrome.storage.local.get("style"))).style.blocks.font, "Georgia");
  assert.ok(await underlined(p), "and the part said in Chrome stays");

  // Paired: every site and app.
  const again = await sayStyle(p, "bigger text everywhere");
  assert.equal(again.header, "Every site and app");
  assert.equal(again.toast, "Saved your style. It follows you to every site and app.");
  await waitFor(() => JSON.parse(readFileSync(STYLE_FILE, "utf8")).blocks.size === 2, { what: "bigger text on the desktop too" });
  await p.close();
});

// perf: a page load asks the helper for its copy at most every 5 s (a burst
// of tabs asks once), and a check that finds nothing changed writes nothing
// to chrome.storage (core/style-sync.js).
test("Your style, paired: page loads check the helper at most every 5 s, and write nothing when nothing changed", { skip, timeout: 120000 }, async () => {
  const gets = [];
  const count = req => { if (req.url === "/v1/style" && req.method === "GET") gets.push(Date.now()); };
  bridge.server.on("request", count);
  await sw.evaluate(() => {
    globalThis.__styleWrites = 0;
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (items, ...rest) => { if (items && ("styleSync" in items || "style" in items)) globalThis.__styleWrites++; return set(items, ...rest); };
  });
  try {
    await new Promise(r => setTimeout(r, 5500)); // past the last check
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) await (await open()).close();
    const ms = Date.now() - t0;
    await new Promise(r => setTimeout(r, 1000));
    assert.ok(gets.length >= 1 && gets.length <= 1 + Math.floor(ms / 5000), `${gets.length} checks for 6 page loads in ${ms} ms`);
    assert.equal(await sw.evaluate(() => globalThis.__styleWrites), 0, "nothing written when nothing changed");
  } finally { bridge.server.off("request", count); }
});
