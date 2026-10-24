// Guards: mods can't freeze, slow down or break the page they run in.
//   - core/guard.js: code that obviously breaks the page is found before it runs
//   - core/engine.js: such a draft never runs; the model gets one repair round
//   - core/kit.js (in real Chromium): budgets per mod, a minimum interval,
//     a mod's own changes never feed back into it, an element cap, quiet errors
// The end-to-end checks (a page with bad mods stays usable, the mod is paused,
// the Mods panel says why, a frozen desktop page recovers) are in guard-ui.test.js.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { noBrowser as skip, launchBrowser } from "./helpers/browser.js";
import { cssHidesPage, draftHarm } from "../core/guard.js";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";
import { stripLocal } from "../core/mod.js";

// ---------------------------------------------------------------- static checks

test("CSS that hides, blanks or locks the whole page is found", () => {
  assert.equal(cssHidesPage("* { display: none !important }"), "* { display: none }");
  assert.equal(cssHidesPage("body { pointer-events: none }"), "body { pointer-events: none }");
  assert.equal(cssHidesPage("html, .x { opacity: 0 }"), "html { opacity: 0 }");
  assert.equal(cssHidesPage("@media (min-width: 1px) { :root { visibility: hidden } }"), ":root { visibility: hidden }");
  assert.equal(cssHidesPage("body * { display:none }"), "body * { display: none }");
  assert.equal(cssHidesPage("*:not(video) { display: none }"), "*:not(video) { display: none }");
  assert.equal(cssHidesPage("/* body { display: none } */ .ad { display: none }"), "", "comments don't count");
  assert.equal(cssHidesPage(".sidebar, nav { display: none }"), "", "hiding parts of the page is fine");
  assert.equal(cssHidesPage("body > * { display: none } body > main { display: block }"), "", "a focus mode keeps its content");
  assert.equal(cssHidesPage("body::before { display: none }"), "");
  assert.equal(cssHidesPage("body { opacity: .5 }"), "");
  // visibility and pointer-events can be turned back on lower down
  assert.equal(cssHidesPage("body * { visibility: hidden } .player, .player * { visibility: visible }"), "");
  assert.equal(cssHidesPage("body { pointer-events: none } dialog { pointer-events: auto }"), "");
});

test("JS that would freeze, reload, wipe or hide the page is found", () => {
  const kind = (js, request = "") => draftHarm({ js }, request)?.kind || null;
  assert.equal(kind("while (true) { tick(); }"), "loop");
  assert.equal(kind("while(1);"), "loop");
  assert.equal(kind("for (;;) {}"), "loop");
  assert.equal(kind("for (let i = 0; ; i++) { el.append(i) }"), "loop");
  assert.equal(kind("do { x++ } while (true)"), "loop");
  assert.equal(kind("if (a) { b() }\nwhile (true) { c() }"), "loop");
  assert.equal(kind("while (true) { if (done()) break; }"), null);
  assert.equal(kind("while (true) { const x = next(); if (!x) return; }"), null);
  assert.equal(kind("async function poll() { while (true) { await wait(1000); check(); } }"), null);
  assert.equal(kind("for (let i = 0; i < 3; i++) {}"), null);
  assert.equal(kind("const s = 'while (true) {}'; // while(true){}"), null, "strings and comments aren't code");

  assert.equal(kind("location.reload()"), "nav");
  assert.equal(kind("window.location.href = '/inbox'"), "nav");
  assert.equal(kind("location = '/x'"), "nav");
  assert.equal(kind("location.reload()", "reload the page every 5 minutes"), null, "asked for");
  assert.equal(kind("morse.on(btn, 'click', () => location.href = '/settings')", "add a button that opens settings"), null);
  assert.equal(kind("const here = location.href; if (here === '/') go();"), null, "reading it is fine");
  assert.equal(kind("item.location = 'Berlin'"), null);

  assert.equal(kind("document.body.innerHTML = ''"), "wipe");
  assert.equal(kind("document.write('<p>hi</p>')"), "wipe");
  assert.equal(kind("document.body.style.display = 'none'"), "hide");
  assert.equal(kind("document.body.style.pointerEvents = \"none\";"), "hide");
  assert.equal(kind("morse.css(`* { display: none }`)"), "hide");
  assert.equal(kind("morse.css('.ad { display: none }')"), null);
  assert.equal(draftHarm({ css: "* { display:none }" }).kind, "hide");

  const loop = draftHarm({ js: "while (true) {}" });
  assert.match(loop.model, /`while \(true\)` with no break/);
  assert.match(loop.model, /morse\.watch/);
  assert.equal(loop.user, "The change would have frozen this page, so Morse didn't run it. Try other words.");
});

