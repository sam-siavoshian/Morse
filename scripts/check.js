// `npm run check`: build, then cheap checks that need no extra dependencies.
//   1. every JS file parses (node --check)
//   2. the runtime bundle: runtime/src/*.js are concatenated into one scope, so
//      no two files (or the core modules inlined with them) may declare the same
//      top-level name, and the bundle must parse
//   3. every file extension/manifest.json and extension/*.html point at (and the
//      modules those import) exists in dist/extension after the build
// Exits non-zero and lists every problem.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { bundleRuntime } from "../runtime/bundle.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const rel = f => path.relative(root, f);
const problems = [];
const fail = (what, msg) => problems.push(`${what}: ${msg}`);
const step = name => console.log(`· ${name}`);

// ---- build
if (!process.argv.includes("--no-build")) {
  step("build");
  execFileSync(process.execPath, [path.join(root, "scripts/build.js")], { stdio: "inherit" });
}

// ---- 1. syntax
step("node --check on every JS file");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".claude"]);
function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (/\.(m|c)?js$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC = path.join(root, "runtime", "src");
// runtime/src files are fragments of one function body (top-level `return`); check 2 parses them as the bundle.
const files = jsFiles(root).filter(f => !f.startsWith(SRC + path.sep));
const nodeCheck = f => new Promise(resolve => execFile(process.execPath, ["--check", f], (e, so, se) => resolve(e ? String(se).trim().split("\n").slice(0, 5).join("\n") : null)));
for (let i = 0; i < files.length; i += 8) {
  const batch = files.slice(i, i + 8);
  const res = await Promise.all(batch.map(nodeCheck));
  res.forEach((err, j) => { if (err) fail(rel(batch[j]), err); });
}
console.log(`  ${files.length} files`);

// ---- 2. runtime bundle
step("runtime bundle: duplicate top-level names, and it parses");
// Top-level declarations in this codebase start at column 0.
function topLevelNames(src) {
  const names = [];
  const add = (n, line) => n && names.push({ name: n, line });
  src.split("\n").forEach((l, i) => {
    let m;
    if ((m = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], i + 1);
    else if ((m = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], i + 1);
    else if ((m = /^(?:export\s+)?(?:const|let|var)\s+\{([^}]*)\}\s*=/.exec(l))) {
      for (const part of m[1].split(",")) { const n = part.split(":").pop().split("=")[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) add(n, i + 1); }
    } else if ((m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(l))) {
      add(m[1], i + 1);
      // let a = 1, b = 2; on one line
      for (const extra of l.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) if (!/[([{]/.test(l.slice(0, extra.index).replace(/^[^=]*=/, ""))) add(extra[1], i + 1);
    }
  });
  return names;
}
const seen = new Map(); // name -> "file:line"
const declare = (where, src) => {
  for (const { name, line } of topLevelNames(src)) {
    const at = `${where}:${line}`;
    if (seen.has(name)) fail("runtime bundle", `"${name}" is declared at top level in both ${seen.get(name)} and ${at}`);
    else seen.set(name, at);
  }
};
// What bundleRuntime() puts in the same scope: TOKENS_CSS, core/hotkeys.js and
// core/prefs.js with `export` dropped, the exports of the inlined core modules,
// then runtime/src/*.js in filename order.
seen.set("TOKENS_CSS", "runtime/bundle.js");
for (const f of ["hotkeys.js", "prefs.js"]) declare(`core/${f}`, readFileSync(path.join(root, "core", f), "utf8"));
const bundleSrc = readFileSync(path.join(root, "runtime", "bundle.js"), "utf8");
for (const [, mod] of bundleSrc.matchAll(/inlineModule\("\.\.\/core\/([\w.-]+)"\)/g)) {
  const src = readFileSync(path.join(root, "core", mod), "utf8");
  for (const [, name] of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(name)) fail("runtime bundle", `"${name}" (exported by core/${mod}, inlined) is also declared in ${seen.get(name)}`);
    else seen.set(name, `core/${mod} (inlined)`);
  }
}
for (const f of readdirSync(SRC).filter(f => f.endsWith(".js")).sort()) declare(`runtime/src/${f}`, readFileSync(path.join(SRC, f), "utf8"));
try { new vm.Script(bundleRuntime(), { filename: "runtime.js" }); }
catch (e) { fail("runtime bundle", `doesn't parse: ${e.message}`); }
console.log(`  ${seen.size} top-level names`);

// ---- 3. built extension
step("dist/extension has every file the manifest and pages reference");
const EXT = path.join(root, "extension"), DIST = path.join(root, "dist", "extension");
const refs = new Map(); // dist-relative path -> where it's referenced
const ref = (p, from) => { if (p && !/^([a-z]+:|#|\/\/)/i.test(p)) { const clean = p.split(/[?#]/)[0].replace(/^\.?\//, ""); if (!refs.has(clean)) refs.set(clean, from); } };
const manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
ref(manifest.background?.service_worker, "manifest background");
for (const cs of manifest.content_scripts || []) for (const f of [...(cs.js || []), ...(cs.css || [])]) ref(f, "manifest content_scripts");
for (const p of manifest.sandbox?.pages || []) ref(p, "manifest sandbox");
ref(manifest.action?.default_popup, "manifest action");
ref(manifest.options_ui?.page, "manifest options_ui");
ref(manifest.options_page, "manifest options_page");
for (const v of Object.values(manifest.icons || {})) ref(v, "manifest icons");
for (const v of Object.values(manifest.action?.default_icon || {})) ref(v, "manifest action icons");
for (const w of manifest.web_accessible_resources || []) for (const r of w.resources || []) if (!r.includes("*")) ref(r, "manifest web_accessible_resources");
const pages = [...readdirSync(EXT).filter(f => f.endsWith(".html")), ...[...refs.keys()].filter(f => f.endsWith(".html"))];
for (const page of new Set(pages)) {
  const file = existsSync(path.join(DIST, page)) ? path.join(DIST, page) : path.join(EXT, page);
  if (!existsSync(file)) continue;
  for (const [, , url] of readFileSync(file, "utf8").matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/g)) ref(url, page);
}
// Modules those scripts import (popup.js → ./core/onboarding.js, …), followed transitively.
const queue = [...refs.keys()].filter(f => /\.m?js$/.test(f));
for (const seenJs = new Set(); queue.length;) {
  const f = queue.shift();
  if (seenJs.has(f) || !existsSync(path.join(DIST, f))) continue;
  seenJs.add(f);
  const src = readFileSync(path.join(DIST, f), "utf8");
  for (const [, spec] of src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm)) {
    if (!spec || !/^\.\.?\//.test(spec)) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
    if (!refs.has(target)) { refs.set(target, `import in ${f}`); queue.push(target); }
  }
}
if (!existsSync(DIST)) fail("dist/extension", "missing: run npm run build");
else for (const [p, from] of refs) {
  const full = path.join(DIST, p);
  if (!existsSync(full) || !statSync(full).isFile()) fail("dist/extension", `${p} is missing (referenced by ${from})`);
}
console.log(`  ${refs.size} files referenced`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n` + problems.map(p => "  - " + p.replace(/\n/g, "\n    ")).join("\n"));
  process.exit(1);
}
console.log("\n✓ all checks passed");
