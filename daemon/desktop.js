// The desktop commands: morse apps · launch · attach · status · stop.
// cli.js only dispatches here; the pieces live in apps.js (finding, quitting,
// launching), ports.js (port safety), cdp.js (the private pipe),
// connector.js (attaching) and status.js.

import { createInterface } from "node:readline/promises";
import { statSync } from "node:fs";
import { Connector } from "./connector.js";
import { waitForEndpoint, pipeBrowser, portBrowser, identifyPipe } from "./cdp.js";
import { inspectFuses, fuseVerdict, electronBinaryFor } from "./fuses.js";
import {
  hostContext, discoverApps, resolveApp, launchApp, waitForLaunch, quitApp, listProcesses, findAppProcesses, debugPortOf,
  loadAppPrefs, saveAppPref, formatApps, said, closedEarly, PIPE, pipeFor, executableFor, launchFailure,
} from "./apps.js";
import { pickPort, portFree, portAnswers, reachableFrom, identify, checkIdentity, portIsMine } from "./ports.js";
import { readSessions, publishSession, stopRequested, stopSession, withMods, formatStatus, requestOpen, takeOpenRequest, writeSession, removeSession, isAlive } from "./status.js";
import { nativeAvailable, nativePid, connectNative } from "./native-dbi.js";
import { carrySignIns } from "./browser-profile.js";
import { createMacAccess, desktopProgram, fileStore, macAccessFile, readAppManagementStatus, relaunchDesktop, clearAppManagementCache, prepareAppOpen } from "./mac-access.js";
import { trace } from "./trace.js"; // MORSE_TRACE: which way Morse reached the app
import { settingsLabel } from "../core/providers.js";
import { t } from "../core/i18n.js"; // daemon/cli.js sets the language from LANG / LC_ALL
import { paint } from "./colors.js";

const { g: G, d: D, b: B } = paint;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The Morse app on macOS, just before it opens another app. The terminal
// client is a different program (macOS asks about the terminal, not
// Morse), so this stays out of its way. See daemon/mac-access.js.
// A wait or a denial does not throw: that banner replaced the launch, so
// Open with Morse never started the app and never asked again.
let macGate = null;
function accessGate() {
  const program = desktopProgram();
  if (!program) return null;
  macGate ??= createMacAccess({
    program: () => desktopProgram() || program,
    readStatus: () => readAppManagementStatus(),
    store: fileStore(macAccessFile()),
  });
  return macGate;
}

// Nothing at the program we would run. Said before a restart question and
// before quitting an app that is already open.
function missingLaunch(app) {
  const file = executableFor(app);
  try { if (file && statSync(file).isFile()) return ""; } catch {}
  return launchFailure(app, { error: Object.assign(new Error("missing"), { code: "ENOENT" }) });
}

async function prepareToStart(app, { running, confirmed }) {
  const seq = await prepareAppOpen({
    running, confirmed, missing: missingLaunch(app),
    decide: async () => {
      const gate = accessGate();
      if (!gate) return null;
      clearAppManagementCache();
      return gate.beforeOpen();
    },
  });
  if (seq.step === "askRestart") {
    throw Object.assign(said(`${t("launch.isOpen", { name: app.name })} ${t("launch.restartHow", { cmd: B(`morse launch ${app.id} --restart`) })}`), { running: true });
  }
  if (seq.step === "error") throw said(seq.message);
  if (seq.step === "restartMorse") {
    await relaunchDesktop(seq.plan);
    throw said(seq.message);
  }
  return seq;
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim().toLowerCase().slice(0, 1); } finally { rl.close(); }
}

export async function appsCommand(f) {
  const ctx = hostContext();
  const apps = discoverApps(ctx);
  const procs = listProcesses();
  const sessions = await readSessions();
  const running = new Map();
  for (const a of apps) {
    const p = findAppProcesses(a, procs);
    if (p.length) running.set(a.id, { port: p.map(x => debugPortOf(x.cmd)).find(Boolean) || null });
  }
  if (f.json) return console.log(JSON.stringify(apps.map(a => ({ ...a, running: running.has(a.id), attached: sessions.some(s => s.id === a.id) })), null, 2));
  console.log(formatApps(apps, { running, sessions, platform: ctx.platform }));
}

