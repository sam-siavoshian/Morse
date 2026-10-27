// Public app downloads and the preview release pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("preview.yml: on pushes to main, pinned actions, only the release job can write, the package and updater checks gate it", () => {
  const yml = readFileSync(path.join(root, ".github", "workflows", "preview.yml"), "utf8");
  assert.match(yml, /on:\s*\n\s+push:\s*\n\s+branches: \[main\]/);
  assert.match(yml, /workflow_dispatch:/);
  for (const [, u] of yml.matchAll(/uses:\s*(\S+)/g)) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
  assert.match(yml, /^permissions:\n\s+contents: read$/m);
  const jobs = yml.slice(yml.indexOf("\njobs:"));
  const release = jobs.slice(jobs.indexOf("\n  release:"));
  assert.equal((jobs.match(/contents:\s*write/g) || []).length, 1, "one job can write");
  assert.match(release, /contents:\s*write/);
  assert.match(release, /needs: \[package, desktop, smoke\]/);
  for (const os of ["ubuntu-latest", "macos-latest", "windows-latest"]) assert.ok(jobs.includes(os), os);
  for (const step of ["npm install", 'node "$CLI" --version', 'node "$CLI" doctor --offline', "tests/updater.test.js", "SHA256SUMS", "build.json", "--prerelease", "codesign --verify", "morse-cli.tgz"]) assert.ok(yml.includes(step), `preview.yml has ${step}`);
  // The names the README and the site link to.
  for (const f of ["Morse-mac-arm64.dmg", "Morse-mac-x64.dmg", "Morse-Setup.exe", "Morse-linux-x86_64.AppImage"]) {
    assert.ok(readFileSync(path.join(root, "README.md"), "utf8").includes(`releases/download/preview/${f}`), `README links ${f}`);
    assert.ok(readFileSync(path.join(root, "site", "config.js"), "utf8").includes(`releases/download/preview/${f}`), `site/config.js links ${f}`);
  }
});

test("the site's Download Morse button is this visitor's download", async () => {
  const { desktopLink } = await import("../site/common.js");
  assert.match(desktopLink({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)" }), /Morse-mac-arm64\.dmg$/);
  assert.match(desktopLink({ platform: "Win32", userAgent: "Windows NT 10.0" }), /Morse-Setup\.exe$/);
  assert.match(desktopLink({ platform: "Linux x86_64", userAgent: "X11; Linux x86_64" }), /AppImage$/);
  assert.match(desktopLink({ platform: "iPhone", userAgent: "iPhone OS like Mac OS X" }), /releases\/tag\/preview$/);
});
