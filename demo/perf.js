// Measures what Morse costs the apps it lives in, through the real desktop
// connector (CDP) and the real extension, and writes docs/perf/report.md.
//
//   node demo/perf.js                  # measure, print, write the report
//   node demo/perf.js --label before   # save as the baseline the report compares against
//   node demo/perf.js --runs 5 --only boot,mods   # re-measure some sections, keep the rest
//   node demo/perf.js --label after --report      # rewrite the report from saved JSON
//   DISPLAY=:99 node demo/perf.js --label after --only realbar,realboot   # real public sites (network, HTTPS_PROXY)
//   … --label before-real --only realbar,realboot  # the baseline for those two (docs/perf/before-real.json)
//
// Sections: payload (bytes, compile), boot (per site: what Morse creates and
// costs before anyone opens it), idle (what still runs), open (hotkey to bar),
// mods at scale (30 watch mods on a streaming chat), SPA (URL-change
// detection), effect (frame cost on a 4K target), extension (content script);
// lang (English vs another language on the bar's first open), flat (a watch
// over a long flat list of rows); on request,
// realbar (the bar open on big real pages: typing, pointing, scrolling) and
// realboot (5 real sites, with 0 and with 20 saved mods).

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, chromium, serve, desktop, metrics, payloads, median, sleep, mod, OPEN_KEY, ONE_MOD, THIRTY_MODS, runGeneration } from "./perf-lib.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LABEL = arg("--label", "current");
const RUNS = Number(arg("--runs", 3));
const ONLY = new Set(String(arg("--only", "payload,boot,open,lang,mods,flat,spa,effect,extension")).split(","));
const OUT = path.join(ROOT, "docs", "perf");
// --report: rebuild report.md from docs/perf/<label>.json and before.json, no measuring.
if (argv.includes("--report")) {
  const read = async f => JSON.parse(await fs.readFile(path.join(OUT, f), "utf8"));
  const md = report(await read(`${LABEL}.json`), await read("before.json").catch(() => null), await read("before-real.json").catch(() => null));
  await fs.writeFile(path.join(OUT, "report.md"), md);
  console.log(md);
  process.exit(0);
}
if (!chromium) { console.error("playwright is not installed"); process.exit(1); }

const srv = await serve();
const pl = await payloads();
const D = await desktop();
const R = { label: LABEL, date: new Date().toISOString(), split: pl.split, runs: RUNS };
const SITES = { parley: "/demo/sites/parley/", byte: "/demo/sites/byte/", tunes: "/demo/sites/tunes/", "big (10k nodes)": "/perf/big.html" };
const log = (...a) => console.log(...a);
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- payload
async function payloadCost() {
  const browser = D.browser;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(srv.url("/perf/big.html"));
  const s = await ctx.newCDPSession(page);
  await s.send("Runtime.enable");
  const wall = async f => { const t = process.hrtime.bigint(); await f(); return Number(process.hrtime.bigint() - t) / 1e6; };
  const bust = () => `\n//${Math.random()}`;
  const compile = [], run = [];
  for (let i = 0; i < 15; i++) {
    const noop = await wall(() => s.send("Runtime.compileScript", { expression: "1" + bust(), sourceURL: "", persistScript: false }));
    compile.push(await wall(() => s.send("Runtime.compileScript", { expression: pl.boot + bust(), sourceURL: "", persistScript: false })) - noop);
  }
  // compile + top-level run on a loaded 10k-node page, host stubbed (no replies)
  for (let i = 0; i < 9; i++) {
    await page.reload();
    await page.evaluate(() => { globalThis.__morseHost = { send() {}, onMessage() {} }; });
    const noop = await wall(() => s.send("Runtime.evaluate", { expression: "1" + bust() }));
    run.push(await wall(() => s.send("Runtime.evaluate", { expression: pl.boot + bust() })) - noop);
  }
  await ctx.close();
  return { bootBytes: pl.boot.length, fullBytes: pl.full.length, compileMs: r2(median(compile)), compileRunMs: r2(median(run)) };
}

