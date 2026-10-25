// Take this, Bring here on the computer: the features people took, in
// ~/.morse/taken.json (owner-only, like the rest of ~/.morse). Every app and
// browser Morse connects to reads the same list.
// core/take-host.js has the logic.

import { promises as fs } from "node:fs";
import path from "node:path";
import { HOME, ensureHome, parseJson, renameOver } from "./store.js";
import { createTakeHost, TAKE_REQUESTS } from "../core/take-host.js";

export { TAKE_REQUESTS };
export const TAKEN_FILE = path.join(HOME, "taken.json");

export async function loadTaken() {
  try { const l = parseJson(await fs.readFile(TAKEN_FILE, "utf8")); return Array.isArray(l) ? l : []; } catch { return []; }
}

let seq = 0;
export async function saveTaken(list) {
  await ensureHome();
  const tmp = `${TAKEN_FILE}.${process.pid}-${++seq}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(list), { mode: 0o600 });
    await renameOver(tmp, TAKEN_FILE);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// One list for every app and browser Morse opens: they all read this file.
export const Take = createTakeHost({ load: loadTaken, save: saveTaken, shared: async () => true });
