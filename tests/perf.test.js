// Speed and reliability budgets, in real Chromium through the real desktop
// connector (CDP: the runtime in Morse's isolated world, mod code in the
// page's main world). demo/perf-lib.js counts every listener, observer,
// timer, layout read and element Morse creates by wrapping the built-ins of
// both worlds.
//
// Budgets are counts wherever possible (they don't flake on a busy machine);
// the few timings are generous and compared against the full runtime.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, serve, desktop, payloads, sleep, mod, OPEN_KEY, ONE_MOD, THIRTY_MODS, runGeneration } from "../demo/perf-lib.js";

const skip = !chromium && "playwright not installed";
let srv, D;
before(async () => { if (skip) return; srv = await serve(); D = await desktop(); });
after(async () => { await D?.close(); await srv?.close(); });

async function until(fn, ms = 6000, what = String(fn)) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(25);
  }
}
const now = t => t.main(() => performance.now()); // one clock for both worlds (same document)
const modsListAfter = async (t, t0) => (await t.sends()).some(s => s[0] === "mods.list" && s[1] >= t0);
const total = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
const modApplied = t => t.main(P => P.marks.js != null);
// The safe-start "still alive" pings (2 s, 5 s, 7 s after a mod runs) are the
// only thing Morse may still do on its own; nothing repeats.
const notPings = calls => Object.entries(calls || {}).filter(([k]) => k !== "timeout").reduce((a, [, v]) => a + v, 0);

// ---------------------------------------------------------------- speed

