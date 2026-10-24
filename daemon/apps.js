// Finds desktop apps, matches what the person typed ("vs code", "spotify") to
// one of them, and relaunches it with a local debugging port so Morse can
// attach. Relaunching (not patching the app bundle) keeps code signatures and
// ASAR integrity intact and survives app updates.
//
// Everything that touches the disk goes through a small context object
// (hostContext), so tests can point discovery at fixture trees for macOS,
// Windows and Linux on any machine.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, realpathSync, openSync, readSync, closeSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME } from "./store.js";
import { safeExtraArgs } from "./ports.js";
import { waitForEndpoint } from "./cdp.js";

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
    read: p => { try { return readFileSync(real(p)); } catch { return null; } },
    // Part of a file (app.asar headers), without reading the whole archive.
    readRange: (p, start, length) => {
      const fd = openSync(real(p), "r");
      try { const b = Buffer.alloc(length); return b.subarray(0, readSync(fd, b, 0, length, start)); } finally { closeSync(fd); }
    },
    realpath: p => {
      try {
        const r = realpathSync(real(p));
        if (!root) return r;
        const rootReal = realpathSync(root);
        return r.startsWith(rootReal) ? "/" + path.relative(rootReal, r).split(path.sep).join("/") : p;
      } catch { return p; }
    },
  };
  ctx.var = name => env[name] || {
    LOCALAPPDATA: pp.join(home, "AppData", "Local"),
    APPDATA: pp.join(home, "AppData", "Roaming"),
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
  }[name] || "";
  ctx.expand = p => p.replace(/%([^%]+)%/g, (_, v) => ctx.var(v));
  return ctx;
}

