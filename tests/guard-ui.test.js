// Guards, end to end in real Chromium: the demo Tasks page (demo/sites/guard),
// the real desktop connector (CDP) as the host and the demo model. Each bad
// mod is saved as it might arrive from a share link (no generation-time check
// saw it), then the page is opened. For each: the page stays usable, the mod
// is paused (turned off, with why, on disk), and Morse says so in plain words,
// in a toast and in the Mods panel with Turn back on and Fix it.
//   - a feedback loop: the page's framework re-renders what the mod changes
//   - a fast interval doing real work
//   - a heavy watch on a live feed
//   - CSS that hides everything
//   - `while (true) {}`, on load and in a click handler: the page freezes, the
//     connector stops the script over CDP, turns the mod off and reloads
import { home } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { noBrowser as skip, launchBrowser } from "./helpers/browser.js";
import { freePort, listen } from "./helpers/net.js";
import { waitFor, scaled } from "./helpers/wait.js";
import * as store from "../daemon/store.js";
import { createMod } from "../core/mod.js";
import { openLibrary, ORIGIN as LIBRARY } from "../demo/a11y-page.js";

const ROOT = new URL("../", import.meta.url);
let browser, ctx, server, site;
const readMod = async id => JSON.parse(await fs.readFile(path.join(home, "mods", `${id}.json`), "utf8"));
const until = (fn, ms, what) => waitFor(fn, { timeout: scaled(ms), interval: 100, what });

before(async () => {
  if (skip) return;
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
  server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(await fs.readFile(new URL("." + (p.endsWith("/") ? p + "index.html" : p), ROOT))); }
    catch { res.writeHead(404).end("not found"); }
  });
  site = `http://127.0.0.1:${await listen(server)}/demo/sites/guard/`;

  const cdp = await freePort();
  browser = await launchBrowser({ args: [`--remote-debugging-port=${cdp}`] });
  ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  const { Connector } = await import("../daemon/connector.js");
  new Connector({ port: cdp, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();
});
after(async () => {
  await browser?.close();
  server?.close();
});

// The only mod: saved, then the page opens in a new tab (safe start counts per tab).
async function open(mod, query = "") {
  for (const m of await store.listMods()) await store.deleteMod(m.id);
  const saved = await store.saveMod(createMod({ prompt: mod.title.toLowerCase(), ...mod, url: site }));
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto(site + query);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: scaled(30000) });
  return { page, id: saved.id };
}
const ui = (page, sel) => page.locator(`[data-morse-ui] ${sel}`);

// Usable: a click lands and a task queued now runs right away.
async function usable(page) {
  const n = +(await page.locator("#count").textContent());
  await page.click("#done", { timeout: 3000 });
  assert.equal(+(await page.locator("#count").textContent()), n + 1, "the button works");
  const lag = await page.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(performance.now() - t), 0); }));
  assert.ok(lag < 100, `the page answers (a task waited ${Math.round(lag)}ms)`);
  assert.ok(await page.locator("#done").isVisible(), "the page shows");
}
// Paused: off on disk, with why; its code no longer runs in the page.
async function paused(page, id, why) {
  const m = await until(async () => { const m = await readMod(id); return !m.enabled && m.paused ? m : null; }, 30000, `${id} paused`);
  assert.equal(m.paused.why, why);
  assert.match(m.paused.error, /^Morse (paused|stopped) it\b/);
  // (the page may be reloading, after a freeze)
  await until(() => page.evaluate(id => globalThis.morse?.__stats(id) == null, id).catch(() => false), 10000, "nothing of it runs");
  return m;
}
// Said: the toast, then the Mods panel row with Turn back on and Fix it.
async function said(page, id, toast, lead, note) {
  const t = ui(page, ".ctl-toast:not([hidden])");
  await t.waitFor({ timeout: 10000 });
  assert.equal((await t.locator(".ctl-msg span").textContent()).trim(), toast);
  assert.deepEqual(await t.locator(".ctl-acts button").allTextContents(), ["Turn back on", "Fix it"]);
  await page.keyboard.press("Alt+Shift+KeyM");
  const row = ui(page, `.panel article[data-id="${id}"] .health.guard`);
  await row.waitFor({ timeout: 5000 });
  assert.equal((await row.locator("p").textContent()).trim(), `${lead} ${note}`);
  assert.deepEqual(await row.locator("button").allTextContents(), ["Turn back on", "Fix it"]);
  return row;
}
const SLOW = "Paused because it was slowing this page down.";

test("a feedback loop with the page's framework: paused, the page keeps working", { skip, timeout: 60000 }, async () => {
  const { page, id } = await open({ title: "Mark seen tasks", js: `morse.watch(".item", el => el.setAttribute("data-seen", ""));` }, "?framework");
  await paused(page, id, "loop");
  await usable(page);
  await said(page, id, "Paused “Mark seen tasks” because it was slowing this page down", SLOW, "It kept running again every time the page changed.");
  await page.close();
});

