// Your browser, with Morse, still signed in to everything.
//
// Since Chrome 136, a Chromium browser takes no remote control of its
// everyday profile, so Morse opens it on a profile folder of its own
// (~/.morse/browser-profile). An empty folder would mean signing in to every
// site again, so Morse never opens one when there is an everyday profile:
//
//   - the first time, the everyday profile is copied in whole (sign-ins,
//     saved passwords, tabs, extensions, bookmarks), caches left out. A folder
//     with no cache inside it is cloned in one shot: on a Mac that is one
//     clonefile of the folder, and on a disk that can share blocks it is a
//     reflink. Copying every file on its own (even as its own clone) is what
//     made this first open take the better part of a minute. A disk that
//     cannot clone falls back to a normal copy, with the heavy folders copied
//     at the same time. A clone shares the disk blocks until either profile
//     writes them, so it takes no extra space.
//   - every time after, sign-ins made in the everyday browser since are
//     merged in: a cookie newer there replaces the one here, a saved password
//     not here is added. Nothing here is removed, so a sign-in made in the
//     browser opened with Morse stays too.
//
// The everyday profile is only read, never written: each database is copied
// to a temporary file first and read from there. Both run only while the
// browser is closed (daemon/desktop.js quits it first), so every file is
// whole.

import { execFile } from "node:child_process";
import { promises as fs, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME } from "./store.js";

// Where Morse's own profile for this browser lives.
export function morseProfileDir(app, { platform = process.platform, home = HOME } = {}) {
  const pj = platform === "win32" ? path.win32 : path.posix;
  return pj.join(home, app.id === "chrome" ? "browser-profile" : `browser-profile-${app.id}`);
}

// The browser's everyday profile folder (its "User Data"), or null.
export function everydayDir(app, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const chromium = /chromium/i.test(`${app.path || ""} ${app.exe || ""}`);
  const mac = (...p) => path.posix.join(home, "Library", "Application Support", ...p);
  const win = (...p) => env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, ...p) : null;
  const lin = (...p) => path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, ".config"), ...p);
  const dirs = {
    chrome: { darwin: chromium ? mac("Chromium") : mac("Google", "Chrome"), win32: chromium ? win("Chromium", "User Data") : win("Google", "Chrome", "User Data"),
      linux: /\/snap\//.test(app.path || "") ? path.posix.join(home, "snap", "chromium", "common", "chromium") : chromium ? lin("chromium") : lin("google-chrome") },
    edge: { darwin: mac("Microsoft Edge"), win32: win("Microsoft", "Edge", "User Data"), linux: lin("microsoft-edge") },
    brave: { darwin: mac("BraveSoftware", "Brave-Browser"), win32: win("BraveSoftware", "Brave-Browser", "User Data"), linux: lin("BraveSoftware", "Brave-Browser") },
    arc: { darwin: mac("Arc", "User Data") },
    vivaldi: { darwin: mac("Vivaldi"), win32: win("Vivaldi", "User Data"), linux: lin("vivaldi") },
  };
  return dirs[app.id]?.[platform] || null;
}

// Left out of the copy: caches the browser rebuilds, crash reports, and the
// running browser's locks.
const SKIP = new Set([
  "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache", "GrShaderCache", "ShaderCache",
  "CacheStorage", "ScriptCache", "component_crx_cache", "extensions_crx_cache", "Crashpad", "Crash Reports", "BrowserMetrics",
  "OptimizationGuidePredictionModels", "optimization_guide_model_store", "Safe Browsing", "SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile",
]);
const keep = src => !SKIP.has(path.basename(src)) && !/^BrowserMetrics-/.test(path.basename(src));

const exists = p => fs.access(p).then(() => true, () => false);

// The same bytes fs.cp used to write, one file after another. Still the
// fallback when a folder cannot be cloned, and how skipped files are dropped.
const CP = { recursive: true, filter: keep, mode: constants.COPYFILE_FICLONE, preserveTimestamps: true, verbatimSymlinks: true };
const COPY_PARALLEL = 4;

// One clone of a whole folder. macOS `cp -c` is clonefile(2): the folder and
// everything under it, in one call, sharing the disk blocks. Linux
// `--reflink=always` fails unless the disk can share blocks, so a normal
// disk never takes the slow copy by mistake. Windows has no directory clone.
export function profileCloneCommand(platform, from, to) {
  if (platform === "darwin") return { file: "/bin/cp", args: ["-cRp", from, to] };
  if (platform === "linux") return { file: "cp", args: ["-a", "--reflink=always", from, to] };
  return null;
}

function run(file, args, timeout = 120_000) {
  return new Promise(resolve => {
    execFile(file, args, { timeout, windowsHide: true }, err => resolve(!err));
  });
}

let reflinkKnown;
async function linuxCanReflink() {
  if (reflinkKnown !== undefined) return reflinkKnown;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morse-reflink-"));
  try {
    const a = path.join(dir, "a");
    await fs.writeFile(a, "x");
    reflinkKnown = await run("cp", ["--reflink=always", a, path.join(dir, "b")], 5000);
  } catch { reflinkKnown = false; }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
  return reflinkKnown;
}

