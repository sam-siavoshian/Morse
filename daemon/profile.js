// App profiles (see core/profile.js for what is in one, and docs/dev/rea.md
// for how this relates to REA). Two passes, both read only, once per app
// version, in the background after Morse connects:
//
//   static   the app's own code: app.asar (and other .asar files) or
//            resources/app/, read with plain file reads, never written. The
//            main process entry, the preloads and the window's scripts are
//            scanned in a worker thread (core/profile.js scanCode), so a
//            20 MB bundle never holds up the bar.
//   runtime  the running window, over CDP, in the page's own world: its own
//            global objects and what can be called on them, a command runner
//            and the list of commands (found by walking the app's objects
//            from its globals and from what its event listeners can reach),
//            and the event listeners on its main buttons.
//
// The result is cached in ~/.morse/profiles/<app>-<version>.json. Mods reach
// the command runner as morse.app.command(id) (core/kit.js): the connector
// puts a frozen handle on window[Symbol.for("morse.app")] in the app's
// windows (installHandle). Nothing here changes the app's files, and nothing
// replaces or wraps the app's own functions.

import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";
import { openSync, readSync, fstatSync, closeSync, statSync, readdirSync, readlinkSync, readFileSync, existsSync, realpathSync, constants as fsc } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { scanCode, mergeScans, profileSlice, PROFILE_VERSION } from "../core/profile.js";
import { HOME, renameOver, parseJson } from "./store.js";
import { trace } from "./trace.js";

export const PROFILES = path.join(HOME, "profiles");
export const HANDLE = "morse.app"; // Symbol.for(HANDLE) on the page's window (core/kit.js morse.app)

// ---------------------------------------------------------------- reading the app's files
// Read only: files are opened O_RDONLY and only read. The tests hash an
// app's files before and after a profile to prove it (tests/profile.test.js).
const LIMIT = { file: 32 << 20, total: 96 << 20, header: 64 << 20, walk: 40000, html: 40 };

function readRange(file, start, length) {
  const fd = openSync(file, fsc.O_RDONLY | (fsc.O_NONBLOCK || 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not a file");
    const b = Buffer.alloc(length);
    let n = 0;
    while (n < length) { const got = readSync(fd, b, n, length - n, start + n); if (!got) break; n += got; }
    return b.subarray(0, n);
  } finally { closeSync(fd); }
}

// An ASAR archive: 8 bytes, a header pickle (a JSON file table), then the
// files back to back. Files marked "unpacked" live next to it in
// <name>.asar.unpacked/. The same layout daemon/apps.js reads package.json from.
export class Asar {
  constructor(file) {
    this.file = file;
    const sizes = readRange(file, 0, 16);
    const headerSize = sizes.readUInt32LE(4), jsonSize = sizes.readUInt32LE(12);
    if (sizes.length < 16 || jsonSize > LIMIT.header || jsonSize > headerSize) throw new Error(`${file} is not an asar archive`);
    this.header = JSON.parse(readRange(file, 16, jsonSize).toString("utf8"));
    this.base = 8 + headerSize;
  }
  list() {
    const out = [];
    const walk = (node, dir) => {
      for (const [name, e] of Object.entries(node.files || {})) {
        if (out.length >= LIMIT.walk) return;
        const p = dir ? `${dir}/${name}` : name;
        if (e.files) walk(e, p);
        else if (!e.link) out.push({ path: p, size: Number(e.size) || 0, unpacked: !!e.unpacked });
      }
    };
    walk(this.header, "");
    return out;
  }
  entry(p) {
    let node = this.header;
    for (const part of p.split("/")) { node = node?.files?.[part]; if (!node) return null; }
    return node.files ? null : node;
  }
  read(p, max = LIMIT.file) {
    const e = this.entry(p);
    if (!e || Number(e.size) > max) return null;
    if (e.unpacked) { try { return readRange(`${this.file}.unpacked/${p}`, 0, Number(e.size)); } catch { return null; } }
    return readRange(this.file, this.base + Number(e.offset), Number(e.size));
  }
}

// A folder of the app's code (resources/app/ of an unpacked app, like VS Code).
class Folder {
  constructor(dir) { this.file = dir; }
  list() {
    const out = [];
    const walk = (d, rel, depth) => {
      if (out.length >= LIMIT.walk || depth > 12) return;
      let ents = [];
      try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (out.length >= LIMIT.walk) return;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!/^(node_modules|\.git|extensions|locales?)$/.test(e.name)) walk(path.join(d, e.name), p, depth + 1); }
        else if (e.isFile() && /\.(c|m)?js$|\.html?$|^package\.json$/.test(e.name)) { try { out.push({ path: p, size: statSync(path.join(d, e.name)).size }); } catch {} }
      }
    };
    walk(this.file, "", 0);
    return out;
  }
  read(p, max = LIMIT.file) {
    try { const f = path.join(this.file, ...p.split("/")); return statSync(f).size > max ? null : readRange(f, 0, statSync(f).size); } catch { return null; }
  }
}

