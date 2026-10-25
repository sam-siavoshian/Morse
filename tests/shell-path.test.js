// The packaged Mac/Linux app is started with the system's bare PATH: it adds the
// login shell's and the usual install folders, so Claude Code and node are found.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import { fullPath, commonBinDirs, loginShellPath } from "../desktop-app/shell-path.js";

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
