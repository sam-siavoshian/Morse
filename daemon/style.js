// Your style on the desktop: ~/.morse/style.json, served to every window the
// Morse helper connects to (core/style-host.js has the logic). Chrome shares
// it when it is paired with the Morse helper (daemon/bridge.js /v1/style,
// core/style-sync.js); the file is watched, so a change made by another
// process (`morse serve` for Chrome, while `morse launch` runs an app) reaches
// every open window too.

import { promises as fs, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import { HOME, ensureHome, loadConfig } from "./store.js";
import { createStyleHost, STYLE_REQUESTS } from "../core/style-host.js";

export { STYLE_REQUESTS };
export const STYLE_FILE = path.join(HOME, "style.json");

let seen = null; // the file's text as this process last wrote or saw it
export async function loadStyle() {
  try { return JSON.parse(await fs.readFile(STYLE_FILE, "utf8")); } catch { return null; }
}

let seq = 0;
export async function saveStyle(style) {
  await ensureHome();
  if (!style) { seen = ""; return fs.rm(STYLE_FILE, { force: true }); }
  const text = JSON.stringify(style, null, 2);
  seen = text;
  const tmp = `${STYLE_FILE}.${process.pid}-${++seq}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, STYLE_FILE);
}

const listeners = new Set();
const emit = () => listeners.forEach(fn => { try { fn(); } catch {} });
async function onFile() {
  const text = await fs.readFile(STYLE_FILE, "utf8").catch(() => "");
  if (text === seen) return; // this process wrote it, and has told its windows
  seen = text;
  emit();
}
export const onStyleChange = fn => {
  listeners.add(fn);
  if (listeners.size === 1) watchFile(STYLE_FILE, { interval: 700 }, onFile).unref?.();
  return () => { listeners.delete(fn); if (!listeners.size) unwatchFile(STYLE_FILE, onFile); };
};

// Every app, and every site too when a browser is paired with the Morse helper.
export async function styleReach() {
  const cfg = await loadConfig().catch(() => ({}));
  return (cfg.bridge?.tokens || []).some(t => t.origin) ? "all" : "apps";
}

export const Style = createStyleHost({
  load: loadStyle,
  save: saveStyle,
  onChange: emit,
  reach: styleReach,
});