// Where an app keeps its code: <resources>/app.asar (and other .asar files,
// like Obsidian's obsidian.asar), or <resources>/app/. `resources` comes from
// the running app's own executable when Morse knows its debugging port (an
// AppImage runs from a folder it unpacked or mounted), else from where the
// app is installed.
export function resourcesDir(app = {}, { port = null, platform = process.platform } = {}) {
  const tries = [];
  if (port && platform === "linux") {
    try {
      for (const pid of readdirSync("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        let cmd = "";
        try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
        if (!cmd.includes(`--remote-debugging-port=${port}\0`) && !cmd.endsWith(`--remote-debugging-port=${port}`)) continue;
        if (/\0--type=/.test(cmd)) continue; // a renderer or helper, not the app
        try { tries.push(path.join(path.dirname(readlinkSync(`/proc/${pid}/exe`)), "resources")); } catch {}
      }
    } catch {}
  }
  const p = app.path || app.exe || "";
  if (/\.app\/?$/.test(p)) tries.push(path.join(p, "Contents", "Resources"));
  for (const exe of [app.resolved, app.exe, app.path].filter(Boolean)) {
    try { tries.push(path.join(path.dirname(realpathSync(exe)), "resources")); } catch {}
    tries.push(path.join(path.dirname(exe), "resources"));
  }
  return tries.find(d => existsSync(path.join(d, "app.asar")) || existsSync(path.join(d, "app", "package.json"))) || null;
}

// The archives and folders holding the app's code, in a resources folder.
export function codeRoots(resources) {
  if (!resources) return [];
  const roots = [];
  if (existsSync(path.join(resources, "app", "package.json"))) roots.push({ kind: "dir", path: path.join(resources, "app") });
  let names = [];
  try { names = readdirSync(resources); } catch {}
  for (const n of names.sort((a, b) => (b === "app.asar") - (a === "app.asar"))) // app.asar first
    if (/\.asar$/.test(n) && !/^(electron|default_app)\.asar$/.test(n)) roots.push({ kind: "asar", path: path.join(resources, n) });
  return roots;
}

const openRoot = r => r.kind === "asar" ? new Asar(r.path) : new Folder(r.path);

// Which version of the code this is: the roots' sizes and times. A new app
// version (or an update the app downloaded) gets a new profile.
export function codeStamp(roots) {
  const h = createHash("sha1");
  for (const r of roots) { try { const st = statSync(r.path); h.update(`${r.path}\0${st.size}\0${Math.round(st.mtimeMs)}\0`); } catch { h.update(r.path); } }
  return h.digest("hex").slice(0, 10);
}

const VENDOR = /(^|\/)(node_modules|vendor|vendors|lib|libs|third[_-]?party|external|polyfills?)\//i;
const WORKERISH = /worker|\.min\.js$|mermaid|pdf|mathjax|katex|codemirror|monaco|tinymce|prism|highlight|emoji|tesseract|pixi/i;

// The files worth scanning: the main process entry, the preloads, and the
// scripts the window loads (`scripts`: their URLs, from the running window),
// or the biggest of the app's own scripts when those aren't known.
export function pickFiles(roots, { scripts = [] } = {}) {
  const picked = new Map(); // "<root>\0<path>" -> { root, path, size, role }
  let total = 0;
  const pick = (root, f, role) => {
    const k = `${root.file}\0${f.path}`;
    if (picked.has(k) || f.size > LIMIT.file || total + f.size > LIMIT.total) return;
    total += f.size;
    picked.set(k, { root, path: f.path, size: f.size, role });
  };
  const lists = roots.map(r => ({ r, files: r.list() }));
  const byBase = new Map();
  for (const { r, files } of lists) for (const f of files) {
    const b = f.path.split("/").pop();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push({ r, f });
  }
  // 1. the main process: package.json "main" (the app.asar of a loader like Obsidian's may point at another archive).
  for (const { r, files } of lists) {
    let main = null;
    try { main = parseJson(r.read("package.json")?.toString("utf8") || "null")?.main; } catch {}
    if (typeof main !== "string") continue;
    const want = main.replace(/^\.\//, "").replace(/\/$/, "");
    const f = files.find(x => x.path === want || x.path === `${want}.js` || x.path === `${want}/index.js`);
    if (f) pick(r, f, "main");
  }
  // 2. the window's scripts, matched to files by the end of their path.
  for (const u of scripts) {
    let p = "";
    try { p = decodeURIComponent(new URL(u).pathname); } catch { continue; }
    const base = p.split("/").pop();
    const cands = (byBase.get(base) || []).filter(({ f }) => p.endsWith("/" + f.path) || p.endsWith(f.path));
    const best = cands.sort((a, b) => b.f.path.length - a.f.path.length)[0];
    if (best) pick(best.r, best.f, "renderer");
  }
  // 3. scripts the app's own pages load (<script src>), when the window's aren't known.
  if (![...picked.values()].some(x => x.role === "renderer")) {
    for (const { r, files } of lists) {
      for (const h of files.filter(f => /\.html?$/.test(f.path) && !VENDOR.test(f.path) && f.size < 512 << 10).slice(0, LIMIT.html)) {
        const html = r.read(h.path)?.toString("utf8") || "";
        const dir = h.path.includes("/") ? h.path.slice(0, h.path.lastIndexOf("/")) : "";
        for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'#?]+)/gi)) {
          if (/^[a-z]+:\/\//i.test(m[1])) continue;
          const rel = path.posix.normalize((m[1].startsWith("/") ? m[1].slice(1) : (dir ? `${dir}/` : "") + m[1]));
          const f = files.find(x => x.path === rel);
          if (f && !VENDOR.test(f.path) && !WORKERISH.test(f.path)) pick(r, f, "renderer");
        }
      }
    }
  }
  // 4. the biggest of the app's own scripts, when what the pages load is only
  // a small loader (VS Code's workbench.js loads its 20 MB bundle itself).
  const rendered = [...picked.values()].filter(x => x.role === "renderer").reduce((a, x) => a + x.size, 0);
  if (rendered < 1 << 20) {
    const own = lists.flatMap(({ r, files }) => files.filter(f => /\.(c|m)?js$/.test(f.path) && !VENDOR.test(f.path) && !WORKERISH.test(f.path) && !/(^|\/)(main|cli|server|bootstrap[\w-]*|[\w-]*preload[\w-]*)\.(c|m)?js$/i.test(f.path)).map(f => ({ r, f })));
    for (const { r, f } of own.sort((a, b) => b.f.size - a.f.size).slice(0, rendered ? 2 : 4)) pick(r, f, "renderer");
  }
  // 5. preloads: named in the main process (scanned first) or called preload.
  return { picked, byBase, lists, pick };
}

// The static pass: { roots, stamp, files, ipc, bridge, commands, … }.
// Synchronous and CPU-bound: run it in a worker (staticProfile).
export function scanApp(roots, { scripts = [] } = {}) {
  const t0 = Date.now();
  const opened = [];
  for (const r of roots) { try { opened.push(openRoot(r)); } catch {} }
  const { picked, byBase, lists, pick } = pickFiles(opened, { scripts });
  const scans = [];
  const scan = x => {
    const buf = x.root.read(x.path);
    if (!buf) return null;
    const s = scanCode(buf.toString("utf8"), { file: `${path.basename(x.root.file)}/${x.path}`, role: x.role });
    scans.push(s);
    return s;
  };
  const mains = [...picked.values()].filter(x => x.role === "main");
  for (const x of mains) {
    const s = scan(x);
    for (const pre of s?.preloads || []) {
      const b = pre.split(/[\\/]/).pop();
      for (const { r, f } of byBase.get(b) || []) pick(r, f, "preload");
    }
  }
  for (const { r, files } of lists) for (const f of files) if (/preload[\w.-]*\.(c|m)?js$/i.test(f.path) && !VENDOR.test(f.path) && f.size < 2 << 20) pick(r, f, "preload");
  for (const x of picked.values()) if (x.role !== "main") scan(x);
  const merged = mergeScans(scans);
  return { version: PROFILE_VERSION, roots: roots.map(r => r.path), stamp: codeStamp(roots), ms: Date.now() - t0, ...merged };
}

// The static pass in a worker thread. Resolves to null if it fails or takes
// longer than `timeoutMs`.
export function staticProfile(roots, { scripts = [], timeoutMs = 90000 } = {}) {
  return new Promise(resolve => {
    let w;
    try { w = new Worker(new URL(import.meta.url), { workerData: { morseProfile: true, roots, scripts } }); }
    catch { try { return resolve(scanApp(roots, { scripts })); } catch { return resolve(null); } }
    const timer = setTimeout(() => { w.terminate(); resolve(null); }, timeoutMs);
    w.once("message", m => { clearTimeout(timer); resolve(m?.ok ? m.profile : null); w.terminate(); });
    w.once("error", () => { clearTimeout(timer); resolve(null); });
    w.once("exit", () => { clearTimeout(timer); resolve(null); });
  });
}

if (!isMainThread && workerData?.morseProfile) {
  try { parentPort.postMessage({ ok: true, profile: scanApp(workerData.roots, { scripts: workerData.scripts }) }); }
  catch (e) { parentPort.postMessage({ ok: false, error: String(e?.message || e) }); }
}

// ---------------------------------------------------------------- the running app (CDP)
// All of these run in the page's main world (the app's own objects live
// there) and only read: property descriptors, never getters, and no app
// function is called except the command lists (getCommands(), listCommands()).

// The app's own globals: window keys a clean page doesn't have, with what can
// be called on them (and on their child objects: app.vault.create).
const GLOBALS = `function (clean, appName) {
  clean = new Set(clean);
  const NODE = new Set(["process", "global", "Buffer", "require", "module", "exports", "__filename", "__dirname", "setImmediate", "clearImmediate"]);
  const isNode = v => { try { return v instanceof Node || (v && v.window === v); } catch { return true; } };
  const methods = o => {
    const m = new Set();
    for (let p = o, d = 0; p && p !== Object.prototype && p !== Function.prototype && d < 4; p = Object.getPrototypeOf(p), d++) {
      let names = []; try { names = Object.getOwnPropertyNames(p); } catch { break; }
      for (const k of names) {
        if (k === "constructor" || /^_|_$/.test(k) || m.size >= 40) continue;
        let ds; try { ds = Object.getOwnPropertyDescriptor(p, k); } catch { continue; }
        if (ds && typeof ds.value === "function") m.add(k);
      }
    }
    return [...m];
  };
  const out = [];
  let node = false;
  for (const k of Object.getOwnPropertyNames(window)) {
    if (clean.has(k) || /^(on|webkit)|^__/.test(k)) continue;
    if (NODE.has(k)) { node = true; continue; }
    let d; try { d = Object.getOwnPropertyDescriptor(window, k); } catch { continue; }
    if (!d || !("value" in d)) continue;
    const v = d.value;
    if (!v || (typeof v !== "object" && typeof v !== "function") || isNode(v)) continue;
    const own = methods(v);
    const children = {};
    if (typeof v === "object" && !Array.isArray(v)) {
      let keys = []; try { keys = Object.keys(v).slice(0, 80); } catch {}
      for (const c of keys) {
        if (Object.keys(children).length >= 25 || /^_|_$/.test(c)) continue;
        let cd; try { cd = Object.getOwnPropertyDescriptor(v, c); } catch { continue; }
        const cv = cd && cd.value;
        if (!cv || typeof cv !== "object" || Array.isArray(cv) || isNode(cv)) continue;
        const mm = methods(cv);
        if (mm.length) children[c] = mm.slice(0, 30);
      }
    }
    if (typeof v === "function" && !own.length && (k.length <= 3 || /^[A-Z]/.test(k))) continue; // a minified helper or a bare class
    if (!own.length && !Object.keys(children).length) continue;
    out.push({ name: k, kind: typeof v, methods: own, children, app: /^(app|application|App|workbench|store)$/.test(k) || (!!appName && k.toLowerCase().replace(/\\W/g, "") === appName) });
  }
  out.sort((a, b) => (b.app - a.app) || (Object.keys(b.children).length - Object.keys(a.children).length));
  return { globals: out.slice(0, 40), node };
}`;

// Walks the app's objects from `this.roots` (with names in `this.names`)
// looking for a command runner (an object reached by a "command…" name that
// has executeCommand / executeCommandById / execute / runCommand) and
// command lists (listCommands / getCommands / commandNames). Yields to the
// page every 25 ms so the app stays responsive. Installs the handle mods use
// (core/kit.js morse.app) for the best runner it finds.
const FIND = `async function (budget, handle) {
  const RUN = /^(executeCommand|executeCommandById|runCommand|execute)$/;
  const LIST = /^(listCommands|getCommands|commandNames)$/;
  const NAMEY = /^_?commands?(Service|Manager|Registry)?_?$/i;
  const cache = new WeakMap();
  const methodsOf = o => {
    const out = [];
    for (let p = o, d = 0; p && p !== Object.prototype && p !== Function.prototype && d < 5; d++) {
      let names = cache.get(p);
      if (!names) {
        names = [];
        let own = []; try { own = Object.getOwnPropertyNames(p); } catch {}
        for (const k of own) { let ds; try { ds = Object.getOwnPropertyDescriptor(p, k); } catch { continue; } if (ds && typeof ds.value === "function" && k !== "constructor") names.push(k); }
        if (p !== o) cache.set(p, names);
      }
      out.push(...names);
      try { p = Object.getPrototypeOf(p); } catch { break; }
    }
    return out;
  };
  const fnName = f => { try { const d = Object.getOwnPropertyDescriptor(f, "name"); return d && typeof d.value === "string" ? d.value : ""; } catch { return ""; } };
  const isNode = v => { try { return v instanceof Node || v instanceof Window || (v && v.window === v && v !== window); } catch { return true; } };
  const runners = [], listers = [];
  const consider = (x, key, path, depth) => {
    if (typeof x === "object") {
      const ms = methodsOf(x);
      const named = /command/i.test(key);
      const run = ms.find(m => RUN.test(m));
      const list = ms.find(m => LIST.test(m)) || (named && ms.includes("list") ? "list" : null);
      if (run && (named || list) && !runners.some(r => r.x === x))
        runners.push({ x, path, method: run, score: (NAMEY.test(key) ? 3 : named ? 1 : 0) + (/^executeCommand/.test(run) ? 2 : 1) + (list ? 1 : 0) - depth * 0.3 });
      if (list && (named || ms.includes("registerCommand") || ms.includes("addCommand") || run) && !listers.some(l => l.x === x)) listers.push({ x, path, method: list });
    } else if (typeof x === "function" && /command/i.test(key + " " + fnName(x))) {
      // A class with a singleton: CommandService.instance_.
      let statics = []; try { statics = Object.getOwnPropertyNames(x); } catch {}
      for (const sk of statics) {
        let d; try { d = Object.getOwnPropertyDescriptor(x, sk); } catch { continue; }
        const v = d && d.value;
        if (v && typeof v === "object" && !isNode(v)) consider(v, fnName(x) || key, path + "." + sk, depth + 1);
      }
    }
  };
  const seen = new Set();
  let queue = this.roots.map((v, i) => [v, this.names[i], this.names[i], 0]);
  for (const [v, name, path] of queue) if (v && (typeof v === "object" || typeof v === "function")) consider(v, name.split("|").pop(), path, 0);
  // Lets the page run between slices. A message, not setTimeout: a window in
  // the background has its timers slowed to once a second.
  const ch = new MessageChannel();
  const pause = () => new Promise(r => { ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  let n = 0, t = performance.now();
  const end = t + budget;
  while (queue.length && performance.now() < end) {
    const next = [];
    for (const [v, , path, depth] of queue) {
      if (!v || (typeof v !== "object" && typeof v !== "function") || seen.has(v)) continue;
      seen.add(v); n++;
      if (isNode(v) && v !== window) continue;
      if (performance.now() - t > 25) { await pause(); t = performance.now(); if (t > end) break; }
      let keys; try { keys = Object.getOwnPropertyNames(v); } catch { continue; }
      if (keys.length > 3000) continue;
      for (const k of keys) {
        if (!/^[\\w$]+$/.test(k)) continue;
        let d; try { d = Object.getOwnPropertyDescriptor(v, k); } catch { continue; }
        if (!d || !("value" in d)) continue;
        const x = d.value;
        if (!x || (typeof x !== "object" && typeof x !== "function") || seen.has(x)) continue;
        consider(x, k, path + "." + k, depth + 1);
        if (depth < 6) next.push([x, k, path + "." + k, depth + 1]);
      }
    }
    queue = next;
  }
  runners.sort((a, b) => b.score - a.score);
  // A command's name for people: its title or label (a function in some
  // apps: () => _("New note")), from the command or its declaration.
  const label = (v, id, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 2) return "";
    for (const k of ["title", "label", "name", "description"]) {
      let x; try { x = v[k]; } catch { continue; }
      if (typeof x === "function" && x.length === 0) { try { x = x(); } catch { x = ""; } }
      if (x && typeof x === "object") x = x.value || x.original || "";
      if (typeof x === "string" && x.trim() && x !== id) return x.trim().slice(0, 80);
    }
    return label(v.declaration, id, depth + 1) || label(v.metadata, id, depth + 1) || "";
  };
  const collect = (ls) => {
    const out = new Map();
    for (const l of ls) {
      let got; try { got = l.x[l.method](); } catch { continue; }
      if (got && typeof got.then === "function") continue;
      const add = (id, v) => { id = typeof id === "string" ? id : v && typeof v.id === "string" ? v.id : null; if (!id || id.startsWith("_") || out.size >= 6000) return; const lb = typeof v === "string" ? (v === id ? "" : v) : label(v, id); if (!out.has(id) || (lb && !out.get(id))) out.set(id, lb); };
      try {
        if (got instanceof Map) for (const [k, v] of got) add(k, v);
        else if (Array.isArray(got)) for (const v of got) add(typeof v === "string" ? v : null, v);
        else if (got && typeof got === "object") for (const k of Object.keys(got)) add(k, got[k]);
      } catch {}
    }
    return [...out].map(([id, lb]) => lb ? [id, lb] : [id]);
  };
  const best = runners[0];
  const mine = best ? [best, ...listers.filter(l => l.x === best.x)] : [];
  // The handle mods use, put on the window by install() once the search is over.
  if (best) {
    const r = best.x, m = best.method, ls = listers.length ? listers : mine;
    this.install = () => { Object.defineProperty(window, Symbol.for(handle), { configurable: true, value: Object.freeze({ run: (id, ...a) => r[m](id, ...a), list: () => collect(ls), via: best.path + "." + m }) }); return true; };
  }
  return { n, runner: best ? { path: best.path, method: best.method } : null, others: runners.slice(1, 4).map(r => r.path + "." + r.method),
    listers: listers.slice(0, 4).map(l => ({ path: l.path, method: l.method })), commands: collect(listers.length ? listers : mine) };
}`;

// Installs the handle again in a new document from a found path.
const INSTALL = `function (keys, method, handle, via) {
  let o = this;
  for (const k of keys) { if (o == null) return false; let d; try { d = Object.getOwnPropertyDescriptor(o, k); } catch { return false; } o = d && "value" in d ? d.value : undefined; }
  if (!o || typeof o[method] !== "function") return false;
  const r = o;
  const lister = ["listCommands", "getCommands", "commandNames", "list"].find(k => typeof r[k] === "function");
  Object.defineProperty(window, Symbol.for(handle), { configurable: true, value: Object.freeze({ run: (id, ...a) => r[method](id, ...a),
    list: () => { try { const g = r[lister](); return g instanceof Map ? [...g.keys()].map(id => [id]) : Array.isArray(g) ? g.map(x => [typeof x === "string" ? x : x.id, x.name || x.label || ""]) : Object.keys(g || {}).map(id => [id, g[id]?.name || ""]); } catch { return []; } },
    via }) });
  return true;
}`;

// What the app's main buttons (and the one the person pointed at) do: their
// event listeners (DOMDebugger.getEventListeners, which reports a listener
// without running it) and framework handlers (React's onClick props).
const KEY_ELEMENTS = `function (sel) {
  const seen = new Set(), out = [];
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const add = e => { if (e && !seen.has(e) && !e.closest("[data-morse-ui],[data-morse]")) { seen.add(e); out.push(e); } };
  if (sel) { let e = null; try { e = document.querySelector(sel); } catch {} for (let i = 0; e && i < 4; i++, e = e.parentElement) add(e); return out; }
  for (const e of document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem],a[href],[contenteditable=true],textarea,input[type=text],input[type=search]")) {
    if (out.length >= 30) break;
    if (visible(e) && (e.getAttribute("aria-label") || e.title || (e.textContent || "").trim())) add(e);
  }
  return out;
}`;
const DESCRIBE = `function () {
  const e = this, label = (e.getAttribute("aria-label") || e.title || (e.textContent || "").trim()).replace(/\\s+/g, " ").slice(0, 40);
  const where = e.localName + (e.id ? "#" + e.id : "") + (label ? " “" + label + "”" : "");
  const props = [];
  for (const k of Object.keys(e)) {
    if (!/^__reactProps|^__preactProps/.test(k)) continue;
    const p = e[k] || {};
    for (const h of Object.keys(p)) if (/^on[A-Z]/.test(h) && typeof p[h] === "function") props.push({ type: h.slice(2).toLowerCase(), source: String(p[h]).slice(0, 300), framework: "react" });
  }
  return { where, props };
}`;

const sourceOf = d => String(d || "").replace(/\s+/g, " ").slice(0, 300);

async function evaluate(s, expression, contextId, opts = {}) {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, ...(contextId != null && { contextId }), ...opts });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text);
  return r.result?.value;
}

