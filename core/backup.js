// Export and import: every mod in one JSON file, and reading whatever someone
// hands Morse to install (a share link, a .morse.json, or a backup file).

import { decodeShareText, validateMod, hostOf } from "./mod.js";
import { asReviewed } from "./summary.js";
import { parsePack, isPack, MAX_PACK_BYTES } from "./pack.js"; // packs hook

export const BACKUP_KIND = "morse-backup";

export function exportBundle(mods, now = new Date()) {
  const list = (Array.isArray(mods) ? mods : []).filter(m => m && typeof m === "object");
  return {
    morse: BACKUP_KIND,
    version: 1,
    exported: now.toISOString(),
    count: list.length,
    mods: list,
  };
}

export function backupFilename(now = new Date()) {
  return `morse-mods-${now.toISOString().slice(0, 10)}.json`;
}

// -> { kind: "link" | "mod" | "backup", mods: [...], errors: [...] }
// Throws when nothing in it is a mod.
export async function parseImport(source) {
  const src = String(source ?? "").trim();
  if (!src) throw new Error("Paste a Morse share link, or choose a mod file or a backup.");
  if (src.includes("#m=")) {
    let data, text = ""; // packs hook: a link can carry a pack (core/pack.js)
    try { text = await decodeShareText(src); data = JSON.parse(text); } catch (e) { if (/^This /.test(e.message)) throw e; throw new Error("This share link is broken. Check that you copied the whole link."); }
    if (isPack(data)) { const p = parsePack(text); return { kind: "pack", pack: p.pack, mods: p.pack.mods, errors: p.errors }; }
    return { kind: "link", mods: [asReviewed(validateMod(data))], errors: [] };
  }
  let data;
  try { data = JSON.parse(src); }
  catch { throw new Error("This isn't a Morse share link or mod file. Check that you copied all of it."); }
  if (isPack(data)) { // packs hook: a pack file (core/pack.js)
    if (src.length > MAX_PACK_BYTES) throw new Error("This pack is too big. Morse reads packs up to 2 MB.");
    const p = parsePack(data);
    return { kind: "pack", pack: p.pack, mods: p.pack.mods, errors: p.errors };
  }
  const backup = data && (data.morse === BACKUP_KIND || Array.isArray(data.mods) || Array.isArray(data));
  const raw = Array.isArray(data) ? data : backup ? data.mods : [data];
  const mods = [], errors = [];
  raw.forEach((m, i) => {
    try { mods.push(asReviewed(validateMod(m))); }
    catch (e) { errors.push(`Item ${i + 1}: ${e.message}`); }
  });
  if (!mods.length) throw new Error(errors[0]?.replace(/^Item 1: /, "") || "There are no mods in this file. Check that it is a Morse backup.");
  return { kind: backup ? "backup" : "mod", mods, errors };
}

// What gets saved when someone installs: on, marked as imported, with where
// it came from and when. A backup keeps each mod's on/off state and history.
// Never an edit list (asReviewed, core/summary.js): what you install is the
// code the review showed.
export function prepareInstall(mod, { kind = "link", where = {}, now = new Date() } = {}) {
  const m = asReviewed(validateMod({ ...mod }));
  // Your style is never a mod in a file: one marked so would be left out of
  // the Mods panel's list (it lists Your style apart), running where nobody sees it.
  if (m.kind === "style") delete m.kind;
  // Hand-written files may leave out the dates the lists sort and show by.
  for (const k of ["created", "updated"]) if (typeof m[k] !== "string" || isNaN(Date.parse(m[k]))) m[k] = now.toISOString();
  const match = m.match && Array.isArray(m.match.hosts) ? m.match : { hosts: [hostOf(where.url)], app: where.app || null };
  if (kind === "backup") {
    return { ...m, match, enabled: m.enabled !== false, imported: true, importedFrom: m.imported ? m.importedFrom || "link" : "backup", importedAt: m.importedAt || now.toISOString() };
  }
  // A shared mod is the code its review showed: no earlier versions ride along
  // (History could bring back code nobody reviewed). Links never carry one
  // (stripLocal), so this only drops what a hand-made link or file added; the
  // same for what describes this computer (guard: paused, guardOk would skip
  // the check for code that hides the whole page; self-heal: fp) and a fit of
  // Your style (parent), which only the person's own style makes.
  const { history, pack, paused, guardOk, fp, parent, ...shared } = m; // packs hook: a single mod can't claim to be part of one of your packs
  return { ...shared, match, enabled: true, imported: true, importedFrom: kind === "mod" ? "file" : "link", importedAt: now.toISOString() };
}
