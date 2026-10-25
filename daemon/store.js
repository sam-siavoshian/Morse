// Mods and settings on disk: ~/.morse/mods/<id>.json, ~/.morse/config.json
// (model), ~/.morse/settings.json (command bar) and ~/.morse/history.json.
//
// Every update to a file goes through that file's queue (one read-modify-write
// at a time, so concurrent requests can't drop each other's changes) and is
// written to a temp file that is renamed over the old one (a crash or a
// concurrent reader never sees half a file).

import { promises as fs, watchFile, unwatchFile } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modMatches, validateMod, byCreated } from "../core/mod.js";
import { normalizePrefs, mergePrefs, pushHistory } from "../core/prefs.js";
import { clipAdd } from "../core/clipboard.js";
import { serialQueue } from "../core/serial.js";
import { resolveHotkeys, formatCombo, detectPlatform } from "../core/hotkeys.js";
export const HOME = process.env.MORSE_HOME || path.join(os.homedir(), ".morse");
const MODS = path.join(HOME, "mods");
const CONFIG = path.join(HOME, "config.json");
const PREFS = path.join(HOME, "settings.json");
const HISTORY = path.join(HOME, "history.json");

export async function ensureHome() {
  // Owner-only on macOS and Linux (Windows ignores the mode; see daemon/platform.js).
  await fs.mkdir(HOME, { recursive: true, mode: 0o700 });
  for (const d of [MODS, path.join(HOME, "exports"), path.join(HOME, "clips")]) await fs.mkdir(d, { recursive: true });
}

const queue = serialQueue();
let tmpSeq = 0;