// The page's window object in the main world, as a remote object.
async function windowObject(s, contextId, group) {
  const r = await s.send("Runtime.evaluate", { expression: "window", objectGroup: group, ...(contextId != null && { contextId }) });
  return r.result?.objectId;
}

// Event listeners on a remote object, with their handler functions.
async function listenersOf(s, objectId) {
  try { return (await s.send("DOMDebugger.getEventListeners", { objectId, depth: 0 })).listeners || []; } catch { return []; }
}

// The variables a listener's handler can see (its closure scopes): where an
// app's services live when its bundle exposes no globals.
// The outermost scope is the whole bundle's: thousands of names, the same
// for every listener from that bundle, and reading it holds up the page for
// as long as it takes (seconds, for VS Code). So the inner scopes are read
// first (`outer` false), the outermost only when they lead nowhere, and each
// scope at most once.
export async function scopeVars(s, handlerId, seenScopes, budgetEnd, { outer: wantOuter = false, script = "" } = {}) {
  const out = [];
  const p = await s.send("Runtime.getProperties", { objectId: handlerId, ownProperties: true }).catch(() => null);
  const bound = p?.internalProperties?.find(x => x.name === "[[BoundThis]]");
  if (bound?.value?.objectId && !wantOuter) out.push({ name: "this", id: bound.value.objectId });
  const scopes = p?.internalProperties?.find(x => x.name === "[[Scopes]]");
  if (!scopes?.value?.objectId) return out;
  const list = ((await s.send("Runtime.getProperties", { objectId: scopes.value.objectId, ownProperties: true }).catch(() => null))?.result || [])
    .filter(sc => sc.value?.objectId && !/^(Global|Script)/.test(sc.value.description || ""));
  for (let i = 0; i < list.length; i++) {
    if (Date.now() > budgetEnd) break;
    const sc = list[i], d = sc.value.description || "";
    const outer = i === list.length - 1;
    if (outer !== wantOuter) continue;
    if (outer && seenScopes.has(`outer:${script}:${d}`)) continue;
    const vars = (await s.send("Runtime.getProperties", { objectId: sc.value.objectId, ownProperties: true }).catch(() => null))?.result || [];
    const key = outer ? `outer:${script}:${d}` : `${d}:${vars.length}:${vars.slice(0, 4).map(v => v.name).join(",")}`;
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    for (const v of vars) if (v.value?.objectId && /^[\w$]+$/.test(v.name)) out.push({ name: v.name, id: v.value.objectId, scope: key });
  }
  return out;
}

