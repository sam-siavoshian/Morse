// `npm run check`: build, then cheap checks that need no extra dependencies.
//   1. every JS file parses (node --check)
//   2. the runtime bundle: runtime/src/*.js are concatenated into one scope, so
//      no two files (or the core modules inlined with them) may declare the same
//      top-level name, and the bundle must parse
//   3. every file extension/manifest.json and extension/*.html point at (and the
//      modules those import) exists in dist/extension after the build
//   4. axe-core (demo/vendor, test-only) is not in the built extension
// Exits non-zero and lists every problem.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { runtimeBundleProblems } from "./bundle-check.js";

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

// ---- 2. runtime bundle (also run by `npm test`: tests/bundle.test.js)
step("runtime bundle: duplicate top-level names, and it parses");
const bundle = runtimeBundleProblems();
for (const p of bundle.problems) fail("runtime bundle", p);
console.log(`  ${bundle.names} top-level names`);

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

// ---- 4. axe-core (demo/vendor, for tests and `npm run ui`) never ships
step("axe-core is not in the built extension or the runtime");
const shipped = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? shipped(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const AXE_MARK = /Deque Systems|axe-core|\baxe\.run\(/;
for (const f of existsSync(DIST) ? shipped(DIST).filter(f => /\.(m?js|html|json)$/.test(f)) : []) if (AXE_MARK.test(readFileSync(f, "utf8"))) fail("dist/extension", `${path.relative(DIST, f)} contains axe-core (test-only, demo/vendor)`);
if (AXE_MARK.test(readFileSync(path.join(root, "package.json"), "utf8").replace(/"devDependencies"[\s\S]*?\}/, ""))) fail("package.json", "axe-core is only for tests (demo/vendor), not a dependency");

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n` + problems.map(p => "  - " + p.replace(/\n/g, "\n    ")).join("\n"));
  process.exit(1);
}
console.log("\n✓ all checks passed");
