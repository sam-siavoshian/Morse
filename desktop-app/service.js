// What Morse Desktop does, without Electron: the same daemon modules the
// `morse` command runs (daemon/), held in one long-running process. main.js
// owns the window, the tray and the dialogs; ipc.js checks every request from
// the window and calls one method here. Tests pass a fake daemon.
//
//   const service = createService({ daemon: await loadDaemon(), emit })
//
// Every method resolves plain JSON for the window. Errors a person reads are
// plain sentences (daemon/apps.js said(), core/onboarding.js plainError()).

import { promises as fs, watchFile, unwatchFile } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectPlatform, decideOpenShortcut, resolveHotkeys } from "../core/hotkeys.js";
import { presentApp } from "../daemon/open-bar.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = s => String(s ?? "").replace(ANSI, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The daemon modules, the way the CLI uses them. One object, so tests can
// hand createService a fake with the same names.
export async function loadDaemon() {
  const [apps, desktop, status, store, models, setup, control, coreControl, platform, providers, onboarding, version] = await Promise.all([
    import("../daemon/apps.js"), import("../daemon/desktop.js"), import("../daemon/status.js"), import("../daemon/store.js"),
    import("../daemon/models.js"), import("../daemon/setup.js"), import("../daemon/control.js"),
    import("../core/control.js"), import("../daemon/platform.js"), import("../core/providers.js"), import("../core/onboarding.js"), import("../daemon/version.js"),
  ]);
  return {
    // apps (morse apps, launch, attach, status, stop)
    hostContext: apps.hostContext, discoverApps: apps.discoverApps, appFromPath: apps.appFromPath, listProcesses: apps.listProcesses,
    findAppProcesses: apps.findAppProcesses, debugPortOf: apps.debugPortOf, loadAppPrefs: apps.loadAppPrefs,
    connectApp: desktop.connectApp, startSession: desktop.startSession, readSessions: status.readSessions, stopSession: status.stopSession,
    // the model (morse setup, morse doctor)
    loadConfig: store.loadConfig, updateConfig: store.updateConfig, settingsFromConfig: models.settingsFromConfig, settingsLabel: models.settingsLabel,
    keysFrom: models.keysFrom, mask: models.mask, detectBackends: setup.detectBackends, recommend: setup.recommend, configFor: setup.configFor,
    saveChoice: setup.saveChoice, checkModel: setup.checkModel, BACKENDS: setup.BACKENDS, VERSION: version.VERSION,
    // mods and the off switch (morse mods, pause, resume)
    listMods: store.listMods, getMod: store.getMod, saveMod: store.saveMod, deleteMod: store.deleteMod,
    loadControl: control.loadControl, saveControl: control.saveControl, setPause: coreControl.setPause, pauseInfo: coreControl.pauseInfo,
    loadPrefs: store.loadPrefs, savePrefs: store.savePrefs,
    // checks (morse doctor)
    platformChecks: platform.platformChecks, HOME: store.HOME, CONFIG_PATH: store.CONFIG_PATH, configuredHotkeys: store.configuredHotkeys,
    plainError: onboarding.plainError, PROVIDERS: providers.PROVIDERS,
  };
}

// Morse Desktop's own choices, in the Morse folder: desktop.json.
//   startAtLogin  open Morse (in the tray) when you log in; on with autoOpen
//   autoOpen      an app with mods that starts on its own (the Dock, Finder, the
//                 Start menu) is opened again with Morse, so its mods are there; on
//   loginSet      Morse turned startAtLogin on by itself once, for autoOpen (never again: your choice stands)
//   apps          apps you added by their file, for apps Morse didn't find
//   appArgs       { "<app id>": [arguments] }: what `morse launch <app> -- <args>` passes (no window for it)
const DEFAULTS = { startAtLogin: false, autoOpen: true, loginSet: false, welcomed: false, apps: [], appArgs: {} };
const argsFor = (s, id) => (Array.isArray(s.appArgs?.[id]) ? s.appArgs[id].map(String) : []);