const TARGETS = ["window", "document", "document.body"];

// The roots the search starts from: every variable the listeners on one
// target (the window, the document, the body) can see.
export async function listenerRoots(s, contextId, group, target, { seenScopes, budgetEnd, outer = false, max = 40000 }) {
  const roots = [];
  const o = (await s.send("Runtime.evaluate", { expression: target, objectGroup: group, ...(contextId != null && { contextId }) }).catch(() => null))?.result?.objectId;
  if (!o) return roots;
  for (const l of await listenersOf(s, o)) {
    if (Date.now() > budgetEnd || roots.length >= max) break;
    if (!l.handler?.objectId) continue;
    for (const v of await scopeVars(s, l.handler.objectId, seenScopes, budgetEnd, { outer, script: l.scriptId })) {
      if (roots.length >= max) break;
      roots.push({ name: `listener|${target}|${l.type}|${v.name}|${outer ? "o" : "i"}`, id: v.id });
    }
  }
  return roots;
}

async function runFind(s, contextId, group, roots, budgetMs) {
  const win = await windowObject(s, contextId, group);
  const coll = (await s.send("Runtime.callFunctionOn", { objectId: win, objectGroup: group, functionDeclaration: "function () { return { roots: [], names: [] }; }" })).result.objectId;
  for (let i = 0; i < roots.length; i += 2000) {
    const chunk = roots.slice(i, i + 2000);
    await s.send("Runtime.callFunctionOn", { objectId: coll, arguments: chunk.map(r => ({ objectId: r.id })),
      functionDeclaration: `function (...v) { this.roots.push(...v); this.names.push(...${JSON.stringify(chunk.map(r => r.name))}); }` });
  }
  const r = await s.send("Runtime.callFunctionOn", { objectId: coll, returnByValue: true, awaitPromise: true, arguments: [{ value: budgetMs }, { value: HANDLE }], functionDeclaration: FIND });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || "search failed");
  return { ...r.result.value, coll };
}