test("boot: the script every page loads is small and cheap next to the full runtime", { skip }, async () => {
  const pl = await payloads();
  assert.ok(pl.split, "the runtime is split into boot + UI");
  // hotkeys, user control and safe start, self-heal detection, the guards, mods waiting for Allow User Scripts
  assert.ok(pl.boot.length < 54_000, `boot is ${pl.boot.length} bytes`);
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
    await until(() => modApplied(t), 8000, "the mod to apply");
    await sleep(400);
    const s = await t.snap();
    const c = k => s.counts[k] || 0;
    assert.equal(c("shadowRoot"), 0, "no overlay at boot");
    assert.equal(s.marks.ui, undefined, "nothing mounted");
    // The only style reads: the guard's "is the page still shown" before and
    // after a mod's code runs (runtime/boot.js guardLook); theme detection
    // waits for opening.
    assert.ok(c("getComputedStyle") <= 4, `style reads: ${c("getComputedStyle")}`);
    assert.equal(c("layoutRead"), 0, "no layout reads");
    assert.equal(c("setInterval"), 0, "no polling");
    assert.ok(c("observer") <= 2, `observers: ${c("observer")} (boot's document watcher + the kit's shared one)`);
    const listeners = c("listen:window") + c("listen:document") + c("listen:node");
    assert.ok(listeners <= 8, `listeners: ${JSON.stringify(s.counts)}`);
    assert.ok(c("createElement") <= 3, `elements: ${c("createElement")}`);
    // Idle: nothing of Morse's runs, apart from safe start's few pings, once
    // the one self-heal check (after the page settles) is done.
    await sleep(1500);
    await until(() => t.morse(() => !globalThis[Symbol.for("morse.boot")].heal.busy()), 20000, "the self-heal check");
    await t.reset();
    await sleep(2000);
    const idle = await t.snap();
    assert.equal(notPings(idle.calls), 0, `Morse callbacks while idle: ${JSON.stringify(idle.calls)}`);
    assert.ok((idle.calls.timeout || 0) <= 3, `timers while idle: ${JSON.stringify(idle.calls)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("open: the UI loads on first use, opens from the hotkey, and goes quiet when closed", { skip }, async () => {
  await D.setMods(ONE_MOD);
  const t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/big.html"));
    await until(() => modApplied(t), 8000, "the mod to apply");
    await t.page.keyboard.press(OPEN_KEY);
    await until(() => t.barVisible(), 8000, "the bar");
    assert.ok((await t.sends()).some(s => s[0] === "ui.load"), "the UI was requested from the host");
    await t.page.keyboard.press("Escape");
    await until(async () => !(await t.barVisible()), 4000, "the bar to close");
    await sleep(8000); // past safe start's last ping and the closing transitions
    await t.reset();
    await sleep(2000);
    const idle = await t.snap();
    assert.equal(total(idle.calls), 0, `Morse callbacks with the bar closed: ${JSON.stringify(idle.calls)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// The bar's words (04-i18n.js, 97-boot.js): English ships in the UI and its
// first open waits for nothing; another language is one host request per
// page, on the first open only (the host reads its file once per process).
test("languages: English opens without asking for words; German asks once per page, not again on reopening", { skip }, async () => {
  const { writeFile } = await import("node:fs/promises");
  const settings = path.join(D.home, "settings.json");
  await D.setMods([]);
  try {
    for (const [code, want] of [["en", 0], ["de", 1]]) {
      await writeFile(settings, JSON.stringify({ welcome: false, language: code }));
      const t = await D.page();
      try {
        await t.page.goto(srv.url("/perf/big.html"));
        await sleep(500);
        const words = async () => (await t.sends()).filter(s => s[0] === "i18n.words").length;
        for (let i = 0; i < 2; i++) {
          await t.page.keyboard.press(OPEN_KEY);
          await until(() => t.barVisible(), 8000, "the bar");
          await sleep(300);
          assert.equal(await words(), want, `${code}: word requests after opening ${i + 1} time(s)`);
          await t.page.keyboard.press("Escape");
          await until(async () => !(await t.barVisible()), 4000, "the bar to close");
        }
        assert.equal(await t.morse(P => P.roots.map(r => r.host.lang).join("")), code);
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    }
  } finally { await writeFile(settings, JSON.stringify({ welcome: false })); }
});

// The bar turns solid over the page's words (50-bar.js Backing). Each look is
// up to 20 hit tests (document.elementsFromPoint, a few ms each on a big page),
// so it looks only somewhere new, or once the page under it has scrolled and
// rests: never on a key, a pointer move over the page, the bar stepping back to
// where it already looked, or every scroll tick, and never while closed.
test("bar open: the solid backing looks when the bar or the page moves, not on every key, pointer move or scroll tick", { skip }, async () => {
  await D.setMods([]);
  const t = await D.page({ viewport: { width: 390, height: 800 } }); // a phone: the list's words sit under the bar
  const solid = () => t.morse(P => P.roots.some(r => r.querySelector(".bar")?.classList.contains("solid")));
  const counts = async () => (await t.snap()).counts;
  try {
    await t.page.goto(srv.url("/perf/big.html"));
    await sleep(300);
    await t.page.mouse.move(200, 200);
    await t.page.keyboard.press(OPEN_KEY);
    await until(() => t.barVisible(), 8000, "the bar");
    await until(solid, 4000, "the bar to turn solid over the page's words");
    await sleep(600);
    await t.reset();
    await t.clearSends();
    await t.page.keyboard.type("make every second row a little lighter", { delay: 40 });
    await sleep(800);
    const typing = await counts();
    // One look at most: the suggestions row goes away with the first key, so the bar gets shorter.
    assert.ok((typing.hitTests || 0) <= 20, `hit tests while typing 39 keys: ${typing.hitTests}`);
    // Warm as you type (speed): one request to the host once typing pauses, not one per key
    // (a busy machine can stall the keys long enough for one more).
    const warms = (await t.sends()).filter(s => s[0] === "warm").length;
    assert.ok(warms >= 1 && warms <= 3, `warm requests while typing 39 keys: ${warms}`);
    await t.reset();
    for (let i = 0; i < 30; i++) { await t.page.mouse.move(20 + i * 12, 120 + (i % 8) * 20); await sleep(30); }
    await sleep(500);
    assert.equal((await counts()).hitTests || 0, 0, "the backing's hit tests while pointing at the page (the picker's own one per move aside)");
    // Pointing low and high in turn: the bar steps to the top and back each time.
    // A look is up to 20 hit tests, cached per rounded position (Backing.answers),
    // so the two resting places (top, bottom) cost two looks — not one per step.
    // A busy machine can register a transient position or two mid-step before it
    // settles (each its own cached look), so budget a few looks; never the ~480 a
    // per-step look would cost, which is what this guards against.
    await t.reset();
    for (let i = 0; i < 24; i++) { await t.page.mouse.move(60 + i * 10, i % 2 ? 560 : 120); await sleep(80); }
    await sleep(500);
    const stepping = await t.snap();
    assert.ok((stepping.counts.hitTests || 0) <= 20 * 4, `hit tests while the bar stepped between top and bottom: ${stepping.counts.hitTests}`);
    await t.reset();
    for (let i = 0; i < 20; i++) { await t.page.mouse.wheel(0, 100); await sleep(60); }
    await sleep(800);
    const scrolling = await counts();
    // Once the page rests (twice if a busy machine paused the scroll for a moment).
    assert.ok((scrolling.hitTests || 0) <= 40, `hit tests for 20 scroll ticks: ${scrolling.hitTests}`);
    assert.ok(await solid(), "still solid over the page's words");
    // Closed: scrolling the page runs nothing of Morse's.
    await t.page.keyboard.press("Escape");
    await t.page.keyboard.press("Escape");
    await until(async () => !(await t.barVisible()), 4000, "the bar to close");
    await sleep(1500);
    await t.reset();
    for (let i = 0; i < 20; i++) { await t.page.mouse.wheel(0, -100); await sleep(60); }
    await sleep(800);
    const closed = await t.snap();
    assert.equal((closed.counts.hitTests || 0) + (closed.counts.hitTest || 0), 0, "hit tests with the bar closed");
    assert.equal(total(closed.calls), 0, `Morse callbacks while scrolling with the bar closed: ${JSON.stringify(closed.calls)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
  // A calm page (no words under the bar) keeps the glass.
  const c = await D.page();
  try {
    await c.page.goto(srv.url("/perf/effect.html"));
    await sleep(300);
    await c.page.keyboard.press(OPEN_KEY);
    await until(() => c.barVisible(), 8000, "the bar");
    await sleep(1000);
    assert.equal(await c.morse(P => P.roots.some(r => r.querySelector(".bar")?.classList.contains("solid"))), false, "glass over a calm page");
  } finally { await c.close(); }
});

test("mods at scale: 30 watch mods share one observer and stay cheap on a streaming chat", { skip }, async () => {
  await D.setMods(THIRTY_MODS);
  const t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/chat.html"));
    await until(() => t.page.evaluate(() => document.querySelectorAll("style[data-morse-css]").length >= 30 && document.querySelector("[data-p0]") && document.querySelector("[data-p29]")), 6000, "all 30 mods");
    const s = await t.snap();
    assert.ok((s.counts.observer || 0) <= 2, `observers: ${s.counts.observer}`);
    assert.equal(s.counts["observe:subtree"], 1, "one subtree observer for all 30 watches");
    await sleep(300);
    await t.reset();
    await t.page.evaluate(() => window.__stream(2000));
    const run = await t.snap();
    const ms = (run.ms.mo || 0) + (run.ms.raf || 0) + (run.ms.timeout || 0);
    // Wall clock, so generous (a loaded machine stretches it; 30 observers took 66-78 ms/s);
    // the counts below are the strict part.
    assert.ok(ms / 2 < 40, `Morse spent ${(ms / 2).toFixed(1)} ms per second of streaming`);
    assert.ok((run.calls.mo || 0) <= 200, `observer callbacks: ${run.calls.mo} (30 observers made ~2,000 in 2 s)`);
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
    await until(() => modApplied(t), 8000, "the mod to apply");
    await sleep(700);
    await t.clearSends();
    await t.reset();
    await t.page.evaluate(() => window.__nav(8, 120));
    const navs = await t.page.evaluate(() => window.__navs.slice(-8));
    const listed = async () => (await t.sends()).filter(s => s[0] === "mods.list").map(s => s[1]);
    // Every navigation is followed by a re-sync (the throttle allows one per 250 ms;
    // the bound is loose because a busy machine delays the requests themselves).
    await until(async () => (await listed()).some(x => x >= navs.at(-1)), 5000, "a re-sync after the last navigation");
    const lists = await listed();
    for (const n of navs) {
      const hit = lists.find(x => x >= n);
      assert.ok(hit != null && hit - n < 1000, `navigation at ${n.toFixed(0)} noticed after ${hit == null ? "never" : (hit - n).toFixed(0) + "ms"}`);
    }
    assert.ok(lists.length <= 8, `${lists.length} re-syncs for 8 navigations`);
    assert.equal((await t.snap()).counts.setInterval || 0, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("effect: a 4K target costs a few dozen draw calls per frame, and nothing once it ends", { skip }, async () => {
  await D.setMods([]);
  const t = await D.page({ viewport: { width: 3840, height: 2160 } });
  try {
    await t.page.goto(srv.url("/perf/effect.html"));
    await sleep(500);
    await runGeneration(t, { target: "#huge", prompt: "clean up the clutter" });
    await until(() => t.fxOn(), 10000, "the effect");
    await sleep(200);
    await t.reset();
    await sleep(1200);
    const s = await t.snap();
    const frames = Math.max(1, s.calls.raf || 0);
    assert.ok(s.canvas.fills / frames <= 70, `${(s.canvas.fills / frames).toFixed(0)} draw calls per frame`);
    assert.ok(s.canvas.shapes / frames <= 6100, `${(s.canvas.shapes / frames).toFixed(0)} shapes per frame`);
    // With the result showing nothing animates: at most God mode's 5x/s check.
    await until(async () => !(await t.fxOn()), 30000, "the effect to end");
    await until(async () => /done/.test(await t.barClass()), 10000, "the result");
    await sleep(1000);
    await t.reset();
    await sleep(2000);
    const result = await t.snap();
    assert.ok((result.calls.raf || 0) <= 12, `rAF with the result showing: ${JSON.stringify(result.calls)}`);
    // Closed: every loop stops.
    await until(async () => { await t.page.keyboard.press("Escape"); await sleep(400); return !(await t.barVisible()); }, 10000, "the bar to close");
    await sleep(1200);
    await t.reset();
    await sleep(1500);
    const idle = await t.snap();
    assert.equal(idle.calls.raf || 0, 0, `rAF after closing: ${JSON.stringify(idle.calls)}`);
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
async function opensAndCloses(t) {
  await t.page.keyboard.press(OPEN_KEY);
  await until(() => t.barVisible(), 8000, "the bar to open");
  await t.page.keyboard.press("Escape");
  await until(async () => !(await t.barVisible()), 4000, "the bar to close");
}
const noErrors = async t => {
  assert.deepEqual(t.errors, [], "no page errors");
  assert.deepEqual(await t.main(P => P.pageErrors), [], "nothing reached the page's error handlers");
};

test("hostile page: frozen intrinsics, filtered listeners, broken MutationObserver, rAF and timers", { skip }, async () => {
  const t = await hostile("?freeze&ael&mo&raf&timers");
  try {
    assert.ok(await hasCss(t.page), "mod CSS applied");
    await t.page.evaluate(() => window.__hostile.add(3));
    await until(() => allSeen(t.page), 4000, "watch to see new items (pristine MutationObserver and rAF)");
    await opensAndCloses(t);
    await t.page.click("h1"); // focus back on the page (Morse's own UI keeps the keys it has focus for)
    await t.page.keyboard.press("KeyX");
    assert.ok((await t.page.evaluate(() => window.__hostile.keys || [])).includes("KeyX"), "the page still gets its own keys");
    await noErrors(t);
  } finally { await t.close(); }
});

test("hostile page: document.open() replaces the whole document; Morse comes back", { skip }, async () => {
  const t = await hostile("");
  try {
    await opensAndCloses(t); // the UI exists before the document goes away
    await t.page.evaluate(() => window.__hostile.reopen());
    await until(() => allSeen(t.page), 4000, "watch on the new document");
    assert.ok(await hasCss(t.page), "mod CSS re-attached");
    await opensAndCloses(t); // window listeners were erased by document.open(); boot re-added them
    await noErrors(t);
  } finally { await t.close(); }
});

test("hostile page: <body> and <html> contents replaced", { skip }, async () => {
  const t = await hostile("");
  try {
    await opensAndCloses(t);
    await t.page.evaluate(() => window.__hostile.swapBody());
    await until(() => allSeen(t.page), 4000, "watch after a body swap");
    await t.page.evaluate(() => window.__hostile.swapHtml());
    await until(() => allSeen(t.page), 4000, "watch after an <html> swap");
    assert.ok(await hasCss(t.page), "mod CSS re-attached after <head> went away");
    assert.ok(await t.page.evaluate(() => !!document.querySelector("[data-morse-ui]")), "overlay re-mounted");
    await opensAndCloses(t);
    await noErrors(t);
  } finally { await t.close(); }
});

test("hostile page: navigations without the Navigation API, and back/forward cache restores", { skip }, async () => {
  // The Navigation API is gone in Morse's own world too (as on old Electron).
  const t = await (async () => {
    await D.setMods(HOSTILE_MOD);
    const p = await D.page({ morseInit: [() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true })] });
    await p.page.goto(srv.url("/demo/sites/hostile-js/?nonav"));
    await until(() => allSeen(p.page), 8000, "the mod on the hostile page");
    return p;
  })();
  try {
    let t0 = await now(t);
    await t.page.click("#spa"); // a router's pushState: caught right after the click
    await until(() => modsListAfter(t, t0), 3000, "a re-sync after a client-side route");
    t0 = await now(t);
    await t.page.evaluate(() => history.back()); // popstate
    await until(() => modsListAfter(t, t0), 3000, "a re-sync after history.back()");
    t0 = await now(t);
    await t.morse(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await until(() => modsListAfter(t, t0), 3000, "a re-sync after a bfcache restore");
    await noErrors(t);
  } finally { await t.close(); }
});

test("never throws into the page: a host that fails every request", { skip }, async () => {
  const host = () => { globalThis.__morseHost = { send() { throw new Error("host down"); }, onMessage() {} }; };
  const t = await D.page({ morseInit: [host], init: [host] });
  try {
    await t.page.goto(srv.url("/demo/sites/hostile-js/"));
    await sleep(500);
    await t.page.keyboard.press(OPEN_KEY); // tries to load the UI: fails quietly
    await sleep(500);
    await t.page.evaluate(() => history.pushState({}, "", "/elsewhere"));
    await sleep(300);
    await noErrors(t);
  } finally { await t.close(); }
});

// ---------------------------------------------------------------- self-heal detection lives in the boot

test("self-heal: a mod whose page changed is found after idle, with no UI loaded and nothing left running", { skip }, async () => {
  const { modCodeHash, pagePathShape } = await import("../core/heal.js");
  const url = srv.url("/perf/big.html");
  const fp = (m, sel, n) => ({ v: 1, code: modCodeHash(m), path: pagePathShape(url), size: 100, at: new Date().toISOString(), sels: [[sel, n]] });
  const gone = mod("healgone", ".album-grid { outline: 1px solid red; }", "");
  gone.fp = fp(gone, ".album-grid", 12);
  const fine = mod("healfine", "li.row { outline: 0; }", "");
  fine.fp = fp(fine, "li.row", 3000);
  await D.setMods([gone, fine]);
  const t = await D.page();
  try {
    await t.page.goto(url);
    const found = () => t.morse(() => { const H = globalThis[Symbol.for("morse.boot")].heal; return !H.busy() && H.broken().size ? [...H.broken().keys()] : null; });
    const ids = await until(found, 25000, "the check to find it");
    assert.deepEqual(ids, ["healgone"], "only the mod whose elements are gone");
    assert.equal((await t.snap()).counts.shadowRoot || 0, 0, "found without loading the UI");
    await t.reset();
    await sleep(2000);
    assert.equal(notPings((await t.snap()).calls), 0, "nothing keeps running after the check");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------------------------------------------------------------- guards live in the boot too

test("guards: with no UI loaded, CSS that hides the page never lands and a runaway mod is paused; then the UI says so", { skip }, async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const saved = async id => JSON.parse(await readFile(join(D.home, "mods", `${id}.json`), "utf8"));
  const pausedMod = id => until(async () => { const m = await saved(id); return !m.enabled && m.paused ? m : null; }, 20000, `${id} to be paused`);
  const toast = (t, id) => until(() => t.morse(P => P.roots.some(r => (r.querySelector(".ctl-toast:not([hidden])")?.textContent || "").includes("Paused")))
    .then(v => v && id), 8000, "the toast");
  // 1. Busy for over a second at once, after it started fine: the kit pauses
  // it and fires "morse:paused", which only the boot is there to hear.
  await D.setMods([mod("guardslow", "", `morse.after(1500, () => { const t = performance.now(); while (performance.now() - t < 1100) {} });`)]);
  let t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/big.html"));
    await until(() => t.main(() => globalThis.morse?.__stats("guardslow")), 8000, "the mod to run");
    assert.ok(!(await t.sends()).some(s => s[0] === "ui.load"), "no UI while it runs fine");
    assert.equal((await pausedMod("guardslow")).paused.why, "slow");
    const sends = (await t.sends()).map(s => s[0]);
    assert.ok(sends.includes("stats") && sends.indexOf("stats") < sends.indexOf("ui.load"), `the boot asked the host before loading the UI: ${sends.join(" ")}`);
    await toast(t, "guardslow");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
  // 2. CSS that hides the whole page is never applied.
  await D.setMods([mod("guardhide", "* { display: none !important; }", "")]);
  t = await D.page();
  try {
    await t.page.goto(srv.url("/perf/big.html"));
    const hide = await pausedMod("guardhide");
    assert.equal(hide.paused.why, "hid");
    assert.match(hide.paused.error, /^Morse paused it\. Your CSS hides the whole page/);
    assert.equal(await t.main(() => document.querySelectorAll("style[data-morse-css]").length), 0, "its CSS never landed");
    assert.equal(await t.main(() => getComputedStyle(document.body).display), "block", "the page shows");
    await toast(t, "guardhide");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// demo/perf.js and this file used to leave a /tmp/morse-perf-* folder behind
// on every run (a home with mods, settings and sessions, and a browser profile).
test("the measuring setup removes the folders it made", { skip }, async () => {
  const d = await desktop();
  assert.ok(existsSync(d.home));
  await d.close();
  assert.ok(!existsSync(d.home), `${d.home} is removed`);
  const given = mkdtempSync(path.join(os.tmpdir(), "morse-perf-given-"));
  try {
    await (await desktop({ home: given })).close();
    assert.ok(existsSync(given), "a home it was given stays");
  } finally { rmSync(given, { recursive: true, force: true }); }
});
