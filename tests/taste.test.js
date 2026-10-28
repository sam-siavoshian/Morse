// Like or dislike on a feed, end to end: the real runtime, the real engine,
// and the demo model. A complex ask reorders the posts and is remembered.
// The next line is a follow-up on that change.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
const ASK = "Add a feature that lets me like or dislike a post, and it should affect the recommendation and show me more of that type of post";
let browser;

before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

async function playground() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const runtime = bundleRuntime();
  await ctx.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/dist/runtime/runtime.js") return route.fulfill({ body: runtime, contentType: "text/javascript" });
    try {
      const body = await readFile(new URL("." + path, ROOT));
      route.fulfill({ body, contentType: path.endsWith(".html") ? "text/html" : "text/javascript" });
    } catch { route.fulfill({ status: 404, body: "" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${ORIGIN}/demo/playground.html?light&model=demo&feed`);
  await waitForReady(page);
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, ms = TIMEOUT) => waitForStatus(page, pred, { timeout: ms, what: String(pred) });
  return { ctx, page, errors, status, waitFor };
}

const order = page => page.locator("[data-feed] article").evaluateAll(els => els.map(e => e.dataset.type));
const shown = page => page.locator("[data-feed] article").evaluateAll(els => els.filter(e => getComputedStyle(e).display !== "none").map(e => e.dataset.type));

test("a like or dislike reorders the feed, and a follow-up refines that change", { skip }, async () => {
  const { ctx, page, errors, waitFor } = await playground();
  await pressOpen(page);
  await waitFor(s => s.open && s.phase === "idle");
  assert.equal(await page.locator("[data-morse-ui] .in").getAttribute("placeholder"), "What do you want to hack?");
  await page.keyboard.type(ASK);
  await page.keyboard.press("Enter");
  let s = await waitFor(s => s.phase === "result");
  assert.match(s.hint, /Like or dislike to tune feed/);
  assert.equal(await page.locator("[data-morse-ui] .in").getAttribute("placeholder"), "Follow up on this change…");
  assert.equal(await page.locator("[data-feed] .morse-like").count(), 4);
  assert.deepEqual(await order(page), ["music", "sports", "music", "news"]);

  await page.locator('article[data-type="sports"] .morse-like').click();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-feed] article")].map(e => e.dataset.type).join() === "sports,music,music,news");
  await page.locator('article[data-type="music"] .morse-dislike').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-feed] article")].map(e => e.dataset.type).join() === "sports,news,music,music");
  const saved = await page.evaluate(() => Object.keys(localStorage).filter(k => k.endsWith(":morse-taste")).map(k => localStorage.getItem(k)));
  assert.equal(saved.length, 1);
  assert.match(saved[0], /"sports":1/);
  assert.match(saved[0], /"music":-1/);

  await page.locator("[data-morse-ui] .in").click();
  await page.keyboard.type("hide posts I dislike");
  await page.keyboard.press("Enter");
  s = await waitFor(s => s.phase === "result" && /version 2/.test(s.hint));
  assert.equal(await page.locator("[data-morse-ui] .in").getAttribute("placeholder"), "Follow up on this change…");
  assert.match(s.hint, /Hide disliked posts|Like or dislike to tune feed/);
  assert.deepEqual(await shown(page), ["sports", "news"]);
  assert.equal(await page.locator("[data-feed] .morse-like").count(), 4, "the follow-up kept the buttons");
  assert.deepEqual(errors, []);
  await ctx.close();
});