// cloneDir is a test double, null to force a normal copy, or omitted for
// what this computer can actually do.
async function resolveCloneDir(osPlatform, cloneDir) {
  if (cloneDir !== undefined) return cloneDir || null;
  if (osPlatform === "linux" && !await linuxCanReflink()) return null;
  if (osPlatform !== "darwin" && osPlatform !== "linux") return null;
  return (from, to) => {
    const cmd = profileCloneCommand(osPlatform, from, to);
    return cmd ? run(cmd.file, cmd.args) : false;
  };
}

const isRealDir = e => e.isDirectory() && !e.isSymbolicLink();
// Cloning a parent of one of these would take the caches inside it along.
// The profile folders are checked when they themselves are copied; Storage
// is walked, because its caches sit several levels under an extension id.
const HOLDS_CACHES = /^(Default|Guest Profile|System Profile|Profile \d+|Service Worker|Storage)$/;

// "dirs": a cache folder sits directly inside this one (do not clone it).
// "nested": a profile or Storage sits inside, so a clone would take its caches.
// "files": only a lock file is in the way. "clean": clone the whole folder.
// A cache folder is never opened. IndexedDB, Extensions and the other heavy
// folders are not walked either: their names are not caches, so one clone
// takes the whole tree. The listing budget keeps a huge Storage from being
// split into one clone per file.
async function classify(dir, budget, deep) {
  if (budget.n++ > budget.max) return "clean";
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return "clean";
  let fileSkip = false;
  const subdirs = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (!keep(p)) {
      if (isRealDir(e)) return "dirs";
      fileSkip = true;
      continue;
    }
    if (isRealDir(e)) subdirs.push(e.name);
  }
  if (deep || path.basename(dir) === "Storage") {
    for (const name of subdirs) {
      const sub = await classify(path.join(dir, name), budget, true);
      if (sub === "dirs" || sub === "nested") return "nested";
      if (sub === "files") fileSkip = true;
    }
  } else if (subdirs.some(name => HOLDS_CACHES.test(name))) return "nested";
  return fileSkip ? "files" : "clean";
}

async function tryClone(from, to, clone) {
  if (!clone.fn) return false;
  let ok = false;
  try { ok = (await clone.fn(from, to)) === true; } catch { ok = false; }
  if (!ok) {
    clone.fn = null; // this disk cannot clone; the rest of the profile is copied
    await fs.rm(to, { recursive: true, force: true });
    return false;
  }
  return true;
}

async function mapLimit(items, limit, fn) {
  if (!items.length) return;
  let i = 0, err = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (err == null && i < items.length) {
      const item = items[i++];
      try { await fn(item); } catch (e) { err ||= e; }
    }
  });
  await Promise.all(workers);
  if (err) throw err;
}

async function copyTree(from, to, ctx) {
  const st = await fs.lstat(from);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    await fs.cp(from, to, CP);
    return;
  }
  let nested = false;
  if (ctx.clone.fn) {
    const kind = await classify(from, ctx.budget, ctx.deep);
    if (kind === "clean") {
      if (await tryClone(from, to, ctx.clone)) return;
      await fs.cp(from, to, CP); // this disk cannot clone; a clean folder has no caches
      return;
    }
    // A lock file, a cache, or a profile folder. Split so the heavy folders
    // underneath are still cloned, and so the cache folders are never opened.
    nested = kind === "nested" && (ctx.deep || path.basename(from) === "Storage");
  } else {
    const entries = await fs.readdir(from, { withFileTypes: true });
    if (!entries.some(e => isRealDir(e) && !keep(path.join(from, e.name)))) {
      await fs.cp(from, to, CP);
      return;
    }
  }
  // A cache folder stays behind. Each kept folder is cloned or copied on its own,
  // several at once: Extensions, IndexedDB and the session files don't wait on each other.
  const entries = await fs.readdir(from, { withFileTypes: true });
  await fs.mkdir(to, { recursive: true });
  await fs.chmod(to, st.mode).catch(() => {});
  await fs.utimes(to, st.atime, st.mtime).catch(() => {});
  const kept = entries.filter(e => keep(path.join(from, e.name)));
  const child = nested ? { ...ctx, deep: true } : ctx;
  await mapLimit(kept, COPY_PARALLEL, e => copyTree(path.join(from, e.name), path.join(to, e.name), child));
}

// A whole folder, through a temporary one, so a copy that fails half way
// leaves nothing behind.
async function copyWhole(from, to, clone) {
  const tmp = `${to}.copying`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await copyTree(from, tmp, { clone, budget: { n: 0, max: 20000 }, deep: false });
    await fs.rename(tmp, to);
  } catch (e) { await fs.rm(tmp, { recursive: true, force: true }); throw e; }
}

// The profiles inside a User Data folder: Default, Profile 1, ...
async function profilesIn(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  const out = [];
  for (const n of names) if (await exists(path.join(dir, n, "Preferences"))) out.push(n);
  return out;
}