// A found path as a recipe a later document can follow: where it starts
// (the window, or a variable a listener sees) and the keys after that.
export function recipeOf(found, url) {
  if (!found?.path) return null;
  const parts = found.path.split(".");
  const root = parts.shift();
  const [, target, type, name, where] = root.split("|");
  return { url: pageKey(url), method: found.method, keys: parts, root: root === "window" ? { kind: "window" } : { kind: "listener", target, type, name, outer: where === "o" } };
}
// Which documents a recipe is for: the app window's address without its query.
export const pageKey = url => String(url || "").replace(/[?#].*$/, "");

// The command runner, again, in a document that doesn't have the handle yet.
// true when installed (or already there).
export async function installHandle(s, recipe, { contextId = null, timeoutMs = 8000 } = {}) {
  if (!recipe) return false;
  const group = `morse-handle-${randomUUID()}`;
  const end = Date.now() + timeoutMs;
  try {
    if (await evaluate(s, `!!window[Symbol.for(${JSON.stringify(HANDLE)})]`, contextId).catch(() => false)) return true;
    const via = `${recipe.root.kind === "window" ? "window" : recipe.root.name}.${recipe.keys.join(".")}.${recipe.method}`;
    const call = objectId => s.send("Runtime.callFunctionOn", { objectId, returnByValue: true, arguments: [{ value: recipe.keys }, { value: recipe.method }, { value: HANDLE }, { value: via }], functionDeclaration: INSTALL })
      .then(r => r.result?.value === true, () => false);
    if (recipe.root.kind === "window") return await call(await windowObject(s, contextId, group));
    const target = (await s.send("Runtime.evaluate", { expression: recipe.root.target, objectGroup: group, ...(contextId != null && { contextId }) }).catch(() => null))?.result?.objectId;
    if (!target) return false;
    const seen = new Set();
    for (const l of await listenersOf(s, target)) {
      if (l.type !== recipe.root.type || !l.handler?.objectId || Date.now() > end) continue;
      const v = (await scopeVars(s, l.handler.objectId, seen, end, { outer: !!recipe.root.outer, script: l.scriptId })).find(x => x.name === recipe.root.name);
      if (v && await call(v.id)) return true;
    }
    return false;
  } finally { s.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {}); }
}

// Listeners on the app's main buttons, or (selector) on what the person
// pointed at and the three parts around it: [{ where, type, source }].
export async function elementLogic(s, { contextId = null, selector = null, max = 30 } = {}) {
  const group = `morse-logic-${randomUUID()}`;
  const out = [];
  try {
    const win = await windowObject(s, contextId, group);
    const arr = (await s.send("Runtime.callFunctionOn", { objectId: win, objectGroup: group, arguments: [{ value: selector }], functionDeclaration: KEY_ELEMENTS })).result?.objectId;
    if (!arr) return out;
    const els = ((await s.send("Runtime.getProperties", { objectId: arr, ownProperties: true })).result || []).filter(p => /^\d+$/.test(p.name) && p.value?.objectId);
    for (const e of els) {
      if (out.length >= max) break;
      const info = (await s.send("Runtime.callFunctionOn", { objectId: e.value.objectId, returnByValue: true, functionDeclaration: DESCRIBE }).catch(() => null))?.result?.value;
      if (!info) continue;
      for (const l of await listenersOf(s, e.value.objectId)) out.push({ where: info.where, type: l.type, source: sourceOf(l.handler?.description) });
      for (const p of info.props) out.push({ where: info.where, type: p.type, source: sourceOf(p.source), framework: p.framework });
    }
  } catch {} finally { s.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {}); }
  return out.slice(0, max * 2);
}

