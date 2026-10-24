// Export and import: every mod in one JSON file, and reading whatever someone
// hands Morse to install (a share link, a .morse.json, or a backup file).

import { decodeShare, validateMod, hostOf } from "./mod.js";

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
  if (src.includes("#m=")) return { kind: "link", mods: [await decodeShare(src)], errors: [] };
  let data;
  try { data = JSON.parse(src); }
  catch { throw new Error("This isn't a Morse share link or mod file. Check that you copied all of it."); }
  const backup = data && (data.morse === BACKUP_KIND || Array.isArray(data.mods) || Array.isArray(data));
  const raw = Array.isArray(data) ? data : backup ? data.mods : [data];
  const mods = [], errors = [];
  raw.forEach((m, i) => {
    try { mods.push(validateMod(m)); }
    catch (e) { errors.push(`Item ${i + 1}: ${e.message}`); }
  });
  if (!mods.length) throw new Error(errors[0]?.replace(/^Item 1: /, "") || "There are no mods in this file. Check that it is a Morse backup.");
  return { kind: backup ? "backup" : "mod", mods, errors };
}

// What gets saved when someone installs: on, marked as imported, with where
// it came from and when. A backup keeps each mod's on/off state and history.
export function prepareInstall(mod, { kind = "link", where = {}, now = new Date() } = {}) {
  const m = validateMod({ ...mod });
  const match = m.match && Array.isArray(m.match.hosts) ? m.match : { hosts: [hostOf(where.url)], app: where.app || null };
  if (kind === "backup") {
    return { ...m, match, enabled: m.enabled !== false, imported: true, importedFrom: m.imported ? m.importedFrom || "link" : "backup", importedAt: m.importedAt || now.toISOString() };
  }
  return { ...m, match, enabled: true, imported: true, importedFrom: kind === "mod" ? "file" : "link", importedAt: now.toISOString() };
}
