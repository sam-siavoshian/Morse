// Soak tests: shared measuring and reporting. Each scenario (extension.js,
// desktop.js, mods.js) drives Morse for a long time and samples, every few
// iterations:
//   - the page: JS heap (after a forced GC), DOM nodes, JS event listeners
//     and documents (Performance.getMetrics), listeners on window and
//     document (DOMDebugger.getEventListeners), and per JS world (the page's
//     own, Morse's isolated world, the user-scripts world) the number of live
//     MutationObservers and of detached elements JS still holds
//     (Runtime.queryObjects)
//   - the service worker (extension): heap, chrome.storage bytes
//   - the daemon (desktop): RSS, heap, open CDP sessions, its maps' sizes
//   - per-iteration latency of each step, and console errors / unhandled
//     rejections from every world
// Samples go to a JSON file; report() turns them into the tables in
// docs/perf/soak.md and verdict() says what grew without bound.
import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// --name=value flags with defaults, numbers kept numbers. MORSE_SOAK_SHORT=1
// (and --short) picks the CI profile each scenario defines.
export function args(defaults, short = {}) {
  const out = { ...defaults };
  const isShort = process.argv.includes("--short") || process.env.MORSE_SOAK_SHORT === "1";
  if (isShort) Object.assign(out, short, { short: true });
  for (const a of process.argv.slice(2)) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const k = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const v = m[2] ?? "true";
    out[k] = v !== "" && !isNaN(+v) ? +v : v === "true" ? true : v === "false" ? false : v;
  }
  return out;
}

