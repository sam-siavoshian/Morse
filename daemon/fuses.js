// Reads Electron's fuse wire from an app binary, the same check REA's
// inspect_electron_fuses does: it tells us before launch whether the app will
// honour inspector flags and whether it validates its own ASAR.
//
// Wire layout: sentinel, then [version, length, ...one byte per fuse].
// Byte values: "0" disabled, "1" enabled, "r" removed.

import { promises as fs } from "node:fs";
import path from "node:path";

const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
const NAMES = [
  "RunAsNode",
  "EnableCookieEncryption",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
  "LoadBrowserProcessSpecificV8Snapshot",
  "GrantFileProtocolExtraPrivileges",
  "WasmTrapHandlers",
];

export function readFuseWire(buf) {
  const at = buf.indexOf(SENTINEL);
  if (at < 0) return null;
  const o = at + SENTINEL.length;
  const version = buf[o], length = buf[o + 1];
  const fuses = {};
  for (let i = 0; i < length; i++) {
    const b = String.fromCharCode(buf[o + 2 + i]);
    fuses[NAMES[i] || `Fuse${i}`] = b === "1" ? "enabled" : b === "0" ? "disabled" : b === "r" ? "removed" : `unknown(${b})`;
  }
  return { version, length, fuses };
}

// For a .app bundle, the wire lives in the Electron Framework binary.
export async function electronBinaryFor(appPath) {
  if (appPath.endsWith(".app")) {
    const fw = path.join(appPath, "Contents/Frameworks/Electron Framework.framework/Electron Framework");
    try { await fs.access(fw); return fw; } catch {}
  }
  return appPath;
}

export async function inspectFuses(appPath) {
  const file = await electronBinaryFor(appPath);
  // A bundle with no Electron Framework inside (a native Mac app) is a folder:
  // there is no fuse wire to read.
  if ((await fs.stat(file)).isDirectory()) return { electron: false, file };
  const buf = await fs.readFile(file);
  const wire = readFuseWire(buf);
  if (!wire) return { electron: false, file };
  return { electron: true, file, ...wire };
}

// What the fuses mean for Morse, in one line each. Checked on a real Electron
// 45 binary with every fuse that could matter turned off (tests/electron.test.js):
// the debugging port still opens and Morse still gets in.
export function fuseVerdict(info) {
  if (!info.electron) return ["No Electron fuses in this file. If the app is built on Chromium, Morse can still connect. If it's a native app, it can't."];
  const f = info.fuses, out = [];
  out.push("Morse can connect: it opens the app with --remote-debugging-port, which no Electron fuse turns off.");
  if (f.EnableNodeCliInspectArguments === "disabled") out.push("--inspect is fused off, so the app's Node.js side can't be debugged. Morse doesn't need it: mods run in the app's windows.");
  if (f.EnableEmbeddedAsarIntegrityValidation === "enabled") out.push("The app checks its own files (ASAR integrity). Morse never changes them, so that's fine.");
  return out;
}

// `morse fuses <app>`: the verdict, then each fuse.
export function formatFuses(info, name = "This app") {
  const out = [`${name}  ${info.file}`];
  for (const line of fuseVerdict(info)) out.push(`  ${line}`);
  if (info.electron) {
    out.push("", `  Electron fuses (wire version ${info.version})`);
    const word = { enabled: "on", disabled: "off", removed: "removed" };
    for (const [k, v] of Object.entries(info.fuses)) out.push(`    ${(word[v] || v).padEnd(8)}${k}`);
  }
  return out.join("\n");
}