// Write to <file>.<pid>-<n>.tmp, then rename it into place.
async function writeAtomic(file, data, opts) {
  await ensureHome();
  const tmp = `${file}.${process.pid}-${++tmpSeq}.tmp`;
  try {
    await fs.writeFile(tmp, data, opts);
    await renameOver(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// JSON from a file a person may have edited: Notepad on Windows can save it
// with a byte order mark in front, which JSON.parse refuses (and the file
// would quietly read as empty). Line endings don't matter to JSON.
export const parseJson = text => JSON.parse(String(text).replace(/^\uFEFF/, ""));

// Windows refuses to replace a file that another process (an antivirus, an
// indexer, a reader) has open for a moment; try again briefly.
export async function renameOver(from, to) {
  for (let i = 0; ; i++) {
    try { return await fs.rename(from, to); }
    catch (e) {
      if (i >= 6 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 15 * (i + 1)));
    }
  }
}

export async function listMods() {
  await ensureHome();
  const out = [];
  for (const f of await fs.readdir(MODS)) {
    if (!f.endsWith(".json")) continue;
    try { const m = parseJson(await fs.readFile(path.join(MODS, f), "utf8")); if (m && typeof m === "object") out.push(m); } catch {}
  }
  return out.sort(byCreated);
}

export async function modsFor(where) {
  return (await listMods()).filter(m => modMatches(m, where));
}

export async function saveMod(mod) {
  validateMod(mod);
  const file = path.join(MODS, `${safe(mod.id)}.json`);
  await queue(file, () => writeAtomic(file, JSON.stringify(mod, null, 2)));
  return mod;
}

export async function deleteMod(id) {
  const file = path.join(MODS, `${safe(id)}.json`);
  await queue(file, () => fs.rm(file, { force: true }));
}

export async function getMod(id) {
  try { return parseJson(await fs.readFile(path.join(MODS, `${safe(id)}.json`), "utf8")); } catch { return null; }
}

export async function loadConfig() {
  try { return parseJson(await fs.readFile(CONFIG, "utf8")); } catch { return {}; }
}

// The config holds API keys and helper tokens: owner-only, written atomically.
async function writeConfig(cfg) {
  await writeAtomic(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.chmod(CONFIG, 0o600).catch(() => {});
}
export async function saveConfig(cfg) {
  await queue(CONFIG, async () => { await keepUnreadableConfig(); await writeConfig(cfg); });
}

// A config.json that isn't valid JSON (edited by hand, cut short): Morse runs
// on its defaults and says so (daemon/cli.js), and before writing a new one
// keeps a copy, so nothing in it (keys, tokens) is lost.
export const keptConfigCopies = [];
export async function configUnreadable() {
  let text;
  try { text = await fs.readFile(CONFIG, "utf8"); } catch { return false; }
  try { parseJson(text); return false; } catch { return true; }
}
async function keepUnreadableConfig() {
  let text;
  try { text = await fs.readFile(CONFIG, "utf8"); parseJson(text); return; } catch { if (text === undefined) return; }
  const copy = `${CONFIG}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.writeFile(copy, text, { mode: 0o600 });
  keptConfigCopies.push(copy);
}

// Read-modify-write, in the config file's queue.
export function updateConfig(fn) {
  return queue(CONFIG, async () => {
    await keepUnreadableConfig();
    const cfg = await loadConfig();
    const out = (await fn(cfg)) ?? cfg;
    await writeConfig(out);
    return out;
  });
}

export const CONFIG_PATH = CONFIG;

// Command-bar settings (hotkeys, voice, appearance): ~/.morse/settings.json
export async function loadPrefs() {
  try { return normalizePrefs(parseJson(await fs.readFile(PREFS, "utf8"))); } catch { return normalizePrefs({}); }
}

export function savePrefs(patch) {
  return queue(PREFS, async () => {
    const next = mergePrefs(await loadPrefs(), patch);
    await writeAtomic(PREFS, JSON.stringify(next, null, 2));
    return next;
  });
}

// Tells a connected app when settings.json changes, whoever wrote it (the
// desktop window, the bar in another app, or morse in a terminal). The first
// read is only a baseline, so attaching doesn't push what's already on disk.
// Returns { close(), ready }. ready resolves once that baseline is known.
export function watchPrefs(onPrefs) {
  let last;
  let closed = false;
  const tick = async () => {
    if (closed) return;
    let text = "";
    try { text = await fs.readFile(PREFS, "utf8"); } catch { text = ""; }
    if (closed || text === last) return;
    const first = last === undefined;
    last = text;
    if (first || !text) return;
    let prefs;
    try { prefs = normalizePrefs(parseJson(text)); } catch { return; }
    try { onPrefs(prefs); } catch {}
  };
  const onChange = () => { tick(); };
  watchFile(PREFS, { interval: 400 }, onChange).unref?.();
  return { close() { closed = true; unwatchFile(PREFS, onChange); }, ready: tick() };
}

// The hotkeys in effect on this computer as people read them ("Ctrl+Shift+Space",
// "⌥Space"); "" for one that's turned off.
export async function configuredHotkeys(platform = detectPlatform({ platform: process.platform })) {
  const keys = resolveHotkeys((await loadPrefs()).hotkeys, platform);
  return Object.fromEntries(Object.entries(keys).map(([id, combo]) => [id, combo ? formatCombo(combo, platform) : ""]));
}

// Prompt history per app (or per site): ~/.morse/history.json
async function readHistory() {
  try { return parseJson(await fs.readFile(HISTORY, "utf8")) || {}; } catch { return {}; }
}

export async function loadHistory(scope) {
  const all = await readHistory();
  return Array.isArray(all[scope]) ? all[scope] : [];
}

export function addHistory(scope, text) {
  return queue(HISTORY, async () => {
    const all = await readHistory();
    all[scope] = pushHistory(all[scope], text);
    await writeAtomic(HISTORY, JSON.stringify(all, null, 2));
    return all[scope];
  });
}

export async function writeExport(filename, data) {
  const p = path.join(HOME, "exports", path.basename(filename));
  await queue(p, () => writeAtomic(p, data));
  return p;
}

// God mode's cross-app clipboard: ~/.morse/clipboard.json, newest first, max 20.
const CLIPBOARD = path.join(HOME, "clipboard.json");
export async function readClipboard() {
  try { const l = parseJson(await fs.readFile(CLIPBOARD, "utf8")); return Array.isArray(l) ? l : []; } catch { return []; }
}
export function putClipboard(item) {
  return queue(CLIPBOARD, async () => {
    const list = clipAdd(await readClipboard(), item);
    await writeAtomic(CLIPBOARD, JSON.stringify(list));
    return list;
  });
}

const safe = id => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
