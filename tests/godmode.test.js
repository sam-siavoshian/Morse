// God mode end to end in real Chromium: the real runtime on demo/playground.html
// (its fake host persists mods in localStorage and runs mod JS through the
// real helper kit). Hide, move, rename, recolor, undo/redo, dark mode, then a
// reload must bring every saved edit back.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
let browser;

before(async () => { if (!skip) browser = await chromium.launch(); });
after(() => browser?.close());

async function playground(query = "?light") {
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
  await page.goto(`${ORIGIN}/demo/playground.html${query}`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  return { ctx, page, errors };
}
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { if (Date.now() > end) throw e; }
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + fn);
    await new Promise(r => setTimeout(r, 50));
  }
}
const style = (page, sel, prop) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e)[p], prop);
async function select(page, sel, dx = 12, dy = 8) {
  const r = await page.locator(sel).first().boundingBox();
  await page.mouse.move(r.x + dx, r.y + dy);
  await page.mouse.click(r.x + dx, r.y + dy);
  await until(() => page.locator(".gm-tb").isVisible());
  await page.keyboard.press("Control+e"); // focus the toolbar; typing otherwise goes to the bar
}
const savedMods = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")));

test("hide, move, rename, recolor and dark mode apply live, undo, save, and come back after a reload", { skip }, async () => {
  const { ctx, page, errors } = await playground("?light");
  await page.keyboard.press("Alt+Space");

  // Rename: T edits the text in place, Enter keeps it.
  await select(page, "#card h3");
  assert.equal(await page.locator(".gm-tag").textContent(), "h3");
  await page.keyboard.press("t");
  await page.keyboard.type("What's new");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#card h3").textContent(), "What's new");

  // Hide: H.
  await select(page, "#toolbar button >> nth=1", 6, 6);
  await page.keyboard.press("h");
  await until(async () => (await style(page, "#toolbar button >> nth=1", "display")) === "none");

  // Move: M, then drag the selection (Shift locks the axis).
  await select(page, "#card", 400, 160);
  await page.keyboard.press("m");
  const c = await page.locator("#card").boundingBox();
  await page.mouse.move(c.x + 400, c.y + 160);
  await page.mouse.down();
  await page.mouse.move(c.x + 440, c.y + 166, { steps: 4 });
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x + 448, c.y + 168, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  assert.equal(await style(page, "#card", "transform"), "matrix(1, 0, 0, 1, 48, 0)");
  await page.keyboard.press("ArrowDown"); // nudge 1px
  await until(async () => (await style(page, "#card", "transform")) === "matrix(1, 0, 0, 1, 48, 1)");
  await page.keyboard.press("Escape");

  // Recolor: C opens the palette; undo and redo it.
  await select(page, "#card p");
  await page.keyboard.press("c");
  await page.locator(".gm-sw button[data-c='#3b82f6']").click();
  assert.equal(await style(page, "#card p", "color"), "rgb(59, 130, 246)");
  await page.keyboard.press("Escape"); // closes the popover, not the bar
  assert.ok(await page.locator(".bar").isVisible());
  await page.keyboard.press("Control+z");
  await until(async () => (await style(page, "#card p", "color")) !== "rgb(59, 130, 246)");
  await page.keyboard.press("Control+Shift+z");
  await until(async () => (await style(page, "#card p", "color")) === "rgb(59, 130, 246)");

  // Anything that isn't a shortcut goes to the bar ("just start typing").
  await select(page, "#card h3");
  await page.keyboard.type("bigger");
  assert.equal(await page.locator(".in").inputValue(), "bigger");
  await page.locator(".in").fill("");

  // Dark mode from the quick menu.
  await page.locator(".gm-qbtn").click();
  await page.locator(".gm-menu button[data-k=dark]").click();
  await until(async () => /invert\(0\.93\)/.test(await style(page, "html", "filter")));

  // Esc closes the bar and flushes the session's save.
  await page.keyboard.press("Escape");
  await until(async () => (await savedMods(page)).length === 2);
  const mods = await savedMods(page);
  const manual = mods.find(m => m.kind === "manual");
  assert.equal(manual.title, "Direct edits");
  assert.deepEqual([...new Set(manual.edits.map(e => e.op))].sort(), ["hide", "move", "style", "text"]);
  assert.match(manual.prompt, /Renamed “Release notes” → “What's new”/);
  assert.equal(mods.find(m => m.kind === "quick").title, "Dark mode");

  // Reload: everything comes back from the saved mods alone.
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  await until(async () => (await page.locator("#card h3").textContent()) === "What's new");
  assert.equal(await style(page, "#toolbar button >> nth=1", "display"), "none");
  assert.equal(await style(page, "#card", "transform"), "matrix(1, 0, 0, 1, 48, 1)");
  assert.equal(await style(page, "#card p", "color"), "rgb(59, 130, 246)");
  await until(async () => /invert\(0\.93\)/.test(await style(page, "html", "filter")));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("edge cases: shadow DOM, mixed inline text, frames, duplicates, and dark pages", { skip }, async () => {
  const { ctx, page, errors } = await playground("");
  await page.keyboard.press("Alt+Space");

  // Inside an open shadow root: the edit carries the host chain.
  await select(page, "#badge", 20, 8);
  assert.equal(await page.locator(".gm-tag").textContent(), "span.label");
  await page.keyboard.press("t");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Inside");
  await page.keyboard.press("Enter");
  await page.keyboard.press("c");
  await page.locator(".gm-sw button[data-c='#ef4444']").click();
  const label = () => page.evaluate(() => { const l = document.querySelector("#badge").shadowRoot.querySelector(".label"); return [l.textContent, getComputedStyle(l).color]; });
  await until(async () => (await label())[1] === "rgb(239, 68, 68)");
  assert.equal((await label())[0], "Inside");
  await page.keyboard.press("Escape");

  // Mixed inline text: only the run under the pointer changes; <b> survives.
  await select(page, "#mixed", 6, 8);
  await page.keyboard.press("t");
  await page.keyboard.type("Hit");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#mixed").innerHTML(), "Hit <b>Alt+Space</b> to start");
  // The app re-renders: the text comes back in place, and a brand-new element gets it too.
  await until(async () => (await savedMods(page)).some(m => m.js.includes('"Hit"')));
  await page.evaluate(() => { document.querySelector("#mixed").firstChild.nodeValue = "Press "; });
  await until(async () => (await page.locator("#mixed").innerHTML()) === "Hit <b>Alt+Space</b> to start");
  await page.evaluate(() => { const m = document.querySelector("#mixed"), n = m.cloneNode(false); n.innerHTML = "Press <b>Alt+Space</b> to start"; m.replaceWith(n); });
  await until(async () => (await page.locator("#mixed").innerHTML()) === "Hit <b>Alt+Space</b> to start");

  // Frames: selectable, but only from the outside.
  const f = await page.locator("iframe").boundingBox();
  await page.mouse.move(f.x + 30, f.y + 20, { steps: 3 });
  await page.mouse.click(f.x + 30, f.y + 20);
  await until(() => page.locator(".gm-note").isVisible());
  assert.match(await page.locator(".gm-note").textContent(), /can't edit what's inside/);
  assert.ok(await page.locator(".gm-tb button[data-t=text]").isDisabled());
  assert.ok(!(await page.locator(".gm-tb button[data-t=hide]").isDisabled()));

  // Duplicate selects the copy, which can then be moved on its own.
  await select(page, "#card h3");
  await page.keyboard.press("d");
  await until(async () => (await page.locator("[data-morse-dup]").count()) === 1);
  await until(async () => /data-morse-dup/.test(await page.locator(".gm-tag").getAttribute("title")));
  await page.keyboard.press("Shift+ArrowRight");
  await until(async () => (await style(page, "[data-morse-dup]", "transform")) === "matrix(1, 0, 0, 1, 10, 0)");
  assert.equal(await style(page, "#card h3", "transform"), "none");

  // The playground is dark by default, so Dark mode leaves it alone.
  await page.keyboard.press("Escape");
  await page.locator(".gm-qbtn").click();
  await page.locator(".gm-menu button[data-k=dark]").click();
  await page.waitForTimeout(300);
  assert.equal(await style(page, "html", "filter"), "none");
  assert.equal((await savedMods(page)).filter(m => m.kind === "quick").length, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