// ---------------------------------------------------------------- boot + idle
async function settle(page, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(() => window.__perf.marks.js != null).catch(() => false)) break;
    await sleep(50);
  }
}
async function bootOnce(url, morse) {
  const t = await D.page({ morse });
  await t.page.goto(url, { waitUntil: "load" });
  if (morse) await settle(t.page); else await sleep(300);
  await sleep(700);
  const m = await metrics(t.cdp);
  const snap = await t.snap();
  const dcl = await t.page.evaluate(() => performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd || 0);
  await t.reset();
  await sleep(3000);
  const idle = await t.snap();
  await t.close();
  return { m, snap, idle, dcl, errors: t.errors };
}
async function boot() {
  await D.setMods(ONE_MOD);
  const out = {};
  for (const [name, p] of Object.entries(SITES)) {
    const none = [], with_ = [];
    for (let i = 0; i < RUNS; i++) { none.push(await bootOnce(srv.url(p), false)); with_.push(await bootOnce(srv.url(p), true)); }
    const dm = k => r1(median(with_.map(x => x.m[k])) - median(none.map(x => x.m[k])));
    const c = k => median(with_.map(x => x.snap.counts[k] || 0));
    const listeners = with_.map(x => Object.entries(x.snap.counts).filter(([k]) => k.startsWith("listen:")).reduce((n, [, v]) => n + v, 0));
    const timers = with_.map(x => (x.snap.counts.setTimeout || 0) + (x.snap.counts.setInterval || 0) + (x.snap.counts.raf || 0) + (x.snap.counts.idle || 0));
    const idleCalls = with_.map(x => Object.values(x.idle.calls).reduce((a, b) => a + b, 0));
    const idleMs = with_.map(x => Object.values(x.idle.ms).reduce((a, b) => a + b, 0));
    out[name] = {
      nodes: dm("Nodes"), jsListeners: dm("JSEventListeners"), heapKB: r1((median(with_.map(x => x.m.JSHeapUsedSize)) - median(none.map(x => x.m.JSHeapUsedSize))) / 1024),
      scriptMs: r1((median(with_.map(x => x.m.ScriptDuration)) - median(none.map(x => x.m.ScriptDuration))) * 1000), layouts: dm("LayoutCount"), styleRecalcs: dm("RecalcStyleCount"),
      listeners: median(listeners), observers: c("observer"), timers: median(timers), intervals: c("setInterval"),
      getComputedStyle: c("getComputedStyle"), layoutReads: c("layoutRead"), elements: c("createElement"), shadowRoots: c("shadowRoot"),
      firstCssMs: r1(median(with_.map(x => x.snap.marks.css ?? NaN))), firstJsMs: r1(median(with_.map(x => x.snap.marks.js ?? NaN))),
      uiMountedAtBoot: with_.some(x => x.snap.marks.ui != null), dclMs: r1(median(with_.map(x => x.dcl))),
      idleCallbacks3s: median(idleCalls), idleMs3s: r2(median(idleMs)), errors: with_.flatMap(x => x.errors),
    };
    log(`  boot ${name}: ${JSON.stringify(out[name])}`);
  }
  return out;
}

// ---------------------------------------------------------------- open latency
async function openLatency() {
  await D.setMods(ONE_MOD);
  const lat = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await D.page();
    await t.page.goto(srv.url("/perf/big.html"));
    await settle(t.page);
    await sleep(300);
    await t.morse(P => P.watchBar());
    await t.page.keyboard.press(OPEN_KEY);
    const end = Date.now() + 8000;
    let v = null;
    while (Date.now() < end && v == null) {
      const bar = await t.morse(P => P.marks.bar), key = await t.main(P => P.keydown); // one clock: same document
      v = bar != null && key ? bar - key : null;
      await sleep(20);
    }
    lat.push(v ?? NaN);
    await t.close();
  }
  return { hotkeyToBarMs: r1(median(lat)), runs: lat.map(r1) };
}

// ---------------------------------------------------------------- mods at scale
async function modsAtScale() {
  await D.setMods(THIRTY_MODS);
  const res = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await D.page();
    await t.page.goto(srv.url("/perf/chat.html"));
    const t0 = Date.now();
    let applied = null;
    while (Date.now() - t0 < 30000) {
      applied = await t.page.evaluate(sels => {
        const css = document.querySelectorAll("style[data-morse-css]").length;
        const pending = sels.filter((s, i) => { try { return document.querySelector(s) && !document.querySelector(`[data-p${i}]`); } catch { return false; } });
        return css >= sels.length && !pending.length ? performance.now() : null;
      }, THIRTY_MODS.map(m => JSON.parse(m.js.match(/watch\((".*?")/)[1])));
      if (applied != null) break;
      await sleep(25);
    }
    const boot = await t.snap();
    await sleep(500);
    await t.reset();
    await t.main(P => P.countFrames(true));
    const tokens = await t.page.evaluate(() => window.__stream(4000));
    await sleep(100);
    await t.main(P => P.countFrames(false));
    const s = await t.snap();
    const ms = (s.ms.mo || 0) + (s.ms.raf || 0) + (s.ms.timeout || 0) + (s.ms.interval || 0);
    res.push({ allAppliedMs: applied, observers: boot.counts.observer || 0, subtreeObserves: boot.counts["observe:subtree"] || 0,
      moCallbacks: s.calls.mo || 0, rafCallbacks: s.calls.raf || 0, morseMsPerSec: ms / 4, frames: s.frames, msPerFrame: ms / Math.max(1, s.frames), maxCallbackMs: Math.max(s.max.mo || 0, s.max.raf || 0), tokens, errors: t.errors });
    await t.close();
  }
  const m = k => r2(median(res.map(x => x[k])));
  const out = { mods: THIRTY_MODS.length, allAppliedMs: r1(median(res.map(x => x.allAppliedMs ?? NaN))), observers: m("observers"), subtreeObserves: m("subtreeObserves"),
    moCallbacks: m("moCallbacks"), rafCallbacks: m("rafCallbacks"), morseMsPerSec: m("morseMsPerSec"), msPerFrame: m("msPerFrame"), maxCallbackMs: m("maxCallbackMs"), errors: res.flatMap(x => x.errors) };
  log(`  mods: ${JSON.stringify(out)}`);
  return out;
}

