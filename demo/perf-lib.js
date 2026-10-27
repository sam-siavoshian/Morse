// Shared harness for demo/perf.js and tests/perf.test.js: serves the demo
// sites plus synthetic pages, attaches the real desktop connector (CDP) to
// Playwright pages, and instruments the page's main world so every listener,
// observer, timer, layout read and element Morse creates is counted.
//
// Attribution: Morse's code is injected over CDP and has no URL, so a call
// whose stack holds no http(s)/file frame is Morse's (runtime, kit or a mod);
// anything with a page frame is the page's. The instrumentation itself uses
// the originals, so it never counts itself.
//
// Two worlds: on the desktop the runtime lives in an isolated world ("morse")
// and mod code in the page's main world, so the same instrumentation runs in
// both and a page's snapshot (t.snap()) adds them up.

import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
export { chromium };

// The default Open Morse hotkey: Ctrl+Alt+Space (core/hotkeys.js), in Playwright's key names.
import { defaultHotkeys } from "../core/hotkeys.js";
const HK_PLATFORM = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
export const OPEN_KEY = defaultHotkeys(HK_PLATFORM).open.replaceAll("Ctrl", "Control");
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
export const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

// ---- the injected payloads (works against older checkouts too)
export async function payloads() {
  const b = await import(`${ROOT}/runtime/bundle.js`);
  const full = b.bundleRuntime();
  const boot = b.bundleBoot ? b.bundleBoot() : full;
  return { full, boot, split: !!b.bundleBoot, ui: b.bundleUI ? b.bundleUI() : null };
}

// ---- pages
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function bigPage() {
  // ~10k elements: a header, a nav, 100 sections of 30 list items each.
  let s = `<!doctype html><html><head><meta charset="utf-8"><title>Big</title><style>body{font:14px system-ui;margin:0}section{padding:8px 16px}li{display:flex;gap:6px}</style></head><body><header><nav>`;
  for (let i = 0; i < 20; i++) s += `<a href="#s${i}">Section ${i}</a> `;
  s += `</nav><button id="menu">Menu</button></header><main>`;
  for (let i = 0; i < 100; i++) {
    s += `<section id="s${i}" class="sec"><h2>Section ${i}</h2><ul>`;
    for (let j = 0; j < 30; j++) s += `<li class="row"><a href="#${i}-${j}">Item ${j}</a><span class="meta">meta ${i}.${j}</span></li>`;
    s += `</ul></section>`;
  }
  return s + `</main><div id="big-target" style="height:10px"></div></body></html>`;
}

function chatPage() {
  // A chat app that streams a model's reply token by token: a new message
  // every 300ms, a token into the newest one every 30ms (text and spans).
  let s = `<!doctype html><html><head><meta charset="utf-8"><title>Chat</title><style>body{font:14px system-ui;margin:0;background:#fafafa}.msg{padding:8px 14px;border-bottom:1px solid #eee}.author{font-weight:600}.body span{color:#333}</style></head><body><header><h1>Chat</h1><button class="new">New chat</button></header><main id="log">`;
  for (let i = 0; i < 300; i++) s += `<div class="msg" data-i="${i}"><div class="author">${i % 2 ? "Assistant" : "You"}</div><div class="body"><p>Message number ${i} with <b>some</b> text and a <a href="#">link</a>.</p></div><div class="tools"><button class="copy">Copy</button><button class="like">Like</button><time>12:${String(i % 60).padStart(2, "0")}</time></div></div>`;
  s += `</main><form id="composer"><textarea></textarea><button>Send</button></form>
<script>
  window.__stream = ms => new Promise(done => {
    const log = document.getElementById("log"), end = performance.now() + ms;
    let body = null, n = 0;
    const msg = () => {
      const m = document.createElement("div"); m.className = "msg";
      m.innerHTML = '<div class="author">Assistant</div><div class="body"><p></p></div><div class="tools"><button class="copy">Copy</button><button class="like">Like</button><time>now</time></div>';
      log.append(m); body = m.querySelector("p");
    };
    msg();
    const t1 = setInterval(msg, 300);
    const t2 = setInterval(() => {
      if (performance.now() > end) { clearInterval(t1); clearInterval(t2); done(n); return; }
      n++;
      if (n % 5) body.append("tok" + n + " "); else { const b = document.createElement("span"); b.textContent = "word" + n + " "; body.append(b); }
    }, 30);
  });
</script></body></html>`;
  return s;
}

function spaPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>SPA</title></head><body><nav><a href="/perf/spa/a">A</a><a href="/perf/spa/b">B</a></nav><main id="view"><h1>Home</h1></main>
<script>
  window.__navs = [];
  window.__nav = async (n, gap = 20) => {
    for (let i = 0; i < n; i++) {
      const view = document.getElementById("view");
      view.innerHTML = "<h1>Page " + i + "</h1>" + "<p>content</p>".repeat(20);
      window.__navs.push(performance.now());
      history.pushState({ i }, "", "/perf/spa/" + i);
      await new Promise(r => setTimeout(r, gap));
    }
  };
</script></body></html>`;
}

// The effect's worst case: a target that fills a 4K screen.
const effectPage = () => `<!doctype html><html><head><meta charset="utf-8"><title>Effect</title><style>body{margin:0;font:14px system-ui}#huge{position:absolute;inset:20px;background:#eef;border:1px solid #99c}</style></head><body><div id="huge"><article class="wrap"><h1>Huge target</h1><p>Content for the reading-mode change.</p></article></div></body></html>`;

export const SYNTHETIC = { "/perf/big.html": bigPage, "/perf/chat.html": chatPage, "/perf/spa.html": spaPage, "/perf/effect.html": effectPage };

export function serve() {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/perf/spa")) p = "/perf/spa.html";
    if (SYNTHETIC[p]) { res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(SYNTHETIC[p]()); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(file);
      const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
      if (p.startsWith("/demo/sites/parley/")) headers["Content-Security-Policy"] = "script-src 'self'";
      res.writeHead(200, headers).end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({
    url: p => `http://127.0.0.1:${server.address().port}${p}`,
    close: () => new Promise(c => { server.closeAllConnections?.(); server.close(c); }),
  })));
}

