// Your browser, with Morse, still signed in to everything.
//
// Since Chrome 136, a Chromium browser takes no remote control of its
// everyday profile, so Morse opens it on a profile folder of its own
// (~/.morse/browser-profile). An empty folder would mean signing in to every
// site again, so Morse never opens one when there is an everyday profile:
//
//   - the first time, the everyday profile is copied in whole (sign-ins,
//     saved passwords, tabs, extensions, bookmarks), caches left out. On a Mac
//     the copy is a clone: instant, and no extra space.
//   - every time after, sign-ins made in the everyday browser since are
//     merged in: a cookie newer there replaces the one here, a saved password
//     not here is added. Nothing here is removed, so a sign-in made in the
//     browser opened with Morse stays too.
//
// The everyday profile is only read, never written: each database is copied
// to a temporary file first and read from there. Both run only while the
// browser is closed (daemon/desktop.js quits it first), so every file is
// whole.

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

// A whole folder, through a temporary one, so a copy that fails half way
// leaves nothing behind.
async function copyWhole(from, to) {
  const tmp = `${to}.copying`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.cp(from, tmp, { recursive: true, filter: keep, mode: constants.COPYFILE_FICLONE, preserveTimestamps: true, verbatimSymlinks: true });
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
export async function carrySignIns(app, { platform = process.platform, env = process.env, home, morseHome, say = () => {}, log = () => {} } = {}) {
  const from = everydayDir(app, { platform, env, ...(home && { home }) });
  const to = morseProfileDir(app, { platform, ...(morseHome && { home: morseHome }) });
  if (!from || !(await exists(path.join(from, "Local State")))) return {};
  if (!(await exists(path.join(to, "Local State")))) {
    say(`Bringing ${app.name}'s sign-ins, tabs and extensions to Morse (only this once)…`);
    try { await copyWhole(from, to); } catch (e) {
      throw Object.assign(new Error(`Morse couldn't copy your ${app.name} profile (${e.code || e.message}), so it didn't open ${app.name}: you would have had to sign in again. Your ${app.name} is as it was.`), { said: true });
    }
    return { copied: true };
  }
  let merged = 0;
  for (const p of await profilesIn(from)) {
    const here = path.join(to, p), there = path.join(from, p);
    if (!(await exists(path.join(here, "Preferences")))) {
      try { await copyWhole(there, here); merged++; } catch (e) { log(`${app.name} ${p}: ${e.message}`); }
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
