// Mod packs: several mods shared and installed together, for teams and
// communities. A pack is one JSON document:
//
//   { morse: "morse-pack", version: 1, id, name, note, author?, made, mods: [mod, …] }
//
// It travels like a mod does: as a share link (the same #m= scheme, deflated,
// in the link's fragment), as a file (.morse-pack.json), or from an address
// the person chooses to get updates from (a raw file in a team's repo).
//
// This file is the pure part: making a pack, reading one that may be hostile
// (huge, malformed, duplicate ids, ids that clash with your own mods, mods for
// every website, script in names, too many mods), what installing it would
// do, and what changed between the copy you have and a newer one. The hosts
// (core/pack-host.js) fetch, cache and save; the review is the runtime's
// (runtime/src/69-packs.js), and nothing installs before Install is pressed.

import { validateMod, stripLocal, encodeShareText, decodeShareText, newId } from "./mod.js";
import { prepareInstall } from "./backup.js";
import { modHosts, broadEndings } from "./summary.js";
import { reviseMod } from "./versions.js";

export const PACK_KIND = "morse-pack";
export const PACK_FORMAT = 1;
export const MAX_PACK_MODS = 50;
export const MAX_PACK_BYTES = 2_000_000;   // a pack file or the text in a link, as read
export const MAX_PACK_LINK = 100_000;      // characters; a bigger pack is shared as a file
export const MAX_NAME = 80;
export const MAX_NOTE = 500;
const MAX_TITLE = 120;
const MAX_REQUEST = 4000;
const ID = /^[\w-]{1,40}$/;

// One line of plain text: no control characters, line breaks or direction
// overrides (which can make a name read differently from what it is), spaces
// collapsed. Markup stays as text: every place that shows it escapes it.
export function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max).trim();
}
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30).replace(/-$/, "");

export const isPack = d => !!d && typeof d === "object" && !Array.isArray(d) && d.morse === PACK_KIND;

// A mod as it goes into a pack, or comes out of one: the shared fields only.
// Nothing about this computer (on/off, History, where it came from), and no
// "kind" a normal mod doesn't have: a mod can't arrive as Your style (which
// the Mods panel lists apart) or as part of it.
function packMod(m) {
  const { imported, importedFrom, importedAt, pack, parent, kind, ...rest } = stripLocal(m);
  const out = { ...rest };
  if (kind === "manual" || kind === "quick") out.kind = kind;
  out.title = cleanText(out.title, MAX_TITLE) || "Untitled mod";
  if (typeof out.prompt === "string" && out.prompt.length > MAX_REQUEST) out.prompt = out.prompt.slice(0, MAX_REQUEST);
  if (out.author !== undefined) { const a = cleanText(out.author, 60); if (a) out.author = a; else delete out.author; }
  return out;
}

// ---- making a pack

// mods: the person's own mods (as saved). -> the pack. Throws with a plain
// sentence when it can't be made.
export function makePack(mods, { name, note = "", author = "", id = "", now = new Date() } = {}) {
  const list = (Array.isArray(mods) ? mods : []).filter(m => m && typeof m === "object");
  const n = cleanText(name, MAX_NAME);
  if (!n) throw new Error("Give the pack a name.");
  if (!list.length) throw new Error("Choose at least one mod for the pack.");
  if (list.length > MAX_PACK_MODS) throw new Error(`A pack holds up to ${MAX_PACK_MODS} mods. Choose fewer.`);
  if (list.some(m => m.kind === "style" || m.id === "morse-style")) throw new Error("Your style can't go in a pack. Choose other mods.");
  const seen = new Set();
  const out = [];
  for (const m of list) {
    validateMod(m);
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(packMod(m));
  }
  const a = cleanText(author, 60);
  return {
    morse: PACK_KIND, version: PACK_FORMAT,
    id: typeof id === "string" && ID.test(id) ? id : `${slug(n) || "pack"}-${newId().slice(0, 4)}`,
    name: n,
    note: cleanText(note, MAX_NOTE),
    ...(a ? { author: a } : {}),
    made: now.toISOString(),
    mods: out,
  };
}

