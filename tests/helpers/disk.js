// Free disk for tests. Browser profiles and Electron app copies are big, and
// a full disk makes Chromium crash ("Target crashed"), which looks like a
// real failure. npm test runs this first and stops when the temp folder's
// disk has less than MORSE_TEST_MIN_FREE_GB (default 2) free; every test file
// also warns about it (tests/helpers/home.js).
//   node tests/helpers/disk.js
import { statfsSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const GB = 1024 ** 3;

export function freeBytes(dir = os.tmpdir()) {
  try { const s = statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; }
}

// Returns null when there's room, else the message. `warn` prints it once.
let warned = false;
export function checkDisk({ dir = os.tmpdir(), minGb = Number(process.env.MORSE_TEST_MIN_FREE_GB ?? 2), warn = false } = {}) {
  const free = freeBytes(dir);
  if (!(free < minGb * GB)) return null;
  const msg = `Only ${(free / GB).toFixed(1)} GB free on the disk with ${dir} (tests want ${minGb} GB): Chromium and Electron crash when it fills up. ` +
    `Remove leftover test folders (ls -d ${dir}/morse-*) or free some space. MORSE_TEST_MIN_FREE_GB=0 skips this check.`;
  if (warn && !warned) { warned = true; process.emitWarning(msg, { code: "MORSE_LOW_DISK" }); }
  return msg;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const msg = checkDisk();
  if (msg) { console.error(msg); process.exit(1); }
}