// ---------------------------------------------------------------- SPA session
async function spa() {
  await D.setMods(ONE_MOD);
  const t = await D.page();
  await t.page.goto(srv.url("/perf/spa.html"));
  await settle(t.page);
  await sleep(500);
  const before = await t.snap();
  await t.reset();
  await t.clearSends();
  const N = 60;
  await t.page.evaluate(n => window.__nav(n, 40), N);
  await sleep(1500);
  const after = { ...(await t.snap()), sends: await t.sends(), navs: await t.page.evaluate(() => window.__navs) };
  const lists = after.sends.filter(s => s[0] === "mods.list").map(s => s[1]);
  const lat = after.navs.map(t0 => { const hit = lists.find(t => t >= t0); return hit == null ? NaN : hit - t0; });
  const listeners = Object.entries(after.counts).filter(([k]) => k.startsWith("listen:")).reduce((n, [, v]) => n + v, 0);
  const out = { navigations: N, modsListRequests: lists.length, detectMedianMs: r1(median(lat.filter(Number.isFinite))), detectMaxMs: r1(Math.max(...lat.filter(Number.isFinite))),
    missed: lat.filter(x => !Number.isFinite(x)).length, listenersAdded: listeners, observersAdded: after.counts.observer || 0,
    bootListeners: Object.entries(before.counts).filter(([k]) => k.startsWith("listen:")).reduce((n, [, v]) => n + v, 0), errors: t.errors };
  await t.close();
  log(`  spa: ${JSON.stringify(out)}`);
  return out;
}

// ---------------------------------------------------------------- effect
// The bar is driven for real (hotkey, point, type, Enter) against the demo
// model; frames are sampled only while the effect canvas is on screen.
async function effect() {
  await D.setMods([]);
  const out = {};
  const fxOn = t => t.fxOn();
  const working = async t => /working/.test(await t.barClass());
  const CASES = [["target 3840x2160", "#huge", 3840, 2160], ["page-wide 3840x2160", null, 3840, 2160], ["target 1920x1080", "#huge", 1920, 1080]];
  for (const [name, target, width, height] of CASES) {
    const runs = [];
    let idle = null;
    for (let i = 0; i < RUNS; i++) {
      const t = await D.page({ viewport: { width, height } });
      await t.page.goto(srv.url("/perf/effect.html"));
      await sleep(800);
      await runGeneration(t, { target, prompt: "clean up the clutter" });
      let end = Date.now() + 10000;
      while (Date.now() < end && !(await fxOn(t))) await sleep(20);
      await sleep(300); // past the first frame, which builds the grid
      // ThreadTime is the main thread's CPU time: it holds up on a loaded machine where wall time doesn't.
      const cpu0 = (await metrics(t.cdp)).ThreadTime;
      // A sampling profile gives the effect's own cost (its draw() and the canvas
      // calls it makes), apart from everything else the machine is doing.
      await t.cdp.send("Profiler.enable");
      await t.cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await t.reset();
      await t.main(P => P.countFrames(true));
      await t.cdp.send("Profiler.start");
      await sleep(1500);
      const { profile } = await t.cdp.send("Profiler.stop");
      await t.main(P => P.countFrames(false));
      const s = await t.snap();
      const cpu1 = (await metrics(t.cdp)).ThreadTime;
      const fxMs = profileMs(profile, /^(draw|fill|fillRect|rect|roundRect|arcTo|clearRect|createPattern)$/);
      const valid = await fxOn(t), f = Math.max(1, s.frames);
      runs.push({ valid, frames: s.frames, rafCallbacks: s.calls.raf || 0, msPerFrame: (s.ms.raf || 0) / f, maxFrameMs: s.max.raf || 0,
        cpuMsPerFrame: ((cpu1 - cpu0) * 1000) / f, effectMsPerFrame: fxMs / f, drawCallsPerFrame: Math.round(s.canvas.fills / f), shapesPerFrame: Math.round(s.canvas.shapes / f), errors: t.errors });
      if (!idle) {
        end = Date.now() + 30000;
        while (Date.now() < end && (await working(t))) await sleep(50);
        await sleep(1500);
        await t.reset();
        await sleep(2000);
        const open = await t.snap();
        await t.page.keyboard.press("Escape");
        await t.page.keyboard.press("Escape");
        await sleep(500);
        await t.reset();
        await sleep(2000);
        const closed = await t.snap();
        idle = { rafPerSecIdleOpen: r1((open.calls.raf || 0) / 2), callbacksPerSecIdleClosed: r1(Object.values(closed.calls).reduce((a, b) => a + b, 0) / 2) };
      }
      await t.close();
    }
    const ok = runs.filter(r => r.valid);
    const m = k => r2(median(ok.map(r => r[k])));
    out[name] = { validRuns: ok.length, frames: m("frames"), rafCallbacks: m("rafCallbacks"), msPerFrame: m("msPerFrame"), minMsPerFrame: r2(Math.min(...ok.map(r => r.msPerFrame))), maxFrameMs: m("maxFrameMs"),
      cpuMsPerFrame: m("cpuMsPerFrame"), effectMsPerFrame: m("effectMsPerFrame"), drawCallsPerFrame: m("drawCallsPerFrame"), shapesPerFrame: m("shapesPerFrame"), ...idle, errors: runs.flatMap(r => r.errors) };
    log(`  effect ${name}: ${JSON.stringify(out[name])}`);
  }
  return out;
}

// Self time of the functions whose names match, from a CDP CPU profile (ms).
function profileMs(profile, re) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const per = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
  let ms = 0;
  for (const id of profile.samples) if (re.test(byId.get(id)?.callFrame.functionName || "")) ms += per;
  return ms;
}

