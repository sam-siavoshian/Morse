// Morse Desktop updates itself from the preview release (desktop-app/updater.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assetFor, parseSums, isNewer, versionOf, bundleOf, createUpdater, RELEASE, installDest, swapInPlace, macRelaunchScript, linuxSwapScript } from "../desktop-app/updater.js";

test("each computer gets its own file; others don't update themselves", () => {
  assert.equal(assetFor("darwin", "arm64"), "Morse-mac-arm64.zip");
  assert.equal(assetFor("darwin", "x64"), "Morse-mac-x64.zip");
  assert.equal(assetFor("win32", "x64"), "Morse-Setup.exe");
  assert.equal(assetFor("linux", "x64"), "Morse-linux-x86_64.AppImage");
  assert.equal(assetFor("linux", "arm64"), null);
});

test("SHA256SUMS lines are read as sha256sum writes them", () => {
  const a = "a".repeat(64), b = "B".repeat(64);
  assert.deepEqual(parseSums(`${a}  Morse-Setup.exe\n${b} *morse-cli.tgz\nnot a line\n`), { "Morse-Setup.exe": a, "morse-cli.tgz": b.toLowerCase() });
});

test("a newer build is another commit made later; the same commit or an older one isn't", () => {
  const local = { commit: "abc1234", builtAt: "2026-10-25T00:00:00Z" };
  assert.equal(isNewer({ commit: "def5678", builtAt: "2026-10-25T01:00:00Z" }, local), true);
  assert.equal(isNewer({ commit: "abc1234", builtAt: "2026-10-25T01:00:00Z" }, local), false);
  assert.equal(isNewer({ commit: "def5678", builtAt: "2026-10-24T01:00:00Z" }, local), false, "never back to an older build");
  assert.equal(isNewer({ commit: "not a commit; rm -rf /", builtAt: "2026-10-26T00:00:00Z" }, local), false);
  assert.equal(isNewer({ commit: "def5678" }, {}), true, "a build that doesn't know its commit takes the release's");
});

test("the app bundle is found from the running executable", () => {
  assert.equal(bundleOf("/Applications/Morse.app/Contents/MacOS/Morse"), "/Applications/Morse.app");
  assert.equal(bundleOf("/opt/morse/Morse"), null);
});

