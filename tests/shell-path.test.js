// The packaged Mac/Linux app is started with the system's bare PATH: it adds the
// login shell's and the usual install folders, so Claude Code and node are found.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import { fullPath, commonBinDirs, loginShellPath, startShellPath } from "../desktop-app/shell-path.js";

test("the PATH Morse starts with comes first, then the login shell's, then the usual folders, each once", () => {
  const p = fullPath({ current: "/usr/bin:/bin", shellPath: "/opt/homebrew/bin:/usr/bin:/Users/a/.local/bin", extra: ["/Users/a/.local/bin", "/Users/a/.claude/local"] });
  assert.equal(p, ["/usr/bin", "/bin", "/opt/homebrew/bin", "/Users/a/.local/bin", "/Users/a/.claude/local"].join(path.delimiter));
});

test("the usual folders: only those that exist, newest nvm Node first", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "morse-shellpath-"));
  try {
    for (const d of [".claude/local", ".nvm/versions/node/v20.9.0/bin", ".nvm/versions/node/v22.11.0/bin"]) mkdirSync(path.join(home, d), { recursive: true });
    const dirs = commonBinDirs(home).filter(d => d.startsWith(home));
    assert.deepEqual(dirs, [path.join(home, ".claude/local"), path.join(home, ".nvm/versions/node/v22.11.0/bin"), path.join(home, ".nvm/versions/node/v20.9.0/bin")]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a login shell's PATH is read, and a shell that fails gives nothing", { skip: process.platform === "win32" }, () => {
  assert.ok(loginShellPath({ shell: "/bin/sh" }).includes("/"));
  assert.equal(loginShellPath({ shell: "/nonexistent/shell" }), "");
});

test("fullPath does not spawn a shell when no shell path is given", () => {
  assert.equal(fullPath({ current: "/bin", shellPath: "", extra: [] }), "/bin");
});

test("an unpackaged run and Windows do not probe the login shell", async () => {
  const env = { PATH: "/usr/bin" };
  let probes = 0;
  const probe = async () => { probes++; return "/opt/bin"; };
  await startShellPath({ packaged: false, platform: "darwin", env, probe, extra: [] });
  await startShellPath({ packaged: true, platform: "win32", env, probe, extra: [] });
  assert.equal(probes, 0);
  assert.equal(env.PATH, "/usr/bin");
});

test("a cached PATH is merged immediately; the probe refreshes it in the background", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-shellpath-cache-"));
  try {
    const cacheFile = path.join(dir, "shell-path.json");
    writeFileSync(cacheFile, JSON.stringify({ path: "/cached/bin", at: 1 }));
    const env = { PATH: "/usr/bin" };
    let release;
    const gate = new Promise(r => { release = r; });
    const pending = startShellPath({
      packaged: true, platform: "linux", cacheFile, env, extra: [],
      probe: () => gate.then(() => "/fresh/bin"),
    });
    await pending;
    assert.ok(env.PATH.split(path.delimiter).includes("/cached/bin"), env.PATH);
    assert.ok(env.PATH.startsWith("/usr/bin"), env.PATH);
    release();
    await new Promise(r => setTimeout(r, 30));
    assert.ok(env.PATH.split(path.delimiter).includes("/fresh/bin"), env.PATH);
    assert.equal(JSON.parse(readFileSync(cacheFile, "utf8")).path, "/fresh/bin");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the first launch waits for the probe before model detection may proceed", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "morse-shellpath-cold-"));
  try {
    const cacheFile = path.join(dir, "shell-path.json");
    const env = { PATH: "/usr/bin" };
    let release;
    const gate = new Promise(r => { release = r; });
    let done = false;
    const pending = startShellPath({
      packaged: true, platform: "linux", cacheFile, env, extra: [],
      probe: () => gate.then(() => "/fresh/bin"),
    }).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(done, false, "no cache: callers that need PATH stay gated");
    assert.equal(env.PATH, "/usr/bin");
    release();
    await pending;
    assert.ok(env.PATH.split(path.delimiter).includes("/fresh/bin"), env.PATH);
    assert.ok(env.PATH.startsWith("/usr/bin"), env.PATH);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
