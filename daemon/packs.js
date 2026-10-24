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
import { t } from "../core/i18n.js"; // daemon/cli.js sets the language from LANG / LC_ALL

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

const { d: D, b: B, y: Y, g: G } = paint; // plain text when piped, NO_COLOR (colors.js)
const out = (...a) => console.log(...a);
const modsN = n => t("wait.many", { n }); // "3 mods"

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
  throw new Error(t("cli.pk.noSub", { sub }));
}

// morse pack make <ids…> --name <name> [--note <text>] [--out <file>]
async function makeCli(f) {
  const ids = f._.slice(1);
  if (!ids.length) throw new Error(t("cli.pk.whichMods"));
  if (typeof f.name !== "string" || !f.name.trim()) throw new Error(t("cli.pk.needName"));
  const all = await listMods();
  const chosen = ids.map(id => all.find(m => m.id === id) || all.filter(m => m.id.startsWith(id)).at(0));
  const missing = ids.filter((id, i) => !chosen[i]);
  if (missing.length) throw new Error(t("cli.pk.noMod", { ids: missing.join(", ") }));
  const r = await packs.share({ ids: chosen.map(m => m.id), name: f.name, note: typeof f.note === "string" ? f.note : "", kind: "json" });
  let file;
  if (typeof f.out === "string") { file = path.resolve(f.out); await fs.writeFile(file, r.text); }
  else file = await writeExport(r.filename, r.text);
  out(t("cli.pk.made", { name: B(r.pack.name), mods: modsN(r.pack.mods.length) }));
  for (const m of r.pack.mods) out(`  ${m.title} ${D(m.id)}`);
  out(`\n${t("share.savedTo", { path: file })}`);
  try { out(t("cli.pk.link", { link: await encodePackLink(r.pack) })); }
  catch (e) { out(D(e.message)); }
  out(D(t("cli.pk.installWith", { cmd: `morse pack install ${file}` })));
  return { file, pack: r.pack };
}

async function readSource(src) {
  if (isPackAddress(src)) return packs.fetchAddress(src);
  let text = src;
  if (!src.includes("#m=")) {
    const st = await fs.stat(src).catch(() => null);
    if (!st) throw new Error(t("cli.pk.noFile", { src }));
    if (st.size > MAX_PACK_BYTES) throw new Error(t("pk.err.tooBig"));
    text = await fs.readFile(src, "utf8");
  }
  const r = await parseImport(text);
  if (r.kind !== "pack") throw new Error(t("cli.pk.isMod"));
  return packPreview(r, await listMods(), { source: text });
}

// morse pack install <file|link|address> [--yes] [--subscribe] [--replace]
async function installCli(f, ask) {
  const src = f._[1] || [f.subscribe, f.yes, f.replace].find(v => typeof v === "string");
  if (!src) throw new Error(t("cli.pk.what"));
  const p = await readSource(src);
  const { pack } = p;
  out(t("cli.pk.has", { name: B(pack.name), mods: modsN(pack.mods.length), by: pack.author ? D(t("pk.by", { author: pack.author })) : "" }));
  if (pack.note) out(D(`  “${pack.note}”`));
  out(`${t("cli.pk.whatEach", { n: pack.mods.length })}\n`);
  for (const m of pack.mods) {
    out(describe(m));
    if (isWide(m)) out(Y(`  ${t("cli.pk.wide")}`));
    const c = p.clash[m.id];
    if (c?.kind === "update") out(D(`  ${t("pk.replaces")}`));
    if (c?.kind === "clash") out(Y(`  ${t("pk.clash", { title: c.title })}`));
    out("");
  }
  for (const e of p.errors) out(D(t("ctl.skipped", { list: e })));
  out(D(t("cli.pk.readFirst")));
  if (!f.yes) {
    if (!ask) throw new Error(t("cli.pk.addYes"));
    if (!yes(await ask(`${t("cli.pk.askInstall", { n: pack.mods.length })} [y/N] `))) { out(t("cli.pk.nothing")); return null; }
  }
  // Never overwrite one of your mods without asking: --replace, or a yes here.
  const picks = [];
  for (const m of pack.mods) {
    const c = p.clash[m.id];
    let as = "copy";
    if (c?.kind === "clash") {
      if (f.replace) as = "replace";
      else if (!f.yes && ask) as = yes(await ask(`${t("cli.pk.askReplace", { mine: c.title, theirs: m.title })} [y/N] `)) ? "replace" : "copy";
    }
    picks.push({ id: m.id, as });
  }
  let subscribe = false;
  if (p.url) {
    if (f.subscribe) subscribe = true;
    else if (!f.yes && ask) subscribe = yes(await ask(`${t("cli.pk.askSub", { url: p.url })} [y/N] `));
  }
  const r = await packs.install({ source: p.source, hash: p.hash, picks, url: p.url || "", subscribe });
  out(`${G(t("cli.pk.installed"))} ${t("cli.pk.installedFrom", { mods: modsN(r.saved.length), name: B(pack.name) })}: ${r.saved.map(m => m.title).join(", ")}`);
  if (r.subscribed) out(D(t("cli.pk.subbed", { url: p.url, cmd: `morse pack unsubscribe ${pack.id}` })));
  else if (p.url) out(D(t("cli.pk.toSub", { cmd: `morse pack install ${p.url} --subscribe` })));
  return r;
}

// morse pack list [--check]
async function listCli(f) {
  const groups = packGroups(await listMods());
  const status = await packs.status({ force: !!f.check });
  if (!groups.length && !status.length) {
    out(D(t("cli.pk.none")));
    return { groups, status };
  }
  for (const g of groups) {
    const s = status.find(x => x.id === g.id);
    out(`${g.on ? "●" : D("○")} ${B(g.name)} ${D(g.id)}  ${modsN(g.count)}${g.on !== g.count ? `, ${t("cli.pk.nOn", { n: g.on })}` : ""}`);
    if (s) printSub(s);
  }
  for (const s of status.filter(x => !groups.some(g => g.id === x.id))) {
    out(`${D("○")} ${B(s.name)} ${D(s.id)}  ${t("cli.pk.noneInstalled")}`);
    printSub(s);
  }
  return { groups, status };
}
function printSub(s) {
  const when = s.checked ? relativeTime(new Date(s.checked).toISOString()) : t("cli.pk.notYet");
  out(D(`    ${t("cli.pk.updatesFrom", { url: s.url, when })}${s.offline ? ` · ${t("cli.pk.offline")}` : ""}`));
  if (s.update) {
    const u = s.update, fresh = (u.fresh || u.added).length;
    const parts = [u.changed.length && t("pk.changedN", { n: u.changed.length }), fresh && t("pk.newN", { n: fresh }), u.removed.length && t("pk.removedN", { n: u.removed.length })].filter(Boolean);
    out(`    ${Y(t("cli.pk.update"))}: ${t("cli.pk.updateParts", { parts: parts.join(", ") })}`);
  }
}

// morse pack unsubscribe <name|id|address>
async function unsubscribeCli(f) {
  const key = f._[1];
  if (!key) throw new Error(t("cli.pk.whichPack"));
  const status = await packs.status();
  const hit = status.find(s => s.url === key || s.id === key || s.name.toLowerCase() === key.toLowerCase());
  if (!hit) throw new Error(t("cli.pk.notSubbed", { key }));
  await packs.unsubscribe({ url: hit.url });
  out(t("cli.pk.stopped", { name: B(hit.name) }));
  return hit;
}
