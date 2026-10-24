// Measures what Morse costs the apps it lives in, through the real desktop
// connector (CDP) and the real extension, and writes docs/perf/report.md.
//
//   node demo/perf.js                  # measure, print, write the report
//   node demo/perf.js --label before   # save as the baseline the report compares against
//   node demo/perf.js --runs 5 --only boot,mods
//
// Sections: payload (bytes, compile), boot (per site: what Morse creates and
// costs before anyone opens it), idle (what still runs), open (hotkey to bar),
// mods at scale (30 watch mods on a streaming chat), SPA (URL-change
// detection), effect (frame cost on a 4K target), extension (content script).

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, chromium, serve, desktop, metrics, payloads, median, sleep, ONE_MOD, THIRTY_MODS, runGeneration } from "./perf-lib.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LABEL = arg("--label", "current");
const RUNS = Number(arg("--runs", 3));
const ONLY = new Set(String(arg("--only", "payload,boot,open,mods,spa,effect,extension")).split(","));
const OUT = path.join(ROOT, "docs", "perf");
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
  const snap = await t.page.evaluate(() => window.__perf.snap());
  const dcl = await t.page.evaluate(() => performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd || 0);
  await t.page.evaluate(() => window.__perf.reset());
  await sleep(3000);
  const idle = await t.page.evaluate(() => window.__perf.snap());
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
    await t.page.evaluate(() => window.__perf.watchBar());
    await t.page.keyboard.press("Alt+Space");
    const end = Date.now() + 8000;
    let v = null;
    while (Date.now() < end && v == null) { v = await t.page.evaluate(() => window.__perf.marks.bar != null ? window.__perf.marks.bar - window.__perf.keydown : null); await sleep(20); }
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
    const boot = await t.page.evaluate(() => window.__perf.snap());
    await sleep(500);
    await t.page.evaluate(() => { window.__perf.reset(); window.__perf.countFrames(true); });
    const tokens = await t.page.evaluate(() => window.__stream(4000));
    await sleep(100);
    const s = await t.page.evaluate(() => { window.__perf.countFrames(false); return window.__perf.snap(); });
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
  const before = await t.page.evaluate(() => window.__perf.snap());
  await t.page.evaluate(() => { window.__perf.reset(); window.__perf.sends.length = 0; });
  const N = 60;
  await t.page.evaluate(n => window.__nav(n, 40), N);
  await sleep(1500);
  const after = await t.page.evaluate(() => ({ ...window.__perf.snap(), navs: window.__navs }));
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
  const fxOn = page => page.evaluate(() => window.__perf.roots.some(r => r.querySelector(".fx")?.style.display === "block"));
  const working = page => page.evaluate(() => /working/.test(window.__perf.barClass()));
  const CASES = [["target 3840x2160", "#huge", 3840, 2160], ["page-wide 3840x2160", null, 3840, 2160], ["target 1920x1080", "#huge", 1920, 1080]];
  for (const [name, target, width, height] of CASES) {
    const runs = [];
    let idle = null;
    for (let i = 0; i < RUNS; i++) {
      const t = await D.page({ viewport: { width, height } });
      await t.page.goto(srv.url("/perf/effect.html"));
      await sleep(800);
      await runGeneration(t.page, { target, prompt: "clean up the clutter" });
      let end = Date.now() + 10000;
      while (Date.now() < end && !(await fxOn(t.page))) await sleep(20);
      await sleep(300); // past the first frame, which builds the grid
      // ThreadTime is the main thread's CPU time: it holds up on a loaded machine where wall time doesn't.
      const cpu0 = (await metrics(t.cdp)).ThreadTime;
      await t.page.evaluate(() => { window.__perf.reset(); window.__perf.countFrames(true); });
      await sleep(1500);
      const s = await t.page.evaluate(() => { window.__perf.countFrames(false); return window.__perf.snap(); });
      const cpu1 = (await metrics(t.cdp)).ThreadTime;
      const valid = await fxOn(t.page), f = Math.max(1, s.frames);
      runs.push({ valid, frames: s.frames, rafCallbacks: s.calls.raf || 0, msPerFrame: (s.ms.raf || 0) / f, maxFrameMs: s.max.raf || 0,
        cpuMsPerFrame: ((cpu1 - cpu0) * 1000) / f, drawCallsPerFrame: Math.round(s.canvas.fills / f), shapesPerFrame: Math.round(s.canvas.shapes / f), errors: t.errors });
      if (!idle) {
        end = Date.now() + 30000;
        while (Date.now() < end && (await working(t.page))) await sleep(50);
        await sleep(1500);
        await t.page.evaluate(() => window.__perf.reset());
        await sleep(2000);
        const open = await t.page.evaluate(() => window.__perf.snap());
        await t.page.keyboard.press("Escape");
        await t.page.keyboard.press("Escape");
        await sleep(500);
        await t.page.evaluate(() => window.__perf.reset());
        await sleep(2000);
        const closed = await t.page.evaluate(() => window.__perf.snap());
        idle = { rafPerSecIdleOpen: r1((open.calls.raf || 0) / 2), callbacksPerSecIdleClosed: r1(Object.values(closed.calls).reduce((a, b) => a + b, 0) / 2) };
      }
      await t.close();
    }
    const ok = runs.filter(r => r.valid);
    const m = k => r2(median(ok.map(r => r[k])));
    out[name] = { validRuns: ok.length, frames: m("frames"), rafCallbacks: m("rafCallbacks"), msPerFrame: m("msPerFrame"), minMsPerFrame: r2(Math.min(...ok.map(r => r.msPerFrame))), maxFrameMs: m("maxFrameMs"),
      cpuMsPerFrame: m("cpuMsPerFrame"), drawCallsPerFrame: m("drawCallsPerFrame"), shapesPerFrame: m("shapesPerFrame"), ...idle, errors: runs.flatMap(r => r.errors) };
    log(`  effect ${name}: ${JSON.stringify(out[name])}`);
  }
  return out;
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
  } catch (e) { return { skipped: e.message.split("\n")[0] }; }
  const plain = await chromium.launch({ channel: "chromium", headless: true }).catch(() => chromium.launch());
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 10000 });
    await sw.evaluate(mods => chrome.storage.local.set({ mods: Object.fromEntries(mods.map(m => [m.id, m])), welcomed: true }), ONE_MOD);
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
  } finally { await ctx.close(); await plain.close(); }
}

