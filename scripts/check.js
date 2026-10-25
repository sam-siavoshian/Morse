// `npm run check`: build, then cheap checks that need no extra dependencies.
//   1. every JS file parses (node --check)
//   2. the runtime bundle: runtime/src/*.js are concatenated into one scope, so
//      no two files (or the core modules inlined with them) may declare the same
//      top-level name, and the bundle must parse
//   3. axe-core (demo/vendor, test-only) is not in the built runtime
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
// runtime/src files and runtime/boot.js are fragments of a function body
// (top-level `return`); check 2 parses them as the bundle.
const BOOT = path.join(root, "runtime", "boot.js");
const files = jsFiles(root).filter(f => !f.startsWith(SRC + path.sep) && f !== BOOT);
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

// ---- 3. axe-core (demo/vendor, for tests and `npm run ui`) never ships
step("axe-core is not in the built runtime");
const AXE_MARK = /Deque Systems|axe-core|\baxe\.run\(/;
const RUNTIME = path.join(root, "dist", "runtime", "runtime.js");
if (existsSync(RUNTIME) && AXE_MARK.test(readFileSync(RUNTIME, "utf8"))) fail("dist/runtime", "runtime.js contains axe-core (test-only, demo/vendor)");
if (AXE_MARK.test(readFileSync(path.join(root, "package.json"), "utf8").replace(/"devDependencies"[\s\S]*?\}/, ""))) fail("package.json", "axe-core is only for tests (demo/vendor), not a dependency");

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n` + problems.map(p => "  - " + p.replace(/\n/g, "\n    ")).join("\n"));
  process.exit(1);
}
console.log("\n✓ all checks passed");
