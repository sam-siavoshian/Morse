// Mod packs, desktop side: the connector's pack.* requests (the packs you get
// updates from are kept in ~/.morse/packs.json) and the `morse pack` commands:
//
//   morse pack make <ids…> --name <name> [--note <text>] [--out <file>]
//   morse pack install <file|link|address> [--yes] [--subscribe] [--replace]
//   morse pack list [--check]
//   morse pack unsubscribe <name|id|address>
//
// See core/pack.js (the format, reading hostile packs) and core/pack-host.js
// (fetching, caching, installing what the review showed).

import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { HOME, ensureHome, listMods, saveMod, deleteMod, writeExport } from "./store.js";
import { createPacks, PACK_REQUESTS } from "../core/pack-host.js";
import { packPreview, encodePackLink, isPackAddress, isWide, MAX_PACK_BYTES, packGroups } from "../core/pack.js";
import { parseImport } from "../core/backup.js";
import { relativeTime } from "../core/versions.js";
import { describe } from "./control.js";
import { paint } from "./colors.js";

export { PACK_REQUESTS };

const FILE = path.join(HOME, "packs.json");
let queue = Promise.resolve();
const read = async () => { try { return JSON.parse(await fs.readFile(FILE, "utf8")) || {}; } catch { return {}; } };