// ---- a raw CDP client on the browser endpoint, with flat sessions (the
// service worker isn't reachable from Playwright's page sessions)
export class BrowserCDP {
  static async connect(port) {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    return new BrowserCDP(ws, port);
  }
  constructor(ws, port) {
    Object.assign(this, { ws, port, seq: 0, pending: new Map(), subs: new Set() });
    ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.id != null) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
      } else for (const f of this.subs) f(m);
    });
    ws.addEventListener("close", () => { for (const p of this.pending.values()) p.reject(new Error("closed")); this.pending.clear(); });
  }
  send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer in ${timeout}ms`)); }, timeout);
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); }, method });
    });
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  close() { try { this.ws.close(); } catch {} }
}

// ---- per JS world counts, through Runtime.queryObjects (which collects
// garbage first, so what it finds is really held)
async function countIn(send, contextId, protoExpr, fn = "function () { return this.length; }") {
  const proto = await send("Runtime.evaluate", { expression: protoExpr, contextId, objectGroup: "soak" });
  if (!proto?.result?.objectId) return null;
  const q = await send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "soak" });
  const n = await send("Runtime.callFunctionOn", { objectId: q.objects.objectId, functionDeclaration: fn, returnByValue: true });
  return n?.result?.value ?? null;
}
// (Prototype objects inherit from Element.prototype too: they throw.)
const DETACHED = "function () { let n = 0; for (const e of this) try { if (!e.isConnected) n++; } catch {} return n; }";

// A page's numbers. `send` is a CDP send for that page's target (a Playwright
// CDPSession or a flat session on BrowserCDP). Contexts are tracked from
// Runtime.executionContextCreated events.
export class PageProbe {
  static async forPage(page) {
    const cdp = await page.context().newCDPSession(page);
    const p = new PageProbe((m, a) => cdp.send(m, a), f => { for (const e of ["Runtime.executionContextCreated", "Runtime.executionContextDestroyed", "Runtime.executionContextsCleared", "Runtime.exceptionThrown", "Runtime.consoleAPICalled"]) cdp.on(e, params => f({ method: e, params })); });
    p.detach = () => cdp.detach().catch(() => {});
    p.cdp = cdp;
    await p.start();
    return p;
  }
  constructor(send, subscribe) {
    this.send = send;
    this.contexts = new Map();
    this.errors = [];
    subscribe(({ method, params }) => {
      if (method === "Runtime.executionContextCreated") this.contexts.set(params.context.id, params.context);
      else if (method === "Runtime.executionContextDestroyed") this.contexts.delete(params.executionContextId);
      else if (method === "Runtime.executionContextsCleared") this.contexts.clear();
      else if (method === "Runtime.exceptionThrown") {
        const d = params.exceptionDetails;
        this.errors.push({ kind: "exception", world: this.worldOf(d.executionContextId), text: (d.exception?.description || d.text || "").split("\n")[0].slice(0, 300) });
      } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        this.errors.push({ kind: "console.error", world: this.worldOf(params.executionContextId), text: params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300) });
      }
    });
  }
  worldOf(id) {
    const c = this.contexts.get(id);
    if (!c) return "?";
    return c.auxData?.isDefault ? "page" : c.name || c.auxData?.type || "isolated";
  }
  async start() {
    await this.send("Runtime.enable");
    await this.send("Performance.enable").catch(() => {});
    await this.send("DOM.enable").catch(() => {});
  }
  async topFrame() {
    const t = await this.send("Page.getFrameTree").catch(() => null);
    return t?.frameTree?.frame?.id || null;
  }
  // { heapMB, nodes, listeners, documents, winListeners, docListeners, worlds: { page: { mo, detached }, morse: {...} } }
  async sample({ detached = true } = {}) {
    const out = { worlds: {} };
    await this.send("HeapProfiler.collectGarbage").catch(() => {});
    const m = await this.send("Performance.getMetrics").catch(() => null);
    const get = k => m?.metrics.find(x => x.name === k)?.value ?? null;
    out.heapMB = +(get("JSHeapUsedSize") / 1048576).toFixed(2);
    out.nodes = get("Nodes"); out.listeners = get("JSEventListeners"); out.documents = get("Documents");
    const frameId = await this.topFrame();
    const ctxs = [...this.contexts.values()].filter(c => c.auxData?.frameId === frameId);
    for (const c of ctxs) {
      if (/^__playwright/.test(c.name)) continue;
      // Which world it is, by what lives there: Morse's runtime, the mod kit
      // (the page's own world on the desktop, the user-scripts world in the
      // extension), or neither.
      let name = c.auxData?.isDefault ? "page" : c.name || "isolated";
      try {
        const r = await this.send("Runtime.evaluate", { expression: "[!!globalThis.__morseRuntime, !!globalThis.morse?.__kit]", contextId: c.id, returnByValue: true });
        const [runtime, kit] = r?.result?.value || [];
        if (runtime) name = "runtime"; else if (kit && !c.auxData?.isDefault) name = "mods";
        else if (kit) name = "page+mods";
      } catch {}
      if (out.worlds[name]) name += `#${c.id}`;
      try {
        const w = out.worlds[name] = { mo: await countIn(this.send, c.id, "MutationObserver.prototype") };
        if (detached) w.detached = await countIn(this.send, c.id, "Element.prototype", DETACHED);
        if (c.auxData?.isDefault) {
          out.main = w; // the page's own world, whatever runs there
          // nodes in the page and in Morse's overlay (its shadow root is open in debug mode)
          const dom = await this.send("Runtime.evaluate", { contextId: c.id, returnByValue: true, expression: `(() => {
            const count = r => { let n = 0; const w = document.createTreeWalker(r, 0xFFFFFFFF); while (w.nextNode()) n++; return n; };
            const ui = document.querySelector("[data-morse-ui]")?.shadowRoot;
            return { page: count(document), ui: ui ? count(ui) : null, styles: document.querySelectorAll("style[data-morse-css]").length, made: document.querySelectorAll("[data-morse]").length };
          })()` });
          out.dom = dom.result?.value;
          // window and document listeners (getEventListeners returns those of every world)
          for (const [k, expr] of [["winListeners", "window"], ["docListeners", "document"]]) {
            const o = await this.send("Runtime.evaluate", { expression: expr, contextId: c.id, objectGroup: "soak" });
            const l = await this.send("DOMDebugger.getEventListeners", { objectId: o.result.objectId });
            out[k] = l.listeners.length;
          }
        }
      } catch (e) { out.worlds[name] = { error: e.message.slice(0, 80) }; }
    }
    await this.send("Runtime.releaseObjectGroup", { objectGroup: "soak" }).catch(() => {});
    return out;
  }
  takeErrors() { const e = this.errors; this.errors = []; return e; }
}

// ---- timing each step of an iteration
export class Steps {
  constructor() { this.times = {}; this.fails = {}; this.lastErrors = []; }
  // A step that takes over `limit` ms counts as hung (a wedge): it fails and
  // the loop goes on.
  async run(name, fn, limit = 120000) {
    const t0 = performance.now();
    let timer;
    try {
      await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`hung for ${limit / 1000}s`)), limit); })]);
      return true;
    }
    catch (e) {
      this.fails[name] = (this.fails[name] || 0) + 1;
      const msg = String(e.message || e), where = /waiting for (locator\(.*?\)(?:\.\w+\(.*?\))*)/.exec(msg)?.[1] || "";
      this.lastErrors.push(`${this.ctx ? `[${this.ctx}] ` : ""}${name}: ${msg.split("\n")[0].slice(0, 200)}${where ? ` [${where.slice(0, 160)}]` : ""}`);
      if (this.lastErrors.length > 40) this.lastErrors.shift();
      return false;
    } finally {
      clearTimeout(timer);
      (this.times[name] ||= []).push(performance.now() - t0);
    }
  }
}

