// Desktop apps: finding installed apps on macOS / Windows / Linux (fixture
// trees), fuzzy names, which CDP targets get attached, port safety, process
// matching, status files, and, against a fake multi-window app built from the
// preinstalled Chromium: popups, frames, reloads, navigation, renderer
// crashes, the app being killed and restarted, `morse stop`, and the CLI's
// launch / status / stop / --restart flow.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import { createRequire } from "node:module";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-desktop-"));
process.env.MORSE_HOME = home;
const apps = await import("../daemon/apps.js");
const targets = await import("../daemon/targets.js");
const ports = await import("../daemon/ports.js");
const status = await import("../daemon/status.js");
const store = await import("../daemon/store.js");
const { createMod } = await import("../core/mod.js");
const { buildMac, buildWindows, buildLinux } = await import("../demo/fake-installs.js");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, what = "condition") {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}
const byId = list => Object.fromEntries(list.map(a => [a.id, a]));

// ---------------------------------------------------------------- discovery
async function fixture(build) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morse-fx-"));
  return apps.hostContext(await build(dir));
}

test("discovers macOS apps from .app bundles: Info.plist, Electron Framework, CEF, native", async () => {
  const ctx = await fixture(buildMac);
  const found = byId(apps.discoverApps(ctx));
  assert.deepEqual(Object.keys(found).sort(), ["beeper", "chatgpt", "chrome", "claude", "discord", "notion", "obsidian", "slack", "spotify", "vscode"]);
  assert.equal(found.vscode.exe, "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", "executable comes from CFBundleExecutable");
  assert.equal(found.vscode.version, "1.95.3");
  assert.equal(found.slack.electron, "32.2.6");
  assert.equal(found.slack.bundleId, "com.tinyspeck.slackmacgap");
  assert.equal(found.spotify.engine, "cef");
  assert.equal(found.chatgpt.canAttach, false, "ChatGPT for Mac is native");
  assert.match(found.chatgpt.why, /native/);
  assert.equal(found.obsidian.path, "/Users/sam/Applications/Obsidian.app", "~/Applications is searched");
  assert.equal(found.beeper.known, false, "Electron apps outside the catalog are listed too");
  assert.equal(found.safari, undefined, "native apps outside the catalog are not");
  assert.equal(found.chrome.browser, true);
});

test("discovers Windows apps: per-user Programs, Squirrel app-<version> folders, Roaming, Program Files", async () => {
  const ctx = await fixture(buildWindows);
  const found = byId(apps.discoverApps(ctx));
  assert.deepEqual(Object.keys(found).sort(), ["beeper", "chrome", "discord", "obsidian", "slack", "spotify", "vscode"]);
  assert.equal(found.discord.exe, "C:\\Users\\sam\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe", "newest Squirrel version wins");
  assert.equal(found.discord.launcher, "C:\\Users\\sam\\AppData\\Local\\Discord\\Update.exe");
  assert.equal(found.slack.exe, "C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105\\slack.exe");
  assert.equal(found.vscode.engine, "electron", "unpacked resources/app counts as Electron");
  assert.equal(found.spotify.engine, "cef", "libcef.dll next to the exe");
  assert.equal(found.beeper.exe, "C:\\Users\\sam\\AppData\\Local\\Programs\\Beeper\\Beeper.exe", "uninstallers are skipped");
  assert.ok(Object.values(found).every(a => a.canAttach));
});

test("discovers Linux apps: fixed paths, PATH symlinks, snap, system and user flatpak exports, /opt", async () => {
  const ctx = await fixture(buildLinux);
  const found = byId(apps.discoverApps(ctx));
  assert.deepEqual(Object.keys(found).sort(), ["beeper", "chrome", "discord", "obsidian", "slack", "spotify", "vscode"]);
  assert.equal(found.vscode.path, "/usr/share/code/code", "the Electron binary, not the shell wrapper");
  assert.equal(found.slack.path, "/usr/lib/slack/slack");
  assert.equal(found.spotify.source, "snap");
  assert.equal(found.discord.source, "flatpak");
  assert.equal(found.discord.flatpak, "com.discordapp.Discord");
  assert.equal(found.obsidian.path, "/home/sam/.local/share/flatpak/exports/bin/md.obsidian.Obsidian");
  assert.equal(found.beeper.electron, "31.4.0");
  assert.equal(found.chrome.path, "/usr/bin/chromium");
});

