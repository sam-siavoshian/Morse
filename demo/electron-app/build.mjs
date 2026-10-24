// Packages the Tunes sample app the way real Electron apps ship: the Electron
// runtime renamed to the app's name, with the app in resources/app/ (unpacked,
// like VS Code). No Electron install is checked into the repo; this finds one.
//
//   node demo/electron-app/build.mjs [outDir]     (default: /opt/Tunes)
//   → <outDir>/tunes, which `morse launch <outDir>/tunes` (or, in /opt,
//     `morse launch tunes`) can open.
//
// Where the Electron runtime comes from, first found wins:
//   1. $MORSE_ELECTRON: the electron binary, or the folder holding it
//   2. the `electron` npm package, if the repo has it installed
//   3. ~/.cache/morse/electron, set up with:
//        npm install --prefix ~/.cache/morse/electron electron
//        node ~/.cache/morse/electron/node_modules/electron/install.js   (if dist/ is missing)

import { existsSync, promises as fs, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const exeName = { win32: "electron.exe", darwin: "Electron.app" }[process.platform] || "electron";

// The folder with the Electron runtime (dist/), or null.
export function findElectron(env = process.env) {
  const tries = [];
  if (env.MORSE_ELECTRON) {
    const p = path.resolve(env.MORSE_ELECTRON);
    tries.push(existsSync(p) && statSync(p).isDirectory() ? p : path.dirname(p));
  }
  for (const from of [path.join(here, "..", ".."), path.join(os.homedir(), ".cache", "morse", "electron")]) {
    try { tries.push(path.join(path.dirname(createRequire(path.join(from, "x.js")).resolve("electron/package.json")), "dist")); } catch {}
  }
  return tries.find(d => existsSync(path.join(d, exeName))) || null;
}

export function electronVersion(dist) {
  try { return readFileSync(path.join(dist, "version"), "utf8").trim() || null; } catch { return null; }
}

// Hard links when the disk allows (the runtime is ~250 MB), copies otherwise.
async function cloneTree(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) await cloneTree(a, b);
    else if (e.isSymbolicLink()) await fs.symlink(await fs.readlink(a), b);
    else { try { await fs.link(a, b); } catch { await fs.copyFile(a, b); } }
  }
}

// Packs a folder into an ASAR archive, like Slack, Discord and most Electron
// apps ship (resources/app.asar). The format: an 8-byte pickle with the
// header's size, the header pickle (a JSON file table), then the files.
export async function packAsar(dir, out) {
  const blobs = [];
  let offset = 0;
  const walk = async d => {
    const files = {};
    for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) files[e.name] = { files: await walk(p) };
      else {
        const data = await fs.readFile(p);
        files[e.name] = { size: data.length, offset: String(offset) };
        blobs.push(data);
        offset += data.length;
      }
    }
    return files;
  };
  const json = Buffer.from(JSON.stringify({ files: await walk(dir) }));
  const padded = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + padded);
  header.writeUInt32LE(4 + padded, 0);  // header pickle payload: string length + string
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(header.length, 4);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, Buffer.concat([sizes, header, ...blobs]));
}

// Builds the packaged app in outDir; returns { dir, exe, version }.
//   asar: ship the app as resources/app.asar instead of resources/app/
export async function buildTunes(outDir = "/opt/Tunes", { dist = findElectron(), asar = false } = {}) {
  if (!dist) throw new Error("No Electron runtime found. Install one: npm install --prefix ~/.cache/morse/electron electron");
  if (process.platform === "darwin") throw new Error("build.mjs packages for Linux and Windows; on a Mac, run: npx electron demo/electron-app");
  await fs.rm(outDir, { recursive: true, force: true });
  await cloneTree(dist, outDir);
  const exe = path.join(outDir, process.platform === "win32" ? "Tunes.exe" : "tunes");
  await fs.rename(path.join(outDir, exeName), exe);
  await fs.rm(path.join(outDir, "resources", "default_app.asar"), { force: true });
  const app = path.join(outDir, "resources", "app");
  await fs.mkdir(path.join(app, "ui"), { recursive: true });
  for (const f of ["package.json", "main.js", "preload.js", "renderer.js", "mini.html"]) await fs.copyFile(path.join(here, f), path.join(app, f));
  await fs.copyFile(path.join(here, "..", "sites", "tunes", "index.html"), path.join(app, "ui", "index.html"));
  if (asar) {
    await packAsar(app, path.join(outDir, "resources", "app.asar"));
    await fs.rm(app, { recursive: true });
  }
  return { dir: outDir, exe, version: electronVersion(outDir) };
}

// Locks the packaged app down the way security-minded apps ship (what
// @electron/fuses does): rewrites fuse bytes in the binary's fuse wire.
//   fuses: { RunAsNode: false, EnableNodeCliInspectArguments: false, ... }
// The binary is copied first, so a hard-linked runtime stays untouched.
export async function setFuses(exe, fuses) {
  const { readFuseWire } = await import("../../daemon/fuses.js");
  const buf = await fs.readFile(exe);
  const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
  const at = buf.indexOf(sentinel);
  if (at < 0) throw new Error(`${exe} has no Electron fuse wire`);
  const names = Object.keys(readFuseWire(buf).fuses);
  for (const [name, on] of Object.entries(fuses)) {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`no fuse called ${name}`);
    buf[at + sentinel.length + 2 + i] = (on ? "1" : "0").charCodeAt(0);
  }
  await fs.rm(exe);
  await fs.writeFile(exe, buf, { mode: 0o755 });
}

if (process.argv[1] &&path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const r = await buildTunes(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`Tunes (Electron ${r.version}) is at ${r.exe}`);
}
