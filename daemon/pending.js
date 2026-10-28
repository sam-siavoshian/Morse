// The in-progress change, on disk in ~/.morse/pending.json, so a reload of the
// app brings it back until Save or Undo (core/pending.js). One file, one
// write at a time, same temp-and-rename as the mods.

import { promises as fs } from "node:fs";
import path from "node:path";
import { HOME, ensureHome, parseJson, renameOver } from "./store.js";
import { serialQueue } from "../core/serial.js";
import { packPending, readPending, dropPending } from "../core/pending.js";

const file = () => path.join(HOME, "pending.json");
const queue = serialQueue();
let seq = 0;

async function load() {
  try { return parseJson(await fs.readFile(file(), "utf8")); } catch { return {}; }
}

async function save(data) {
  await ensureHome();
  const dest = file();
  const tmp = `${dest}.${process.pid}-${++seq}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data));
    await renameOver(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export function pendingFor(where) {
  return queue(file(), async () => readPending(await load(), where));
}

export function rememberPending(where, draft) {
  return queue(file(), async () => {
    const next = packPending(await load(), where, draft);
    if (!next) return null;
    await save(next);
    return readPending(next, where);
  });
}

export function forgetPending(where, id) {
  return queue(file(), async () => {
    const cur = await load();
    const before = readPending(cur, where);
    const next = dropPending(cur, where, id);
    const after = readPending(next, where);
    if ((!before && !after) || (before && after && before.id === after.id)) return true;
    await save(next);
    return true;
  });
}
