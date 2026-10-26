// Morse Desktop without Electron: the IPC handlers (desktop-app/ipc.js) over
// the service (desktop-app/service.js) with a fake daemon, the preload's
// exposed API, morse:// pairing links, the Linux desktop files and the icon.
// The real window is tests/desktop-app-ui.test.js.
import { home, tempDir } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const { API, CHANNEL, LINKS, registerIpc, isOpenLink, gateService } = await import("../desktop-app/ipc.js");
const { createService } = await import("../desktop-app/service.js");
const { t } = await import("../core/i18n.js");
const { afterOpenBar, barWorld, noticeStillShown, presentApp } = await import("../daemon/open-bar.js");
const { desktopEntry, setAutostart, AUTOSTART } = await import("../desktop-app/linux.js");
const { markPng, markPixels } = await import("../desktop-app/mark.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ---------------------------------------------------------------- a fake daemon
// The same names service.js uses from daemon/ (loadDaemon), recording calls.
function fakeDaemon(over = {}) {
  const calls = [];
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); return typeof ret === "function" ? ret(...args) : ret; };
  let cfg = { bridge: { tokens: [{ hash: "x" }] } };
  let control = { pause: { all: false, sites: {} } };
  const mods = new Map([["m1", { id: "m1", title: "Sleep timer", prompt: "add a sleep timer", match: { app: "tunes", hosts: ["tunes"] }, enabled: true }]]);
  const apps = [
    { id: "tunes", name: "Tunes", exe: "/opt/Tunes/tunes", path: "/opt/Tunes/tunes", canAttach: true, why: "Electron 45", known: false, version: "1.4.2" },
    { id: "slack", name: "Slack", exe: "/usr/lib/slack/slack", path: "/usr/lib/slack/slack", canAttach: true, why: "Electron", known: true },
    { id: "notes", name: "Notes", exe: "/x/notes", path: "/x/notes", canAttach: false, why: "native app, not built on web technology", known: true },
  ];
  let sessions = [];
  const d = {
    calls, mods, apps, get sessions() { return sessions; }, set sessions(v) { sessions = v; }, get cfg() { return cfg; }, get control() { return control; },
    HOME: tempDir("morse-desktop-fake-"), VERSION: "9.9.9",
    hostContext: () => ({ platform: "linux" }),
    discoverApps: rec("discoverApps", () => apps.map(a => ({ ...a }))),
    appFromPath: rec("appFromPath", (_ctx, p) => {
      if (p === "/apps/native") return { id: "nat", name: "Nat", canAttach: false, why: "native app, not built on web technology" };
      if (p === "/apps/acme") return { id: "acme", name: "Acme", exe: "/apps/acme", path: "/apps/acme", canAttach: true, why: "Electron" };
      throw new Error(`Nothing at ${p}.`);
    }),
    listProcesses: () => [{ pid: 11, cmd: "/usr/lib/slack/slack" }],
    findAppProcesses: (a, procs) => procs.filter(p => p.cmd.startsWith(a.exe)),
    debugPortOf: cmd => Number(/--remote-debugging-port=(\d+)/.exec(cmd)?.[1]) || null,
    readSessions: async () => sessions,
    stopSession: rec("stopSession", async id => { const s = sessions.find(x => x.id === id); sessions = sessions.filter(x => x.id !== id); return s ? { stopped: [s] } : { stopped: [], message: `Morse isn't connected to "${id}".` }; }),
    connectApp: rec("connectApp", async (app, { ask }) => {
      if (app.id === "slack") {
        const a = ask ? await ask(app) : null;
        if (a !== "y" && a !== "a") throw Object.assign(new Error("Slack is already open. \x1b[1mmorse launch slack --restart\x1b[22m"), { plain: true, running: true });
      }
      return { port: 9444, pids: [1], who: { browser: "Chrome/140", electron: "45.0.0" }, verify: async () => ({ ok: true }) };
    }),
    startSession: rec("startSession", ({ app }) => {
      const connector = { state: "attached" };
      let resolveDone;
      const s = {
        id: app.id, name: app.name, connector, flushed: Promise.resolve(),
        done: new Promise(r => { resolveDone = r; }),
        stop: async () => { connector.state = "stopped"; sessions = sessions.filter(x => x.id !== app.id); resolveDone("stopped"); },
      };
      sessions = [...sessions, { id: app.id, name: app.name, pid: process.pid, state: "attached", windows: [{ id: "w1" }] }];
      return s;
    }),
    loadConfig: async () => structuredClone(cfg),
    updateConfig: async fn => { cfg = (await fn(structuredClone(cfg))) ?? cfg; return cfg; },
    settingsFromConfig: c => c.provider ? { provider: c.provider, model: c.provider === "claude-code" ? "haiku" : "", detected: false } : { provider: "none", model: "", detected: true },
    settingsLabel: s => s.provider === "none" ? "none" : `\x1b[1m${s.provider}\x1b[22m`,
    detectBackends: async () => [
      { id: "claude-code", name: "Claude Code", found: true, detail: "2.1.0  ~/bin/claude" },
      { id: "codex", name: "Codex", found: false, detail: "not installed" },
      { id: "api-key", name: "API key", found: false, detail: "none" },
    ],
    recommend: rows => rows.find(r => r.found) || null,
    BACKENDS: [{ id: "claude-code", name: "Claude Code", why: "uses your Claude subscription", install: "npm i -g claude" }, { id: "codex", name: "Codex", why: "uses your ChatGPT plan", install: "npm i -g codex" }, { id: "api-key", name: "API key", why: "paid per use", install: "console" }],
    configFor: (id, { key } = {}) => (id === "api-key" ? { provider: /^sk-ant-/.test(key) ? "anthropic" : "openai", keys: { x: key } } : { provider: id }),
    saveChoice: rec("saveChoice", async (choice, m) => { cfg = { ...cfg, provider: m.provider, setup: { backend: choice } }; return cfg; }),
    checkModel: rec("checkModel", async () => ({ ok: true, ms: 1200 })),
    // createBridge's options are kept, so a test can play the helper asking (onboarding v2's ask).
    createBridge: rec("createBridge", opts => { d.bridgeOpts = opts; return { listen: async () => 7457, close: async () => {} }; }),
    startPairing: rec("startPairing", async (_ttl, code = "NEWCDE") => { cfg = { ...cfg, bridge: { ...cfg.bridge, pairing: { code, expires: Date.now() + 600000 } } }; return { code }; }),
    helperPort: () => 1,
    validPairingCode: c => /^[A-HJ-NP-Z2-9]{6}$/.test(c),
    listMods: async () => [...mods.values()].map(m => ({ ...m })),
    getMod: async id => (mods.has(id) ? { ...mods.get(id) } : null),
    saveMod: rec("saveMod", async m => { mods.set(m.id, m); return m; }),
    deleteMod: rec("deleteMod", async id => { mods.delete(id); }),
    loadControl: async () => structuredClone(control),
    saveControl: rec("saveControl", async s => { control = s; }),
    setPause: (c, { all }) => ({ ...c, pause: { ...c.pause, all } }),
    pauseInfo: c => ({ all: c.pause.all, sites: Object.keys(c.pause.sites) }),
    platformChecks: async () => [{ label: "system", ok: null, text: "Linux" }, { label: "colors", ok: null, text: "on" }, { label: "display", ok: false, text: "No DISPLAY" }],
    configuredHotkeys: async () => ({ open: "Ctrl+Shift+Space" }),
    plainError: e => (e?.plain ? e.message : "Something went wrong. Try again."),
    ...over,
  };
  return d;
}

