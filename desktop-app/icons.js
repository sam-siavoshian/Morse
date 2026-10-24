// Where an app's own icon is. Only reads files, never changes them.
//
// Linux, best first:
//   1. the app menu entry (.desktop file) that runs it names an icon, found in
//      the icon theme folders (hicolor) or pixmaps;
//   2. the app's own folder: resources/app/resources/linux/*.png (VS Code),
//      resources/app/icons/<name>.png, icon.png, .DirIcon (an unpacked AppImage);
//   3. an AppImage: the icon inside it (appimage.js), read without running it.
// macOS: the .icns the bundle's Info.plist names (CFBundleIconFile), its
//   largest PNG up to 512 pixels; main.js falls back to app.getFileIcon.
// Windows: main.js asks Electron's app.getFileIcon for the program's icon.
//
//   iconSource(app)  -> { file } (a PNG path) or { png } (a Buffer), or null
//   linuxIconFor(app, { home, exists, readdir, read })  -> a .png path, or null
//   folderIconFor(app, { exists, readdir, head })       -> a .png path, or null
//   icnsPng(buffer)  -> the best PNG inside an .icns file, or null

import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDesktopEntry, execProgram, parsePlist, parseBinaryPlist } from "../daemon/apps.js";
import { appImageIcon } from "./appimage.js";

const SIZES = ["256x256", "128x128", "512x512", "96x96", "64x64", "48x48"];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const listDir = d => { try { return readdirSync(d); } catch { return []; } };
const readText = f => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
function firstBytes(f, n = 4) {
  let fd;
  try { fd = openSync(f, "r"); const b = Buffer.alloc(n); return b.subarray(0, readSync(fd, b, 0, n, 0)); }
  catch { return Buffer.alloc(0); } finally { if (fd !== undefined) closeSync(fd); }
}

// Names an app's icon file is likely to have: its id, its file's name, its name.
function iconNames(app) {
  return [app.flatpak, app.id, app.processName && app.processName.replace(/\.(appimage|exe)$/i, ""), app.name && app.name.toLowerCase().replace(/\s+/g, "-")]
    .filter(Boolean);
}

export function linuxIconFor(app, { home = os.homedir(), exists = existsSync, readdir = listDir, read = readText } = {}) {
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
  // 2. The usual names.
  for (const n of iconNames(app)) names.add(n);
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

// The app's own folder (an Electron app unpacked in /opt or /usr/share, or an
// extracted AppImage). Only PNG files count: an SVG .DirIcon is skipped.
export function folderIconFor(app, { exists = existsSync, readdir = listDir, head = firstBytes } = {}) {
  const exe = app.resolved || app.exe;
  if (!exe || app.appimage) return null;
  const dir = path.dirname(exe);
  const names = [...new Set(iconNames(app).map(n => n.toLowerCase()))];
  const res = path.join(dir, "resources");
  const linux = path.join(res, "app/resources/linux");
  const tries = [
    ...readdir(linux).filter(f => /\.png$/i.test(f)).map(f => path.join(linux, f)),
    ...names.map(n => path.join(res, "app/icons", `${n}.png`)),
    path.join(res, "app/icon.png"), path.join(res, "icon.png"),
    ...names.map(n => path.join(dir, `${n}.png`)), path.join(dir, "icon.png"), path.join(dir, ".DirIcon"),
    ...SIZES.flatMap(s => readdir(path.join(dir, "usr/share/icons/hicolor", s, "apps")).filter(f => /\.png$/i.test(f)).map(f => path.join(dir, "usr/share/icons/hicolor", s, "apps", f))),
  ];
  return tries.find(p => exists(p) && head(p).equals(PNG)) || null;
}

// An .icns file is "icns", its length, then (type, length, data) entries.
// Modern ones keep PNGs in ic07…ic14; pick the one nearest 256 pixels, at
// least 128 when there is one.
export function icnsPng(buf) {
  if (!buf || buf.length < 8 || buf.toString("latin1", 0, 4) !== "icns") return null;
  const end = Math.min(buf.length, buf.readUInt32BE(4));
  const found = [];
  for (let o = 8; o + 8 <= end;) {
    const len = buf.readUInt32BE(o + 4);
    if (len < 8 || o + len > end) break;
    const data = buf.subarray(o + 8, o + len);
    if (data.length > 24 && data.subarray(0, 4).equals(PNG)) found.push({ data, w: data.readUInt32BE(16) });
    o += len;
  }
  if (!found.length) return null;
  const score = w => (w >= 128 ? 0 : 10000) + Math.abs(w - 256);
  return found.sort((a, b) => score(a.w) - score(b.w))[0].data;
}

export function macIconFor(app, { read = f => { try { return readFileSync(f); } catch { return null; } } } = {}) {
  const bundle = app.path && app.path.endsWith(".app") ? app.path : null;
  if (!bundle) return null;
  const plist = read(path.join(bundle, "Contents", "Info.plist"));
  if (!plist) return null;
  const info = (plist.toString("latin1", 0, 6) === "bplist" ? parseBinaryPlist(plist) : parsePlist(plist.toString("utf8"))) || {};
  const name = typeof info.CFBundleIconFile === "string" ? path.basename(info.CFBundleIconFile) : null;
  if (!name) return null;
  return icnsPng(read(path.join(bundle, "Contents", "Resources", /\.icns$/i.test(name) ? name : `${name}.icns`)));
}

export function iconSource(app, { platform = process.platform } = {}) {
  if (platform === "darwin") { const png = macIconFor(app); return png ? { png } : null; }
  if (platform !== "linux") return null;
  const file = linuxIconFor(app) || folderIconFor(app);
  if (file) return { file };
  if (app.appimage) { const png = appImageIcon(app.resolved || app.exe, app.name); if (png) return { png }; }
  return null;
}