// ---- the record of a run
export class Run {
  constructor(name, file) { Object.assign(this, { name, file, samples: [], iterations: [], errors: [], started: Date.now(), meta: {} }); }
  iter(i, ms, extra = {}) { this.iterations.push({ i, ms: Math.round(ms), t: Date.now() - this.started, ...extra }); }
  sample(i, data) { this.samples.push({ i, t: Date.now() - this.started, ...data }); }
  error(where, e) { if (this.errors.length < 2000) this.errors.push({ t: Date.now() - this.started, where, ...e }); }
  async save(steps) {
    this.ended = Date.now();
    const out = { name: this.name, meta: this.meta, started: this.started, ended: this.ended, samples: this.samples, iterations: this.iterations, errors: this.errors,
      steps: steps && Object.fromEntries(Object.entries(steps.times).map(([k, v]) => [k, summarize(v)])), fails: steps?.fails, lastErrors: steps?.lastErrors };
    if (this.file) { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(out, null, 1)); }
    return out;
  }
}

export function summarize(v) {
  const s = [...v].sort((a, b) => a - b);
  const q = p => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0);
  return { n: v.length, p50: q(0.5), p95: q(0.95), max: Math.round(s.at(-1) || 0) };
}

// Least-squares slope of y over x.
export function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

// Reads a dotted path out of a sample ("page.heapMB", "page.worlds.morse.mo").
export const pick = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

// Growth of each series between the first and the last third of the run
// (medians, so one noisy sample doesn't decide), and the slope over the last
// two thirds per 100 iterations. A series "grows" when its last third is
// above the first by more than `tolerance` (absolute, per series) and the
// slope over the second half is still positive.
export function growth(samples, series, tolerance = {}) {
  const out = {};
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  for (const key of series) {
    const pts = samples.map(s => [s.i, pick(s, key)]).filter(([, v]) => typeof v === "number");
    if (pts.length < 3) continue;
    const third = Math.max(1, Math.floor(pts.length / 3));
    const first = med(pts.slice(0, third).map(p => p[1])), last = med(pts.slice(-third).map(p => p[1]));
    const half = pts.slice(Math.floor(pts.length / 2));
    const per100 = slope(half.map(p => p[0]), half.map(p => p[1])) * 100;
    const tol = tolerance[key] ?? tolerance["*"] ?? 0;
    out[key] = { first, last, max: Math.max(...pts.map(p => p[1])), per100: +per100.toFixed(3), grows: last - first > tol && per100 > 0 };
  }
  return out;
}