export async function statusCommand(f) {
  const sessions = await withMods(await readSessions());
  if (f.json) return console.log(JSON.stringify(sessions, null, 2));
  console.log(formatStatus(sessions));
}

export async function stopCommand(f) {
  const query = f._.join(" ") || (f.all ? "all" : "");
  const r = await stopSession(query);
  if (!r.stopped.length) { console.log(r.message); return; }
  // On the pipe there is no port left to close.
  for (const s of r.stopped) console.log(t(s.port ? "launch.stopped" : "launch.disconnectedRunning", { name: B(s.name) }));
}

export async function launchCommand(f, { settingsFrom, logo }) {
  const ctx = hostContext();
  const app = resolveApp(f._.join(" "), { ctx });
  if (f.name) Object.assign(app, { id: slug(f.name), name: String(f.name), aliases: [...(app.aliases || []), app.name] });
  // Native apps take the experimental DBI route (native-dbi/), not CDP.
  if (app.engine === "native" || app.dbi) return launchNative(app, { logo });
  if (app.canAttach === false) throw said(t("launch.cant", { name: app.name, why: app.why }));
  const extra = f.rest || [];
  const pref = (await loadAppPrefs())[app.id] || {};
  const settings = await settingsFrom(f);

  console.log(logo + "\n");
  console.log(`  app     ${B(app.name)} ${D(app.path)}`);
  try {
    const info = await inspectFuses(await electronBinaryFor(app.path));
    if (info.electron) {
      console.log(`  fuses   ${Object.entries(info.fuses).filter(([k]) => /Inspect|Asar|RunAsNode/.test(k)).map(([k, v]) => `${k}=${v}`).join("  ")}`);
      for (const line of fuseVerdict(info)) console.log(D(`          ${line}`));
    }
  } catch {}
  console.log(`  model   ${settingsLabel(settings)}`);

  // Another Morse already has this app.
  const existing = (await readSessions()).find(s => s.id === app.id);
  if (existing?.state === "waiting") {
    // On a port, open the app on that port and the waiting Morse finds it.
    // On the pipe, only the waiting Morse can open it (the pipe is its own).
    if (existing.port) launchApp(app, existing.port, extra);
    else await requestOpen(app.id, { restart: f.restart === true, extra });
    console.log(`\n  ${existing.port ? t("launch.waiting", { name: app.name, port: existing.port }) : t("launch.waitingPipe", { name: app.name })}`);
    return;
  }
  if (existing) {
    const how = { name: app.name, port: existing.port, status: B("morse status"), stop: B(`morse stop ${app.id}`) };
    console.log(`\n  ${t(existing.port ? "launch.already" : "launch.alreadyPipe", how)}`);
    return;
  }

  const options = {
    extra, pref, port: f.port, restart: f.restart === true, noRestart: !!f["no-restart"],
    ask: process.stdin.isTTY && process.stdout.isTTY
      ? () => ask(`\n  ${t("launch.isOpen", { name: app.name })}\n  ${t("launch.restartAsk")} ${D(t("launch.restartKeys", { name: app.name }))} `)
      : null,
    say: line => console.log(`  ${line}`),
  };
  const ready = await connectApp(app, options);
  console.log(ready.browser ? `  channel private pipe ${D("(no debugging port: only this Morse can reach the app)")}` : `  port    ${ready.port} ${D("(127.0.0.1 only)")}`);
  console.log(`  engine  ${ready.who.browser.replace("/", " ")}${ready.who.electron ? ` · Electron ${ready.who.electron}` : ""}\n`);
  // --watch on the pipe: `morse launch <app>` from another terminal asks this
  // Morse to open the app again (status.js requestOpen).
  const reopen = req => connectApp(app, { ...options, port: null, pref: null, ask: null, extra: req.extra.length ? req.extra : extra, restart: req.restart, noRestart: false });
  return runSession({ port: ready.port, browser: ready.browser, app, settings, watch: !!f.watch, verify: ready.verify, who: ready.who, reopen });
}

