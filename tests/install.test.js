// The one-line installers (install.sh, install.ps1), run for real against
// files served from this computer the way the preview release serves them:
// morse-cli.tgz (npm pack) and SHA256SUMS.
//
//   - a fresh install: the morse command, morse --version, morse doctor
//     --offline, the extension folder that stays put, the record of what it added
//   - running it again: "already up to date"; with a new package: "updated"
//   - a download that doesn't match SHA256SUMS: refused, nothing installed
//   - no Node, or an old one: says how to get it, installs nothing
//   - --uninstall and `morse uninstall`: remove what was added, keep your mods
//   - no release yet: builds the package from the main branch's .tar.gz
//   - install.ps1 the same way, when PowerShell (pwsh) is on this computer
//
// Morse's one npm dependency comes from npm's cache when it's there
// (prefer-offline), so the tests don't need the network on a computer that
// ran npm ci.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SH = path.join(root, "install.sh");
const PS1 = path.join(root, "install.ps1");
const NODE_DIR = path.dirname(process.execPath);
const NPM_CACHE = (() => { try { return execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
const sha = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const pwsh = process.env.MORSE_TEST_PWSH || ["/usr/bin/pwsh", "/usr/local/bin/pwsh", "/opt/microsoft/powershell/7/pwsh"].find(p => existsSync(p)) || "";

let server, base, served, pkgA, pkgB, srcTarball;

// Serves `served` (a folder); /missing/* is a 404, like a release that isn't there.
function serve() {
  return new Promise(resolve => {
    server = createServer((req, res) => {
      const file = path.join(served, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(served) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not Found"); }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(readFileSync(file));
    }).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

// Runs a program without blocking this process (the file server is in it).
function run(file, args, opts) {
  return new Promise(resolve => {
    const child = spawn(file, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeout || 240_000);
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr, out: stdout + stderr }); });
    child.on("error", e => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: String(e), out: String(e) }); });
  });
}

// A release folder with this package and its SHA256SUMS (or a wrong one).
function release(name, pkg, { badSum = false } = {}) {
  const dir = path.join(served, name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(pkg, path.join(dir, "morse-cli.tgz"));
  const sum = badSum ? "0".repeat(64) : sha(pkg);
  writeFileSync(path.join(dir, "SHA256SUMS"), `${sum}  morse-cli.tgz\n${"1".repeat(64)}  morse-extension.zip\n`);
  return `${base}/${name}`;
}

// A PATH with the basics and Node, or with a stand-in node (or none).
function binDir({ node = "real" } = {}) {
  const dir = tempDir("morse-path-");
  if (node === "real") { symlinkSync(process.execPath, path.join(dir, "node")); for (const t of ["npm", "npx"]) if (existsSync(path.join(NODE_DIR, t))) symlinkSync(path.join(NODE_DIR, t), path.join(dir, t)); }
  if (node === "old") { writeFileSync(path.join(dir, "node"), "#!/bin/sh\necho 18.19.0\n", { mode: 0o755 }); writeFileSync(path.join(dir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 }); }
  return dir;
}

function runSh(args, { home, url, node = "real", env = {} } = {}) {
  const bin = binDir({ node });
  return run("sh", [SH, ...args], {
    timeout: 240_000,
    env: {
      HOME: home, PATH: `${bin}:/usr/bin:/bin`, SHELL: "/bin/zsh", LANG: "C.UTF-8",
      MORSE_INSTALL_BASE: url || `${base}/missing`, MORSE_BIN_DIR: path.join(home, "bin"),
      MORSE_SETUP_CHECK: "0", MORSE_NO_UPDATE_CHECK: "1", MORSE_HELPER_PORT: "1",
      ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", NO_COLOR: "1",
      ...(NPM_CACHE && { npm_config_cache: NPM_CACHE }), npm_config_prefer_offline: "true", npm_config_update_notifier: "false",
      ...env,
    },
  });
}

// The installed morse command, run the way a person would.
function morse(home, args) {
  return run(path.join(home, "bin", "morse"), args, {
    timeout: 60_000,
    env: { HOME: home, PATH: `${NODE_DIR}:/usr/bin:/bin`, MORSE_NO_UPDATE_CHECK: "1", MORSE_HELPER_PORT: "1", NO_COLOR: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" },
  });
}

function pack(dir) {
  // The built extension is in the package (package.json "files"); build it once if this checkout hasn't.
  if (!existsSync(path.join(root, "dist", "extension", "manifest.json"))) execFileSync(process.execPath, [path.join(root, "scripts", "build.js")], { stdio: "ignore" });
  mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], { cwd: root, stdio: "ignore", env: { ...process.env, npm_config_ignore_scripts: "true" } });
  return path.join(dir, readdirSync(dir).find(f => f.endsWith(".tgz")));
}