// The runtime pass: { url, globals, node, runner, recipe, commands, listeners, ms }.
export async function runtimeProfile(s, { url = "", contextId = null, budgetMs = 12000, appName = "" } = {}) {
  const t0 = Date.now();
  const group = `morse-profile-${randomUUID()}`;
  const out = { url: pageKey(url), globals: [], node: false, runner: null, recipe: null, commands: [], listeners: [], windowEvents: [] };
  try {
    // A clean world of the same page: the globals every page has.
    let clean = [];
    try {
      const frameId = (await s.send("Page.getFrameTree"))?.frameTree?.frame?.id;
      const w = await s.send("Page.createIsolatedWorld", { frameId, worldName: "morse-profile" });
      clean = await evaluate(s, "Object.getOwnPropertyNames(globalThis)", w.executionContextId);
    } catch {}
    const g = await s.send("Runtime.callFunctionOn", { objectId: await windowObject(s, contextId, group), returnByValue: true, arguments: [{ value: clean }, { value: String(appName || "").toLowerCase().replace(/\W/g, "") }], functionDeclaration: GLOBALS }).catch(() => null);
    Object.assign(out, g?.result?.value || {});
    const timing = out.timing = {}, lap = k => { timing[k] = Date.now() - t0; };
    lap("globals");
    // The command runner: first from the globals, then from what the
    // window's listeners can reach.
    const end = t0 + budgetMs;
    let found = await runFind(s, contextId, group, [{ name: "window", id: await windowObject(s, contextId, group) }], 1500).catch(() => null);
    lap("fromGlobals");
    const seenScopes = new Set();
    for (const outer of [false, true]) {
      if (found?.runner || Date.now() > end) break;
      const roots = [];
      for (const target of TARGETS) roots.push(...await listenerRoots(s, contextId, group, target, { seenScopes, budgetEnd: end, outer }));
      lap(outer ? "outerScopes" : "innerScopes");
      timing[outer ? "outerRoots" : "innerRoots"] = roots.length;
      if (!roots.length) continue;
      const deep = await runFind(s, contextId, group, roots, Math.max(1500, Math.min(4000, end - Date.now()))).catch(() => null);
      lap(outer ? "outerSearch" : "innerSearch");
      if (deep?.runner) found = { ...deep, commands: deep.commands?.length ? deep.commands : found?.commands || [] };
      else if (deep?.commands?.length && !found?.commands?.length) found = { ...found, commands: deep.commands };
    }
    if (found?.runner) {
      out.recipe = recipeOf(found.runner, url);
      // How the prompt names it: window.app.commands, or (reached through
      // a listener, with minified names) only its last name.
      const global = out.recipe.root.kind === "window";
      out.runner = { path: global ? ["window", ...out.recipe.keys].join(".") : out.recipe.keys.slice(-1).join(".") || out.recipe.root.name, method: found.runner.method, global };
      for (const g of out.globals) if (global && g.name === out.recipe.keys[0]) g.app = true; // the object the commands hang off is the app's
      out.installed = await s.send("Runtime.callFunctionOn", { objectId: found.coll, returnByValue: true, functionDeclaration: "function () { try { return !!(this.install && this.install()); } catch { return false; } }" })
        .then(r => r.result?.value === true, () => false);
    }
    out.commands = found?.commands || [];
    out.searched = found?.n || 0;
    // What the main buttons do, and which events the window listens to.
    lap("search");
    out.listeners = await elementLogic(s, { contextId });
    lap("listeners");
    const win = await windowObject(s, contextId, group);
    out.windowEvents = [...new Set((await listenersOf(s, win)).map(l => l.type))];
  } finally { s.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {}); }
  out.ms = Date.now() - t0;
  return out;
}

