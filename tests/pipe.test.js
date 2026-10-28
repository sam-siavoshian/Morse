// The private pipe (--remote-debugging-pipe, daemon/cdp.js): CDP as JSON plus
// a null byte over the app's file descriptors 3 and 4, so no debugging port
// is open for other programs. Here without Electron: the framing, one
// connection carrying many targets, what ends a session and the connection,
// which apps get the pipe, the launch with a stand-in app
// (tests/helpers/fake-pipe-app.js) that checks the descriptors it gets and
// keeps running when Morse lets go or is killed, the fallback to a port, the
// connector attaching over it, and --watch asking the waiting Morse to open
// the app again. The real Electron app is in tests/electron.test.js.
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import { waitFor } from "./helpers/wait.js";

const cdp = await import("../daemon/cdp.js");
const apps = await import("../daemon/apps.js");
const desktop = await import("../daemon/desktop.js");
const status = await import("../daemon/status.js");
const ports = await import("../daemon/ports.js");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FAKE = path.join(root, "tests", "helpers", "fake-pipe-app.js");
const until = (fn, ms, what) => waitFor(fn, { timeout: ms, interval: 50, what });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const posix = process.platform !== "win32";
const kids = [];
after(() => { for (const pid of kids) try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } });

// The stand-in app as Morse would find it: an executable file, so launchApp
// runs it as it runs an app (#! names this Node).
async function fakeApp(dir) {
  const exe = path.join(dir, "fake-app");
  await fs.writeFile(exe, `#!${process.execPath}\nawait import(${JSON.stringify(new URL(`file://${FAKE}`).href)});\n`, { mode: 0o755 });
  return { id: "fakeapp", name: "Fake App", exe, path: exe, engine: "electron", electron: "40.1.0" };
}
const lines = file => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];

// ---------------------------------------------------------------- framing

test("framing: a null byte ends each message; chunks split anywhere, even inside a character", () => {
  assert.equal(cdp.frame({ id: 1, method: "Browser.getVersion" }), '{"id":1,"method":"Browser.getVersion"}\0');
  const u = new cdp.Unframer();
  const bytes = Buffer.from(cdp.frame({ id: 1, result: { title: "Café ☕" } }) + cdp.frame({ method: "X.y", params: {} }) + "not json\0" + '{"id":2');
  const got = [];
  // One byte at a time: splits inside "é" and "☕".
  for (let i = 0; i < bytes.length; i++) got.push(...u.push(bytes.subarray(i, i + 1)));
  assert.deepEqual(got, [{ id: 1, result: { title: "Café ☕" } }, { method: "X.y", params: {} }], "a broken message is skipped, a partial one waits");
  assert.deepEqual(u.push(Buffer.from(',"result":{}}\0')), [{ id: 2, result: {} }]);
});

test("a command with no answer fails fast, and a late answer is ignored", async () => {
  const { conn, answer } = wired();
  const t0 = Date.now();
  await assert.rejects(conn.root.send("Browser.getVersion", {}, { timeoutMs: 40 }), e => e.timeout === true && /timed out/.test(e.message));
  assert.ok(Date.now() - t0 < 1000);
  answer({ id: 1, result: { product: "late" } });
  const next = conn.root.send("Browser.getVersion", {}, { timeoutMs: 1000 });
  answer({ id: 2, result: { product: "Chrome/1" } });
  assert.deepEqual(await next, { product: "Chrome/1" });
});

test("TargetInfo becomes /json/list's shape: id, parentId from the frame it sits in, openerId", () => {
  assert.deepEqual(cdp.listEntry({ targetId: "F", type: "iframe", title: "", url: "https://x.test/", parentFrameId: "W", attached: false, browserContextId: "C" }),
    { id: "F", type: "iframe", title: "", url: "https://x.test/", parentId: "W", browserContextId: "C" });
  assert.deepEqual(cdp.listEntry({ targetId: "P", type: "page", title: "Compose", url: "https://x.test/c", openerId: "W" }),
    { id: "P", type: "page", title: "Compose", url: "https://x.test/c", openerId: "W" });
});

// ---------------------------------------------------------------- one connection, many targets

// A PipeConnection over in-memory streams, with the app's side scripted.
function wired() {
  const toApp = new PassThrough(), fromApp = new PassThrough();
  const conn = new cdp.PipeConnection(toApp, fromApp);
  const sent = [];
  const u = new cdp.Unframer();
  toApp.on("data", d => sent.push(...u.push(d)));
  const answer = msg => fromApp.write(cdp.frame(msg));
  return { conn, sent, answer, fromApp, toApp };
}

