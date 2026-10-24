// Morse on a real Electron app: demo/electron-app ("Tunes") packaged on a real
// Electron runtime, opened with `morse launch` and used the way a person
// would: the Open Morse hotkey, pointing at the player, asking for a change
// (demo replay model), saving it, quitting the app, opening it again (the mod
// comes back), a second window and a <webview>, `morse status`, `morse stop`.
// Also: the same app packed as app.asar with its fuses locked down, an app
// that dies on start, and the fuse reader on the real binary.
//
// The Electron part needs an Electron runtime and a display, and skips with a
// message otherwise (see demo/electron-app/build.mjs for where it looks):
//   npm install --prefix ~/.cache/morse/electron electron
//   DISPLAY=:99 node --test tests/electron.test.js
// Input goes in as CDP Input events (trusted events, delivered to the app's
// window even when another program has the keyboard on a shared display);
// demo/shoot-electron.js drives the same flow with real X input (xdotool).
//
// The tests at the top need no Electron: they cover what the real app turned up.
import { tempDir } from "./helpers/home.js"; // first: a MORSE_HOME of its own, and temp folders removed at exit
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const home = tempDir("morse-electron-test-");
process.env.MORSE_HOME = home;
const apps = await import("../daemon/apps.js");
const { inspectFuses, fuseVerdict, formatFuses } = await import("../daemon/fuses.js");
const { CDPSession, listTargets } = await import("../daemon/cdp.js");
const { findElectron, electronVersion, buildTunes, setFuses, packAsar } = await import("../demo/electron-app/build.mjs");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}
const put = async (file, data = "") => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); };

// ---------------------------------------------------------------- no Electron needed

test("an unpacked Electron app in /opt is found and named from its package.json, not its runtime's files", async () => {
  const r = tempDir("morse-opt-");
  // What build.mjs makes: the runtime renamed to the app, the app in resources/app/.
  await put(path.join(r, "opt/Tunes/tunes"), "\x7fELF");
  await put(path.join(r, "opt/Tunes/libvulkan.so.1"), "\x7fELF");
  await put(path.join(r, "opt/Tunes/version"), "45.0.0");
  await put(path.join(r, "opt/Tunes/resources/app/package.json"), JSON.stringify({ name: "tunes", productName: "Tunes", version: "1.4.2" }));
  // A packed one whose folder and binary are named differently from the app.
  await put(path.join(r, "opt/acme-chat/acme-chat"), "\x7fELF");
  const src = path.join(r, "src");
  await put(path.join(src, "package.json"), JSON.stringify({ name: "acme-chat", productName: "Acme Chat", version: "3.1.0" }));
  await put(path.join(src, "dist/main.js"), "// main");
  await packAsar(src, path.join(r, "opt/acme-chat/resources/app.asar"));
  const ctx = apps.hostContext({ platform: "linux", root: r, home: "/home/sam", env: { PATH: "" } });
  const found = Object.fromEntries(apps.discoverApps(ctx).map(a => [a.id, a]));
  assert.equal(found.tunes?.name, "Tunes", "resources/app/ counts as an Electron app (it was missed before)");
  assert.equal(found.tunes.exe, "/opt/Tunes/tunes", "the app's binary, not libvulkan.so.1");
  assert.equal(found.tunes.version, "1.4.2");
  assert.equal(found.tunes.electron, "45.0.0");
  assert.equal(found["acme-chat"]?.name, "Acme Chat", "productName read from inside app.asar");
  assert.equal(found["acme-chat"].version, "3.1.0");
  // By path, too: named Tunes, and the file name still finds it.
  const byPath = apps.appFromPath(ctx, "/opt/Tunes/tunes");
  assert.equal(byPath.name, "Tunes");
  assert.equal(byPath.id, "tunes");
  assert.deepEqual(byPath.aliases, ["tunes"]);
  assert.equal(apps.matchApp("tun", [byPath]).app?.name, "Tunes");
});