// The window's scripts, for the static pass to scan.
export const scriptUrls = (s, contextId = null) => evaluate(s, `[...new Set([...document.scripts].map(s => s.src).concat(performance.getEntriesByType("resource").filter(e => e.initiatorType === "script").map(e => e.name)).filter(Boolean))].slice(0, 200)`, contextId).catch(() => []);

// ---------------------------------------------------------------- the cache
const fileFor = (id, stamp) => path.join(PROFILES, `${String(id || "app").replace(/[^\w.-]+/g, "-")}-${stamp}.json`);

export async function loadProfile(id, stamp) {
  try {
    const p = parseJson(await fs.readFile(fileFor(id, stamp), "utf8"));
    return p?.version === PROFILE_VERSION ? p : null;
  } catch { return null; }
}

export async function saveProfile(profile) {
  await fs.mkdir(PROFILES, { recursive: true });
  const file = fileFor(profile.app, profile.stamp);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(profile));
  await renameOver(tmp, file);
  // Older versions of the same app's profile go.
  const prefix = path.basename(file).replace(/-[0-9a-f]+\.json$/, "-");
  for (const f of await fs.readdir(PROFILES).catch(() => [])) if (f.startsWith(prefix) && /-[0-9a-f]{10}\.json$/.test(f) && f !== path.basename(file)) await fs.rm(path.join(PROFILES, f), { force: true }).catch(() => {});
  return file;
}

