// Speed and reliability budgets, in real Chromium through the real desktop
// connector (CDP, the page's main world: the most exposed place Morse runs).
// demo/perf-lib.js counts every listener, observer, timer, layout read and
// element Morse creates by wrapping the page's built-ins.
//
// Budgets are counts wherever possible (they don't flake on a busy machine);
// the few timings are generous and compared against the full runtime.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, serve, desktop, payloads, sleep, mod, ONE_MOD, THIRTY_MODS, runGeneration } from "../demo/perf-lib.js";

const skip = !chromium && "playwright not installed";
let srv, D;
before(async () => { if (skip) return; srv = await serve(); D = await desktop(); });
after(async () => { await D?.close(); await srv?.close(); });

const perf = (page, fn = p => p) => page.evaluate(`(${fn})(window.__perf)`);
async function until(fn, ms = 6000, what = String(fn)) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(25);
  }
}
const modsListAfter = (page, t) => perf(page, `P => P.sends.some(s => s[0] === "mods.list" && s[1] >= ${t})`);
const total = o => Object.values(o || {}).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- speed

test("boot: the script every page loads is small and cheap next to the full runtime", { skip }, async () => {
  const pl = await payloads();
  assert.ok(pl.split, "the runtime is split into boot + UI");
  assert.ok(pl.boot.length < 40_000, `boot is ${pl.boot.length} bytes`);
  const ctx = await D.browser.newContext();
  const page = await ctx.newPage();
  await page.goto(srv.url("/perf/big.html"));
  const s = await ctx.newCDPSession(page);
  await s.send("Runtime.enable");
  // Compile + run on a fresh document, minus a no-op evaluate (the CDP round
  // trip); the best of several runs, since a busy machine only adds time.
  const runs = { noop: [], boot: [], full: [] };
  for (let i = 0; i < 7; i++) {
    for (const [k, src] of [["noop", "1"], ["boot", pl.boot], ["full", pl.full]]) {
      await page.reload();
      await page.evaluate(() => { globalThis.__morseHost = { send() {}, onMessage() {} }; });
      const t = process.hrtime.bigint();
      await s.send("Runtime.evaluate", { expression: `${src}\n//${Math.random()}` });
      runs[k].push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  }
  await ctx.close();
  const noop = Math.min(...runs.noop), boot = Math.min(...runs.boot) - noop, full = Math.min(...runs.full) - noop;
  assert.ok(boot < full * 0.35, `boot ${boot.toFixed(1)}ms vs full runtime ${full.toFixed(1)}ms`);
  assert.ok(boot < 15, `boot compile + run ${boot.toFixed(1)}ms`);
});

test("boot: until Morse is opened it builds no UI, reads no layout and runs nothing", { skip }, async () => {
  await D.setMods(ONE_MOD);
  const t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/big.html"));
    await until(() => perf(t.page, P => P.marks.js != null), 8000, "the mod to apply");
    await sleep(400);
    const s = await perf(t.page, P => P.snap());
    const c = k => s.counts[k] || 0;
    assert.equal(c("shadowRoot"), 0, "no overlay at boot");
    assert.equal(s.marks.ui, undefined, "nothing mounted");
    assert.equal(c("getComputedStyle"), 0, "no style reads (theme detection waits for opening)");
    assert.equal(c("layoutRead"), 0, "no layout reads");
    assert.equal(c("setInterval"), 0, "no polling");
    assert.ok(c("observer") <= 2, `observers: ${c("observer")} (boot's document watcher + the kit's shared one)`);
    const listeners = c("listen:window") + c("listen:document") + c("listen:node");
    assert.ok(listeners <= 8, `listeners: ${JSON.stringify(s.counts)}`);
    assert.ok(c("createElement") <= 3, `elements: ${c("createElement")}`);
    // Idle: nothing of Morse's runs at all.
    await perf(t.page, P => P.reset());
    await sleep(2000);
    const idle = await perf(t.page, P => P.snap());
    assert.equal(total(idle.calls), 0, `Morse callbacks while idle: ${JSON.stringify(idle.calls)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("open: the UI loads on first use, opens from the hotkey, and goes quiet when closed", { skip }, async () => {
  await D.setMods(ONE_MOD);
  const t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/big.html"));
    await until(() => perf(t.page, P => P.marks.js != null), 8000, "the mod to apply");
    await t.page.keyboard.press("Alt+Space");
    await until(() => perf(t.page, P => P.barVisible()), 8000, "the bar");
    assert.ok(await perf(t.page, P => P.sends.some(s => s[0] === "ui.load")), "the UI was requested from the host");
    await t.page.keyboard.press("Escape");
    await until(() => perf(t.page, P => !P.barVisible()), 4000, "the bar to close");
    await sleep(1200); // closing transitions, the hint announcer
    await perf(t.page, P => P.reset());
    await sleep(2000);
    const idle = await perf(t.page, P => P.snap());
    assert.equal(total(idle.calls), 0, `Morse callbacks with the bar closed: ${JSON.stringify(idle.calls)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("mods at scale: 30 watch mods share one observer and stay cheap on a streaming chat", { skip }, async () => {
  await D.setMods(THIRTY_MODS);
  const t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/chat.html"));
    await until(() => t.page.evaluate(() => document.querySelectorAll("style[data-morse-css]").length >= 30 && document.querySelector("[data-p0]") && document.querySelector("[data-p29]")), 6000, "all 30 mods");
    const s = await perf(t.page, P => P.snap());
    assert.ok((s.counts.observer || 0) <= 2, `observers: ${s.counts.observer}`);
    assert.equal(s.counts["observe:subtree"], 1, "one subtree observer for all 30 watches");
    await sleep(300);
    await perf(t.page, P => P.reset());
    await t.page.evaluate(() => window.__stream(2000));
    const run = await perf(t.page, P => P.snap());
    const ms = (run.ms.mo || 0) + (run.ms.raf || 0) + (run.ms.timeout || 0);
    assert.ok(ms / 2 < 25, `Morse spent ${(ms / 2).toFixed(1)} ms per second of streaming`);
    assert.ok((run.calls.raf || 0) <= 130, `rAF callbacks: ${run.calls.raf} (one batch per frame at most)`);
    // the newest message got every matching mod
    assert.ok(await t.page.evaluate(() => document.querySelector("#log > .msg:last-child").hasAttribute("data-p0")));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("SPA: every pushState navigation re-syncs mods, without a poll", { skip }, async () => {
  await D.setMods(ONE_MOD);
  const t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/spa.html"));
    await until(() => perf(t.page, P => P.marks.js != null), 8000, "the mod to apply");
    await sleep(700);
    await t.page.evaluate(() => { window.__perf.sends.length = 0; window.__perf.reset(); });
    await t.page.evaluate(() => window.__nav(8, 120));
    await sleep(500);
    const r = await t.page.evaluate(() => ({ navs: window.__navs.slice(-8), lists: window.__perf.sends.filter(s => s[0] === "mods.list").map(s => s[1]), counts: window.__perf.counts }));
    for (const n of r.navs) {
      const hit = r.lists.find(x => x >= n);
      assert.ok(hit != null && hit - n < 200, `navigation at ${n.toFixed(0)} noticed after ${hit == null ? "never" : (hit - n).toFixed(0) + "ms"}`);
    }
    assert.equal(r.counts.setInterval || 0, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("effect: a 4K target costs a few dozen draw calls per frame, and nothing once it ends", { skip }, async () => {
  await D.setMods([]);
  const t = await D.page({ viewport: { width: 3840, height: 2160 } });
  try {
    await t.page.goto(srv.url("/perf/effect.html"));
    await sleep(500);
    await runGeneration(t.page, { target: "#huge", prompt: "clean up the clutter" });
    const fxOn = () => perf(t.page, P => P.roots.some(r => r.querySelector(".fx")?.style.display === "block"));
    await until(fxOn, 10000, "the effect");
    await sleep(200);
    await perf(t.page, P => { P.reset(); P.countFrames(true); });
    await sleep(1200);
    const s = await perf(t.page, P => { P.countFrames(false); return P.snap(); });
    const frames = Math.max(1, s.calls.raf || 0);
    assert.ok(s.canvas.fills / frames <= 70, `${(s.canvas.fills / frames).toFixed(0)} draw calls per frame`);
    assert.ok(s.canvas.shapes / frames <= 6100, `${(s.canvas.shapes / frames).toFixed(0)} shapes per frame`);
    // With the result showing nothing animates: at most God mode's 5x/s check.
    await until(async () => !(await fxOn()), 30000, "the effect to end");
    await until(() => perf(t.page, P => /done/.test(P.barClass())), 10000, "the result");
    await sleep(1000);
    await perf(t.page, P => P.reset());
    await sleep(2000);
    const result = await perf(t.page, P => P.snap());
    assert.ok((result.calls.raf || 0) <= 12, `rAF with the result showing: ${JSON.stringify(result.calls)}`);
    // Closed: every loop stops.
    await until(async () => { await t.page.keyboard.press("Escape"); await sleep(400); return perf(t.page, P => !P.barVisible()); }, 10000, "the bar to close");
    await sleep(1200);
    await perf(t.page, P => { P.reset(); P.trace = []; });
    await sleep(1500);
    const idle = await perf(t.page, P => ({ ...P.snap(), trace: P.trace.slice(0, 1) }));
    assert.equal(idle.calls.raf || 0, 0, `rAF after closing: ${JSON.stringify(idle.calls)} ${idle.trace.join("\n")}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------------------------------------------------------------- reliability (demo/sites/hostile-js)

const HOSTILE_MOD = [mod("hostile", ".item { outline: 2px solid rgb(1, 2, 3); }", `morse.watch(".item", el => el.setAttribute("data-seen", ""));`)];
const allSeen = page => page.evaluate(() => { const items = [...document.querySelectorAll(".item")]; return items.length > 0 && items.every(i => i.hasAttribute("data-seen")); });
const hasCss = page => page.evaluate(() => getComputedStyle(document.querySelector(".item")).outlineColor === "rgb(1, 2, 3)");
async function hostile(query) {
  await D.setMods(HOSTILE_MOD);
  const t = await D.page();
  await t.page.goto(srv.url(`/demo/sites/hostile-js/${query}`));
  await until(() => allSeen(t.page), 8000, "the mod on the hostile page");
  return t;
}
async function opensAndCloses(page) {
  await page.keyboard.press("Alt+Space");
  await until(() => perf(page, P => P.barVisible()), 8000, "the bar to open");
  await page.keyboard.press("Escape");
  await until(() => perf(page, P => !P.barVisible()), 4000, "the bar to close");
}
const noErrors = async t => {
  assert.deepEqual(t.errors, [], "no page errors");
  assert.deepEqual(await perf(t.page, P => P.pageErrors), [], "nothing reached the page's error handlers");
};

test("hostile page: frozen intrinsics, filtered listeners, broken MutationObserver, rAF and timers", { skip }, async () => {
  const t = await hostile("?freeze&ael&mo&raf&timers");
  try {
    assert.ok(await hasCss(t.page), "mod CSS applied");
    await t.page.evaluate(() => window.__hostile.add(3));
    await until(() => allSeen(t.page), 4000, "watch to see new items (pristine MutationObserver and rAF)");
    await opensAndCloses(t.page);
    await t.page.keyboard.press("KeyX");
    assert.ok((await t.page.evaluate(() => window.__hostile.keys || [])).includes("KeyX"), "the page still gets its own keys");
    await noErrors(t);
  } finally { await t.close(); }
});

test("hostile page: document.open() replaces the whole document; Morse comes back", { skip }, async () => {
  const t = await hostile("");
  try {
    await opensAndCloses(t.page); // the UI exists before the document goes away
    await t.page.evaluate(() => window.__hostile.reopen());
    await until(() => allSeen(t.page), 4000, "watch on the new document");
    assert.ok(await hasCss(t.page), "mod CSS re-attached");
    await opensAndCloses(t.page); // window listeners were erased by document.open(); boot re-added them
    await noErrors(t);
  } finally { await t.close(); }
});

test("hostile page: <body> and <html> contents replaced", { skip }, async () => {
  const t = await hostile("");
  try {
    await opensAndCloses(t.page);
    await t.page.evaluate(() => window.__hostile.swapBody());
    await until(() => allSeen(t.page), 4000, "watch after a body swap");
    await t.page.evaluate(() => window.__hostile.swapHtml());
    await until(() => allSeen(t.page), 4000, "watch after an <html> swap");
    assert.ok(await hasCss(t.page), "mod CSS re-attached after <head> went away");
    assert.ok(await t.page.evaluate(() => !!document.querySelector("[data-morse-ui]")), "overlay re-mounted");
    await opensAndCloses(t.page);
    await noErrors(t);
  } finally { await t.close(); }
});

test("hostile page: navigations without the Navigation API, and back/forward cache restores", { skip }, async () => {
  const t = await hostile("?nonav");
  try {
    let t0 = await perf(t.page, P => performance.now());
    await t.page.click("#spa"); // a router's pushState: caught right after the click
    await until(() => modsListAfter(t.page, t0), 3000, "a re-sync after a client-side route");
    t0 = await perf(t.page, P => performance.now());
    await t.page.evaluate(() => history.back()); // popstate
    await until(() => modsListAfter(t.page, t0), 3000, "a re-sync after history.back()");
    t0 = await perf(t.page, P => performance.now());
    await t.page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await until(() => modsListAfter(t.page, t0), 3000, "a re-sync after a bfcache restore");
    await noErrors(t);
  } finally { await t.close(); }
});

test("never throws into the page: a host that fails every request", { skip }, async () => {
  const init = () => { globalThis.__morseHost = { send() { throw new Error("host down"); }, onMessage() {} }; };
  const t = await D.page({ init: [init] });
  try {
    await t.page.goto(srv.url("/demo/sites/hostile-js/"));
    await sleep(500);
    await t.page.keyboard.press("Alt+Space"); // tries to load the UI: fails quietly
    await sleep(500);
    await t.page.evaluate(() => history.pushState({}, "", "/elsewhere"));
    await sleep(300);
    await noErrors(t);
  } finally { await t.close(); }
});