export function createService({
  daemon: d, emit = () => {}, log = () => {}, iconFor = async () => null,
  scan = process.env.MORSE_DESKTOP_SCAN !== "0", // tests and screenshots: only the apps added by file
  now = () => Date.now(),
  self = [], // Morse Desktop's own program: never listed as an app to open with Morse
} = {}) {
  const SETTINGS = path.join(d.HOME, "desktop.json");
  const own = new Map();     // app id -> a session this process runs (daemon/desktop.js startSession)
  // app id -> { browser, who }: the private pipe of an app Morse opened and
  // then disconnected from. The app has no debugging port, so this is the
  // only way back in without restarting it: Connect uses it. Closed when
  // Morse quits (the app keeps running) or found closed when the app quit.
  const held = new Map();
  const heldOpen = id => { const h = held.get(id); if (h && h.browser.closed) held.delete(id); return held.has(id); };
  const pending = new Map(); // app id -> "opening" | "disconnecting"
  const icons = new Map();   // app id -> data URL or null
  let found = null, foundAt = 0;
  let scanP = null;          // one cold discoverApps, shared by the app list and anything waiting on it
  let namesFromScan = new Map(); // app id -> name, including apps added by file
  let fillQueued = false;
  let lastCheck = null;      // { ok, ms, error, at, label }
  let settings = null;
  // Always open with Morse: what each app was at the last look, and when Morse
  // last reopened it (one try a minute, so an app that won't open with Morse
  // isn't quit again and again).
  const seen = new Map(), reopened = new Map();

  const changed = () => { try { emit(); } catch {} };
  const fail = e => ({ error: plain(d.plainError ? d.plainError(e) : e?.message || e) });

  // The bar, or morse in a terminal, writes the same settings.json. The window
  // reads it again so Settings shows the one shortcut.
  let unwatchPrefs = null;
  function watchPrefsFile() {
    if (!d.HOME || unwatchPrefs) return;
    const file = path.join(d.HOME, "settings.json");
    let last = null;
    const tick = async () => {
      let text = "";
      try { text = await fs.readFile(file, "utf8"); } catch { text = ""; }
      if (last === null) { last = text; return; }
      if (text === last) return;
      last = text;
      changed();
    };
    try {
      watchFile(file, { interval: 400 }, tick).unref?.();
      unwatchPrefs = () => unwatchFile(file, tick);
    } catch { unwatchPrefs = null; }
    tick();
  }

  // ---- settings
  async function loadSettings() {
    if (settings) return settings;
    try { settings = { ...DEFAULTS, ...JSON.parse(await fs.readFile(SETTINGS, "utf8")) }; } catch { settings = { ...DEFAULTS }; }
    if (!Array.isArray(settings.apps)) settings.apps = [];
    return settings;
  }
  async function saveSettings(patch) {
    const next = { ...(await loadSettings()), ...patch };
    await fs.mkdir(d.HOME, { recursive: true, mode: 0o700 });
    const tmp = `${SETTINGS}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.rename(tmp, SETTINGS);
    settings = next;
    return next;
  }

  // ---- apps
  // discoverApps walks the disk. One in-flight scan is shared; a fresh look
  // starts its own. The work is deferred off the caller's stack so a fast
  // state() can return before it runs.
  function discoverShared({ fresh = false } = {}) {
    if (!fresh && found && now() - foundAt <= 60000) return Promise.resolve(found);
    if (!fresh && scanP) return scanP;
    let resolve, reject;
    const tracked = new Promise((res, rej) => { resolve = res; reject = rej; });
    const done = tracked.finally(() => { if (scanP === done) scanP = null; });
    scanP = done;
    setTimeout(() => {
      try {
        found = scan ? d.discoverApps(d.hostContext()) : [];
        foundAt = now();
        resolve(found);
      } catch (e) { reject(e); }
    }, 0);
    return done;
  }

  async function appList({ fresh = false } = {}) {
    await discoverShared({ fresh });
    const ctx = d.hostContext();
    const mine = new Set(self.filter(Boolean));
    const list = (found || []).filter(a => ![a.exe, a.resolved, a.path].some(p => mine.has(p)));
    for (const file of (await loadSettings()).apps) {
      let a;
      try { a = d.appFromPath(ctx, file); } catch { continue; }
      if (list.some(x => x.id === a.id || x.exe === a.exe)) continue;
      list.push({ ...a, added: true });
    }
    namesFromScan = new Map(list.map(a => [a.id, a.name]));
    return list;
  }

  // The window is up before this finishes. One scan, then morse:changed.
  function scheduleFill() {
    if (found || fillQueued) return;
    fillQueued = true;
    setTimeout(() => {
      apps().then(() => changed(), e => log(`apps: ${e?.message || e}`)).finally(() => { fillQueued = false; });
    }, 0);
  }

  async function findApp(id) {
    const a = (await appList()).find(x => x.id === id);
    if (!a) throw Object.assign(new Error("Morse can't find that app any more. Click Look again."), { plain: true });
    return a;
  }

  async function icon(a) {
    // Store the promise before it resolves so a list reads every icon at once.
    if (!icons.has(a.id)) icons.set(a.id, Promise.resolve(iconFor(a)).catch(() => null));
    return icons.get(a.id);
  }

  // A browser's mods are the websites' ones; an app's, its own.
  const modFor = (a, m) => (a.browser ? !m.match?.app : m.match?.app === a.id);
  async function apps({ fresh = false } = {}) {
    const list = await appList({ fresh });
    const procs = d.listProcesses();
    const sessions = (await d.readSessions()).filter(s => s.state !== "stopped");
    const mods = await d.listMods().catch(() => []);
    const rows = await Promise.all(list.map(async a => {
      const s = sessions.find(x => x.id === a.id);
      const p = a.canAttach === false ? [] : d.findAppProcesses(a, procs, { extraArgs: argsFor(settings, a.id) });
      const port = p.map(x => d.debugPortOf(x.cmd)).find(Boolean) || null;
      const base = pending.get(a.id)
        || (s ? (s.state === "attached" ? "connected" : s.state === "waiting" ? "waiting" : "connecting")
          : heldOpen(a.id) ? "open-connectable"
          : p.length ? (port ? "open-connectable" : "open") : "closed");
      // "attached" is the port answering. Connected waits until Morse is in a window.
      const shown = presentApp(base, own.get(a.id)?.connector);
      return {
        id: a.id, name: a.name, version: (a.version || "").split(".").slice(0, 3).join("."), why: a.why, canAttach: a.canAttach,
        known: !!a.known, added: !!a.added, state: shown.state, canStop: shown.canStop, windows: s?.windows?.length || 0, mine: own.has(a.id),
        mods: mods.filter(m => modFor(a, m)).length, modsOn: mods.filter(m => modFor(a, m) && m.enabled).length,
        icon: await icon(a),
      };
    }));
    // Apps a terminal connected to (morse attach) that aren't in the list.
    for (const s of sessions) if (!rows.some(r => r.id === s.id)) {
      const base = s.state === "attached" ? "connected" : s.state === "waiting" ? "waiting" : "connecting";
      const shown = presentApp(base, own.get(s.id)?.connector);
      rows.push({
        id: s.id, name: s.name, version: "", why: "", canAttach: true, known: false, added: false, external: true,
        state: shown.state, canStop: shown.canStop, windows: s.windows?.length || 0,
        mine: own.has(s.id), mods: mods.filter(m => m.match?.app === s.id).length, modsOn: mods.filter(m => m.match?.app === s.id && m.enabled).length, icon: null,
      });
    }
    keepMods(rows);
    const rank = r => r.canAttach === false ? 2 : r.known || r.added ? 0 : 1;
    return rows.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
  }

  // "Open with Morse" and "Connect": `morse launch` without the terminal.
  // answer: "y" (quit it and open it again) or "a" (and always for this
  // app), after { needsRestart } asked. Resolves { ok } or { needsRestart, name }.
  async function openApp(id, { answer } = {}) {
    log(`open ${id}${answer ? ` (${answer})` : ""}`);
    if (pending.has(id)) { log(`${id} is already ${pending.get(id)}`); return { ok: true }; }
    const app = await findApp(id);
    if (app.canAttach === false) return { error: `${app.name} is a ${app.why}, so Morse can't connect to it.` };
    if ((await d.readSessions()).some(s => s.id === id && s.state !== "stopped")) { log(`${id} is already connected`); return { ok: true }; }
    pending.set(id, "opening");
    changed();
    try {
      // Connect again over the pipe Morse kept from an earlier Disconnect;
      // otherwise open (or find) the app.
      const ready = heldOpen(id) ? { port: null, verify: null, ...held.get(id) }
        : await d.connectApp(app, { extra: argsFor(await loadSettings(), id), ask: answer ? async () => answer : null, say: line => log(`${app.name}: ${plain(line)}`) });
      held.delete(id);
      const cfg = await d.loadConfig();
      // ready.browser: the app's private pipe (Morse started it). Disconnect
      // keeps it (keep: true) for Connect; when Morse quits, its ends close
      // and the app keeps running without mods.
      const s = d.startSession({
        port: ready.port, browser: ready.browser, app, settings: d.settingsFromConfig(cfg), verify: ready.verify, who: ready.who,
        log: line => log(`${app.name}: ${plain(line).trim()}`), onChange: changed, keep: true,
      });
      own.set(id, s);
      s.done.catch(e => log(`${app.name}: the connection ended with an error: ${e?.stack || e}`)).finally(() => {
        if (own.get(id) === s) own.delete(id);
        const b = s.connector?.browser;
        if (b?.kind === "pipe" && !b.closed) { if (quitting) b.close(); else held.set(id, { browser: b, who: ready.who }); }
        changed();
      });
      await s.flushed;
      // Until the app answers, the row says "Opening". Connected is later:
      // presentApp waits until Morse is actually in a window.
      const end = now() + 15000;
      while (now() < end && s.connector.state !== "attached" && s.connector.state !== "stopped") await sleep(100);
      return { ok: true };
    } catch (e) {
      if (e?.running) return { needsRestart: true, name: app.name };
      return fail(e);
    } finally {
      pending.delete(id);
      changed();
    }
  }

  // Always open with Morse (autoOpen): an app with mods on that was closed at
  // the last look and is now open without Morse was just started the usual
  // way. Morse quits it (politely, as ⌘Q would) and opens it again with
  // Morse. An app that was already open when Morse started is left alone.
  function keepMods(rows) {
    const on = settings?.autoOpen !== false;
    for (const r of rows) {
      const was = seen.get(r.id);
      seen.set(r.id, r.state);
      if (!on || was !== "closed" || r.state !== "open" || !r.modsOn || r.canAttach === false || r.external) continue;
      if (now() - (reopened.get(r.id) || 0) < 60000) continue;
      reopened.set(r.id, now());
      (async () => {
        if ((await pause()).all) return; // every mod is off: nothing to bring back
        log(`${r.name} opened without Morse; opening it again with Morse (its mods are on)`);
        const res = await openApp(r.id, { answer: "y" });
        if (res.error) log(`${r.name}: couldn't open it with Morse: ${res.error}`);
      })().catch(e => log(`reopen ${r.id}: ${e?.message || e}`));
    }
  }

  // "Open the bar": Morse's bar in a connected app, without the shortcut.
  async function openBar(id) {
    const s = own.get(id);
    if (!s?.connector) return { code: "notHere" }; // the window says it in the person's language
    return (await s.connector.openBar()) ? { ok: true } : { code: "notReady" };
  }

  // "Disconnect": `morse stop <app>`. The app keeps running.
  async function disconnectApp(id) {
    pending.set(id, "disconnecting");
    changed();
    try {
      const s = own.get(id);
      if (s) { await s.stop(); own.delete(id); }
      else {
        const r = await d.stopSession(id);
        if (!r.stopped.length) return { error: plain(r.message) };
      }
      return { ok: true };
    } catch (e) { return fail(e); } finally { pending.delete(id); changed(); }
  }

  // "Add an app…": an app Morse didn't find, by its file.
  async function addApp(file) {
    let a;
    try { a = d.appFromPath(d.hostContext(), file); } catch (e) { return fail(e); }
    if (a.canAttach === false) return { error: `${a.name} is a ${a.why}, so Morse can't connect to it.` };
    const s = await loadSettings();
    if (!s.apps.includes(file)) await saveSettings({ apps: [...s.apps, file] });
    changed();
    return { ok: true, id: a.id, name: a.name };
  }

  // ---- the model (morse setup)
  async function model() {
    const cfg = await d.loadConfig();
    const s = d.settingsFromConfig(cfg);
    const name = { "claude-code": "Claude Code", codex: "Codex", anthropic: "Anthropic API key", openai: "OpenAI API key", demo: "Demo model", none: "" }[s.provider] ?? s.provider;
    return {
      provider: s.provider, none: s.provider === "none", name, model: s.model || "", label: s.provider === "none" ? "" : plain(d.settingsLabel(s)),
      detected: !!s.detected, check: lastCheck && lastCheck.label === d.settingsLabel(s) ? lastCheck : null,
    };
  }

  async function modelChoices() {
    const rows = await d.detectBackends();
    const best = d.recommend(rows);
    return d.BACKENDS.map(b => {
      const r = rows.find(x => x.id === b.id) || {};
      return { id: b.id, name: b.name, why: b.why, install: b.install, found: !!r.found, detail: plain(r.detail || ""), keyEnv: r.keyEnv || "", recommended: best?.id === b.id };
    });
  }

  async function check() {
    const cfg = await d.loadConfig();
    const label = d.settingsLabel(d.settingsFromConfig(cfg));
    const r = await d.checkModel(cfg).catch(e => ({ ok: false, error: e.message }));
    lastCheck = { ok: !!r.ok, ms: r.ms || 0, error: r.ok ? "" : plain(r.error), at: new Date(now()).toISOString(), label };
    changed();
    return lastCheck;
  }

  // "Use this": what `morse setup` saves for a choice, then the same check.
  async function chooseModel(choice, key = "") {
    try {
      const rows = await d.detectBackends();
      const row = rows.find(r => r.id === choice);
      const b = d.BACKENDS.find(x => x.id === choice);
      if (!b) return { error: "Choose Claude Code, Codex or an API key." };
      let m;
      if (choice === "api-key") {
        key = String(key || "").trim();
        if (!key && !row?.found) return { error: "Paste your API key first." };
        m = key ? d.configFor("api-key", { key }) : d.configFor("api-key", { vendor: row.vendor });
      } else {
        if (!row?.found) return { error: `${b.name} isn't installed on this computer yet. Install it, then choose it here.` };
        m = d.configFor(choice);
      }
      const cfg = await d.saveChoice(choice, m);
      // Apps connected now use the new model from their next change on.
      const next = d.settingsFromConfig(cfg);
      for (const s of own.values()) s.connector.settings = next;
      changed();
      return { ok: true, check: await check() };
    } catch (e) { return fail(e); }
  }

  // ---- mods and the off switch (morse mods, pause, resume)
  async function mods() {
    const list = await d.listMods();
    // Names from the last scan only. A cold state() must not start discoverApps;
    // the fill does, once, and the next push has the names.
    const names = new Map(namesFromScan);
    for (const s of await d.readSessions()) names.set(s.id, s.name);
    const groups = new Map();
    for (const m of list) {
      const key = m.match?.app ? `app:${m.match.app}` : `site:${(m.match?.hosts || []).join(", ") || "any site"}`;
      const name = m.match?.app ? names.get(m.match.app) || m.match.app : (m.match?.hosts || []).join(", ") || "Any site";
      if (!groups.has(key)) groups.set(key, { key, name, app: m.match?.app || null, mods: [] });
      groups.get(key).mods.push({ id: m.id, title: m.title, request: m.prompt, on: !!m.enabled, paused: !!m.paused, updated: m.updated || m.created || "" });
    }
    return [...groups.values()].sort((a, b) => (!a.app - !b.app) || a.name.localeCompare(b.name));
  }
  async function setModOn(id, on) {
    const m = await d.getMod(id);
    if (!m) return { error: "That mod isn't there any more." };
    m.enabled = !!on;
    if (on) delete m.paused; // turning it back on is the person's answer to a guard pausing it
    m.updated = new Date(now()).toISOString();
    await d.saveMod(m);
    changed();
    return { ok: true };
  }
  // Delete, and Undo right after: the mod as it was, kept until Morse quits.
  const deleted = new Map();
  async function deleteMod(id) {
    const m = await d.getMod(id);
    if (!m) return { error: "That mod isn't there any more." };
    await d.deleteMod(id);
    deleted.set(id, m);
    changed();
    return { ok: true, title: m.title };
  }
  async function undeleteMod(id) {
    const m = deleted.get(id);
    if (!m) return { error: "That mod can't be brought back any more." };
    deleted.delete(id);
    await d.saveMod(m);
    changed();
    return { ok: true };
  }
  async function pause() {
    const info = d.pauseInfo(await d.loadControl());
    return { all: !!info.all, sites: info.sites };
  }
  // The off switch: every mod everywhere off, saved (morse pause / resume).
  async function setAllModsOff(off) {
    await d.saveControl(d.setPause(await d.loadControl(), { all: !!off }));
    changed();
    return pause();
  }

  // ---- checks (morse doctor)
  async function doctor({ test = true } = {}) {
    const rows = [];
    const keys = await d.configuredHotkeys().catch(() => ({}));
    for (const r of await d.platformChecks({ home: d.HOME, shortcut: keys.open })) {
      if (r.label === "colors") continue; // terminal colors: nothing to do with this window
      rows.push({ label: r.label[0].toUpperCase() + r.label.slice(1), ok: r.ok, text: plain(r.text) });
    }
    for (const b of await d.detectBackends()) {
      const text = plain(b.detail) || (b.found ? "found" : "not installed");
      rows.push({ label: b.name, ok: b.found ? true : null, text: text.replace(/^[a-z]/, c => c.toUpperCase()) }); // "not installed" -> "Not installed"; paths stay as they are
    }
    const m = await model();
    rows.push({ label: "Model", ok: m.none ? false : true, text: m.none ? "None chosen. Choose one under Model." : `${m.label}${m.detected ? " (found by itself)" : ""}` });
    if (test && !m.none) {
      const r = await check();
      rows.push({ label: "Answers", ok: r.ok, text: r.ok ? `Answered in ${(r.ms / 1000).toFixed(1)}s` : r.error });
    }
    return rows;
  }

  // ---- everything the window shows at once
  function packState({ m, a, md, p, s, prefs, keys, appsPending }) {
    const platform = detectPlatform({ platform: process.platform });
    const stored = prefs?.hotkeys && typeof prefs.hotkeys === "object" ? prefs.hotkeys : null;
    const resolved = stored ? resolveHotkeys(stored, platform) : null;
    return {
      version: d.VERSION, platform: process.platform,
      keys: {
        open: keys.open || "", mods: keys.mods || "", off: keys.off || "",
        ...(resolved ? { combo: resolved.open || "", custom: !!stored.open, stored } : {}),
      },
      model: m, apps: a, appsPending: !!appsPending, mods: md, pause: p,
      settings: { startAtLogin: !!s.startAtLogin, autoOpen: s.autoOpen !== false, welcomed: !!s.welcomed },
    };
  }
  async function state({ fresh = false } = {}) {
    const platform = detectPlatform({ platform: process.platform });
    const prefsP = typeof d.loadPrefs === "function" ? d.loadPrefs().catch(() => null) : Promise.resolve(null);
    const keysP = d.configuredHotkeys(platform).catch(() => ({}));
    // First paint: settings, model, mods and the off switch. The disk scan,
    // the process list and the icons follow once, then morse:changed.
    if (!fresh && !found) {
      const [m, md, p, s, prefs, keys] = await Promise.all([model(), mods(), pause(), loadSettings(), prefsP, keysP]);
      const out = packState({ m, a: [], md, p, s, prefs, keys, appsPending: true });
      scheduleFill();
      return out;
    }
    await appList({ fresh });
    const [m, a, md, p, s, prefs, keys] = await Promise.all([
      model(), apps({ fresh: false }), mods(), pause(), loadSettings(), prefsP, keysP,
    ]);
    return packState({ m, a, md, p, s, prefs, keys, appsPending: false });
  }

  // The keys that open Morse in a connected app. Saved with the bar's other
  // settings (settings.json), then pushed to apps this window already connected.
  async function setOpenShortcut(next) {
    if (typeof d.savePrefs !== "function" || typeof d.loadPrefs !== "function") return fail(new Error("no prefs"));
    const platform = detectPlatform({ platform: process.platform });
    let prefs;
    try { prefs = await d.loadPrefs(); } catch (e) { return fail(e); }
    const decision = decideOpenShortcut(prefs?.hotkeys, next, platform);
    if (!decision.ok) return { error: decision.message };
    let saved;
    try { saved = await d.savePrefs({ hotkeys: { open: decision.value } }); }
    catch (e) { return fail(e); }
    for (const s of own.values()) { try { s.connector?.applySettings?.(saved); } catch {} }
    changed();
    return { ok: true, warn: decision.level === "warn" ? decision.message : "" };
  }

  async function setSetting(name, value) {
    if (!(name in DEFAULTS) || name === "apps" || name === "appArgs") return { error: "There's no such setting." };
    await saveSettings({ [name]: !!value });
    changed();
    return { ok: true };
  }

  // On quit: every app this window connected is disconnected (its mods come
  // off and it keeps running), every pipe Morse holds is let go (the apps
  // hold their own copy of the pipe's input, so they don't quit).
  let quitting = false;
  async function shutdown() {
    quitting = true;
    try { unwatchPrefs?.(); } catch {}
    unwatchPrefs = null;
    const pipes = [...own.values()].map(s => s.connector?.browser).filter(b => b?.kind === "pipe");
    await Promise.all([...own.values()].map(s => s.stop().catch(() => {})));
    own.clear();
    pipes.push(...[...held.values()].map(h => h.browser));
    held.clear();
    await Promise.all(pipes.map(b => Promise.resolve(b.close()).catch(() => {})));
  }

  watchPrefsFile();
  return {
    state, apps, openApp, openBar, disconnectApp, addApp, model, modelChoices, chooseModel, check,
    mods, setModOn, deleteMod, undeleteMod, pause, setAllModsOff, doctor, setSetting, setOpenShortcut, loadSettings, shutdown,
    get sessions() { return own; },
  };
}
