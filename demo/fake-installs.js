// Fake install trees for macOS, Windows and Linux, written under a scratch
// directory. Discovery (daemon/apps.js) reads them through hostContext({ root }),
// so tests and the `morse apps` screenshot run the real code on any machine.
//
// The file formats are written for real, so the readers are tested on bytes:
// binary plists (binaryPlist), app.asar archives (asarBuffer), Windows .lnk
// shortcuts (lnkBuffer) and Electron fuse wires (fuseWire). binaryPlist and
// lnkBuffer were checked against independent readers (Python's plistlib and
// LnkParse3); tests/platforms.test.js also carries files made by independent
// writers (plistlib, pylnk3).

import { promises as fs } from "node:fs";
import path from "node:path";

// ---- binary plist ("bplist00"): objects, offset table, 32-byte trailer.
export function binaryPlist(root) {
  const objs = [];
  const add = v => {
    const i = objs.length;
    objs.push(null);
    if (Array.isArray(v)) objs[i] = { a: v.map(add) };
    else if (v && typeof v === "object") { const ks = Object.keys(v); objs[i] = { k: ks.map(add), v: ks.map(k => add(v[k])) }; }
    else objs[i] = { s: v };
    return i;
  };
  add(root);
  const refSize = objs.length < 256 ? 1 : 2;
  const ref = n => { const b = Buffer.alloc(refSize); b.writeUIntBE(n, 0, refSize); return b; };
  const head = (type, n) => n < 15 ? Buffer.from([type << 4 | n]) : Buffer.concat([Buffer.from([type << 4 | 15, 0x11]), Buffer.from([n >> 8, n & 255])]);
  const parts = objs.map(o => {
    if (o.a) return Buffer.concat([head(0xa, o.a.length), ...o.a.map(ref)]);
    if (o.k) return Buffer.concat([head(0xd, o.k.length), ...o.k.map(ref), ...o.v.map(ref)]);
    const v = o.s;
    if (typeof v === "boolean") return Buffer.from([v ? 0x09 : 0x08]);
    if (typeof v === "number") { const b = Buffer.alloc(9); b[0] = 0x13; b.writeBigInt64BE(BigInt(v), 1); return b; }
    const s = String(v);
    if (/^[\x00-\x7f]*$/.test(s)) return Buffer.concat([head(0x5, s.length), Buffer.from(s, "latin1")]);
    return Buffer.concat([head(0x6, s.length), Buffer.from(s, "utf16le").swap16()]);
  });
  let pos = 8;
  const offsets = parts.map(p => { const o = pos; pos += p.length; return o; });
  const table = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, i) => table.writeUInt32BE(o, i * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4; trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objs.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(pos), 24);
  return Buffer.concat([Buffer.from("bplist00"), ...parts, table, trailer]);
}

// ---- app.asar: [4][header size] pickle, then the JSON file table, then the files.
export function asarBuffer(files) {
  const table = {}, blobs = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    table[name] = { size: data.length, offset: String(offset) };
    blobs.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify({ files: table }));
  const padded = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + padded);
  header.writeUInt32LE(4 + padded, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(header.length, 4);
  return Buffer.concat([sizes, header, ...blobs]);
}

