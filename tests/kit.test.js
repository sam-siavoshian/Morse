// Runs the mod helper kit in a real (headless) Chromium.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { settle } from "./helpers/wait.js";

const skip = noBrowser;
let browser, page;

before(async () => {
  if (skip) return;
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.setContent(`<header><button>Share</button></header><ul id="l"><li>a</li></ul>`);
  await page.evaluate(KIT_SOURCE);
});
after(() => browser?.close());

const run = (id, js) => page.evaluate(wrapModCode(id, js));

test("watch does not match elements the mod inserted", { skip }, async () => {
  const r = await run("m1", `morse.watch("header button", b => b.before(morse.el("button", { text: "Copy" })));`);
  assert.deepEqual(r, { ok: true, settle: 150 });
  await settle(page); // watch rescans on the frame after a mutation; it must not match its own button
  assert.equal(await page.locator("header button").count(), 2);
});

// speed: hosts wait settle ms for late errors instead of a flat 600.
test("settle: short for watch and clicks, until the first tick for timers, full for events that fire on their own", { skip }, async () => {
  const at = js => run("s1", js).then(r => r.settle);
  assert.equal(await at(`morse.watch("header button", b => b.title = "x"); morse.on(document, "keydown", () => {});`), 150);
  assert.equal(await at(`morse.el("button", { on: { click: () => {} } });`), 150);
  assert.equal(await at(`morse.every(300, () => {});`), 360);
  assert.equal(await at(`morse.after(5000, () => {});`), 600);
  assert.equal(await at(`morse.on(window, "scroll", () => {});`), 600);
  assert.equal(await at(`morse.el("audio", { on: { timeupdate: () => {} } });`), 600);
  await page.evaluate(() => morse.__off("s1"));
  const { settleMs } = await import("../core/kit.js");
  assert.equal(settleMs({ ok: true, settle: 150 }), 150);
  assert.equal(settleMs({ ok: true }), 600, "a kit from before settle: the old wait");
});

test("watch picks up elements added later", { skip }, async () => {
  await run("m2", `morse.watch("#l li", li => li.append(morse.el("b", { text: "!" })));`);
  await page.evaluate(() => { const li = document.createElement("li"); li.textContent = "b"; document.getElementById("l").append(li); });
  await page.waitForFunction(() => document.querySelectorAll("#l li b").length === 2);
  await settle(page);
  assert.equal(await page.locator("#l li b").count(), 2);
});

test("turning a mod off removes everything it created", { skip }, async () => {
  await page.evaluate(() => morse.__off("m1"));
  await page.evaluate(() => morse.__off("m2"));
  assert.equal(await page.locator("header button").count(), 1);
  assert.equal(await page.locator("#l li b").count(), 0);
});

test("a throwing mod reports the error and leaves nothing behind", { skip }, async () => {
  const r = await run("m3", `morse.css("body{color:red}"); nope();`);
  assert.equal(r.ok, false);
  assert.match(r.error, /nope is not defined/);
  assert.equal(await page.locator("style[data-morse=m3]").count(), 0);
});

test("errors inside callbacks are collected for the repair loop", { skip }, async () => {
  await run("m4", `morse.watch("header", h => h.missing.thing);`);
  const errs = await page.evaluate(() => morse.__errors("m4"));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /Cannot read properties of undefined/);
});

test("__stats reports how many elements each watch matches, now and ever", { skip }, async () => {
  assert.equal(await page.evaluate(() => morse.__stats("nope")), null, "not running: null");
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<ol id="s"><li>a</li></ol>`));
  await run("s1", `morse.watch("#s li", li => {}); morse.watch("#player-bar", () => {});`);
  let s = await page.evaluate(() => morse.__stats("s1"));
  assert.deepEqual(s.watches, [{ selector: "#s li", now: 1, total: 1 }, { selector: "#player-bar", now: 0, total: 0 }]);
  assert.equal(s.errors, 0);
  await page.evaluate(() => { const li = document.createElement("li"); document.getElementById("s").append(li); });
  await page.waitForFunction(() => morse.__stats("s1").watches[0].now === 2);
  s = await page.evaluate(() => morse.__stats("s1"));
  assert.deepEqual(s.watches[0], { selector: "#s li", now: 2, total: 2 });
  await page.evaluate(() => document.querySelectorAll("#s li").forEach(li => li.remove()));
  await page.waitForFunction(() => morse.__stats("s1").watches[0].now === 0);
  s = await page.evaluate(() => morse.__stats("s1"));
  assert.deepEqual(s.watches[0], { selector: "#s li", now: 0, total: 2 }, "total remembers what it found");
  await run("s2", `morse.watch("header", h => h.missing.thing);`);
  s = await page.evaluate(() => morse.__stats("s2"));
  assert.equal(s.errors, 1);
  assert.match(s.error, /Cannot read properties of undefined/);
  await page.evaluate(() => { morse.__off("s1"); morse.__off("s2"); });
  assert.equal(await page.evaluate(() => morse.__stats("s1")), null);
});