// node:sqlite, without its "experimental" warning on the terminal. null where
// this Node has none (sign-ins are still copied the first time).
let sqlite;
async function loadSqlite() {
  if (sqlite !== undefined) return sqlite;
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => { if (!/SQLite/i.test(String(w?.message || w))) emit.call(process, w, ...rest); };
  try { sqlite = await import("node:sqlite"); } catch { sqlite = null; } finally { process.emitWarning = emit; }
  return sqlite;
}

// Rows of `table` in the everyday database `from` merged into `to`:
//   newer: the column that says which is newer (cookies); a row newer there
//          replaces the same row here (the table's own unique key decides)
//   without newer: only rows not here are added
// Returns how many rows came in, or a reason it was skipped.
async function mergeTable(from, to, table, { same = [], newer = null, skip = [] } = {}) {
  if (!(await exists(from)) || !(await exists(to))) return "missing";
  const lib = await loadSqlite();
  if (!lib) return "no sqlite";
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-signins-"));
  try {
    // Read from a copy: the everyday profile is never opened for writing.
    const copy = path.join(tmp, "everyday");
    await fs.copyFile(from, copy);
    for (const end of ["-journal", "-wal"]) if (await exists(from + end)) await fs.copyFile(from + end, copy + end);
    const db = new lib.DatabaseSync(to);
    try {
      db.exec(`ATTACH DATABASE '${copy.replace(/'/g, "''")}' AS e`);
      const cols = schema => db.prepare(`PRAGMA ${schema}.table_info(${table})`).all().map(r => r.name);
      const here = cols("main"), there = cols("e");
      if (!here.length || here.join() !== there.join()) return "different versions"; // the browser updates one when it opens it
      const names = here.filter(c => !skip.includes(c));
      const list = names.map(c => `"${c}"`).join(", "), fromC = names.map(c => `c."${c}"`).join(", ");
      const key = same.filter(c => here.includes(c)).map(c => `m."${c}" IS c."${c}"`).join(" AND ");
      const changes = newer && here.includes(newer)
        ? db.prepare(`INSERT OR REPLACE INTO main.${table} (${list}) SELECT ${fromC} FROM e.${table} c
            WHERE c."${newer}" > COALESCE((SELECT MAX(m."${newer}") FROM main.${table} m WHERE ${key}), -1)`).run().changes
        : db.prepare(`INSERT OR IGNORE INTO main.${table} (${list}) SELECT ${list} FROM e.${table}`).run().changes;
      db.exec("DETACH DATABASE e");
      return Number(changes) || 0;
    } finally { db.close(); }
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

const COOKIE_KEY = ["host_key", "top_frame_site_key", "has_cross_site_ancestor", "name", "path", "source_scheme", "source_port"];

// Before the browser opens with Morse (and while it is closed). Resolves
// { copied } the first time, { merged } after, or {} when there is no everyday
// profile. Throws only when the first copy fails: Morse then doesn't open the
// browser on an empty profile.
export async function carrySignIns(app, { platform = process.platform, env = process.env, home, morseHome, say = () => {}, log = () => {}, cloneDir } = {}) {
  const from = everydayDir(app, { platform, env, ...(home && { home }) });
  const to = morseProfileDir(app, { platform, ...(morseHome && { home: morseHome }) });
  if (!from || !(await exists(path.join(from, "Local State")))) return {};
  // What this computer can clone, shared by the first copy and any profile
  // that shows up later. A failure turns it off for the rest of this pass.
  const clone = { fn: await resolveCloneDir(process.platform, cloneDir) };
  if (!(await exists(path.join(to, "Local State")))) {
    say(`Bringing ${app.name}'s sign-ins, tabs and extensions to Morse (only this once)…`);
    try { await copyWhole(from, to, clone); } catch (e) {
      throw Object.assign(new Error(`Morse couldn't copy your ${app.name} profile (${e.code || e.message}), so it didn't open ${app.name}: you would have had to sign in again. Your ${app.name} is as it was.`), { said: true });
    }
    return { copied: true };
  }
  let merged = 0;
  for (const p of await profilesIn(from)) {
    const here = path.join(to, p), there = path.join(from, p);
    if (!(await exists(path.join(here, "Preferences")))) {
      try { await copyWhole(there, here, clone); merged++; } catch (e) { log(`${app.name} ${p}: ${e.message}`); }
      continue;
    }
    for (const [file, table, opts] of [
      [path.join("Network", "Cookies"), "cookies", { same: COOKIE_KEY, newer: "last_update_utc" }],
      ["Cookies", "cookies", { same: COOKIE_KEY, newer: "last_update_utc" }],
      ["Login Data", "logins", { skip: ["id"] }],
    ]) {
      const r = await mergeTable(path.join(there, file), path.join(here, file), table, opts).catch(e => e.message);
      if (typeof r === "number") merged += r;
      else if (r !== "missing") log(`${app.name} ${p} ${file}: ${r}`);
    }
  }
  return { merged };
}
