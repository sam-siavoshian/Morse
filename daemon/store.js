// Mods and settings on disk: ~/.morse/mods/<id>.json, ~/.morse/config.json
// (model), ~/.morse/settings.json (command bar) and ~/.morse/history.json.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modMatches, validateMod } from "../core/mod.js";
import { normalizePrefs, mergePrefs, pushHistory } from "../core/prefs.js";

export const HOME = process.env.MORSE_HOME || path.join(os.homedir(), ".morse");
const MODS = path.join(HOME, "mods");
const CONFIG = path.join(HOME, "config.json");
const PREFS = path.join(HOME, "settings.json");
const HISTORY = path.join(HOME, "history.json");

export async function ensureHome() {
  for (const d of [HOME, MODS, path.join(HOME, "exports"), path.join(HOME, "clips")]) await fs.mkdir(d, { recursive: true });
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
  await ensureHome();
  await fs.writeFile(path.join(MODS, `${safe(mod.id)}.json`), JSON.stringify(mod, null, 2));
  return mod;
}

export async function deleteMod(id) {
  await fs.rm(path.join(MODS, `${safe(id)}.json`), { force: true });
}

export async function loadConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG, "utf8")); } catch { return {}; }
}

export async function saveConfig(cfg) {
  await ensureHome();
  await fs.writeFile(CONFIG, JSON.stringify(cfg, null, 2));
}

// Command-bar settings (hotkeys, voice, appearance): ~/.morse/settings.json
export async function loadPrefs() {
  try { return normalizePrefs(JSON.parse(await fs.readFile(PREFS, "utf8"))); } catch { return normalizePrefs({}); }
}

export async function savePrefs(patch) {
  const next = mergePrefs(await loadPrefs(), patch);
  await ensureHome();
  await fs.writeFile(PREFS, JSON.stringify(next, null, 2));
  return next;
}

// Prompt history per app (or per site): ~/.morse/history.json
async function readHistory() {
  try { return JSON.parse(await fs.readFile(HISTORY, "utf8")) || {}; } catch { return {}; }
}

export async function loadHistory(scope) {
  const all = await readHistory();
  return Array.isArray(all[scope]) ? all[scope] : [];
}

export async function addHistory(scope, text) {
  const all = await readHistory();
  all[scope] = pushHistory(all[scope], text);
  await ensureHome();
  await fs.writeFile(HISTORY, JSON.stringify(all, null, 2));
  return all[scope];
}

export async function writeExport(filename, data) {
  await ensureHome();
  const p = path.join(HOME, "exports", path.basename(filename));
  await fs.writeFile(p, data);
  return p;
}

const safe = id => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
