// Bytes the packaged app can drop without changing how Morse runs.
//
// Electron's own executable is the download (linux-x64, Electron 45.0.0:
// 234,483,016 bytes, already stripped). The official runtime zip is
// 123,909,792 bytes. Nothing here tries to get under that.

import path from "node:path";
import { promises as fs } from "node:fs";

// Chromium's locale file stems for the languages Morse speaks (core/locales),
// plus the extra bundles Chromium splits (en-GB, es-419, pt-PT, zh-TW) and
// the macOS folder names (en, en_GB, zh_CN). electron-builder deletes any
// other locale whose name is not in this list, so both spellings have to be
// here or a language we ship disappears.
export const ELECTRON_LANGS = [
  "en", "en-US", "en_US", "en-GB", "en_GB",
  "ar", "de", "es", "es-419", "es_419",
  "fa", "fr", "ja",
  "pt", "pt-BR", "pt_BR", "pt-PT", "pt_PT",
  "zh", "zh-CN", "zh_CN", "zh-TW", "zh_TW",
];

const KEPT_LANG = new Set(ELECTRON_LANGS);

// Listed in @anthropic-ai/sdk's dependencies, imported by none of its runtime
// files. It only feeds the .d.ts we do not ship.
export const TYPE_ONLY_DEPS = new Set(["json-schema-to-ts"]);

// A file inside a shipped npm package. siblingMjs: the same name with .mjs
// beside it, which is what Node loads for `import()`.
export function depFileShips(name, { siblingMjs = false } = {}) {
  if (name === ".DS_Store" || name === ".npmignore" || name === ".eslintrc" || name === ".editorconfig") return false;
  if (name.endsWith(".map")) return false;
  if (name.endsWith(".md")) return false;
  if (/\.d\.[cm]?ts$/.test(name)) return false;
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return false;
  if (siblingMjs && (name.endsWith(".js") || name.endsWith(".cjs"))) return false;
  return true;
}

export const SKIP_DEP_DIRS = new Set([".github", "test", "tests", "__tests__", "docs", "example", "examples", "__fixtures__"]);

function langKept(stem) {
  return KEPT_LANG.has(stem) || KEPT_LANG.has(stem.replace(/_/g, "-")) || stem === "en";
}

// A Chromium locale or a debug leftover inside the packaged Electron runtime.
// LICENSES.chromium.html stays: Chromium's license requires it.
export function unusedRuntimeFile(rel) {
  const base = path.basename(rel);
  const parent = path.basename(path.dirname(rel));
  if (base === "chrome_crashpad_handler" || base === "chrome_crashpad_handler.exe") return true;
  if (base === "default_app.asar") return true;
  if (base.endsWith(".pdb") || base.endsWith(".debug") || base.endsWith(".dSYM")) return true;
  if (base.endsWith(".lproj")) {
    const stem = base.slice(0, -".lproj".length);
    if (!/^[A-Za-z]{2}([_-][A-Za-z0-9]+)?$/.test(stem)) return false;
    return !langKept(stem);
  }
  if (parent === "locales" && base.endsWith(".pak")) return !langKept(base.slice(0, -".pak".length));
  return false;
}

// The x64 installer keeps the name the site, the README and the updater
// already use. arm64 stays Morse-Setup-<version>-arm64.exe.
export function publishedInstallerName(fileName) {
  const m = fileName.match(/^Morse-Setup-(.+)-x64\.exe$/);
  return m ? `Morse-Setup-${m[1]}.exe` : fileName;
}

// afterPack: the unpacked app, before it is signed and wrapped.
export async function trimPackagedRuntime(appOutDir) {
  await walk(appOutDir);
}

async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (unusedRuntimeFile(e.name)) { await fs.rm(p, { recursive: true, force: true }); continue; }
      await walk(p);
      continue;
    }
    if (unusedRuntimeFile(path.join(path.basename(dir), e.name))) await fs.rm(p, { force: true });
  }
}
