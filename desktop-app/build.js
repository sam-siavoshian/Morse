// Packages Morse Desktop: `npm run desktop:build` (node desktop-app/build.js).
//
//   node desktop-app/build.js                this platform (Linux: an AppImage)
//   node desktop-app/build.js --linux|--mac|--win
//   node desktop-app/build.js --dir          only the unpacked app, no installer
//   node desktop-app/build.js --stage-only   only dist/desktop-app/app (what goes in the package)
//
// Steps: build the extension (scripts/build.js), stage the app in
// dist/desktop-app/app (desktop-app/, daemon/, core/, runtime/, the design
// tokens, the built extension and the one npm dependency, with a package.json
// whose main is desktop-app/main.js), draw the icon into
// dist/desktop-app/res, then run electron-builder (builder.config.js) into
// dist/desktop-app/. Nothing it makes is committed. electron-builder comes
// from desktop-app's own devDependencies: npm ci --prefix desktop-app.
//
// The Electron runtime: on Linux, the one demo/electron-app/build.mjs finds
// (~/.cache/morse/electron), so nothing is downloaded; elsewhere
// electron-builder downloads ELECTRON_VERSION. Signing: docs/dev/releasing.md.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markPng } from "./mark.js";
import { builderConfig } from "./builder.config.js";
import { findElectron, electronVersion } from "../demo/electron-app/build.mjs";

export const ELECTRON_VERSION = "45.0.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "dist", "desktop-app");
const STAGE = path.join(OUT, "app");
const RES = path.join(OUT, "res");
const args = process.argv.slice(2);
const say = s => console.log(`· ${s}`);

// What the app needs at run time. Paths relative to the repo.
const COPY = ["daemon", "core", "runtime", "design/tokens.css", "site/fonts", "dist/extension"];
const APP_FILES = ["main.js", "preload.cjs", "service.js", "ipc.js", "icons.js", "linux.js", "chrome.js", "mark.js", "ui"];

async function copy(from, to) {
  const st = await fs.stat(from);
  if (st.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const e of await fs.readdir(from)) if (e !== "node_modules" && e !== ".DS_Store") await copy(path.join(from, e), path.join(to, e));
  } else { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); }
}

// The npm packages the daemon imports at run time, and theirs, found the way
// Node finds them from the repo.
async function prodDeps(pkgJson) {
  const out = new Map(); // name -> folder
  const visit = async (name, fromFile) => {
    if (out.has(name)) return;
    // node_modules/<name> in this folder or one above it (a package's "exports"
    // can hide its package.json from require.resolve).
    let dir = path.dirname(fromFile), file = null;
    for (;;) {
      const p = path.join(dir, "node_modules", name, "package.json");
      if (existsSync(p)) { file = p; break; }
      const up = path.dirname(dir);
      if (up === dir) return; // not installed (an optional peer like zod): fine
      dir = up;
    }
    dir = path.dirname(file);
    out.set(name, dir);
    const pj = JSON.parse(await fs.readFile(file, "utf8"));
    for (const dep of Object.keys(pj.dependencies || {})) await visit(dep, file);
  };
  for (const dep of Object.keys(pkgJson.dependencies || {})) await visit(dep, path.join(root, "package.json"));
  return out;
}

export async function stage() {
  say("building the extension (scripts/build.js)");
  execFileSync(process.execPath, [path.join(root, "scripts", "build.js")], { stdio: "inherit" });
  await fs.rm(STAGE, { recursive: true, force: true });
  for (const p of COPY) await copy(path.join(root, p), path.join(STAGE, p));
  for (const f of APP_FILES) await copy(path.join(here, f), path.join(STAGE, "desktop-app", f));
  const repo = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const pkg = {
    name: "morse-desktop", productName: "Morse", version: repo.version,
    description: "Change any app or website in your own words.", license: repo.license, homepage: repo.homepage,
    author: { name: "Morse", url: repo.homepage }, type: "module", main: "desktop-app/main.js",
    dependencies: repo.dependencies,
  };
  await fs.writeFile(path.join(STAGE, "package.json"), JSON.stringify(pkg, null, 2));
  // desktop-app/package.json says "type": "module" for its files in the repo; the staged root says it for all.
  for (const [name, dir] of await prodDeps(repo)) await copy(dir, path.join(STAGE, "node_modules", name));
  say(`staged ${path.relative(root, STAGE)}`);
  // The icon, drawn (mark.js), and the macOS entitlements.
  await fs.mkdir(RES, { recursive: true });
  await fs.writeFile(path.join(RES, "icon.png"), markPng(1024, { tile: true }));
  await fs.writeFile(path.join(RES, "entitlements.mac.plist"), ENTITLEMENTS);
  return { stage: STAGE, res: RES, version: repo.version };
}

// Hardened runtime: Electron's JavaScript engine needs JIT; quitting another
// app before reopening it with Morse needs Apple Events (asked once by macOS).
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.automation.apple-events</key><true/>
</dict>
</plist>
`;

async function main() {
  const { stage: st, res } = await stage();
  if (args.includes("--stage-only")) return;
  let eb;
  try { eb = createRequire(path.join(here, "package.json"))("electron-builder"); }
  catch { console.error("electron-builder isn't installed. Run: npm ci --prefix desktop-app"); process.exit(1); }
  const platform = args.includes("--mac") ? "mac" : args.includes("--win") ? "win" : args.includes("--linux") ? "linux"
    : { darwin: "mac", win32: "win" }[process.platform] || "linux";
  // Linux builds use the runtime already on this machine, when it's the right version.
  const local = platform === "linux" && process.platform === "linux" ? findElectron() : null;
  const electronDist = local && electronVersion(local) === ELECTRON_VERSION ? local : null;
  const config = builderConfig({ stage: st, out: OUT, res, electronDist, electronVersion: ELECTRON_VERSION });
  say(`electron-builder: ${platform}${args.includes("--dir") ? " (folder only)" : ""}${electronDist ? ` with ${electronDist}` : ""}`);
  const targets = { linux: eb.Platform.LINUX, mac: eb.Platform.MAC, win: eb.Platform.WINDOWS }[platform];
  const files = await eb.build({
    targets: targets.createTarget(args.includes("--dir") ? "dir" : null),
    config,
    projectDir: st,
  });
  for (const f of files) say(`made ${path.relative(root, f)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e?.stack || e); process.exit(1); });
}
