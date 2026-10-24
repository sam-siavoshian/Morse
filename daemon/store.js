// Mods and settings on disk: ~/.morse/mods/<id>.json and ~/.morse/config.json.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modMatches, validateMod } from "../core/mod.js";

export const HOME = process.env.MORSE_HOME || path.join(os.homedir(), ".morse");
const MODS = path.join(HOME, "mods");
const CONFIG = path.join(HOME, "config.json");

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

// The config holds API keys and helper tokens: owner-only, written atomically.
export async function saveConfig(cfg) {
  await ensureHome();
  const tmp = `${CONFIG}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.rename(tmp, CONFIG);
  await fs.chmod(CONFIG, 0o600).catch(() => {});
}

// Read-modify-write, serialized within this process.
let queue = Promise.resolve();
export function updateConfig(fn) {
  const run = queue.then(async () => {
    const cfg = await loadConfig();
    const out = (await fn(cfg)) ?? cfg;
    await saveConfig(out);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

export const CONFIG_PATH = CONFIG;

export async function writeExport(filename, data) {
  await ensureHome();
  const p = path.join(HOME, "exports", path.basename(filename));
  await fs.writeFile(p, data);
  return p;
}

const safe = id => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
