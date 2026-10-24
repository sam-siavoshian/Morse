// Where an app's own icon is, on Linux: the app menu entry (.desktop file)
// that runs it names an icon, found in the icon theme folders or pixmaps.
// macOS and Windows give the icon of the app's file directly (main.js uses
// Electron's app.getFileIcon there). Only reads files, never changes them.
//
//   linuxIconFor(app, { home, exists, readdir, read })  -> a .png path, or null

import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDesktopEntry, execProgram } from "../daemon/apps.js";

const SIZES = ["256x256", "128x128", "512x512", "96x96", "64x64", "48x48"];

export function linuxIconFor(app, { home = os.homedir(), exists = existsSync, readdir = d => { try { return readdirSync(d); } catch { return []; } }, read = f => { try { return readFileSync(f, "utf8"); } catch { return ""; } } } = {}) {
  const dataDirs = [path.join(home, ".local/share"), "/usr/local/share", "/usr/share", "/var/lib/flatpak/exports/share", path.join(home, ".local/share/flatpak/exports/share")];
  const exes = new Set([app.exe, app.resolved, app.path].filter(Boolean));
  const names = new Set();
  // 1. A menu entry that runs this app names its icon.
  for (const d of dataDirs) {
    const dir = path.join(d, "applications");
    for (const f of readdir(dir)) {
      if (!f.endsWith(".desktop")) continue;
      const e = parseDesktopEntry(read(path.join(dir, f)));
      const prog = execProgram(e.Exec);
      if (!e.Icon || !prog) continue;
      if (exes.has(prog) || (app.flatpak && f.startsWith(app.flatpak))) names.add(e.Icon);
    }
  }
  // 2. The usual names: the app's id, its file's name, its name.
  for (const n of [app.flatpak, app.id, app.processName && app.processName.replace(/\.(appimage|exe)$/i, ""), app.name && app.name.toLowerCase().replace(/\s+/g, "-")]) if (n) names.add(n);
  for (const n of names) {
    if (path.isAbsolute(n)) { if (/\.png$/i.test(n) && exists(n)) return n; continue; }
    for (const d of dataDirs) for (const s of SIZES) {
      const p = path.join(d, "icons/hicolor", s, "apps", `${n}.png`);
      if (exists(p)) return p;
    }
    for (const d of dataDirs) { const p = path.join(d, "pixmaps", `${n}.png`); if (exists(p)) return p; }
  }
  return null;
}
