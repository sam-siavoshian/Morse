// Morse Desktop updates itself from the preview release (desktop-app/updater.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assetFor, parseSums, isNewer, bundleOf, createUpdater, RELEASE } from "../desktop-app/updater.js";

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
  assert.equal(bundleOf("/Applications/Morse.app/Contents/MacOS/morse-desktop"), "/Applications/Morse.app");
  assert.equal(bundleOf("/opt/morse/morse-desktop"), null);
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

function setup(files, { local = { commit: "abc1234", builtAt: "2026-10-25T00:00:00Z" } } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-updater-"));
  writeFileSync(path.join(dir, "build-info.json"), JSON.stringify(local));
  const { fetchImpl, asked } = fakeRelease(files);
  const app = { isPackaged: true, getPath: () => path.join(dir, "userData"), exit() { throw new Error("must not install while busy"); } };
  const updater = createUpdater({ app, fetchImpl, here: dir, busy: () => true });
  return { updater, asked, dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const asset = assetFor();

test("a newer build is downloaded, checked against SHA256SUMS and kept for a quiet moment", { skip: !asset }, async () => {
  const data = "new morse";
  const sum = createHash("sha256").update(data).digest("hex");
  const { updater, dir, done } = setup({
    "build.json": JSON.stringify({ commit: "def5678", builtAt: "2026-10-25T02:00:00Z" }),
    "SHA256SUMS": `${sum}  ${asset}\n`,
    [asset]: data,
  });
  try {
    assert.equal(await updater.check(), "ready");
    assert.equal(updater.ready, true);
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