// ipcMain as Electron's: handle(channel, fn); invoke as a window would.
function fakeIpc() {
  const handlers = new Map();
  return { handlers, handle: (ch, fn) => handlers.set(ch, fn) };
}
const TRUSTED = { trusted: true };
function setup(over) {
  const daemon = fakeDaemon(over);
  const emitted = [];
  const service = createService({ daemon, emit: () => emitted.push(1), scan: true, fetchHealth: async () => null });
  const ipcMain = fakeIpc();
  const native = { opened: [], pickApp: async () => "/apps/acme", showFolder: async dir => ({ ok: true, dir }), openExternal: async url => { native.opened.push(url); return { ok: true }; }, setLoginItem: async on => { native.login = on; } };
  const channels = registerIpc({ ipcMain, service, native, isTrusted: e => e === TRUSTED });
  const call = (name, ...args) => ipcMain.handlers.get(CHANNEL(name))(TRUSTED, ...args);
  return { daemon, service, ipcMain, native, channels, call, emitted };
}

// The first state() answers before discoverApps. Poll until the shared fill lands.
async function settled(call) {
  let st = await call("state");
  for (let i = 0; i < 50 && st?.appsPending; i++) {
    await new Promise(r => setTimeout(r, 10));
    st = await call("state");
  }
  return st;
}

// ---------------------------------------------------------------- the IPC handlers

test("every request in the API has one channel, and only Morse's own window may use it", async () => {
  const { ipcMain, channels } = setup();
  assert.deepEqual(channels.sort(), Object.keys(API).map(CHANNEL).sort());
  assert.deepEqual([...ipcMain.handlers.keys()].sort(), channels.sort());
  for (const ch of channels) assert.deepEqual(await ipcMain.handlers.get(ch)({ sender: "a web page" }), { error: "Not allowed." }, ch);
});

test("arguments are checked: ids, answers, switches, choices, keys, link names, and no extra arguments", async () => {
  const { call, daemon } = setup();
  for (const [name, args] of [
    ["openApp", ["../etc"]], ["openApp", [{ id: "tunes" }]], ["openApp", ["tunes", "yes please"]], ["openApp", ["tunes", "y", "extra"]],
    ["disconnectApp", [""]], ["openBar", [""]], ["setModOn", ["m1", "true"]], ["deleteMod", ["../m1"]], ["undeleteMod", [7]], ["setAllModsOff", [1]], ["chooseModel", ["gpt", ""]],
    ["chooseModel", ["api-key", "sk-ant key with spaces"]], ["openLink", ["https://evil.example"]],
    ["setStartAtLogin", [null]], ["setOpenShortcut", ["Alt+"]], ["setOpenShortcut", ["<script>"]], ["setOpenShortcut", [null]], ["state", ["x", "y"]],
  ]) assert.deepEqual(await call(name, ...args), { error: "Not allowed." }, `${name}(${JSON.stringify(args)})`);
  assert.equal(daemon.calls.filter(c => c[0] === "connectApp").length, 0, "nothing ran");
});

test("state: each app says whether it's open and connected, with its mods; the model and the off switch", async () => {
  const { call, daemon } = setup();
  daemon.sessions = [{ id: "port-9222", name: "App on port 9222", pid: 1, state: "attached", windows: [] }];
  const first = await call("state");
  assert.equal(first.appsPending, true, "the shell is up before the scan");
  assert.deepEqual(first.apps, []);
  assert.equal(daemon.calls.filter(c => c[0] === "discoverApps").length, 0, "the first answer does not walk the disk");
  assert.equal(first.model.none, true);
  assert.equal(first.pause.all, false);
  assert.equal(first.keys.open, "Ctrl+Shift+Space");
  assert.deepEqual(first.settings, { startAtLogin: false, autoOpen: true, welcomed: false }, "Always open with Morse is on (main.js turns login start on for it once); the first run shows");
  const st = await settled(call);
  assert.equal(st.appsPending, false);
  assert.equal(daemon.calls.filter(c => c[0] === "discoverApps").length, 1, "one scan fills the list");
  assert.equal(st.version, "9.9.9");
  const by = Object.fromEntries(st.apps.map(a => [a.id, a]));
  assert.equal(by.tunes.state, "closed");
  assert.equal(by.tunes.mods, 1);
  assert.equal(by.tunes.modsOn, 1);
  assert.equal(by.slack.state, "open", "running without a debugging port");
  assert.equal(by.notes.canAttach, false);
  assert.equal(by["port-9222"].external, true, "an app a terminal attached to is listed too");
  assert.equal(st.apps.at(-1).id, "notes", "apps Morse can't connect to go last");
  assert.equal(st.model.none, true);
  assert.equal(st.chrome, undefined, "no Chrome extension any more: browsers are apps");
  assert.equal(st.pause.all, false);
  assert.equal(st.keys.open, "Ctrl+Shift+Space");
  assert.deepEqual(st.settings, { startAtLogin: false, autoOpen: true, welcomed: false }, "Always open with Morse is on (main.js turns login start on for it once); the first run shows");
});

test("the global shortcut toggles the app in front; a saved chord is kept", async () => {
  const { call, service } = setup();
  assert.equal(await service.openCombo(), "Ctrl+Alt+Space", "nothing saved: the default chord");
  assert.deepEqual(await service.openFromShortcut(1, 2), { ok: false, reason: "none" });
  assert.deepEqual(await call("openApp", "tunes"), { ok: true });
  const s = service.sessions.get("tunes");
  let toggled = 0;
  s.connector = { ...s.connector, toggleBar: async () => (toggled++, true), barFocused: async () => false };
  s.pids = [42];
  assert.deepEqual(await service.openFromShortcut(42, 7), { ok: true, id: "tunes" });
  assert.equal(toggled, 1);
  assert.deepEqual(await service.openFromShortcut(99, 7), { ok: false, reason: "none" }, "another app is in front");
  assert.equal(toggled, 1);
  await service.shutdown();

  const custom = setup({ loadPrefs: async () => ({ hotkeys: { open: "Alt+Shift+KeyK" } }) });
  assert.equal(await custom.service.openCombo(), "Alt+Shift+KeyK");
  await custom.service.shutdown();
});

test("Open the bar: asks the app's connector to open Morse's bar, and says why when it can't", async () => {
  const { call, service } = setup();
  assert.deepEqual(await call("openBar", "tunes"), { code: "notHere" }, "an app this window didn't open");
  assert.deepEqual(await call("openApp", "tunes"), { ok: true });
  const s = service.sessions.get("tunes");
  let asked = 0;
  s.connector = { ...s.connector, openBar: async () => (asked++, asked > 1) };
  assert.deepEqual(await call("openBar", "tunes"), { code: "notReady" }, "no window with Morse in it yet");
  assert.deepEqual(await call("openBar", "tunes"), { ok: true });
});