// Waits (at most `ms`) until the page is loaded and has stopped growing.
export async function settled(s, { ms = 20000, contextId = null } = {}) {
  const end = Date.now() + ms;
  let last = -1, still = 0;
  while (Date.now() < end && !s.closed) {
    const n = await evaluate(s, `document.readyState === "complete" ? document.getElementsByTagName("*").length : -1`, contextId).catch(() => -1);
    if (n > 0 && Math.abs(n - last) <= Math.max(3, last * 0.02)) { if (++still >= 2) return true; } else still = 0;
    last = n;
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

// ---------------------------------------------------------------- per connected app
// One per Connector: builds or loads the app's profile in the background,
// installs the command handle in its windows, and gives the prompt its slice.
// MORSE_PROFILE=off turns all of it off (the "without a profile" baseline in
// docs/dev/rea.md).
export class AppProfiler {
  constructor({ app, port = null, log = () => {}, resources = null } = {}) {
    Object.assign(this, { app, port, log, resources });
    this.profile = null;
    this.building = null;
  }

  static enabled(env = process.env) { return env.MORSE_PROFILE !== "off"; }

  // A window was attached (connector.attach). The first visible app window
  // starts the profile; every window gets the handle once there is one.
  attached(s, w) {
    if (w.kind !== "window" || !/^(https?|file|app|vscode-file|[\w-]+):/.test(w.url || "") || /^(devtools|chrome|about):/.test(w.url || "")) return;
    (async () => {
      const visible = await evaluate(s, `document.visibilityState === "visible" && innerWidth > 300 && innerHeight > 200`).catch(() => false);
      if (!visible) return;
      if (!this.building) this.building = this.build(s, w).catch(e => { trace("profile", `failed: ${e.message}`); return null; });
      await this.building;
      await this.ensure(s, w).catch(() => {});
    })();
  }

  async build(s, w) {
    const t0 = Date.now();
    const resources = this.resources || resourcesDir(this.app, { port: this.port });
    const roots = codeRoots(resources);
    const stamp = codeStamp(roots);
    const id = this.app?.id || "app";
    let p = await loadProfile(id, stamp);
    if (p?.static && p?.runtime) { this.profile = p; trace("profile", `loaded ${fileFor(id, stamp)}`); return p; }
    p = { version: PROFILE_VERSION, app: id, name: this.app?.name || null, appVersion: this.app?.version || null, stamp, made: new Date().toISOString(), static: p?.static || null, runtime: p?.runtime || null };
    // Apps keep starting up after their window shows (Joplin loads its notes,
    // then its UI): look once the page has stopped growing. The two passes
    // then run side by side (the static one in a worker thread).
    await settled(s);
    const scripts = p.static ? [] : await scriptUrls(s);
    const look = () => runtimeProfile(s, { url: w.url, appName: this.app?.name }).catch(e => ({ error: e.message }));
    const [st, rt] = await Promise.all([p.static || (roots.length ? staticProfile(roots, { scripts }) : null), p.runtime || look()]);
    Object.assign(p, { static: st, runtime: rt });
    this.profile = p;
    if (!p.runtime?.runner && !s.closed && !this.retried) { // still starting? one more look a little later
      this.retried = true;
      await new Promise(r => setTimeout(r, 15000));
      if (!s.closed) { const again = await look(); if (again?.runner) p.runtime = again; }
    }
    await saveProfile(p).catch(() => {});
    const n = p.runtime?.commands?.length || p.static?.commands?.length || 0;
    this.log(`  · ${this.app?.name || "The app"}: Morse looked at how it works inside (${n} command${n === 1 ? "" : "s"}${p.runtime?.runner ? ", and how to run them" : ""}) in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
    trace("profile", `static ${p.static?.ms ?? "-"}ms (${p.static?.files?.length || 0} files) · runtime ${p.runtime?.ms ?? "-"}ms · runner ${p.runtime?.runner ? `${p.runtime.runner.path}.${p.runtime.runner.method}` : "none"} · saved under ${PROFILES}`);
    return p;
  }

  // The command handle in this window's current document, when the profile
  // found a runner and this is the window it was found in.
  async ensure(s, w, contextId = null) {
    const recipe = this.profile?.runtime?.recipe;
    if (!recipe || pageKey(w.url) !== recipe.url) return false;
    return installHandle(s, recipe, { contextId });
  }

  // Before mod code that uses morse.app runs: wait for the profile (at most
  // `timeoutMs`), then make sure the handle is there.
  async ready(s, w, contextId, timeoutMs = 15000) {
    const timeout = new Promise(r => setTimeout(r, timeoutMs, null));
    if (!this.profile && this.building) await Promise.race([this.building, timeout]);
    if (!this.profile && !this.building) await Promise.race([this.loadCached(), timeout]);
    return Promise.race([this.ensure(s, w, contextId), timeout]);
  }

  // A saved profile for this app, without building one.
  async loadCached() {
    if (this.profile) return this.profile;
    const roots = codeRoots(this.resources || resourcesDir(this.app, { port: this.port }));
    const p = await loadProfile(this.app?.id || "app", codeStamp(roots));
    if (p?.static && p?.runtime) this.profile = p;
    return this.profile;
  }

  // A draft that runs a command this app doesn't have, or uses morse.app
  // where Morse found no runner: a repair message for the model (core/engine.js vet).
  vet(draft) {
    const js = String(draft?.js || "");
    if (!/\bmorse\.app\.command\s*\(/.test(js) || !this.profile) return null;
    const rt = this.profile.runtime || {};
    if (!rt.runner) return "morse.app.command can't run anything in this app: Morse found no command runner here. Use the app's own objects, its buttons or its keys instead.";
    const known = new Set([...(rt.commands || []), ...(this.profile.static?.commands || [])].map(c => c[0]));
    if (!known.size) return null;
    const missing = [...js.matchAll(/\bmorse\.app\.command\s*\(\s*(["'`])([^"'`]+)\1/g)].map(m => m[2]).filter(id => !known.has(id));
    if (!missing.length) return null;
    const words = new Set(missing.flatMap(id => id.toLowerCase().split(/[^a-z0-9]+/)).filter(w => w.length > 2));
    const near = [...known].filter(id => id.toLowerCase().split(/[^a-z0-9]+/).some(w => words.has(w))).slice(0, 12);
    return `This app has no command ${missing.map(id => `"${id}"`).join(", ")}. Use only command ids from the list you were given${near.length ? `; close ones: ${near.join(", ")}` : ""}.`;
  }

  // The prompt's slice for a request (core/profile.js profileSlice), with
  // what the pointed-at part does when the request is about behavior.
  async slice(s, caller, request, selector) {
    if (!this.profile) return "";
    let target = null;
    if (selector && !selector.includes(">>>")) {
      const t = elementLogic(s, { contextId: caller?.main, selector, max: 8 });
      target = { listeners: (await Promise.race([t, new Promise(r => setTimeout(r, 800, []))])).filter(l => l.source) };
    }
    return profileSlice(this.profile, request, { target });
  }
}

// What `morse profile` prints: a few lines a developer can read.
export function formatProfile(p) {
  if (!p) return "Morse couldn't find this app's code (no app.asar or resources/app next to it).";
  const st = p.static || {}, rt = p.runtime || {};
  const n = (a, one, many = one + "s") => `${a?.length || 0} ${(a?.length || 0) === 1 ? one : many}`;
  const lines = [`${p.name || p.app} · profile ${p.stamp}${p.cached ? " (saved earlier)" : ""}`];
  lines.push(`  code      ${(st.files || []).map(f => `${f.file} (${f.role || "?"}, ${(f.size / 1e6).toFixed(1)} MB, ${f.bundler})`).join("\n            ") || "-"}`);
  lines.push(`  commands  ${n(rt.commands?.length ? rt.commands : st.commands, "command")}${rt.runner ? `, run with ${rt.runner.global ? `${rt.runner.path}.` : ""}${rt.runner.method}()` : ""}: ${(rt.commands?.length ? rt.commands : st.commands || []).slice(0, 6).map(c => c[0]).join(", ")}…`);
  lines.push(`  ipc       ${n(st.ipc, "channel")}: ${[...new Set((st.ipc || []).map(c => c.channel))].slice(0, 8).join(", ")}`);
  if (st.bridge?.length) lines.push(`  bridge    ${st.bridge.map(b => `window.${b.name}${b.keys.length ? ` {${b.keys.slice(0, 8).join(", ")}}` : ""}`).join(", ")}`);
  if (st.keys?.length) lines.push(`  keys      ${st.keys.slice(0, 8).map(([k, l]) => `${k}${l ? ` ${l}` : ""}`).join(", ")}`);
  if (st.routes?.length) lines.push(`  routes    ${st.routes.slice(0, 8).join(", ")}`);
  if (st.actions?.length) lines.push(`  actions   ${n(st.actions, "store action")}: ${st.actions.slice(0, 6).join(", ")}`);
  if (rt.globals?.length) lines.push(`  globals   ${rt.globals.slice(0, 8).map(g => `window.${g.name}`).join(", ")}`);
  if (!p.runtime) lines.push("  (open the app with morse launch for the rest: its own objects, its command runner and what its buttons do)");
  return lines.join("\n");
}

// `morse profile <app>`: the static pass for an installed app, read only.
export async function profileForApp(app, { port = null, scripts = [] } = {}) {
  const roots = codeRoots(resourcesDir(app, { port }));
  if (!roots.length) return null;
  const stamp = codeStamp(roots);
  const cached = await loadProfile(app.id, stamp);
  return { version: PROFILE_VERSION, app: app.id, name: app.name, stamp, static: cached?.static || await staticProfile(roots, { scripts }), runtime: cached?.runtime || null, cached: !!cached };
}