before(async () => {
  served = tempDir("morse-release-");
  base = await serve();
  const tmp = tempDir("morse-pack-");
  pkgA = pack(path.join(tmp, "a"));
  // A second, different package: the same one with one more file.
  const b = path.join(tmp, "b");
  mkdirSync(b);
  execFileSync("tar", ["-xzf", pkgA, "-C", b]);
  writeFileSync(path.join(b, "package", "NEWER"), "a newer build\n");
  pkgB = path.join(tmp, "b.tgz");
  execFileSync("tar", ["-czf", pkgB, "-C", b, "package"]);
});
after(() => server?.close());

test("install.sh: one line installs Morse, a second run is up to date, a newer package updates it", async () => {
  const home = tempDir("morse-home-");
  const url = release("v1", pkgA);
  let r = await runSh([], { home, url });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Checked the download against the release's SHA256SUMS/);
  assert.match(r.out, /Morse 0\.\d+\.\d+ installed/);
  assert.match(r.out, /Next:\n  1\. Chrome: .*chrome:\/\/extensions.*~\/\.morse\/chrome-extension/);
  assert.match(r.out, /One more line, so your terminal finds the morse command[\s\S]*export PATH=.*\.zshrc/, "the bin folder isn't on PATH: it says the line to add");
  assert.match(r.out, /Nothing that can write your changes was found yet/, "morse setup --auto ran, with nothing to find and nobody to ask");

  const v = await morse(home, ["--version"]);
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version);
  const d = await morse(home, ["doctor", "--offline"]);
  assert.equal(d.status, 0, d.stdout + d.stderr);
  assert.match(d.stdout, /skipped \(--offline\)|No model is connected/);
  const ext = path.join(home, ".morse", "chrome-extension");
  assert.ok(existsSync(path.join(ext, "manifest.json")), "the extension folder that stays put");
  const e = await morse(home, ["extension"]);
  assert.equal(e.stdout.split("\n")[0], ext, "morse extension names that folder");
  const receipt = readFileSync(path.join(home, ".morse", "install.txt"), "utf8");
  assert.match(receipt, new RegExp(`^sha256=${sha(pkgA)}$`, "m"));
  assert.match(receipt, new RegExp(`^shim=${path.join(home, "bin", "morse").replace(/[.]/g, "\\.")}$`, "m"));
  assert.ok(existsSync(path.join(home, ".morse", "app", "node_modules", "@anthropic-ai", "sdk")), "its one dependency is installed");

  r = await runSh(["--no-setup"], { home, url });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /already up to date/);
  assert.doesNotMatch(r.out, /Looking for something/, "--no-setup skips morse setup");

  r = await runSh(["--no-setup"], { home, url: release("v2", pkgB) });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Morse 0\.\d+\.\d+ updated/);
  assert.ok(existsSync(path.join(home, ".morse", "app", "NEWER")), "the new package is in place");
  assert.ok(!existsSync(path.join(home, ".morse", "app.old")) && !existsSync(path.join(home, ".morse", ".app-new")), "nothing left over from the swap");
});

test("install.sh: a download that doesn't match SHA256SUMS is refused, and nothing is installed", async () => {
  const home = tempDir("morse-home-");
  const r = await runSh([], { home, url: release("bad", pkgA, { badSum: true }) });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /doesn't match its checksum, so it wasn't installed/);
  assert.ok(!existsSync(path.join(home, ".morse", "app")), "no Morse");
  assert.ok(!existsSync(path.join(home, "bin", "morse")), "no morse command");
});