// The screenshot: Brave's row says Connected and offers Open the bar, while the
// banner says Morse isn't running in Brave yet. Open the bar returns notReady
// when no window has Morse's world; the session is "attached" before that.
test("a Connected row never sits under “Morse isn't running in … yet”", async () => {
  const banner = (code, name) => (code === "notReady" ? t("desk.openBar.notReady", { name }) : "");
  const contradicts = (state, code, name) => state === "connected" && /isn't running in/.test(banner(code, name));
  assert.equal(t("desk.openBar.notReady", { name: "Brave" }), "Morse isn't running in Brave yet. Wait a moment, then try again.");
  assert.match(readFileSync(path.join(root, "daemon/connector.js"), "utf8"), /const world = barWorld\(w\)/, "Open the bar uses the same world check as the row");

  // The click came back notReady while the row still said Connected.
  const shot = afterOpenBar("connected", "notReady");
  assert.equal(contradicts(shot.state, shot.code, "Brave"), false);
  assert.equal(shot.state, "connecting", "too early: the row steps back to connecting");
  assert.equal(shot.canStop, true, "Disconnect stays; the app is ours, Morse just isn't in it");
  assert.equal(banner(shot.code, "Brave"), "Morse isn't running in Brave yet. Wait a moment, then try again.", "the failure stays on screen");
  assert.equal(noticeStillShown(shot.state, shot.code), "notReady");

  // Once Morse is really in the app, that banner is gone and the row may say Connected.
  assert.equal(noticeStillShown("connected", "notReady"), null);
  assert.equal(contradicts("connected", noticeStillShown("connected", "notReady"), "Brave"), false);

  // Opened outside Morse is a different failure. The row can stay Connected.
  const outside = afterOpenBar("connected", "notHere");
  assert.equal(outside.state, "connected");
  assert.equal(outside.code, "notHere");
  assert.equal(noticeStillShown("connected", "notHere"), "notHere");

  // A window object with no Morse world is not Connected. A world is.
  const early = new Map([["w", { ready: false, frameId: "f", frames: new Map([["f", { world: 1 }]]) }]]);
  assert.equal(barWorld(early.get("w")), null, "ready is set before the world exists");
  assert.deepEqual(presentApp("connected", { windows: early }), { state: "connecting", canStop: true });
  const live = new Map([["w", { ready: true, frameId: "f", frames: new Map([["f", { world: 4 }]]) }]]);
  assert.equal(barWorld(live.get("w")), 4);
  assert.deepEqual(presentApp("connected", { windows: live }), { state: "connected", canStop: false });
  assert.deepEqual(presentApp("connected", { state: "attached" }), { state: "connected", canStop: false }, "no window list: trust the session");

  // The same split in the service Brave hits: the port is up, Morse is not in a window yet.
  const { call, service } = setup();
  assert.deepEqual(await call("openApp", "tunes"), { ok: true });
  const held = service.sessions.get("tunes");
  const windows = new Map();
  let sent = 0;
  held.connector = {
    state: "attached",
    windows,
    async openBar() {
      for (const w of windows.values()) {
        const world = barWorld(w);
        if (world == null) continue;
        sent++;
        return true;
      }
      return false;
    },
  };
  const rowOf = async () => (await call("state")).apps.find(a => a.id === "tunes");
  let row = await rowOf();
  let bar = await call("openBar", "tunes");
  assert.equal(contradicts(row.state, bar.code, row.name), false, "Connected plus the isn't-running banner");
  assert.equal(row.state, "connecting");
  assert.equal(row.canStop, true);
  assert.equal(banner(bar.code, row.name), "Morse isn't running in Tunes yet. Wait a moment, then try again.");
  assert.equal(sent, 0, "nothing was told to open");

  windows.set("early", { ready: true, frameId: "f", frames: new Map([["f", { world: null }]]), session: {} });
  row = await rowOf();
  bar = await call("openBar", "tunes");
  assert.equal(row.state, "connecting");
  assert.equal(bar.code, "notReady");
  assert.equal(sent, 0);

  windows.set("page", { ready: true, frameId: "f", frames: new Map([["f", { world: 4 }]]) });
  row = await rowOf();
  bar = await call("openBar", "tunes");
  assert.equal(row.state, "connected");
  assert.equal(bar.ok, true);
  assert.equal(sent, 1);
  assert.equal(noticeStillShown(row.state, "notReady"), null, "after it connects, the banner is gone");
  assert.equal(contradicts(row.state, noticeStillShown(row.state, "notReady"), row.name), false);
});

test("Open with Morse runs the launch steps and holds the session; Disconnect stops it", async () => {
  const { call, daemon, service } = setup();
  assert.deepEqual(await call("openApp", "tunes"), { ok: true });
  const [, app, opts] = daemon.calls.find(c => c[0] === "connectApp");
  assert.equal(app.id, "tunes");
  assert.equal(opts.ask, null, "nothing answered yet, so connectApp must not restart anything");
  assert.ok(service.sessions.has("tunes"));
  assert.equal((await call("state")).apps.find(a => a.id === "tunes").state, "connected");
  assert.deepEqual(await call("disconnectApp", "tunes"), { ok: true });
  assert.equal(service.sessions.has("tunes"), false);
  assert.equal(daemon.calls.filter(c => c[0] === "stopSession").length, 0, "its own session is stopped directly, not through a stop file");
  assert.equal((await call("state")).apps.find(a => a.id === "tunes").state, "closed");
});

test("an app that is already open asks first: Restart once (y) or always (a), the way morse launch asks", async () => {
  const { call, daemon, service } = setup();
  assert.deepEqual(await call("openApp", "slack"), { needsRestart: true, name: "Slack" });
  assert.equal(service.sessions.has("slack"), false);
  assert.deepEqual(await call("openApp", "slack", "a"), { ok: true });
  const last = daemon.calls.filter(c => c[0] === "connectApp").at(-1)[2];
  assert.equal(await last.ask(), "a", "the answer is handed to connectApp's question");
  assert.ok(service.sessions.has("slack"));
});

test("Always open with Morse: an app that starts on its own is opened again with Morse; one already open, or with the switch off, is left alone", async () => {
  let procs = [{ pid: 11, cmd: "/usr/lib/slack/slack" }];
  const { call, daemon, service } = setup({ listProcesses: () => procs });
  const opened = () => daemon.calls.filter(c => c[0] === "connectApp").map(c => c[1].id);
  assert.equal((await call("state")).settings.autoOpen, true, "on unless you turn it off");
  await service.apps(); // first look: Slack was already open when Morse started; Tunes is closed
  procs = [...procs, { pid: 12, cmd: "/opt/Tunes/tunes" }]; // Tunes opened from the Dock
  await service.apps();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(opened(), ["tunes"], "Tunes went from closed to open, so it opens again with Morse");
  assert.equal(await daemon.calls.find(c => c[0] === "connectApp")[2].ask(), "y", "quit and open again, without asking");
  assert.ok(service.sessions.has("tunes"));

  // Off: an app that starts on its own stays as it is.
  const off = setup({ listProcesses: () => procs.filter(p => p.pid !== 12) });
  assert.deepEqual(await off.call("setAutoOpen", false), { ok: true });
  assert.equal(off.native.login, false, "and Morse no longer opens at login for it");
  await off.service.apps();
  procs = [...procs];
  off.daemon.listProcesses = () => procs;
  await off.service.apps();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(off.daemon.calls.filter(c => c[0] === "connectApp").length, 0);

  // Every mod off (the off switch): nothing to bring back.
  const paused = setup({ listProcesses: () => [] });
  await paused.call("setAllModsOff", true);
  await paused.service.apps();
  paused.daemon.listProcesses = () => [{ pid: 12, cmd: "/opt/Tunes/tunes" }];
  await paused.service.apps();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(paused.daemon.calls.filter(c => c[0] === "connectApp").length, 0);
});

test("Always open with Morse, for a browser: opened from the Dock with website mods on, it opens again with Morse", async () => {
  let procs = [];
  const { daemon, service } = setup({ listProcesses: () => procs });
  daemon.apps.push({ id: "chrome", name: "Chrome", exe: "/usr/bin/google-chrome", path: "/usr/bin/google-chrome", canAttach: true, why: "browser", known: true, browser: true });
  daemon.mods.set("w1", { id: "w1", title: "Wide GitHub", prompt: "wider", enabled: true, match: { hosts: ["github.com"] } });
  const row = async () => (await service.apps()).find(r => r.id === "chrome");
  assert.deepEqual(((r) => [r.mods, r.modsOn])(await row()), [1, 1], "a browser's mods are the websites' ones");
  procs = [{ pid: 21, cmd: "/usr/bin/google-chrome" }];
  await service.apps();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(daemon.calls.filter(c => c[0] === "connectApp").map(c => c[1].id), ["chrome"]);
});