export const packFilename = pack => `${slug(pack?.name) || "pack"}.morse-pack.json`;

// The share link: the whole pack in the fragment, like a mod's link.
export async function encodePackLink(pack) {
  const link = await encodeShareText(JSON.stringify(pack));
  if (link.length > MAX_PACK_LINK) throw new Error("This pack is too big for a link. Share it as a file instead.");
  return link;
}
export async function decodePackLink(link) {
  return parsePack(await decodeShareText(link));
}

// ---- reading a pack someone gave you

// input: the JSON text (or the parsed object). -> { pack, errors }, where
// errors are plain lines about mods that were left out. Throws when nothing
// in it can be installed.
export function parsePack(input) {
  let data = input;
  if (typeof data === "string") {
    if (data.length > MAX_PACK_BYTES) throw new Error("This pack is too big. Morse reads packs up to 2 MB.");
    try { data = JSON.parse(data); } catch { throw new Error("This isn't a Morse pack. Check that you copied all of it."); }
  }
  if (!isPack(data)) throw new Error("This isn't a Morse pack. Check that you copied all of it.");
  if (!Array.isArray(data.mods) || !data.mods.length) throw new Error("This pack has no mods in it.");
  if (data.mods.length > MAX_PACK_MODS) throw new Error(`This pack has ${data.mods.length} mods. Morse installs up to ${MAX_PACK_MODS} from one pack.`);
  const name = cleanText(data.name, MAX_NAME) || "Untitled pack";
  const mods = [], errors = [], seen = new Set();
  data.mods.forEach((raw, i) => {
    const label = `Mod ${i + 1}`;
    try {
      const m = validateMod(raw && typeof raw === "object" ? { ...raw } : raw);
      if (m.kind === "style" || m.id === "morse-style" || m.parent) throw new Error("Your style can't come in a pack, so Morse left it out.");
      if (seen.has(m.id)) throw new Error(`It has the same id as another mod in this pack (${m.id}), so Morse left it out.`);
      seen.add(m.id);
      const clean = packMod(m);
      delete clean.history; // a pack brings the code its review shows, never earlier versions
      mods.push(clean);
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  });
  if (!mods.length) throw new Error(errors[0]?.replace(/^Mod 1: /, "") || "This pack has no mods in it.");
  const author = cleanText(data.author, 60);
  const made = typeof data.made === "string" && !isNaN(Date.parse(data.made)) ? data.made : "";
  return {
    pack: {
      morse: PACK_KIND, version: PACK_FORMAT,
      id: typeof data.id === "string" && ID.test(data.id) ? data.id : `${slug(name) || "pack"}`,
      name, note: cleanText(data.note, MAX_NOTE),
      ...(author ? { author } : {}), ...(made ? { made } : {}),
      mods,
    },
    errors,
  };
}

// The same pack read twice gives the same hash: what the review showed is what
// Install installs (pack-host.js checks it), and a changed copy at a team's
// address is an update.
const shape = m => ({ id: m.id, title: m.title, prompt: m.prompt, css: m.css, js: m.js, match: { hosts: [...(m.match?.hosts || [])], app: m.match?.app || null } });
export async function packHash(pack) {
  const text = JSON.stringify({ id: pack.id, name: pack.name, note: pack.note || "", mods: (pack.mods || []).map(shape) });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Runs on every website, or on every one ending in .com (or .co.uk).
export function isWide(mod) {
  if (mod?.match?.app) return false;
  return !!modHosts(mod)?.includes("*") || broadEndings(mod).length > 0;
}

// ---- what installing it would do

// The pack's id for each installed mod that came from it: mod.pack.
export const fromPack = (m, packId) => !!m?.pack && typeof m.pack === "object" && m.pack.id === packId;

// For each mod in the pack, the mod of yours it would touch:
//   { kind: "update", id, title }  your copy from this same pack (replaced, the old one kept in History)
//   { kind: "clash", id, title }   one of your own mods has its id: you choose to keep both or replace yours
export function clashesFor(pack, existing) {
  const mine = (Array.isArray(existing) ? existing : []).filter(m => m && typeof m === "object" && typeof m.id === "string");
  const out = {};
  for (const m of pack.mods) {
    const own = mine.find(x => fromPack(x, pack.id) && x.pack.mod === m.id);
    if (own) { out[m.id] = { kind: "update", id: own.id, title: cleanText(own.title, MAX_TITLE) }; continue; }
    const same = mine.find(x => x.id === m.id);
    if (same) out[m.id] = { kind: "clash", id: same.id, title: cleanText(same.title, MAX_TITLE) };
  }
  return out;
}

// What the install review needs: the pack, its hash, and the clashes.
export async function packPreview({ pack, errors = [] }, existing, extra = {}) {
  const clash = clashesFor(pack, existing);
  return { kind: "pack", pack, mods: pack.mods, errors, hash: await packHash(pack), clash, ...extra };
}

// picks: [{ id, as: "copy" | "replace" }] for the mods the person ticked (as
// only matters for a clash). -> { put: [mods to save] }. A clash with no
// choice, or one the person didn't make, is never decided here: it throws.
export function planInstall(pack, picks, existing, { now = new Date(), url = "" } = {}) {
  const want = new Map();
  for (const p of Array.isArray(picks) ? picks : []) if (p && typeof p.id === "string") want.set(p.id, p.as === "replace" ? "replace" : p.as === "copy" ? "copy" : "");
  const mine = (Array.isArray(existing) ? existing : []).filter(m => m && typeof m.id === "string");
  const taken = new Set(mine.map(m => m.id));
  const clash = clashesFor(pack, mine);
  const put = [];
  for (const m of pack.mods) {
    if (!want.has(m.id)) continue;
    const c = clash[m.id];
    const tag = { id: pack.id, name: pack.name, mod: m.id, at: now.toISOString(), ...(url ? { url } : {}) };
    if (c?.kind === "update") {
      const before = mine.find(x => x.id === c.id);
      put.push(updated(before, m, tag, now));
      continue;
    }
    let id = m.id;
    if (c?.kind === "clash") {
      const as = want.get(m.id);
      if (!as) throw new Error(`You already have a mod with the id ${m.id} (“${c.title}”). Choose whether to keep both or replace yours.`);
      if (as === "copy") id = freeId(m.id, taken);
    }
    taken.add(id);
    const saved = prepareInstall({ ...m, id }, { kind: "link", now });
    put.push({ ...saved, importedFrom: "pack", pack: tag });
  }
  if (!put.length) throw new Error("Nothing to install. Tick at least one mod.");
  return { put };
}

function freeId(id, taken) {
  for (let i = 2; i < 1000; i++) {
    const next = `${id.slice(0, 36)}-${i}`;
    if (!taken.has(next)) return next;
  }
  return newId();
}

// A newer copy of a mod from the pack replaces yours; your version stays in
// History (the code you saw before), the pack's own History never comes in.
function updated(before, m, tag, now) {
  const next = reviseMod(before, { prompt: `Updated from the pack “${tag.name}”`, css: m.css, js: m.js }, now.toISOString());
  return { ...next, title: m.title, prompt: m.prompt, match: { hosts: [...m.match.hosts], app: m.match.app ?? null }, pack: { ...before.pack, ...tag }, imported: true, importedFrom: "pack" };
}

// ---- updates from an address

const sameMatch = (a, b) => JSON.stringify({ h: [...(a?.hosts || [])].sort(), a: a?.app || null }) === JSON.stringify({ h: [...(b?.hosts || [])].sort(), a: b?.app || null });
// Hosts (or an app) the newer copy runs on that yours doesn't.
export function widerHosts(before, after) {
  if ((after?.match?.app || null) !== (before?.match?.app || null)) return after?.match?.app ? [after.match.app] : modHosts(after) || [];
  const had = new Set(modHosts(before) || []);
  return (modHosts(after) || []).filter(h => !had.has(h));
}

// installed: your mods (all of them); next: the newer pack.
// -> { added: [pack mods], removed: [your mods], changed: [{ before, after, match, wider }], same }
export function diffPack(installed, next) {
  const mine = (Array.isArray(installed) ? installed : []).filter(m => fromPack(m, next.id));
  const byPackId = new Map(mine.map(m => [m.pack.mod, m]));
  const added = [], changed = [];
  let same = 0;
  for (const m of next.mods) {
    const before = byPackId.get(m.id);
    if (!before) { added.push(m); continue; }
    const match = !sameMatch(before.match, m.match);
    if (before.css === m.css && before.js === m.js && before.title === m.title && before.prompt === m.prompt && !match) { same++; continue; }
    changed.push({ before: { id: before.id, title: before.title, prompt: before.prompt, css: before.css, js: before.js, match: before.match, enabled: before.enabled !== false }, after: m, match, wider: widerHosts(before, m) });
  }
  const ids = new Set(next.mods.map(m => m.id));
  const removed = mine.filter(m => !ids.has(m.pack.mod)).map(m => ({ id: m.id, title: m.title, prompt: m.prompt, match: m.match }));
  return { added, removed, changed, same };
}

// picks: { add: [pack mod ids], change: [pack mod ids], remove: [your mod ids] }
// -> { put, remove: [ids to delete] }. A removed mod that isn't ticked for
// removal stays, as your own (it no longer follows the pack).
export function planUpdate(installed, next, picks = {}, { now = new Date(), url = "" } = {}) {
  const d = diffPack(installed, next);
  const add = new Set(picks.add || []), change = new Set(picks.change || []), remove = new Set(picks.remove || []);
  const mine = (Array.isArray(installed) ? installed : []).filter(m => m && typeof m.id === "string");
  const put = [], del = [];
  const adding = next.mods.filter(m => add.has(m.id) && d.added.includes(m));
  if (adding.length) {
    const plan = planInstall({ ...next, mods: adding }, adding.map(m => ({ id: m.id, as: "copy" })), mine, { now, url });
    put.push(...plan.put);
  }
  for (const c of d.changed) {
    if (!change.has(c.after.id)) continue;
    const before = mine.find(x => x.id === c.before.id);
    put.push(updated(before, c.after, { id: next.id, name: next.name, mod: c.after.id, at: now.toISOString(), ...(url ? { url } : {}) }, now));
  }
  for (const r of d.removed) {
    if (remove.has(r.id)) del.push(r.id);
    else {
      const m = mine.find(x => x.id === r.id);
      const { pack, ...own } = m;
      put.push(own);
    }
  }
  return { put, remove: del };
}

// ---- the address of a pack that updates

// https only, except this computer while making one (http://127.0.0.1, localhost).
// No user name or password in it. -> the address, or throws.
export function checkPackUrl(url) {
  let u;
  try { u = new URL(String(url || "").trim()); } catch { throw new Error("That isn't a web address. Check it and try again."); }
  const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("A pack that updates has to come from an https:// address. Check the address and try again.");
  if (u.username || u.password) throw new Error("Take the name and password out of the address, then try again.");
  if (u.href.length > 2048) throw new Error("That address is too long.");
  u.hash = "";
  return u.href;
}

// Text that is an address to fetch a pack from, rather than a share link.
export const isPackAddress = s => /^https?:\/\/\S+$/i.test(String(s || "").trim()) && !String(s).includes("#m=");

// Your installed packs, from your mods: [{ id, name, count, on, url }].
export function packGroups(mods) {
  const out = new Map();
  for (const m of Array.isArray(mods) ? mods : []) {
    if (!m?.pack || typeof m.pack.id !== "string") continue;
    const g = out.get(m.pack.id) || { id: m.pack.id, name: cleanText(m.pack.name, MAX_NAME) || m.pack.id, count: 0, on: 0, url: "" };
    g.count++;
    if (m.enabled !== false) g.on++;
    if (m.pack.url) g.url = m.pack.url;
    out.set(m.pack.id, g);
  }
  return [...out.values()];
}