test("app.asar: only the header and package.json are read, and Electron's own default app has no name", async () => {
  const r = tempDir("morse-asar-");
  const src = path.join(r, "src");
  await put(path.join(src, "big.bin"), Buffer.alloc(2 << 20));
  await put(path.join(src, "package.json"), JSON.stringify({ name: "electron", productName: "Electron", version: "1.0.0" }));
  await packAsar(src, path.join(r, "app/resources/app.asar"));
  const reads = [];
  const ctx = apps.hostContext({ platform: "linux" });
  const spy = { ...ctx, readRange: (p, s, n) => { reads.push(n); return ctx.readRange(p, s, n); } };
  assert.deepEqual(apps.appPackage(spy, path.join(r, "app")), { name: null, version: "1.0.0" }, "\"Electron\" is the runtime's name, not the app's");
  assert.ok(reads.every(n => n < 4096), `read ${reads.join(", ")} bytes, not the archive`);
  assert.deepEqual(apps.appPackage(ctx, path.join(r, "nothing")), { name: null, version: null });
});

test("an app that dies on start says why instead of waiting for a port that never opens", async () => {
  const app = { id: "tunes", name: "Tunes", engine: "electron", exe: "/opt/Tunes/tunes" };
  const asRoot = apps.launchFailure(app, { code: null, signal: "SIGTRAP" }, { platform: "linux", uid: 0 });
  assert.match(asRoot, /^Tunes quit right after it started \(stopped by SIGTRAP\)/);
  assert.match(asRoot, /running as root/);
  assert.match(asRoot, /morse launch tunes -- --no-sandbox/);
  const asUser = apps.launchFailure(app, { code: 1 }, { platform: "linux", uid: 1000 });
  assert.match(asUser, /exit code 1/);
  assert.doesNotMatch(asUser, /root/);
  assert.match(apps.launchFailure(app, { error: Object.assign(new Error("x"), { code: "ENOENT" }) }), /nothing to run at \/opt\/Tunes\/tunes/);

  const never = async () => { throw new Error("no port"); };
  // Dies at once: answered after the grace period, not after the timeout.
  let t0 = Date.now();
  await assert.rejects(apps.waitForLaunch({ exited: { code: 1, signal: null } }, app, 1, { wait: never, grace: 300, timeoutMs: 20000 }), /quit right after it started \(exit code 1\)/);
  assert.ok(Date.now() - t0 < 3000);
  // Couldn't be started at all.
  await assert.rejects(apps.waitForLaunch({ failed: Object.assign(new Error("x"), { code: "EACCES" }) }, app, 1, { wait: never }), /isn't allowed to run/);
  // A launcher that exits while the real app opens the port (Squirrel's Update.exe): fine.
  let calls = 0;
  const later = async () => { if (++calls < 3) throw new Error("not yet"); return { Browser: "Chrome" }; };
  assert.deepEqual(await apps.waitForLaunch({ exited: { code: 0 } }, app, 1, { wait: later, grace: 5000 }), { Browser: "Chrome" });
  // Still running and never opens it.
  t0 = Date.now();
  await assert.rejects(apps.waitForLaunch({}, app, 1, { wait: async () => { await sleep(50); throw new Error("no"); }, timeoutMs: 300 }), /never opened its debugging port/);
});

test("the model is told not to use prompt(), which throws in Electron apps", async () => {
  // Claude Code haiku, asked for a sleep timer in the real Tunes app, first
  // wrote one that asked for the minutes with prompt(): Electron throws
  // "prompt() is not supported", so the feature died on first use.
  const { SYSTEM_PROMPT } = await import("../core/prompt.js");
  assert.match(SYSTEM_PROMPT, /No prompt\(\), alert\(\) or confirm\(\)/);
});

test("fuses: the verdict is in plain words, and a native Mac app (a folder) has no fuse wire", async () => {
  const sentinel = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
  const r = tempDir("morse-fuses-");
  await put(path.join(r, "locked"), Buffer.concat([Buffer.alloc(64), Buffer.from(sentinel), Buffer.from([1, 9]), Buffer.from("001010r01")]));
  const info = await inspectFuses(path.join(r, "locked"));
  assert.equal(info.electron, true);
  const text = formatFuses(info, "Locked");
  assert.match(text, /Morse can connect/);
  assert.match(text, /--inspect is fused off/);
  assert.match(text, /off {5}RunAsNode/);
  assert.match(text, /removed {1}LoadBrowserProcessSpecificV8Snapshot/);
  await fs.mkdir(path.join(r, "Notes.app/Contents/MacOS"), { recursive: true });
  const native = await inspectFuses(path.join(r, "Notes.app"));
  assert.equal(native.electron, false);
  assert.match(fuseVerdict(native)[0], /native app, it can't/);
});

// ---------------------------------------------------------------- a real Electron app

const dist = findElectron();
// Building and reading the app needs only the runtime; running it needs a display.
const noRuntime = !dist ? "no Electron runtime found. Install one with: npm install --prefix ~/.cache/morse/electron electron (or set MORSE_ELECTRON to an electron binary)"
  : process.platform === "darwin" ? "build.mjs packages Tunes for Linux and Windows only"
  : false;
const skip = noRuntime || (process.platform === "linux" && !process.env.DISPLAY ? "Electron needs a display. Run with DISPLAY=:99 (Xvfb)" : false);
if (skip) console.log(`electron.test.js: skipping the real Electron app: ${skip}`);

const ROOT = process.getuid?.() === 0;
const ENV = { ...process.env, MORSE_HOME: home, MORSE_PROVIDER: "demo", FORCE_COLOR: "0", MORSE_DEBUG: "1" }; // MORSE_DEBUG: the runtime's status attribute (the app has no navigator.webdriver)
const procs = [];
// The packaged apps are built once per Electron runtime and app source and
// kept in ~/.cache/morse/tunes, next to the runtime (hard links on the same
// disk, so they take almost no room), and every run, side by side included,
// opens the same copy. Each is built in a folder of its own and renamed into
// place when done; profiles and everything an app writes stay in this run's
// home. A build for older sources is removed after a day.
const CACHE = path.join(os.homedir(), ".cache", "morse", "tunes");
async function cachedApp(name, build) {
  const src = path.join(root, "demo", "electron-app");
  const h = createHash("sha256").update(`${dist}\0${electronVersion(dist)}\0${name}\0`);
  for (const f of [...(await fs.readdir(src)).sort().map(f => path.join(src, f)), path.join(root, "demo", "sites", "tunes", "index.html")]) h.update(f).update(await fs.readFile(f));
  const id = `${name}-${h.digest("hex").slice(0, 12)}`, dir = path.join(CACHE, id);
  const result = () => ({ dir, exe: path.join(dir, "tunes"), version: electronVersion(dir) });
  await fs.mkdir(CACHE, { recursive: true });
  for (const old of await fs.readdir(CACHE)) {
    if (!old.startsWith(`${name}-`) || old === id) continue;
    const st = await fs.stat(path.join(CACHE, old)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 86400e3) await fs.rm(path.join(CACHE, old), { recursive: true, force: true }).catch(() => {});
  }
  if (existsSync(path.join(dir, ".built"))) { await fs.utimes(dir, new Date(), new Date()).catch(() => {}); return result(); }
  const tmp = `${dir}.${process.pid}.tmp`;
  try {
    await build(tmp);
    await fs.writeFile(path.join(tmp, ".built"), "");
    // Another run may have finished the same build first: theirs is as good.
    await fs.rename(tmp, dir).catch(e => { if (!existsSync(path.join(dir, ".built"))) throw e; });
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  return result();
}
let built = null;
const tunesApp = async () => built ||= await cachedApp("Tunes", out => buildTunes(out, { dist }));
const lockedApp = () => cachedApp("TunesLocked", async out => {
  const { exe } = await buildTunes(out, { dist, asar: true });
  await setFuses(exe, { RunAsNode: false, EnableNodeOptionsEnvironmentVariable: false, EnableNodeCliInspectArguments: false,
    OnlyLoadAppFromAsar: true, EnableCookieEncryption: true, GrantFileProtocolExtraPrivileges: false });
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
function morse(...args) {
  const p = spawn(process.execPath, [path.join(root, "daemon/cli.js"), ...args], { env: ENV });
  p.out = "";
  p.stdout.on("data", d => { p.out += d; });
  p.stderr.on("data", d => { p.out += d; });
  p.done = new Promise(r => p.on("exit", code => r(code)));
  procs.push(p);
  return p;
}
const morseOut = (...args) => new Promise((resolve, reject) => execFile(process.execPath, [path.join(root, "daemon/cli.js"), ...args], { env: ENV },
  (e, out, err) => e ? reject(Object.assign(e, { out: out + err })) : resolve(out.replace(/\x1b\[[0-9;]*m/g, ""))));
// Opens Tunes with `morse launch` on a port of our own; returns { m, port }.
async function launch(exe, profile, extra = []) {
  const port = await freePort();
  const m = morse("launch", exe, "--port", String(port), "--", `--user-data-dir=${profile}`, ...(ROOT ? ["--no-sandbox"] : []), ...extra);
  await until(() => /✓ connected to tunes/i.test(m.out) || m.exitCode != null, 40000, () => "morse launch to connect: " + m.out);
  assert.match(m.out, /connected to tunes/i, m.out);
  return { m, port };
}

// A CDP session on one window, for reading state and sending trusted input.
async function open(port, match) {
  const t = await until(async () => (await listTargets(port)).find(t => match(t)), 15000, "the window");
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  const ev = async expr => {
    const r = await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const status = async () => JSON.parse((await ev(`document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"`)) || "null");
  const key = async (key, code, { mods = 0, text, vk } = {}) => {
    const base = { key, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await s.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text && { text, unmodifiedText: text }) });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const type = async str => { for (const c of str) await key(c, c === " " ? "Space" : /[a-z]/i.test(c) ? `Key${c.toUpperCase()}` : "", { text: c, vk: c.toUpperCase().charCodeAt(0) }); };
  const mouse = (type, x, y) => s.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
  const center = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  return { t, s, ev, status, key, type, mouse, center };
}
const quit = async port => {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const b = await CDPSession.connect(v.webSocketDebuggerUrl);
  await b.send("Browser.close").catch(() => {});
  b.close();
};

// After each test, pass or fail: no morse and no Tunes of ours left running,
// so a failure can't spill into the next test.
async function cleanup() {
  for (const p of procs.splice(0)) try { p.kill(); } catch {}
  for (const p of apps.listProcesses()) if (p.cmd.includes(home)) try { process.kill(p.pid, "SIGKILL"); } catch {}
  await sleep(300);
  await fs.rm(path.join(home, "sessions"), { recursive: true, force: true });
}
afterEach(cleanup);
after(cleanup);

test("real Electron: the packaged app is found, named, and its fuses read from the real binary", { skip: noRuntime, timeout: 60000 }, async () => {
  const { exe, version } = await tunesApp();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const app = apps.resolveApp(exe);
  assert.equal(app.name, "Tunes");
  assert.equal(app.engine, "electron");
  assert.equal(app.electron, version);
  assert.equal(app.canAttach, true);
  const info = await inspectFuses(exe);
  assert.equal(info.electron, true, "the fuse wire is found in a real Electron binary");
  assert.equal(info.version, 1);
  for (const k of ["RunAsNode", "EnableNodeCliInspectArguments", "EnableEmbeddedAsarIntegrityValidation", "OnlyLoadAppFromAsar"]) assert.ok(k in info.fuses, k);
  assert.equal(info.fuses.RunAsNode, "enabled", "a stock runtime ships with RunAsNode on");
  assert.match(await morseOut("fuses", exe), /Tunes {2}.*\n {2}Morse can connect/);
});

test("real Electron: launch, hotkey, point, change, save, quit, relaunch, second window, webview, status, stop", { skip, timeout: 180000 }, async () => {
  const { exe } = await tunesApp();
  const profile = path.join(home, "profile-main");
  let { m, port } = await launch(exe, profile);
  assert.match(m.out, /engine .*Electron \d+/);
  await until(() => /connected to .* \(webview\)/.test(m.out), 15000, "the <webview> guest to be attached too");

  let w = await open(port, t => t.type === "page" && t.url === "app://tunes/index.html");
  await w.ev(`localStorage.setItem("morse:debug", "1"), location.reload()`);
  w.s.close();
  w = await open(port, t => t.type === "page" && t.url === "app://tunes/index.html");
  await until(w.status, 15000, "the runtime in the main window");
  assert.equal(await w.ev(`typeof window.tunes?.openMiniPlayer`), "function", "the preload's contextBridge API is there");
  assert.equal(await w.ev(`typeof __morseHostSend + typeof __morseHost`), "undefinedundefined", "the app's own world can't reach Morse's host");

  // The real hotkey, as trusted key events.
  await w.key("Control", "ControlLeft", { mods: 2, vk: 17 });
  await w.key(" ", "Space", { mods: 2 | 8, vk: 32 });
  await until(async () => (await w.status())?.open, 5000, "the bar to open on Ctrl+Shift+Space");

  // Point at the player controls and pick them. Chromium delivers mouse moves
  // on animation frames, and right after the bar opens on a busy machine the
  // first ones can be lost: the click then lands with nothing pointed at and
  // the bar still says "Point at anything". Like a person would, move and
  // click again until the bar has something picked (its input then has focus).
  const [x, y] = await w.center('[data-testid="player-controls"] .btns');
  for (let i = 0; ; i++) {
    await w.mouse("mouseMoved", x - 40, y);
    await w.mouse("mouseMoved", x, y);
    await sleep(300);
    await w.mouse("mousePressed", x, y);
    await w.mouse("mouseReleased", x, y);
    try {
      await until(async () => { const s = await w.status(); return s && !/^Point at/.test(s.hint || "") && s.focus; }, 2000, "something picked");
      break;
    } catch (e) { if (i >= 5) throw e; }
  }
  await w.type("add a sleep timer that pauses the music after a while");
  await until(async () => /sleep timer/.test((await w.status())?.input || ""), 5000, "the request in the bar");
  await w.key("Enter", "Enter", { text: "\r", vk: 13 });
  const done = await until(async () => { const s = await w.status(); return ["result", "error"].includes(s?.phase) && s; }, 60000, "a result");
  assert.equal(done.phase, "result", done.hint);
  assert.ok(await w.ev(`!!document.querySelector(".morse-sleep")`), "the sleep timer button is in the player");

  // Save it.
  await w.key("Enter", "Enter", { text: "\r", vk: 13 });
  const modsDir = path.join(home, "mods");
  const file = await until(async () => (await fs.readdir(modsDir).catch(() => [])).find(f => f.endsWith(".json")), 10000, "the mod on disk");
  const mod = JSON.parse(await fs.readFile(path.join(modsDir, file), "utf8"));
  assert.equal(mod.title, "Sleep timer");
  assert.deepEqual(mod.match, { hosts: ["tunes"], app: "tunes" }, "filed under the app and its app:// host");

  // Quit the app: morse notices, and stops.
  w.s.close();
  await quit(port);
  await until(() => /closed, so Morse stopped/.test(m.out), 15000, "morse to notice the app quit");

  // Open it again: the mod comes back by itself.
  ({ m, port } = await launch(exe, profile));
  w = await open(port, t => t.type === "page" && t.url === "app://tunes/index.html");
  await until(() => w.ev(`!!document.querySelector("style[data-morse-css]") && !!document.querySelector(".morse-sleep")`), 15000, "the saved mod after relaunch");

  // A second window (file://) opened by the app's preload API gets Morse too.
  await w.ev(`window.tunes.openMiniPlayer()`);
  const mini = await open(port, t => t.type === "page" && t.url.endsWith("/mini.html"));
  assert.match(mini.t.url, /^file:\/\//);
  await until(() => mini.ev(`!!document.querySelector("[data-morse-ui]")`), 15000, "the runtime in the Mini Player");
  assert.equal(await mini.ev(`typeof __morseHostSend`), "undefined");
  assert.equal(await mini.ev(`document.querySelector(".morse-sleep")`), null, "a mod for the main window stays there");
  mini.s.close();

  // The <webview> guest has the runtime in it, and its page can't see the host either.
  const guest = await open(port, t => t.type === "webview");
  await until(() => guest.ev(`!!document.querySelector("[data-morse-ui]")`), 15000, "the runtime in the webview");
  assert.equal(await guest.ev(`typeof __morseHostSend`), "undefined");
  guest.s.close();

  // morse status: every window, with the mod where it applies.
  const sessions = await until(async () => {
    const list = JSON.parse(await morseOut("status", "--json"));
    return list[0]?.windows?.length >= 3 && list;
  }, 10000, "morse status to list three windows");
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.name, "Tunes");
  assert.match(s.electron, /^\d+\./);
  assert.deepEqual(s.windows.map(x => x.type).sort(), ["page", "page", "webview"]);
  const text = (await morseOut("status")).replace(/\x1b\[[0-9;]*m/g, "");
  for (const want of [/Tunes +● connected/, /mods on: Sleep timer/, /window +Mini Player/, /webview +Lyrics/]) assert.match(text, want);

  // morse stop: the mod and the bar come off, the app keeps running.
  assert.match(await morseOut("stop", "tunes"), /Disconnected from Tunes/);
  await until(() => m.exitCode != null, 10000, "morse launch to end after morse stop");
  await until(async () => !(await w.ev(`!!document.querySelector("style[data-morse-css], .morse-sleep, [data-morse-ui]")`)), 8000, "Morse gone from the page");
  assert.ok((await listTargets(port)).some(t => t.url === "app://tunes/index.html"), "the app is still running");
  w.s.close();
  await quit(port);
});

test("real Electron: packed as app.asar with its fuses locked down, Morse still gets in", { skip, timeout: 90000 }, async () => {
  const { exe } = await lockedApp();
  const info = await inspectFuses(exe);
  assert.equal(info.fuses.RunAsNode, "disabled");
  assert.equal(info.fuses.OnlyLoadAppFromAsar, "enabled");
  assert.equal(apps.resolveApp(exe).name, "Tunes", "named from package.json inside app.asar");
  const { m, port } = await launch(exe, path.join(home, "profile-locked"));
  assert.match(m.out, /--inspect is fused off/);
  const w = await open(port, t => t.type === "page" && t.url === "app://tunes/index.html");
  await until(() => w.ev(`!!document.querySelector("[data-morse-ui]")`), 15000, "the runtime in the locked-down app");
  w.s.close();
  await quit(port);
  await until(() => m.exitCode != null, 15000, "morse to end with the app");
});

test("real Electron: morse attach --port connects to an app someone already started with a debugging port", { skip, timeout: 60000 }, async () => {
  const { exe } = await tunesApp();
  const port = await freePort();
  const app = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home, "profile-attach")}`, ...(ROOT ? ["--no-sandbox"] : [])], { stdio: "ignore" });
  procs.push(app);
  const m = morse("attach", "--port", String(port), "--app", "Tunes");
  await until(() => /✓ connected to tunes/i.test(m.out), 30000, () => "morse attach to connect: " + m.out);
  assert.match(m.out, /connected on port \d+ · Chrome [\d.]+ · Electron \d+/, "says it's Electron");
  const w = await open(port, t => t.type === "page" && t.url === "app://tunes/index.html");
  await until(() => w.ev(`!!document.querySelector("[data-morse-ui]")`), 15000, "the runtime after attach");
  w.s.close();
  assert.match(await morseOut("stop", "tunes"), /Disconnected from Tunes/);
});

test("real Electron: as root without --no-sandbox, the app dies on start and morse says why", { skip: skip || (!ROOT && "only meaningful as root"), timeout: 60000 }, async () => {
  const { exe } = await tunesApp();
  const port = await freePort();
  const m = morse("launch", exe, "--port", String(port), "--", `--user-data-dir=${path.join(home, "profile-root")}`);
  const code = await Promise.race([m.done, sleep(25000).then(() => "still waiting")]);
  assert.equal(code, 1, m.out);
  assert.match(m.out, /Tunes quit right after it started[\s\S]*running as root[\s\S]*-- --no-sandbox/);
});