test("a new install opens apps with Morse, and onboarding toggles the same setting as the sidebar", async () => {
  let procs = [];
  const { call, daemon, service } = setup({ listProcesses: () => procs });
  const opened = () => daemon.calls.filter(c => c[0] === "connectApp").map(c => c[1].id);
  const file = path.join(daemon.HOME, "desktop.json");
  const waitOpen = async n => {
    for (let i = 0; i < 50 && opened().length < n; i++) await new Promise(r => setTimeout(r, 10));
  };

  const first = await call("state");
  assert.equal(first.settings.autoOpen, true, "a new install opens apps with Morse");
  assert.equal(first.settings.welcomed, false, "the first run shows");
  assert.equal(existsSync(file), false, "nothing saved yet: the default is on");
  await settled(call); // first look: apps already open stay as they are
  assert.deepEqual(opened(), [], "a closed app is not launched until you open it");

  // Slack has no mods. Notes can't be connected. Neither needs a press of Open with Morse.
  procs = [{ pid: 31, cmd: "/usr/lib/slack/slack" }, { pid: 30, cmd: "/x/notes" }];
  await service.apps();
  await waitOpen(1);
  assert.deepEqual(opened(), ["slack"], "an app with no mods opens with Morse; a native app does not");

  daemon.apps.push({ id: "nova", name: "Nova", exe: "/opt/Nova/nova", path: "/opt/Nova/nova", canAttach: true, why: "Electron", known: true });
  await service.apps({ fresh: true });
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(opened(), ["slack"], "a closed app Morse finds later is not launched on its own");
  procs = [...procs, { pid: 32, cmd: "/opt/Nova/nova" }];
  await service.apps();
  await waitOpen(2);
  assert.deepEqual(opened(), ["slack", "nova"], "one found later opens with Morse when you open it");

  // The sidebar and the first-run screen both call setAutoOpen, which is this field.
  assert.deepEqual(await call("setAutoOpen", false), { ok: true });
  assert.equal((await call("state")).settings.autoOpen, false);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.autoOpen, false);
  assert.equal(Object.hasOwn(saved, "openWith"), false, "no second flag beside autoOpen");

  daemon.apps.push({ id: "later", name: "Later", exe: "/opt/Later/later", path: "/opt/Later/later", canAttach: true, why: "Electron", known: true });
  procs = [...procs, { pid: 33, cmd: "/opt/Later/later" }];
  await service.apps({ fresh: true });
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(opened(), ["slack", "nova"], "turned off: a newly found app stays as it is");

  assert.deepEqual(await call("setAutoOpen", true), { ok: true });
  assert.equal((await call("state")).settings.autoOpen, true, "turned on again is the same setting");
  daemon.apps.push({ id: "again", name: "Again", exe: "/opt/Again/again", path: "/opt/Again/again", canAttach: true, why: "Electron", known: true });
  await service.apps({ fresh: true });
  procs = [...procs, { pid: 34, cmd: "/opt/Again/again" }];
  await service.apps();
  await waitOpen(3);
  assert.deepEqual(opened(), ["slack", "nova", "again"]);

  const html = readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8");
  const js = readFileSync(path.join(root, "desktop-app/ui/app.js"), "utf8");
  assert.match(html, /data-ob="open"/);
  assert.equal((html.match(/data-i18n="desk\.autoOpen"/g) || []).length, 2, "onboarding and the sidebar use the same words");
  assert.match(html, /id="ob-auto-open"/);
  assert.match(html, /id="auto-open"/);
  assert.match(js, /bindAutoOpen\("auto-open"\)/);
  assert.match(js, /bindAutoOpen\("ob-auto-open"\)/);
  assert.equal((js.match(/morse\.setAutoOpen\(on\)/g) || []).length, 1, "both switches write through one call");
  assert.match(js, /\["auto-open", "ob-auto-open"\]/);
  assert.doesNotMatch(readFileSync(path.join(root, "desktop-app/service.js"), "utf8"), /openWith|obAutoOpen/);
  assert.match(readFileSync(path.join(root, "desktop-app/service.js"), "utf8"), /autoOpen: true/);
});

