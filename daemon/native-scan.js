// The disk scan, the process list, and a local-model probe, done by the
// morse-scan binary when it has been built. daemon/apps.js is the fallback
// (the CLI, tests, and a checkout with no Rust toolchain). No new packages:
// one execFile of a small program.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// MORSE_SCAN_BIN, else the release build, else the debug build.
export function rustBin() {
  const env = process.env.MORSE_SCAN_BIN;
  if (env) return existsSync(env) ? env : null;
  const name = process.platform === "win32" ? "morse-scan.exe" : "morse-scan";
  for (const kind of ["release", "debug"]) {
    const p = path.join(root, "native", "morse-scan", "target", kind, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function run(args, input, timeout) {
  const file = rustBin();
  if (!file) return null;
  try {
    return execFileSync(file, args, { input, encoding: "utf8", maxBuffer: 64 << 20, timeout, windowsHide: true });
  } catch { return null; }
}

// Same array discoverApps returns. A missing binary, or a context that isn't
// a real disk (a test double), stays on the JS walk.
export function discoverAppsNative(apps, ctx) {
  if (!ctx || typeof ctx.exists !== "function" || !rustBin()) return apps.discoverApps(ctx);
  const spec = JSON.stringify({
    platform: ctx.platform, root: ctx.root || "", home: ctx.home || "", env: ctx.env || {}, catalog: apps.CATALOG,
  });
  const out = run(["discover"], spec, 120000);
  if (!out) return apps.discoverApps(ctx);
  try {
    const v = JSON.parse(out);
    if (Array.isArray(v)) return v;
  } catch {}
  return apps.discoverApps(ctx);
}

export function listProcessesNative(apps, platform = process.platform) {
  const out = run(["processes", platform], "", 30000);
  if (!out) return apps.listProcesses(platform);
  try {
    const v = JSON.parse(out);
    if (Array.isArray(v)) return v;
  } catch {}
  return apps.listProcesses(platform);
}

// One local model server (Ollama or an OpenAI-compatible localhost).
// null: no binary, or the address isn't loopback HTTP, so the caller uses fetch.
export function probeLocalNative(runtime, timeoutMs = 800) {
  const out = run(["probe-local"], JSON.stringify({ ...runtime, timeoutMs }), Math.max(Number(timeoutMs) * 4, 3000));
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}