// `morse launch` for a native app: the experimental DBI route. Native support
// attaches to a process the person already started (it doesn't spawn or inject
// into a fresh launch), so the app must be running. Everything hard — the
// ownership gate, the platform assessment, frida being optional — lives in
// daemon/native-dbi.js and native-dbi/; this prints the flow and holds the
// session so `morse status` / `morse stop` work like any other.
async function launchNative(app, { logo }) {
  console.log(logo + "\n");
  console.log(`  app     ${B(app.name)} ${D(app.path)}`);
  console.log(`  engine  ${D("native · experimental (dynamic binary instrumentation)")}`);

  const avail = await nativeAvailable();
  if (!avail.ok) throw said(avail.message);

  const pid = nativePid(app);
  if (!pid) throw said(`${app.name} isn't running. Native support attaches to a process you already started, so open ${app.name} first, then run ${B(`morse launch ${app.id}`)} again.`);
  console.log(`  pid     ${pid}`);

  const existing = (await readSessions()).find(s => s.id === app.id);
  if (existing) { console.log(`\n  ${t("launch.already", { name: app.name, port: existing.port, status: B("morse status"), stop: B(`morse stop ${app.id}`) })}`); return; }

  const res = await connectNative(app, { pid, mods: [], onEvent: (kind, e) => {
    if (kind === "mod") console.log(`  ${e.level === "error" ? "!" : "·"} ${D(`${e.id}: ${e.message}`)}`);
    else if (kind === "error") console.log(`  ! ${e.message}`);
    else if (kind === "detached") { /* handled by runNativeSession */ }
  } });

  console.log("");
  for (const line of String(res.diagnostics || "").split("\n").filter(Boolean)) console.log(D(`  ${line}`));
  if (!res.ok) throw said(res.reason === "frida-missing" ? res.diagnostics : `Morse couldn't attach to ${app.name}. ${res.reason === "unauthorized" ? "" : "See the reason above."}`.trim());

  console.log(`\n  ${B("attached")} ${D("· no native mods yet — this is an experimental connection to build native mods against")}\n`);
  return runNativeSession({ app, session: res.session, targetPid: pid });
}

// Hold a native session open: keep its status file current, detach cleanly on
// stop / the app quitting / Ctrl-C. The native cousin of runSession, without a
// Connector (there is no CDP, no windows).
async function runNativeSession({ app, session, targetPid }) {
  const id = app.id, name = app.name;
  const record = () => ({ id, name, path: app.path || null, aliases: app.aliases || [], pid: process.pid,
    port: null, transport: "frida", native: true, state: "attached", windows: [], started: new Date().toISOString() });
  await writeSession(record());
  const beat = setInterval(() => { writeSession(record()).catch(() => {}); }, 5000); beat.unref?.();

  let ending = false;
  const finish = async (how) => {
    if (ending) return;
    ending = true;
    clearInterval(beat); clearInterval(poll);
    try { await session?.detach(); } catch {}
    removeSession(id);
    console.log(how === "stop" ? t("launch.disconnected", { name }) : `\n${t("launch.disconnectedRunning", { name })}`);
    process.exit(0);
  };
  session?.on?.("detached", () => finish("stop"));
  const poll = setInterval(() => {
    if (ending) return;
    if (stopRequested(id)) return finish("stop");
    if (targetPid && !isAlive(targetPid)) return finish("gone");
  }, 400);
  process.once("SIGINT", () => finish("interrupt"));
  process.once("SIGTERM", () => finish("stop"));
  await new Promise(() => {}); // held open until finish() exits the process
}

