// Where native mods live between sessions. A native mod is a declarative
// ModSpec (schema.js); this saves them per target app (keyed by executable
// path) so `morse launch`-ing the app again re-applies the ones you kept —
// the native cousin of the web mod store.
//
// A tiny JSON file by default (~/.morse/native-mods.json), but the fs is
// injectable so the logic is unit-testable without touching disk.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = process.env.MORSE_HOME || path.join(os.homedir(), ".morse");
export const DEFAULT_FILE = path.join(HOME, "native-mods.json");

// A stable key for a target: its executable path (one app → one bucket).
export function keyFor(context) { return (context && context.exe) || "*"; }

const realFs = {
  read: p => readFileSync(p, "utf8"),
  write: (p, c) => writeFileSync(p, c),
  rename: (a, b) => renameSync(a, b),
  mkdir: d => { try { mkdirSync(d, { recursive: true }); } catch {} },
};

export function createStore({ file = DEFAULT_FILE, fs = realFs } = {}) {
  // A missing store reads as empty; any other read error (permissions, I/O) and
  // a present-but-corrupt file throw rather than reading as empty, so the next
  // write can't silently wipe saved mods.
  const corrupt = () => new Error(`native mods store is corrupt (${file}); not overwriting it`);
  const read = () => {
    let raw;
    try { raw = fs.read(file); }
    catch (e) { if (e && e.code === "ENOENT") return {}; throw e; }
    let v;
    try { v = JSON.parse(raw); } catch { throw corrupt(); }
    // Only a plain object maps app keys → mod arrays. null, an array, or any
    // other JSON value is a wrong shape — treat it as corrupt, not empty, so a
    // write can't replace real data derived from it. Each present bucket must
    // itself be an array; a non-array bucket (e.g. null) would read as empty
    // and then be overwritten, silently losing whatever it held.
    if (!v || typeof v !== "object" || Array.isArray(v)) throw corrupt();
    for (const key of Object.keys(v)) if (!Array.isArray(v[key])) throw corrupt();
    return v;
  };
  // Write a temp file, then atomically rename over the store, so a partial write
  // can't corrupt it or be read half-written.
  const write = data => {
    fs.mkdir(path.dirname(file));
    const tmp = `${file}.${process.pid}.tmp`;
    fs.write(tmp, JSON.stringify(data, null, 2));
    fs.rename(tmp, file);
  };
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