// ---------------------------------------------------------------- extension
async function extension() {
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build.js")], { stdio: "ignore" });
  const EXT = path.join(ROOT, "dist", "extension");
  const os = await import("node:os");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "morse-perf-ext-"));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  } catch (e) { await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); return { skipped: e.message.split("\n")[0] }; }
  const plain = await chromium.launch({ channel: "chromium", headless: true }).catch(() => chromium.launch());
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 10000 });
    // Its CSS only: this browser has “Allow User Scripts” off, so mod code would
    // wait for it and Morse would load its UI once per tab to say so (64-waiting.js).
    const cssOnly = ONE_MOD.map(m => ({ ...m, js: "" }));
    await sw.evaluate(mods => chrome.storage.local.set({ mods: Object.fromEntries(mods.map(m => [m.id, m])), welcomed: true }), cssOnly);
    const { instrument } = await import("./perf-lib.js");
    const one = async (c, url) => {
      const page = await c.newPage();
      await page.addInitScript(instrument);
      const cdp = await c.newCDPSession(page);
      await cdp.send("Performance.enable");
      await page.goto(url, { waitUntil: "load" });
      const end = Date.now() + 4000;
      while (Date.now() < end && !(await page.evaluate(() => window.__perf.marks.css != null))) await sleep(30);
      await sleep(1000);
      const m = await metrics(cdp);
      const marks = await page.evaluate(() => window.__perf.marks);
      await page.close();
      return { m, marks };
    };
    const out = {};
    const plainCtx = await plain.newContext();
    for (const [name, p] of Object.entries(SITES)) {
      const a = [], b = [];
      for (let i = 0; i < RUNS; i++) { b.push(await one(plainCtx, srv.url(p))); a.push(await one(ctx, srv.url(p))); }
      const dm = k => median(a.map(x => x.m[k])) - median(b.map(x => x.m[k]));
      out[name] = { nodes: r1(dm("Nodes")), jsListeners: r1(dm("JSEventListeners")), scriptMs: r1(dm("ScriptDuration") * 1000), heapKB: r1(dm("JSHeapUsedSize") / 1024),
        layouts: r1(dm("LayoutCount")), firstCssMs: r1(median(a.map(x => x.marks.css ?? NaN))), uiMountedAtBoot: a.some(x => x.marks.ui != null) };
      log(`  extension ${name}: ${JSON.stringify(out[name])}`);
    }
    return out;
  } finally { await ctx.close(); await plain.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); }
}

// ---------------------------------------------------------------- a watch over a long flat list
// A feed, a long table, the lines of a file: every row a sibling of the
// others. One mod with `morse.watch("p.flat", el => el.dataset.seen = "")`,
// the rows added at once.
async function flat() {
  await D.setMods([mod("flat", "", `morse.watch("p.flat", el => { el.dataset.seen = ""; });`)]);
  const out = {};
  for (const n of [1000, 2000, 4000, 8000]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await D.page();
      await t.page.goto(srv.url("/perf/spa.html"));
      await sleep(1500);
      await t.reset();
      await t.page.evaluate(n => { const f = document.createDocumentFragment(); for (let i = 0; i < n; i++) { const p = document.createElement("p"); p.className = "flat"; p.textContent = "row " + i; f.append(p); } document.body.append(f); }, n);
      const t0 = Date.now();
      let done = false;
      while (!(done = await t.page.evaluate(n => document.querySelectorAll("p.flat[data-seen]").length === n, n)) && Date.now() - t0 < 15000) await sleep(50);
      const s = await t.snap();
      runs.push({ done, morseMs: ["mo", "raf", "timeout", "idle"].reduce((a, k) => a + (s.ms[k] || 0), 0), maxMs: Math.max(0, ...Object.values(s.max)) });
      await t.close();
    }
    out[n] = { allRows: runs.filter(r => r.done).length === runs.length, morseMs: r1(median(runs.map(r => r.morseMs))), maxMs: r1(median(runs.map(r => r.maxMs))) };
    log(`  flat ${n}: ${JSON.stringify(out[n])}`);
  }
  return out;
}

// ---------------------------------------------------------------- languages
// The bar's words: English ships in the UI bundle; another language is one
// host request ("i18n.words") the first time the bar opens on a page, and the
// first open waits for it (1.5 s at most) so the bar never shows English first.
async function lang() {
  await D.setMods([]);
  const out = {};
  const settings = path.join(D.home, "settings.json");
  try {
    for (const code of ["en", "de"]) {
      await fs.writeFile(settings, JSON.stringify({ welcome: false, language: code }));
      const lat = [], first = [], again = [];
      for (let i = 0; i < RUNS; i++) {
        const t = await D.page();
        await t.page.goto(srv.url("/perf/big.html"));
        await sleep(1500);
        await t.morse(P => P.watchBar());
        await t.clearSends();
        await t.page.keyboard.press(OPEN_KEY);
        const end = Date.now() + 10000;
        let v = null;
        while (Date.now() < end && v == null) {
          const bar = await t.morse(P => P.marks.bar), key = await t.main(P => P.keydown);
          v = bar != null && key ? bar - key : null;
          await sleep(20);
        }
        lat.push(v ?? NaN);
        await sleep(300);
        const words = async () => (await t.sends()).filter(s => s[0] === "i18n.words").length;
        first.push(await words());
        await t.page.keyboard.press("Escape");
        await sleep(400);
        await t.page.keyboard.press(OPEN_KEY);
        while (!(await t.barVisible())) await sleep(30);
        await sleep(300);
        again.push(await words() - first.at(-1));
        await t.close();
      }
      out[code] = { hotkeyToBarMs: r1(median(lat)), runs: lat.map(r1), wordsRequests: median(first), wordsRequestsReopen: median(again) };
      log(`  lang ${code}: ${JSON.stringify(out[code])}`);
    }
  } finally { await fs.writeFile(settings, JSON.stringify({ welcome: false })); }
  return out;
}