// Latency drift: median iteration time of the first third vs the last third.
export function drift(iterations, factor = 1.5, minMs = 150) {
  if (iterations.length < 6) return null;
  const third = Math.floor(iterations.length / 3);
  const med = a => { const s = a.map(x => x.ms).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const first = med(iterations.slice(0, third)), last = med(iterations.slice(-third));
  return { first, last, drifts: last > first * factor && last - first > minMs };
}

// A text sparkline for the tables.
export function spark(values) {
  const v = values.filter(x => typeof x === "number");
  if (!v.length) return "";
  const lo = Math.min(...v), hi = Math.max(...v), bars = "▁▂▃▄▅▆▇█";
  const step = Math.max(1, Math.ceil(v.length / 24));
  const pts = [];
  for (let i = 0; i < v.length; i += step) pts.push(v[i]);
  return pts.map(x => bars[hi === lo ? 0 : Math.min(7, Math.floor(((x - lo) / (hi - lo)) * 8))]).join("");
}

// A markdown table: series, first, last, max, slope, trend.
export function table(samples, series, g) {
  const rows = ["| Series | First third | Last third | Max | Per 100 iterations | Over time |", "|---|---:|---:|---:|---:|---|"];
  for (const key of series) {
    const r = g[key];
    if (!r) continue;
    rows.push(`| ${key}${r.grows ? " **grows**" : ""} | ${r.first} | ${r.last} | ${r.max} | ${r.per100} | \`${spark(samples.map(s => pick(s, key)))}\` |`);
  }
  return rows.join("\n");
}

export function stepTable(steps, fails = {}) {
  const rows = ["| Step | Runs | p50 ms | p95 ms | Max ms | Failed |", "|---|---:|---:|---:|---:|---:|"];
  for (const [k, v] of Object.entries(steps || {})) rows.push(`| ${k} | ${v.n} | ${v.p50} | ${v.p95} | ${v.max} | ${fails[k] || 0} |`);
  return rows.join("\n");
}

// ---- the gallery list for the demo sites, with their usual ports
// (127.0.0.1:8787-8789 in site/mods/index.json) swapped for this run's
export async function galleryServer(ports) {
  const swap = s => s.replaceAll("127.0.0.1:8787", `127.0.0.1:${ports.parley}`).replaceAll("127.0.0.1:8788", `127.0.0.1:${ports.byte}`).replaceAll("127.0.0.1:8789", `127.0.0.1:${ports.tunes}`);
  const server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!p.startsWith("/site/mods/") || p.includes("..")) return res.writeHead(404).end();
    try { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=600" }).end(swap(await fs.readFile(path.join(root, p), "utf8"))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/site/mods/index.json`, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

// Chat that keeps streaming (scenario 3 and the Parley tab): a new message
// every `every` ms, written a few words at a time like a model's answer.
// Old messages are trimmed to `keep`, as chat apps virtualize long threads,
// so the page's own DOM stays level and only Morse's growth would show.
// Runs in the page's world (CDP evaluation isn't bound by Parley's CSP).
export const STREAM = ({ every = 400, keep = 40 } = {}) => `(() => {
  if (window.__soakStream) return;
  const list = document.querySelector("section.t4l > div");
  if (!list) return;
  const words = "Here is a longer answer that arrives a few words at a time so the page keeps changing while Morse watches it".split(" ");
  let n = 0;
  window.__soakStream = setInterval(() => {
    const m = document.createElement("div");
    m.className = "msg";
    m.dataset.role = n % 2 ? "assistant" : "user";
    m.innerHTML = '<div class="av"></div><div><p></p></div>';
    list.append(m);
    const p = m.querySelector("p");
    let w = 0;
    const t = setInterval(() => { if (w >= words.length || !p.isConnected) return clearInterval(t); p.textContent += (w ? " " : "") + words[w++] + " #" + n; }, 25);
    n++;
    while (list.children.length > ${keep}) list.firstElementChild.remove();
  }, ${every});
})()`;

// ---- the desktop connector in its own process (daemon-child.js)
export async function startDaemon() {
  const { fork } = await import("node:child_process");
  const child = fork(path.join(root, "demo/soak/daemon-child.js"), [], { execArgv: ["--expose-gc"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let seq = 0;
  const waiting = new Map();
  child.on("message", m => { if (m.re != null) { waiting.get(m.re)?.(m); waiting.delete(m.re); } });
  await new Promise((res, rej) => { child.once("message", m => (m.ready ? res() : rej(new Error("daemon didn't start")))); child.once("exit", c => rej(new Error(`daemon exited ${c}`))); });
  const ask = (type, data = {}, timeout = 60000) => new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { waiting.delete(id); reject(new Error(`daemon: no answer to ${type}`)); }, timeout);
    waiting.set(id, m => { clearTimeout(t); m.error ? reject(new Error(m.error)) : resolve(m); });
    child.send({ id, type, ...data });
  });
  return {
    child, ask,
    start: o => ask("start", o), stop: () => ask("stop"), stats: () => ask("stats"),
    close: async () => { await ask("exit", {}, 15000).catch(() => {}); if (child.exitCode == null) child.kill("SIGKILL"); },
  };
}

// ---- a desktop "app": plain Chromium with --app, a debug port, and
// --enable-automation (navigator.webdriver, so the runtime shows its debug
// status). Playwright drives it over CDP like a person would.
export async function launchApp({ chromium, url, profile, headless = !process.env.DISPLAY, size = "1280,860" }) {
  const { spawn } = await import("node:child_process");
  const { devToolsPort } = await import("../../tests/helpers/net.js");
  const proc = spawn(chromium.executablePath(), [
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--no-sandbox",
    "--enable-automation", "--disable-features=Translate", `--window-size=${size}`, ...(headless ? ["--headless=new"] : []), `--app=${url}`,
  ], { stdio: "ignore" });
  const port = await devToolsPort(profile);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return { proc, port, browser, ctx: browser.contexts()[0], close: async () => { await browser.close().catch(() => {}); proc.kill("SIGKILL"); } };
}