// ---------------------------------------------------------------- Info.plist
// XML plists only, without a dependency; binary ones go through plutil on macOS.
export function parsePlist(text) {
  const out = {};
  const dict = text.match(/<dict>([\s\S]*)<\/dict>/)?.[1] || "";
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

function readPlist(ctx, file) {
  const buf = ctx.read(file);
  if (!buf) return null;
  if (buf.slice(0, 6).toString() === "bplist") {
    if (ctx.platform !== "darwin" || ctx.root) return null;
    try { return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" })); } catch { return null; }
  }
  return parsePlist(buf.toString("utf8"));
}

// Reads a .app bundle: name, bundle id, executable, version and engine.
export function readBundle(ctx, bundle) {
  const pp = ctx.pp;
  const info = readPlist(ctx, pp.join(bundle, "Contents", "Info.plist")) || {};
  const fw = pp.join(bundle, "Contents", "Frameworks");
  const frameworks = ctx.readdir(fw);
  let engine = "native", electron = null;
  if (frameworks.includes("Electron Framework.framework")) {
    engine = "electron";
    const e = readPlist(ctx, pp.join(fw, "Electron Framework.framework", "Resources", "Info.plist"))
      || readPlist(ctx, pp.join(fw, "Electron Framework.framework", "Versions", "A", "Resources", "Info.plist"));
    electron = e?.CFBundleVersion || null;
  } else if (frameworks.includes("Chromium Embedded Framework.framework")) engine = "cef";
  else if (frameworks.some(f => /(Chrome|Chromium|Edge|Brave Browser|Vivaldi|Opera) Framework\.framework$/.test(f))) engine = "chromium";
  const base = pp.basename(bundle, ".app");
  const exeName = info.CFBundleExecutable || base;
  return {
    name: info.CFBundleDisplayName || info.CFBundleName || base,
    bundleId: info.CFBundleIdentifier || null,
    version: info.CFBundleShortVersionString || info.CFBundleVersion || null,
    exe: pp.join(bundle, "Contents", "MacOS", exeName),
    engine, electron,
  };
}

// An Electron app's package.json: { name, version }, where name is its
// productName (what people call it: "Tunes", not the binary's "tunes").
// Unpacked apps keep it in resources/app/; packed ones in app.asar, whose
// header (a JSON file table after two 4-byte sizes) says where it is, so only
// the header and that one file are read, not the whole archive.
export function appPackage(ctx, dir) {
  const pp = ctx.pp;
  let text = ctx.read(pp.join(dir, "resources", "app", "package.json"))?.toString("utf8");
  if (!text) {
    const asar = pp.join(dir, "resources", "app.asar");
    try {
      const sizes = ctx.readRange(asar, 0, 16);
      const headerSize = sizes.readUInt32LE(4); // pickle holding the header
      const jsonSize = sizes.readUInt32LE(12);
      const header = JSON.parse(ctx.readRange(asar, 16, jsonSize).toString("utf8"));
      const f = header.files?.["package.json"];
      if (f && !f.unpacked && Number(f.size) < 1 << 20) text = ctx.readRange(asar, 8 + headerSize + Number(f.offset), Number(f.size)).toString("utf8");
    } catch {}
  }
  // VS Code and its builds (VSCodium, Cursor) name themselves in product.json;
  // their package.json says "codium.desktop" or "code-oss-dev".
  let product = null;
  try { product = JSON.parse(ctx.read(pp.join(dir, "resources", "app", "product.json"))?.toString("utf8")); } catch {}
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

function newestSquirrel(ctx, dir, exeName) {
  const apps = ctx.readdir(dir).filter(n => /^app-\d/.test(n) && ctx.exists(ctx.pp.join(dir, n, exeName)));
  apps.sort((a, b) => cmpVersion(b.slice(4), a.slice(4)));
  return apps[0] ? ctx.pp.join(dir, apps[0], exeName) : null;
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
      out.push(entry(id, cat, { path: exe, exe, launcher: real ? p : null, processName: cat.squirrel || pp.basename(exe), ...eng,
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
  return out;
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
  const head = ctx.read(resolved)?.slice(0, 2).toString();
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

// From what the person typed to an app to launch.
export function resolveApp(query, { ctx = hostContext(), apps } = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Which app? For example: morse launch spotify. Run morse apps to see what's installed.");
  const looksLikePath = /[\\/]/.test(q) || /\.(app|exe)$/i.test(q);
  if (looksLikePath && ctx.exists(q)) return appFromPath(ctx, q);
  const installed = apps || discoverApps(ctx);
  const m = matchApp(q, installed);
  if (m.ambiguous) throw new Error(`"${q}" could be ${m.ambiguous.map(a => a.name).join(" or ")}. Say which one.`);
  if (m.app) return m.app;
  const catalogApps = Object.entries(CATALOG).map(([id, c]) => ({ id, ...c }));
  const c = matchApp(q, catalogApps).app;
  if (c) throw new Error(`${c.name} isn't in the usual places. If it's somewhere else, give its path: morse launch "/path/to/${c.name}"`);
  if (looksLikePath) throw new Error(`Nothing at ${q}.`);
  throw new Error(`Morse couldn't find an app called "${q}". Run morse apps to see what it found, or give the app's path.`);
}

export function appFromPath(ctx, p) {
  const pp = ctx.pp;
  if (/\.app\/?$/.test(p) && ctx.platform === "darwin") {
    const b = readBundle(ctx, p.replace(/\/$/, ""));
    const id = Object.keys(CATALOG).find(k => CATALOG[k].mac?.ids?.includes(b.bundleId)) || slug(b.name);
    return { ...entry(id, CATALOG[id], { ...b, path: p }), ...attachVerdict({ engine: b.engine, electron: b.electron }) };
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

export function executableFor(app) {
  if (typeof app === "string") app = { path: app };
  if (app.exe) return app.exe;
  if (process.platform === "darwin" && app.path.endsWith(".app")) return path.join(app.path, "Contents", "MacOS", path.basename(app.path, ".app"));
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

export function listProcesses(platform = process.platform) {
  try {
    if (platform === "win32") {
      const out = execFileSync("powershell", ["-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"],
        { encoding: "utf8", maxBuffer: 64 << 20, windowsHide: true });
      return parseWinProcesses(out);
    }
    return parsePs(execFileSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 << 20 }));
  } catch { return []; }
}

export function debugPortOf(cmd) {
  const m = String(cmd).match(/--remote-debugging-port[= ](\d+)/);
  return m ? Number(m[1]) : null;
}

const argOf = (cmd, name) => String(cmd).match(new RegExp(`--${name}=("[^"]*"|\\S+)`))?.[1]?.replace(/^"|"$/g, "") || null;

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
  const wantProfile = extraArgs.map(a => argOf(a, "user-data-dir")).find(Boolean)
    || (app.browser ? path.join(HOME, "browser-profile") : null);
  const exe = executableFor(app);
  const lower = s => String(s || "").toLowerCase();
  const base = s => String(s || "").split(/[\\/]/).pop();
  return procs.filter(p => {
    if (selfAndParents.has(p.pid) || /\s--type=/.test(p.cmd)) return false;
    if (/(^|[\\/])(node|morse)(\.exe)?\s/i.test(p.cmd)) return false; // the CLI itself, scripts naming the app
    const profile = argOf(p.cmd, "user-data-dir");
    if (wantProfile ? profile !== wantProfile : profile && app.browser) return false;
    if (platform === "darwin" && app.path?.endsWith(".app")) return p.cmd.startsWith(app.path.replace(/\/$/, "") + "/Contents/MacOS/");
    if (platform === "win32") {
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

async function waitGone(pids, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!pids.some(alive)) return true;
    await sleep(250);
  }
  return !pids.some(alive);
}

// Quit the app the polite way, then wait for it. Returns true once it's gone.
//   macOS: AppleScript "quit" (the app saves state as on ⌘Q), then SIGTERM.
//   Windows: taskkill without /F (WM_CLOSE), then /F: chat apps hide to the tray on close.
//   Linux: SIGTERM.
export async function quitApp(app, { procs = listProcesses(), platform = process.platform, waitMs = 10000, extraArgs = [] } = {}) {
  const pids = findAppProcesses(app, procs, { platform, extraArgs }).map(p => p.pid);
  if (!pids.length) return true;
  const run = (cmd, args) => { try { execFileSync(cmd, args, { stdio: "ignore", windowsHide: true }); } catch {} };
  if (platform === "darwin") {
    const target = app.bundleId ? `application id "${app.bundleId}"` : `application "${app.name.replace(/"/g, "")}"`;
    run("osascript", ["-e", `tell ${target} to quit`]);
  } else if (platform === "win32") {
    for (const pid of pids) run("taskkill", ["/PID", String(pid), "/T"]);
  } else {
    for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
  if (await waitGone(pids, waitMs)) return true;
  if (platform === "darwin") for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
  if (platform === "win32") for (const pid of pids) run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  return waitGone(pids, 4000);
}

// ---------------------------------------------------------------- launching
// Only the debugging port: Morse's CDP client (Node's WebSocket) sends no
// Origin, so it needs no --remote-allow-origins, and some apps quit on any
// switch they don't know (Joplin: "Unknown flag: --remote-allow-origins").
export function launchArgs(app, port, extraArgs = []) {
  const extra = safeExtraArgs(extraArgs);
  const args = [`--remote-debugging-port=${port}`, ...extra];
  if (app.browser && !extra.some(a => a.startsWith("--user-data-dir"))) args.push(`--user-data-dir=${path.join(HOME, "browser-profile")}`, "--no-first-run");
  return args;
}

export function launchApp(app, port, extraArgs = []) {
  const args = launchArgs(app, port, extraArgs);
  const exe = executableFor(app);
  // Discord's updater stub, if that's all we found, takes the app's arguments separately.
  const argv = /Update\.exe$/i.test(exe) ? ["--processStart", app.processName || "Discord.exe", "--process-start-args", args.join(" ")] : args;
  const child = spawn(exe, argv, { detached: true, stdio: "ignore", windowsHide: false, ...(appImageEnv(app) && { env: appImageEnv(app) }) });
  // Remember how it ended, for waitForLaunch: an app that dies on start
  // should say so, not leave Morse waiting for a port that never opens.
  child.on("error", e => { child.failed = e; });
  child.on("exit", (code, signal) => { child.exited = { code, signal }; });
  child.unref();
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
export function launchFailure(app, { code = null, signal = null, error = null } = {}, { platform = process.platform, uid = process.getuid?.() } = {}) {
  const name = app.name || "The app";
  if (error) return `Morse couldn't start ${name}: ${error.code === "ENOENT" ? `there's nothing to run at ${executableFor(app)}` : error.code === "EACCES" ? "it isn't allowed to run (not executable)" : error.message}.`;
  let msg = `${name} quit right after it started (${signal ? `stopped by ${signal}` : `exit code ${code}`}), before Morse could connect.`;
  if (platform === "linux" && uid === 0 && app.engine !== "native")
    msg += ` You're running as root, and Electron and Chromium apps won't start as root with their sandbox on. Run Morse as your own user. If you really must use root: morse launch ${app.id || "<app>"} -- --no-sandbox`;
  return msg;
}

// Waits for a freshly launched app's debugging port. A launcher that hands off
// and exits (Squirrel's Update.exe, a wrapper script) gets `grace` ms for the
// real app to open the port; after that, its exit is the answer.
export async function waitForLaunch(child, app, port, { timeoutMs = 30000, grace = 4000, wait = waitForEndpoint } = {}) {
  const end = Date.now() + timeoutMs;
  let exitedAt = null;
  while (Date.now() < end) {
    try { return await wait(port, 500); } catch {}
    if (child.failed) throw Object.assign(new Error(launchFailure(app, { error: child.failed })), { failed: true });
    if (child.exited) {
      exitedAt ??= Date.now();
      if (Date.now() - exitedAt >= grace) throw Object.assign(new Error(launchFailure(app, child.exited)), { failed: true });
    }
  }
  throw new Error(`${app.name} started but never opened its debugging port. It may still be running in the background (try --restart), or it blocks the setting Morse needs.`);
}

// ---------------------------------------------------------------- per-app choices
// ~/.morse/apps.json: { "<id>": { "restart": true, "port": 9334 } }
const PREFS = () => path.join(HOME, "apps.json");
export async function loadAppPrefs() {
  try { return JSON.parse(await fs.readFile(PREFS(), "utf8")) || {}; } catch { return {}; }
}
export async function saveAppPref(id, patch) {
  const all = await loadAppPrefs();
  all[id] = { ...all[id], ...patch };
  for (const k of Object.keys(all[id])) if (all[id][k] == null) delete all[id][k];
  await fs.mkdir(HOME, { recursive: true });
  await fs.writeFile(PREFS(), JSON.stringify(all, null, 2));
  return all[id];
}

// ---------------------------------------------------------------- `morse apps`
const PLACE = { darwin: "this Mac", win32: "this PC", linux: "this computer" };

export function formatApps(apps, { running = new Map(), sessions = [], platform = process.platform, color = true } = {}) {
  const c = color
    ? { g: s => `\x1b[32m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
    : { g: s => s, d: s => s, b: s => s };
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
  if (!apps.length) return `No Chromium or Electron apps found on ${PLACE[platform] || "this computer"}.\nIf an app is somewhere else, give its path: ${c.b("morse launch /path/to/App")}`;
  const where = a => a.source === "snap" || a.source === "flatpak" ? a.source
    : platform === "darwin" ? a.path.replace(/^\/Users\/[^/]+/, "~")
    : a.path.replace(/^C:\\Users\\[^\\]+/i, "~").replace(/\\AppData\\(Local|Roaming)/i, "\\$1");
  const version = a => (a.version || "").split(".").slice(0, 3).join(".");
  const row = a => {
    const s = sessions.find(x => x.id === a.id);
    const run = running.get(a.id);
    const dot = a.canAttach === false ? c.d("○") : a.canAttach ? c.g("●") : c.d("◌");
    if (a.canAttach === false) return `  ${dot} ${c.d(pad(a.name, 13) + pad(version(a), 12) + `can't connect: ${a.why}`)}`;
    const state = s ? c.g(`connected · port ${s.port}`)
      : run?.port ? c.g(`open with port ${run.port}`)
      : run ? `open without Morse ${c.d(`→ morse launch ${a.id} --restart`)}`
      : c.d(a.note || where(a));
    return `  ${dot} ${c.b(pad(a.name, 13))}${c.d(pad(version(a), 12))}${pad(a.why, 28)}${state}`;
  };
  const order = (x, y) => (x.canAttach === false) - (y.canAttach === false) || x.name.localeCompare(y.name);
  const known = apps.filter(a => a.known).sort(order), other = apps.filter(a => !a.known).sort(order);
  const out = [`Apps Morse found on ${PLACE[platform] || "this computer"}`, ...known.map(row)];
  if (other.length) out.push("", c.d("Other Electron and Chromium apps"), ...other.map(row));
  out.push("", `${c.b("morse launch <name>")} ${c.d("· partial names work: code, vs code, spot, slack")}`);
  return out.join("\n");
}