// ---- Electron's fuse wire, inside some binary-looking bytes.
//   fuses: "1" on, "0" off, "r" removed, one character per fuse.
export function fuseWire(fuses = "101011r01", { magic = "MZ" } = {}) {
  const head = typeof magic === "number" ? (() => { const b = Buffer.alloc(4); b.writeUInt32BE(magic); return b; })() : Buffer.from(magic, "latin1");
  return Buffer.concat([head, Buffer.alloc(60), Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"), Buffer.from([1, fuses.length]), Buffer.from(fuses), Buffer.alloc(32)]);
}

// ---- Windows .lnk (MS-SHLLINK): header, LinkInfo with the local path (ANSI
// and Unicode), counted Unicode strings, and optionally the
// EnvironmentVariableDataBlock with a %VARIABLE% target.
export function lnkBuffer({ target, args = "", workingDir = "", envTarget = "" }) {
  let flags = 0x02 | 0x80; // HasLinkInfo, IsUnicode
  if (workingDir) flags |= 0x10;
  if (args) flags |= 0x20;
  if (envTarget) flags |= 0x200;
  const header = Buffer.alloc(0x4c);
  header.writeUInt32LE(0x4c, 0);
  Buffer.from("0114020000000000c000000000000046", "hex").copy(header, 4);
  header.writeUInt32LE(flags, 0x14);
  header.writeUInt32LE(0x20, 0x18); // FILE_ATTRIBUTE_ARCHIVE
  header.writeUInt32LE(1, 0x3c);    // SW_SHOWNORMAL
  // LinkInfo with the Unicode offsets (header size 0x24).
  const volume = Buffer.alloc(0x11);
  volume.writeUInt32LE(0x11, 0); volume.writeUInt32LE(3, 4); volume.writeUInt32LE(0x1234abcd, 8); volume.writeUInt32LE(0x10, 12);
  const ansi = Buffer.concat([Buffer.from(target, "latin1"), Buffer.alloc(1)]);
  const suffix = Buffer.alloc(1);
  const wide = Buffer.concat([Buffer.from(target, "utf16le"), Buffer.alloc(2)]);
  const wsuffix = Buffer.alloc(2);
  const hsize = 0x24;
  const volOff = hsize, baseOff = volOff + volume.length, sufOff = baseOff + ansi.length;
  const wbaseOff = sufOff + suffix.length, wsufOff = wbaseOff + wide.length;
  const infoHead = Buffer.alloc(hsize);
  const size = wsufOff + wsuffix.length;
  [size, hsize, 1, volOff, baseOff, 0, sufOff, wbaseOff, wsufOff].forEach((v, i) => infoHead.writeUInt32LE(v, i * 4));
  const info = Buffer.concat([infoHead, volume, ansi, suffix, wide, wsuffix]);
  const str = s => { const b = Buffer.alloc(2); b.writeUInt16LE(s.length); return Buffer.concat([b, Buffer.from(s, "utf16le")]); };
  const strings = [workingDir && str(workingDir), args && str(args)].filter(Boolean);
  const extra = [];
  if (envTarget) {
    const block = Buffer.alloc(0x314);
    block.writeUInt32LE(0x314, 0); block.writeUInt32LE(0xa0000001, 4);
    Buffer.from(envTarget, "latin1").copy(block, 8, 0, 259);
    Buffer.from(envTarget, "utf16le").copy(block, 8 + 260, 0, 518);
    extra.push(block);
  }
  return Buffer.concat([header, info, ...strings, ...extra, Buffer.alloc(4)]);
}

const plist = o => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(o).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`).join("\n")}
\t<key>CFBundleURLTypes</key>
\t<array><dict><key>CFBundleURLName</key><string>nested-should-be-ignored</string></dict></array>
</dict>
</plist>`;

// name, bundle id, executable, version, engine, electron version, folder
const MAC = [
  ["Slack", "com.tinyspeck.slackmacgap", "Slack", "4.41.105", "electron", "32.2.6"],
  ["Visual Studio Code", "com.microsoft.VSCode", "Electron", "1.95.3", "electron", "32.2.1", null, "Code"],
  ["Spotify", "com.spotify.client", "Spotify", "1.2.52.442", "cef"],
  ["Discord", "com.hnc.Discord", "Discord", "0.0.326", "electron", "33.1.0"],
  ["Notion", "notion.id", "Notion", "4.3.0", "electron", "32.1.0"],
  ["ChatGPT", "com.openai.chat", "ChatGPT", "1.2025.014", "native"],
  ["Claude", "com.anthropic.claudefordesktop", "Claude", "0.9.3", "electron", "33.3.1"],
  ["Safari", "com.apple.Safari", "Safari", "18.2", "native"],
  ["Google Chrome", "com.google.Chrome", "Google Chrome", "131.0.6778.86", "chrome"],
  ["Beeper", "com.automattic.beeper.desktop", "Beeper", "4.0.5", "electron", "31.4.0"],
  ["Obsidian", "md.obsidian", "Obsidian", "1.7.7", "electron", "32.2.5", "home"],
];

async function put(root, p, content = "") {
  const f = path.join(root, p);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, content);
}
async function link(root, from, to) {
  const f = path.join(root, from);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.symlink(to, f);
}

export async function buildMac(root, home = "/Users/sam") {
  for (const [name, id, exe, version, engine, electron, where, display] of MAC) {
    const b = `${where === "home" ? home : ""}/Applications/${name}.app/Contents`;
    await put(root, `${b}/Info.plist`, plist({ CFBundleName: display || name, CFBundleIdentifier: id, CFBundleExecutable: exe, CFBundleShortVersionString: version }));
    await put(root, `${b}/MacOS/${exe}`, "\xCF\xFA\xED\xFE");
    const fw = `${b}/Frameworks`;
    if (engine === "electron") await put(root, `${fw}/Electron Framework.framework/Resources/Info.plist`, plist({ CFBundleVersion: electron }));
    if (engine === "cef") await put(root, `${fw}/Chromium Embedded Framework.framework/Chromium Embedded Framework`, "");
    if (engine === "chrome") await put(root, `${fw}/Google Chrome Framework.framework/Versions/Current`, "");
    if (engine === "native") await put(root, `${fw}/Sparkle.framework/Sparkle`, "");
  }
  // Slack as shipped: its code in Contents/Resources/app.asar, and a universal
  // Electron Framework binary (Intel + Apple silicon), one fuse wire in each part.
  const slack = "/Applications/Slack.app/Contents";
  await put(root, `${slack}/Resources/app.asar`, asarBuffer({ "package.json": JSON.stringify({ name: "slack-desktop", productName: "Slack", version: "4.41.105" }) }));
  await put(root, `${slack}/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`,
    Buffer.concat([fuseWire("101010r01", { magic: 0xcafebabe }), fuseWire("101010r01", { magic: 0xcffaedfe })]));
  // Figma: binary plists (as many apps ship them), the framework's under Versions/A.
  const figma = "/Applications/Figma.app/Contents";
  await put(root, `${figma}/Info.plist`, binaryPlist({ CFBundleName: "Figma", CFBundleIdentifier: "com.figma.Desktop", CFBundleExecutable: "Figma", CFBundleShortVersionString: "125.0.3", LSMinimumSystemVersion: "11.0", NSHighResolutionCapable: true }));
  await put(root, `${figma}/MacOS/Figma`, "\xCF\xFA\xED\xFE");
  await put(root, `${figma}/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist`, binaryPlist({ CFBundleVersion: "34.2.0" }));
  await put(root, `${figma}/Resources/app.asar`, asarBuffer({ "package.json": JSON.stringify({ name: "figma", productName: "Figma", version: "125.0.3" }) }));
  await fs.mkdir(path.join(root, "Applications/Utilities"), { recursive: true });
  return { platform: "darwin", home, root, env: { PATH: "/usr/bin:/bin" } };
}

export async function buildWindows(root, home = "C:\\Users\\sam") {
  const L = "/C/Users/sam/AppData/Local", R = "/C/Users/sam/AppData/Roaming";
  // Squirrel installs: a stub at the top, the real app in app-<version>\
  await put(root, `${L}/Discord/Update.exe`, "MZ");
  for (const v of ["1.0.9163", "1.0.9170"]) { await put(root, `${L}/Discord/app-${v}/Discord.exe`, "MZ"); await put(root, `${L}/Discord/app-${v}/resources/app.asar`, ""); }
  await put(root, `${L}/slack/slack.exe`, "MZ");
  await put(root, `${L}/slack/app-4.41.105/slack.exe`, "MZ");
  await put(root, `${L}/slack/app-4.41.105/resources/app.asar`, "");
  // NSIS / per-user installs
  await put(root, `${L}/Programs/Microsoft VS Code/Code.exe`, "MZ");
  await put(root, `${L}/Programs/Microsoft VS Code/resources/app/package.json`, "{}");
  await put(root, `${L}/Programs/Obsidian/Obsidian.exe`, "MZ");
  await put(root, `${L}/Programs/Obsidian/resources/app.asar`, "");
  await put(root, `${L}/Programs/Obsidian/Uninstall Obsidian.exe`, "MZ");
  await put(root, `${L}/Programs/Beeper/Beeper.exe`, "MZ");
  await put(root, `${L}/Programs/Beeper/Uninstall Beeper.exe`, "MZ");
  await put(root, `${L}/Programs/Beeper/resources/app.asar`, "");
  await put(root, `${R}/Spotify/Spotify.exe`, "MZ");
  await put(root, `${R}/Spotify/libcef.dll`, "MZ");
  await put(root, "/C/Program Files/Google/Chrome/Application/chrome.exe", "MZ");
  await put(root, "/C/Program Files/Mozilla Firefox/firefox.exe", "MZ");
  // Figma: Squirrel, two versions side by side, the app's name in its app.asar.
  await put(root, `${L}/Figma/Figma.exe`, "MZ");
  await put(root, `${L}/Figma/Update.exe`, "MZ");
  for (const v of ["124.6.5", "125.0.3"]) {
    await put(root, `${L}/Figma/app-${v}/Figma.exe`, fuseWire("101010r01"));
    await put(root, `${L}/Figma/app-${v}/resources/app.asar`, asarBuffer({ "package.json": JSON.stringify({ name: "figma_desktop", productName: "Figma", version: v }) }));
  }
  // The Start menu (MS-SHLLINK shortcuts):
  const start = `${R}/Microsoft/Windows/Start Menu/Programs`, common = "/C/ProgramData/Microsoft/Windows/Start Menu/Programs";
  //   GitHub Desktop: Squirrel, not in Morse's list, only found through its shortcut,
  //   which points at %LOCALAPPDATA%\GitHubDesktop\Update.exe --processStart "GitHubDesktop.exe".
  await put(root, `${L}/GitHubDesktop/Update.exe`, "MZ");
  for (const v of ["3.4.8", "3.4.9"]) {
    await put(root, `${L}/GitHubDesktop/app-${v}/GitHubDesktop.exe`, "MZ");
    await put(root, `${L}/GitHubDesktop/app-${v}/resources/app.asar`, asarBuffer({ "package.json": JSON.stringify({ productName: "GitHub Desktop", version: v }) }));
  }
  await put(root, `${start}/GitHub, Inc/GitHub Desktop.lnk`, lnkBuffer({ target: `${home}\\AppData\\Local\\GitHubDesktop\\Update.exe`, envTarget: "%LOCALAPPDATA%\\GitHubDesktop\\Update.exe", args: '--processStart "GitHubDesktop.exe"', workingDir: `${home}\\AppData\\Local\\GitHubDesktop\\app-3.4.9` }));
  //   Slack's own shortcut: the same app as the catalog found, listed once.
  await put(root, `${L}/slack/Update.exe`, "MZ");
  await put(root, `${start}/Slack Technologies Inc/Slack.lnk`, lnkBuffer({ target: `${home}\\AppData\\Local\\slack\\Update.exe`, args: '--processStart "slack.exe"' }));
  //   An Electron app on another drive, in a folder with spaces, for everyone.
  await put(root, "/D/Tools/Acme Chat/Acme Chat.exe", "MZ");
  await put(root, "/D/Tools/Acme Chat/resources/app.asar", asarBuffer({ "package.json": JSON.stringify({ productName: "Acme Chat", version: "2.1.0" }) }));
  await put(root, `${common}/Acme Chat.lnk`, lnkBuffer({ target: "D:\\Tools\\Acme Chat\\Acme Chat.exe" }));
  await put(root, `${common}/Acme Chat/Uninstall Acme Chat.lnk`, lnkBuffer({ target: "D:\\Tools\\Acme Chat\\Uninstall Acme Chat.exe" }));
  //   A native app: its shortcut is skipped.
  await put(root, "/C/Program Files/Notepad++/notepad++.exe", "MZ");
  await put(root, `${common}/Notepad++.lnk`, lnkBuffer({ target: "C:\\Program Files\\Notepad++\\notepad++.exe" }));
  return {
    platform: "win32", home, root,
    env: { LOCALAPPDATA: `${home}\\AppData\\Local`, APPDATA: `${home}\\AppData\\Roaming`, ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramData: "C:\\ProgramData", USERPROFILE: home, PATH: "C:\\Windows\\system32" },
  };
}

export async function buildLinux(root, home = "/home/sam") {
  await put(root, "/usr/share/code/code", "\x7fELF");
  await put(root, "/usr/share/code/resources/app/package.json", "{}");
  await put(root, "/usr/share/code/bin/code", "#!/usr/bin/env sh\nexec /usr/share/code/code \"$@\"\n");
  await link(root, "/usr/bin/code", "../share/code/bin/code");
  await put(root, "/usr/lib/slack/slack", "\x7fELF");
  await put(root, "/usr/lib/slack/resources/app.asar", "");
  await link(root, "/usr/bin/slack", "../lib/slack/slack");
  await put(root, "/snap/bin/spotify", "");
  await put(root, "/var/lib/flatpak/exports/bin/com.discordapp.Discord", "#!/bin/sh\nexec flatpak run com.discordapp.Discord \"$@\"\n");
  await put(root, `${home}/.local/share/flatpak/exports/bin/md.obsidian.Obsidian`, "#!/bin/sh\nexec flatpak run md.obsidian.Obsidian \"$@\"\n");
  await put(root, "/opt/Beeper/beeper", "\x7fELF");
  await put(root, "/opt/Beeper/chrome-sandbox", "\x7fELF");
  await put(root, "/opt/Beeper/libffmpeg.so", "");
  await put(root, "/opt/Beeper/resources/app.asar", "");
  await put(root, "/opt/Beeper/version", "31.4.0");
  await put(root, "/opt/google/chrome/chrome", "\x7fELF");
  await put(root, "/usr/bin/chromium", "\x7fELF");
  await put(root, "/usr/bin/vim", "\x7fELF");
  return { platform: "linux", home, root, env: { PATH: "/usr/local/bin:/usr/bin:/bin" } };
}
