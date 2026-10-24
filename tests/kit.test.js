// Runs the mod helper kit in a real (headless) Chromium.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
let browser, page;

before(async () => {
  if (skip) return;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(`<header><button>Share</button></header><ul id="l"><li>a</li></ul>`);
  await page.evaluate(KIT_SOURCE);
});
after(() => browser?.close());

const run = (id, js) => page.evaluate(wrapModCode(id, js));

test("watch does not match elements the mod inserted", { skip }, async () => {
  const r = await run("m1", `morse.watch("header button", b => b.before(morse.el("button", { text: "Copy" })));`);
  assert.deepEqual(r, { ok: true });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("header button").count(), 2);
});

test("watch picks up elements added later", { skip }, async () => {
  await run("m2", `morse.watch("#l li", li => li.append(morse.el("b", { text: "!" })));`);
  await page.evaluate(() => { const li = document.createElement("li"); li.textContent = "b"; document.getElementById("l").append(li); });
  await page.waitForTimeout(100);
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
