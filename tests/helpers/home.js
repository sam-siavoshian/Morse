// Import this first in every test file: it gives the test process its own
// MORSE_HOME before any daemon module reads it (daemon/store.js resolves HOME
// at import time), so tests never touch the real ~/.morse and concurrent runs
// never share settings.json, sessions/, mods/ or apps.json.
//   import { home, tempDir } from "./helpers/home.js";
//
// Every folder made with tempDir() (homes, browser profiles, app copies) is
// removed when the test process ends, however it ends: passed, failed, timed
// out, or stopped with Ctrl+C or SIGTERM. Browsers and apps still running
// from one of them are stopped first, so they can't write into it again.
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkDisk } from "./disk.js";

const made = [];

// A scratch directory removed when the test process exits.
export function tempDir(prefix = "morse-test-") {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

export const home = tempDir("morse-home-");
process.env.MORSE_HOME = home;
// Nothing a test starts should reach a helper or a Morse instance on the default ports.
process.env.MORSE_HELPER_PORT ||= "1"; // nothing listens on port 1: `morse status` reports the helper as not running

// Processes (Chromium, Electron, morse) whose command line names one of our
// folders: a test that timed out may have left them running. Linux only.
function killUsers(dirs) {
  if (process.platform !== "linux") return;
  let pids = [];
  try { pids = readdirSync("/proc").filter(p => /^\d+$/.test(p) && Number(p) !== process.pid); } catch { return; }
  for (const pid of pids) {
    let cmd = "";
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { continue; }
    cmd += "\0";
    if (dirs.some(d => cmd.includes(d + "/") || cmd.includes(d + "\0"))) try { process.kill(Number(pid), "SIGKILL"); } catch {}
  }
}

// A Chromium profile links its lock socket into a folder of Chromium's own in
// the temp folder (org.chromium.Chromium.*); a killed browser leaves it there.
function chromiumSockets(dirs) {
  const out = [];
  for (const d of dirs) {
    let subs = [];
    try { subs = readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)); } catch {}
    for (const p of [d, ...subs]) {
      try { const to = path.dirname(readlinkSync(path.join(p, "SingletonSocket"))); if (/[\\/]org\.chromium\.Chromium\.\w+$/.test(to)) out.push(to); } catch {}
    }
  }
  return out;
}

let cleaned = false;
export function cleanupNow() {
  if (cleaned) return;
  cleaned = true;
  const dirs = made.filter(d => existsSync(d));
  if (!dirs.length) return;
  killUsers(dirs);
  for (const d of [...chromiumSockets(dirs), ...dirs]) try { rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
}

process.on("exit", cleanupNow);
// Signals skip "exit": clean up, then end the way the signal would have.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(sig, () => { cleanupNow(); process.kill(process.pid, sig); });
}

checkDisk({ warn: true });