// ---------------------------------------------------------------- real sites
// Public pages through the proxy this machine has (HTTPS_PROXY), in a headed
// Chromium when DISPLAY is set. Network time differs on every load, so the
// cells are main-thread and memory deltas against the same page without
// Morse, and Morse's own counts; never load times.
const REAL = {
  "nodejs.org fs docs": "https://nodejs.org/api/fs.html",
  "pkg.go.dev net/http": "https://pkg.go.dev/net/http",
  "GitHub file view": "https://github.com/nodejs/node/blob/main/lib/fs.js",
  "pypi.org project": "https://pypi.org/project/requests/",
  "rubygems.org gem": "https://rubygems.org/gems/rails",
};
const TWENTY_MODS = THIRTY_MODS.slice(0, 20); // CSS and a morse.watch each, on every site
let DR = null;
async function realDesktop() {
  // Same home as D: the connector reads its mods from the first home it was given.
  DR ||= await desktop({ home: D.home, headless: !process.env.DISPLAY, args: process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [] });
  return DR;
}
const realPage = (R2, opts = {}) => R2.page({ ...opts, init: [() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask" }); } catch {} }] });
// A busy proxy drops a load now and then: try again, twice.
async function visit(page, url) {
  for (let i = 0; ; i++) {
    try { return await page.goto(url, { waitUntil: "load", timeout: 90000 }); } catch (e) { if (i >= 2) throw e; await sleep(3000); }
  }
}
const morseMs = s => ["mo", "raf", "timeout", "interval", "idle"].reduce((a, k) => a + (s.ms[k] || 0), 0);
const morseMax = s => Math.max(0, ...["mo", "raf", "timeout", "interval", "idle"].map(k => s.max[k] || 0));

// The bar open on a big real page: what its solid backing (50-bar.js Backing)
// and everything else of Morse's costs while you type, point and scroll.
async function realBar() {
  const R2 = await realDesktop();
  await R2.setMods([]);
  const out = {};
  for (const name of Object.keys(REAL).slice(0, 3)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await realPage(R2);
      try {
        await visit(t.page, REAL[name]);
        await sleep(2500);
        await t.page.mouse.move(640, 300);
        await t.page.keyboard.press(OPEN_KEY);
        const end = Date.now() + 20000;
        while (!(await t.barVisible())) { if (Date.now() > end) throw new Error("the bar didn't open"); await sleep(50); }
        await sleep(2000);
        const phase = async fn => {
          await t.main(() => { window.__lt = []; });
          await t.reset();
          await fn();
          const s = await t.snap();
          const lt = await t.main(() => window.__lt);
          return { hitTests: s.counts.hitTests || 0, hitMs: (s.ms.hitTests || 0) + (s.ms.rangeRead || 0), morseMs: morseMs(s), maxMs: morseMax(s), calls: Object.values(s.calls).reduce((a, b) => a + b, 0), longTasks: lt.length };
        };
        const run = {};
        run.typing = await phase(async () => { await t.page.keyboard.type("make the code blocks bigger and easier to read ok", { delay: 70 }); await sleep(500); });
        run.pointing = await phase(async () => { for (let k = 0; k < 40; k++) { await t.page.mouse.move(100 + k * 25, 150 + (k % 5) * 30); await sleep(50); } await sleep(500); });
        run.stepping = await phase(async () => { for (let k = 0; k < 24; k++) { await t.page.mouse.move(200 + k * 20, k % 2 ? 560 : 120); await sleep(100); } await sleep(500); });
        run.scrolling = await phase(async () => { for (let k = 0; k < 30; k++) { await t.page.mouse.wheel(0, 120); await sleep(100); } await sleep(800); });
        await t.page.keyboard.press("Escape");
        await t.page.keyboard.press("Escape");
        await sleep(1500);
        run.closed = await phase(async () => { for (let k = 0; k < 30; k++) { await t.page.mouse.wheel(0, -120); await sleep(100); } await sleep(500); });
        run.errors = t.errors;
        runs.push(run);
      } catch (e) { log(`  real bar ${name}: ${e.message}`); }
      finally { await t.close(); }
    }
    const m = (p, k) => r1(median(runs.map(r => r[p][k])));
    out[name] = Object.fromEntries(["typing", "pointing", "stepping", "scrolling", "closed"].map(p => [p, runs.length ? { hitTests: m(p, "hitTests"), hitMs: m(p, "hitMs"), morseMs: m(p, "morseMs"), maxMs: m(p, "maxMs"), calls: m(p, "calls"), longTasks: m(p, "longTasks") } : null]));
    out[name].runs = runs.length;
    out[name].errors = runs.flatMap(r => r.errors);
    log(`  real bar ${name}: ${JSON.stringify(out[name])}`);
  }
  return out;
}

// Boot on real pages: nothing opened, with 0 and with 20 saved mods.
async function realBoot() {
  const R2 = await realDesktop();
  const once = async (url, morse, mods = false) => {
    const t = await realPage(R2, { morse });
    try {
      await visit(t.page, url);
      const end = Date.now() + 5000;
      while (mods && Date.now() < end && !(await t.main(P => P.marks.css != null && P.marks.js != null).catch(() => false))) await sleep(50);
      await sleep(1500);
      const m = await metrics(t.cdp);
      const s = await t.snap();
      return { m, s, errors: t.errors };
    } finally { await t.close(); }
  };
  const out = {};
  for (const [name, url] of Object.entries(REAL)) {
    const none = [], zero = [], twenty = [];
    try {
      for (let i = 0; i < RUNS; i++) {
        none.push(await once(url, false));
        await R2.setMods([]);
        zero.push(await once(url, true));
        await R2.setMods(TWENTY_MODS);
        twenty.push(await once(url, true, true));
      }
    } catch (e) { log(`  real boot ${name}: ${e.message}`); if (!twenty.length) continue; }
    const base = k => median(none.map(x => x.m[k]));
    const cell = runs => ({
      scriptMs: r1((median(runs.map(x => x.m.ScriptDuration)) - base("ScriptDuration")) * 1000),
      taskMs: r1((median(runs.map(x => x.m.TaskDuration)) - base("TaskDuration")) * 1000),
      heapKB: r1((median(runs.map(x => x.m.JSHeapUsedSize)) - base("JSHeapUsedSize")) / 1024),
      morseMs: r1(median(runs.map(x => morseMs(x.s)))),
      layouts: r1(median(runs.map(x => x.m.LayoutCount)) - base("LayoutCount")),
      layoutReads: median(runs.map(x => x.s.counts.layoutRead || 0)),
      firstCssMs: r1(median(runs.map(x => x.s.marks.css ?? NaN))),
      errors: runs.flatMap(x => x.errors),
    });
    out[name] = { nodes: median(none.map(x => x.m.Nodes)), heapKBWithout: r1(base("JSHeapUsedSize") / 1024), zero: cell(zero), twenty: cell(twenty) };
    log(`  real boot ${name}: ${JSON.stringify(out[name])}`);
  }
  return out;
}

// ---------------------------------------------------------------- run
const steps = { payload: payloadCost, boot, open: openLatency, mods: modsAtScale, spa, effect, extension, lang, flat, realbar: realBar, realboot: realBoot };
for (const [k, fn] of Object.entries(steps)) {
  if (!ONLY.has(k)) continue;
  log(`▸ ${k}`);
  try { R[k] = await fn(); } catch (e) { R[k] = { error: String(e.stack || e) }; console.error(e); }
}
await DR?.close();
await D.close();
await srv.close();

await fs.mkdir(OUT, { recursive: true });
// --only re-measures some sections and keeps the rest of an earlier run with the same label.
if (argv.includes("--only")) {
  try { const old = JSON.parse(await fs.readFile(path.join(OUT, `${LABEL}.json`), "utf8")); for (const k of Object.keys(old)) if (!(k in R)) R[k] = old[k]; } catch {}
}
await fs.writeFile(path.join(OUT, `${LABEL}.json`), JSON.stringify(R, null, 2));
let before = null, beforeReal = null;
const baseline = LABEL.startsWith("before");
if (!baseline) try { before = JSON.parse(await fs.readFile(path.join(OUT, "before.json"), "utf8")); } catch {}
if (!baseline) try { beforeReal = JSON.parse(await fs.readFile(path.join(OUT, "before-real.json"), "utf8")); } catch {}
const md = report(R, before, beforeReal);
if (!baseline) await fs.writeFile(path.join(OUT, "report.md"), md);
console.log("\n" + md);

// ---------------------------------------------------------------- report
function report(now, was, wasReal = null) {
  const v = (o, ...ks) => { for (const k of ks) o = o?.[k]; return o; };
  const cell = (a, b) => (b === undefined || b === null || (typeof b === "number" && Number.isNaN(b)) ? `${fmt(a)}` : `${fmt(b)} → **${fmt(a)}**`);
  const fmt = x => (x === undefined || x === null ? "–" : typeof x === "number" && Number.isNaN(x) ? "–" : typeof x === "boolean" ? (x ? "yes" : "no") : String(x));
  const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(r => `| ${r.join(" | ")} |`)].join("\n");
  const L = [];
  L.push(`# Morse performance report`, "");
  L.push(`Generated by \`node demo/perf.js\` on ${now.date.slice(0, 10)} (${now.runs} runs per cell, medians). ${was ? `Cells read \`before → **after**\`; the baseline is \`docs/perf/before.json\` (${was.date.slice(0, 10)}).` : ""}`);
  L.push("", "Measured in headless Chromium through the real desktop connector (CDP, main world, so every call Morse makes is counted by wrapping the page's built-ins and attributing calls by stack) and, for the last table, through the real unpacked extension. Deltas are against the same page without Morse.", "");
  if (now.payload) {
    L.push("## What every page pays to load Morse", "");
    L.push(table(["", "value"], [
      ["Script injected at page load (bytes)", cell(now.payload.bootBytes, was?.payload?.bootBytes)],
      ["Compile (ms, median of 15, cache busted)", cell(now.payload.compileMs, was?.payload?.compileMs)],
      ["Compile + top-level run on a 10k-node page (ms)", cell(now.payload.compileRunMs, was?.payload?.compileRunMs)],
      ["Full UI, loaded on first open (bytes)", now.split ? fmt(now.payload.fullBytes) : "(always loaded)"],
    ]), "");
  }
  if (now.boot && !now.boot.error) {
    L.push("## Boot: what Morse does on a page nobody opened it on", "", "One saved mod (CSS + a `morse.watch`) applies on each site.", "");
    const rows = [];
    const keys = [["DOM nodes added", "nodes"], ["Listeners Morse adds", "listeners"], ["MutationObservers", "observers"], ["Timers / rAF scheduled", "timers"], ["setInterval", "intervals"],
      ["getComputedStyle calls", "getComputedStyle"], ["Layout reads (rects, offsets)", "layoutReads"], ["Elements created", "elements"], ["Shadow roots", "shadowRoots"], ["Overlay mounted", "uiMountedAtBoot"],
      ["Main-thread script (ms)", "scriptMs"], ["Extra layouts", "layouts"], ["Extra style recalcs", "styleRecalcs"], ["JS heap (KB)", "heapKB"],
      ["First mod CSS applied (ms after navigation)", "firstCssMs"], ["First mod JS applied (ms after navigation)", "firstJsMs"], ["(DOMContentLoaded, ms)", "dclMs"],
      ["Idle: Morse callbacks in 3 s", "idleCallbacks3s"], ["Idle: Morse ms in 3 s", "idleMs3s"]];
    const sites = Object.keys(now.boot);
    for (const [label, k] of keys) rows.push([label, ...sites.map(s => cell(v(now.boot, s, k), v(was, "boot", s, k)))]);
    L.push(table(["", ...sites], rows), "");
  }
  if (now.open) L.push("## Opening Morse", "", `The price of a free boot: the first open on a page fetches and builds the UI${now.payload?.fullBytes ? ` (~${Math.round(now.payload.fullBytes / 1024)} KB)` : ""} from the host. Later opens are instant, as before.`, "", table(["", "value"], [["Hotkey to bar visible, 10k-node page (ms)", cell(now.open.hotkeyToBarMs, was?.open?.hotkeyToBarMs)]]), "");
  if (now.mods && !now.mods.error) {
    L.push("## Mods at scale: 30 `morse.watch` mods on a chat app streaming a reply", "", "A token every 30 ms and a new message every 300 ms for 4 s, 300 messages already on screen.", "");
    const k = [["All 30 mods applied (ms after navigation)", "allAppliedMs"], ["MutationObservers", "observers"], ["Subtree observe() calls", "subtreeObserves"], ["Observer callbacks", "moCallbacks"], ["rAF callbacks", "rafCallbacks"],
      ["Morse ms per second of streaming", "morseMsPerSec"], ["Morse ms per frame", "msPerFrame"], ["Slowest callback (ms)", "maxCallbackMs"]];
    L.push(table(["", "value"], k.map(([l, key]) => [l, cell(now.mods[key], was?.mods?.[key])])), "");
  }
  if (now.spa && !now.spa.error) {
    const k = [["mods.list requests", "modsListRequests"], ["URL change noticed after (median ms)", "detectMedianMs"], ["… worst case (ms)", "detectMaxMs"], ["Navigations never noticed", "missed"], ["Listeners added during the session", "listenersAdded"], ["Observers added during the session", "observersAdded"]];
    L.push(`## Long SPA session: ${now.spa.navigations} pushState navigations, 40 ms apart`, "", table(["", "value"], k.map(([l, key]) => [l, cell(now.spa[key], was?.spa?.[key])])), "");
  }
  if (now.effect && !now.effect.error) {
    const names = Object.keys(now.effect);
    const k = [["Frames drawn in 1.5 s", "frames"], ["Canvas draw calls per frame", "drawCallsPerFrame"], ["Shapes per frame", "shapesPerFrame"], ["Effect JS + canvas calls per frame (CPU profile, ms)", "effectMsPerFrame"], ["Morse rAF ms per frame, wall clock (median run)", "msPerFrame"], ["… best run", "minMsPerFrame"], ["Slowest frame (ms)", "maxFrameMs"],
      ["Main-thread CPU ms per frame (all work)", "cpuMsPerFrame"], ["rAF callbacks/s with the result showing", "rafPerSecIdleOpen"], ["Callbacks/s after closing", "callbacksPerSecIdleClosed"]];
    L.push("## Working effect", "", "Wall-clock frame times depend on how loaded the machine is (headless, software raster, the desktop host's clip recorder encoding frames); draw calls are exact, and the CPU profile isolates the effect's own work. Baseline target cells are from runs where the old effect stayed on screen for the whole sample.", "", table(["", ...names], k.map(([l, key]) => [l, ...names.map(n => cell(v(now.effect, n, key), v(was, "effect", n, key)))])), "");
  }
  if (now.extension && !now.extension.error && !now.extension.skipped) {
    const sites = Object.keys(now.extension);
    const k = [["DOM nodes added", "nodes"], ["Event listeners added", "jsListeners"], ["Main-thread script (ms)", "scriptMs"], ["Extra layouts", "layouts"], ["JS heap (KB)", "heapKB"], ["First mod CSS applied (ms)", "firstCssMs"], ["Overlay mounted", "uiMountedAtBoot"]];
    L.push("## Extension (content script, isolated world)", "", "Playwright's Chromium has Allow User Scripts off, so this section runs the mod's CSS only: with its code, Morse would load its UI once per tab to say the code waits for Allow User Scripts (64-waiting.js). The baseline ran the mod with its code; the old runtime built its UI on every page either way.", "", table(["", ...sites], k.map(([l, key]) => [l, ...sites.map(s => cell(v(now.extension, s, key), v(was, "extension", s, key)))])), "");
  }
  if (now.lang && !now.lang.error && now.lang.en) {
    const L2 = now.lang, W = was?.lang;
    L.push("## Languages: the bar's words", "", "English ships in the UI bundle. Another language is one request to the host (`i18n.words`; the desktop reads `core/locales/<code>.js` once per process, the extension's worker `locales/<code>.json` once while it runs) the first time the bar opens on a page; that first open waits for the words, 1.5 s at most, so the bar never shows English first. 10k-node page, first open (which also loads the UI).", "",
      table(["", "English", "German"], [
        ["Hotkey to bar visible, first open (ms)", cell(L2.en.hotkeyToBarMs, W?.en?.hotkeyToBarMs), cell(L2.de.hotkeyToBarMs, W?.de?.hotkeyToBarMs)],
        ["Word requests, first open", fmt(L2.en.wordsRequests), fmt(L2.de.wordsRequests)],
        ["… closing and opening again", fmt(L2.en.wordsRequestsReopen), fmt(L2.de.wordsRequestsReopen)],
      ]), "");
  }
  if (now.flat && !now.flat.error) {
    const ns = Object.keys(now.flat), F = wasReal?.flat;
    L.push("## A watch over a long flat list", "", `One mod, \`morse.watch("p.flat", el => el.dataset.seen = "")\`, and that many rows added to one parent at once (a feed, a long table, the lines of a file).${F ? ` The baseline (\`docs/perf/before-real.json\`, ${wasReal.date.slice(0, 10)}) copied all of a row's siblings before and after its callback, which is quadratic: from 2,000 rows on it was paused as slow before it got through them.` : ""}`, "",
      table(["Rows", ...ns], [
        ["Every row handled (within 15 s)", ...ns.map(n => cell(now.flat[n].allRows, F?.[n]?.allRows))],
        ["Morse ms", ...ns.map(n => cell(now.flat[n].morseMs, F?.[n]?.morseMs))],
        ["Slowest Morse callback (ms)", ...ns.map(n => cell(now.flat[n].maxMs, F?.[n]?.maxMs))],
      ]), "");
  }
  if (now.realbar && !now.realbar.error) {
    const sites = Object.keys(now.realbar).filter(s => now.realbar[s].runs);
    const k = [["Typing 48 keys: hit tests", "typing", "hitTests"], ["… ms in hit tests and text rects", "typing", "hitMs"], ["… long tasks (any script)", "typing", "longTasks"],
      ["Pointing at the page, 40 moves: hit tests", "pointing", "hitTests"], ["Bar stepping top ↔ bottom 24 times: hit tests", "stepping", "hitTests"], ["… ms in hit tests and text rects", "stepping", "hitMs"],
      ["Scrolling 30 wheel ticks: hit tests", "scrolling", "hitTests"], ["… ms in hit tests and text rects", "scrolling", "hitMs"], ["… slowest Morse callback (ms)", "scrolling", "maxMs"],
      ["Closed, scrolling 30 ticks: Morse callbacks", "closed", "calls"]];
    L.push("## The bar open on big real pages", "", `The bar's solid backing (\`50-bar.js\` Backing) checks for the page's words under the bar with up to 20 \`elementsFromPoint\` hit tests (each needs layout up to date). Real pages in Chromium${wasReal?.realbar ? `; the baseline is \`docs/perf/before-real.json\` (${wasReal.date.slice(0, 10)})` : ""}. Times are wall clock on a heavily loaded machine: compare counts, and times only within a row.`, "",
      table(["", ...sites], k.map(([l, p, key]) => [l, ...sites.map(s => cell(v(now.realbar, s, p, key), v(wasReal, "realbar", s, p, key)))])), "");
  }
  if (now.realboot && !now.realboot.error) {
    const sites = Object.keys(now.realboot);
    const k = [["JS heap (KB)", "heapKB"], ["Morse's own callbacks (ms)", "morseMs"], ["Extra layouts", "layouts"], ["Layout reads by Morse", "layoutReads"], ["First mod CSS applied (ms after navigation)", "firstCssMs"]];
    const rows = [["Elements on the page", ...sites.map(s => fmt(now.realboot[s].nodes))], ["JS heap without Morse (KB)", ...sites.map(s => fmt(now.realboot[s].heapKBWithout))]];
    for (const [n, w] of [["0 mods", "zero"], ["20 mods", "twenty"]]) for (const [l, key] of k) if (w === "twenty" || key !== "firstCssMs") rows.push([`${n}: ${l}`, ...sites.map(s => cell(v(now.realboot, s, w, key), v(wasReal, "realboot", s, w, key)))]);
    L.push("## Boot on real sites, with 0 and with 20 saved mods", "", `Nobody opens Morse. Deltas against the same page without Morse (medians of ${now.runs}); network time differs on every load, so these are memory and Morse's own work, not load times (the page's own script time on a real site varies by a few hundred ms from load to load, more than Morse's whole cost; \`docs/perf/*.json\` keep it anyway). The 20 mods each add CSS and a \`morse.watch\` on every site; most of their heap is the page's elements those watches touch.`, "", table(["", ...sites], rows), "");
  }
  return L.join("\n");
}