// ---------------------------------------------------------------- run
const steps = { payload: payloadCost, boot, open: openLatency, mods: modsAtScale, spa, effect, extension };
for (const [k, fn] of Object.entries(steps)) {
  if (!ONLY.has(k)) continue;
  log(`▸ ${k}`);
  try { R[k] = await fn(); } catch (e) { R[k] = { error: String(e.stack || e) }; console.error(e); }
}
await D.close();
await srv.close();

await fs.mkdir(OUT, { recursive: true });
// --only re-measures some sections and keeps the rest of an earlier run with the same label.
if (argv.includes("--only")) {
  try { const old = JSON.parse(await fs.readFile(path.join(OUT, `${LABEL}.json`), "utf8")); for (const k of Object.keys(old)) if (!(k in R)) R[k] = old[k]; } catch {}
}
await fs.writeFile(path.join(OUT, `${LABEL}.json`), JSON.stringify(R, null, 2));
let before = null;
if (LABEL !== "before") try { before = JSON.parse(await fs.readFile(path.join(OUT, "before.json"), "utf8")); } catch {}
const md = report(R, before);
if (LABEL !== "before") await fs.writeFile(path.join(OUT, "report.md"), md);
console.log("\n" + md);

// ---------------------------------------------------------------- report
function report(now, was) {
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
  if (now.open) L.push("## Opening Morse", "", table(["", "value"], [["Hotkey to bar visible, 10k-node page (ms)", cell(now.open.hotkeyToBarMs, was?.open?.hotkeyToBarMs)]]), "");
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
    const k = [["Frames drawn in 1.5 s", "frames"], ["Canvas draw calls per frame", "drawCallsPerFrame"], ["Shapes per frame", "shapesPerFrame"], ["Morse rAF ms per frame (median run)", "msPerFrame"], ["… best run", "minMsPerFrame"], ["Slowest frame (ms)", "maxFrameMs"],
      ["Main-thread CPU ms per frame (all work)", "cpuMsPerFrame"], ["rAF callbacks/s with the result showing", "rafPerSecIdleOpen"], ["Callbacks/s after closing", "callbacksPerSecIdleClosed"]];
    L.push("## Working effect", "", "Wall-clock frame times depend on how loaded the machine is (headless, software raster); draw calls are exact and CPU time per frame is the steadier timing.", "", table(["", ...names], k.map(([l, key]) => [l, ...names.map(n => cell(v(now.effect, n, key), v(was, "effect", n, key)))])), "");
  }
  if (now.extension && !now.extension.error && !now.extension.skipped) {
    const sites = Object.keys(now.extension);
    const k = [["DOM nodes added", "nodes"], ["Event listeners added", "jsListeners"], ["Main-thread script (ms)", "scriptMs"], ["Extra layouts", "layouts"], ["JS heap (KB)", "heapKB"], ["First mod CSS applied (ms)", "firstCssMs"], ["Overlay mounted", "uiMountedAtBoot"]];
    L.push("## Extension (content script, isolated world)", "", table(["", ...sites], k.map(([l, key]) => [l, ...sites.map(s => cell(v(now.extension, s, key), v(was, "extension", s, key)))])), "");
  }
  return L.join("\n");
}