export const packs = createPacks({
  store: {
    get: async k => (await read())[k],
    set: (k, v) => {
      const run = queue.then(async () => {
        const all = await read();
        all[k] = v;
        await ensureHome();
        const tmp = `${FILE}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(all, null, 2));
        await fs.rename(tmp, FILE);
      });
      queue = run.catch(() => {});
      return run;
    },
  },
  mods: {
    list: listMods,
    put: async list => { for (const m of list) await saveMod(m); },
    remove: async ids => { for (const id of ids) await deleteMod(id); },
  },
  writeFile: async (filename, text) => ({ path: await writeExport(filename, text) }),
});

export function handlePack(msg) {
  return packs.handle(msg);
}

// ---- CLI

const { d: D, b: B, y: Y, g: G } = paint; // colors.js: none when piped or NO_COLOR is set
const out = (...a) => console.log(...a);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function terminalAsk(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim().toLowerCase(); } finally { rl.close(); }
}
const yes = a => a === "y" || a === "yes";

// ask: (question) -> answer, for tests; otherwise the terminal (only when it is one).
export async function packCli(f, { ask = process.stdin.isTTY ? terminalAsk : null } = {}) {
  const sub = f._[0];
  if (sub === "make") return makeCli(f);
  if (sub === "install") return installCli(f, ask);
  if (sub === "list" || !sub) return listCli(f);
  if (sub === "unsubscribe") return unsubscribeCli(f);
  throw new Error(`There's no morse pack ${sub}. Try morse pack make, install, list or unsubscribe.`);
}

// morse pack make <ids…> --name <name> [--note <text>] [--out <file>]
async function makeCli(f) {
  const ids = f._.slice(1);
  if (!ids.length) throw new Error("Which mods go in the pack? For example: morse pack make a1b2 c3d4 --name \"Team tools\"");
  if (typeof f.name !== "string" || !f.name.trim()) throw new Error("Give the pack a name with --name, for example --name \"Team tools\".");
  const all = await listMods();
  const chosen = ids.map(id => all.find(m => m.id === id) || all.filter(m => m.id.startsWith(id)).at(0));
  const missing = ids.filter((id, i) => !chosen[i]);
  if (missing.length) throw new Error(`There's no mod called ${missing.join(", ")}. Run morse mods to see your mods.`);
  const r = await packs.share({ ids: chosen.map(m => m.id), name: f.name, note: typeof f.note === "string" ? f.note : "", kind: "json" });
  let file;
  if (typeof f.out === "string") { file = path.resolve(f.out); await fs.writeFile(file, r.text); }
  else file = await writeExport(r.filename, r.text);
  out(`Made the pack ${B(r.pack.name)} with ${plural(r.pack.mods.length, "mod")}:`);
  for (const m of r.pack.mods) out(`  ${m.title} ${D(m.id)}`);
  out(`\nSaved to ${file}`);
  try { out(`Share link: ${await encodePackLink(r.pack)}`); }
  catch (e) { out(D(e.message)); }
  out(D(`Install it with: morse pack install ${file}`));
  return { file, pack: r.pack };
}

async function readSource(src) {
  if (isPackAddress(src)) return packs.fetchAddress(src);
  let text = src;
  if (!src.includes("#m=")) {
    const st = await fs.stat(src).catch(() => null);
    if (!st) throw new Error(`Can't find ${src}. Check the file name, or paste the whole share link.`);
    if (st.size > MAX_PACK_BYTES) throw new Error("This pack is too big. Morse reads packs up to 2 MB.");
    text = await fs.readFile(src, "utf8");
  }
  const r = await parseImport(text);
  if (r.kind !== "pack") throw new Error("This is a mod, not a pack. Install it with: morse install");
  return packPreview(r, await listMods(), { source: text });
}

// morse pack install <file|link|address> [--yes] [--subscribe] [--replace]
async function installCli(f, ask) {
  const src = f._[1] || [f.subscribe, f.yes, f.replace].find(v => typeof v === "string");
  if (!src) throw new Error("What should Morse install? For example: morse pack install team-tools.morse-pack.json");
  const p = await readSource(src);
  const { pack } = p;
  out(`The pack ${B(pack.name)} has ${plural(pack.mods.length, "mod")}${pack.author ? ` ${D(`by ${pack.author}`)}` : ""}.`);
  if (pack.note) out(D(`  “${pack.note}”`));
  out(`What ${pack.mods.length === 1 ? "it does" : "each one does"}:\n`);
  for (const m of pack.mods) {
    out(describe(m));
    if (isWide(m)) out(Y("  Note: It runs on every website you visit (or nearly), not just one."));
    const c = p.clash[m.id];
    if (c?.kind === "update") out(D(`  Replaces your copy from this pack. Your version stays in History.`));
    if (c?.kind === "clash") out(Y(`  You already have a mod with this id: “${c.title}”.`));
    out("");
  }
  for (const e of p.errors) out(D(`Skipped ${e}`));
  out(D("To read the code first, open the file, or install and run morse code <id>."));
  if (!f.yes) {
    if (!ask) throw new Error("Add --yes to install without being asked.");
    if (!yes(await ask(`Install ${pack.mods.length === 1 ? "it" : `all ${pack.mods.length}`}? [y/N] `))) { out("Nothing installed."); return null; }
  }
  // Never overwrite one of your mods without asking: --replace, or a yes here.
  const picks = [];
  for (const m of pack.mods) {
    const c = p.clash[m.id];
    let as = "copy";
    if (c?.kind === "clash") {
      if (f.replace) as = "replace";
      else if (!f.yes && ask) as = yes(await ask(`Replace your “${c.title}” with the pack's “${m.title}”? No keeps both. [y/N] `)) ? "replace" : "copy";
    }
    picks.push({ id: m.id, as });
  }
  let subscribe = false;
  if (p.url) {
    if (f.subscribe) subscribe = true;
    else if (!f.yes && ask) subscribe = yes(await ask(`Check ${p.url} for updates, at most once a day? Nothing installs without asking you. [y/N] `));
  }
  const r = await packs.install({ source: p.source, hash: p.hash, picks, url: p.url || "", subscribe });
  out(`${G("Installed")} ${plural(r.saved.length, "mod")} from ${B(pack.name)}: ${r.saved.map(m => m.title).join(", ")}`);
  if (r.subscribed) out(D(`Morse checks ${p.url} for updates at most once a day. To stop: morse pack unsubscribe ${pack.id}`));
  else if (p.url) out(D(`To get updates from this address: morse pack install ${p.url} --subscribe`));
  return r;
}

// morse pack list [--check]
async function listCli(f) {
  const groups = packGroups(await listMods());
  const status = await packs.status({ force: !!f.check });
  if (!groups.length && !status.length) {
    out(D("No packs yet. Make one with morse pack make <ids…> --name <name>, or install one with morse pack install <file|link|address>."));
    return { groups, status };
  }
  for (const g of groups) {
    const s = status.find(x => x.id === g.id);
    out(`${g.on ? "●" : D("○")} ${B(g.name)} ${D(g.id)}  ${plural(g.count, "mod")}${g.on !== g.count ? `, ${g.on} on` : ""}`);
    if (s) printSub(s);
  }
  for (const s of status.filter(x => !groups.some(g => g.id === x.id))) {
    out(`${D("○")} ${B(s.name)} ${D(s.id)}  no mods installed`);
    printSub(s);
  }
  return { groups, status };
}
function printSub(s) {
  const when = s.checked ? relativeTime(new Date(s.checked).toISOString()) : "not yet";
  out(D(`    updates from ${s.url} · checked ${when}${s.offline ? " · couldn't reach it last time" : ""}`));
  if (s.update) {
    const u = s.update, fresh = (u.fresh || u.added).length;
    const parts = [u.changed.length && `${u.changed.length} changed`, fresh && `${fresh} new`, u.removed.length && `${u.removed.length} removed`].filter(Boolean);
    out(`    ${Y("Update available")}: ${parts.join(", ")}. Open the Mods panel where the pack runs to see what changed.`);
  }
}

// morse pack unsubscribe <name|id|address>
async function unsubscribeCli(f) {
  const key = f._[1];
  if (!key) throw new Error("Which pack? For example: morse pack unsubscribe team-tools");
  const status = await packs.status();
  const hit = status.find(s => s.url === key || s.id === key || s.name.toLowerCase() === key.toLowerCase());
  if (!hit) throw new Error(`You don't get updates from a pack called ${key}. See them with: morse pack list`);
  await packs.unsubscribe({ url: hit.url });
  out(`Stopped updates from ${B(hit.name)}. Its mods stay installed.`);
  return hit;
}
