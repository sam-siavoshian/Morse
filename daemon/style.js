// Your style on the desktop: ~/.morse/style.json, served to every window the
// Morse helper connects to (core/style-host.js has the logic).

import { promises as fs } from "node:fs";
import path from "node:path";
import { HOME, ensureHome } from "./store.js";
import { createStyleHost, STYLE_REQUESTS } from "../core/style-host.js";

export { STYLE_REQUESTS };
export const STYLE_FILE = path.join(HOME, "style.json");

export async function loadStyle() {
  try { return JSON.parse(await fs.readFile(STYLE_FILE, "utf8")); } catch { return null; }
}

let seq = 0;
export async function saveStyle(style) {
  await ensureHome();
  if (!style) return fs.rm(STYLE_FILE, { force: true });
  const tmp = `${STYLE_FILE}.${process.pid}-${++seq}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(style, null, 2));
  await fs.rename(tmp, STYLE_FILE);
}

const listeners = new Set();
export const onStyleChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export const Style = createStyleHost({
  load: loadStyle,
  save: saveStyle,
  onChange: () => listeners.forEach(fn => { try { fn(); } catch {} }),
});