test("install.sh: without Node 22 it says how to get it and stops", async () => {
  const home = tempDir("morse-home-");
  let r = await runSh([], { home, url: release("v1", pkgA), node: "none" });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Morse needs Node 22 or newer, and this computer doesn't have it yet/);
  assert.match(r.out, /nodejs\.org/);
  r = await runSh([], { home, url: release("v1", pkgA), node: "old" });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /This computer has Node 18\.19\.0/);
  assert.ok(!existsSync(path.join(home, ".morse")), "nothing was written");
});

test("install.sh --uninstall and morse uninstall remove what was added and keep your mods", async () => {
  for (const how of ["script", "command"]) {
    const home = tempDir("morse-home-");
    let r = await runSh(["--no-setup"], { home, url: release("v1", pkgA) });
    assert.equal(r.status, 0, r.out);
    mkdirSync(path.join(home, ".morse", "mods"), { recursive: true });
    writeFileSync(path.join(home, ".morse", "mods", "mine.json"), "{}");
    if (how === "script") r = await runSh(["--uninstall"], { home });
    else { const u = await morse(home, ["uninstall", "--yes"]); r = { status: u.status, out: u.stdout + u.stderr }; }
    assert.equal(r.status, 0, `${how}: ${r.out}`);
    assert.match(r.out, /Morse is removed/);
    for (const gone of ["bin/morse", ".morse/app", ".morse/chrome-extension", ".morse/install.txt"]) assert.ok(!existsSync(path.join(home, gone)), `${how}: ${gone} is gone`);
    assert.ok(existsSync(path.join(home, ".morse", "mods", "mine.json")), `${how}: your mods stay`);
  }
  // --all takes the Morse folder too; a morse command someone else made stays.
  const home = tempDir("morse-home-");
  await runSh(["--no-setup"], { home, url: release("v1", pkgA) });
  const all = await runSh(["--uninstall", "--all"], { home });
  assert.equal(all.status, 0, all.out);
  assert.ok(!existsSync(path.join(home, ".morse")), "--all: the Morse folder is gone");
  const other = tempDir("morse-home-");
  mkdirSync(path.join(other, "bin"));
  writeFileSync(path.join(other, "bin", "morse"), "#!/bin/sh\necho someone else's\n", { mode: 0o755 });
  const r = await runSh(["--no-setup"], { home: other, url: release("v1", pkgA) });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /already a morse command .* didn't make, so it was left alone/);
  await runSh(["--uninstall"], { home: other });
  assert.equal(readFileSync(path.join(other, "bin", "morse"), "utf8"), "#!/bin/sh\necho someone else's\n");
});