test("one pipe, many targets: answers and events reach the session they belong to, ids never repeat", async () => {
  const { conn, sent, answer } = wired();
  const b = cdp.pipeBrowser(conn);
  const listing = b.listTargets();
  await until(() => sent.length === 1, 2000, "Target.getTargets");
  assert.deepEqual(sent[0], { id: 1, method: "Target.getTargets", params: {} });
  answer({ id: 1, result: { targetInfos: [{ targetId: "W", type: "page", title: "Main", url: "app://x/" }] } });
  assert.deepEqual(await listing, [{ id: "W", type: "page", title: "Main", url: "app://x/" }]);

  const attaching = b.connect({ id: "W" });
  await until(() => sent.length === 2, 2000, "attachToTarget");
  assert.deepEqual(sent[1].params, { targetId: "W", flatten: true }, "flat sessions: one connection for every target");
  answer({ method: "Target.attachedToTarget", params: { sessionId: "S1", targetInfo: {} } });
  answer({ id: 2, result: { sessionId: "S1" } });
  const s = await attaching;
  const events = [];
  s.on("Runtime.executionContextCreated", p => events.push(p));
  const evaluating = s.send("Runtime.evaluate", { expression: "1" });
  await until(() => sent.length === 3, 2000, "evaluate");
  assert.equal(sent[2].sessionId, "S1");
  assert.equal(sent[2].id, 3, "ids count across the whole connection");
  answer({ method: "Runtime.executionContextCreated", params: { context: { id: 7 } }, sessionId: "S1" });
  answer({ method: "Runtime.executionContextCreated", params: { context: { id: 8 } }, sessionId: "S-other" });
  answer({ id: 3, result: { result: { value: 1 } }, sessionId: "S1" });
  assert.deepEqual(await evaluating, { result: { value: 1 } });
  assert.deepEqual(events, [{ context: { id: 7 } }], "an event for another session isn't this one's");
  const failing = s.send("Page.navigate", {});
  await until(() => sent.length === 4, 2000, "navigate");
  answer({ id: 4, error: { message: "No" }, sessionId: "S1" });
  await assert.rejects(failing, /Page\.navigate: No/);
});

test("a target that goes away ends its session only; closing a session detaches it; the app quitting ends everything", async () => {
  const { conn, sent, answer, fromApp } = wired();
  const a = conn.session("A"), b = conn.session("B");
  let aClosed = 0, bClosed = 0, connClosed = 0;
  a.on("close", () => aClosed++);
  b.on("close", () => bClosed++);
  conn.on("close", () => connClosed++);
  const waiting = a.send("Runtime.evaluate", {});
  answer({ method: "Target.detachedFromTarget", params: { sessionId: "A" } });
  await assert.rejects(waiting, /CDP session closed/);
  assert.equal(aClosed, 1);
  assert.equal(a.closed, true);
  assert.equal(bClosed, 0, "the other target carries on");
  await assert.rejects(a.send("Runtime.evaluate", {}), /CDP session closed/);

  b.close();
  await until(() => sent.some(m => m.method === "Target.detachFromTarget"), 2000, "detachFromTarget");
  assert.deepEqual(sent.find(m => m.method === "Target.detachFromTarget").params, { sessionId: "B" });
  assert.equal(bClosed, 1, "close is reported once");
  b.close();
  assert.equal(bClosed, 1);

  const c = conn.session("C");
  const pending = c.send("Runtime.evaluate", {});
  const root = conn.root.send("Target.getTargets");
  fromApp.end(); // the app quit
  await assert.rejects(pending, /CDP session closed/);
  await assert.rejects(root, /CDP session closed/);
  assert.equal(connClosed, 1);
  const err = await cdp.pipeBrowser(conn).listTargets().catch(e => e);
  assert.equal(err.code, "ECONNRESET", "the connector counts it like a port that stopped answering");
});

test("letting go: what Morse wrote goes out first, and the end Morse writes to is never shut down", async () => {
  const { conn, sent } = wired();
  let shutdown = false;
  conn.input.end = () => { shutdown = true; }; // end() would send the app an end of file
  conn.session("S").close();
  await conn.close();
  assert.equal(shutdown, false);
  assert.ok(sent.some(m => m.method === "Target.detachFromTarget"), "the detach went out before the pipe closed");
  assert.equal(conn.input.destroyed, true);
  assert.equal(conn.output.destroyed, true);
});

// ---------------------------------------------------------------- which apps

