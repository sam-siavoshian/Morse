// Keep iterating, end to end in real Chromium: the real runtime on
// demo/playground.html with ?model=demo (the real engine and the built-in demo
// model from core/demo.js, so prompts, streaming, parsing and exec are real).
// Refine a result, step back with Ctrl+Z, keep, restore from History, refine
// from the panel; a saved mod that broke shows why and Fix it repairs it;
// the panel's search, keyboard and Copy link.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, settle, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
let browser;

before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

async function playground({ query = "?light&model=demo", mods = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const runtime = bundleRuntime();
  await ctx.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/dist/extension/runtime.js") return route.fulfill({ body: runtime, contentType: "text/javascript" });
    try {
      const body = await readFile(new URL("." + path, ROOT));
      route.fulfill({ body, contentType: path.endsWith(".html") ? "text/html" : "text/javascript" });
    } catch { route.fulfill({ status: 404, body: "" }); }
  });
  if (mods) await ctx.addInitScript(m => { if (!localStorage.getItem("morse:playground:mods")) localStorage.setItem("morse:playground:mods", m); }, JSON.stringify(mods));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${ORIGIN}/demo/playground.html${query}`);
  await waitForReady(page);
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, ms = TIMEOUT) => waitForStatus(page, pred, { timeout: ms, what: String(pred) });
  return { ctx, page, errors, status, waitFor };
}
const saved = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")));
const fontSize = page => page.locator("#toolbar .morse-now").evaluate(e => getComputedStyle(e).fontSize);
const ui = (page, sel) => page.locator(`[data-morse-ui] ${sel}`);

test("refine a result, step back with Ctrl+Z, keep, restore from History, refine from the panel", { skip }, async () => {
  const { ctx, page, errors, waitFor } = await playground();
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.keyboard.type("add a now playing label to the toolbar");
  await page.keyboard.press("Enter");
  let s = await waitFor(s => s.phase === "result");
  assert.equal(await page.locator("#toolbar .morse-now").count(), 1);
  assert.equal(await fontSize(page), "14px");
  // The input stays usable for a follow-up.
  assert.equal(await ui(page, ".in").getAttribute("placeholder"), "Describe what to change…");
  assert.equal(await ui(page, ".in").isEnabled(), true);
  assert.equal(s.focus, "in");

  await page.keyboard.type("make it smaller");
  await page.keyboard.press("Enter");
  s = await waitFor(s => s.phase === "result" && /version 2/.test(s.hint));
  assert.equal(s.input, "", "the follow-up is cleared once it's done");
  assert.equal(await page.locator("#toolbar .morse-now").count(), 1, "the new code replaced the old one");
  assert.equal(await fontSize(page), "11px");

  await page.keyboard.type("use icons instead");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result" && /version 3/.test(s.hint));
  assert.equal(await page.locator("#toolbar .morse-now").textContent(), "♪ Blue in Green");

  // Ctrl+Z: one version back.
  await page.keyboard.press("Control+z");
  await waitFor(s => /Back to version 2/.test(s.hint));
  assert.equal(await page.locator("#toolbar .morse-now").textContent(), "Now playing Blue in Green");
  assert.equal(await fontSize(page), "11px");
  // dogfood: Ctrl+Shift+Z (and Ctrl+Y) forward again: the newer version isn't lost.
  await page.keyboard.press("Control+Shift+z");
  await waitFor(s => /Forward to version 3/.test(s.hint));
  assert.equal(await page.locator("#toolbar .morse-now").textContent(), "♪ Blue in Green");
  await page.keyboard.press("Control+Shift+z"); // nothing further ahead: stays
  await page.keyboard.press("Control+z");
  await waitFor(s => /Back to version 2/.test(s.hint));
  await page.keyboard.press("Control+y");
  await waitFor(s => /Forward to version 3/.test(s.hint));
  await page.keyboard.press("Control+z");
  await waitFor(s => /Back to version 2/.test(s.hint));
  assert.equal(await page.locator("#toolbar .morse-now").textContent(), "Now playing Blue in Green");

  // Enter on an empty input keeps the latest.
  await page.keyboard.press("Enter");
  await waitFor(s => !s.open);
  let [mod] = await saved(page);
  assert.equal(mod.prompt, "add a now playing label to the toolbar", "the mod keeps its original request");
  assert.equal(mod.refined, "make it smaller");
  assert.equal(mod.history.length, 1);
  assert.equal(mod.history[0].prompt, "add a now playing label to the toolbar");
  assert.match(mod.css, /font-size: 11px/);

  // History in the panel: click version 1 to bring it back.
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(page, ".panel article").waitFor();
  assert.match(await ui(page, ".panel article .when").textContent(), /just now/);
  await ui(page, ".panel [data-a=history]").click();
  const versions = ui(page, ".panel .versions li");
  assert.equal(await versions.count(), 2);
  assert.match(await versions.nth(0).textContent(), /make it smaller.*showing now/);
  assert.match(await versions.nth(1).textContent(), /now playing label.*just now/);
  await ui(page, ".panel [data-a=restore][data-v='0']").click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#toolbar .morse-now")).fontSize === "14px");
  [mod] = await saved(page);
  assert.equal(mod.history.length, 2, "restoring keeps the version it replaced");
  assert.equal(mod.refined, undefined);
  assert.equal(await ui(page, ".panel .versions li").count(), 3);

  // It survives a reload.
  await page.reload();
  await waitForReady(page);
  await page.waitForFunction(() => document.querySelector("#toolbar .morse-now"));
  assert.equal(await fontSize(page), "14px");

  // Refine from the panel: Enter on a row opens the bar on that mod.
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(page, ".panel article").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.tagName === "ARTICLE", null, { timeout: 5000 }); // the panel takes focus on its first row
  await page.keyboard.press("Enter");
  s = await waitFor(s => s.open && s.phase === "result");
  assert.equal(await ui(page, ".panel").isHidden(), true);
  assert.match(s.hint, /Now playing label/);
  await page.keyboard.type("make it bigger");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result" && /version 4/.test(s.hint));
  assert.equal(await fontSize(page), "18px");
  // Stopping a refine puts back the version you had. A slower replay keeps it
  // streaming until Esc lands, however busy the machine is.
  await page.evaluate(() => { window.__demoMs = 80; });
  await page.keyboard.type("make it smaller");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "working" && /Writing/.test(s.hint));
  await page.keyboard.press("Escape");
  s = await waitFor(s => s.phase === "result" && /Stopped/.test(s.hint));
  assert.equal(s.input, "make it smaller", "the follow-up stays in the input");
  assert.equal(await fontSize(page), "18px");
  assert.equal(await page.locator("#toolbar .morse-now").count(), 1);
  await page.keyboard.press("Escape"); // closing keeps it
  await waitFor(s => !s.open);
  [mod] = await saved(page);
  assert.equal(mod.history.length, 3);
  assert.equal(mod.refined, "make it bigger");
  assert.equal(await page.locator("#toolbar .morse-now").count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Dogfood: Esc on a result keeps it, on purpose, but the plain “Saved” toast
// didn't say that Esc was what kept it, or how to take it back.
test("Esc on a result keeps it and says so, with Undo right there", { skip }, async () => {
  const { ctx, page, errors, waitFor } = await playground();
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.keyboard.type("add a now playing label to the toolbar");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result");
  await page.keyboard.press("Escape");
  await waitFor(s => !s.open);
  const toast = ui(page, ".ctl-toast");
  await toast.waitFor();
  assert.match(await toast.textContent(), /Saved “Now playing label”\. Closing the bar saves a change\./);
  assert.equal((await saved(page)).length, 1, "it is kept");
  assert.equal(await page.locator("#toolbar .morse-now").count(), 1);
  await ui(page, ".ctl-toast .ctl-acts button", { hasText: "Undo" }).click();
  await page.waitForFunction(() => !document.querySelector("#toolbar .morse-now"));
  assert.deepEqual(await saved(page), [], "Undo takes it out");
  // Save (Enter) is a choice the person made: the usual toast, no Undo.
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.keyboard.type("add a now playing label to the toolbar");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result");
  await page.keyboard.press("Enter");
  await waitFor(s => !s.open);
  assert.equal(await ui(page, ".ctl-toast").isHidden(), true);
  assert.match(await ui(page, ".toast").textContent(), /Saved “Now playing label”/);
  // A follow-up on a saved change, closed with Esc: Undo goes back to the saved version.
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(page, ".panel article").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.tagName === "ARTICLE", null, { timeout: 5000 });
  await page.keyboard.press("Enter");
  await waitFor(s => s.open && s.phase === "result");
  await page.keyboard.type("make it bigger");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result" && /version 2/.test(s.hint));
  assert.equal(await fontSize(page), "18px");
  await page.keyboard.press("Escape");
  await waitFor(s => !s.open);
  await toast.waitFor();
  assert.match(await toast.textContent(), /Saved “Now playing label”/);
  assert.equal((await saved(page))[0].history.length, 1);
  await ui(page, ".ctl-toast .ctl-acts button", { hasText: "Undo" }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#toolbar .morse-now")).fontSize === "14px");
  const [mod] = await saved(page);
  assert.equal(mod.history?.length || 0, 0, "back to the saved version");
  assert.equal(mod.refined, undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

const now = new Date().toISOString();
const seed =(id, title, prompt, js, extra = {}) => ({ morse: 1, id, title, prompt, match: { hosts: ["morse.test"], app: null }, target: null, css: "", js, enabled: true, model: "demo", created: now, updated: now, ...extra });

test("a saved mod that stopped working says why, and Fix it repairs it", { skip }, async () => {
  const mods = {
    gone: seed("gone", "Now playing label", "add a now playing label to the toolbar",
      `morse.watch("#player-bar", bar => bar.append(morse.el("span", { class: "morse-now", text: "Now playing" })));`),
    oops: seed("oops", "Track count", "show the track count", `nowPlaying.textContent = "3 tracks";`),
  };
  const { ctx, page, errors, waitFor } = await playground({ mods });
  // Record the panel's health checks (the "stats" requests) and when the host answered them.
  await page.evaluate(() => {
    const host = globalThis.__morseHost, send = host.send.bind(host), asked = new Map();
    window.__checked = [];
    host.send = m => { if (m.type === "stats") asked.set(m.id, m.modId); return send(m); };
    host.onMessage(m => { if (asked.has(m.reply)) window.__checked.push({ modId: asked.get(m.reply), at: Date.now() }); });
  });
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(page, ".panel article").first().waitFor();
  // A mod that throws is flagged right away, in plain words.
  const oops = ui(page, ".panel article[data-id=oops] .health");
  await oops.waitFor();
  assert.match(await oops.textContent(), /Not working\. It uses something this page doesn't have\./);
  // One whose selectors match nothing is flagged after 5 seconds.
  const gone = ui(page, ".panel article[data-id=gone] .health");
  await gone.waitFor({ timeout: TIMEOUT });
  assert.match(await gone.textContent(), /It looks for a part of the page that isn't there right now\./);

  const fixedAt = await page.evaluate(() => Date.now());
  await gone.locator("[data-a=fix]").click();
  let s = await waitFor(s => s.open && s.phase === "result" && /version 2/.test(s.hint));
  assert.equal(await page.locator("#toolbar .morse-now").count(), 1, "the fixed code finds the toolbar");
  await page.keyboard.press("Enter"); // keep
  await waitFor(s => !s.open);
  const mod = (await saved(page)).find(m => m.id === "gone");
  assert.equal(mod.refined, "Fixed it so it works again");
  assert.equal(mod.history.length, 1);
  assert.match(mod.history[0].js, /#player-bar/);
  assert.match(mod.js, /#toolbar/);

  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(page, ".panel article[data-id=gone]").waitFor();
  // The fixed code's own 5s health check has run and been answered.
  await page.waitForFunction(t => window.__checked.some(c => c.modId === "gone" && c.at > t), fixedAt, { timeout: TIMEOUT });
  await settle(page);
  assert.equal(await ui(page, ".panel article[data-id=gone] .health").count(), 0, "fixed: no warning");
  assert.equal(await ui(page, ".panel article[data-id=oops] .health").count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// dogfood: on GitLab the mouse chose a link in one row of the file list, and
// nothing let a person choose the list itself.
test("pointing: Alt+Up chooses the bigger part around what the mouse chose, and the hint says so", { skip }, async () => {
  const { ctx, page, errors, waitFor } = await playground();
  await pressOpen(page);
  await waitFor(s => s.open);
  const b = await page.locator("#toolbar button").nth(2).boundingBox();
  await page.mouse.move(b.x + b.width / 2 - 10, b.y + b.height / 2);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.waitForTimeout(300);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const chip = () => ui(page, ".chip.target span").textContent();
  await page.waitForFunction(() => !document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".chip.target").hidden);
  const first = await chip();
  assert.match(await ui(page, ".hint").textContent(), /Alt\+↑ bigger part/);
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForFunction(f => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".chip.target span").textContent !== f, first);
  assert.match(await chip(), /toolbar|Toolbar/i, `${first} → ${await chip()}`);
  assert.equal((await waitFor(s => s.open)).focus, "in", "typing still goes to the bar");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("panel: search past six mods, arrows, Space toggles, Copy link", { skip }, async () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  const mods = Object.fromEntries(names.map((n, i) => [`m${i}`, seed(`m${i}`, `${n} tweak`, `make the ${n.toLowerCase()} part nicer`, "", { css: `#card { --x: ${i}; }` })]));
  const { ctx, page, errors } = await playground({ mods });
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(page, ".panel article").first().waitFor();
  assert.equal(await ui(page, ".panel article").count(), 8);
  const search = ui(page, ".panel .search");
  assert.equal(await search.getAttribute("placeholder"), "Search 8 mods");
  // Typing on a row jumps to search.
  await page.keyboard.type("golf");
  assert.equal(await search.inputValue(), "golf");
  assert.equal(await ui(page, ".panel article").count(), 1);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  assert.equal(await ui(page, ".panel article").count(), 8);
  const focused = () => page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.dataset?.id);
  await page.keyboard.press("ArrowDown");
  assert.equal(await focused(), "m0");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await focused(), "m2");
  await page.keyboard.press("ArrowUp");
  assert.equal(await focused(), "m1");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("morse:playground:mods")).m1.enabled === false);
  await ui(page, ".panel article.off[data-id=m1]").waitFor();
  assert.equal(await focused(), "m1", "focus stays on the row");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("morse:playground:mods")).m1.enabled === true);

  // http://morse.test is not a secure context, so there's no clipboard API: stand one in.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async t => { window.__copied = t; } } }));
  await ui(page, ".panel article[data-id=m3] .rmore summary").click(); // Copy link is under the row's More (docs/dev/simplify.md)
  await ui(page, ".panel article[data-id=m3] [data-a=link]").click();
  await page.waitForFunction(() => /Copied/.test(document.querySelector("[data-morse-ui]").shadowRoot.querySelector("article[data-id=m3] [data-a=link]").textContent));
  const link = await page.evaluate(() => window.__copied);
  assert.match(link, /install\.html#m=/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
