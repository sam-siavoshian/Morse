// Getting Morse to people: one version everywhere, `morse --version` and
// `morse setup --help`, setup writing what the model code reads, the npm
// package's file list, the store zip, the privacy page and the Pages build.
import { tempDir } from "./helpers/home.js"; // first: a MORSE_HOME of its own, and temp folders removed at exit
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { promises as fs, readFileSync, readdirSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { applyChoice, configFor, isSetUp } from "../daemon/setup.js";
import { settingsFromConfig } from "../daemon/models.js";
import { zipFiles } from "../scripts/package-extension.js";
import { mdToHtml, privacyHtml, buildPages, brokenLinks } from "../scripts/build-pages.js";
import { nextVersion, compareVersions, cutChangelog, notesFor, blobBase, withVersion, lockWithVersion } from "../scripts/release.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const CLI = path.join(root, "daemon", "cli.js");
const plain = s => s.replace(/\x1b\[\d+m/g, "");
const run = (args, home) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, MORSE_HOME: home }, encoding: "utf8" });

test("one version: package.json, morse --version, and the built manifest", async () => {
  const home = tempDir("morse-ver-");
  try {
    for (const flag of ["--version", "-v", "version"]) {
      const r = run([flag], home);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), pkg.version);
    }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
  const source = JSON.parse(readFileSync(path.join(root, "extension", "manifest.json"), "utf8"));
  assert.equal(source.version, undefined, "extension/manifest.json has no version of its own; the build adds package.json's");
  const built = path.join(root, "dist", "extension", "manifest.json");
  if (existsSync(built)) assert.equal(JSON.parse(readFileSync(built, "utf8")).version, pkg.version);
  // The changelog has an entry for this version, or this version is the next
  // release, still under "Unreleased" (`npm run release` gives it its heading).
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /^## Unreleased$/m, "the changelog has an Unreleased section");
  const released = [...changelog.matchAll(/^## (\d+\.\d+\.\d+\S*)/gm)].map(m => m[1]);
  assert.ok(released.includes(pkg.version) || released.every(v => compareVersions(v, pkg.version) < 0), `the changelog has an entry for ${pkg.version}, or it is the next release`);
});

test("morse setup --help explains the choices and changes nothing", async () => {
  const home = tempDir("morse-help-");
  try {
    const r = run(["setup", "--help"], home);
    assert.equal(r.status, 0);
    const out = plain(r.stdout);
    assert.match(out, /morse setup --use claude-code/);
    assert.match(out, /morse setup --use codex/);
    assert.match(out, /--use api-key --key <key>/);
    assert.doesNotMatch(out, /Looking for something/, "it doesn't start the walk-through");
    assert.equal(existsSync(path.join(home, "config.json")), false);
    assert.match(plain(run(["help"], home).stdout), /morse extension/);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test("what morse setup saves is what the model code reads", () => {
  const cc = applyChoice({ keep: 1, model: { provider: "old" } }, configFor("claude-code"));
  assert.equal(cc.keep, 1);
  assert.equal(cc.model, undefined);
  assert.equal(settingsFromConfig(cc, {}, { env: {}, harnesses: { claude: { found: false }, codex: { found: false } } }).provider, "claude-code");

  const key = applyChoice({ keys: { openai: "sk-old" } }, configFor("api-key", { key: "sk-ant-abc" }));
  const s = settingsFromConfig(key, {}, { env: {}, harnesses: { claude: { found: true }, codex: { found: false } } });
  assert.deepEqual([s.provider, s.apiKey, s.detected], ["anthropic", "sk-ant-abc", false], "a pasted key is used, not auto-detection");
  assert.equal(key.keys.openai, "sk-old", "other keys are kept");

  const env = applyChoice({}, configFor("api-key", { keyEnv: "OPENAI_API_KEY", vendor: "openai" }));
  assert.equal(env.keys, undefined, "a key from the environment is never written");
  assert.equal(settingsFromConfig(env, {}, { env: { OPENAI_API_KEY: "sk-env" }, harnesses: { claude: { found: false }, codex: { found: false } } }).apiKey, "sk-env");
  assert.equal(isSetUp(env), true);
});

test("the npm package ships only what the morse command needs", () => {
  assert.deepEqual(pkg.bin, { morse: "daemon/cli.js" });
  assert.match(pkg.engines.node, />=22/);
  assert.ok(readFileSync(CLI, "utf8").startsWith("#!/usr/bin/env node"));
  // No build here: other tests read dist/extension while this runs.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, npm_config_ignore_scripts: "true" } });
  const files = JSON.parse(out.slice(out.indexOf("[")))[0].files.map(f => f.path);
  // runtime/boot.js: runtime/bundle.js reads it when the CLI starts (every command failed without it)
  for (const need of ["daemon/cli.js", "daemon/setup.js", "daemon/update-check.js", "core/providers.js", "runtime/bundle.js", "runtime/boot.js", "design/tokens.css", "LICENSE", "README.md", "CHANGELOG.md"]) assert.ok(files.includes(need), `ships ${need}`);
  for (const f of readdirSync(path.join(root, "runtime"))) if (f.endsWith(".js")) assert.ok(files.includes(`runtime/${f}`), `ships runtime/${f}`);
  assert.ok(files.some(f => f.startsWith("runtime/src/")), "ships the runtime sources the desktop connector bundles");
  for (const f of files) assert.doesNotMatch(f, /^(tests|demo|docs|site|share|evals|scripts|extension)\//, `doesn't ship ${f}`);
});

test("the store zip is a valid zip with the files at its root", () => {
  const entries = [{ name: "manifest.json", data: Buffer.from('{"version":"1.2.3"}') }, { name: "icons/16.png", data: Buffer.alloc(300, 7) }];
  const zip = zipFiles(entries);
  // Walk the local headers like an unzip tool does.
  let off = 0;
  for (const e of entries) {
    assert.equal(zip.readUInt32LE(off), 0x04034b50);
    const method = zip.readUInt16LE(off + 8), size = zip.readUInt32LE(off + 18), nameLen = zip.readUInt16LE(off + 26);
    assert.equal(zip.toString("utf8", off + 30, off + 30 + nameLen), e.name);
    const body = zip.subarray(off + 30 + nameLen, off + 30 + nameLen + size);
    assert.deepEqual(method === 8 ? inflateRawSync(body) : body, e.data);
    off += 30 + nameLen + size;
  }
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), entries.length);
  if (spawnSync("unzip", ["-v"]).status === 0) {
    const tmp = path.join(os.tmpdir(), `morse-zip-${process.pid}.zip`);
    return fs.writeFile(tmp, zip).then(() => {
      const r = spawnSync("unzip", ["-t", tmp], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stdout + r.stderr);
    }).finally(() => fs.rm(tmp, { force: true }));
  }
});

test("site/privacy.html is made from docs/privacy.md and is current", async () => {
  assert.equal(readFileSync(path.join(root, "site", "privacy.html"), "utf8"), await privacyHtml(), "run npm run pages");
  const html = mdToHtml("# T\n\nSome `code` and **bold** and [a](https://x.y).\n\n- one\n  more\n- two\n\n| A | B |\n|---|---|\n| <x> | y |\n");
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<code>code<\/code> and <strong>bold<\/strong> and <a href="https:\/\/x.y">a<\/a>/);
  assert.match(html, /<li>one more<\/li>\n<li>two<\/li>/);
  assert.match(html, /<td>&lt;x&gt;<\/td>/);
  for (const page of ["index.html", "gallery.html"]) assert.match(readFileSync(path.join(root, "site", page), "utf8"), /href="privacy.html"/, `${page} links the privacy policy`);
});

test("the Pages build publishes the paths the code uses, with no broken links", async () => {
  const out = tempDir("morse-pages-");
  try {
    await buildPages({ out });
    for (const p of ["index.html", "site/index.html", "site/privacy.html", "site/mods/index.json", "share/install.html", "core/mod.js", "design/tokens.css", "docs/launch/morse-demo.mp4", ".nojekyll"]) {
      assert.ok(existsSync(path.join(out, p)), `publishes ${p}`);
    }
    const { SHARE_BASE } = await import("../core/mod.js");
    const { GALLERY_INDEX_URL } = await import("../core/gallery.js");
    for (const url of [SHARE_BASE, GALLERY_INDEX_URL]) {
      const u = new URL(url);
      assert.equal(u.origin, "https://sam-siavoshian.github.io");
      assert.ok(existsSync(path.join(out, u.pathname.replace(/^\/RRAA\//, ""))), `${url} is published`);
    }
    // The extension trusts the share page's folder: SHARE_BASE has to be in it.
    const trusted = JSON.parse(/const SHARE_PAGES = (\[[^\]]*\])/.exec(readFileSync(path.join(root, "extension", "host.js"), "utf8").replace(/\/\*[^*]*\*\//g, ""))[1]);
    assert.ok(SHARE_BASE.startsWith(trusted[0]) && new URL(trusted[0]).pathname === "/RRAA/share/", `${SHARE_BASE} is in ${trusted[0]}`);
    await fs.writeFile(path.join(out, "site", "broken.html"), '<a href="nope.html">x</a><img src="../docs/launch/missing.png">');
    assert.deepEqual(await brokenLinks(out), ["site/broken.html -> nope.html", "site/broken.html -> ../docs/launch/missing.png"]);
  } finally { await fs.rm(out, { recursive: true, force: true }); }
});

test("npm run release: the next version, the changelog section, the version lines", () => {
  assert.equal(nextVersion("0.2.0", "patch"), "0.2.1");
  assert.equal(nextVersion("0.2.0", "minor"), "0.3.0");
  assert.equal(nextVersion("0.2.9", "major"), "1.0.0");
  assert.equal(nextVersion("1.0.0-beta.2", "patch"), "1.0.0", "patch on a pre-release releases it");
  assert.equal(nextVersion("0.2.0", "v1.4.0"), "1.4.0");
  assert.throws(() => nextVersion("0.2.0", "bigger"), /patch, minor, major or a version/);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.10", "1.0.0-rc.9"), 1);

  const log = "# Changelog\n\nIntro.\n\n## Unreleased\n\n- New: [docs](docs/a.md), [site](https://x.y/z) and [here](#top).\n\n## 0.1.0\n\nOld.\n";
  const cut = cutChangelog(log, "0.2.0", "2026-10-24");
  assert.equal(cut, "# Changelog\n\nIntro.\n\n## Unreleased\n\n## 0.2.0 (2026-10-24)\n\n- New: [docs](docs/a.md), [site](https://x.y/z) and [here](#top).\n\n## 0.1.0\n\nOld.\n");
  assert.equal(notesFor(cut, "0.2.0"), "- New: [docs](docs/a.md), [site](https://x.y/z) and [here](#top).\n");
  assert.equal(notesFor(cut, "0.2.0", { base: blobBase(pkg, "v0.2.0") }), "- New: [docs](https://github.com/sam-siavoshian/RRAA/blob/v0.2.0/docs/a.md), [site](https://x.y/z) and [here](#top).\n", "repo links work on the release page");
  assert.equal(notesFor(cut, "0.1.0"), "Old.\n");
  assert.equal(notesFor(cut, "0.3.0"), null);
  assert.throws(() => cutChangelog(cut, "0.3.0", "2026-10-25"), /Unreleased.* is empty/, "nothing new: no release");
  assert.throws(() => cutChangelog("# Changelog\n\n## 0.1.0\n\nOld.\n", "0.2.0", "2026-10-24"), /no “## Unreleased”/);
  assert.throws(() => cutChangelog(log.replace("## 0.1.0", "## 0.2.0"), "0.2.0", "2026-10-24"), /already has a section for 0.2.0/);

  const pkgText = readFileSync(path.join(root, "package.json"), "utf8");
  const bumped = withVersion(pkgText, "9.8.7");
  assert.equal(JSON.parse(bumped).version, "9.8.7");
  assert.equal(bumped.replace('"9.8.7"', `"${pkg.version}"`), pkgText, "only the version line changes");
  const lock = JSON.parse(lockWithVersion(readFileSync(path.join(root, "package-lock.json"), "utf8"), "9.8.7"));
  assert.deepEqual([lock.version, lock.packages[""].version], ["9.8.7", "9.8.7"]);
});

test("npm run release in a scratch repository: dry run, then the commit and the tag, never a push", async () => {
  const dir = tempDir("morse-release-");
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: gitEnv }).trim();
  await fs.mkdir(path.join(dir, "scripts"));
  await fs.copyFile(path.join(root, "scripts", "release.js"), path.join(dir, "scripts", "release.js"));
  await fs.writeFile(path.join(dir, "package.json"), '{\n  "name": "morse-cli",\n  "version": "0.2.0",\n  "type": "module",\n  "repository": { "type": "git", "url": "git+https://github.com/sam-siavoshian/RRAA.git" }\n}\n');
  await fs.writeFile(path.join(dir, "package-lock.json"), JSON.stringify({ name: "morse-cli", version: "0.2.0", lockfileVersion: 3, packages: { "": { name: "morse-cli", version: "0.2.0" } } }, null, 2) + "\n");
  await fs.writeFile(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- First.\n\n## 0.1.0\n\nOld.\n");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "start");
  const remote = path.join(dir, "..", path.basename(dir) + "-remote.git"); // a remote that doesn't exist: a push would fail
  git("remote", "add", "origin", remote);
  const release = (...a) => spawnSync(process.execPath, [path.join(dir, "scripts", "release.js"), ...a], { cwd: dir, encoding: "utf8", env: gitEnv });
  const head = git("rev-parse", "HEAD");

  let r = release("0.2.0", "--dry-run", "--skip-checks");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: nothing is changed/);
  assert.match(r.stdout, /## 0\.2\.0 \(\d{4}-\d\d-\d\d\)\n\n- First\./);
  assert.match(r.stdout, /git push --follow-tags origin main/);
  assert.equal(git("status", "--porcelain"), "", "the dry run changed nothing");
  assert.equal(git("tag"), "");

  r = release("--skip-checks");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Which release\?/);
  r = release("0.1.5", "--skip-checks");
  assert.match(r.stderr, /isn't newer than 0\.2\.0/);
  await fs.writeFile(path.join(dir, "stray.txt"), "x");
  r = release("minor", "--skip-checks");
  assert.match(r.stderr, /changes that aren't committed/);
  await fs.rm(path.join(dir, "stray.txt"));

  // The first release of the version package.json already has.
  r = release("0.2.0", "--skip-checks");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing is pushed yet[\s\S]*git push --follow-tags origin main/);
  assert.equal(git("log", "-1", "--format=%s"), "Release v0.2.0");
  assert.equal(git("rev-parse", "HEAD~1"), head);
  assert.equal(git("cat-file", "-t", "v0.2.0"), "tag", "an annotated tag, so git push --follow-tags sends it");
  assert.equal(git("rev-parse", "v0.2.0^{commit}"), git("rev-parse", "HEAD"));
  assert.deepEqual(git("show", "--name-only", "--format=", "HEAD").split("\n"), ["CHANGELOG.md"], "package.json already said 0.2.0");
  assert.equal(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version, "0.2.0");
  assert.match(readFileSync(path.join(dir, "CHANGELOG.md"), "utf8"), /^# Changelog\n\n## Unreleased\n\n## 0\.2\.0 \(\d{4}-\d\d-\d\d\)\n\n- First\.\n\n## 0\.1\.0\n/);
  assert.equal(release("notes", "0.2.0").stdout, "- First.\n");
  assert.equal(existsSync(remote), false, "nothing was pushed");

  r = release("patch", "--skip-checks");
  assert.match(r.stderr, /Unreleased.* is empty/, "no second release without new changelog entries");
  await fs.writeFile(path.join(dir, "CHANGELOG.md"), readFileSync(path.join(dir, "CHANGELOG.md"), "utf8").replace("## Unreleased\n", "## Unreleased\n\n- Second.\n"));
  git("commit", "-qam", "more");
  r = release("minor", "--skip-checks");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(git("show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["CHANGELOG.md", "package-lock.json", "package.json"]);
  assert.equal(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version, "0.3.0");
  assert.equal(JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8")).packages[""].version, "0.3.0");
  assert.equal(git("tag", "--list").split("\n").join(","), "v0.2.0,v0.3.0");
  r = release("0.3.0", "--skip-checks");
  assert.equal(r.status, 1);
});

test("the release workflow: on v* tags, checks and tests first, store zip, npm only with NPM_TOKEN, notes from the changelog", () => {
  const wf = readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(wf, /on:\s*\n\s+push:\s*\n\s+tags:\s*\["v\*"\]/);
  for (const step of ["npm ci", "npm run check", "npm test", "MORSE_STORE", "node scripts/release.js notes", "--provenance", "release-desktop.yml"]) assert.ok(wf.includes(step), `release.yml has ${step}`);
  assert.match(wf, /::notice[^\n]*NPM_TOKEN/, "says clearly when npm is skipped");
  assert.match(readFileSync(path.join(root, ".github", "workflows", "pages.yml"), "utf8"), /branches: \[main\]/, "Pages publishes from main, whatever the default branch is");
});