test("which apps get the pipe: Electron 10 and later started directly, not on Windows, not through a launcher; MORSE_PIPE=0 turns it off", () => {
  const app = { engine: "electron", exe: "/opt/Tunes/tunes" };
  const ok = (a, o = {}) => apps.pipeFor(a, { platform: "linux", env: {}, ...o }).ok;
  assert.equal(ok(app), true);
  assert.equal(ok({ ...app, electron: "45.0.0" }), true);
  assert.equal(ok({ ...app, electron: "10.0.0" }), true);
  assert.equal(ok({ ...app, electron: "9.4.4" }), false, "Electron 9 ignores the switch");
  assert.equal(ok({ ...app, appimage: true }), true, "an AppImage passes the descriptors on (tried with Obsidian and Joplin)");
  assert.equal(ok(app, { platform: "darwin" }), true);
  assert.equal(ok(app, { platform: "win32" }), false);
  assert.equal(ok({ ...app, flatpak: "md.obsidian.Obsidian" }), false);
  assert.equal(ok({ ...app, source: "snap" }), false);
  assert.equal(ok({ ...app, script: true }), false);
  assert.equal(ok({ ...app, exe: "C:\\X\\Update.exe" }), false);
  assert.equal(ok({ engine: "cef" }), false);
  assert.equal(ok({ engine: "electron", browser: true }), false);
  for (const v of ["0", "false", "off", "no"]) assert.equal(ok(app, { env: { MORSE_PIPE: v } }), false, v);
  assert.equal(ok(app, { env: { MORSE_PIPE: "1" } }), true);
});

test("the pipe's switch, and nobody else's: a --remote-debugging-pipe passed by hand is dropped like the port", () => {
  assert.deepEqual(apps.launchArgs({ id: "x" }, apps.PIPE, ["--remote-debugging-pipe", "-remote-debugging-port=1", "--x"]), ["--remote-debugging-pipe", "--x"]);
  assert.deepEqual(apps.launchArgs({ id: "x" }, 9333, ["--remote-debugging-pipe"]), ["--remote-debugging-port=9333"]);
  assert.deepEqual(ports.safeExtraArgs(["--remote-debugging-pipe=cbor"]), []);
});

// ---------------------------------------------------------------- a real launch, with a stand-in app

test("launch on the pipe: the app's fd 3 blocks, it answers, and it keeps running when Morse lets go", { skip: !posix && "POSIX descriptors" }, async () => {
  const dir = tempDir("morse-pipe-");
  const app = await fakeApp(dir);
  const log = path.join(dir, "log");
  const child = await apps.launchApp(app, apps.PIPE, [`--fake-log=${log}`]);
  kids.push(child.pid);
  const who = await cdp.identifyPipe(child.cdp, 10000);
  assert.deepEqual(who, { browser: "Chrome/140.0.0.0", userAgent: "Mozilla/5.0 Fake/1.0 Chrome/140.0.0.0 Electron/40.1.0 Safari/537.36", electron: "40.1.0", pid: child.pid });
  if (process.platform === "linux") {
    const flags = parseInt(lines(log).find(l => l.startsWith("flags "))?.slice(6), 8);
    assert.equal(flags & 0o4000, 0, "O_NONBLOCK is off: Chromium's reader takes EAGAIN for a closed pipe");
  }
  const b = cdp.pipeBrowser(child.cdp);
  assert.deepEqual((await b.listTargets()).map(t => `${t.type} ${t.id} ${t.parentId || ""}`), ["page W1 ", "iframe F1 W1"]);
  const s = await b.connect({ id: "W1" });
  assert.equal((await s.send("Runtime.evaluate", { expression: "document.title" })).result.value, "evaluated in W1: document.title");
  s.close();
  await child.cdp.close();
  await sleep(1500);
  assert.equal(alive(child.pid), true, "the app keeps running");
  assert.ok(lines(log).includes("got Target.detachFromTarget"));
  assert.ok(!lines(log).includes("eof"), "it never read an end of file: it holds a copy of the end Morse wrote to");
  process.kill(-child.pid, "SIGKILL");
});

