// The desktop commands: morse apps · launch · attach · status · stop.
// cli.js only dispatches here; the pieces live in apps.js (finding, quitting,
// launching), ports.js (port safety), connector.js (attaching) and status.js.

import { createInterface } from "node:readline/promises";
import { Connector } from "./connector.js";
import { waitForEndpoint } from "./cdp.js";
import { inspectFuses, fuseVerdict, electronBinaryFor } from "./fuses.js";
import {
  hostContext, discoverApps, resolveApp, launchApp, waitForLaunch, quitApp, listProcesses, findAppProcesses, debugPortOf,
  loadAppPrefs, saveAppPref, formatApps, said,
} from "./apps.js";
import { pickPort, portFree, portAnswers, reachableFrom, identify, checkIdentity } from "./ports.js";
import { readSessions, publishSession, stopRequested, stopSession, withMods, formatStatus } from "./status.js";
import { settingsLabel } from "../core/providers.js";

const G = s => `\x1b[32m${s}\x1b[0m`, D = s => `\x1b[2m${s}\x1b[0m`, B = s => `\x1b[1m${s}\x1b[0m`;
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
  for (const s of r.stopped) console.log(`Disconnected from ${B(s.name)}. It keeps running without Morse. Its debugging port closes when you quit it.`);
}

export async function launchCommand(f, { settingsFrom, logo }) {
  const ctx = hostContext();
  const app = resolveApp(f._.join(" "), { ctx });
  if (f.name) Object.assign(app, { id: slug(f.name), name: String(f.name), aliases: [...(app.aliases || []), app.name] });
  if (app.canAttach === false) throw said(`${app.name} is a ${app.why}, so Morse can't connect to it.`);
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
    console.log(`\n  Opening ${app.name}. Morse is already waiting for it on port ${existing.port} and will connect.`);
    return;
  }
  if (existing) {
    console.log(`\n  Morse is already connected to ${app.name} on port ${existing.port}. Run ${B("morse status")} to see its windows, or ${B(`morse stop ${app.id}`)} to disconnect.`);
    return;
  }

  // Already open?
  let port = null, pids = [];
  const procs = listProcesses();
  const running = findAppProcesses(app, procs, { extraArgs: extra });
  if (running.length) {
    const open = running.map(p => ({ pid: p.pid, port: debugPortOf(p.cmd) })).find(p => p.port);
    if (open && await portAnswers(open.port)) {
      const v = checkIdentity(await identify(open.port), app, running.map(p => p.pid));
      if (v.ok) { port = open.port; pids = running.map(p => p.pid); console.log(`  ${app.name} is already open with a debugging port. Connecting to it.`); }
    }
    if (!port) {
      let restart = f.restart === true || (pref.restart === true && !f["no-restart"]);
      if (!restart && !f["no-restart"] && process.stdin.isTTY && process.stdout.isTTY) {
        const a = await ask(`\n  ${app.name} is already open. Morse can only connect to an app when it starts.\n  Quit it and open it again with Morse? ${D("[y]es  [n]o  [a]lways for " + app.name)} `);
        if (a === "a") await saveAppPref(app.id, { restart: true });
        restart = a === "y" || a === "a";
      }
      if (!restart) throw said(`${app.name} is already open. Morse can only connect to an app when it starts. Run ${B(`morse launch ${app.id} --restart`)} to quit it and open it again. Morse remembers that choice.`);
      console.log(`  quitting ${app.name}…`);
      if (!await quitApp(app, { procs, extraArgs: extra })) throw said(`${app.name} didn't quit. Close it yourself, then run this again.`);
    }
  }
  if (f.restart === true && !pref.restart) await saveAppPref(app.id, { restart: true });
  if (f["no-restart"] && pref.restart) await saveAppPref(app.id, { restart: null });

  // Launch on a free port.
  if (!port) {
    if (f.port) {
      port = Number(f.port);
      if (!await portFree(port)) throw said(`Port ${port} is already used by another program. Leave out --port and Morse picks a free one.`);
    } else port = await pickPort({ preferred: [pref.port].filter(Boolean) });
    const child = launchApp(app, port, extra);
    pids = [child.pid];
    // Says why when the app dies on start. An AppImage that has to unpack
    // itself first (no FUSE, apps.js appImageEnv) can take a minute.
    await waitForLaunch(child, app, port, app.appimage ? { timeoutMs: 120000 } : undefined);
    if (pref.port !== port) await saveAppPref(app.id, { port });
  }

  // Only this computer, and only the app we meant.
  const exposed = await reachableFrom(port);
  if (exposed.length) throw said(`Port ${port} can be reached from other computers (${exposed.join(", ")}), so Morse won't use it. Quit ${app.name} to close it.`);
  const who = await identify(port);
  const v = checkIdentity(who, app, pids);
  if (!v.ok) throw said(`Morse didn't connect: ${v.why}.`);
  console.log(`  port    ${port} ${D("(127.0.0.1 only)")}`);
  console.log(`  engine  ${who.browser.replace("/", " ")}${who.electron ? ` · Electron ${who.electron}` : ""}\n`);

  const verify = async () => {
    const mine = findAppProcesses(app, listProcesses(), { extraArgs: extra }).filter(p => debugPortOf(p.cmd) === port).map(p => p.pid);
    return checkIdentity(await identify(port), app, mine);
  };
  return runSession({ port, app, settings, watch: !!f.watch, verify, who });
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
  const modsApp = app && !app.browser ? app : null;
  const connector = new Connector({ port, app: modsApp, settings, watch, verify, onChange: () => pub.changed() });
  const pub = publishSession(connector, {
    id, name, path: app?.path || null, aliases: app?.aliases || [], modsApp: modsApp?.id ?? null,
    browser: who?.browser || null, electron: who?.electron || null, started: new Date().toISOString(),
  });
  await pub.flush();
  let ending = false;
  const finish = async (how) => {
    if (ending) return;
    ending = true;
    clearInterval(poll);
    await connector.stop();
    await pub.close();
    if (how === "stop") console.log(`Disconnected from ${name}.`);
    else console.log(`\nDisconnected from ${name}. It keeps running without Morse.`);
    process.exit(0);
  };
  const poll = setInterval(() => { if (stopRequested(id)) finish("stop"); }, 400);
  process.once("SIGINT", () => finish("interrupt"));
  process.once("SIGTERM", () => finish("stop"));
  await connector.run();
  clearInterval(poll);
  await pub.close();
}
