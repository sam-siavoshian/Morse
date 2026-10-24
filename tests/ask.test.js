// Ask and find end to end in real Chromium: the real runtime on
// demo/playground.html?ask, whose fake host runs the real engine and reply
// parser against the demo model (core/demo.js), so replies are deterministic.
// Ask with markers, Find behind a closed menu, Show me stepping (the user
// clicks, Morse never does), follow-up context, and Explain this page.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { axeCheck, axeLines } from "../demo/axe.js"; // axe-core on Morse's own UI (tests/a11y-morse.test.js)
import { waitFor, waitForReady, readStatus, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
let browser;

before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

async function playground() {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  const runtime = bundleRuntime();
  await ctx.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/dist/extension/runtime.js") return route.fulfill({ body: runtime, contentType: "text/javascript" });
    try {
      const body = await readFile(new URL("." + path, ROOT));
      route.fulfill({ body, contentType: path.endsWith(".html") ? "text/html" : "text/javascript" });
    } catch { route.fulfill({ status: 404, body: "" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${ORIGIN}/demo/playground.html?ask&light&reset`);
  await waitForReady(page);
  return { ctx, page, errors };
}
async function scenario(fn) {
  const t = await playground();
  try { await fn(t); assert.deepEqual(t.errors, []); }
  finally { await t.ctx.close(); }
}
const status = readStatus;
const until = (fn, ms = TIMEOUT) => waitFor(fn, { timeout: ms, interval: 40, what: String(fn) });
// Types a question and waits for this question's answer (not the last one's).
// The status is read fresh (readStatus): a snapshot from before Enter would
// still say "Answered" for the last question while this one streams.
async function ask(page, text) {
  const n = (await fake(page)).asks.length;
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await until(async () => (await fake(page)).asks.length > n);
  await until(async () => { const s = await status(page); return s.phase === "idle" && /Answered/.test(s.hint); });
}
const fake = page => page.evaluate(() => window.__fake);
const cardText = page => page.locator(".ask .ask-body").innerText();
const badges = page => page.locator(".mk-badge").evaluateAll(bs => bs.map(b => ({ n: b.textContent, shown: !b.hidden })));

test("Ask: a question about what you point at gets an answer and a marker, not a mod", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  const r = await page.locator("#publish").boundingBox();
  await page.mouse.move(r.x + 10, r.y + 8);
  await page.mouse.click(r.x + 10, r.y + 8);
  await page.keyboard.type("why is this greyed out?");
  await page.keyboard.press("Enter");
  // The answer streams into the card while the model writes it.
  await page.locator(".ask.streaming").waitFor({ timeout: TIMEOUT });
  await until(async () => /Answered/.test((await status(page)).hint));
  assert.match(await cardText(page), /Publish 1 is turned off right now: “Add a title first”/);
  assert.equal(await page.locator(".ask-q").innerText(), "why is this greyed out?");
  assert.deepEqual(await badges(page), [{ n: "1", shown: true }]);
  // The badge sits on the marked element's corner.
  const b = await page.locator(".mk-badge").boundingBox();
  assert.ok(Math.abs(b.x - (r.x - 11)) < 3 && Math.abs(b.y - (r.y - 11)) < 3, JSON.stringify({ b, r }));
  // Nothing was changed: no mod, no injected CSS, nothing to keep.
  assert.equal(await page.locator("style[data-morse-css]").count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("morse:playground:mods")), null);
  const s = await status(page);
  assert.equal(s.phase, "idle");
  assert.equal(s.input, "");
  // The page is usable while the answer is up: a click reaches it, not the picker.
  await page.locator(".ask-marks [data-n='1']").click();
  await until(() => page.locator(".mk-ring.ping").count());
  await page.keyboard.press("Escape");
  await until(async () => (await page.locator(".mk-badge").count()) === 0);
}));

test("Find: something inside a closed menu is named, its menu marked, and the item listed as hidden", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  await ask(page, "where is the export button?");
  assert.match(await cardText(page), /^Export is in the More menu 1 at the end of the toolbar\.\s+Open the More menu 1\.\s+Choose Export as PDF 2\.$/);
  assert.deepEqual(await badges(page), [{ n: "1", shown: true }, { n: "2", shown: false }]);
  const chips = await page.locator(".ask-marks button").allInnerTexts();
  assert.match(chips[0], /More menu/);
  assert.match(chips[1], /Export as PDF\s*inside the More options menu/);
  assert.match(await page.locator(".ask [data-ask=show]").innerText(), /Show me\s*2 steps/);
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: an answer with numbered markers");
  // The model saw the menu, and what's inside it, in the page outline.
  const { asks } = await fake(page);
  assert.match(asks[0].outline, /^#more {2}"More options" {2}\(menu button, closed\)$/m);
  assert.match(asks[0].outline, /^#export {2}"Export as PDF" {2}\(menu item, in closed menu "More options"\)$/m);
  assert.match(asks[0].outline, /\(tab, selected\)/);
  assert.match(asks[0].outline, /#publish {2}"Publish" {2}\(button, disabled\)/);
  // Open the menu yourself: the hidden item's badge appears.
  await page.keyboard.press("Escape");
  await pressOpen(page);
  await ask(page, "where is the export button?");
  await page.locator("#more").click();
  await until(async () => (await badges(page)).every(b => b.shown));
}));

test("Show me: each step waits for the user's own click; Morse never clicks", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  await ask(page, "where is the export button?");
  await page.locator(".ask [data-ask=show]").click();
  const guide = page.locator(".guide");
  await until(async () => /Open the More menu/.test(await guide.innerText()));
  await until(async () => (await status(page)).open === false); // the bar steps aside
  assert.match(await guide.innerText(), /Step 1 of 2/);
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: Show me, step 1");
  // Waiting is all it does: watch for most of a second (an observation window,
  // not a wait for the app; a slow machine only makes it stricter).
  await page.waitForTimeout(900);
  assert.equal(await page.locator("#more-menu").isHidden(), true);
  assert.match(await guide.innerText(), /Step 1 of 2/);
  assert.equal(await page.locator(".mk-layer.focus .mk-badge").count(), 1);
  // Back is off on the first step; Skip and Back move without clicking anything.
  assert.equal(await guide.locator("[data-g=back]").isDisabled(), true);
  await guide.locator("[data-g=skip]").click();
  await until(async () => /Choose Export as PDF/.test(await guide.innerText()));
  assert.match(await guide.innerText(), /Can't see it yet|Looking for it/);
  await guide.locator("[data-g=back]").click();
  await until(async () => /Open the More menu/.test(await guide.innerText()));
  // The user clicks the marked button: on to step 2, which is now showing.
  await page.locator("#more").click();
  await until(async () => /Choose Export as PDF/.test(await guide.innerText()));
  await until(async () => /Click it yourself/.test(await guide.innerText()));
  assert.equal(await page.locator(".mk-badge:not([hidden])").innerText(), "2");
  await page.locator("#export").click();
  await until(async () => /That's it/.test(await guide.innerText()));
  const f = await fake(page);
  assert.equal(f.exported, 1);
  // Every click on the page came from the user (Playwright's mouse), none from script.
  assert.ok(f.clicks.length >= 3);
  assert.ok(f.clicks.every(c => c.trusted), JSON.stringify(f.clicks));
  await until(async () => await guide.isHidden());
  // Esc stops a walk-through.
  await pressOpen(page);
  await ask(page, "where is the export button?");
  await page.locator(".ask [data-ask=show]").click();
  await until(() => guide.isVisible());
  await page.keyboard.press("Escape");
  await until(async () => (await guide.isHidden()) && (await page.locator(".mk-badge").count()) === 0);
}));

test("Follow-ups carry the page's earlier questions; New topic forgets them", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  await ask(page, "where is the export button?");
  await ask(page, "and how do I undo that?");
  assert.match(await cardText(page), /nothing on the page to undo/);
  assert.match(await page.locator(".ask-ctx").innerText(), /remembers 1 earlier question/);
  let { asks } = await fake(page);
  assert.equal(asks[0].ask, null);
  assert.equal(asks[1].ask.turns.length, 1);
  assert.equal(asks[1].ask.turns[0].q, "where is the export button?");
  assert.match(asks[1].ask.turns[0].a, /^\*\*Export\*\* is in the More menu \[1\]/);
  assert.deepEqual(asks[1].ask.turns[0].points.map(p => p.selector), ["#more", "#export"]);
  // Closing and reopening the bar keeps the conversation (in memory only).
  await page.keyboard.press("Escape");
  await pressOpen(page);
  await ask(page, "and then?");
  ({ asks } = await fake(page));
  assert.equal(asks[2].ask.turns.length, 2);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => /ask|turn/i.test(k)).length), 0);
  await page.locator(".ask [data-ask=forget]").click();
  await ask(page, "where is the export button?");
  ({ asks } = await fake(page));
  assert.equal(asks[3].ask, null);
}));

test("Explain this page from the page tools: a plain summary with markers", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  await page.locator(".gm-qbtn").click();
  const item = page.locator(".gm-menu [data-ask=explain]");
  assert.equal(await item.innerText(), "Explain this page");
  // It survives the menu re-rendering, and is first in it.
  await page.locator(".gm-qbtn").click();
  await page.locator(".gm-qbtn").click();
  assert.equal(await page.locator(".gm-menu button").first().getAttribute("data-ask"), "explain");
  await item.click();
  await until(async () => /Answered/.test((await status(page)).hint));
  assert.match(await cardText(page), /^This is a small notes app\./);
  assert.equal((await cardText(page)).split("\n").filter(Boolean).length, 4);
  assert.equal(await page.locator(".ask-q").innerText(), "Explain this page");
  assert.deepEqual((await badges(page)).map(b => b.shown), [true, true, true]);
  const { asks } = await fake(page);
  assert.equal(asks.at(-1).ask.mode, "explain");
}));

test("Stopping mid-answer leaves no card, no markers and no turn behind", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  await page.evaluate(() => { window.__demoMs = 80; }); // a slow answer, so Esc lands mid-stream
  await page.keyboard.type("where is the export button?");
  await page.keyboard.press("Enter");
  await page.locator(".ask.streaming").waitFor({ timeout: TIMEOUT });
  await page.keyboard.press("Escape");
  await until(async () => /Stopped/.test((await status(page)).hint));
  assert.equal(await page.locator(".ask").isHidden(), true);
  assert.equal(await page.locator(".mk-badge").count(), 0);
  // The next question starts fresh: the stopped one isn't a turn.
  await page.evaluate(() => { window.__demoMs = 0; });
  await page.keyboard.press("Control+a");
  await ask(page, "and how do I undo that?");
  const { asks } = await fake(page);
  assert.equal(asks.at(-1).ask, null);
}));