// ---- instrumentation (runs in the page before anything else)
export function instrument() {
  if (window.__perf) return;
  const O = {
    ael: EventTarget.prototype.addEventListener, MO: window.MutationObserver,
    st: window.setTimeout, si: window.setInterval, raf: window.requestAnimationFrame, ric: window.requestIdleCallback,
    gcs: window.getComputedStyle, gbcr: Element.prototype.getBoundingClientRect, gcr: Element.prototype.getClientRects,
    ce: Document.prototype.createElement, as: Element.prototype.attachShadow,
    now: performance.now.bind(performance), Error: window.Error,
  };
  const P = window.__perf = {
    counts: {}, calls: {}, ms: {}, max: {}, marks: {}, roots: [], sends: [], keydown: 0, frames: 0,
    reset() { this.counts = {}; this.calls = {}; this.ms = {}; this.max = {}; this.frames = 0; this.canvas = { fills: 0, shapes: 0 }; },
    snap() { return JSON.parse(JSON.stringify({ counts: this.counts, calls: this.calls, ms: this.ms, max: this.max, marks: this.marks, sends: this.sends, frames: this.frames, canvas: this.canvas, pageErrors: this.pageErrors || [], keydown: this.keydown })); },
  };
  const RE = /\b(https?|file):\/\/|UtilityScript/; // page frames, or Playwright's own evaluate
  const ours = () => { const l = Error.stackTraceLimit; Error.stackTraceLimit = 60; const s = new O.Error().stack; Error.stackTraceLimit = l; return !RE.test(s); };
  const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
  const timed = (kind, fn) => typeof fn !== "function" ? fn : function (...a) {
    const t = O.now();
    try { return fn.apply(this, a); } finally { const d = O.now() - t; inc(P.calls, kind); inc(P.ms, kind, d); if (!(P.max[kind] >= d)) P.max[kind] = d; }
  };
  // Frame counter and "bar became visible" probe, on the original rAF (never counted).
  let counting = false;
  P.countFrames = on => { counting = on; if (on) { const f = () => { if (!counting) return; P.frames++; O.raf.call(window, f); }; O.raf.call(window, f); } };
  P.watchBar = () => { const f = () => { if (P.barVisible()) { P.marks.bar = O.now(); return; } O.raf.call(window, f); }; O.raf.call(window, f); };

  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (ours()) inc(P.counts, `listen:${this === window ? "window" : this === document ? "document" : "node"}`);
    return O.ael.call(this, type, fn, opts);
  };
  window.MutationObserver = class extends O.MO {
    constructor(fn) { const m = ours(); super(m ? timed("mo", fn) : fn); if (m) inc(P.counts, "observer"); this.__m = m; }
    observe(t, o) { if (this.__m) inc(P.counts, `observe${o && o.subtree ? ":subtree" : ""}`); return super.observe(t, o); }
  };
  window.setTimeout = function (fn, ms, ...a) { if (ours()) { inc(P.counts, "setTimeout"); fn = timed("timeout", fn); } return O.st.call(window, fn, ms, ...a); };
  window.setInterval = function (fn, ms, ...a) { if (ours()) { inc(P.counts, "setInterval"); fn = timed("interval", fn); } return O.si.call(window, fn, ms, ...a); };
  window.requestAnimationFrame = function (fn) {
    if (ours()) { inc(P.counts, "raf"); fn = timed("raf", fn); if (P.trace) P.trace.push(new O.Error().stack); } // P.trace = [] to see who schedules frames
    return O.raf.call(window, fn);
  };
  if (O.ric) window.requestIdleCallback = function (fn, o) { if (ours()) { inc(P.counts, "idle"); fn = timed("idle", fn); } return O.ric.call(window, fn, o); };
  window.getComputedStyle = function (...a) { if (ours()) inc(P.counts, "getComputedStyle"); return O.gcs.apply(window, a); };
  Element.prototype.getBoundingClientRect = function () { if (ours()) inc(P.counts, "layoutRead"); return O.gbcr.call(this); };
  Element.prototype.getClientRects = function () { if (ours()) inc(P.counts, "layoutRead"); return O.gcr.call(this); };
  for (const k of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, { ...d, get() { if (ours()) inc(P.counts, "layoutRead"); return d.get.call(this); } });
  }
  // Hit tests and text-range rects: each one needs layout up to date. "hitTests" are the
  // list kind (elementsFromPoint: the bar's solid backing, 50-bar.js Backing; the page
  // outline); "hitTest" the single one (the picker, on each pointer move).
  for (const [proto, k, kind] of [[Document.prototype, "elementsFromPoint", "hitTests"], [Document.prototype, "elementFromPoint", "hitTest"], [Range.prototype, "getClientRects", "rangeRead"], [Range.prototype, "getBoundingClientRect", "rangeRead"]]) {
    const f = proto[k];
    proto[k] = function (...a) {
      if (!ours()) return f.apply(this, a);
      const t = O.now();
      try { return f.apply(this, a); } finally { inc(P.counts, kind); inc(P.ms, kind, O.now() - t); }
    };
  }
  Document.prototype.createElement = function (...a) { if (ours()) inc(P.counts, "createElement"); return O.ce.apply(this, a); };
  // Canvas work (no attribution: too hot to take a stack; the effect page has no canvas of its own).
  P.canvas = { fills: 0, shapes: 0 };
  const C2 = CanvasRenderingContext2D.prototype;
  for (const k of ["fill", "fillRect", "stroke", "drawImage"]) { const f = C2[k]; C2[k] = function (...a) { P.canvas.fills++; return f.apply(this, a); }; }
  for (const k of ["rect", "roundRect", "arcTo"]) { const f = C2[k]; if (f) C2[k] = function (...a) { P.canvas.shapes++; return f.apply(this, a); }; }
  Element.prototype.attachShadow = function (o) { const r = O.as.call(this, o); if (ours()) { inc(P.counts, "shadowRoot"); P.roots.push(r); } return r; };

  // Marks: when the first mod CSS and mod element land, when the overlay mounts.
  const mark = k => { if (P.marks[k] == null) P.marks[k] = O.now(); };
  const seen = n => {
    if (n.nodeType !== 1) return;
    if (n.matches("style[data-morse-css]")) mark("css");
    if (n.matches("[data-morse]")) mark("js");
    if (n.matches("[data-morse-ui]")) mark("ui");
  };
  new O.MO(recs => { for (const r of recs) for (const n of r.addedNodes) seen(n); }).observe(document, { childList: true, subtree: true });
  // The default Open Morse hotkey (Ctrl+Alt+Space).
  O.ael.call(window, "keydown", e => { if (e.code === "Space" && (e.altKey || e.ctrlKey)) P.keydown = O.now(); }, true);
  // Anything that reaches the page's own error handlers.
  P.pageErrors = [];
  O.ael.call(window, "error", e => P.pageErrors.push(String(e.message || e.error)));
  O.ael.call(window, "unhandledrejection", e => P.pageErrors.push("unhandled rejection: " + String(e.reason && e.reason.message || e.reason)));
  // Every request the runtime sends to the desktop host (binding installed by the connector).
  const b = globalThis.__morseHostSend;
  if (typeof b === "function") globalThis.__morseHostSend = s => { try { P.sends.push([JSON.parse(s).type, O.now()]); } catch {} return b(s); };
  P.barVisible = () => P.roots.some(r => { const bar = r.querySelector(".bar"); return bar && !bar.hidden; });
  P.barClass = () => P.roots.map(r => r.querySelector(".bar")?.className || "").join(" ");
}

