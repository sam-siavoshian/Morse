// Import this first in every test file: it gives the test process its own
// MORSE_HOME before any daemon module reads it (daemon/store.js resolves HOME
// at import time), so tests never touch the real ~/.morse and concurrent runs
// never share settings.json, sessions/, mods/ or apps.json.
//   import { home, tempDir } from "./helpers/home.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

process.on("exit", () => {
  for (const d of made) try { rmSync(d, { recursive: true, force: true, maxRetries: 2 }); } catch {}
});