test("install.sh: with no release yet, it builds the package from the main branch", { timeout: 300_000 }, async () => {
  // The main branch's .tar.gz, as codeload serves it: one top folder.
  const src = tempDir("morse-src-");
  const top = path.join(src, "RRAA-main");
  mkdirSync(top);
  const skip = new Set(["node_modules", "dist", ".git", "docs", "tests", "demo", "evals", ".claude", "share", "site"]);
  for (const f of readdirSync(root)) if (!skip.has(f) && !f.endsWith(".tgz")) execFileSync("cp", ["-R", path.join(root, f), top]);
  mkdirSync(path.join(top, "docs", "launch"), { recursive: true });
  writeFileSync(path.join(top, "docs", "launch", "big.mp4"), "left out of the build");
  srcTarball = path.join(served, "main.tar.gz");
  execFileSync("tar", ["-czf", srcTarball, "-C", src, "RRAA-main"]);
  const home = tempDir("morse-home-");
  const r = await runSh(["--no-setup"], { home, env: { MORSE_INSTALL_SOURCE: `${base}/main.tar.gz` } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /No preview release yet, so Morse is built from the main branch/);
  assert.match(readFileSync(path.join(home, ".morse", "install.txt"), "utf8"), /^source=main$/m);
  assert.equal((await morse(home, ["--version"])).status, 0);
  assert.ok(existsSync(path.join(home, ".morse", "chrome-extension", "manifest.json")));
  // The store build: it doesn't trust the test share page.
  assert.doesNotMatch(readFileSync(path.join(home, ".morse", "chrome-extension", "host.js"), "utf8"), /"http:\/\/127\.0\.0\.1:8787/);
});

test("install.sh is plain POSIX sh, and every address in it points at main", () => {
  const text = readFileSync(SH, "utf8");
  assert.equal(spawnSync("sh", ["-n", SH]).status, 0);
  if (existsSync("/usr/bin/dash")) assert.equal(spawnSync("/usr/bin/dash", ["-n", SH]).status, 0);
  assert.match(text, /^set -eu$/m);
  assert.doesNotMatch(text, /\beval\b/, "nothing downloaded is run as shell text");
  assert.doesNotMatch(text, /\bsudo\b/);
  for (const t of [text, readFileSync(PS1, "utf8")]) {
    for (const [u] of t.matchAll(/https:\/\/(raw\.githubusercontent|codeload\.github)\.com\/\S+/g)) assert.match(u, /\/main\b/, `${u} names main, not the default branch`);
    assert.match(t, /releases\/download\/preview/);
  }
  // Windows PowerShell 5.1 reads a script without a BOM as ANSI: keep it ASCII.
  assert.doesNotMatch(readFileSync(PS1, "utf8"), /[^\x00-\x7f]/, "install.ps1 is ASCII");
});

test("install.ps1 installs, updates, refuses a bad checksum and uninstalls (PowerShell)", { skip: !pwsh && "pwsh isn't installed (CI runs install.ps1 on Windows)", timeout: 300_000 }, async () => {
  const ps = (home, url, extra = {}) => run(pwsh, ["-NoProfile", "-NonInteractive", "-File", PS1, ...(extra.args || [])], {
      timeout: 240_000,
      env: {
        HOME: home, PATH: `${NODE_DIR}:/usr/bin:/bin`, MORSE_INSTALL_BASE: url, MORSE_BIN_DIR: path.join(home, "bin"), MORSE_NO_SETUP: "1",
        MORSE_NO_UPDATE_CHECK: "1", ...(NPM_CACHE && { npm_config_cache: NPM_CACHE }), npm_config_prefer_offline: "true", DOTNET_CLI_TELEMETRY_OPTOUT: "1", POWERSHELL_TELEMETRY_OPTOUT: "1",
        ...extra.env,
      },
    });
  const home = tempDir("morse-home-");
  let r = await ps(home, release("bad", pkgA, { badSum: true }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /doesn't match its checksum/);
  r = await ps(home, release("v1", pkgA));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Morse 0\.\d+\.\d+ installed/);
  assert.match(readFileSync(path.join(home, "bin", "morse.cmd"), "utf8"), /node ".*daemon[\\/]cli\.js" %\* & exit \/b/);
  assert.ok(existsSync(path.join(home, ".morse", "chrome-extension", "manifest.json")));
  r = await ps(home, release("v1", pkgA));
  assert.match(r.out, /already up to date/);
  r = await ps(home, release("v2", pkgB));
  assert.match(r.out, /updated/);
  r = await ps(home, base, { args: ["-Uninstall"] });
  assert.equal(r.status, 0, r.out);
  for (const gone of ["bin/morse.cmd", ".morse/app", ".morse/chrome-extension", ".morse/install.txt"]) assert.ok(!existsSync(path.join(home, gone)), `${gone} is gone`);
  rmSync(home, { recursive: true, force: true });
  // No release yet: the main branch, built (the .tar.gz the sh test made).
  if (srcTarball) {
    const home2 = tempDir("morse-home-");
    r = await ps(home2, `${base}/missing`, { env: { MORSE_INSTALL_SOURCE: `${base}/main.tar.gz` } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /built from the main branch/);
    assert.match(readFileSync(path.join(home2, ".morse", "install.txt"), "utf8"), /^source=main$/m);
    assert.doesNotMatch(readFileSync(path.join(home2, ".morse", "chrome-extension", "host.js"), "utf8"), /"http:\/\/127\.0\.0\.1:8787/, "the store build");
  }
});
