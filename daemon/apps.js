// Finds desktop apps, matches what the person typed ("vs code", "spotify") to
// one of them, and relaunches it with a local debugging port so Morse can
// attach. Relaunching (not patching the app bundle) keeps code signatures and
// ASAR integrity intact and survives app updates.
//
// Everything that touches the disk goes through a small context object
// (hostContext), so tests can point discovery at fixture trees for macOS,
// Windows and Linux on any machine.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, realpathSync, openSync, readSync, closeSync, fstatSync, constants as fsc, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME, parseJson } from "./store.js";
import { safeExtraArgs } from "./ports.js";
import { waitForEndpoint, spawnWithPipe } from "./cdp.js";
import { paint, painter } from "./colors.js";

// ---------------------------------------------------------------- catalog
// engine: "electron" | "cef" (Chromium Embedded Framework) | "chromium" | "native"
// win paths use %VARS%; linux: bin (on PATH), paths, snap, flatpak (app id).
export const CATALOG = {
  spotify: { name: "Spotify", engine: "cef",
    mac: { bundles: ["Spotify.app"], ids: ["com.spotify.client"] },
    win: ["%APPDATA%\\Spotify\\Spotify.exe", "%LOCALAPPDATA%\\Microsoft\\WindowsApps\\Spotify.exe"],
    linux: { bin: ["spotify"], paths: ["/usr/share/spotify/spotify", "/opt/spotify/spotify"], snap: "spotify", flatpak: "com.spotify.Client" } },
  slack: { name: "Slack", engine: "electron",
    mac: { bundles: ["Slack.app"], ids: ["com.tinyspeck.slackmacgap"] },
    win: ["%LOCALAPPDATA%\\slack\\slack.exe", "%ProgramFiles%\\Slack\\slack.exe"], squirrel: "slack.exe",
    linux: { bin: ["slack"], paths: ["/usr/lib/slack/slack", "/usr/share/slack/slack"], snap: "slack", flatpak: "com.slack.Slack" } },
  discord: { name: "Discord", engine: "electron",
    mac: { bundles: ["Discord.app"], ids: ["com.hnc.Discord"] },
    win: ["%LOCALAPPDATA%\\Discord\\Update.exe"], squirrel: "Discord.exe",
    linux: { bin: ["discord", "Discord"], paths: ["/usr/share/discord/Discord", "/opt/discord/Discord", "/usr/lib/discord/Discord"], snap: "discord", flatpak: "com.discordapp.Discord" } },
  vscode: { name: "VS Code", engine: "electron", aliases: ["code", "vs code", "visual studio code", "vsc"],
    mac: { bundles: ["Visual Studio Code.app"], ids: ["com.microsoft.VSCode"] },
    win: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe", "%ProgramFiles%\\Microsoft VS Code\\Code.exe"],
    linux: { bin: ["code"], paths: ["/usr/share/code/code", "/opt/visual-studio-code/code"], snap: "code", flatpak: "com.visualstudio.code" } },
  // VS Code without Microsoft's branding; its .deb puts the app in /usr/share/codium.
  vscodium: { name: "VSCodium", engine: "electron", aliases: ["codium", "vs codium", "code oss"],
    mac: { bundles: ["VSCodium.app"], ids: ["com.vscodium"] },
    win: ["%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe", "%ProgramFiles%\\VSCodium\\VSCodium.exe"],
    linux: { paths: ["/usr/share/codium/codium", "/opt/vscodium-bin/codium"], snap: "codium", flatpak: "com.vscodium.codium" } },
  cursor: { name: "Cursor", engine: "electron",
    mac: { bundles: ["Cursor.app"], ids: ["com.todesktop.230313mzl4w4u92"] },
    win: ["%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe"],
    linux: { bin: ["cursor"], paths: ["/opt/Cursor/cursor", "/usr/share/cursor/cursor"] } },
  notion: { name: "Notion", engine: "electron",
    mac: { bundles: ["Notion.app"], ids: ["notion.id"] },
    win: ["%LOCALAPPDATA%\\Programs\\Notion\\Notion.exe"],
    linux: { bin: ["notion-app"], paths: ["/opt/Notion/notion"] } },
  obsidian: { name: "Obsidian", engine: "electron",
    mac: { bundles: ["Obsidian.app"], ids: ["md.obsidian"] },
    win: ["%LOCALAPPDATA%\\Programs\\Obsidian\\Obsidian.exe", "%LOCALAPPDATA%\\Obsidian\\Obsidian.exe"],
    linux: { bin: ["obsidian"], paths: ["/opt/Obsidian/obsidian"], snap: "obsidian", flatpak: "md.obsidian.Obsidian" } },
  joplin: { name: "Joplin", engine: "electron",
    mac: { bundles: ["Joplin.app"], ids: ["net.cozic.joplin-desktop"] },
    win: ["%LOCALAPPDATA%\\Programs\\Joplin\\Joplin.exe", "%ProgramFiles%\\Joplin\\Joplin.exe"],
    linux: { paths: ["/opt/Joplin/joplin"], flatpak: "net.cozic.joplin_desktop" } },
  figma: { name: "Figma", engine: "electron",
    mac: { bundles: ["Figma.app"], ids: ["com.figma.Desktop"] },
    win: ["%LOCALAPPDATA%\\Figma\\Figma.exe"], squirrel: "Figma.exe",
    linux: { bin: ["figma-linux"], flatpak: "io.github.Figma_Linux.Figma_Linux" } },
  linear: { name: "Linear", engine: "electron",
    mac: { bundles: ["Linear.app"], ids: ["com.linear"] },
    win: ["%LOCALAPPDATA%\\Programs\\Linear\\Linear.exe"], linux: {} },
  signal: { name: "Signal", engine: "electron",
    mac: { bundles: ["Signal.app"], ids: ["org.whispersystems.signal-desktop"] },
    win: ["%LOCALAPPDATA%\\Programs\\signal-desktop\\Signal.exe"],
    linux: { bin: ["signal-desktop"], paths: ["/opt/Signal/signal-desktop"], snap: "signal-desktop", flatpak: "org.signal.Signal" } },
  // ChatGPT for macOS is a native app; Morse can only attach where it runs on Chromium.
  chatgpt: { name: "ChatGPT", engine: "native", aliases: ["chat gpt", "openai"],
    mac: { bundles: ["ChatGPT.app"], ids: ["com.openai.chat"] },
    win: ["%LOCALAPPDATA%\\Programs\\ChatGPT\\ChatGPT.exe"], linux: {} },
  claude: { name: "Claude", engine: "electron", aliases: ["anthropic", "claude desktop"],
    mac: { bundles: ["Claude.app"], ids: ["com.anthropic.claudefordesktop"] },
    win: ["%LOCALAPPDATA%\\AnthropicClaude\\claude.exe"], squirrel: "claude.exe", linux: {} },
  chrome: { name: "Chrome", engine: "chromium", browser: true, aliases: ["google chrome", "chromium"],
    mac: { bundles: ["Google Chrome.app", "Chromium.app"], ids: ["com.google.Chrome"] },
    win: ["%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe", "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe", "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"],
    linux: { bin: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"], snap: "chromium" } },
};
export const KNOWN_APPS = CATALOG; // older name

// ---------------------------------------------------------------- disk access
// The files discovery reads (Info.plist, package.json, .lnk, .desktop) are
// small; anything bigger than this is not one of them, and is never read whole.
export const READ_MAX = 8 * 1024 * 1024;
// Opens a regular file only: a FIFO (or a socket, or /dev/zero) where a
// shortcut or a program should be would block or never end. Non-blocking, so
// opening a FIFO returns at once and fstat says what it is.
function openFile(f) {
  const fd = openSync(f, fsc.O_RDONLY | (fsc.O_NONBLOCK || 0));
  try { if (!fstatSync(fd).isFile()) throw new Error("not a file"); } catch (e) { closeSync(fd); throw e; }
  return fd;
}
function readAt(fd, start, length) {
  const b = Buffer.alloc(length);
  let n = 0;
  while (n < length) { const got = readSync(fd, b, n, length - n, start + n); if (!got) break; n += got; }
  return b.subarray(0, n);
}

export function hostContext(over = {}) {
  const platform = over.platform || process.platform;
  const env = over.env || process.env;
  const home = over.home || os.homedir();
  const root = over.root || "";
  const pp = platform === "win32" ? path.win32 : path.posix;
  const real = p => {
    if (!root) return p;
    if (platform === "win32") return path.join(root, ...p.replace(/^([A-Za-z]):/, "$1").split(/[\\/]+/).filter(Boolean));
    return path.join(root, p);
  };
  const ctx = {
    platform, env, home, root, pp, real,
    exists: p => existsSync(real(p)),
    isDir: p => { try { return statSync(real(p)).isDirectory(); } catch { return false; } },
    readdir: p => { try { return readdirSync(real(p)); } catch { return []; } },
    // A whole small file, or null (missing, not a regular file, or over max).
    read: (p, max = READ_MAX) => {
      try {
        const fd = openFile(real(p));
        try { const size = fstatSync(fd).size; return size > max ? null : readAt(fd, 0, size); } finally { closeSync(fd); }
      } catch { return null; }
    },
    // Part of a file (app.asar headers), without reading the whole archive.
    readRange: (p, start, length) => {
      const fd = openFile(real(p));
      try { return readAt(fd, start, length); } finally { closeSync(fd); }
    },
    realpath: p => {
      try {
        const r = realpathSync(real(p));
        if (!root) return r;
        const rootReal = realpathSync(root);
        if (!r.startsWith(rootReal)) return p;
        const parts = path.relative(rootReal, r).split(path.sep);
        // Back to the path the app would see: "/C/Users/x" is C:\Users\x on Windows.
        return platform === "win32" ? `${parts[0]}:\\${parts.slice(1).join("\\")}` : "/" + parts.join("/");
      } catch { return p; }
    },
  };
  ctx.var = name => env[name] || {
    LOCALAPPDATA: pp.join(home, "AppData", "Local"),
    APPDATA: pp.join(home, "AppData", "Roaming"),
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    ProgramData: "C:\\ProgramData",
    SystemRoot: "C:\\Windows",
    USERPROFILE: home,
  }[name] || "";
  ctx.expand = p => p.replace(/%([^%]+)%/g, (_, v) => ctx.var(v));
  return ctx;
}

// ---------------------------------------------------------------- Info.plist
// XML plists only, without a dependency; binary ones go through plutil on macOS.
export function parsePlist(text) {
  const out = {};
  // The first <dict> to the last </dict>, found without a regex: a file of
  // unclosed <dict> tags made that backtrack for minutes.
  const open = text.indexOf("<dict>"), close = text.lastIndexOf("</dict>");
  const dict = open >= 0 && close > open ? text.slice(open + 6, close) : "";
  const re = /<key>([^<]*)<\/key>\s*(?:<string>([^<]*)<\/string>|<(true|false)\s*\/>|<integer>([^<]*)<\/integer>)/g;
  let m, depth = 0, last = 0;
  while ((m = re.exec(dict))) {
    // only keys of the top-level dict
    const between = dict.slice(last, m.index);
    depth += (between.match(/<dict>/g) || []).length - (between.match(/<\/dict>/g) || []).length;
    last = m.index + m[0].length;
    if (depth > 0) continue;
    out[m[1]] = m[2] != null ? unxml(m[2]) : m[3] ? m[3] === "true" : Number(m[4]);
  }
  return out;
}
const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Binary plists ("bplist00"), which many apps ship as their Info.plist: the
// objects, then a table of their offsets, then a 32-byte trailer saying where
// the table is and which object is the top one. Read here rather than with
// plutil, so listing /Applications starts no process per app and tests can
// use them on any machine. Dicts, arrays, strings, numbers, booleans, dates
// (as ISO strings) and data (as Buffers); anything malformed gives null.
export function parseBinaryPlist(buf) {
  if (!buf || buf.length < 40 || buf.toString("latin1", 0, 8) !== "bplist00") return null;
  try {
    const t = buf.length - 32;
    const offSize = buf[t + 6], refSize = buf[t + 7];
    const count = Number(buf.readBigUInt64BE(t + 8)), top = Number(buf.readBigUInt64BE(t + 16)), table = Number(buf.readBigUInt64BE(t + 24));
    if (!offSize || !refSize || offSize > 8 || refSize > 8 || top >= count || table + count * offSize > t) return null;
    const uint = (at, n) => {
      if (at + n > buf.length) throw new RangeError("past the end");
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + buf[at + i];
      return v;
    };
    // Objects can share references, so a small file can name the same ones
    // over and over (14^30 visits): at most this many in all, then it's broken.
    let visits = 0;
    const obj = (i, depth) => {
      if (i >= count || depth > 32 || ++visits > 50000) throw new RangeError("bad reference");
      const at = uint(table + i * offSize, offSize);
      const m = uint(at, 1), hi = m >> 4, lo = m & 15;
      // Length in the low 4 bits, or (15) in an integer object that follows.
      const sized = () => {
        if (lo !== 15) return [lo, at + 1];
        const n = 1 << (uint(at + 1, 1) & 15);
        return [uint(at + 2, n), at + 2 + n];
      };
      const refs = (start, n) => Array.from({ length: n }, (_, k) => uint(start + k * refSize, refSize));
      switch (hi) {
        case 0x0: return lo === 8 ? false : lo === 9 ? true : null;
        case 0x1: return lo === 3 ? Number(buf.readBigInt64BE(at + 1)) : uint(at + 1, 1 << lo);
        case 0x2: return lo === 2 ? buf.readFloatBE(at + 1) : buf.readDoubleBE(at + 1);
        case 0x3: return new Date((978307200 + buf.readDoubleBE(at + 1)) * 1000).toISOString();
        case 0x4: { const [n, s] = sized(); return Buffer.from(buf.subarray(s, s + n)); }
        case 0x5: { const [n, s] = sized(); return buf.toString("latin1", s, s + n); }
        case 0x6: { const [n, s] = sized(); return Buffer.from(buf.subarray(s, s + 2 * n)).swap16().toString("utf16le"); }
        case 0xA: { const [n, s] = sized(); return refs(s, n).map(r => obj(r, depth + 1)); }
        case 0xD: {
          const [n, s] = sized();
          const keys = refs(s, n), vals = refs(s + n * refSize, n), out = {};
          keys.forEach((k, j) => { out[obj(k, depth + 1)] = obj(vals[j], depth + 1); });
          return out;
        }
        default: return null;
      }
    };
    return obj(top, 0);
  } catch { return null; }
}

function readPlist(ctx, file) {
  const buf = ctx.read(file);
  if (!buf) return null;
  if (buf.subarray(0, 6).toString("latin1") === "bplist") {
    const parsed = parseBinaryPlist(buf);
    if (parsed || ctx.platform !== "darwin" || ctx.root) return parsed;
    // A plist version this reader doesn't know: macOS's own tool can convert it.
    try { return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" })); } catch { return null; }
  }
  return parsePlist(buf.toString("utf8"));
}

// Reads a .app bundle: name, bundle id, executable, version and engine.
//   Contents/Info.plist                          name, bundle id, version, executable
//   Contents/Frameworks/Electron Framework.framework   Electron (its own Info.plist has the version)
//   Contents/Resources/app.asar (or app/)         the app's code, never changed by Morse
//   Contents/MacOS/<CFBundleExecutable>           what `morse launch` runs
export function readBundle(ctx, bundle) {
  const pp = ctx.pp;
  const info = readPlist(ctx, pp.join(bundle, "Contents", "Info.plist")) || {};
  const fw = pp.join(bundle, "Contents", "Frameworks");
  const frameworks = ctx.readdir(fw);
  let engine = "native", electron = null;
  if (frameworks.includes("Electron Framework.framework")) {
    engine = "electron";
    const e = readPlist(ctx, pp.join(fw, "Electron Framework.framework", "Resources", "Info.plist"))
      || readPlist(ctx, pp.join(fw, "Electron Framework.framework", "Versions", "A", "Resources", "Info.plist"))
      || readPlist(ctx, pp.join(fw, "Electron Framework.framework", "Versions", "Current", "Resources", "Info.plist"));
    electron = e?.CFBundleVersion || e?.CFBundleShortVersionString || null;
  } else if (frameworks.includes("Chromium Embedded Framework.framework")) engine = "cef";
  else if (frameworks.some(f => /(Chrome|Chromium|Edge|Brave Browser|Vivaldi|Opera) Framework\.framework$/.test(f))) engine = "chromium";
  const base = pp.basename(bundle, ".app");
  const exeName = info.CFBundleExecutable || base;
  const resources = pp.join(bundle, "Contents", "Resources");
  const asar = engine !== "electron" ? null
    : ctx.exists(pp.join(resources, "app.asar")) ? pp.join(resources, "app.asar")
    : ctx.exists(pp.join(resources, "app", "package.json")) ? pp.join(resources, "app") : null;
  const pkg = asar ? appPackage(ctx, bundle, { resources }) : {};
  return {
    name: info.CFBundleDisplayName || info.CFBundleName || pkg.name || base,
    bundleId: info.CFBundleIdentifier || null,
    version: info.CFBundleShortVersionString || info.CFBundleVersion || pkg.version || null,
    exe: pp.join(bundle, "Contents", "MacOS", exeName),
    engine, electron, asar,
  };
}

// An Electron app's package.json: { name, version }, where name is its
// productName (what people call it: "Tunes", not the binary's "tunes").
// Unpacked apps keep it in resources/app/; packed ones in app.asar, whose
// header (a JSON file table after two 4-byte sizes) says where it is, so only
// the header and that one file are read, not the whole archive.
export const ASAR_HEADER_MAX = 64 * 1024 * 1024;
// `resources` is <dir>/resources on Windows and Linux, and
// <App>.app/Contents/Resources on macOS.
export function appPackage(ctx, dir, { resources = ctx.pp.join(dir, "resources") } = {}) {
  const pp = ctx.pp;
  let text = ctx.read(pp.join(resources, "app", "package.json"))?.toString("utf8");
  if (!text) {
    const asar = pp.join(resources, "app.asar");
    try {
      const sizes = ctx.readRange(asar, 0, 16);
      const headerSize = sizes.readUInt32LE(4); // pickle holding the header
      const jsonSize = sizes.readUInt32LE(12);
      // The sizes come from the file: a broken or hostile one can say 4 GB.
      // Real headers are a few MB even for the biggest apps.
      if (jsonSize > ASAR_HEADER_MAX || jsonSize > headerSize) throw new Error("not an asar header");
      const header = JSON.parse(ctx.readRange(asar, 16, jsonSize).toString("utf8"));
      const f = header.files?.["package.json"];
      if (f && !f.unpacked && Number(f.size) < 1 << 20) text = ctx.readRange(asar, 8 + headerSize + Number(f.offset), Number(f.size)).toString("utf8");
    } catch {}
  }
  // VS Code and its builds (VSCodium, Cursor) name themselves in product.json;
  // their package.json says "codium.desktop" or "code-oss-dev".
  let product = null;
  try { product = JSON.parse(ctx.read(pp.join(resources, "app", "product.json"))?.toString("utf8")); } catch {}
  try {
    const p = JSON.parse(text);
    const name = [p.productName, product?.nameLong, p.desktopName?.replace(/\.desktop$/, ""), p.name].find(s => typeof s === "string" && s.trim() && !/^electron$/i.test(s));
    return { name: name || null, version: typeof p.version === "string" ? p.version : null };
  } catch { return { name: null, version: null }; }
}

// Engine of a Windows/Linux install, from the files next to its executable.
export function engineAt(ctx, exe) {
  const dir = ctx.pp.dirname(exe);
  const has = f => ctx.exists(ctx.pp.join(dir, f));
  // Packed (app.asar) or unpacked (resources/app/, like VS Code) Electron apps.
  if (["app.asar", "electron.asar", ctx.pp.join("app", "package.json")].some(f => has(ctx.pp.join("resources", f)))) {
    const v = ctx.read(ctx.pp.join(dir, "version"))?.toString().trim();
    // The app's own name and version, from its package.json.
    const pkg = appPackage(ctx, dir);
    return { engine: "electron", electron: v && /^\d+\.\d+/.test(v) ? v.replace(/^v/, "") : null,
      ...(pkg.version && { version: pkg.version }), ...(pkg.name && { productName: pkg.name }) };
  }
  if (has("libcef.so") || has("libcef.dll")) return { engine: "cef" };
  if (has("chrome_100_percent.pak") || has("chrome.dll")) return { engine: "chromium" };
  return { engine: null };
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// An Electron app folder: packed (resources/app.asar) or unpacked
// (resources/app/package.json, like VS Code and apps built without asar).
const hasElectronApp = (ctx, dir) => ctx.exists(ctx.pp.join(dir, "resources", "app.asar")) || ctx.exists(ctx.pp.join(dir, "resources", "app", "package.json"));

function entry(id, cat, found) {
  return {
    ...found, id, name: cat?.name || found.productName || found.name, known: !!cat, browser: !!cat?.browser, aliases: cat?.aliases || [],
    engine: found.engine || cat?.engine || "unknown", engineGuessed: !found.engine && !!cat?.engine,
  };
}

// ---------------------------------------------------------------- discovery
function discoverMac(ctx) {
  const pp = ctx.pp, out = [], seen = new Set();
  const dirs = ["/Applications", "/Applications/Utilities", pp.join(ctx.home, "Applications")];
  for (const d of dirs) for (const n of ctx.readdir(d)) {
    if (!n.endsWith(".app")) continue;
    const bundle = pp.join(d, n);
    const b = readBundle(ctx, bundle);
    const id = Object.keys(CATALOG).find(k => CATALOG[k].mac?.bundles?.includes(n) || (b.bundleId && CATALOG[k].mac?.ids?.includes(b.bundleId)));
    if (!id && b.engine === "native") continue; // only Chromium-based apps besides the catalog
    const key = id || slug(b.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry(key, CATALOG[id], { ...b, path: bundle, source: d }));
  }
  return out;
}

// Squirrel installs (Slack, Discord, Figma, GitHub Desktop, Claude) put a
// small Update.exe at the top of their folder and the real app in
// app-<version>\, one folder per version until the old ones are cleaned up.
// The newest folder that has the app's exe in it is the one that runs.
export function newestSquirrel(ctx, dir, exeName) {
  const apps = ctx.readdir(dir).filter(n => /^app-\d/.test(n) && ctx.exists(ctx.pp.join(dir, n, exeName)));
  apps.sort((a, b) => cmpVersion(b.slice(4), a.slice(4)));
  return apps[0] ? ctx.pp.join(dir, apps[0], exeName) : null;
}

// The app a Squirrel folder holds when its exe name isn't known: an exe in
// the newest app-<version>\, preferably the one named like the folder.
export function squirrelApp(ctx, dir) {
  const pp = ctx.pp;
  const versions = ctx.readdir(dir).filter(n => /^app-\d/.test(n) && ctx.isDir(pp.join(dir, n))).sort((a, b) => cmpVersion(b.slice(4), a.slice(4)));
  for (const v of versions) {
    const exes = ctx.readdir(pp.join(dir, v)).filter(f => /\.exe$/i.test(f) && !/^(update|squirrel|elevate|crashpad|notification_helper|uninstall)/i.test(f));
    if (!exes.length) continue;
    const exe = exes.find(f => slug(f.replace(/\.exe$/i, "")) === slug(pp.basename(dir))) || exes[0];
    return pp.join(dir, v, exe);
  }
  return null;
}

// What a Squirrel shortcut starts: Update.exe --processStart "Discord.exe".
export function processStartOf(args) {
  return String(args || "").match(/--processStart(?:=|\s+)(?:"([^"]+)"|(\S+))/i)?.slice(1).find(Boolean) || null;
}
const cmpVersion = (a, b) => {
  const x = a.split(/[.-]/).map(Number), y = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

function discoverWin(ctx) {
  const pp = ctx.pp, out = [], seen = new Set();
  for (const [id, cat] of Object.entries(CATALOG)) {
    for (const tpl of cat.win || []) {
      const p = ctx.expand(tpl);
      if (!p || !ctx.exists(p)) continue;
      // Squirrel installs (Discord, Slack, Figma, Claude) keep the real app in app-<version>\.
      const real = cat.squirrel ? newestSquirrel(ctx, pp.dirname(p), cat.squirrel) : null;
      const exe = real || p;
      const store = /\\WindowsApps\\/i.test(p);
      const eng = engineAt(ctx, exe);
      out.push(entry(id, cat, { path: exe, exe, launcher: real ? p : null, processName: cat.squirrel || pp.basename(exe), version: squirrelVersion(exe), ...eng,
        note: store ? "Microsoft Store version: may ignore the debugging switch" : null, source: pp.dirname(p) }));
      seen.add(id);
      break;
    }
  }
  // Other Electron apps installed per user or machine-wide.
  for (const base of [pp.join(ctx.var("LOCALAPPDATA"), "Programs"), ctx.var("ProgramFiles"), ctx.var("ProgramFiles(x86)")]) {
    if (!base) continue;
    for (const n of ctx.readdir(base)) {
      const dir = pp.join(base, n);
      if (!hasElectronApp(ctx, dir)) continue;
      const exes = ctx.readdir(dir).filter(f => /\.exe$/i.test(f) && !/^(uninstall|unins|elevate|squirrel|update|crashpad)/i.test(f));
      const exeName = exes.find(f => slug(f.replace(/\.exe$/i, "")) === slug(n)) || exes[0];
      if (!exeName) continue;
      const exe = pp.join(dir, exeName);
      const name = exeName.replace(/\.exe$/i, "");
      const known = Object.keys(CATALOG).find(k => (CATALOG[k].win || []).some(t => ctx.expand(t).toLowerCase() === exe.toLowerCase()));
      const key = known || slug(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry(key, CATALOG[known], { name, path: exe, exe, processName: exeName, ...engineAt(ctx, exe), source: base }));
    }
  }
  // The Start menu: apps installed anywhere else (D:\Tools, a deeper Program
  // Files folder) and Squirrel apps the catalog doesn't know, through the
  // shortcuts their installers made.
  const have = new Set(out.flatMap(a => [a.exe, a.launcher].filter(Boolean).map(p => p.toLowerCase())));
  for (const s of startMenuShortcuts(ctx)) {
    const found = shortcutApp(ctx, s.file);
    if (!found || have.has(found.exe.toLowerCase())) continue;
    if (!["electron", "cef", "chromium"].includes(found.engine)) continue; // native apps, uninstallers, help files
    const id = catalogFor(s.name, found.processName.replace(/\.exe$/i, ""));
    const key = id || slug(s.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const p of [found.exe, found.launcher]) if (p) have.add(p.toLowerCase());
    out.push(entry(key, CATALOG[id], { name: s.name, ...found }));
  }
  return out;
}

// .lnk files in the Start menu, for this user and for everyone, two folders deep.
function startMenuShortcuts(ctx) {
  const pp = ctx.pp, out = [];
  const roots = [ctx.var("APPDATA"), ctx.var("ProgramData")].filter(Boolean).map(r => pp.join(r, "Microsoft", "Windows", "Start Menu", "Programs"));
  const walk = (dir, depth) => {
    for (const n of ctx.readdir(dir)) {
      const p = pp.join(dir, n);
      if (/\.lnk$/i.test(n)) { if (!/^(uninstall|help|readme|release notes|website)\b/i.test(n)) out.push({ file: p, name: n.replace(/\.lnk$/i, "") }); }
      else if (depth < 2 && ctx.isDir(p)) walk(p, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return out;
}

// The app a shortcut starts: { path, exe, launcher, processName, engine, ... },
// or null. A Squirrel shortcut points at Update.exe --processStart X.exe;
// the app is X.exe in the newest app-<version>\ next to it.
export function shortcutApp(ctx, file) {
  const pp = ctx.pp;
  const lnk = parseLnk(ctx.read(file));
  if (!lnk) return null;
  let target = ctx.expand(lnk.target || "");
  if (!target && lnk.relativePath) target = pp.resolve(pp.dirname(file), lnk.relativePath);
  if (!target || !/\.exe$/i.test(target)) return null;
  let exe = target, launcher = null, processName = pp.basename(target);
  if (/^update\.exe$/i.test(pp.basename(target))) {
    const started = processStartOf(lnk.arguments);
    if (!started) return null;
    launcher = target;
    processName = started;
    exe = newestSquirrel(ctx, pp.dirname(target), started);
    if (!exe) return null;
  }
  if (!ctx.exists(exe)) return null;
  return { path: exe, exe, launcher, processName, version: squirrelVersion(exe), ...engineAt(ctx, exe), source: pp.dirname(launcher || exe), shortcut: file };
}

// The version in a Squirrel folder name: …\app-4.41.105\slack.exe → 4.41.105.
const squirrelVersion = exe => /[\\/]app-(\d[\w.-]*)[\\/][^\\/]+$/i.exec(exe)?.[1] || null;

// ---------------------------------------------------------------- .lnk shortcuts
// Windows shortcuts, enough to know what they start (MS-SHLLINK): a 76-byte
// header with flags, an optional item list (skipped), LinkInfo with the
// target's local path, then counted strings (name, relative path, working
// folder, arguments, icon), then extra blocks, one of which can hold the
// target with %VARIABLES% left in. Returns null for anything that isn't a
// shortcut. Shortcuts with only an item list (no LinkInfo) give no target.
const LNK_CLSID = "0114020000000000c000000000000046";

// A path from a shortcut's item list: a drive item ("C:\") and then one
// file item per folder. Each file item has a short (8.3) name, and the long
// name in its 0xBEEF0004 extension block, whose place depends on the block's
// version (layout as documented by libfwsi; checked against pylnk3's files).
function idListPath(buf, at, end) {
  const parts = [];
  while (at + 2 <= end) {
    const size = buf.readUInt16LE(at);
    if (size < 2 || at + size > end) break;
    const type = buf[at + 2];
    if ((type & 0x70) === 0x20) parts.splice(0, parts.length, buf.toString("latin1", at + 3, at + 6).replace(/\0.*$/, "").replace(/\\$/, "")); // a drive: "C:"
    else if ((type & 0x70) === 0x30) {
      const uni = !!(type & 0x04);
      let e = at + 14;
      while (e + (uni ? 1 : 0) < at + size && (buf[e] || (uni && buf[e + 1]))) e += uni ? 2 : 1;
      let name = uni ? buf.toString("utf16le", at + 14, e) : buf.toString("latin1", at + 14, e);
      // Looked for inside this item only: searching the rest of the file for
      // each item made a shortcut of many items take seconds.
      const inItem = at + 14 < at + size ? buf.subarray(at + 14, at + size).indexOf(Buffer.from([0x04, 0x00, 0xef, 0xbe])) : -1;
      const ext = inItem < 0 ? -1 : at + 14 + inItem;
      if (ext > 0 && ext - 4 >= at && ext < at + size) {
        const block = ext - 4, version = buf.readUInt16LE(block + 2), blockEnd = block + buf.readUInt16LE(block);
        const off = block + (version >= 9 ? 46 : version >= 8 ? 42 : version >= 7 ? 38 : 20);
        let n = off;
        while (n + 1 < blockEnd && (buf[n] || buf[n + 1])) n += 2;
        const long = buf.toString("utf16le", off, n);
        if (long && /^[^\x00-\x1f]+$/.test(long)) name = long;
      }
      if (parts.length) parts.push(name);
    }
    at += size;
  }
  return parts.length > 1 ? parts.join("\\") : null;
}
export function parseLnk(buf) {
  if (!buf || buf.length < 0x4c || buf.readUInt32LE(0) !== 0x4c || buf.toString("hex", 4, 20) !== LNK_CLSID) return null;
  try {
    const flags = buf.readUInt32LE(0x14);
    const unicode = !!(flags & 0x80);
    const cstr = (at, end = buf.length) => { let e = at; while (e < end && buf[e]) e++; return buf.toString("latin1", at, e); };
    const wstr = (at, end = buf.length) => { let e = at; while (e + 1 < end && (buf[e] || buf[e + 1])) e += 2; return buf.toString("utf16le", at, e); };
    let at = 0x4c;
    let target = null;
    if (flags & 0x01) { // HasLinkTargetIDList: used when there's no LinkInfo
      const size = buf.readUInt16LE(at);
      target = idListPath(buf, at + 2, at + 2 + size);
      at += 2 + size;
    }
    if (flags & 0x02) { // HasLinkInfo
      const size = buf.readUInt32LE(at), header = buf.readUInt32LE(at + 4), info = buf.readUInt32LE(at + 8);
      if (info & 0x01) { // VolumeIDAndLocalBasePath
        const end = at + size;
        const uni = header >= 0x24;
        const base = uni && buf.readUInt32LE(at + 28) ? wstr(at + buf.readUInt32LE(at + 28), end) : cstr(at + buf.readUInt32LE(at + 16), end);
        const suffix = uni && buf.readUInt32LE(at + 32) ? wstr(at + buf.readUInt32LE(at + 32), end) : cstr(at + buf.readUInt32LE(at + 24), end);
        target = (base + (suffix && !base.endsWith("\\") ? "\\" : "") + suffix) || target;
      }
      at += size;
    }
    const out = { target };
    for (const [bit, key] of [[0x04, "name"], [0x08, "relativePath"], [0x10, "workingDir"], [0x20, "arguments"], [0x40, "icon"]]) {
      if (!(flags & bit)) continue;
      const n = buf.readUInt16LE(at);
      at += 2;
      out[key] = unicode ? buf.toString("utf16le", at, at + 2 * n) : buf.toString("latin1", at, at + n);
      at += unicode ? 2 * n : n;
    }
    // EnvironmentVariableDataBlock (HasExpString): the target as typed, like %LOCALAPPDATA%\Discord\Update.exe.
    while (at + 8 <= buf.length) {
      const size = buf.readUInt32LE(at);
      if (size < 8 || at + size > buf.length) break;
      if (buf.readUInt32LE(at + 4) === 0xa0000001 && size >= 0x314 && (flags & 0x200)) {
        const t = wstr(at + 8 + 260, at + 8 + 260 + 520) || cstr(at + 8, at + 8 + 260);
        if (t) out.target = t;
      }
      at += size;
    }
    return out;
  } catch { return null; }
}

function onPath(ctx, bin) {
  for (const d of String(ctx.env.PATH || "/usr/local/bin:/usr/bin:/bin").split(":")) {
    if (!d) continue;
    const p = ctx.pp.join(d, bin);
    if (ctx.exists(p) && !ctx.isDir(p)) return p;
  }
  return null;
}

function linuxFound(ctx, p, source) {
  const resolved = ctx.realpath(p);
  let head = "";
  try { head = ctx.readRange(resolved, 0, 2).toString(); } catch {} // two bytes, not the whole program
  const script = head === "#!";
  return { path: p, exe: p, resolved, source, script, ...(script ? { engine: null } : engineAt(ctx, resolved)) };
}

function discoverLinux(ctx) {
  const pp = ctx.pp, out = [], seen = new Set();
  const flatpakDirs = ["/var/lib/flatpak/exports/bin", pp.join(ctx.home, ".local/share/flatpak/exports/bin")];
  for (const [id, cat] of Object.entries(CATALOG)) {
    const l = cat.linux || {};
    let found = null;
    for (const p of l.paths || []) if (!found && ctx.exists(p)) found = linuxFound(ctx, p, pp.dirname(p));
    for (const b of l.bin || []) if (!found) { const p = onPath(ctx, b); if (p) found = linuxFound(ctx, p, "PATH"); }
    if (!found && l.snap && ctx.exists(`/snap/bin/${l.snap}`)) found = { path: `/snap/bin/${l.snap}`, exe: `/snap/bin/${l.snap}`, source: "snap", engine: null };
    for (const d of flatpakDirs) if (!found && l.flatpak && ctx.exists(pp.join(d, l.flatpak))) found = { path: pp.join(d, l.flatpak), exe: pp.join(d, l.flatpak), source: "flatpak", flatpak: l.flatpak, engine: null };
    if (!found) continue;
    out.push(entry(id, cat, { ...found, processName: pp.basename(found.resolved || found.exe) }));
    seen.add(id);
  }
  // Other Electron apps unpacked in /opt (AppImage-free installs).
  for (const n of ctx.readdir("/opt")) {
    const dir = pp.join("/opt", n);
    if (!hasElectronApp(ctx, dir)) continue;
    // The app's own binary, not the runtime's libraries (libvulkan.so.1) and helpers.
    const files = ctx.readdir(dir).filter(f => !/\.(so(\.\d+)*|pak|bin|dat|json|html|txt)$|^(chrome-sandbox|chrome_crashpad_handler|resources|locales|swiftshader|LICENSE.*|version)$/i.test(f) && !ctx.isDir(pp.join(dir, f)));
    const exeName = files.find(f => slug(f) === slug(n)) || files[0];
    if (!exeName) continue;
    const key = slug(n);
    if (seen.has(key) || Object.values(CATALOG).some(c => (c.linux?.paths || []).includes(pp.join(dir, exeName)))) continue;
    seen.add(key);
    out.push(entry(key, null, { name: n, path: pp.join(dir, exeName), exe: pp.join(dir, exeName), processName: exeName, source: "/opt", ...engineAt(ctx, pp.join(dir, exeName)) }));
  }
  // The app menu and AppImages: apps installed anywhere else. A .deb can put
  // its app in /usr/share/<name>, and AppImages live wherever they were
  // downloaded (~/Applications, ~/Downloads) or where an installer put them.
  const have = new Set(out.flatMap(a => [a.exe, a.resolved].filter(Boolean)));
  for (const c of [...desktopApps(ctx), ...appImages(ctx)]) {
    if (have.has(c.exe) || have.has(c.resolved)) continue;
    const id = catalogFor(c.name, c.stem);
    const key = id || slug(c.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    have.add(c.exe);
    out.push(entry(key, CATALOG[id], c));
  }
  return out;
}

// A catalog app called `name` (a .desktop Name= or an AppImage's file name).
function catalogFor(...names) {
  for (const n of names.filter(Boolean).map(norm))
    for (const [id, c] of Object.entries(CATALOG)) if ([c.name, id, ...(c.aliases || [])].some(k => norm(k) === n)) return id;
  return null;
}

// The [Desktop Entry] group of a .desktop file (localized keys like Name[de] left out).
export function parseDesktopEntry(text) {
  const out = {};
  let inEntry = false;
  for (const line of String(text).split(/\r?\n/)) {
    const g = line.match(/^\[(.+)\]\s*$/);
    if (g) { inEntry = g[1] === "Desktop Entry"; continue; }
    const m = inEntry && line.match(/^([A-Za-z0-9-]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
  }
  return out;
}

// The program an Exec= line runs: its first word (quotes and %U aside), past `env VAR=value`.
export function execProgram(exec) {
  const words = [...String(exec || "").matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map(m => m[1] != null ? m[1].replace(/\\(.)/g, "$1") : m[2]);
  let i = 0;
  if (/(^|\/)env$/.test(words[0] || "")) for (i = 1; /^-|^[A-Za-z_]\w*=/.test(words[i] || ""); i++) if (/^(-u|--unset)$/.test(words[i])) i++;
  return words[i] && !words[i].startsWith("%") ? words[i] : null;
}

// AppImage type 1 or 2: "AI" and the type at byte 8 of the ELF file.
export function isAppImage(ctx, p) {
  if (/\.appimage$/i.test(p)) return true;
  try { const b = ctx.readRange(p, 8, 3); return b[0] === 0x41 && b[1] === 0x49 && (b[2] === 1 || b[2] === 2); } catch { return false; }
}

// "Obsidian-1.14.5.AppImage" -> "Obsidian", "Logseq-linux-x64-0.10.9.AppImage" -> "Logseq".
export function appImageName(file) {
  const stem = String(file).split("/").pop().replace(/\.appimage$/i, "");
  return stem.split(/[-_ ](?=v?\d|linux|x86|x64|amd64|arm|aarch|universal|latest)/i)[0] || stem;
}

// An AppImage is a compressed archive: Morse can't see what it's built on
// without running it, unless the catalog knows the app.
const appImageFound = (p, name, source) => ({ name, stem: appImageName(p), path: p, exe: p, resolved: p, source, appimage: true, processName: p.split("/").pop(), engine: null });

function desktopApps(ctx) {
  const pp = ctx.pp, out = [];
  const dirs = ["/usr/share/applications", "/usr/local/share/applications", pp.join(ctx.home, ".local/share/applications")];
  for (const d of dirs) for (const f of ctx.readdir(d)) {
    if (!f.endsWith(".desktop")) continue;
    const e = parseDesktopEntry(ctx.read(pp.join(d, f))?.toString("utf8") || "");
    if ((e.Type && e.Type !== "Application") || /^true$/i.test(e.NoDisplay || "") || /^true$/i.test(e.Hidden || "")) continue;
    let p = execProgram(e.Exec);
    if (!p) continue;
    if (!p.startsWith("/")) p = onPath(ctx, p);
    if (!p || !ctx.exists(p) || ctx.isDir(p)) continue;
    const name = e.Name || appImageName(p);
    if (isAppImage(ctx, p)) { out.push(appImageFound(p, name, pp.dirname(p))); continue; }
    const f2 = linuxFound(ctx, p, d);
    if (!["electron", "cef", "chromium"].includes(f2.engine)) continue; // native apps and wrapper scripts
    out.push({ ...f2, name: e.Name || f2.productName || pp.basename(p), processName: pp.basename(f2.resolved || p) });
  }
  return out;
}

function appImages(ctx) {
  const pp = ctx.pp, out = [];
  const dirs = ["Applications", "AppImages", "Downloads", ".local/bin", "bin"].map(d => pp.join(ctx.home, d)).concat("/opt");
  for (const d of dirs) for (const f of ctx.readdir(d)) {
    const p = pp.join(d, f);
    if (/\.appimage$/i.test(f) && !ctx.isDir(p)) out.push(appImageFound(p, appImageName(f), d));
  }
  return out;
}

// Installed apps, catalog ones first. Each: { id, name, path, exe, engine, ... }
export function discoverApps(ctx = hostContext()) {
  const list = ctx.platform === "darwin" ? discoverMac(ctx) : ctx.platform === "win32" ? discoverWin(ctx) : discoverLinux(ctx);
  return list.map(a => ({ ...a, ...attachVerdict(a) }))
    .sort((a, b) => (b.known - a.known) || a.name.localeCompare(b.name));
}

// Can Morse attach, in plain words.
export function attachVerdict(app) {
  switch (app.engine) {
    case "electron": return { canAttach: true, why: app.engineGuessed ? "Electron app" : `Electron${app.electron ? " " + app.electron.split(".")[0] : ""}` };
    case "cef": return { canAttach: true, why: "Chromium (CEF)" };
    case "chromium": return { canAttach: true, why: app.browser ? "browser, separate profile" : "Chromium" };
    case "native": return { canAttach: false, why: "native app, not built on web technology" };
    default: return { canAttach: null, why: app.appimage ? "AppImage, couldn't look inside" : "couldn't tell what it's built on" };
  }
}

// ---------------------------------------------------------------- fuzzy names
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

function keysOf(app) {
  const words = [app.name, app.id, ...(app.aliases || [])];
  if (app.path) words.push(app.path.split(/[\\/]/).pop().replace(/\.(app|exe)$/i, ""));
  return words;
}

export function scoreName(query, app) {
  const q = norm(query);
  if (!q) return 0;
  let best = 0;
  for (const w of keysOf(app)) {
    const k = norm(w);
    if (!k) continue;
    let s = 0;
    if (k === q) s = 100;
    else if (q.length >= 2 && k.startsWith(q)) s = 90 - Math.min(9, k.length - q.length);
    else if (q.length >= 2 && String(w).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(x => x[0]).join("") === q) s = 80;
    else if (q.length >= 3 && k.includes(q)) s = 70;
    else {
      const dist = editDistance(q, k);
      const max = q.length <= 4 ? 1 : 2;
      if (q.length >= 3 && dist <= max) s = 60 - dist * 10;
    }
    best = Math.max(best, s);
  }
  return best;
}

// { app } for a clear winner, { ambiguous: [apps] }, or { app: null }.
export function matchApp(query, apps) {
  const scored = apps.map(a => ({ a, s: scoreName(query, a) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s);
  if (!scored.length) return { app: null };
  const top = scored.filter(x => x.s === scored[0].s);
  if (top.length > 1 && scored[0].s < 100) return { ambiguous: top.map(x => x.a) };
  return { app: top[0].a };
}

// An error written for a person: shown as is, whatever its length
// (core/onboarding.js plainError). App names and paths can be long.
export const said = msg => Object.assign(new Error(msg), { plain: true });

// From what the person typed to an app to launch.
export function resolveApp(query, { ctx = hostContext(), apps } = {}) {
  const q = String(query || "").trim();
  if (!q) throw said("Which app? For example: morse launch spotify. Run morse apps to see what's installed.");
  const looksLikePath = /[\\/]/.test(q) || /\.(app|exe)$/i.test(q);
  if (looksLikePath && ctx.exists(q)) return appFromPath(ctx, q);
  const installed = apps || discoverApps(ctx);
  const m = matchApp(q, installed);
  if (m.ambiguous) throw said(`"${q}" could be ${m.ambiguous.map(a => a.name).join(" or ")}. Say which one.`);
  if (m.app) return m.app;
  const catalogApps = Object.entries(CATALOG).map(([id, c]) => ({ id, ...c }));
  const c = matchApp(q, catalogApps).app;
  if (c) throw said(`${c.name} isn't in the usual places. If it's somewhere else, give its path: morse launch "/path/to/${c.name}"`);
  if (looksLikePath) throw said(`Nothing at ${q}.`);
  throw said(`Morse couldn't find an app called "${q}". Run morse apps to see what it found, or give the app's path.`);
}

export function appFromPath(ctx, p) {
  const pp = ctx.pp;
  // A bundle, or a file inside one (…/Slack.app/Contents/MacOS/Slack): the bundle.
  const bundle = ctx.platform === "darwin" && /^(.*?\.app)(\/|$)/.exec(p)?.[1];
  if (bundle) {
    const b = readBundle(ctx, bundle);
    const name = pp.basename(bundle);
    const known = Object.keys(CATALOG).find(k => CATALOG[k].mac?.ids?.includes(b.bundleId) || CATALOG[k].mac?.bundles?.includes(name));
    const id = known || slug(b.name);
    return { ...entry(id, CATALOG[known], { ...b, path: bundle, source: pp.dirname(bundle) }), ...attachVerdict({ engine: b.engine, electron: b.electron }) };
  }
  if (ctx.platform === "win32") {
    // A shortcut: the app it starts, named like the shortcut.
    if (/\.lnk$/i.test(p)) {
      const found = shortcutApp(ctx, p);
      if (!found) throw new Error(`The shortcut ${pp.basename(p)} doesn't point at an app Morse can open. Give the app's .exe instead.`);
      const name = pp.basename(p).replace(/\.lnk$/i, ""), id = catalogFor(name, found.processName.replace(/\.exe$/i, ""));
      const app = entry(id || slug(name), CATALOG[id], { name, ...found });
      return { ...app, ...attachVerdict(app) };
    }
    // Squirrel's Update.exe: the app it starts, in the newest app-<version>\.
    if (/^update\.exe$/i.test(pp.basename(p))) {
      const real = squirrelApp(ctx, pp.dirname(p));
      if (!real) throw new Error(`${p} only updates and starts an app, and Morse found no app next to it. Give the app's .exe instead.`);
      const app = appFromPath(ctx, real);
      return { ...app, launcher: p, source: pp.dirname(p) };
    }
  }
  const file = pp.basename(p).replace(/\.(exe|app)$/i, "");
  // An AppImage: named from its file, and known only if the catalog knows it.
  if (ctx.platform === "linux" && isAppImage(ctx, p)) {
    const name = appImageName(p), id = catalogFor(name);
    const app = entry(id || slug(name), CATALOG[id], appImageFound(p, name, pp.dirname(p)));
    return { ...app, aliases: [...app.aliases, pp.basename(p)], ...attachVerdict(app) };
  }
  const eng = engineAt(ctx, ctx.realpath(p));
  // An Electron app is called what its package.json says ("Tunes"), not
  // what its binary is called ("tunes"); the file name still finds it.
  const name = eng.productName || file;
  const browser = /chrom|brave|edge/i.test(file);
  const app = { id: slug(name), name, path: p, exe: p, processName: pp.basename(p), known: false, browser, aliases: name === file ? [] : [file],
    engine: eng.engine || (browser ? "chromium" : "unknown"), electron: eng.electron || null, ...(eng.version && { version: eng.version }) };
  return { ...app, ...attachVerdict(app) };
}

// What `morse launch` runs. On macOS that's the binary inside the bundle
// (Contents/MacOS/<exe>), not `open -a`: `open` drops --args when the app is
// already running and doesn't say which process it started.
export function executableFor(app, platform = process.platform) {
  if (typeof app === "string") app = { path: app };
  if (app.exe) return app.exe;
  if (platform === "darwin" && app.path.endsWith(".app")) return path.posix.join(app.path, "Contents", "MacOS", path.posix.basename(app.path, ".app"));
  return app.path;
}

// ---------------------------------------------------------------- processes
// `ps -A -ww -o pid=,ppid=,command=` → [{ pid, ppid, cmd }]
export function parsePs(text) {
  return String(text).split("\n").map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
}

// PowerShell Get-CimInstance Win32_Process | ConvertTo-Json → same shape
export function parseWinProcesses(json) {
  let list;
  try { list = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(list)) list = [list];
  return list.filter(Boolean).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, exe: p.ExecutablePath || "", cmd: p.CommandLine || p.ExecutablePath || "" }));
}

// The PowerShell command that lists processes. Its output is set to UTF-8
// first: Windows PowerShell writes in the console's code page otherwise, and
// a folder like C:\Users\José would come back garbled and match nothing.
export const WIN_PROCESS_QUERY = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";

export function listProcesses(platform = process.platform) {
  try {
    if (platform === "win32") {
      const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", WIN_PROCESS_QUERY],
        { encoding: "utf8", maxBuffer: 64 << 20, windowsHide: true });
      return parseWinProcesses(out.replace(/^\uFEFF/, ""));
    }
    return parsePs(execFileSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 << 20 }));
  } catch { return []; }
}

export function debugPortOf(cmd) {
  const m = String(cmd).match(/--remote-debugging-port[= ](\d+)/);
  return m ? Number(m[1]) : null;
}

// --name=value, --name="value", or "--name=value with spaces" (how Windows
// quotes a whole argument that has a space in it).
export const argOf = (cmd, name) => {
  const m = String(cmd).match(new RegExp(`"--${name}=([^"]*)"|--${name}=("[^"]*"|\\S+)`));
  return (m?.[1] ?? m?.[2]?.replace(/^"|"$/g, "")) || null;
};

// Main processes of `app` (not its renderers/helpers, not Morse itself).
//   extraArgs: what we would launch with; a --user-data-dir there means only
//   processes using that same profile count as "this app".
export function findAppProcesses(app, procs, { platform = process.platform, extraArgs = [], self = process.pid } = {}) {
  const selfAndParents = new Set([self]);
  for (let pid = self, i = 0; i < 20; i++) {
    const p = procs.find(x => x.pid === pid);
    if (!p || !p.ppid || selfAndParents.has(p.ppid)) break;
    selfAndParents.add(p.ppid);
    pid = p.ppid;
  }
  const lower = s => String(s || "").toLowerCase();
  // extraArgs are single arguments (spaces and all), not a command line.
  const wantProfile = extraArgs.map(a => /^--user-data-dir=(.+)$/.exec(a)?.[1]?.replace(/^"|"$/g, "")).find(Boolean)
    || (app.browser ? (platform === "win32" ? path.win32 : path.posix).join(HOME, "browser-profile") : null);
  const exe = executableFor(app, platform);
  const base = s => String(s || "").split(/[\\/]/).pop();
  // Windows paths ignore case.
  const sameProfile = (a, b) => platform === "win32" ? lower(a) === lower(b) : a === b;
  return procs.filter(p => {
    if (selfAndParents.has(p.pid) || /\s"?--type=/.test(p.cmd)) return false;
    if (/(^|[\\/])(node|morse)(\.exe)?"?\s/i.test(p.cmd)) return false; // the CLI itself, scripts naming the app
    const profile = argOf(p.cmd, "user-data-dir");
    if (wantProfile ? !sameProfile(profile, wantProfile) : profile && app.browser) return false;
    if (platform === "darwin" && app.path?.endsWith(".app")) return p.cmd.startsWith(app.path.replace(/\/$/, "") + "/Contents/MacOS/");
    if (platform === "win32") {
      // The command line may quote the exe; ExecutablePath doesn't.
      const pe = lower(p.exe || p.cmd.replace(/^"([^"]+)".*/, "$1"));
      return pe === lower(exe) || (app.processName && lower(base(pe)) === lower(app.processName) && (!app.source || pe.startsWith(lower(app.source))));
    }
    const argv0 = p.cmd.split(/\s+/)[0];
    if (argv0 === exe || (app.resolved && argv0 === app.resolved)) return true;
    // flatpak/snap/wrapper scripts: the real binary has the app's own name.
    // Generic names ("code", "electron") only count as exact paths.
    if (!app.processName || base(argv0) !== app.processName) return false;
    return !["code", "electron", "chrome"].includes(app.processName) || !!app.flatpak || app.source === "snap";
  });
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitGone(pids, ms, isAlive = alive) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!pids.some(isAlive)) return true;
    await sleep(250);
  }
  return !pids.some(isAlive);
}

// Runs a program with an argument list (no shell, no window); true when it exited with 0.
const runQuiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: "ignore", windowsHide: true }); return true; } catch { return false; } };
const sendSignal = (pid, sig) => { try { process.kill(pid, sig); } catch {} };

// Quit the app the polite way, then wait for it. Returns true once it's gone.
//   macOS: AppleScript "quit" (the app saves its state as on ⌘Q), then
//     SIGTERM. macOS asks once whether your terminal may control the app; if
//     that's refused (or osascript fails), SIGTERM goes out at once instead.
//   Windows: taskkill /T without /F asks every window of the app's process
//     tree to close, then /T /F ends the tree: chat apps only hide to the
//     tray when their window closes.
//   Linux: SIGTERM.
// run, kill and isAlive are there for tests.
export async function quitApp(app, { procs = listProcesses(), platform = process.platform, waitMs = 10000, extraArgs = [], run = runQuiet, kill = sendSignal, isAlive = alive } = {}) {
  const pids = findAppProcesses(app, procs, { platform, extraArgs }).map(p => p.pid);
  if (!pids.length) return true;
  let termed = false;
  if (platform === "darwin") {
    const target = app.bundleId ? `application id "${app.bundleId.replace(/["\\]/g, "")}"` : `application "${app.name.replace(/["\\]/g, "")}"`;
    if (!run("osascript", ["-e", `tell ${target} to quit`])) { for (const pid of pids) kill(pid, "SIGTERM"); termed = true; }
  } else if (platform === "win32") {
    for (const pid of pids) run("taskkill", ["/PID", String(pid), "/T"]);
  } else {
    for (const pid of pids) kill(pid, "SIGTERM");
    termed = true;
  }
  if (await waitGone(pids, waitMs, isAlive)) return true;
  if (platform === "darwin" && !termed) for (const pid of pids) kill(pid, "SIGTERM");
  if (platform === "win32") for (const pid of pids) run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  return waitGone(pids, 4000, isAlive);
}

// ---------------------------------------------------------------- launching
// `port` is a number (--remote-debugging-port) or PIPE (--remote-debugging-pipe,
// Morse's private channel: see cdp.js). Only that one switch: Morse's CDP
// client (Node's WebSocket) sends no Origin, so it needs no
// --remote-allow-origins, and some apps quit on any switch they don't know
// (Joplin: "Unknown flag: --remote-allow-origins"). Chromium binds a port to
// 127.0.0.1 only, which is also why Windows Firewall doesn't ask about it.
export const PIPE = "pipe";

// Can Morse open this app on the private pipe instead of a port? { ok, why }.
// Tried on real apps (docs/dev/architecture.md#the-private-pipe): Electron 10
// and later answer on it; 9 and older ignore it. What Morse starts has to be
// the app itself, holding the pipe's descriptors: a launcher that hands over
// (Squirrel's Update.exe, flatpak, snap, a wrapper script) would drop them.
// Windows passes descriptors differently and hasn't been tried, so it keeps
// the port; so do browsers and CEF apps. MORSE_PIPE=0 turns the pipe off
// (a debugging port for every app, as before it).
export function pipeFor(app, { platform = process.platform, env = process.env } = {}) {
  if (/^(0|false|off|no)$/i.test(String(env.MORSE_PIPE ?? "").trim())) return { ok: false, why: "MORSE_PIPE=0" };
  if (platform === "win32") return { ok: false, why: "Windows: not tried yet" };
  if (app.engine !== "electron" || app.browser) return { ok: false, why: "not an Electron app" };
  if (app.flatpak || app.source === "snap" || app.script || /(^|[\\/])update\.exe$/i.test(app.exe || "")) return { ok: false, why: "started through a launcher" };
  const major = parseInt(app.electron, 10);
  if (major && major < 10) return { ok: false, why: `Electron ${app.electron} has no pipe` };
  return { ok: true, why: "" };
}

export function launchArgs(app, port, extraArgs = [], { platform = process.platform } = {}) {
  const extra = safeExtraArgs(extraArgs);
  const args = [port === PIPE ? "--remote-debugging-pipe" : `--remote-debugging-port=${port}`, ...extra];
  const pj = platform === "win32" ? path.win32 : path.posix;
  if (app.browser && !extra.some(a => a.startsWith("--user-data-dir"))) args.push(`--user-data-dir=${pj.join(HOME, "browser-profile")}`, "--no-first-run");
  return args;
}

// One Windows command-line argument, quoted the way programs split them
// (CommandLineToArgvW): only when needed, backslashes doubled before a quote.
export function winQuote(arg) {
  const a = String(arg);
  if (a && !/[\s"]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

// Variables the app shouldn't inherit from the terminal Morse runs in. With
// ELECTRON_RUN_AS_NODE set (scripts and some editors' terminals set it), an
// Electron app whose RunAsNode fuse is on starts as plain Node.js and quits
// without a window; NODE_OPTIONS can carry --inspect and the like.
const STRIP_ENV = new Set(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"]);
export function launchEnv(app, { env = process.env, has = existsSync } = {}) {
  const out = { ...(appImageEnv(app, { env, has }) || env) };
  // Windows variable names ignore case: drop every spelling.
  for (const k of Object.keys(out)) if (STRIP_ENV.has(k.toUpperCase())) delete out[k];
  return out;
}

// How to start the app: { file, args, env, handoff }. Always a program and
// an argument list, never a shell string, so paths with spaces need no quoting.
//   handoff: what we start hands over to the real app and exits (Squirrel's
//   Update.exe, flatpak, snap, wrapper scripts), so its pid isn't the app's.
export function launchCommand(app, port, extraArgs = [], { platform = process.platform, env = process.env, has = existsSync } = {}) {
  const args = launchArgs(app, port, extraArgs, { platform });
  const file = executableFor(app, platform);
  let argv = args, handoff = !!(app.flatpak || app.source === "snap" || app.script);
  // Only Squirrel's Update.exe was found (no app-<version>\ folder): it starts
  // the app and passes it one string of arguments, quoted for Windows.
  if (/(^|[\\/])update\.exe$/i.test(file)) {
    if (!app.processName || /^update\.exe$/i.test(app.processName)) throw new Error(`Morse can't tell which app ${file} starts. Give the app's .exe instead.`);
    argv = ["--processStart", app.processName, "--process-start-args", args.map(winQuote).join(" ")];
    handoff = true;
  }
  return { file, args: argv, env: launchEnv(app, { env, has }), handoff };
}

// Starts the app: the child process, unref'd (it outlives Morse). With PIPE
// it resolves the child with child.cdp, the pipe (cdp.js spawnWithPipe).
export function launchApp(app, port, extraArgs = []) {
  const cmd = launchCommand(app, port, extraArgs);
  const options = { detached: true, windowsHide: false, env: cmd.env };
  // Remember how it ended, for waitForLaunch: an app that dies on start
  // should say so, not leave Morse waiting for a port that never opens.
  const watch = child => {
    child.handoff = cmd.handoff;
    child.on("error", e => { child.failed = e; });
    child.on("exit", (code, signal) => { child.exited = { code, signal }; });
    child.unref();
  };
  if (port === PIPE) return spawnWithPipe(cmd.file, cmd.args, options, { onChild: watch });
  const child = spawn(cmd.file, cmd.args, { ...options, stdio: "ignore" });
  watch(child);
  return child;
}

// AppImages mount themselves with FUSE. Without it (no libfuse2, as on a
// fresh Ubuntu 24.04, or no fusermount, as in containers) older ones quit at
// once: "AppImages require FUSE to run". APPIMAGE_EXTRACT_AND_RUN has them
// unpack to /tmp and run from there instead (slower to start, same app).
const FUSERMOUNT = ["/usr/bin/fusermount", "/bin/fusermount", "/usr/bin/fusermount3", "/bin/fusermount3"];
const LIBFUSE2 = ["/usr/lib/x86_64-linux-gnu/libfuse.so.2", "/lib/x86_64-linux-gnu/libfuse.so.2", "/usr/lib/aarch64-linux-gnu/libfuse.so.2", "/usr/lib64/libfuse.so.2", "/usr/lib/libfuse.so.2"];
export function appImageEnv(app, { env = process.env, has = existsSync } = {}) {
  if (!app?.appimage || env.APPIMAGE_EXTRACT_AND_RUN) return null;
  const fuse = has("/dev/fuse") && FUSERMOUNT.some(has) && LIBFUSE2.some(has);
  return fuse ? null : { ...env, APPIMAGE_EXTRACT_AND_RUN: "1" };
}

// Why an app that quit before opening its debugging port did so, in plain
// words. Chromium refuses to start as root on Linux while its sandbox is on,
// and every Electron app inherits that, so root gets its own hint.
export function launchFailure(app, { code = null, signal = null, error = null, noSandbox = false } = {}, { platform = process.platform, uid = process.getuid?.() } = {}) {
  const name = app.name || "The app";
  if (error) return `Morse couldn't start ${name}${error.code === "ENOENT" ? `: there's nothing to run at ${executableFor(app)}` : error.code === "EACCES" || error.code === "EPERM" ? ": it isn't allowed to run (not executable)" : ". Check that it opens on its own"}.`;
  let msg = `${name} quit right after it started (${signal ? `stopped by ${signal}` : `exit code ${code}`}), before Morse could connect.`;
  // dogfood: with -- --no-sandbox already given, root isn't why. VSCodium had
  // quit over a --user-data-dir path too long for its socket; its own words say so.
  if (noSandbox) msg += ` Open it once on its own with the same arguments to see its message.`;
  else if (platform === "linux" && uid === 0 && app.engine !== "native")
    msg += ` You're running as root, and Electron and Chromium apps won't start as root with their sandbox on. Run Morse as your own user. If you really must use root: morse launch ${app.id || "<app>"} -- --no-sandbox`;
  // A downloaded app macOS hasn't checked yet (Gatekeeper) is stopped before
  // it runs when started from a terminal; opening it once from Finder clears that.
  if (platform === "darwin") msg += ` If you haven't opened ${name} on this Mac before, open it once from Finder (so macOS can check it), quit it, and try again.`;
  // Squirrel apps that are already open hand the new start to the open copy and quit.
  if (platform === "win32" && code === 0) msg += ` It may already be running in the tray. Quit it from the tray icon, or run morse launch ${app.id || "<app>"} --restart.`;
  return msg;
}

// dogfood: the app's debugging port went away while Morse was connecting
// (the app quit right after it opened). Plain words, or null for any other error.
export function closedEarly(app, e) {
  if (!/fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(`${e?.message || ""} ${e?.cause?.code || ""}`)) return null;
  return `${app?.name || "The app"} closed right after it started, before Morse could connect. Open it once on its own to see why, then try again.`;
}

// Waits for a freshly launched app's debugging port. A launcher that hands off
// and exits (Squirrel's Update.exe, a wrapper script) gets `grace` ms for the
// real app to open the port; after that, its exit is the answer. A known
// hand-off (child.handoff) that exited cleanly gets 20 s: Squirrel apps can
// check for updates before the real app starts.
export async function waitForLaunch(child, app, port, { timeoutMs = 30000, grace = 4000, handoffGrace = 20000, wait = waitForEndpoint } = {}) {
  const end = Date.now() + timeoutMs;
  let exitedAt = null;
  while (Date.now() < end) {
    try { return await wait(port, 500); } catch {}
    // Written for a person (plain: shown as is, not as "Something went wrong");
    // the system's own words go in details, for the terminal's dim line.
    if (child.failed) throw Object.assign(new Error(launchFailure(app, { error: child.failed })), { failed: true, plain: true, details: child.failed.message });
    if (child.exited) {
      exitedAt ??= Date.now();
      const allow = child.handoff && child.exited.code === 0 ? Math.max(grace, handoffGrace) : grace;
      if (Date.now() - exitedAt >= allow) throw Object.assign(new Error(launchFailure(app, { ...child.exited, noSandbox: !!child.spawnargs?.includes("--no-sandbox") })), { failed: true, plain: true });
    }
  }
  throw said(`${app.name} started but never opened its debugging port. It may still be running in the background (try --restart), or it blocks the setting Morse needs.`);
}

// ---------------------------------------------------------------- per-app choices
// ~/.morse/apps.json: { "<id>": { "restart": true, "port": 9334 } }
const PREFS = () => path.join(HOME, "apps.json");
export async function loadAppPrefs() {
  try { return parseJson(await fs.readFile(PREFS(), "utf8")) || {}; } catch { return {}; }
}
export async function saveAppPref(id, patch) {
  const all = await loadAppPrefs();
  all[id] = { ...all[id], ...patch };
  for (const k of Object.keys(all[id])) if (all[id][k] == null) delete all[id][k];
  await fs.mkdir(HOME, { recursive: true, mode: 0o700 });
  await fs.writeFile(PREFS(), JSON.stringify(all, null, 2));
  return all[id];
}

// ---------------------------------------------------------------- `morse apps`
const PLACE = { darwin: "this Mac", win32: "this PC", linux: "this computer" };

export function formatApps(apps, { running = new Map(), sessions = [], platform = process.platform, color = paint.on } = {}) {
  const c = painter(color);
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
  // Names as wide as the longest one ("GitHub Desktop"), within reason.
  const nameWidth = Math.min(24, Math.max(13, ...apps.map(a => String(a.name).length + 2)));
  if (!apps.length) return `No Chromium or Electron apps found on ${PLACE[platform] || "this computer"}.\nIf an app is somewhere else, give its path: ${c.b("morse launch /path/to/App")}`;
  const where = a => a.source === "snap" || a.source === "flatpak" ? a.source
    : platform === "darwin" ? a.path.replace(/^\/Users\/[^/]+/, "~")
    : a.path.replace(/^C:\\Users\\[^\\]+/i, "~").replace(/\\AppData\\(Local|Roaming)/i, "\\$1");
  const version = a => (a.version || "").split(".").slice(0, 3).join(".");
  const row = a => {
    const s = sessions.find(x => x.id === a.id);
    const run = running.get(a.id);
    const dot = a.canAttach === false ? c.d("○") : a.canAttach ? c.g("●") : c.d("◌");
    if (a.canAttach === false) return `  ${dot} ${c.d(pad(a.name, nameWidth) + pad(version(a), 12) + `can't connect: ${a.why}`)}`;
    const state = s ? c.g(`connected · port ${s.port}`)
      : run?.port ? c.g(`open with port ${run.port}`)
      : run ? `open without Morse ${c.d(`→ morse launch ${a.id} --restart`)}`
      : c.d(a.note || where(a));
    return `  ${dot} ${c.b(pad(a.name, nameWidth))}${c.d(pad(version(a), 12))}${pad(a.why, 28)}${state}`;
  };
  const order = (x, y) => (x.canAttach === false) - (y.canAttach === false) || x.name.localeCompare(y.name);
  const known = apps.filter(a => a.known).sort(order), other = apps.filter(a => !a.known).sort(order);
  const out = [`Apps Morse found on ${PLACE[platform] || "this computer"}`, ...known.map(row)];
  if (other.length) out.push("", c.d("Other Electron and Chromium apps"), ...other.map(row));
  out.push("", `${c.b("morse launch <name>")} ${c.d("· partial names work: code, vs code, spot, slack")}`);
  return out.join("\n");
}
