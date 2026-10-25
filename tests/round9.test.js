// Bug and security hunt, round 9: Morse Desktop (the debugging port Morse
// connects to, the switches it passes, open at login, Chrome asking to
// connect), its release workflow, and Try it here. Each test failed before
// its fix.
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { spawn } from "node:child_process";

import * as ports from "../daemon/ports.js";
import { connectApp } from "../daemon/desktop.js";
import { desktopEntry } from "../desktop-app/linux.js";
import { createService } from "../desktop-app/service.js";

void home;
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => {}); });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LINUX = process.platform === "linux";

// ======================================================================
// The debugging port: someone else's program on it
// ======================================================================

// /proc/net/tcp as Linux writes it: 127.0.0.1:9333 (0x2475) listening, held by uid 1001.
const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:2475 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 4242 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1D21 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4243 1 0000000000000000 100 0 0 10 0
   2: 0100007F:2475 0100007F:D3C2 01 00000000:00000000 00:00000000 00000000  1000        0 4244 1 0000000000000000 20 4 30 10 -1
`;
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:2476 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 5555 1 0000000000000000 100 0 0 10 0
`;
const fakeProc = { platform: "linux", read: f => ({ "/proc/net/tcp": TCP, "/proc/net/tcp6": TCP6 })[f] ?? (() => { throw new Error("ENOENT"); })() };

test("Linux: who holds a listening port is read from /proc/net/tcp and tcp6, so another account's program on the debugging port is found", () => {
  assert.deepEqual(ports.listenerUids(9333, fakeProc), [1001], "the listener, not the connection to it");
  assert.deepEqual(ports.listenerUids(7457, fakeProc), [1000]);
  assert.deepEqual(ports.listenerUids(9334, fakeProc), [1002], "IPv6 too");
  assert.deepEqual(ports.listenerUids(9399, fakeProc), []);
  assert.equal(ports.listenerUids(9333, { platform: "darwin" }), null, "macOS and Windows: Morse can't tell this way");
  assert.equal(ports.portIsMine(9333, { ...fakeProc, uid: 1000 }), false, "another account's program");
  assert.equal(ports.portIsMine(7457, { ...fakeProc, uid: 1000 }), true);
  assert.equal(ports.portIsMine(9399, { ...fakeProc, uid: 1000 }), null, "nothing listed: can't tell");
  assert.equal(ports.portIsMine(9333, { platform: "win32", uid: 1000 }), null);
});

test("Linux: a port this process listens on is its own", { skip: !LINUX }, async () => {
  const srv = http.createServer().listen(0, "127.0.0.1");
  await new Promise(r => srv.on("listening", r));
  cleanups.push(() => new Promise(r => srv.close(r)));
  assert.equal(ports.portIsMine(srv.address().port), true);
});

// A stand-in app: node under another name, serving /json/version on its
// --remote-debugging-port like an Electron app.
async function fakeAppOnPort() {
  const dir = tempDir("morse-round9-app-");
  const exe = path.join(dir, "fakeapp");
  symlinkSync(process.execPath, exe);
  const script = path.join(dir, "server.mjs");
  writeFileSync(script, `import http from "node:http";
const port = Number(process.argv.find(a => a.startsWith("--remote-debugging-port=")).split("=")[1]);
http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ Browser: "Chrome/140.0.0.0", "User-Agent": "Mozilla/5.0 FakeApp/1.0 Chrome/140.0.0.0 Electron/38.0.0" })); }).listen(port, "127.0.0.1");
`);
  const free = http.createServer().listen(0, "127.0.0.1");
  await new Promise(r => free.on("listening", r));
  const port = free.address().port;
  await new Promise(r => free.close(r));
  const proc = spawn(exe, [script, `--remote-debugging-port=${port}`], { stdio: "ignore" });
  cleanups.push(async () => proc.kill("SIGKILL"));
  for (let i = 0; i < 100 && !(await ports.portAnswers(port)); i++) await new Promise(r => setTimeout(r, 50));
  return { app: { id: "fakeapp", name: "Fake App", exe, path: exe, engine: "electron" }, port };
}

