// Where native mods live between sessions. A native mod is a declarative
// ModSpec (schema.js); this saves them per target app (keyed by executable
// path) so `morse launch`-ing the app again re-applies the ones you kept —
// the native cousin of the web mod store.
//
// A tiny JSON file by default (~/.morse/native-mods.json), but the fs is
// injectable so the logic is unit-testable without touching disk.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = process.env.MORSE_HOME || path.join(os.homedir(), ".morse");
export const DEFAULT_FILE = path.join(HOME, "native-mods.json");

// A stable key for a target: its executable path (one app → one bucket).
export function keyFor(context) { return (context && context.exe) || "*"; }

const realFs = {
  read: p => readFileSync(p, "utf8"),
  write: (p, c) => writeFileSync(p, c),
  mkdir: d => { try { mkdirSync(d, { recursive: true }); } catch {} },
};

export function createStore({ file = DEFAULT_FILE, fs = realFs } = {}) {
  const read = () => { try { const v = JSON.parse(fs.read(file)); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
  const write = data => { fs.mkdir(path.dirname(file)); fs.write(file, JSON.stringify(data, null, 2)); };
  return {
    // All saved mods for a target, in insertion order.
    list(key) { const l = read()[key]; return Array.isArray(l) ? l : []; },
    // Replace the whole set for a target.
    saveAll(key, specs) { const d = read(); d[key] = Array.isArray(specs) ? specs : []; write(d); return d[key]; },
    // Add or replace one mod (by id).
    upsert(key, spec) { const d = read(); const l = (Array.isArray(d[key]) ? d[key] : []).filter(s => s.id !== spec.id); l.push(spec); d[key] = l; write(d); return l; },
    // Forget one mod.
    remove(key, id) { const d = read(); d[key] = (Array.isArray(d[key]) ? d[key] : []).filter(s => s.id !== id); write(d); return d[key]; },
  };
}