test("an app Morse can't connect to, and errors, come back in plain words without terminal colors", async () => {
  const { call } = setup({ connectApp: async () => { throw Object.assign(new Error("Tunes quit right after it started (exit code 1), before Morse could connect."), { plain: true }); } });
  assert.match((await call("openApp", "notes")).error, /^Notes is a native app/);
  assert.deepEqual(await call("openApp", "tunes"), { error: "Tunes quit right after it started (exit code 1), before Morse could connect." });
  assert.match((await call("openApp", "nothere")).error, /can't find that app/);
});

test("Disconnect for an app a terminal connected asks that terminal's session to stop (morse stop)", async () => {
  const { call, daemon } = setup();
  daemon.sessions = [{ id: "tunes", name: "Tunes", pid: 999999, state: "attached", windows: [] }];
  assert.deepEqual(await call("disconnectApp", "tunes"), { ok: true });
  assert.deepEqual(daemon.calls.find(c => c[0] === "stopSession").slice(1), ["tunes"]);
  assert.match((await call("disconnectApp", "tunes")).error, /isn't connected/);
});

test("Add an app… keeps the file in desktop.json, and refuses native apps", async () => {
  const { call, daemon, native } = setup();
  assert.deepEqual(await call("addApp"), { ok: true, id: "acme", name: "Acme" });
  const saved = JSON.parse(readFileSync(path.join(daemon.HOME, "desktop.json"), "utf8"));
  assert.deepEqual(saved.apps, ["/apps/acme"]);
  assert.ok((await settled(call)).apps.some(a => a.id === "acme" && a.added));
  native.pickApp = async () => "/apps/native";
  assert.match((await call("addApp")).error, /Nat is a native app/);
  native.pickApp = async () => null;
  assert.deepEqual(await call("addApp"), { cancelled: true });
});

test("the model: choices from what's installed, a choice saved the way morse setup saves it, then checked", async () => {
  const { call, daemon, service } = setup();
  const choices = await call("modelChoices");
  assert.deepEqual(choices.map(c => [c.id, c.found, c.recommended]), [["claude-code", true, true], ["codex", false, false], ["api-key", false, false]]);
  await call("openApp", "tunes");
  assert.match((await call("chooseModel", "codex")).error, /isn't installed/);
  assert.match((await call("chooseModel", "api-key")).error, /Paste your API key/);
  const r = await call("chooseModel", "claude-code");
  assert.equal(r.ok, true);
  assert.deepEqual(r.check, { ok: true, ms: 1200, error: "", at: r.check.at, label: "\x1b[1mclaude-code\x1b[22m" });
  assert.deepEqual(daemon.calls.find(c => c[0] === "saveChoice").slice(1), ["claude-code", { provider: "claude-code" }]);
  assert.equal(service.sessions.get("tunes").connector.settings.provider, "claude-code", "a connected app uses the new model from now on");
  const m = (await call("state")).model;
  assert.equal(m.name, "Claude Code");
  assert.equal(m.model, "haiku");
  assert.equal(m.label, "claude-code", "no terminal colors");
  assert.equal(m.check.ok, true, "the last check shows until the model changes");
  await call("chooseModel", "api-key", "sk-ant-abc");
  assert.deepEqual(daemon.calls.filter(c => c[0] === "saveChoice").at(-1).slice(1), ["api-key", { provider: "anthropic", keys: { x: "sk-ant-abc" } }]);
});

test("the first run: shown until an app is opened or Skip, then never again", async () => {
  const { call } = setup();
  assert.equal((await call("state")).settings.welcomed, false);
  await call("finishWelcome");
  assert.equal((await call("state")).settings.welcomed, true);
});

test("mods: listed per app with switches, and the off switch pauses every mod everywhere", async () => {
  const { call, daemon } = setup();
  await settled(call); // the fill learns the apps' names; the first answer does not scan
  const groups = (await call("state")).mods;
  assert.deepEqual(groups.map(g => [g.name, g.mods.map(m => [m.title, m.on])]), [["Tunes", [["Sleep timer", true]]]]);
  assert.deepEqual(await call("setModOn", "m1", false), { ok: true });
  assert.equal(daemon.mods.get("m1").enabled, false);
  assert.match((await call("setModOn", "gone", true)).error, /isn't there/);
  // Delete, then Undo: back as it was.
  assert.deepEqual(await call("deleteMod", "m1"), { ok: true, title: "Sleep timer" });
  assert.equal(daemon.mods.has("m1"), false);
  assert.deepEqual((await call("state")).mods, []);
  assert.deepEqual(await call("undeleteMod", "m1"), { ok: true });
  assert.equal(daemon.mods.get("m1").title, "Sleep timer");
  assert.match((await call("undeleteMod", "m1")).error, /can't be brought back/);
  assert.deepEqual(await call("setAllModsOff", true), { all: true, sites: [] });
  assert.equal(daemon.control.pause.all, true);
  assert.equal((await call("state")).pause.all, true);
});

test("checks: the platform rows (without terminal colors), what's installed, the model and its answer", async () => {
  const { call } = setup();
  await call("chooseModel", "claude-code");
  const rows = await call("runChecks");
  assert.deepEqual(rows.map(r => r.label), ["System", "Display", "Claude Code", "Codex", "API key", "Model", "Answers"]);
  assert.equal(rows.find(r => r.label === "Display").ok, false);
  assert.equal(rows.at(-1).ok, true);
});

test("Check for updates returns what the updater found, and nothing else", async () => {
  const { call, native } = setup();
  native.checkForUpdate = async () => { native.checked = (native.checked || 0) + 1; return { phase: "current", version: "0.3.1" }; };
  assert.deepEqual(await call("checkForUpdate"), { phase: "current", version: "0.3.1" });
  assert.equal(native.checked, 1);
  assert.deepEqual(await call("checkForUpdate", "https://evil.example", "more"), { error: "Not allowed." });
  assert.equal(native.checked, 1, "an extra argument never reaches the updater");
  assert.equal(LINKS.release, "https://github.com/sam-siavoshian/RRAA/releases/tag/preview");
});

test("links open only by name, and login start goes through the native side", async () => {
  const { call, native } = setup();
  for (const name of Object.keys(LINKS)) await call("openLink", name);
  assert.deepEqual(native.opened, Object.values(LINKS));
  assert.ok(native.opened.every(u => u.startsWith("https://github.com/sam-siavoshian/RRAA/")));
  await call("setStartAtLogin", true);
  assert.equal(native.login, true);
  assert.equal((await call("state")).settings.startAtLogin, true);
});

test("a handler that throws gives a plain error, not its internals", async () => {
  const { call } = setup({ listMods: async () => { throw new Error("EACCES: /secret/path"); } });
  assert.deepEqual(await call("state"), { error: "Something went wrong. Try again." });
});

// ---------------------------------------------------------------- the preload

test("the preload exposes window.morse only: the API's names plus onChange, frozen, nothing from Electron", () => {
  const exposed = {}, invoked = [], listeners = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: {
      invoke: (ch, ...args) => { invoked.push([ch, ...args]); return Promise.resolve(); },
      on: (ch, fn) => listeners.push([ch, fn]), removeListener: (ch, fn) => { const i = listeners.findIndex(l => l[1] === fn); if (i >= 0) listeners.splice(i, 1); },
    },
  };
  const src = readFileSync(path.join(root, "desktop-app/preload.cjs"), "utf8");
  const required = [];
  vm.runInNewContext(src, { require: m => { required.push(m); if (m !== "electron") throw new Error(`preload required ${m}`); return electron; } });
  assert.deepEqual(required, ["electron"]);
  assert.deepEqual(Object.keys(exposed), ["morse"], "one name in the page");
  const api = exposed.morse;
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api), [...Object.keys(API), "onChange"], "the same names as ipc.js API, in order");
  for (const [k, v] of Object.entries(api)) assert.equal(typeof v, "function", k);
  // Each function calls its own channel and passes only plain values.
  for (const name of Object.keys(API)) api[name]("a", true, { evil: 1 }, () => {});
  assert.deepEqual(invoked.map(c => c[0]), Object.keys(API).map(CHANNEL));
  assert.deepEqual(invoked[0].slice(1), ["a", true, undefined, undefined], "objects and functions don't cross");
  // onChange: the state only, never the event (which carries the sender).
  const got = [];
  const off = api.onChange(s => got.push(s));
  assert.deepEqual(listeners.map(l => l[0]), ["morse:changed"]);
  listeners[0][1]({ sender: "ipcRenderer event" }, { apps: [] });
  assert.deepEqual(got, [{ apps: [] }]);
  off();
  assert.equal(listeners.length, 0);
  assert.equal(typeof api.onChange("not a function"), "function");
});

test("the window opens before the daemon, and a login shell is not spawned while main.js loads", () => {
  const main = readFileSync(path.join(root, "desktop-app/main.js"), "utf8");
  const ready = main.slice(main.indexOf("app.whenReady()"));
  const winAt = ready.indexOf("createWindow()");
  const loadAt = ready.indexOf("await loadDaemon()");
  assert.ok(winAt >= 0 && loadAt > winAt, "createWindow runs before loadDaemon");
  assert.match(main, /gateService\(serviceReady\)/);
  assert.match(main, /startShellPath\(/);
  assert.doesNotMatch(main, /process\.env\.PATH\s*=\s*fullPath\(/);
  assert.match(main, /updater\.start\(\)/, "the updater keeps its own delayed check");
  assert.match(main, /globalShortcut/);
  assert.match(main, /createOpenShortcut\(/);
  assert.match(main, /openFromShortcut\(/);
  assert.match(main, /s\.autoOpen && !s\.startAtLogin && !s\.loginSet/, "login start is still set once for Always open with Morse");
  const ui = readFileSync(path.join(root, "desktop-app/ui/app.js"), "utf8");
  assert.match(ui, /document\.documentElement\.dataset\.ready = "1"/);
});

test("state waits for the service instead of throwing, and a missing service answers loading", async () => {
  const daemon = fakeDaemon();
  const service = createService({ daemon, emit: () => {}, scan: true });
  const ipcMain = fakeIpc();
  let resolve;
  const ready = new Promise(r => { resolve = r; });
  registerIpc({ ipcMain, service: gateService(ready), isTrusted: e => e === TRUSTED, native: {} });
  const pending = ipcMain.handlers.get(CHANNEL("state"))(TRUSTED);
  let done = false;
  pending.then(() => { done = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(done, false, "the call stays queued until the daemon is in");
  resolve(service);
  const st = await pending;
  assert.equal(st.appsPending, true);
  assert.equal(daemon.calls.filter(c => c[0] === "discoverApps").length, 0);

  let resolveMissing;
  const missing = new Promise(r => { resolveMissing = r; });
  const ipc2 = fakeIpc();
  registerIpc({ ipcMain: ipc2, service: gateService(missing), isTrusted: e => e === TRUSTED, native: {} });
  const waiting = ipc2.handlers.get(CHANNEL("state"))(TRUSTED);
  resolveMissing(null);
  const missingState = await waiting;
  assert.equal(missingState.loading, true, "the window can paint before the daemon is in");
});

test("apps() and mods() share one discoverApps, and icons are read together", async () => {
  const { daemon, service } = setup();
  await Promise.all([service.apps(), service.mods()]);
  assert.equal(daemon.calls.filter(c => c[0] === "discoverApps").length, 1);
  assert.equal((await service.mods())[0].name, "Tunes", "the name arrives with the scan, not from a second one");

  let live = 0, max = 0;
  const slow = fakeDaemon();
  const icons = createService({
    daemon: slow, emit: () => {}, scan: true,
    iconFor: async () => {
      live++;
      max = Math.max(max, live);
      await new Promise(r => setTimeout(r, 40));
      live--;
      return "data:image/png,x";
    },
  });
  await icons.apps();
  assert.ok(max >= 3, `icon reads overlapped (${max})`);
});

test("Look again waits for a fresh scan", async () => {
  const { call, daemon } = setup();
  await settled(call);
  daemon.apps.push({ id: "extra", name: "Extra", exe: "/x/extra", path: "/x/extra", canAttach: true, why: "Electron", known: true });
  const again = await call("refreshApps");
  assert.equal(again.appsPending, false);
  assert.ok(again.apps.some(a => a.id === "extra"));
  assert.equal(daemon.calls.filter(c => c[0] === "discoverApps").length, 2);
});

test("the window's page: a strict CSP, no inline code, only its own files", () => {
  const html = readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, "no inline scripts");
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline handlers");
  assert.doesNotMatch(html, /\sstyle=/, "no inline styles");
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) assert.doesNotMatch(url, /^(https?:)?\/\//, url);
  const main = readFileSync(path.join(root, "desktop-app/main.js"), "utf8");
  for (const s of ["contextIsolation: true", "sandbox: true", "nodeIntegration: false", "webviewTag: false", "setWindowOpenHandler(() => ({ action: \"deny\" }))", "will-navigate", "setPermissionRequestHandler"]) assert.ok(main.includes(s), s);
});

test("Mods page: the app name is not glued to the count, rows are not cards, the footer label stays one line", () => {
  const js = readFileSync(path.join(root, "desktop-app/ui/app.js"), "utf8");
  const css = readFileSync(path.join(root, "desktop-app/ui/app.css"), "utf8");
  assert.match(js, /class: "gname"/, "the app name is its own element");
  assert.match(js, /class: "gmeta"/, "the count sits under the name, not in the same run of text");
  assert.match(js, /h\("small", \{ text: count \}\)/, "the count is the quiet line");
  assert.match(js, /aria-label": `\$\{g\.name\}, \$\{count\}`/, "the heading says the name, then the count");
  assert.doesNotMatch(js, /\$\{g\.name\}\$\{/, "the name is not written against the count");
  assert.match(css, /#mods \.list\.mods \{[^}]*border:\s*0/, "mod rows are not a bordered card");
  assert.match(css, /#mods \.list\.mods > li \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/, "the switch has its own column, so text cannot cover it");
  assert.match(css, /#mods \.list\.mods \.grow small \{[^}]*text-overflow:\s*ellipsis/, "a long request ends in an ellipsis");
  assert.match(css, /\.side-foot \.switchrow > span \{[^}]*white-space:\s*nowrap/, "Always open with Morse stays one line");
  assert.match(css, /grid-template-columns:\s*272px/, "the sidebar is wide enough for that label");
  assert.doesNotMatch(css, /nav button \{[^}]*transition:[^;}]*(?:width|left|height|background-position)/, "sidebar selection does not glide");
});

test("Model screen: the choice list, real marks, and Use this", () => {
  const js = readFileSync(path.join(root, "desktop-app/ui/app.js"), "utf8");
  const html = readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8");
  for (const id of ["claude-code", "codex", "api-key"]) assert.match(js, new RegExp(`"${id}"`), id);
  assert.match(js, /type: "radio", name: "choice"/);
  assert.match(js, /icons\/\$\{n\}\.png/, "each choice wears its real mark");
  assert.match(html, /id="choice-list"[^>]*role="radiogroup"/);
  assert.match(html, /id="use-choice"/);
  assert.match(html, /id="cancel-choice"/);
  assert.doesNotMatch(html, /id="connect-list"/);
  const boot = js.slice(js.lastIndexOf("st = await morse.state();"));
  assert.match(boot, /st = await morse\.state\(\);\nrender\(\);/, "the window paints from state");
  assert.doesNotMatch(boot, /await morse\.modelChoices/, "the choice list waits until Change is pressed");
});

test("the window wears the website's design: the same tokens, its sky, no drawn icons", () => {
  const css = readFileSync(path.join(root, "desktop-app/ui/app.css"), "utf8");
  const site = readFileSync(path.join(root, "site/site.css"), "utf8");
  const tokens = src => Object.fromEntries([.../:root\s*\{([^}]*)\}/.exec(src)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const app = tokens(css), web = tokens(site);
  for (const k of ["--bg", "--text", "--text-2", "--text-3", "--muted", "--faint", "--hair", "--glass-edge", "--primary", "--primary-text", "--font", "--display", "--mono", "--ease-emphasized"]) {
    assert.ok(k in app, `the window has ${k}`);
  }
  for (const [k, v] of Object.entries(app)) if (k in web) assert.equal(v, web[k], `${k} is the website's`);
  const main = readFileSync(path.join(root, "desktop-app/main.js"), "utf8");
  assert.match(main, /"\/sky\/day\.webp"/, "main.js serves the first run's sky");
  assert.match(main, /"\/dither\.js"/, "main.js serves its pixel edge");
  const html = readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8");
  assert.doesNotMatch(html, /<svg/, "icons are text or pictures, as on the website");
});

// ---------------------------------------------------------------- links, desktop files, the icon

test("morse:// links: only morse://open, which shows the window", () => {
  assert.equal(isOpenLink("morse://open"), true);
  assert.equal(isOpenLink("morse://open/"), true);
  for (const bad of ["morse://pair?code=ABC234", "https://open", "morse://evil", "not a url", null]) assert.equal(isOpenLink(bad), false, String(bad));
});

test("the packaged app is named Morse", async () => {
  const { builderConfig } = await import("../desktop-app/builder.config.js");
  const pkg = JSON.parse(readFileSync(path.join(root, "desktop-app/package.json"), "utf8"));
  assert.equal(pkg.productName, "Morse");
  assert.doesNotMatch(`${pkg.productName} ${pkg.description}`, /morse-desktop|Morse Desktop/);
  const c = builderConfig({ stage: "/s", out: "/o", res: "/r", electronVersion: "0", env: {} });
  assert.equal(c.productName, "Morse");
  assert.equal(c.executableName, "Morse", "the program macOS and the task list show is Morse");
  assert.equal(c.linux.desktop.entry.Name, "Morse");
  assert.equal(c.nsis.shortcutName, "Morse");
  assert.equal(c.protocols[0].name, "Morse");
  assert.equal(c.compression, "maximum");
  assert.equal(c.nsis.buildUniversalInstaller, false, "one Electron runtime per Windows installer");
  assert.ok(c.electronLanguages.includes("en-US") && c.electronLanguages.includes("en"));
  assert.equal(typeof c.afterPack, "function");
});

test("the package drops Electron locales, crashpad and dependency source maps", async () => {
  const { depFileShips, unusedRuntimeFile, publishedInstallerName, TYPE_ONLY_DEPS } = await import("../desktop-app/slim.js");
  assert.equal(depFileShips("index.mjs"), true);
  assert.equal(depFileShips("package.json"), true);
  assert.equal(depFileShips("LICENSE"), true);
  assert.equal(depFileShips("index.mjs.map"), false);
  assert.equal(depFileShips("index.d.ts"), false);
  assert.equal(depFileShips("index.d.mts"), false);
  assert.equal(depFileShips("client.ts"), false);
  assert.equal(depFileShips("README.md"), false);
  assert.equal(depFileShips("index.js", { siblingMjs: true }), false);
  assert.equal(depFileShips("index.js", { siblingMjs: false }), true, "a CommonJS-only package still ships its .js");
  assert.equal(TYPE_ONLY_DEPS.has("json-schema-to-ts"), true);
  assert.equal(unusedRuntimeFile("locales/en-US.pak"), false);
  assert.equal(unusedRuntimeFile("locales/de.pak"), false);
  assert.equal(unusedRuntimeFile("locales/ru.pak"), true);
  assert.equal(unusedRuntimeFile("en.lproj"), false);
  assert.equal(unusedRuntimeFile("en_GB.lproj"), false);
  assert.equal(unusedRuntimeFile("ru.lproj"), true);
  assert.equal(unusedRuntimeFile("Base.lproj"), false);
  assert.equal(unusedRuntimeFile("chrome_crashpad_handler"), true);
  assert.equal(unusedRuntimeFile("LICENSES.chromium.html"), false);
  assert.equal(unusedRuntimeFile("libvk_swiftshader.so"), false);
  assert.equal(unusedRuntimeFile("Morse"), false);
  assert.equal(publishedInstallerName("Morse-Setup-0.3.1-x64.exe"), "Morse-Setup-0.3.1.exe");
  assert.equal(publishedInstallerName("Morse-Setup-0.3.1-arm64.exe"), "Morse-Setup-0.3.1-arm64.exe");
  assert.match(readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8"), /<title>Morse<\/title>/);
  assert.equal(t("desk.openBar.notHere", { name: "Tunes" }), "Tunes was opened outside Morse. Open it with Morse here first.");
});

test("Linux desktop files: quoted Exec lines, the login one starts hidden, the menu one takes morse:// links", async () => {
  const entry = desktopEntry({ exec: "/home/sam/Apps/Morse 0.2.AppImage", url: true, icon: "morse" });
  assert.match(entry, /^Name=Morse$/m, "the app menu shows Morse");
  assert.match(entry, /^Exec="\/home\/sam\/Apps\/Morse 0\.2\.AppImage" %u$/m);
  assert.match(entry, /^MimeType=x-scheme-handler\/morse;$/m);
  assert.doesNotMatch(entry, /--hidden/);
  const login = desktopEntry({ exec: "/opt/electron", args: ["/repo/desktop-app"], hidden: true });
  assert.match(login, /^Exec=\/opt\/electron \/repo\/desktop-app --hidden$/m);
  assert.match(desktopEntry({ exec: '/x/$(rm -rf)/"a"' }), /^Exec="\/x\/\\\$\(rm -rf\)\/\\"a\\""$/m);
  const h = tempDir("morse-autostart-");
  await setAutostart(true, { exec: "/x/morse", home: h });
  assert.ok(existsSync(AUTOSTART(h)));
  await setAutostart(false, { home: h });
  assert.equal(existsSync(AUTOSTART(h)), false);
});

test("the Morse mark as a PNG: the right size, see-through around the mark", () => {
  const buf = markPng(32);
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(buf.readUInt32BE(16), 32);
  const px = markPixels(32);
  assert.equal(px[3], 0, "corner pixel is see-through");
  const tile = markPixels(64, { tile: true });
  assert.equal(tile[(32 * 64 + 4) * 4 + 3], 255, "the app icon's tile is solid");
});

test("desktop.json lives in the Morse folder; unknown settings are refused", async () => {
  const { service, daemon } = setup();
  assert.deepEqual(await service.setSetting("apps", true), { error: "There's no such setting." });
  assert.deepEqual(await service.setSetting("appArgs", true), { error: "There's no such setting." });
  await service.setSetting("startAtLogin", true);
  assert.equal(JSON.parse(await fs.readFile(path.join(daemon.HOME, "desktop.json"), "utf8")).startAtLogin, true);
  assert.ok(home);
});

// ---------------------------------------------------------------- app icons
const { appImageIcon } = await import("../desktop-app/appimage.js");
const { folderIconFor, icnsPng, linuxIconFor } = await import("../desktop-app/icons.js");
const zlib = await import("node:zlib");

// A PNG-looking file of a given width (the readers check the magic and IHDR only).
const fakePng = w => { const b = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(w, 20); return b; };

// The smallest AppImage the reader takes: an ELF header, then SquashFS 4.0
// with one folder holding ".DirIcon" (a link) -> "app.png" (one gzip block).
function tinyAppImage(icon, { link = "app.png" } = {}) {
  const elf = Buffer.alloc(64);
  elf.writeUInt32BE(0x7f454c46, 0); elf[4] = 2; elf[5] = 1;
  elf.writeBigUInt64LE(64n, 0x28); elf.writeUInt16LE(64, 0x3a); elf.writeUInt16LE(0, 0x3c);
  const data = zlib.deflateSync(icon);
  const u = (size, writes) => { const b = Buffer.alloc(size); writes(b); return b; };
  const inodeHeader = (type, n) => u(16, h => { h.writeUInt16LE(type, 0); h.writeUInt32LE(n, 12); });
  const entries = [{ name: ".DirIcon", at: 68, type: 3 }, { name: "app.png", at: 32, type: 2 }];
  const dirBody = Buffer.concat([
    u(12, h => { h.writeUInt32LE(entries.length - 1, 0); h.writeUInt32LE(0, 4); h.writeUInt32LE(1, 8); }),
    ...entries.map((e, i) => Buffer.concat([u(8, b => { b.writeUInt16LE(e.at, 0); b.writeInt16LE(i + 1, 2); b.writeUInt16LE(e.type, 4); b.writeUInt16LE(e.name.length - 1, 6); }), Buffer.from(e.name)])),
  ]);
  const rootInode = Buffer.concat([inodeHeader(1, 1), u(16, b => { b.writeUInt32LE(2, 4); b.writeUInt16LE(dirBody.length + 3, 8); b.writeUInt32LE(1, 12); })]);
  const fileInode = Buffer.concat([inodeHeader(2, 2), u(20, b => { b.writeUInt32LE(96, 0); b.writeUInt32LE(0xffffffff, 4); b.writeUInt32LE(icon.length, 12); b.writeUInt32LE(data.length, 16); })]);
  const linkInode = Buffer.concat([inodeHeader(3, 3), u(8, b => { b.writeUInt32LE(1, 0); b.writeUInt32LE(link.length, 4); }), Buffer.from(link)]);
  const meta = body => Buffer.concat([u(2, h => h.writeUInt16LE(body.length | 0x8000, 0)), body]);
  const inodes = meta(Buffer.concat([rootInode, fileInode, linkInode]));
  const dirs = meta(dirBody);
  const T = 96 + data.length, D = T + inodes.length;
  const sb = u(96, s => {
    s.write("hsqs", 0, "latin1"); s.writeUInt32LE(3, 4); s.writeUInt32LE(131072, 12); s.writeUInt16LE(1, 20); s.writeUInt16LE(17, 22); s.writeUInt16LE(4, 28);
    s.writeBigUInt64LE(BigInt(D + dirs.length), 40);
    for (const [o, v] of [[48, -1n], [56, -1n], [64, BigInt(T)], [72, BigInt(D)], [80, -1n], [88, -1n]]) s.writeBigInt64LE(v, o);
  });
  return Buffer.concat([elf, sb, data, inodes, dirs]);
}

test("app icons: the icon inside an AppImage, read without running it, through .DirIcon's link", async () => {
  const dir = await tempDir("morse-appimage-");
  const icon = Buffer.concat([fakePng(256), Buffer.alloc(5000, 7)]);
  const file = path.join(dir, "Tiny-1.0.AppImage");
  await fs.writeFile(file, tinyAppImage(icon));
  assert.deepEqual(appImageIcon(file), icon);
  // A link to nothing: the PNG beside it is next. Not an AppImage, or no file: null, never a throw.
  await fs.writeFile(path.join(dir, "broken.AppImage"), tinyAppImage(icon, { link: "nothing.png" }));
  assert.deepEqual(appImageIcon(path.join(dir, "broken.AppImage")), icon);
  await fs.writeFile(path.join(dir, "text.AppImage"), "#!/bin/sh\necho hi\n");
  assert.equal(appImageIcon(path.join(dir, "text.AppImage")), null);
  assert.equal(appImageIcon(path.join(dir, "missing.AppImage")), null);
  assert.equal(appImageIcon(process.execPath), null, "an ELF program with no SquashFS after it");
});

test("app icons: real AppImages give their own icon (when this computer has them)", { skip: !existsSync("/root/morse-real-apps") && "no real AppImages here" }, async () => {
  for (const [dir, name, w] of [["obsidian", "Obsidian", 512], ["joplin", "Joplin", 1024], ["logseq", "Logseq", 512]]) {
    const f = (await fs.readdir(`/root/morse-real-apps/${dir}`).catch(() => [])).find(x => x.endsWith(".AppImage"));
    if (!f) continue;
    const png = appImageIcon(`/root/morse-real-apps/${dir}/${f}`, name);
    assert.ok(png, name);
    assert.equal(png.readUInt32BE(16), w, `${name}'s own icon, not Electron's default`);
  }
});

test("app icons: the app's own folder (VS Code's resources/linux, icon.png), PNG only", () => {
  const files = new Map([
    ["/usr/share/code/resources/app/resources/linux/code.png", fakePng(512)],
    ["/opt/Thing/resources/app/icon.png", fakePng(256)],
    ["/opt/Svg/.DirIcon", Buffer.from("<svg>")],
  ]);
  const fake = {
    exists: p => files.has(p),
    readdir: d => [...files.keys()].filter(p => path.dirname(p) === d).map(p => path.basename(p)),
    head: p => files.get(p).subarray(0, 4),
  };
  assert.equal(folderIconFor({ id: "vscode", name: "VS Code", exe: "/usr/share/code/code" }, fake), "/usr/share/code/resources/app/resources/linux/code.png");
  assert.equal(folderIconFor({ id: "thing", name: "Thing", exe: "/opt/Thing/thing" }, fake), "/opt/Thing/resources/app/icon.png");
  assert.equal(folderIconFor({ id: "svg", name: "Svg", exe: "/opt/Svg/svg" }, fake), null, "an SVG .DirIcon is skipped");
  assert.equal(folderIconFor({ id: "x", name: "X", exe: "/x.AppImage", appimage: true }, fake), null);
});

test("app icons: the menu entry's Icon= in the hicolor theme comes first", () => {
  const files = new Set(["/usr/share/icons/hicolor/256x256/apps/com.example.Notes.png"]);
  const got = linuxIconFor({ id: "notes", name: "Notes", exe: "/opt/notes/notes" }, {
    home: "/home/u", exists: p => files.has(p),
    readdir: d => d === "/usr/share/applications" ? ["notes.desktop"] : [],
    read: () => "[Desktop Entry]\nName=Notes\nExec=/opt/notes/notes %U\nIcon=com.example.Notes\n",
  });
  assert.equal(got, "/usr/share/icons/hicolor/256x256/apps/com.example.Notes.png");
});

test("app icons: a Mac .icns gives its PNG nearest 256 pixels", () => {
  const entry = (type, data) => { const h = Buffer.alloc(8); h.write(type, 0, "latin1"); h.writeUInt32BE(data.length + 8, 4); return Buffer.concat([h, data]); };
  const body = Buffer.concat([entry("is32", Buffer.alloc(30)), entry("ic07", fakePng(128)), entry("ic08", fakePng(256)), entry("ic10", fakePng(1024))]);
  const head = Buffer.alloc(8); head.write("icns", 0, "latin1"); head.writeUInt32BE(body.length + 8, 4);
  assert.equal(icnsPng(Buffer.concat([head, body])).readUInt32BE(16), 256);
  assert.equal(icnsPng(Buffer.from("not an icns file")), null);
});

test("the shortcut that opens Morse is saved, checked, and sent to a connected app", async () => {
  const store = await import("../daemon/store.js");
  const { detectPlatform, defaultHotkeys, formatCombo } = await import("../core/hotkeys.js");
  const platform = detectPlatform({ platform: process.platform });
  const def = defaultHotkeys(platform).open;
  const { call, service } = setup({
    loadPrefs: store.loadPrefs,
    savePrefs: store.savePrefs,
    configuredHotkeys: store.configuredHotkeys,
  });
  try {
    const st = await call("state");
    assert.equal(st.keys.open, formatCombo(def, platform), "untouched: the platform default");
    assert.equal(st.keys.custom, false);
    assert.equal(st.keys.combo, def);

    assert.deepEqual(await call("openApp", "tunes"), { ok: true });
    const held = service.sessions.get("tunes");
    const pushed = [];
    held.connector.applySettings = prefs => pushed.push(prefs);
    const saved = await call("setOpenShortcut", "Alt+Shift+KeyK");
    assert.equal(saved.ok, true);
    assert.equal(saved.warn, "");
    assert.equal((await store.loadPrefs()).hotkeys.open, "Alt+Shift+KeyK");
    assert.equal(pushed.at(-1)?.hotkeys.open, "Alt+Shift+KeyK", "an app already connected hears the new shortcut");
    const st2 = await call("state");
    assert.equal(st2.keys.combo, "Alt+Shift+KeyK");
    assert.equal(st2.keys.custom, true);
    assert.equal(st2.keys.open, formatCombo("Alt+Shift+KeyK", platform));

    const quit = platform === "mac" ? "Meta+KeyQ" : "Ctrl+KeyQ";
    const bad = await call("setOpenShortcut", quit);
    assert.match(bad.error, /quits the app/);
    assert.equal((await store.loadPrefs()).hotkeys.open, "Alt+Shift+KeyK", "a refused shortcut is not saved");
    const mods = await call("setOpenShortcut", "Alt+Shift+KeyM");
    assert.match(mods.error, /Mods panel/);
    assert.equal((await store.loadPrefs()).hotkeys.open, "Alt+Shift+KeyK");

    const copy = platform === "mac" ? "Meta+KeyC" : "Ctrl+KeyC";
    const warn = await call("setOpenShortcut", copy);
    assert.equal(warn.ok, true);
    assert.match(warn.warn, /Copy/);
    assert.equal((await store.loadPrefs()).hotkeys.open, copy);

    assert.equal((await call("setOpenShortcut", "")).ok, true);
    assert.equal((await store.loadPrefs()).hotkeys.open, "");
    const st3 = await call("state");
    assert.equal(st3.keys.custom, false);
    assert.equal(st3.keys.combo, def);
    assert.equal(st3.keys.open, formatCombo(def, platform));
  } finally {
    await store.savePrefs({ hotkeys: { open: "" } });
    await service.shutdown();
  }
});

test("the packaged app includes every file it imports", async () => {
  const { APP_FILES } = await import("../desktop-app/build.js");
  const dir = path.join(root, "desktop-app");
  const shipped = APP_FILES.filter(f => f.endsWith(".js") || f.endsWith(".cjs"));
  const seen = new Set();
  const queue = [...shipped];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const m of text.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
      let rel = m[1];
      if (!/\.(?:js|cjs)$/.test(rel)) rel += ".js";
      const name = path.basename(rel);
      assert.ok(APP_FILES.includes(name), `${file} imports ${rel}, and that file is not in the package`);
      if (!seen.has(name)) queue.push(name);
    }
  }
  assert.ok(APP_FILES.includes("shortcut.js"));
});