test("Morse won't connect to a debugging port another account on this computer holds, even when it answers as the app", { skip: !LINUX, timeout: 30000 }, async () => {
  const { app, port } = await fakeAppOnPort();
  const ready = await connectApp(app, { mine: () => true });
  assert.equal(ready.port, port, "the app's own port, found open");
  assert.equal((await ready.verify()).ok, true);
  await assert.rejects(connectApp(app, { mine: () => false }), e => {
    assert.match(e.message, /another account/i);
    assert.match(e.message, new RegExp(String(port)));
    return true;
  });
  // After a restart (morse launch --watch), the same check before connecting again.
  const later = await connectApp(app, { mine: (() => { let n = 0; return () => ++n === 1; })() });
  const v = await later.verify();
  assert.equal(v.ok, false);
  assert.match(v.why, /another account/i);
});

// ======================================================================
// Switches that would open the debugging port wider
// ======================================================================

test("switches that widen who can reach the debugging port are dropped however they're spelled (one dash, a slash, capitals)", () => {
  const widen = [
    "-remote-debugging-address=0.0.0.0", "-remote-allow-origins=*", "--Remote-Allow-Origins=*", "--REMOTE-DEBUGGING-ADDRESS=0.0.0.0",
    "/remote-debugging-address=0.0.0.0", "/remote-allow-origins=*", "-remote-debugging-port=9222", "--remote-debugging-pipe",
  ];
  assert.deepEqual(ports.safeExtraArgs([...widen, "--user-data-dir=/x", "-v", "/home/sam/file.txt", "--remote-something-else"]), ["--user-data-dir=/x", "-v", "/home/sam/file.txt", "--remote-something-else"]);
});

// ======================================================================
// Open at login (Linux): the desktop file Morse writes for itself
// ======================================================================

test("Linux desktop files: a line break in Morse's path can't add a line, and % reaches the program as %", () => {
  assert.throws(() => desktopEntry({ exec: "/home/sam/Morse\nExec=/tmp/evil.AppImage" }), /path/i);
  assert.throws(() => desktopEntry({ exec: "/x/morse", args: ["a\rb"] }), /path/i);
  const e = desktopEntry({ exec: "/home/sam/100%/Morse.AppImage", url: true });
  assert.match(e, /^Exec="\/home\/sam\/100%%\/Morse\.AppImage" %u$/m, "%% in an Exec line is one %; a lone % is a field code");
  assert.equal(e.split("\n").filter(l => l.startsWith("Exec=")).length, 1);
});

// ======================================================================
// Chrome asking to connect (createBridge's ask)
// ======================================================================

test("release-desktop.yml: actions pinned to a commit, the write token only in the job that drafts the release, no token left in the checkout", () => {
  const yml = readFileSync(path.join(ROOT, ".github", "workflows", "release-desktop.yml"), "utf8");
  const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map(m => m[1]);
  assert.ok(uses.length >= 4);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u} is pinned to a commit, not a tag that can move`);
  const top = yml.slice(0, yml.indexOf("\njobs:"));
  assert.match(top, /permissions:\s*\n\s*contents:\s*read/, "jobs read by default");
  const jobs = yml.slice(yml.indexOf("\njobs:"));
  const build = jobs.slice(0, jobs.indexOf("\n  release:"));
  const release = jobs.slice(jobs.indexOf("\n  release:"));
  assert.doesNotMatch(build, /contents:\s*write/, "the build runs npm packages' install scripts: no write token there");
  assert.match(release, /permissions:\s*\n\s*contents:\s*write/);
  assert.match(build, /persist-credentials:\s*false/, "checkout doesn't leave the token in .git/config for later steps");
});

// ======================================================================
// Try it here
// ======================================================================

test("Try it here: a stored app name that isn't one of the demo apps (toString, constructor) falls back to the music app", async () => {
  const { knownApp } = await import("../site/try/try.js");
  assert.equal(knownApp("byte"), "byte");
  for (const bad of ["toString", "constructor", "__proto__", "hasOwnProperty", "", null, undefined, 3]) assert.equal(knownApp(bad), "tunes", String(bad));
});