// The steps of `morse launch` once the app is chosen, without the terminal
// (Morse Desktop runs the same ones): connect to the app if it is already open
// with a debugging port; otherwise quit it (when allowed) and open it again,
// on the private pipe where the app supports it (apps.js pipeFor), else on a
// free port; on a port, check that it is for this computer only and that the
// app is the one we started. Resolves { port, browser, pids, who, verify }:
// browser is the pipe (cdp.js pipeBrowser), with port null.
//   port                --port: use a debugging port, this one
//   restart, noRestart  the --restart and --no-restart flags
//   ask(app)            asks whether to quit the open app: "y", "n" or "a" (always); null: don't ask
//   say(line)           progress, one line at a time
//   mine(port)          false: another account's program holds the port (ports.js portIsMine; tests pass their own)
//   pipe                false: never the pipe (tests)
// Throws a plain error (said) when the app is open and may not be restarted
// (with .running = true), or when Morse can't connect to it.
export async function connectApp(app, { extra = [], pref = null, port: wantPort = null, restart: restartFlag = false, noRestart = false, ask: askRestart = null, say = () => {}, mine = portIsMine, pipe: allowPipe = true } = {}) {
  pref ??= (await loadAppPrefs())[app.id] || {};
  // Already open?
  let port = null, pids = [];
  const procs = listProcesses();
  const running = findAppProcesses(app, procs, { extraArgs: extra });
  if (running.length) {
    const open = running.map(p => ({ pid: p.pid, port: debugPortOf(p.cmd) })).find(p => p.port);
    if (open && await portAnswers(open.port)) {
      const v = checkIdentity(await identify(open.port), app, running.map(p => p.pid));
      if (v.ok) { port = open.port; pids = running.map(p => p.pid); say(t("launch.openWithPort", { name: app.name })); }
    }
    if (!port) {
      // A missing program is that error: the app stays open, and it is not
      // the App Management banner. The restart question is not an ask.
      // macOS asks when we start the app, after the person confirms.
      const missing = missingLaunch(app);
      if (missing) throw said(missing);
      let restart = restartFlag || (pref.restart === true && !noRestart);
      if (!restart && !noRestart && askRestart) {
        const a = await askRestart(app);
        if (a === "a") await saveAppPref(app.id, { restart: true });
        restart = a === "y" || a === "a";
      }
      const seq = await prepareToStart(app, { running: true, confirmed: !!restart });
      if (seq.step === "quitAndLaunch") {
        say(t("launch.quitting", { name: app.name }));
        if (!await quitApp(app, { procs, extraArgs: extra })) throw said(t("launch.didntQuit", { name: app.name }));
      }
    }
  }
  if (restartFlag && !pref.restart) await saveAppPref(app.id, { restart: true });
  if (noRestart && pref.restart) await saveAppPref(app.id, { restart: null });

  // Not already open: the same check, once, before Morse starts it.
  if (!port && !running.length) await prepareToStart(app, { running: false, confirmed: true });

  // A browser opens on Morse's copy of its profile, with every sign-in of the
  // everyday one in it (daemon/browser-profile.js). The browser is closed here.
  if (!port && app.browser && !extra.some(a => /^--user-data-dir/.test(a))) {
    try {
      const r = await carrySignIns(app, { say: () => say(t("launch.carry", { name: app.name })), log: m => trace("connect", m) });
      if (r.merged) trace("connect", `${r.merged} sign-ins from your everyday ${app.name} brought in`);
    } catch (e) { throw said(e.message); }
  }

  // Launch on the private pipe: nothing to pick, guard or check, since only
  // this process holds the other end.
  if (!port && !wantPort && allowPipe && pipeFor(app).ok) {
    const opened = await openOnPipe(app, extra, say);
    if (opened) return opened;
  }

  // Launch on a free port.
  if (!port) {
    if (wantPort) {
      port = Number(wantPort);
      if (!await portFree(port)) throw said(`Port ${port} is already used by another program. Leave out --port and Morse picks a free one.`);
    } else port = await pickPort({ preferred: [pref.port].filter(Boolean) });
    const child = launchApp(app, port, extra);
    pids = [child.pid];
    // Says why when the app dies on start. An AppImage that has to unpack
    // itself first (no FUSE, apps.js appImageEnv) can take a minute.
    await waitForLaunch(child, app, port, app.appimage ? { timeoutMs: 120000 } : undefined);
    // What we started handed over to the real app (Squirrel's Update.exe,
    // flatpak, snap): the app is the process that has our port.
    if (child.handoff || child.exited) {
      const real = findAppProcesses(app, listProcesses(), { extraArgs: extra }).filter(p => debugPortOf(p.cmd) === port).map(p => p.pid);
      if (real.length) pids = real;
    }
    if (pref.port !== port) await saveAppPref(app.id, { port });
  }

  // Only this computer, and only the app we meant.
  // dogfood: an app that quits right after opening its port made these fail
  // with "fetch failed", which read as "Morse couldn't reach the model".
  const gone = e => { const m = closedEarly(app, e); return m ? said(m) : e; };
  const exposed = await reachableFrom(port).catch(e => { throw gone(e); });
  if (exposed.length) throw said(`Port ${port} can be reached from other computers (${exposed.join(", ")}), so Morse won't use it. Quit ${app.name} to close it.`);
  // A program another account started can take the port before the app does
  // and answer as the app (it says what user agent and process id it has),
  // so who holds the port is asked of the system where it tells (Linux).
  if (mine(port) === false) throw said(otherAccount(port, app.name));
  const who = await identify(port).catch(e => { throw gone(e); });
  const v = checkIdentity(who, app, pids);
  if (!v.ok) throw said(`Morse didn't connect: ${v.why}.`);

  const verify = async () => {
    if (mine(port) === false) return { ok: false, why: `another account on this computer has a program on port ${port}` };
    const ours = findAppProcesses(app, listProcesses(), { extraArgs: extra }).filter(p => debugPortOf(p.cmd) === port).map(p => p.pid);
    return checkIdentity(await identify(port), app, ours);
  };
  trace("connect", `${app.name} on debugging port ${port} (127.0.0.1): any program on this computer could connect to it while it runs`);
  return { port, pids, who, verify };
}

