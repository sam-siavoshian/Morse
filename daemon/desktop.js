// The desktop commands: morse apps · launch · attach · status · stop.
// cli.js only dispatches here; the pieces live in apps.js (finding, quitting,
// launching), ports.js (port safety), connector.js (attaching) and status.js.

import { createInterface } from "node:readline/promises";
import { Connector } from "./connector.js";
import { waitForEndpoint } from "./cdp.js";
import { inspectFuses, fuseVerdict, electronBinaryFor } from "./fuses.js";
import {
  hostContext, discoverApps, resolveApp, launchApp, waitForLaunch, quitApp, listProcesses, findAppProcesses, debugPortOf,
  loadAppPrefs, saveAppPref, formatApps, said, closedEarly,
} from "./apps.js";
import { pickPort, portFree, portAnswers, reachableFrom, identify, checkIdentity } from "./ports.js";
import { readSessions, publishSession, stopRequested, stopSession, withMods, formatStatus } from "./status.js";
import { settingsLabel } from "../core/providers.js";
import { t } from "../core/i18n.js"; // daemon/cli.js sets the language from LANG / LC_ALL
import { paint } from "./colors.js";

const { g: G, d: D, b: B } = paint;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
  for (const s of r.stopped) console.log(t("launch.stopped", { name: B(s.name) }));
}

export async function launchCommand(f, { settingsFrom, logo }) {
  const ctx = hostContext();
  const app = resolveApp(f._.join(" "), { ctx });
  if (f.name) Object.assign(app, { id: slug(f.name), name: String(f.name), aliases: [...(app.aliases || []), app.name] });
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
    launchApp(app, existing.port, extra);
    console.log(`\n  ${t("launch.waiting", { name: app.name, port: existing.port })}`);
    return;
  }
  if (existing) {
    console.log(`\n  ${t("launch.already", { name: app.name, port: existing.port, status: B("morse status"), stop: B(`morse stop ${app.id}`) })}`);
    return;
  }

  const ready = await connectApp(app, {
    extra, pref, port: f.port, restart: f.restart === true, noRestart: !!f["no-restart"],
    ask: process.stdin.isTTY && process.stdout.isTTY
      ? () => ask(`\n  ${t("launch.isOpen", { name: app.name })}\n  ${t("launch.restartAsk")} ${D(t("launch.restartKeys", { name: app.name }))} `)
      : null,
    say: line => console.log(`  ${line}`),
  });
  console.log(`  port    ${ready.port} ${D("(127.0.0.1 only)")}`);
  console.log(`  engine  ${ready.who.browser.replace("/", " ")}${ready.who.electron ? ` · Electron ${ready.who.electron}` : ""}\n`);
  return runSession({ port: ready.port, app, settings, watch: !!f.watch, verify: ready.verify, who: ready.who });
}

// The steps of `morse launch` once the app is chosen, without the terminal
// (Morse Desktop runs the same ones): connect to the app if it is already open
// with a debugging port; otherwise quit it (when allowed) and open it again on
// a free port; then check that the port is for this computer only and that
// the app is the one we started. Resolves { port, pids, who, verify }.
//   restart, noRestart  the --restart and --no-restart flags
//   ask(app)            asks whether to quit the open app: "y", "n" or "a" (always); null: don't ask
//   say(line)           progress, one line at a time
// Throws a plain error (said) when the app is open and may not be restarted
// (with .running = true), or when Morse can't connect to it.
export async function connectApp(app, { extra = [], pref = null, port: wantPort = null, restart: restartFlag = false, noRestart = false, ask: askRestart = null, say = () => {} } = {}) {
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
      let restart = restartFlag || (pref.restart === true && !noRestart);
      if (!restart && !noRestart && askRestart) {
        const a = await askRestart(app);
        if (a === "a") await saveAppPref(app.id, { restart: true });
        restart = a === "y" || a === "a";
      }
      if (!restart) throw Object.assign(said(`${t("launch.isOpen", { name: app.name })} ${t("launch.restartHow", { cmd: B(`morse launch ${app.id} --restart`) })}`), { running: true });
      say(t("launch.quitting", { name: app.name }));
      if (!await quitApp(app, { procs, extraArgs: extra })) throw said(t("launch.didntQuit", { name: app.name }));
    }
  }
  if (restartFlag && !pref.restart) await saveAppPref(app.id, { restart: true });
  if (noRestart && pref.restart) await saveAppPref(app.id, { restart: null });

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
  const who = await identify(port).catch(e => { throw gone(e); });
  const v = checkIdentity(who, app, pids);
  if (!v.ok) throw said(`Morse didn't connect: ${v.why}.`);

  const verify = async () => {
    const mine = findAppProcesses(app, listProcesses(), { extraArgs: extra }).filter(p => debugPortOf(p.cmd) === port).map(p => p.pid);
    return checkIdentity(await identify(port), app, mine);
  };
  return { port, pids, who, verify };
}

export async function attachCommand(f, { settingsFrom, logo }) {
  const port = Number(f.port || 9222);
  const settings = await settingsFrom(f);
  await waitForEndpoint(port, 3000);
  const exposed = await reachableFrom(port);
  if (exposed.length) throw said(`Port ${port} can be reached from other computers (${exposed.join(", ")}), so Morse won't use it.`);
  const who = await identify(port);
  const name = f.app ? String(f.app) : `App on port ${port}`;
  console.log(logo + `\n\n  connected on port ${port} · ${who.browser.replace("/", " ")}${who.electron ? ` · Electron ${who.electron}` : ""} · model ${settingsLabel(settings)}\n`);
  const app = f.app ? { id: slug(f.app), name } : null;
  return runSession({ port, app, id: app?.id || `port-${port}`, name, settings, watch: !!f.watch, who });
}

// Runs the connector until the app quits, `morse stop`, or Ctrl+C, keeping
// ~/.morse/sessions/<id>.json current for `morse status`.
async function runSession({ port, app, id = app.id, name = app.name, settings, watch, verify = null, who }) {
  const session = startSession({ port, app, id, name, settings, watch, verify, who });
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
export function startSession({ port, app, id = app.id, name = app.name, settings, watch = false, verify = null, who, log = console.log, onChange = null }) {
  const modsApp = app && !app.browser ? app : null;
  const connector = new Connector({ port, app: modsApp, settings, watch, verify, log, onChange: () => { pub.changed(); onChange?.(connector); } });
  const pub = publishSession(connector, {
    id, name, path: app?.path || null, aliases: app?.aliases || [], modsApp: modsApp?.id ?? null,
    browser: who?.browser || null, electron: who?.electron || null, started: new Date().toISOString(),
  });
  let stopping = null;
  const session = {
    id, name, connector,
    flushed: pub.flush(),
    onStopRequested: null,
    stop: () => (stopping ||= (async () => { clearInterval(poll); await connector.stop(); await pub.close(); })()),
  };
  const poll = setInterval(() => { if (!stopping && stopRequested(id)) (session.onStopRequested || session.stop)(); }, 400);
  session.done = session.flushed.then(() => connector.run()).then(async state => { clearInterval(poll); await pub.close(); return state; });
  return session;
}