test("engine: a draft that would break the page never runs; the model gets one plain repair round", async () => {
  const replies = [
    "TITLE: Hide\n```css\n* { display: none !important }\n```\n```js\nwhile (true) {}\n```",
    "TITLE: Hide ads\n```css\n.ad { display: none !important }\n```",
  ];
  const prompts = [], csses = [], ran = [];
  registerProvider("guard-script", async (s, messages, { onToken }) => {
    prompts.push(messages.at(-1).content);
    const r = replies.shift();
    for (const ch of r.match(/[\s\S]{1,7}/g)) onToken(ch); // streams, like a model
    return r;
  });
  const res = await runMorse({
    settings: { provider: "guard-script" }, request: "hide the ads", context: { url: "x", title: "x" },
    emit: e => { if (e.type === "css") csses.push(e.css); }, exec: async js => { ran.push(js); return { ok: true }; },
  });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.match(prompts[1], /Your CSS hides the whole page \(`\* \{ display: none \}`\)/);
  assert.ok(csses.every(c => !/\*\s*\{/.test(c)), "the page-hiding rule was never shown, not even while streaming");
  assert.deepEqual(ran, [], "nothing ran: the first draft was refused, the second is CSS only");
  assert.equal(res.css.trim(), ".ad { display: none !important }");
});

test("engine: still harmful after the second try: nothing is applied and the person reads why", async () => {
  registerProvider("guard-bad", async (s, m, { onToken }) => { const r = "TITLE: Go\n```js\nlocation.reload();\n```"; onToken(r); return r; });
  const ran = [];
  const res = await runMorse({
    settings: { provider: "guard-bad" }, request: "make the header blue", context: { url: "x", title: "x" },
    emit: () => {}, exec: async js => { ran.push(js); return { ok: true }; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "The change would have reloaded or left this page, so Morse didn't run it. Try other words.");
  assert.equal(res.js, "");
  assert.deepEqual(ran, []);
});

test("share links don't carry a mod's paused state", () => {
  const out = stripLocal({ id: "a", title: "t", paused: { why: "slow" }, guardOk: "x", enabled: false });
  assert.equal(out.paused, undefined);
  assert.equal(out.guardOk, undefined);
});

// ---------------------------------------------------------------- the kit, in Chromium

let browser;
before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

// A fresh page with the kit, the given HTML, and a log of "morse:paused" events.
async function kitPage(html = "", limits = {}) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><body>${html}</body>`);
  await page.evaluate(KIT_SOURCE);
  await page.evaluate(l => {
    Object.assign(morse.__limits, l);
    window.__paused = [];
    document.addEventListener("morse:paused", e => __paused.push(JSON.parse(e.detail)));
  }, limits);
  const run = (id, js) => page.evaluate(wrapModCode(id, js));
  // How long the page takes to answer: a task queued now, run when?
  const lag = () => page.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(performance.now() - t), 0); }));
  return { page, run, lag };
}

test("every() and setInterval run at most every 100ms; off stops every timer, frame and observer", { skip }, async () => {
  const { page, run } = await kitPage();
  await run("t", `
    window.n = { every: 0, raw: 0, timeout: 0, frame: 0, mo: 0 };
    morse.every(0, () => n.every++);
    setInterval(() => n.raw++, 1);
    const again = () => { n.timeout++; setTimeout(again, 20); }; again();
    const frame = () => { n.frame++; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    new MutationObserver(() => n.mo++).observe(document.body, { childList: true });
  `);
  await page.waitForTimeout(550);
  const n = await page.evaluate(() => ({ ...n }));
  assert.ok(n.every >= 3 && n.every <= 6, `every(0) ran ${n.every} times in 550ms`);
  assert.ok(n.raw >= 3 && n.raw <= 6, `setInterval(fn, 1) ran ${n.raw} times in 550ms`);
  assert.ok(n.timeout > 5 && n.frame > 5, "timeouts and frames are untouched");
  await page.evaluate(() => { morse.__off("t"); document.body.append(document.createElement("p")); });
  const at = await page.evaluate(() => ({ ...n }));
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => ({ ...n })), at, "nothing of the mod runs after it's off");
  await page.close();
});

test("a mod's own changes never feed back into it", { skip }, async () => {
  const { page, run, lag } = await kitPage(`<ul id="l"><li class="i">a</li><li class="i">b</li></ul><p id="ticker"></p>`);
  // A classic loop: an observer that changes what it observes. Without the
  // guard this never yields (a microtask loop) and the page freezes.
  await run("fb", `
    window.calls = 0;
    new MutationObserver(() => { calls++; document.querySelectorAll(".i").forEach(li => li.dataset.n = calls); })
      .observe(document.body, { subtree: true, attributes: true, childList: true });
    // and a watch whose callback adds what it watches
    window.seen = 0;
    morse.watch(".i", li => { seen++; li.after(Object.assign(document.createElement("li"), { className: "i", textContent: "copy" })); });
  `);
  // The page keeps changing on its own, which the mod does see.
  await page.evaluate(() => { let k = 0; window.tick = setInterval(() => { document.getElementById("ticker").textContent = ++k; }, 50); });
  await page.waitForTimeout(400);
  assert.ok(await lag() < 100, "the page still answers");
  const { calls, seen, items } = await page.evaluate(() => ({ calls, seen, items: document.querySelectorAll(".i").length }));
  assert.ok(calls >= 2 && calls < 30, `the observer ran ${calls} times (once per page change, not in a loop)`);
  assert.equal(seen, 2, "the copies the watch added didn't run it again");
  assert.equal(items, 4);
  assert.deepEqual(await page.evaluate(() => __paused), [], "nothing to pause: there is no loop");
  await page.close();
});

test("a heavy watch is paused for slowing the page down, with why in __stats and __errors", { skip }, async () => {
  const { page, run, lag } = await kitPage(`<ul id="l"></ul>`, { BUSY_SECS: 2 });
  await run("heavy", `morse.watch("#l li", li => { const t = performance.now(); while (performance.now() - t < 30) {} li.classList.add("done"); });`);
  // A live feed: a new item every 60ms.
  await page.evaluate(() => setInterval(() => document.getElementById("l").append(document.createElement("li")), 60));
  await page.waitForFunction(() => __paused.length, null, { timeout: 6000 });
  assert.deepEqual(await page.evaluate(() => __paused), [{ id: "heavy", why: "slow" }]);
  const st = await page.evaluate(() => morse.__stats("heavy"));
  assert.equal(st.paused.why, "slow");
  assert.match(st.paused.error, /^Morse paused it because its callbacks kept the page busy over 200 ms of every second/);
  assert.ok(st.paused.ms > 400, `its code took ${st.paused.ms}ms in all`);
  assert.match((await page.evaluate(() => morse.__errors("heavy")))[0], /^Morse paused it/);
  const done = await page.locator("#l li.done").count();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#l li.done").count(), done, "it no longer runs");
  assert.ok(await lag() < 50, "the page is fast again");
  await page.close();
});

test("one burst over a second is paused at once", { skip }, async () => {
  const { page, run } = await kitPage(`<button id="b">b</button>`);
  await run("burst", `morse.on(document.getElementById("b"), "click", () => { const t = performance.now(); while (performance.now() - t < 1100) {} });`);
  await page.click("#b");
  assert.deepEqual(await page.evaluate(() => __paused), [{ id: "burst", why: "slow" }]);
  await page.close();
});

test("a feedback loop through the page (a framework re-rendering what the mod changes) is paused", { skip }, async () => {
  const { page, run, lag } = await kitPage(`<ul id="l"></ul>`, { FLOOD_SECS: 2 });
  await page.evaluate(() => {
    const l = document.getElementById("l");
    const render = () => { l.innerHTML = Array.from({ length: 40 }, (_, i) => `<li class="item">${i}</li>`).join(""); };
    render();
    new MutationObserver(recs => { if (recs.some(r => r.target.classList?.contains("item"))) render(); }).observe(l, { subtree: true, attributes: true });
  });
  await run("flood", `morse.watch(".item", el => el.setAttribute("data-seen", ""));`);
  await page.waitForFunction(() => __paused.length, null, { timeout: 8000 });
  assert.deepEqual(await page.evaluate(() => __paused), [{ id: "flood", why: "loop" }]);
  assert.match((await page.evaluate(() => morse.__stats("flood"))).paused.error, /the page keeps rebuilding what the code changes/);
  assert.ok(await lag() < 50);
  await page.close();
});

test("an observer looping through a promise is paused before it can freeze the page", { skip }, async () => {
  const { page, run, lag } = await kitPage(`<p id="p">0</p>`);
  await run("mo", `
    const p = document.getElementById("p");
    new MutationObserver(() => Promise.resolve().then(() => { p.dataset.n = +(p.dataset.n || 0) + 1; }))
      .observe(p, { attributes: true });
  `);
  // The page touches it once; the mod's promise then changes it after its
  // callback has returned, so it isn't the mod's own change any more.
  await page.evaluate(() => { document.getElementById("p").dataset.n = 1; });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => __paused), [{ id: "mo", why: "loop" }]);
  assert.ok(await lag() < 50, "the page answers");
  await page.close();
});

test("huge insertions: past the element cap the mod is paused and what it added is gone", { skip }, async () => {
  const { page, run } = await kitPage(`<main></main>`);
  const r = await run("big", `const m = document.querySelector("main"); for (let i = 0; i < 100000; i++) m.append(morse.el("div", { text: i }));`);
  assert.equal(r.ok, false);
  assert.match(r.error, /^Morse paused it because it added 20001 elements to the page in one second/);
  assert.deepEqual(await page.evaluate(() => __paused), [{ id: "big", why: "big" }]);
  assert.equal(await page.locator("main div").count(), 0, "everything it made was removed");
  // Elements its callbacks insert any other way count too (while the kit watches the page).
  const r2 = await run("big2", `morse.watch("main", () => {}); morse.every(100, () => { document.querySelector("main").insertAdjacentHTML("beforeend", "<div></div>".repeat(25000)); });`);
  assert.equal(r2.ok, true);
  await page.waitForFunction(() => __paused.length === 2, null, { timeout: 3000 });
  assert.equal((await page.evaluate(() => __paused))[1].why, "big");
  await page.close();
});

test("errors: the console hears the first few, __stats counts them all", { skip }, async () => {
  const { page, run } = await kitPage(`<button id="b">b</button>`);
  const warnings = [];
  page.on("console", m => { if (m.type() === "warning") warnings.push(m.text()); });
  await run("err", `morse.on(document.getElementById("b"), "click", () => { throw new Error("nope"); });`);
  for (let i = 0; i < 30; i++) await page.click("#b");
  await page.waitForTimeout(50);
  assert.equal(warnings.length, 4, "three errors and one note that it keeps failing");
  assert.match(warnings[3], /keeps failing/);
  const st = await page.evaluate(() => morse.__stats("err"));
  assert.equal(st.errors, 30);
  assert.equal(await page.evaluate(() => morse.__errors("err").length), 3);
  await page.close();
});

test("time per mod is measured; mod code can still declare the names the kit guards", { skip }, async () => {
  const { page, run } = await kitPage(`<p>x</p>`);
  const r = await run("ms", `const setTimeout = 1; let MutationObserver = 2; morse.watch("p", () => { const t = performance.now(); while (performance.now() - t < 20) {} });`);
  assert.deepEqual(r, { ok: true });
  const st = await page.evaluate(() => morse.__stats("ms"));
  assert.ok(st.ms >= 20 && st.ms < 200, `measured ${st.ms}ms`);
  await page.close();
});

test("__hung names the mod whose code was running and stops it", { skip }, async () => {
  const { page, run } = await kitPage(`<button id="b">b</button>`);
  // As if the host had stopped this callback mid-loop and then asked (inside a
  // mod, `morse` is its helper object; the kit is globalThis.morse).
  await run("spin", `morse.on(document.getElementById("b"), "click", () => { window.hung = globalThis.morse.__hung(); });`);
  await page.click("#b");
  assert.equal(await page.evaluate(() => window.hung), "spin");
  assert.equal((await page.evaluate(() => morse.__stats("spin"))).paused.why, "froze");
  assert.equal(await page.evaluate(() => morse.__hung()), null, "outside any mod: nobody");
  await page.close();
});
