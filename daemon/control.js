// Desktop side of user control: pause state and safe start in
// ~/.morse/control.json, the connector's control.* requests, and the CLI
// commands `morse pause`, `morse resume`, `morse export --all`,
// `morse import <file|link>` and `morse code <id>`.

import { promises as fs, watchFile } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { HOME, ensureHome, listMods, saveMod, writeExport } from "./store.js";
import { controlHandler, CONTROL_REQUESTS } from "../core/control-host.js";
import { normalizeControl, setPause, pauseInfo } from "../core/control.js";
import { exportBundle, backupFilename, parseImport, prepareInstall } from "../core/backup.js";
import { summarizeMod, modOrigin } from "../core/summary.js";

export { CONTROL_REQUESTS };

export const CONTROL_FILE = path.join(HOME, "control.json");

export async function loadControl() {
  try { return normalizeControl(JSON.parse(await fs.readFile(CONTROL_FILE, "utf8"))); } catch { return normalizeControl({}); }
}
export async function saveControl(state) {
  await ensureHome();
  const tmp = `${CONTROL_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(normalizeControl(state), null, 2));
  await fs.rename(tmp, CONTROL_FILE);
}

const handler = controlHandler({
  load: loadControl,
  save: saveControl,
  listMods,
  putMods: async list => { for (const m of list) await saveMod(m); },
});

// Connector requests. `where` carries the app id the connector knows about.
export function handleControl(msg, where) {
  return handler(msg, where);
}

// Tells every attached window when the pause state changes, whoever changed it
// (this connector, another one, or `morse pause` in a terminal).
export function watchControl(connector) {
  let last = null;
  loadControl().then(s => { last = JSON.stringify(s.pause); });
  watchFile(CONTROL_FILE, { interval: 700 }, async () => {
    const s = await loadControl();
    const now = JSON.stringify(s.pause);
    if (now === last) return;
    last = now;
    const msg = JSON.stringify({ type: "control.changed", pause: s.pause });
    for (const session of connector.pages.values()) {
      session?.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive(${msg})` }).catch(() => {});
    }
  }).unref?.();
}

// ---- CLI

const G = s => `\x1b[32m${s}\x1b[0m`, D = s => `\x1b[2m${s}\x1b[0m`, B = s => `\x1b[1m${s}\x1b[0m`, Y = s => `\x1b[33m${s}\x1b[0m`;
const out = (...a) => console.log(...a);

function printPause(s) {
  const info = pauseInfo(s);
  if (info.all) out(`Morse is ${B("paused everywhere")}. Mods are saved but not running. ${D("morse resume")}`);
  else out(`Morse is ${G("on")}.`);
  if (info.sites.length) out(`Paused on: ${info.sites.join(", ")} ${D("(morse resume <site>)")}`);
}

// morse pause            pause everywhere
// morse pause <site|app> pause one website (host) or desktop app
export async function pauseCli(f) {
  const key = f._[0];
  const s = setPause(await loadControl(), key ? { key, on: true } : { all: true });
  await saveControl(s);
  out(key ? `Paused Morse on ${B(key)}. Its mods are saved but won't run until you resume.` : `Paused Morse ${B("everywhere")}. Your mods are saved but won't run until you resume.`);
  printPause(s);
}

// morse resume            resume everywhere (pauses on single sites stay)
// morse resume <site|app> resume one site or app
// morse resume --all      resume everywhere and every site
export async function resumeCli(f) {
  const key = f._[0];
  let s = await loadControl();
  if (f.all) { s = setPause(s, { all: false }); for (const k of Object.keys(s.pause.sites)) s = setPause(s, { key: k, on: false }); }
  else if (key) {
    if (!s.pause.sites[key]) out(D(`${key} wasn't paused.`));
    s = setPause(s, { key, on: false });
  } else s = setPause(s, { all: false });
  await saveControl(s);
  printPause(s);
}

// morse export --all [--out <file>]
export async function exportAllCli(f) {
  const mods = await listMods();
  const content = JSON.stringify(exportBundle(mods), null, 2);
  let file;
  if (typeof f.out === "string") { file = path.resolve(f.out); await fs.writeFile(file, content); }
  else file = await writeExport(backupFilename(), content);
  out(`Saved ${mods.length} mod${mods.length === 1 ? "" : "s"} to ${file}`);
  out(D(`Restore with: morse import ${file}`));
  return file;
}

function describe(mod) {
  const s = summarizeMod(mod);
  const where = mod.match?.app || (mod.match?.hosts || []).join(", ") || "any site";
  const lines = [`${B(mod.title)} ${D(`for ${where}`)}`, D(`  “${mod.prompt}”`)];
  if (s.empty) lines.push("  - Doesn't change anything (it has no code)");
  for (const i of s.items) lines.push(`  - ${i.text}`);
  for (const n of s.notes) lines.push(Y(`  Note: ${n.text}`));
  return lines.join("\n");
}

// morse import <file|link> [--yes]
export async function importCli(f) {
  const src = f._[0];
  if (!src) throw new Error("What should Morse import? e.g. morse import morse-mods.json");
  const text = src.includes("#m=") ? src : await fs.readFile(src, "utf8");
  const { kind, mods, errors } = await parseImport(text);
  out(`${kind === "backup" ? "This backup has" : "This is"} ${mods.length} mod${mods.length === 1 ? "" : "s"}. What ${mods.length === 1 ? "it does" : "they do"}:\n`);
  for (const m of mods) out(describe(m) + "\n");
  for (const e of errors) out(D(`Skipped ${e}`));
  out(D(`See the code first: open the file, or after installing run morse code <id>.`));
  if (!f.yes) {
    if (!process.stdin.isTTY) throw new Error("Add --yes to install without being asked.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = (await rl.question(`Install ${mods.length === 1 ? "it" : "them"}? [y/N] `)).trim().toLowerCase();
    rl.close();
    if (a !== "y" && a !== "yes") { out("Nothing installed."); return []; }
  }
  const saved = [];
  for (const m of mods) saved.push(await saveMod(prepareInstall(m, { kind: kind === "link" ? "link" : kind === "backup" ? "backup" : "mod", where: {} })));
  out(`Installed ${saved.map(m => B(m.title)).join(", ")}`);
  return saved;
}

// morse code <id>: what a mod does, where it came from, and its code.
export async function codeCli(f) {
  const id = f._[0];
  const mod = (await listMods()).find(m => m.id === id || m.id.startsWith(id || "\0"));
  if (!mod) throw new Error(`No mod ${id || ""}. List them with: morse mods`);
  out(describe(mod));
  out(D(`  ${modOrigin(mod)} · ${mod.enabled ? "on" : "off"} · ${mod.id}`));
  if (mod.css.trim()) out(`\n${B("CSS")}\n${mod.css.trim()}`);
  if (mod.js.trim()) out(`\n${B("JavaScript")}\n${mod.js.trim()}`);
}
