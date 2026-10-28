// Packages Morse Desktop: `npm run desktop:build` (node desktop-app/build.js).
//
//   node desktop-app/build.js                this platform (Linux: an AppImage)
//   node desktop-app/build.js --linux|--mac|--win
//   node desktop-app/build.js --dir          only the unpacked app, no installer
//   node desktop-app/build.js --stage-only   only dist/desktop-app/app (what goes in the package)
//
// Steps: stage the app in dist/desktop-app/app (desktop-app/, daemon/, core/,
// runtime/, the design tokens and the one npm dependency, with a package.json
// whose main is desktop-app/main.js), draw the icon into
// dist/desktop-app/res, then run electron-builder (builder.config.js) into
// dist/desktop-app/. Nothing it makes is committed. electron-builder comes
// from desktop-app's own devDependencies: npm ci --prefix desktop-app.
//
// The Electron runtime: on Linux, the one demo/electron-app/build.mjs finds
// (~/.cache/morse/electron), so nothing is downloaded; elsewhere
// electron-builder downloads ELECTRON_VERSION. Signing: docs/dev/releasing.md.
//
// What is not copied: source maps, type declarations, TypeScript sources, a
// CommonJS file that has an .mjs twin, and json-schema-to-ts (types only).
// The window never plays ui/sounds (nothing references it).

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markPng } from "./mark.js";
import { builderConfig } from "./builder.config.js";
import { buildNativePicker } from "./native-picker.js";
import { findElectron, electronVersion } from "../demo/electron-app/build.mjs";
import { TYPE_ONLY_DEPS, SKIP_DEP_DIRS, depFileShips, publishedInstallerName } from "./slim.js";

export const ELECTRON_VERSION = "45.0.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const OUT = path.join(root, "dist", "desktop-app");
const STAGE = path.join(OUT, "app");
const RES = path.join(OUT, "res");
const args = process.argv.slice(2);
const say = s => console.log(`· ${s}`);

// What the app needs at run time. Paths relative to the repo.
const COPY = ["daemon", "core", "runtime", "native-dbi", "design/tokens.css", "site/fonts", "site/config.js"];
export const APP_FILES = ["main.js", "native-picker.js", "overlay.js", "preload.cjs", "overlay-preload.cjs", "service.js", "ipc.js", "icons.js", "appimage.js", "linux.js", "shell-path.js", "shortcut.js", "updater.js", "mark.js", "ui"];

async function copy(from, to) {
  const st = await fs.stat(from);
  if (st.isDirectory()) {
    // ui/sounds/intro.m4a is not referenced by the window.
    if (path.basename(from) === "sounds" && path.basename(path.dirname(from)) === "ui") return;
    await fs.mkdir(to, { recursive: true });
    for (const e of await fs.readdir(from)) if (e !== "node_modules" && e !== ".DS_Store") await copy(path.join(from, e), path.join(to, e));
  } else { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); }
}

// A dependency, without the files Node never loads.
async function copyDep(from, to) {
  const st = await fs.stat(from);
  if (st.isDirectory()) {
    if (SKIP_DEP_DIRS.has(path.basename(from))) return;
    await fs.mkdir(to, { recursive: true });
    for (const e of await fs.readdir(from)) {
      if (e === "node_modules" || e === ".DS_Store" || SKIP_DEP_DIRS.has(e)) continue;
      await copyDep(path.join(from, e), path.join(to, e));
    }
    return;
  }
  const twin = from.endsWith(".cjs") ? from.slice(0, -4) + ".mjs" : from.endsWith(".js") ? from.slice(0, -3) + ".mjs" : null;
  if (!depFileShips(path.basename(from), { siblingMjs: !!(twin && existsSync(twin)) })) return;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
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
    for (const dep of Object.keys(pj.dependencies || {})) if (!TYPE_ONLY_DEPS.has(dep)) await visit(dep, file);
  };
  for (const dep of Object.keys(pkgJson.dependencies || {})) await visit(dep, path.join(root, "package.json"));
  return out;
}

export async function stage() {
  await fs.rm(STAGE, { recursive: true, force: true });
  for (const p of COPY) await copy(path.join(root, p), path.join(STAGE, p));
  for (const f of APP_FILES) await copy(path.join(here, f), path.join(STAGE, "desktop-app", f));
  const repo = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const pkg = {
    name: "morse-desktop", productName: "Morse", version: repo.version,
    description: "Hack your apps. Remove unwanted features. Build your own.", license: repo.license, homepage: repo.homepage,
    author: { name: "Morse", url: repo.homepage }, type: "module", main: "desktop-app/main.js",
    dependencies: repo.dependencies,
  };
  await fs.writeFile(path.join(STAGE, "package.json"), JSON.stringify(pkg, null, 2));
  // Which build this is, for the updater (updater.js): the commit it was made from.
  let commit = process.env.GITHUB_SHA || "";
  if (!commit) try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}
  await fs.writeFile(path.join(STAGE, "desktop-app", "build-info.json"), JSON.stringify({ version: repo.version, commit, builtAt: new Date().toISOString() }));
  // desktop-app/package.json says "type": "module" for its files in the repo; the staged root says it for all.
  for (const [name, dir] of await prodDeps(repo)) {
    const dest = path.join(STAGE, "node_modules", name);
    await copyDep(dir, dest);
    // electron-builder walks dependencies. A type-only package that is not
    // on disk (json-schema-to-ts) makes that walk fail, so it is taken out
    // of the copied package.json too.
    const meta = path.join(dest, "package.json");
    if (existsSync(meta)) {
      const pj = JSON.parse(await fs.readFile(meta, "utf8"));
      let changed = false;
      for (const dep of TYPE_ONLY_DEPS) if (pj.dependencies?.[dep]) { delete pj.dependencies[dep]; changed = true; }
      if (changed) await fs.writeFile(meta, JSON.stringify(pj));
    }
  }
  say(`staged ${path.relative(root, STAGE)}`);
  // The icon, drawn (mark.js), and the macOS entitlements.
  await fs.mkdir(RES, { recursive: true });
  await fs.writeFile(path.join(RES, "icon.png"), markPng(1024, { tile: true }));
  await fs.writeFile(path.join(RES, "entitlements.mac.plist"), ENTITLEMENTS);
  if (process.platform === "darwin") {
    const bins = [];
    for (const arch of ["arm64", "x86_64"]) {
      const file = path.join(RES, `morse-native-picker-${arch}`);
      await buildNativePicker(file, { arch }); bins.push(file);
    }
    execFileSync("/usr/bin/lipo", ["-create", ...bins, "-output", path.join(RES, "morse-native-picker")]);
    await fs.copyFile(path.join(root, "native/morse-picker/rea/LICENSE"), path.join(RES, "REA-LICENSE"));
  }
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
  for (const f of files) {
    const nextName = publishedInstallerName(path.basename(f));
    const dest = nextName === path.basename(f) ? f : path.join(path.dirname(f), nextName);
    if (dest !== f) await fs.rename(f, dest);
    say(`made ${path.relative(root, dest)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e?.stack || e); process.exit(1); });
}
