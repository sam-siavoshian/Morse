// Mods and settings on disk: ~/.morse/mods/<id>.json, ~/.morse/config.json
// (model), ~/.morse/settings.json (command bar) and ~/.morse/history.json.
//
// Every update to a file goes through that file's queue (one read-modify-write
// at a time, so concurrent requests can't drop each other's changes) and is
// written to a temp file that is renamed over the old one (a crash or a
// concurrent reader never sees half a file).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modMatches, validateMod } from "../core/mod.js";
import { normalizePrefs, mergePrefs, pushHistory } from "../core/prefs.js";
import { clipAdd } from "../core/clipboard.js";
import { serialQueue } from "../core/serial.js";
export const HOME = process.env.MORSE_HOME || path.join(os.homedir(), ".morse");
const MODS = path.join(HOME, "mods");
const CONFIG = path.join(HOME, "config.json");
const PREFS = path.join(HOME, "settings.json");
const HISTORY = path.join(HOME, "history.json");

export async function ensureHome() {
  for (const d of [HOME, MODS, path.join(HOME, "exports"), path.join(HOME, "clips")]) await fs.mkdir(d, { recursive: true });
}

const queue = serialQueue();
let tmpSeq = 0;

// Write to <file>.<pid>-<n>.tmp, then rename it into place.
async function writeAtomic(file, data) {
  await ensureHome();
  const tmp = `${file}.${process.pid}-${++tmpSeq}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await renameOver(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// Windows refuses to replace a file that another process (an antivirus, an
// indexer, a reader) has open for a moment; try again briefly.
async function renameOver(from, to) {
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
    try { out.push(JSON.parse(await fs.readFile(path.join(MODS, f), "utf8"))); } catch {}
  }
  return out.sort((a, b) => a.created.localeCompare(b.created));
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
  try { return JSON.parse(await fs.readFile(path.join(MODS, `${safe(id)}.json`), "utf8")); } catch { return null; }
}

export async function loadConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG, "utf8")); } catch { return {}; }
}

export async function saveConfig(cfg) {
  await queue(CONFIG, () => writeAtomic(CONFIG, JSON.stringify(cfg, null, 2)));
}

// Command-bar settings (hotkeys, voice, appearance): ~/.morse/settings.json
export async function loadPrefs() {
  try { return normalizePrefs(JSON.parse(await fs.readFile(PREFS, "utf8"))); } catch { return normalizePrefs({}); }
}

export function savePrefs(patch) {
  return queue(PREFS, async () => {
    const next = mergePrefs(await loadPrefs(), patch);
    await writeAtomic(PREFS, JSON.stringify(next, null, 2));
    return next;
  });
}

// Prompt history per app (or per site): ~/.morse/history.json
async function readHistory() {
  try { return JSON.parse(await fs.readFile(HISTORY, "utf8")) || {}; } catch { return {}; }
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
  try { const l = JSON.parse(await fs.readFile(CLIPBOARD, "utf8")); return Array.isArray(l) ? l : []; } catch { return []; }
}
export function putClipboard(item) {
  return queue(CLIPBOARD, async () => {
    const list = clipAdd(await readClipboard(), item);
    await writeAtomic(CLIPBOARD, JSON.stringify(list));
    return list;
  });
}

const safe = id => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