test("a fast interval doing real work: paused; Turn back on runs it again under the same limits", { skip, timeout: 60000 }, async () => {
  const js = `morse.every(1, () => { const t = performance.now(); while (performance.now() - t < 45) {} document.getElementById("clock").dataset.seen = Date.now(); });`;
  const { page, id } = await open({ title: "Busy clock", js });
  await paused(page, id, "slow");
  await usable(page);
  const row = await said(page, id, "Paused “Busy clock” because it was slowing this page down", SLOW, "It kept this page busy most of the time.");
  // The person turns it back on: it runs, and is paused again for the same reason.
  const before = (await readMod(id)).paused.at;
  await row.locator("button", { hasText: "Turn back on" }).click();
  await until(async () => (await readMod(id)).enabled, 10000, "back on");
  await until(async () => { const m = await readMod(id); return !m.enabled && m.paused?.at !== before; }, 30000, "paused again");
  await ui(page, ".panel [data-a=close]").click();
  await usable(page);
  await page.close();
});

test("a heavy watch on a live feed: paused; Fix it asks the model with the reason and the fix runs", { skip, timeout: 90000 }, async () => {
  const js = `morse.watch(".item", el => { const t = performance.now(); while (performance.now() - t < 30) {} el.style.fontWeight = "600"; });`;
  const { page, id } = await open({ title: "Bold new tasks", js }, "?feed");
  await paused(page, id, "slow");
  await usable(page);
  const row = await said(page, id, "Paused “Bold new tasks” because it was slowing this page down", SLOW, "It kept this page busy most of the time.");
  await row.locator("button", { hasText: "Fix it" }).click();
  const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
  await until(async () => { const s = await status(); return s.open && s.phase === "result"; }, 30000, "the fix");
  await page.keyboard.press("Enter"); // Save
  const m = await until(async () => { const m = await readMod(id); return m.enabled ? m : null; }, 10000, "saved");
  assert.equal(m.paused, undefined, "no longer paused");
  // The demo model writes this only when what went wrong is Morse's pause reason (core/demo.js).
  assert.match(m.css, /border-color: #8aa4c8/, "the model was told why it was paused");
  assert.equal(m.js.trim(), "", "the demo model's lighter version");
  assert.match(m.history.at(-1).js, /while \(performance\.now\(\)/, "the old version is in History");
  await usable(page);
  await page.close();
});

test("CSS that hides everything is never applied: paused, the page stays visible", { skip, timeout: 60000 }, async () => {
  const { page, id } = await open({ title: "Hide everything", css: "* { display: none !important }" });
  await paused(page, id, "hid");
  await usable(page);
  assert.equal(await page.locator("style[data-morse-css]").count(), 0);
  await said(page, id, "Paused “Hide everything” because it hid this page", "Paused because it hid this page.", "It would have hidden everything on the page.");
  await page.close();
});

test("desktop: `while (true) {}` in a mod freezes the page; Morse stops it, turns it off and reloads", { skip, timeout: 90000 }, async () => {
  const { page, id } = await open({ title: "Spin", js: "while (true) {}" });
  const m = await paused(page, id, "froze");
  assert.equal(m.paused.reloaded, true);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: scaled(30000) });
  await usable(page);
  await said(page, id, "Paused “Spin” because it froze this page", "Paused because it froze this page.", "Morse stopped it and reloaded the page.");
  await page.close();
});

test("desktop: a click handler that never returns is stopped the same way", { skip, timeout: 90000 }, async () => {
  const { page, id } = await open({ title: "Spin on click", js: `morse.on(document.getElementById("done"), "click", () => { while (true) {} });` });
  await page.waitForTimeout(1200); // it ran, and its code waits for a click
  const t0 = Date.now();
  await page.click("#done", { noWaitAfter: true }).catch(() => {}); // the page freezes here
  await paused(page, id, "froze");
  assert.ok(Date.now() - t0 < 15000, "recovered within seconds");
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: scaled(30000) });
  await usable(page);
  await said(page, id, "Paused “Spin on click” because it froze this page", "Paused because it froze this page.", "Morse stopped it and reloaded the page.");
  await page.close();
});

test("where a frozen page can't be stopped (the extension), a loop with no way out never starts", { skip, timeout: 90000 }, async () => {
  // The real runtime with a stand-in host that isn't the desktop one (demo/a11y-host.js).
  const { ctx: c, page, errors } = await openLibrary(browser);
  try {
    const mod = createMod({ title: "Spin", prompt: "spin", js: "morse.watch('main', () => { while (true) {} });", url: `${LIBRARY}/demo/sites/a11y/index.html` });
    await page.evaluate(m => localStorage.setItem("morse:a11y-host:mods", JSON.stringify({ [m.id]: m })), mod);
    await page.reload();
    const saved = () => page.evaluate(id => JSON.parse(localStorage.getItem("morse:a11y-host:mods"))[id], mod.id);
    const m = await until(async () => { const m = await saved(); return m.paused ? m : null; }, 30000, "paused");
    assert.equal(m.enabled, false);
    assert.equal(m.paused.why, "endless");
    assert.match(m.paused.error, /`while \(true\)` with no break/);
    const lag = await page.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(performance.now() - t), 0); }));
    assert.ok(lag < 100, "the page never froze");
    const t = ui(page, ".ctl-toast:not([hidden])");
    await t.waitFor({ timeout: 10000 });
    assert.equal((await t.locator(".ctl-msg span").textContent()).trim(), "Paused “Spin” because it would freeze this page");
    assert.deepEqual(errors, []);
  } finally { await c.close(); }
});