// ---- the desktop path: a Chromium with a debugging port and the real connector
// A home it made itself (no `home` given) is removed by close().
export async function desktop({ home, headless = true, args = [] } = {}) {
  const ownHome = !home;
  home ||= await fs.mkdtemp(path.join(os.tmpdir(), "morse-perf-"));
  process.env.MORSE_HOME = home;
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  // Steady-state page loads: the once-per-window welcome toast (which loads the
  // UI when the page goes idle) would otherwise land in every new test window.
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false })).catch(() => {});
  const port = await freePort();
  const launchArgs = [`--remote-debugging-port=${port}`, ...args];
  let browser;
  try { browser = await chromium.launch({ channel: "chromium", headless, args: launchArgs }); }
  catch { browser = await chromium.launch({ headless, args: launchArgs }); }
  const conn = await import(`${ROOT}/daemon/connector.js`);
  const { Connector } = conn, WORLD = conn.WORLD || null;
  const { listTargets } = await import(`${ROOT}/daemon/cdp.js`);
  const connector = new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  return {
    browser, home, connector,
    async setMods(mods) {
      const dir = path.join(home, "mods");
      for (const f of await fs.readdir(dir)) await fs.rm(path.join(dir, f));
      for (const m of mods) await fs.writeFile(path.join(dir, `${m.id}.json`), JSON.stringify(m));
    },
    // A fresh page, instrumented; with morse=true the connector is attached
    // before the first navigation, exactly as `morse launch` does it.
    // init: scripts for the page's world; morseInit: for Morse's world, before its boot.
    async page({ morse = true, viewport = { width: 1280, height: 800 }, init = [], morseInit = [], debug = false } = {}) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript(instrument);
      if (debug) await ctx.addInitScript(() => { try { localStorage.setItem("morse:debug", "1"); } catch {} });
      for (const s of init) await ctx.addInitScript(s);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Performance.enable");
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      // Morse's own world, instrumented before the connector's boot script.
      let world = null;
      if (WORLD) {
        const frameId = (await cdp.send("Page.getFrameTree")).frameTree.frame.id;
        cdp.on("Runtime.executionContextCreated", ({ context: c }) => { if (c.name === WORLD && c.auxData?.frameId === frameId) world = c.id; });
        cdp.on("Runtime.executionContextsCleared", () => { world = null; });
        await cdp.send("Runtime.enable");
        await cdp.send("Page.enable");
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${instrument})()`, worldName: WORLD });
        for (const fn of morseInit) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${fn})()`, worldName: WORLD });
      }
      if (morse) {
        const { targetInfo } = await cdp.send("Target.getTargetInfo");
        const t = (await listTargets(port)).find(x => x.id === targetInfo.targetId);
        await connector.attach(t);
      }
      const main = fn => page.evaluate(`(${fn})(window.__perf)`);
      // In Morse's world (the main world on older checkouts, where it ran there).
      const inMorse = async fn => {
        if (!WORLD) return main(fn);
        if (world == null) return null;
        const r = await cdp.send("Runtime.evaluate", { expression: `(${fn})(window.__perf)`, contextId: world, returnByValue: true, awaitPromise: true }).catch(() => null);
        return r?.result?.value ?? null;
      };
      const both = async fn => { const a = await main(fn); if (WORLD) await inMorse(fn); return a; };
      const sum = (x = {}, y = {}) => { const o = { ...x }; for (const [k, v] of Object.entries(y)) o[k] = (o[k] || 0) + v; return o; };
      // One snapshot of everything Morse did in this page, both worlds.
      async function snap() {
        const a = await main(P => P.snap());
        const b = WORLD ? await inMorse(P => P.snap()) : null;
        if (!b) return a;
        const max = { ...a.max };
        for (const [k, v] of Object.entries(b.max)) max[k] = Math.max(max[k] || 0, v);
        return { ...a, counts: sum(a.counts, b.counts), calls: sum(a.calls, b.calls), ms: sum(a.ms, b.ms), max,
          marks: { ...b.marks, ...a.marks }, sends: b.sends.length ? b.sends : a.sends, canvas: sum(a.canvas, b.canvas) };
      }
      return {
        ctx, page, cdp, errors, close: () => ctx.close(),
        main, morse: inMorse, both, snap,
        reset: () => both(P => P.reset()),
        barVisible: () => inMorse(P => P.barVisible()),
        barClass: () => inMorse(P => P.barClass()),
        fxOn: () => inMorse(P => P.roots.some(r => r.querySelector(".fx")?.style.display === "block")),
        // Morse's host requests (the binding lives in Morse's world), on the page's clock.
        sends: async () => (await inMorse(P => P.sends)) || [],
        clearSends: () => inMorse(P => { P.sends.length = 0; }),
      };
    },
    async close() {
      await browser.close().catch(() => {});
      await Promise.race([connector.stop().catch(() => {}), sleep(2000)]); // its file watchers; the windows are gone
      if (ownHome) await fs.rm(home, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function metrics(cdp) {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(m => [m.name, m.value]));
}

// Mods for the scenarios. hosts ["*"] matches every test origin.
export function mod(id, css, js, extra = {}) {
  const now = new Date(Date.now() - 1000).toISOString();
  return { morse: 1, id, title: id, prompt: id, match: { hosts: ["*"], app: null }, target: null, css, js, enabled: true, model: null, created: now, updated: now, ...extra };
}
export const ONE_MOD = [mod("perfone", "header { outline: 1px solid transparent; }", `morse.watch("header, body > nav, main", el => el.prepend(morse.el("span", { text: "", class: "perf-mark" })));`)];
const WATCH_SELECTORS = [".msg", ".msg .author", ".msg .body", ".msg time", "button.copy", "button.like", "header h1", "#composer textarea", "a", "li.row", "section h2", ".meta",
  "main p", "nav a", "header button", ".tools", ".body span", "form button", "[data-i]", ".msg:last-child", "h1", "h2", "ul > li:first-child", "time", "b", "p a", "#log > div", ".sec", "body > header", "main > *"];
export const THIRTY_MODS = WATCH_SELECTORS.map((sel, i) => mod(`perf${String(i).padStart(2, "0")}`,
  `${sel.split(",")[0]} { --perf-${i}: 1; }`,
  `morse.watch(${JSON.stringify(sel)}, el => { el.dataset.p${i} = ""; });`));

// Morse's own trace of the effect: drives the real bar, page-wide or on a target.
export async function runGeneration(t, { target = null, prompt = "make it calmer" } = {}) {
  const page = t.page;
  await page.keyboard.press(OPEN_KEY);
  const end = Date.now() + 15000;
  while (!(await t.barVisible())) { if (Date.now() > end) throw new Error("the bar didn't open"); await sleep(25); }
  if (target) {
    const r = await page.locator(target).boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 3 });
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await sleep(150);
  }
  await page.keyboard.type(prompt);
  await page.keyboard.press("Enter");
}
