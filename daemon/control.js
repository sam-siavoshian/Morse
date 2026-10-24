// Desktop side of user control: pause state and safe start in
// ~/.morse/control.json, the connector's control.* requests, and the CLI
// commands `morse pause`, `morse resume`, `morse export --all`,
// `morse import <file|link>` and `morse code <id>`.

import { promises as fs, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { HOME, ensureHome, listMods, saveMod, writeExport } from "./store.js";
import { controlHandler, CONTROL_REQUESTS } from "../core/control-host.js";
import { normalizeControl, setPause, pauseInfo } from "../core/control.js";
import { exportBundle, backupFilename, parseImport, prepareInstall } from "../core/backup.js";
import { summarizeMod, modOrigin, shownCode } from "../core/summary.js";
import { paint, shown } from "./colors.js";
import { t } from "../core/i18n.js"; // daemon/cli.js sets the language from LANG / LC_ALL

export { CONTROL_REQUESTS };

export const CONTROL_FILE = path.join(HOME, "control.json");

export async function loadControl() {
  try { return normalizeControl(JSON.parse(await fs.readFile(CONTROL_FILE, "utf8"))); } catch { return normalizeControl({}); }
}
// Writes in this process happen one at a time, in order, each through its
// own temp file; a page's read-modify-write (the handler below) holds the
// same turn from its read to its write, so a `saveControl` made meanwhile
// (`morse pause` / `morse resume`, tests) lands after it instead of being lost.
let turn = Promise.resolve();
function inTurn(fn) {
  const run = turn.then(fn);
  turn = run.catch(() => {});
  return run;
}
let writes = 0;
async function writeControl(state) {
  await ensureHome();
  const tmp = `${CONTROL_FILE}.${process.pid}.${++writes}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(normalizeControl(state), null, 2));
  await fs.rename(tmp, CONTROL_FILE);
}
export function saveControl(state) {
  return inTurn(() => writeControl(state));
}

const handler = controlHandler({
  load: loadControl,
  save: writeControl,
  atomic: inTurn,
  listMods,
  putMods: async list => { for (const m of list) await saveMod(m); },
});

// Connector requests. `where` carries the app id the connector knows about.
export function handleControl(msg, where) {
  return handler(msg, where);
}

// Tells every attached window when the pause state changes, whoever changed it
// (this connector, another one, or `morse pause` in a terminal).
// Returns { close() }.
export function watchControl(connector) {
  let last = null;
  loadControl().then(s => { last = JSON.stringify(s.pause); });
  const onChange = async () => {
    const s = await loadControl();
    const now = JSON.stringify(s.pause);
    if (now === last) return;
    last = now;
    const msg = JSON.stringify({ type: "control.changed", pause: s.pause });
    // To Morse's own world in each window, where the runtime is: never the
    // page's main world (which has no runtime, and whose scripts could define
    // __morseHostReceive to listen in).
    for (const w of connector.windows?.values() || []) {
      const world = w.frames?.get(w.frameId)?.world;
      if (world == null) continue;
      w.session?.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive(${msg})`, contextId: world }).catch(() => {});
    }
  };
  watchFile(CONTROL_FILE, { interval: 700 }, onChange).unref?.();
  return { close: () => unwatchFile(CONTROL_FILE, onChange) };
}

// ---- CLI

const { g: G, d: D, b: B, y: Y } = paint;
const out = (...a) => console.log(...a);

function printPause(s) {
  const info = pauseInfo(s);
  if (info.all) out(`${t("ctl.pausedAllNote")} ${D("morse resume")}`);
  else if (!info.sites.length) out(G(t("cli.ctl.onEverywhere")));
  if (info.sites.length) out(`${t(info.all ? "cli.ctl.pausedOn" : "cli.ctl.pausedOnOnly", { list: info.sites.join(", ") })} ${D("(morse resume <site>)")}`);
}

// morse pause            pause everywhere
// morse pause <site|app> pause one website (host) or desktop app
export async function pauseCli(f) {
  const key = f._[0];
  const s = setPause(await loadControl(), key ? { key, on: true } : { all: true });
  await saveControl(s);
  out(key ? t("cli.ctl.pausedSite", { site: B(key) }) : t("cli.ctl.pausedAll"));
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
    if (!s.pause.sites[key]) out(D(t("cli.ctl.wasntPaused", { site: key })));
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
  out(t("cli.ctl.saved", { mods: t("wait.many", { n: mods.length }), file }));
  out(D(t("cli.ctl.restore", { cmd: `morse install ${file}` })));
  return file;
}

// A shared mod's words go to the terminal as text (daemon/colors.js shown):
// escape sequences in them could move the cursor and rewrite the review
// above, or set the clipboard, and a line break could add lines that look
// like the review's own. Its code is shown with those characters written out.
export function describe(mod) { // packs hook: daemon/packs.js lists each mod in a pack the same way
  const s = summarizeMod(mod);
  const where = shown(mod.match?.app || (mod.match?.hosts || []).join(", ") || t("cli.ctl.anySite"));
  const lines = [`${B(shown(mod.title))} ${D(t("install.for", { where }))}`, D(`  “${shown(mod.prompt)}”`)];
  if (s.empty) lines.push(`  - ${t("cli.ctl.noCode")}`);
  for (const i of s.items) lines.push(`  - ${i.text}`);
  for (const n of s.notes) lines.push(Y(`  ${t("sum.noteLine", { text: n.text })}`));
  return lines.join("\n");
}

// morse install <file|link> [--yes] (also `morse import`)
export async function importCli(f) {
  const src = f._[0];
  if (!src) throw new Error(t("cli.ctl.what"));
  const text = src.includes("#m=") ? src : await fs.readFile(src, "utf8");
  const { kind, mods, errors } = await parseImport(text);
  out(`${t(kind === "backup" ? "cli.ctl.backupHas" : "cli.ctl.thisIs", { mods: t("wait.many", { n: mods.length }) })} ${t("cli.pk.whatEach", { n: mods.length })}\n`);
  for (const m of mods) out(describe(m) + "\n");
  for (const e of errors) out(D(t("ctl.skipped", { list: e })));
  out(D(t("cli.pk.readFirst")));
  if (!f.yes) {
    if (!process.stdin.isTTY) throw new Error(t("cli.pk.addYes"));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = (await rl.question(`${t("cli.pk.askInstall", { n: mods.length })} [y/N] `)).trim().toLowerCase();
    rl.close();
    if (a !== "y" && a !== "yes") { out(t("cli.pk.nothing")); return []; }
  }
  const saved = [];
  for (const m of mods) saved.push(await saveMod(prepareInstall(m, { kind: kind === "link" ? "link" : kind === "backup" ? "backup" : "mod", where: {} })));
  out(`${t("cli.pk.installed")}: ${saved.map(m => B(shown(m.title))).join(", ")}`);
  return saved;
}

// morse code <id>: what a mod does, where it came from, and its code.
export async function codeCli(f) {
  const id = f._[0];
  const mod = (await listMods()).find(m => m.id === id || m.id.startsWith(id || "\0"));
  if (!mod) throw new Error(t("cli.ctl.noMod", { id: id || "" }));
  out(describe(mod));
  out(D(`  ${shown(modOrigin(mod))} · ${t(mod.enabled ? "cli.ctl.on" : "cli.ctl.off")} · ${mod.id}`));
  if (mod.css.trim()) out(`\n${B("CSS")}\n${shownCode(mod.css.trim())}`);
  if (mod.js.trim()) out(`\n${B("JavaScript")}\n${shownCode(mod.js.trim())}`);
}
