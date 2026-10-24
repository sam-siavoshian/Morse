// The zip to upload to the Chrome Web Store:
//
//   npm run store
//
// Builds the extension with MORSE_STORE=1 (scripts/build.js leaves out what
// only tests use) into dist/store/extension, so dist/extension stays the test
// build, then zips it to dist/morse-extension-<version>-store.zip and prints
// the path, the size and the SHA-256. It refuses to write the zip if the
// build still trusts the test share page or runs a string as code.
// docs/store/SUBMIT.md says what to do with it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageExtension } from "./package-extension.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "dist", "store", "extension");

export async function storeChecks(dir) {
  const problems = [];
  const read = f => fs.readFile(path.join(dir, f), "utf8");
  const manifest = JSON.parse(await read("manifest.json"));
  if (/"http:\/\/127\.0\.0\.1:8787[/"]/.test(await read("host.js"))) problems.push("host.js still trusts the test share page (127.0.0.1:8787)");
  if (/127\.0\.0\.1:8787\/site\/mods\//.test(await read("background.js"))) problems.push("background.js still reads the demo sites' gallery list (127.0.0.1:8787)");
  if (await read("build-id.txt").then(() => true, () => false)) problems.push("build-id.txt is there: this is a test build, which checks for rebuilds (extension/dev-host.js)");
  const files = [];
  const walk = async d => { for (const e of await fs.readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(path.join(d, e.name)) : files.push(path.join(d, e.name)); };
  await walk(dir);
  for (const f of files.filter(f => /\.(js|html)$/.test(f))) {
    const src = (await fs.readFile(f, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(src)) problems.push(`${path.relative(dir, f)} runs a string as code`);
    if (/<script[^>]*\bsrc="(https?:)?\/\//.test(src)) problems.push(`${path.relative(dir, f)} loads a script from the web`);
  }
  for (const size of ["16", "32", "48", "128"]) if (!manifest.icons?.[size]) problems.push(`no ${size}px icon`);
  return { manifest, files: files.length, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const build = spawnSync(process.execPath, [path.join(root, "scripts", "build.js"), "--out", dir], { cwd: root, env: { ...process.env, MORSE_STORE: "1" }, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status || 1);
  const { manifest, problems } = await storeChecks(dir);
  if (problems.length) { console.error(`Not ready for the store:\n  ${problems.join("\n  ")}`); process.exit(1); }
  const out = path.join(root, "dist", `morse-extension-${manifest.version}-store.zip`);
  const r = await packageExtension({ dir, out });
  const sha = createHash("sha256").update(await fs.readFile(r.out)).digest("hex");
  console.log(`
Store zip   ${path.relative(root, r.out)}
Version     ${r.version}
Files       ${r.files.length}, ${(r.bytes / 1024).toFixed(0)} KB
SHA-256     ${sha}

Upload it at https://chrome.google.com/webstore/devconsole (docs/store/SUBMIT.md).`);
}