test("Morse killed outright: the app it opened on the pipe keeps running", { skip: !posix && "POSIX descriptors" }, async () => {
  const dir = tempDir("morse-pipe-");
  const app = await fakeApp(dir);
  const log = path.join(dir, "log");
  const script = path.join(dir, "morse.mjs");
  await fs.writeFile(script, `
    const apps = await import(${JSON.stringify(new URL(`file://${root}/daemon/apps.js`).href)});
    const child = await apps.launchApp(${JSON.stringify(app)}, apps.PIPE, [${JSON.stringify(`--fake-log=${log}`)}]);
    await child.cdp.version(10000);
    console.log("app " + child.pid);
    setInterval(() => {}, 1000);
  `);
  const morse = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  morse.stdout.on("data", d => { out += d; });
  const pid = Number((await until(() => /app (\d+)/.exec(out), 15000, "the stand-in Morse to open the app"))[1]);
  kids.push(pid);
  morse.kill("SIGKILL");
  await new Promise(r => morse.once("exit", r));
  const seen = lines(log).length;
  await until(() => lines(log).length > seen + 1, 5000, "the app to go on after Morse was killed");
  assert.equal(alive(pid), true);
  assert.ok(!lines(log).includes("eof"));
  process.kill(-pid, "SIGKILL");
});

test("openOnPipe: an app that ignores the pipe is quit and Morse falls back to a port; one that dies says why", { skip: !posix && "POSIX descriptors" }, async () => {
  const dir = tempDir("morse-pipe-");
  const app = await fakeApp(dir);
  const said = [];
  let started = null;
  const launch = async (...a) => (started = await apps.launchApp(...a));
  const r = await desktop.openOnPipe(app, ["--fake-mode=ignore", `--fake-log=${path.join(dir, "ignore")}`], l => said.push(l), { timeoutMs: 1500, launch });
  assert.equal(r, null, "the caller opens it on a port instead");
  assert.match(said.join("\n"), /Fake App didn't answer on Morse's private connection\..*debugging port instead/);
  await until(() => !alive(started.pid), 10000, "the copy that ignored the pipe to be quit");

  await assert.rejects(desktop.openOnPipe(app, ["--fake-mode=die"], () => {}, { timeoutMs: 10000 }), e => e.failed && /Fake App quit right after it started \(exit code 3\)/.test(e.message));

  const ok = await desktop.openOnPipe(app, [`--fake-log=${path.join(dir, "ok")}`], () => {}, { timeoutMs: 10000 });
  kids.push(...ok.pids);
  assert.equal(ok.port, null);
  assert.equal(ok.browser.kind, "pipe");
  assert.equal(ok.verify, null, "nothing to check: only this process holds the other end");
  assert.equal(ok.who.electron, "40.1.0");
  await ok.browser.close();
  for (const pid of ok.pids) try { process.kill(-pid, "SIGKILL"); } catch {}
});

test("the connector over the pipe: attaches to the window and the app's own frame, notices a window closing, and stop() detaches and lets go", { skip: !posix && "POSIX descriptors" }, async () => {
  const dir = tempDir("morse-pipe-");
  const app = await fakeApp(dir);
  const log = path.join(dir, "log");
  const child = await apps.launchApp(app, apps.PIPE, [`--fake-log=${log}`]);
  kids.push(child.pid);
  await child.cdp.version(10000);
  const { Connector } = await import("../daemon/connector.js");
  const logs = [];
  const conn = new Connector({ browser: cdp.pipeBrowser(child.cdp), app: { id: "fakeapp", name: "Fake App" }, settings: { provider: "demo", model: "demo" }, log: l => logs.push(l), interval: 100 });
  assert.equal(conn.port, null);
  assert.equal(conn.transport, "pipe");
  const running = conn.run();
  await until(() => conn.windows.size === 2 && [...conn.windows.values()].every(w => w.ready), 10000, "the window and the frame");
  assert.deepEqual([...conn.windows.values()].map(w => w.kind).sort(), ["frame", "window"]);
  const got = lines(log);
  for (const m of ["Runtime.addBinding @S", "Page.addScriptToEvaluateOnNewDocument @S", "Runtime.enable @S"]) assert.ok(got.some(l => l.startsWith(`got ${m}`)), m);
  // The window closes (its target detaches): only that session ends.
  await child.cdp.root.send("Test.closeTarget");
  await until(() => !conn.windows.has("W1"), 5000, "the closed window to be dropped");
  assert.ok(conn.windows.has("F1"));
  await conn.stop();
  assert.equal(await running, "stopped");
  assert.ok(lines(log).filter(l => l === "got Target.detachFromTarget").length >= 1, "detached from what was left");
  assert.equal(child.cdp.closed, true, "Morse let go of its ends");
  await sleep(1200);
  assert.equal(alive(child.pid), true, "the app keeps running");
  assert.ok(!lines(log).includes("eof"));
  process.kill(-child.pid, "SIGKILL");
});

test("the connector notices the app quitting on the pipe: stopped, or waiting with --watch, and attaches again over a new pipe", { skip: !posix && "POSIX descriptors" }, async () => {
  const dir = tempDir("morse-pipe-");
  const app = await fakeApp(dir);
  const { Connector } = await import("../daemon/connector.js");
  const open = async () => {
    const child = await apps.launchApp(app, apps.PIPE, [`--fake-log=${path.join(dir, "log")}`]);
    kids.push(child.pid);
    await child.cdp.version(10000);
    return child;
  };
  // Without --watch: the session ends.
  let child = await open();
  const logs = [];
  const once = new Connector({ browser: cdp.pipeBrowser(child.cdp), app: { id: "fakeapp", name: "Fake App" }, settings: { provider: "demo" }, log: l => logs.push(l), interval: 100 });
  const ran = once.run();
  await until(() => once.windows.size === 2, 10000, "attached");
  process.kill(-child.pid, "SIGKILL");
  assert.equal(await ran, "stopped");
  assert.ok(logs.includes("Fake App closed, so Morse stopped."));

  // With --watch: waiting, says how to open it again, then a new pipe.
  child = await open();
  const watched = new Connector({ browser: cdp.pipeBrowser(child.cdp), app: { id: "fakeapp", name: "Fake App" }, settings: { provider: "demo" }, log: l => logs.push(l), interval: 100, watch: true });
  const running = watched.run();
  await until(() => watched.windows.size === 2, 10000, "attached");
  process.kill(-child.pid, "SIGKILL");
  await until(() => watched.state === "waiting", 10000, "waiting");
  assert.ok(logs.some(l => /Fake App closed\. Run morse launch fakeapp to open it again with Morse/.test(l)), logs.join("\n"));
  child = await open();
  watched.useBrowser(cdp.pipeBrowser(child.cdp));
  await until(() => watched.state === "attached" && watched.windows.size === 2, 10000, "attached again");
  assert.ok(logs.some(l => /Fake App is open again/.test(l)));
  await watched.stop();
  await running;
  process.kill(-child.pid, "SIGKILL");
});

test("--watch on the pipe: `morse launch` asks the waiting Morse to open the app; the request is taken once", async () => {
  await status.requestOpen("fakeapp", { restart: true, extra: ["--a", 3] });
  assert.ok(existsSync(path.join(home, "sessions", "fakeapp.open")));
  assert.deepEqual(status.takeOpenRequest("fakeapp"), { restart: true, extra: ["--a", "3"] });
  assert.equal(status.takeOpenRequest("fakeapp"), null);
  await status.requestOpen("fakeapp");
  status.removeSession("fakeapp");
  assert.equal(status.takeOpenRequest("fakeapp"), null, "a session's leftovers go with it");
});

test("startSession: a waiting session on the pipe opens the app again when asked, over a new pipe", { skip: !posix && "POSIX descriptors" }, async () => {
  const dir = tempDir("morse-pipe-");
  const app = await fakeApp(dir);
  const extra = [`--fake-log=${path.join(dir, "log")}`];
  const first = await desktop.openOnPipe(app, extra, () => {}, { timeoutMs: 10000 });
  kids.push(...first.pids);
  const logs = [];
  let asked = null;
  const reopen = async req => { asked = req; const r = await desktop.openOnPipe(app, extra, () => {}, { timeoutMs: 10000 }); kids.push(...r.pids); return r; };
  const s = desktop.startSession({ browser: first.browser, app, settings: { provider: "demo" }, who: first.who, watch: true, log: l => logs.push(l), reopen });
  await until(() => s.connector.windows.size === 2, 10000, "attached");
  const file = JSON.parse(await fs.readFile(path.join(home, "sessions", "fakeapp.json"), "utf8"));
  assert.equal(file.transport, "pipe");
  assert.equal(file.port, null);
  assert.match(status.formatStatus([file]).replace(/\x1b\[\d+m/g, ""), /private pipe \(no debugging port\)/);
  for (const pid of first.pids) try { process.kill(-pid, "SIGKILL"); } catch {}
  await until(() => s.connector.state === "waiting", 10000, "waiting");
  await status.requestOpen("fakeapp", { extra: [] });
  await until(() => s.connector.state === "attached" && s.connector.windows.size === 2, 15000, "attached to the app opened again");
  assert.deepEqual(asked, { restart: false, extra: [] });
  await s.stop();
  assert.equal(await s.done, "stopped");
});