test("Info.plist parsing keeps top-level keys only", () => {
  const p = apps.parsePlist(`<plist><dict><key>CFBundleName</key><string>A &amp; B</string><key>X</key><dict><key>CFBundleName</key><string>nested</string></dict><key>LSUIElement</key><true/></dict></plist>`);
  assert.deepEqual(p, { CFBundleName: "A & B", LSUIElement: true });
});

test("`morse apps` output: attachable first, plain reasons, running state", async () => {
  const ctx = await fixture(buildMac);
  const list = apps.discoverApps(ctx);
  const out = apps.formatApps(list, { platform: "darwin", color: false, running: new Map([["slack", { port: null }]]), sessions: [{ id: "vscode", port: 9333 }] });
  assert.match(out, /Apps Morse found on this Mac/);
  assert.match(out, /Slack .*open without Morse → morse launch slack --restart/);
  assert.match(out, /VS Code .*connected · port 9333/);
  assert.match(out, /ChatGPT .*can't connect: native app, not built on web technology/);
  const lines = out.split("\n");
  assert.ok(lines.findIndex(l => l.includes("ChatGPT")) > lines.findIndex(l => l.includes("VS Code")), "apps Morse can't attach to go last");
  assert.match(out, /Other Electron and Chromium apps\n.*Beeper/);
});

// ---------------------------------------------------------------- fuzzy names
test("fuzzy app names: aliases, partial names, typos, initials", async () => {
  const ctx = await fixture(buildMac);
  const list = apps.discoverApps(ctx);
  const pick = q => apps.matchApp(q, list).app?.id;
  assert.equal(pick("vs code"), "vscode");
  assert.equal(pick("code"), "vscode");
  assert.equal(pick("Visual Studio Code"), "vscode");
  assert.equal(pick("VSCode"), "vscode");
  assert.equal(pick("spotify"), "spotify");
  assert.equal(pick("spot"), "spotify");
  assert.equal(pick("discrod"), "discord");
  assert.equal(pick("slak"), "slack");
  assert.equal(pick("google chrome"), "chrome");
  assert.equal(pick("claude"), "claude");
  assert.equal(pick("x"), undefined);
  assert.equal(pick("photoshop"), undefined);
  const amb = apps.matchApp("code", [{ id: "code-a", name: "Code A" }, { id: "code-b", name: "Code B" }]);
  assert.deepEqual(amb.ambiguous.map(a => a.id), ["code-a", "code-b"]);
  assert.equal(apps.resolveApp("vs code", { ctx }).id, "vscode");
  assert.throws(() => apps.resolveApp("figma", { ctx }), /Figma isn't in the usual places/);
  assert.throws(() => apps.resolveApp("qwertyuiop", { ctx }), /couldn't find an app called "qwertyuiop"/);
  assert.equal(apps.resolveApp("/Applications/Slack.app", { ctx }).id, "slack", "paths work too");
});

// ---------------------------------------------------------------- targets
test("target filtering: windows, popups, webviews, views and app frames yes; workers, DevTools, internal pages, third-party embeds no", () => {
  const T = (type, url, extra = {}) => ({ id: url + type, type, url, title: "", ...extra });
  const list = [
    T("page", "https://app.slack.com/client", { id: "main" }),
    T("page", "https://app.slack.com/huddle", { title: "Huddle" }),
    T("webview", "https://discord.com/channels/@me"),
    T("other", "app://obsidian.md/index.html"),
    T("iframe", "vscode-webview://abc/index.html", { parentId: "main" }),
    T("iframe", "https://files.slack.com/preview", { parentId: "main" }),
    T("iframe", "https://www.youtube.com/embed/x", { parentId: "main" }),
    T("service_worker", "https://app.slack.com/sw.js"),
    T("shared_worker", "https://app.slack.com/w.js"),
    T("browser", ""),
    T("browser_ui", "chrome://webui-toolbar.top-chrome/"),
    T("page", "devtools://devtools/bundled/inspector.html"),
    T("page", "chrome-extension://abc/background.html"),
    T("page", "chrome://newtab/"),
    T("page", "about:blank"),
    T("page", ""),
  ];
  const picked = targets.selectTargets(list).map(t => t.url);
  assert.deepEqual(picked, [
    "https://app.slack.com/client", "https://app.slack.com/huddle", "https://discord.com/channels/@me", "app://obsidian.md/index.html",
    "vscode-webview://abc/index.html", "https://files.slack.com/preview",
  ]);
  assert.equal(targets.classifyTarget(list[4], "vscode-file://vscode-app/workbench.html").frame, true);
  assert.equal(targets.siteOf("https://a.b.co.uk/x"), "b.co.uk");
  assert.deepEqual(targets.describeTarget({ type: "page", url: "https://x.com/a", title: "" }), { kind: "window", title: "x.com" });
});

// ---------------------------------------------------------------- ports
test("port selection: preferred first, skips busy ports, gives up in plain words", async () => {
  assert.equal(await ports.pickPort({ isFree: async p => p === 9335 }), 9335);
  assert.equal(await ports.pickPort({ preferred: [9390], isFree: async () => true }), 9390);
  await assert.rejects(ports.pickPort({ range: [9333, 9334], isFree: async () => false }), /No free port between 9333 and 9334/);
  // a real listener makes its port busy; the next one is picked
  const busy = http.createServer().listen(0, "127.0.0.1");
  await new Promise(r => busy.on("listening", r));
  const p = busy.address().port;
  assert.equal(await ports.portFree(p), false);
  const next = await ports.pickPort({ preferred: [p], range: [p + 1, p + 50] });
  assert.ok(next > p);
  busy.close();
});

test("port safety: loopback only, no widening switches, and the answering browser must be the app", async () => {
  assert.deepEqual(ports.safeExtraArgs(["--remote-debugging-address=0.0.0.0", "--remote-debugging-port=1", "--foo", "--remote-debugging-pipe"]), ["--foo"]);
  assert.deepEqual(ports.externalAddresses({ lo: [{ address: "127.0.0.1", internal: true, family: "IPv4" }], eth0: [{ address: "10.0.0.5", internal: false, family: "IPv4" }, { address: "fe80::1", internal: false, family: "IPv6" }] }), ["10.0.0.5"]);
  assert.deepEqual(await ports.reachableFrom(9333, ["10.0.0.5", "192.168.1.2"], async (port, a) => a === "192.168.1.2"), ["192.168.1.2"]);
  const slack = { id: "slack", name: "Slack", engine: "electron" };
  const ua = s => ({ browser: "Chrome/128.0.6613.36", userAgent: `Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) ${s} Safari/537.36`, electron: /Electron\/([\d.]+)/.exec(s)?.[1] || null, pid: 4242 });
  assert.equal(ports.checkIdentity(ua("Slack/4.41.105 Chrome/128.0.6613.36 Electron/32.2.6"), slack, [1]).ok, true);
  assert.equal(ports.checkIdentity(ua("Chrome/128.0.0.0"), slack, [4242]).ok, true, "the process we started");
  const other = ports.checkIdentity(ua("Chrome/128.0.0.0"), slack, [1]);
  assert.equal(other.ok, false);
  assert.match(other.why, /it's Chrome 128.0.6613.36, not Slack/);
  assert.equal(ports.checkIdentity(ua("discord/1.0.9170 Chrome/128 Electron/32.0.0"), slack, [1]).ok, false, "another Electron app we didn't start");
});

// ---------------------------------------------------------------- processes
test("process matching: main process only, not Morse itself, same profile for browsers, debugging port read back", () => {
  const ps = apps.parsePs(`
    1 0 /sbin/launchd
  500 1 /Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9334
  501 500 /Applications/Slack.app/Contents/Frameworks/Slack Helper (Renderer).app/Contents/MacOS/Slack Helper (Renderer) --type=renderer
  700 1 /bin/zsh
  ${process.pid} 700 node daemon/cli.js launch /Applications/Slack.app`);
  assert.equal(ps.length, 5);
  const slack = { id: "slack", name: "Slack", path: "/Applications/Slack.app", exe: "/Applications/Slack.app/Contents/MacOS/Slack" };
  const found = apps.findAppProcesses(slack, ps, { platform: "darwin" });
  assert.deepEqual(found.map(p => p.pid), [500]);
  assert.equal(apps.debugPortOf(found[0].cmd), 9334);
  const linux = apps.parsePs(`10 1 /opt/chrome/chrome --user-data-dir=/p/a --no-first-run
11 10 /opt/chrome/chrome --type=renderer --user-data-dir=/p/a
12 1 /opt/chrome/chrome --user-data-dir=/p/b`);
  const chrome = { id: "chrome", name: "Chrome", path: "/opt/chrome/chrome", browser: true, processName: "chrome" };
  assert.deepEqual(apps.findAppProcesses(chrome, linux, { platform: "linux", extraArgs: ["--user-data-dir=/p/b"] }).map(p => p.pid), [12]);
  const win = apps.parseWinProcesses(JSON.stringify([
    { ProcessId: 20, ParentProcessId: 1, ExecutablePath: "C:\\Users\\sam\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe", CommandLine: "\"C:\\Users\\sam\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe\"" },
    { ProcessId: 21, ParentProcessId: 20, ExecutablePath: "C:\\Users\\sam\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe", CommandLine: "Discord.exe --type=gpu-process" },
  ]));
  const discord = { id: "discord", name: "Discord", exe: "C:\\Users\\sam\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe", processName: "Discord.exe", source: "C:\\Users\\sam\\AppData\\Local\\Discord" };
  assert.deepEqual(apps.findAppProcesses(discord, win, { platform: "win32" }).map(p => p.pid), [20]);
});

test("per-app choices are remembered in ~/.morse/apps.json", async () => {
  await apps.saveAppPref("slack", { restart: true, port: 9334 });
  await apps.saveAppPref("slack", { restart: null });
  assert.deepEqual((await apps.loadAppPrefs()).slack, { port: 9334 });
  assert.ok(existsSync(path.join(home, "apps.json")));
});

// ---------------------------------------------------------------- live: fake multi-window app
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
const CHROME = chromium?.executablePath();

let fake, server, port, profile, proc, conn, logs = [], running;
const { serveFakeApp, launchFakeApp, fakeAppArgs } = await import("../demo/fake-app.js");
const { CDPSession, listTargets, waitForEndpoint } = await import("../daemon/cdp.js");

// Evaluate in the first target whose url matches, over our own CDP session.
async function evalIn(match, expression) {
  const t = (await listTargets(port)).find(x => x.type !== "service_worker" && match.test(x.url));
  if (!t) throw new Error("no target " + match);
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  try { return (await s.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true })).result?.value; }
  finally { s.close(); }
}
// The same, in Morse's isolated world ("morse") of the target's top frame,
// where the runtime and its host live; false when there is none.
async function evalInMorse(match, expression) {
  const t = (await listTargets(port)).find(x => x.type !== "service_worker" && match.test(x.url));
  if (!t) throw new Error("no target " + match);
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  try {
    const worlds = [];
    s.on("Runtime.executionContextCreated", ({ context: c }) => { if (c.name === "morse") worlds.push(c); });
    await s.send("Runtime.enable");
    const top = (await s.send("Page.getFrameTree")).frameTree.frame.id;
    for (const c of worlds.filter(c => c.auxData?.frameId === top)) {
      const v = (await s.send("Runtime.evaluate", { expression, contextId: c.id, returnByValue: true }).catch(() => null))?.result?.value;
      if (v) return v;
    }
    return false;
  } finally { s.close(); }
}
// The runtime is up in Morse's world, and the page's own world sees none of its host.
const pageSeesNoHost = "!globalThis.__morseHost && !globalThis.__morseHostSend && !globalThis.__morseHostReceive";
const hasRuntime = async (re, also = "true") => {
  try {
    return !!(await evalIn(re, `${pageSeesNoHost} && !!document.querySelector('[data-morse-ui]') && (${also})`)) && !!(await evalInMorse(re, "!!globalThis.__morseHost"));
  } catch { return false; }
};

before(async () => {
  if (skip) return;
  server = await serveFakeApp();
  port = await ports.pickPort({ range: [9600, 9700] });
  profile = path.join(home, "fake-app-profile");
  proc = launchFakeApp({ chrome: CHROME, port, server, profile });
  await waitForEndpoint(port);
  const { Connector } = await import("../daemon/connector.js");
  conn = new Connector({
    port, app: { id: "fakemail", name: "Fake Mail" }, settings: { provider: "demo", model: "demo" }, log: l => logs.push(l), watch: true, interval: 200,
    verify: async () => ports.checkIdentity(await ports.identify(port), { id: "fakemail", name: "Fake Mail" }, [proc.pid]),
  });
  running = conn.run();
});
after(async () => {
  if (skip) return;
  await conn?.stop().catch(() => {});
  proc?.kill("SIGKILL");
  server?.close();
});

test("attaches to the main window and the app's own frame, not the third-party embed", { skip }, async () => {
  await until(() => conn.windows.size >= 2, 15000, "two targets");
  const kinds = [...conn.windows.values()].map(w => `${w.kind} ${new URL(w.url).hostname}`).sort();
  assert.deepEqual(kinds, ["frame files.fake.test", "window app.fake.test"]);
  await until(() => hasRuntime(/app\.fake\.test:\d+\/$/), 10000, "runtime in the main window");
  await until(() => hasRuntime(/files\.fake\.test/), 10000, "runtime in the app frame");
  assert.equal(await evalIn(/video\.example\.test/, "!!document.querySelector('[data-morse-ui]')"), false, "third-party embed left alone");
  assert.equal(await evalInMorse(/video\.example\.test/, "!!globalThis.__morseHost"), false);
});

test("a window opened later gets the runtime, and a saved mod shows up in every window it matches", { skip }, async () => {
  await evalIn(/app\.fake\.test:\d+\/$/, "document.getElementById('compose').click()");
  await until(() => [...conn.windows.values()].some(w => w.url.endsWith("/compose")), 10000, "popup attached");
  await until(() => hasRuntime(/\/compose$/), 10000, "runtime in the popup");
  const mod = await store.saveMod(createMod({ prompt: "outline everything", title: "Outline", css: "main { outline: 3px solid #3fb950 }", js: "", url: server.url(), app: "fakemail" }));
  const styled = re => evalIn(re, `!!document.querySelector('style[data-morse-css="${mod.id}"]')`).catch(() => false);
  await until(() => styled(/app\.fake\.test:\d+\/$/), 10000, "mod in the main window");
  await until(() => styled(/\/compose$/), 10000, "mod in the popup");
  assert.equal(await styled(/files\.fake\.test/), false, "mods stay on their own host");
});

test("reloads, navigation and a page that reloads itself keep the runtime and the mods", { skip }, async () => {
  await evalIn(/app\.fake\.test:\d+\/$/, "window.__before = 1; location.reload()");
  await until(() => hasRuntime(/app\.fake\.test:\d+\/$/, "!window.__before"), 10000, "runtime after reload");
  await evalIn(/\/compose$/, "location.href = '/settings'");
  await until(() => hasRuntime(/\/settings$/), 10000, "runtime after navigating");
  await until(() => evalIn(/\/settings$/, "!!document.querySelector('style[data-morse-css]')"), 10000, "mods after navigating");
  await evalIn(/\/settings$/, "location.href = '/reloader'");
  await until(() => hasRuntime(/\/reloader$/, "document.getElementById('n')?.textContent === 'load 3'"), 15000, "runtime after self reloads");
});

test("a renderer crash: Morse notices, and the runtime is back once the page reloads", { skip }, async () => {
  const t = (await listTargets(port)).find(x => /\/reloader$/.test(x.url));
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  s.send("Page.crash").catch(() => {});
  await until(() => logs.some(l => /stopped working/.test(l)), 10000, "crash noticed");
  await sleep(300);
  await s.send("Page.reload").catch(async () => {
    const s2 = await CDPSession.connect(t.webSocketDebuggerUrl);
    await s2.send("Page.reload"); s2.close();
  });
  s.close();
  await until(() => hasRuntime(/\/reloader$/), 15000, "runtime after crash + reload");
});

test("the app is killed and started again: --watch waits, verifies and reattaches", { skip }, async () => {
  proc.kill("SIGKILL");
  await until(() => conn.state === "waiting", 10000, "waiting state");
  assert.ok(logs.some(l => /closed\. Waiting for it to open again/.test(l)));
  proc = launchFakeApp({ chrome: CHROME, port, server, profile });
  await until(() => conn.state === "attached" && conn.windows.size >= 1, 20000, "attached again");
  assert.ok(logs.some(l => /is open again/.test(l)));
  await until(() => hasRuntime(/app\.fake\.test:\d+\/$/), 15000, "runtime after restart");
  await until(() => evalIn(/app\.fake\.test:\d+\/$/, "!!document.querySelector('style[data-morse-css]')"), 10000, "mods after restart");
});

test("stop() detaches: bar and mods come off, new pages stay clean, the app keeps running", { skip }, async () => {
  const MAIN = /app\.fake\.test:\d+\/$/;
  const leftovers = async () => !!(await evalIn(MAIN, "!!globalThis.__morseHost || !!document.querySelector('[data-morse-ui], style[data-morse-css]')")) || !!(await evalInMorse(MAIN, "!!globalThis.__morseHost"));
  await conn.stop();
  assert.equal(await running, "stopped");
  await sleep(300); // the runtime's own observer must not put the bar back
  assert.equal(await leftovers(), false);
  // attaching again to the same, never reloaded document brings Morse back
  const { Connector } = await import("../daemon/connector.js");
  const again = new Connector({ port, app: { id: "fakemail", name: "Fake Mail" }, settings: { provider: "demo", model: "demo" }, log: () => {}, interval: 200 });
  const r2 = again.run();
  await until(() => hasRuntime(MAIN), 10000, "runtime after attaching again");
  await until(() => evalIn(MAIN, "!!document.querySelector('style[data-morse-css]')"), 10000, "mods after attaching again");
  await again.stop();
  await r2;
  await sleep(300);
  assert.equal(await leftovers(), false);
  await evalIn(MAIN, "location.reload()");
  await sleep(1200);
  assert.equal(await evalIn(/app\.fake\.test:\d+\/$/, "!!document.querySelector('[data-morse-ui]')"), false);
  assert.equal(await evalInMorse(/app\.fake\.test:\d+\/$/, "!!globalThis.__morseHost"), false);
});

test("without --watch, the app quitting ends the session cleanly", { skip }, async () => {
  const { Connector } = await import("../daemon/connector.js");
  const c = new Connector({ port, app: { id: "fakemail", name: "Fake Mail" }, settings: { provider: "demo", model: "demo" }, log: l => logs.push(l), interval: 200 });
  const done = c.run();
  await until(() => c.windows.size >= 1, 10000, "attached");
  proc.kill("SIGTERM");
  assert.equal(await done, "stopped");
  assert.ok(logs.some(l => l === "Fake Mail closed, so Morse stopped."));
});

// ---------------------------------------------------------------- live: the CLI
function cli(args, env = {}) {
  const p = spawn(process.execPath, [path.join(root, "daemon/cli.js"), ...args], { env: { ...process.env, MORSE_HOME: home, FORCE_COLOR: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.out = "";
  p.stdout.on("data", d => { p.out += d; });
  p.stderr.on("data", d => { p.out += d; });
  p.done = new Promise(r => p.on("exit", code => r(code)));
  return p;
}
const cliOut = args => new Promise(r => execFile(process.execPath, [path.join(root, "daemon/cli.js"), ...args], { env: { ...process.env, MORSE_HOME: home } }, (e, so, se) => r({ code: e?.code || 0, out: so + se })));
const strip = s => s.replace(/\x1b\[\d+m/g, "");

test("CLI: already open → one plain sentence; --restart quits it, relaunches on a free port, status and stop work", { skip, timeout: 90000 }, async () => {
  const prof = path.join(home, "cli-profile");
  const extra = fakeAppArgs({ server, profile: prof }).filter(a => !a.startsWith("http"));
  // the app is open without a debugging port
  const plain = spawn(CHROME, [...extra, server.url()], { stdio: "ignore" });
  await sleep(1500);
  const refused = await cliOut(["launch", CHROME, "--name", "Fake Mail", "--", ...extra, `--app=${server.url()}`]);
  assert.equal(refused.code, 1);
  assert.match(strip(refused.out), /Fake Mail is already open\. Morse can only connect to an app when it starts\. Run morse launch fake-mail --restart/);

  const m = cli(["launch", CHROME, "--name", "Fake Mail", "--restart", "--", ...extra, `--app=${server.url()}`]);
  try {
    await until(() => /connected to (Inbox|app\.fake\.test)/.test(m.out), 30000, () => "CLI attached: " + m.out);
    assert.match(m.out, /quitting Fake Mail/);
    assert.equal(plain.exitCode !== null || plain.signalCode !== null, true, "the old instance quit");
    const used = Number(m.out.match(/port +(\d+)/)[1]);
    assert.ok(used >= 9333 && used <= 9399, "a port from Morse's range");
    assert.equal((await apps.loadAppPrefs())["fake-mail"].restart, true, "--restart remembered");
    await store.saveMod(createMod({ prompt: "x", title: "Compact list", css: "main{gap:4px}", js: "", url: server.url(), app: null }));
    const st = await until(async () => { const o = strip((await cliOut(["status"])).out); return /Attachment preview/.test(o) && /mods on/.test(o) && o; }, 15000, "status with the frame");
    assert.match(st, new RegExp(`Fake Mail +● connected · port ${used} \\(this computer only\\)`));
    assert.match(st, /window +Inbox — Fake Mail/);
    assert.match(st, /frame +Attachment preview/);
    assert.match(st, /mods on: Compact list/);
    // a second launch doesn't fight the first
    const again = strip((await cliOut(["launch", CHROME, "--name", "Fake Mail", "--", ...extra])).out);
    assert.match(again, /Morse is already connected to Fake Mail on port/);
    const stop = strip((await cliOut(["stop", "fake"])).out);
    assert.match(stop, /Disconnected from Fake Mail/);
    assert.equal(await m.done, 0);
    assert.match(strip((await cliOut(["status"])).out), /Morse isn't connected to any app/);
    assert.equal(existsSync(path.join(home, "sessions", "fake-mail.json")), false);
  } finally {
    m.kill("SIGKILL");
    plain.kill("SIGKILL");
    // quit the relaunched instance
    for (const p of apps.findAppProcesses({ id: "x", name: "x", path: CHROME, browser: true, processName: "chrome" }, apps.listProcesses(), { extraArgs: [`--user-data-dir=${prof}`] })) try { process.kill(p.pid, "SIGKILL"); } catch {}
  }
});

test("CLI: refuses a --port another program already answers on", { skip }, async () => {
  const imposter = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ Browser: "Chrome/120.0.0.0", "User-Agent": "Chrome/120" }))).listen(0, "127.0.0.1");
  await new Promise(r => imposter.on("listening", r));
  const p = imposter.address().port;
  const r = await cliOut(["launch", CHROME, "--name", "Other", "--port", String(p), "--", `--user-data-dir=${path.join(home, "other")}`, "--headless=new"]);
  imposter.close();
  assert.equal(r.code, 1);
  assert.match(strip(r.out), new RegExp(`Port ${p} is already used by another program`));
});

test("status files: stale sessions are dropped; stop matches names loosely", async () => {
  await status.writeSession({ id: "ghost", name: "Ghost", pid: 2 ** 22 + 12345, port: 9399, state: "attached", windows: [] });
  assert.deepEqual((await status.readSessions()).map(s => s.id).filter(id => id === "ghost"), []);
  assert.equal(existsSync(path.join(home, "sessions", "ghost.json")), false);
  await status.writeSession({ id: "vscode", name: "VS Code", aliases: ["code"], pid: process.pid, port: 9333, state: "attached", windows: [{ id: "1", type: "page", title: "app.ts — morse", url: "vscode-file://vscode-app/workbench.html" }] });
  const out = status.formatStatus(await status.withMods(await status.readSessions()));
  assert.match(strip(out), /VS Code {2}● connected · port 9333/);
  assert.match(strip(out), /window +app\.ts — morse/);
  const r = await status.stopSession("nonexistent");
  assert.match(r.message, /isn't connected to "nonexistent"/);
  status.removeSession("vscode");
});
