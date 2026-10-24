// Getting Morse to people: one version everywhere, `morse --version` and
// `morse setup --help`, setup writing what the model code reads, the npm
// package's file list, the store zip, the privacy page and the Pages build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { applyChoice, configFor, isSetUp } from "../daemon/setup.js";
import { settingsFromConfig } from "../daemon/models.js";
import { zipFiles } from "../scripts/package-extension.js";
import { mdToHtml, privacyHtml, buildPages, brokenLinks } from "../scripts/build-pages.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const CLI = path.join(root, "daemon", "cli.js");
const plain = s => s.replace(/\x1b\[\d+m/g, "");
const run = (args, home) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, MORSE_HOME: home }, encoding: "utf8" });

test("one version: package.json, morse --version, and the built manifest", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-ver-"));
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
  assert.match(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")}\\b`, "m"), "the changelog has an entry for this version");
});

test("morse setup --help explains the choices and changes nothing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-help-"));
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
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const files = JSON.parse(out)[0].files.map(f => f.path);
  for (const need of ["daemon/cli.js", "daemon/setup.js", "core/providers.js", "runtime/bundle.js", "design/tokens.css", "LICENSE", "README.md", "CHANGELOG.md"]) assert.ok(files.includes(need), `ships ${need}`);
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
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "morse-pages-"));
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
    assert.match(readFileSync(path.join(root, "extension", "host.js"), "utf8"), /SHARE_ORIGINS = \[[^\]]*"https:\/\/sam-siavoshian\.github\.io"/);
    await fs.writeFile(path.join(out, "site", "broken.html"), '<a href="nope.html">x</a><img src="../docs/launch/missing.png">');
    assert.deepEqual(await brokenLinks(out), ["site/broken.html -> nope.html", "site/broken.html -> ../docs/launch/missing.png"]);
  } finally { await fs.rm(out, { recursive: true, force: true }); }
});