// Opens the app with --remote-debugging-pipe and waits for it to answer
// there. Resolves { port: null, browser, pids, who, verify: null }, or null
// when the app runs but never answers (Electron 9 and older ignore the
// switch): that copy is quit, and the caller opens it on a port instead.
// An app that dies on start says why, as on a port.
export async function openOnPipe(app, extra = [], say = () => {}, { timeoutMs = app.appimage ? 120000 : 30000, launch = launchApp } = {}) {
  const child = await launch(app, PIPE, extra);
  const conn = child.cdp;
  try {
    // A closed pipe answers at once: wait as long as an unanswered ask would.
    const wait = async (_, ms) => { if (conn.closed) { await new Promise(r => setTimeout(r, ms)); throw new Error("closed"); } return conn.version(ms); };
    await waitForLaunch(child, app, PIPE, { timeoutMs, wait });
  } catch (e) {
    conn.close();
    if (e.failed) throw e;
    say(t("launch.noPipe", { name: app.name }));
    await endChild(child);
    return null;
  }
  const who = await identifyPipe(conn, 5000).catch(e => { conn.close(); throw said(closedEarly(app, { message: "ECONNRESET" }) || e.message); });
  trace("connect", `${app.name} opened on a private pipe (--remote-debugging-pipe, file descriptors 3 and 4): no debugging port, only this Morse can reach it`);
  return { port: null, browser: pipeBrowser(conn), pids: [...new Set([child.pid, who.pid].filter(Boolean))], who, verify: null };
}

// Quits an app Morse just started (its own process group: launchApp detaches it).
async function endChild(child, { waitMs = 8000 } = {}) {
  const gone = () => child.exited || child.failed;
  const kill = sig => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
  kill("SIGTERM");
  const end = Date.now() + waitMs;
  while (!gone() && Date.now() < end) await new Promise(r => setTimeout(r, 100));
  if (!gone()) kill("SIGKILL");
}
const otherAccount = (port, name) => `Another account on this computer has a program on port ${port}, so Morse won't connect to it. Quit ${name}, then open it with Morse again.`;

