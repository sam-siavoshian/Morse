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

  // Already open?
  let port = null, pids = [];
  const procs = listProcesses();
  const running = findAppProcesses(app, procs, { extraArgs: extra });
  if (running.length) {
    const open = running.map(p => ({ pid: p.pid, port: debugPortOf(p.cmd) })).find(p => p.port);
    if (open && await portAnswers(open.port)) {
      const v = checkIdentity(await identify(open.port), app, running.map(p => p.pid));
      if (v.ok) { port = open.port; pids = running.map(p => p.pid); console.log(`  ${t("launch.openWithPort", { name: app.name })}`); }
    }
    if (!port) {
      let restart = f.restart === true || (pref.restart === true && !f["no-restart"]);
      if (!restart && !f["no-restart"] && process.stdin.isTTY && process.stdout.isTTY) {
        const a = await ask(`\n  ${t("launch.isOpen", { name: app.name })}\n  ${t("launch.restartAsk")} ${D(t("launch.restartKeys", { name: app.name }))} `);
        if (a === "a") await saveAppPref(app.id, { restart: true });
        restart = a === "y" || a === "a";
      }
      if (!restart) throw said(`${t("launch.isOpen", { name: app.name })} ${t("launch.restartHow", { cmd: B(`morse launch ${app.id} --restart`) })}`);
      console.log(`  ${t("launch.quitting", { name: app.name })}`);
      if (!await quitApp(app, { procs, extraArgs: extra })) throw said(t("launch.didntQuit", { name: app.name }));
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
    // What we started handed over to the real app (Squirrel's Update.exe,
    // flatpak, snap): the app is the process that has our port.
    if (child.handoff || child.exited) {
      const real = findAppProcesses(app, listProcesses(), { extraArgs: extra }).filter(p => debugPortOf(p.cmd) === port).map(p => p.pid);
      if (real.length) pids = real;
    }
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
    if (how === "stop") console.log(t("launch.disconnected", { name }));
    else console.log(`\n${t("launch.disconnectedRunning", { name })}`);
    process.exit(0);
  };
  const poll = setInterval(() => { if (stopRequested(id)) finish("stop"); }, 400);
  process.once("SIGINT", () => finish("interrupt"));
  process.once("SIGTERM", () => finish("stop"));
  await connector.run();
  clearInterval(poll);
  await pub.close();
}
