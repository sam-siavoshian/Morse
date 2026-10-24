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
  const buf = await fs.readFile(file);
  const wire = readFuseWire(buf);
  if (!wire) return { electron: false, file };
  return { electron: true, file, ...wire };
}

// What the fuses mean for Morph, in one line each.
export function fuseVerdict(info) {
  if (!info.electron) return ["No Electron fuse wire found. If this is Chromium-based, --remote-debugging-port should still work."];
  const f = info.fuses, out = [];
  out.push("Renderer injection uses --remote-debugging-port (a Chromium switch, not gated by fuses).");
  if (f.EnableNodeCliInspectArguments === "disabled") out.push("Main-process --inspect is fused off; deep main-process mods are unavailable (renderer mods are unaffected).");
  if (f.EnableEmbeddedAsarIntegrityValidation === "enabled") out.push("ASAR integrity is on: patching app files would break the app. Morph never patches files, so this is fine.");
  return out;
}