export async function attachCommand(f, { settingsFrom, logo }) {
  const port = Number(f.port || 9222);
  const settings = await settingsFrom(f);
  await waitForEndpoint(port, 3000);
  const exposed = await reachableFrom(port);
  if (exposed.length) throw said(`Port ${port} can be reached from other computers (${exposed.join(", ")}), so Morse won't use it.`);
  if (portIsMine(port) === false) throw said(otherAccount(port, f.app ? String(f.app) : "the app"));
  const who = await identify(port);
  const name = f.app ? String(f.app) : `App on port ${port}`;
  console.log(logo + `\n\n  connected on port ${port} · ${who.browser.replace("/", " ")}${who.electron ? ` · Electron ${who.electron}` : ""} · model ${settingsLabel(settings)}\n`);
  const app = f.app ? { id: slug(f.app), name } : null;
  return runSession({ port, app, id: app?.id || `port-${port}`, name, settings, watch: !!f.watch, who });
}

// Runs the connector until the app quits, `morse stop`, or Ctrl+C, keeping
// ~/.morse/sessions/<id>.json current for `morse status`.
async function runSession({ port, browser = null, app, id = app.id, name = app.name, settings, watch, verify = null, who, reopen = null }) {
  const session = startSession({ port, browser, app, id, name, settings, watch, verify, who, reopen });
  await session.flushed;
  let ending = false;
  const finish = async (how) => {
    if (ending) return;
    ending = true;
    await session.stop();
    if (how === "stop") console.log(t("launch.disconnected", { name }));
    else console.log(`\n${t("launch.disconnectedRunning", { name })}`);
    process.exit(0);
  };
  session.onStopRequested = () => finish("stop");
  process.once("SIGINT", () => finish("interrupt"));
  process.once("SIGTERM", () => finish("stop"));
  await session.done;
}

// One connected app, without the terminal. Morse Desktop keeps several in one
// process. It is the connector, its session file (for `morse status`), and
// `morse stop <app>` from a terminal. Returns
//   { id, name, connector, flushed, done, stop(), onStopRequested }
// `done` resolves when the app quits (unless watching) or after stop();
// onStopRequested (stop() when left null) runs when `morse stop` asks.
// port, or browser: the private pipe (connectApp's result). reopen(req):
// while waiting (--watch), opens the app again when `morse launch` asks
// (status.js requestOpen); resolves connectApp's result. keep: stop()
// leaves the pipe open (Morse Desktop connects again over it).
export function startSession({ port, browser = null, app, id = app.id, name = app.name, settings, watch = false, verify = null, who, log = console.log, onChange = null, reopen = null, keep = false }) {
  const modsApp = app && !app.browser ? app : null;
  const connector = new Connector({
    port, browser, app: modsApp, settings, watch, verify, log, onChange: () => { pub.changed(); onChange?.(connector); },
    // Mods stay per site (modsApp is null). The row still has to know this is a
    // browser, or a new tab sits on Connecting with no page Morse can join.
    browserHost: app?.browser ? { name: app.name, id: app.id } : null,
  });
  const pub = publishSession(connector, {
    id, name, path: app?.path || null, aliases: app?.aliases || [], modsApp: modsApp?.id ?? null,
    browser: who?.browser || null, electron: who?.electron || null, started: new Date().toISOString(),
  });
  let stopping = null;
  const session = {
    id, name, connector,
    flushed: pub.flush(),
    onStopRequested: null,
    stop: () => (stopping ||= (async () => { clearInterval(poll); await connector.stop({ keepBrowser: keep }); await pub.close(); })()),
  };
  let opening = false;
  const poll = setInterval(() => {
    if (stopping) return;
    if (stopRequested(id)) return (session.onStopRequested || session.stop)();
    const req = reopen && connector.state === "waiting" && !opening ? takeOpenRequest(id) : null;
    if (!req) return;
    opening = true;
    reopen(req)
      .then(r => { if (!stopping) connector.useBrowser(r.browser || portBrowser(r.port), r.verify); else r.browser?.close(); },
        e => log(`  ! ${e.message}`))
      .finally(() => { opening = false; });
  }, 400);
  session.done = session.flushed.then(() => connector.run()).then(async state => { clearInterval(poll); await pub.close(); return state; });
  return session;
}