function fakeRelease(files) {
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    const name = url.slice(RELEASE.length + 1);
    if (!(name in files)) return { ok: false, status: 404 };
    const body = Buffer.from(files[name]);
    return { ok: true, status: 200, text: async () => body.toString(), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  return { fetchImpl, asked };
}

function setup(files, { local = { commit: "abc1234", builtAt: "2026-10-25T00:00:00Z", version: "0.3.1" }, packaged = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-updater-"));
  writeFileSync(path.join(dir, "build-info.json"), JSON.stringify(local));
  const { fetchImpl, asked } = fakeRelease(files);
  const app = { isPackaged: packaged, getPath: () => path.join(dir, "userData"), exit() { throw new Error("must not install while busy"); } };
  const statuses = [];
  const updater = createUpdater({ app, fetchImpl, here: dir, busy: () => true, onStatus: s => statuses.push(s.phase) });
  return { updater, asked, dir, statuses, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const asset = assetFor();

test("a newer build is downloaded, checked against SHA256SUMS and kept for a quiet moment", { skip: !asset }, async () => {
  const data = "new morse";
  const sum = createHash("sha256").update(data).digest("hex");
  const { updater, dir, statuses, done } = setup({
    "build.json": JSON.stringify({ commit: "def5678", builtAt: "2026-10-25T02:00:00Z" }),
    "SHA256SUMS": `${sum}  ${asset}\n`,
    [asset]: data,
  });
  try {
    assert.equal(await updater.check(), "ready");
    assert.equal(updater.ready, true);
    assert.deepEqual([...new Set(statuses)], ["downloading", "ready"], "the window shows the download, then asks (an app is connected)");
    assert.equal(updater.later(), true);
    assert.equal(updater.status.phase, "later", "Later: it installs when Morse quits");
    assert.equal(readFileSync(path.join(dir, "userData", "updates", asset), "utf8"), data);
  } finally { done(); }
});

test("a file that doesn't match SHA256SUMS is never kept; the same build is left alone", { skip: !asset }, async () => {
  const bad = setup({
    "build.json": JSON.stringify({ commit: "def5678", builtAt: "2026-10-25T02:00:00Z" }),
    "SHA256SUMS": `${"0".repeat(64)}  ${asset}\n`,
    [asset]: "tampered",
  });
  try {
    assert.equal(await bad.updater.check(), "mismatch");
    assert.equal(bad.updater.ready, false);
    assert.equal(existsSync(path.join(bad.dir, "userData", "updates", asset)), false);
  } finally { bad.done(); }
  const same = setup({ "build.json": JSON.stringify({ commit: "abc1234", builtAt: "2026-10-25T00:00:00Z" }) });
  try {
    assert.equal(await same.updater.check(), "current");
    assert.equal(same.asked.length, 1, "only build.json is read when nothing is new");
  } finally { same.done(); }
});

test("a build run from a clone (not packaged) never updates itself", async () => {
  const app = { isPackaged: false, getPath: () => os.tmpdir() };
  const u = createUpdater({ app, fetchImpl: async () => { throw new Error("no network"); } });
  assert.equal(await u.check(), "off");
});

test("a version is shown only when it is a version", () => {
  assert.equal(versionOf({ version: "v0.3.1" }), "0.3.1");
  assert.equal(versionOf({ version: "0.3.1-beta.1" }), "0.3.1-beta.1");
  assert.equal(versionOf({ version: "<script>" }), "");
  assert.equal(versionOf({ version: "0.3.1\nmore" }), "");
  assert.equal(versionOf(null), "");
});

test("Check for updates says up to date, that an update is published, or that the check failed", async () => {
  const current = setup({ "build.json": JSON.stringify({ commit: "abc1234", builtAt: "2026-10-25T00:00:00Z", version: "v0.3.1" }) });
  try {
    assert.equal(await current.updater.check({ user: true }), "current");
    assert.equal(current.updater.status.phase, "current");
    assert.equal(current.updater.status.version, "0.3.1");
    assert.deepEqual(current.statuses, ["checking", "current"], "the button shows that it is looking, then the result");
    assert.equal(current.asked.length, 1, "a click reads the release");
  } finally { current.done(); }

  const newer = setup({ "build.json": JSON.stringify({ commit: "def5678", builtAt: "2026-10-26T00:00:00Z", version: "0.4.0" }) }, { packaged: false });
  try {
    assert.equal(await newer.updater.check({ user: true }), "available");
    assert.equal(newer.updater.status.phase, "available");
    assert.equal(newer.updater.status.version, "0.4.0");
    assert.deepEqual(newer.asked, [`${RELEASE}/build.json`], "a clone reports the update and does not download it");
  } finally { newer.done(); }

  const bad = setup({ "build.json": "not json" });
  try {
    assert.equal(await bad.updater.check({ user: true }), "error");
    assert.equal(bad.updater.status.phase, "error");
    assert.equal(bad.updater.status.version, undefined, "a failed check names no version");
  } finally { bad.done(); }

  const askedOff = [];
  const off = createUpdater({
    app: { isPackaged: true, getPath: () => os.tmpdir() },
    env: { MORSE_NO_UPDATE: "1" },
    fetchImpl: async () => { askedOff.push(1); throw new Error("no network"); },
  });
  assert.equal(await off.check({ user: true }), "off");
  assert.equal(off.status.phase, "off");
  assert.equal(askedOff.length, 0, "updates turned off are not looked up");
});

test("an app opened from a disk image lands in the home Applications folder", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-dest-"));
  try {
    const home = path.join(dir, "home");
    const bundle = path.join(dir, "Applications", "Morse.app");
    mkdirSync(path.dirname(bundle));
    assert.equal(installDest(bundle, home), bundle, "a folder this user can change is replaced in place");
    assert.equal(
      installDest("/private/var/folders/xx/AppTranslocation/yy/d/Morse.app", home),
      path.join(home, "Applications", "Morse.app"),
    );
    assert.equal(installDest("/no/such/place/Morse.app", home), path.join(home, "Applications", "Morse.app"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the new copy takes the old one's place, and a failed swap puts the old one back", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-swap-"));
  try {
    const dest = path.join(dir, "Morse.app");
    const next = path.join(dir, "staged.app");
    mkdirSync(dest); writeFileSync(path.join(dest, "mark"), "old");
    mkdirSync(next); writeFileSync(path.join(next, "mark"), "new");
    const old = swapInPlace(dest, next);
    assert.equal(readFileSync(path.join(dest, "mark"), "utf8"), "new");
    assert.equal(readFileSync(path.join(old, "mark"), "utf8"), "old");
    assert.equal(existsSync(next), false);

    mkdirSync(path.join(dir, "again.app")); writeFileSync(path.join(dir, "again.app", "mark"), "keep");
    assert.throws(() => swapInPlace(path.join(dir, "again.app"), path.join(dir, "missing")));
    assert.equal(readFileSync(path.join(dir, "again.app", "mark"), "utf8"), "keep", "a failed swap leaves the app that was running");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failed install of this build is not downloaded again on its own", { skip: !asset }, async () => {
  const data = "new morse";
  const sum = createHash("sha256").update(data).digest("hex");
  const ctx = setup({
    "build.json": JSON.stringify({ commit: "def5678", builtAt: "2026-10-25T02:00:00Z" }),
    "SHA256SUMS": `${sum}  ${asset}\n`,
    [asset]: data,
  });
  try {
    const updates = path.join(ctx.dir, "userData", "updates");
    mkdirSync(updates, { recursive: true });
    writeFileSync(path.join(updates, "attempt.json"), JSON.stringify({ commit: "def5678", at: Date.now() }));
    assert.equal(await ctx.updater.check(), "failed");
    assert.equal(ctx.updater.status.phase, "failed");
    assert.deepEqual(ctx.asked, [`${RELEASE}/build.json`], "the same build is not downloaded again");
    assert.equal(await ctx.updater.check({ user: true }), "ready", "a click can try once more");
  } finally { ctx.done(); }
});

function hasBash() {
  try { execFileSync("bash", ["-c", "exit 0"], { stdio: "ignore" }); return true; } catch { return false; }
}

test("the relaunch script opens the new app only after this one has quit, and only if it is there", { skip: !hasBash() }, () => {
  for (const script of [macRelaunchScript, linuxSwapScript]) {
    execFileSync("bash", ["-n"], { input: script, stdio: ["pipe", "ignore", "pipe"] });
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-relaunch-"));
  try {
    const dest = path.join(dir, "Morse.app");
    const old = path.join(dir, "Morse.app.old");
    mkdirSync(dest); mkdirSync(old);
    const openLog = path.join(dir, "opened");
    const openBin = path.join(dir, "open");
    writeFileSync(openBin, `#!/bin/sh\necho "$@" > "${openLog}"\n`);
    chmodSync(openBin, 0o755);
    const dead = execFileSync("bash", ["-c", "echo $$"], { encoding: "utf8" }).trim();
    const env = {
      PATH: `${dir}:/usr/bin:/bin`,
      HOME: dir,
      MORSE_PID: dead,
      MORSE_DEST: dest,
      MORSE_OLD: old,
      MORSE_RELAUNCH: "1",
      MORSE_LOG: path.join(dir, "install.log"),
      MORSE_UPDATE_INNER: "1",
    };
    execFileSync("bash", ["-c", macRelaunchScript], { env, timeout: 5000 });
    assert.equal(existsSync(old), false, "the old copy is removed once this one has quit");
    assert.match(readFileSync(openLog, "utf8"), /Morse\.app/);

    rmSync(openLog, { force: true });
    execFileSync("bash", ["-c", macRelaunchScript], { env: { ...env, MORSE_DEST: path.join(dir, "missing.app"), MORSE_OLD: "" }, timeout: 5000 });
    assert.equal(existsSync(openLog), false, "a swap that left nothing is not opened");

    const half = path.join(dir, "Half.app");
    const halfNext = path.join(dir, "Half.app.next");
    mkdirSync(half); writeFileSync(path.join(half, "mark"), "old");
    mkdirSync(halfNext); writeFileSync(path.join(halfNext, "mark"), "new");
    const cancel = path.join(dir, "cancel");
    writeFileSync(cancel, "1");
    execFileSync("bash", ["-c", macRelaunchScript], { env: { ...env, MORSE_DEST: half, MORSE_NEXT: halfNext, MORSE_OLD: `${half}.old`, MORSE_CANCEL: cancel }, timeout: 5000 });
    assert.equal(readFileSync(path.join(half, "mark"), "utf8"), "old", "a cancelled try leaves the app that was running");
    assert.equal(existsSync(openLog), false);
    rmSync(cancel);
    execFileSync("bash", ["-c", macRelaunchScript], { env: { ...env, MORSE_DEST: half, MORSE_NEXT: halfNext, MORSE_OLD: `${half}.old`, MORSE_CANCEL: cancel }, timeout: 5000 });
    assert.equal(readFileSync(path.join(half, "mark"), "utf8"), "new", "a swap this process didn't finish is finished after it quits");
    assert.match(readFileSync(openLog, "utf8"), /Half\.app/);
    rmSync(openLog, { force: true });

    const scriptPath = path.join(dir, "install.sh");
    writeFileSync(scriptPath, macRelaunchScript, { mode: 0o755 });
    const started = Date.now();
    try {
      execFileSync("bash", [scriptPath], {
        env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, MORSE_PID: String(process.pid), MORSE_DEST: dest, MORSE_RELAUNCH: "1", MORSE_LOG: path.join(dir, "install.log") },
        timeout: 3000,
      });
      assert.ok(Date.now() - started < 2000, "the shell Morse starts returns without waiting for it to quit");
      assert.equal(existsSync(openLog), false, "that shell does not open the app itself");
    } finally {
      const ps = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
      for (const line of ps.split("\n")) {
        if (!line.includes(scriptPath)) continue;
        const pid = Number(line.trim().split(/\s+/)[0]);
        if (pid && pid !== process.pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
