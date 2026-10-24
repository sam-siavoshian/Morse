// Reads Electron's fuse wire from an app binary, the same check REA's
// inspect_electron_fuses does: it tells us before launch whether the app will
// honour inspector flags and whether it validates its own ASAR.
//
// Wire layout: sentinel, then [version, length, ...one byte per fuse].
// Byte values: "0" disabled, "1" enabled, "r" removed.
//
// Where the wire is:
//   Linux    the app's own binary (Electron renamed: /opt/Foo/foo)
//   Windows  the app's .exe (Electron renamed: Slack.exe), in app-<version>\ for Squirrel apps
//   macOS    Foo.app/Contents/Frameworks/Electron Framework.framework/Electron Framework,
//            a Mach-O file; a universal one (Intel + Apple silicon) has one wire per part.
//
// Read only, always. Changing a fuse means rewriting the binary, which breaks
// a macOS app's code signature (macOS then refuses to open it) and
// Windows' Authenticode signature. Morse never does that: it only needs the
// debugging port, which no fuse turns off.

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

function wireAt(buf, at) {
  const o = at + SENTINEL.length;
  if (o + 2 > buf.length) return null; // cut off right after the sentinel
  const version = buf[o], length = Math.min(buf[o + 1], buf.length - o - 2); // a wire cut short says no more than it has
  const fuses = {};
  for (let i = 0; i < length; i++) {
    const b = String.fromCharCode(buf[o + 2 + i]);
    fuses[NAMES[i] || `Fuse${i}`] = b === "1" ? "enabled" : b === "0" ? "disabled" : b === "r" ? "removed" : `unknown(${b})`;
  }
  return { version, length, fuses };
}

export function readFuseWire(buf) {
  const at = buf.indexOf(SENTINEL);
  return at < 0 ? null : wireAt(buf, at);
}

// Every wire in a file, read a piece at a time: an Electron Framework is a
// few hundred MB, and a universal one has two wires.
export async function readFuseWires(file, { chunk = 16 << 20 } = {}) {
  const fh = await fs.open(file, "r");
  const wires = [];
  try {
    const tail = SENTINEL.length + 2 + 64; // a wire that straddles two pieces
    const size = (await fh.stat()).size;
    let pos = 0, carry = Buffer.alloc(0);
    for (;;) {
      const buf = Buffer.alloc(chunk);
      const { bytesRead } = await fh.read(buf, 0, chunk, pos);
      if (!bytesRead) break;
      const data = Buffer.concat([carry, buf.subarray(0, bytesRead)]);
      const base = pos - carry.length;
      for (let at = data.indexOf(SENTINEL); at >= 0; at = data.indexOf(SENTINEL, at + 1)) {
        const offset = base + at;
        if (wires.some(w => w.offset === offset)) continue;
        if (at + tail > data.length && pos + bytesRead < size) break; // read it whole with the next piece
        wires.push({ offset, ...wireAt(data, at) });
      }
      pos += bytesRead;
      carry = data.subarray(Math.max(0, data.length - tail));
    }
  } finally { await fh.close(); }
  return wires;
}

// What kind of binary: Mach-O (thin or universal), Windows PE, ELF.
export function binaryFormat(head) {
  const be = head.length >= 4 ? head.readUInt32BE(0) : 0;
  if (be === 0xcafebabe || be === 0xcafebabf) return "mach-o universal";
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(be)) return "mach-o";
  if (head[0] === 0x4d && head[1] === 0x5a) return "pe";
  if (be === 0x7f454c46) return "elf";
  return null;
}

// For a .app bundle (or a file inside one), the wire lives in the Electron
// Framework binary, not in Contents/MacOS/<exe>.
export async function electronBinaryFor(appPath) {
  const bundle = /^(.*?\.app)(\/|$)/.exec(appPath)?.[1];
  if (bundle) {
    const fw = path.join(bundle, "Contents/Frameworks/Electron Framework.framework/Electron Framework");
    try { await fs.access(fw); return fw; } catch {}
  }
  return appPath;
}

export async function inspectFuses(appPath) {
  const file = await electronBinaryFor(appPath);
  // A bundle with no Electron Framework inside (a native Mac app) is a folder:
  // there is no fuse wire to read.
  if ((await fs.stat(file)).isDirectory()) return { electron: false, file };
  // An AppImage keeps the app's binary compressed inside it ("AI" and the
  // type at byte 8): the fuse wire can't be read without unpacking it.
  const head = Buffer.alloc(11);
  const fh = await fs.open(file, "r");
  try { await fh.read(head, 0, 11, 0); } finally { await fh.close(); }
  if (head.toString("latin1", 8, 10) === "AI" && [1, 2].includes(head[10])) return { electron: false, appimage: true, file };
  const format = binaryFormat(head);
  const wires = await readFuseWires(file);
  if (!wires.length) return { electron: false, file, format };
  const { offset, ...first } = wires[0];
  void offset;
  const same = wires.every(w => JSON.stringify(w.fuses) === JSON.stringify(first.fuses));
  return { electron: true, file, format, ...first, ...(wires.length > 1 && { parts: wires.length, partsDiffer: !same }) };
}

// What the fuses mean for Morse, in one line each. Checked on a real Electron
// 45 binary with every fuse that could matter turned off (tests/electron.test.js):
// the debugging port still opens and Morse still gets in.
export function fuseVerdict(info) {
  if (info.appimage) return ["It's an AppImage: the app is packed inside it, so Morse can't read its fuses without unpacking it. No fuse turns off the debugging port, so if the app is built on Electron, Morse can connect."];
  if (!info.electron) return ["No Electron fuses in this file. If the app is built on Chromium, Morse can still connect. If it's a native app, it can't."];
  const f = info.fuses, out = [];
  out.push("Morse can connect: it opens the app with --remote-debugging-pipe (or a debugging port), which no Electron fuse turns off.");
  if (f.EnableNodeCliInspectArguments === "disabled") out.push("--inspect is fused off, so the app's Node.js side can't be debugged. Morse doesn't need it: mods run in the app's windows.");
  if (f.EnableEmbeddedAsarIntegrityValidation === "enabled") out.push("The app checks its own files (ASAR integrity). Morse never changes them, so that's fine.");
  if (f.RunAsNode === "enabled") out.push("ELECTRON_RUN_AS_NODE would start this app as plain Node.js. Morse clears that variable when it opens the app.");
  if (info.partsDiffer) out.push("The Intel and Apple silicon parts of this app have different fuses. These are the first part's.");
  return out;
}

// `morse fuses <app>`: the verdict, then each fuse.
export function formatFuses(info, name = "This app") {
  const out = [`${name}  ${info.file}`];
  for (const line of fuseVerdict(info)) out.push(`  ${line}`);
  if (info.electron) {
    out.push("", `  Electron fuses (wire version ${info.version}${info.parts > 1 ? `, ${info.parts} parts in this universal binary` : ""})`);
    const word = { enabled: "on", disabled: "off", removed: "removed" };
    for (const [k, v] of Object.entries(info.fuses)) out.push(`    ${(word[v] || v).padEnd(8)}${k}`);
    out.push("", "  Morse only reads these. Changing them would break the app's signature.");
  }
  return out.join("\n");
}
