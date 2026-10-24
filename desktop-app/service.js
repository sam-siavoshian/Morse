// What Morse Desktop does, without Electron: the same daemon modules the
// `morse` command runs (daemon/), held in one long-running process. main.js
// owns the window, the tray and the dialogs; ipc.js checks every request from
// the window and calls one method here. Tests pass a fake daemon.
//
//   const service = createService({ daemon: await loadDaemon(), emit })
//
// Every method resolves plain JSON for the window. Errors a person reads are
// plain sentences (daemon/apps.js said(), core/onboarding.js plainError()).

import { promises as fs } from "node:fs";
import path from "node:path";

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = s => String(s ?? "").replace(ANSI, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The daemon modules, the way the CLI uses them. One object, so tests can
// hand createService a fake with the same names.
export async function loadDaemon() {
  const [apps, desktop, status, store, models, setup, bridge, pairAsk, control, coreControl, platform, providers, onboarding] = await Promise.all([
    import("../daemon/apps.js"), import("../daemon/desktop.js"), import("../daemon/status.js"), import("../daemon/store.js"),
    import("../daemon/models.js"), import("../daemon/setup.js"), import("../daemon/bridge.js"), import("../daemon/pair-ask.js"), import("../daemon/control.js"),
    import("../core/control.js"), import("../daemon/platform.js"), import("../core/providers.js"), import("../core/onboarding.js"),
  ]);
  return {
    // apps (morse apps, launch, attach, status, stop)
    hostContext: apps.hostContext, discoverApps: apps.discoverApps, appFromPath: apps.appFromPath, listProcesses: apps.listProcesses,
    findAppProcesses: apps.findAppProcesses, debugPortOf: apps.debugPortOf, loadAppPrefs: apps.loadAppPrefs,
    connectApp: desktop.connectApp, startSession: desktop.startSession, readSessions: status.readSessions, stopSession: status.stopSession,
    // the model (morse setup, morse doctor)
    loadConfig: store.loadConfig, updateConfig: store.updateConfig, settingsFromConfig: models.settingsFromConfig, settingsLabel: models.settingsLabel,
    keysFrom: models.keysFrom, mask: models.mask, detectBackends: setup.detectBackends, recommend: setup.recommend, configFor: setup.configFor,
    saveChoice: setup.saveChoice, checkModel: setup.checkModel, BACKENDS: setup.BACKENDS, EXTENSION_DIR: setup.EXTENSION_DIR,
    // the Morse helper (morse serve, pair, unpair)
    createBridge: bridge.createBridge, pairAsks: pairAsk.pairAsks, startPairing: bridge.startPairing, helperPort: bridge.helperPort, validPairingCode: bridge.validPairingCode, VERSION: bridge.VERSION,
    // mods and the off switch (morse mods, pause, resume)
    listMods: store.listMods, getMod: store.getMod, saveMod: store.saveMod,
    loadControl: control.loadControl, saveControl: control.saveControl, setPause: coreControl.setPause, pauseInfo: coreControl.pauseInfo,
    // checks (morse doctor)
    platformChecks: platform.platformChecks, HOME: store.HOME, CONFIG_PATH: store.CONFIG_PATH, configuredHotkeys: store.configuredHotkeys,
    plainError: onboarding.plainError, PROVIDERS: providers.PROVIDERS,
  };
}

// Morse Desktop's own choices, in the Morse folder: desktop.json.
//   startAtLogin  open Morse (in the tray) when you log in; off until you turn it on
//   helper        run the Morse helper in the background, for Chrome; on
//   apps          apps you added by their file, for apps Morse didn't find
//   appArgs       { "<app id>": [arguments] }: what `morse launch <app> -- <args>` passes (no window for it)
const DEFAULTS = { startAtLogin: false, helper: true, welcomed: false, apps: [], appArgs: {} };
const argsFor = (s, id) => (Array.isArray(s.appArgs?.[id]) ? s.appArgs[id].map(String) : []);

export function createService({
  daemon: d, emit = () => {}, log = () => {}, iconFor = async () => null,
  scan = process.env.MORSE_DESKTOP_SCAN !== "0", // tests and screenshots: only the apps added by file
  fetchHealth = defaultHealth, now = () => Date.now(),
  copyExtension = false, // packaged: the extension lives inside the app, so Chrome gets a copy in the Morse folder
  self = [], // Morse Desktop's own program: never listed as an app to open with Morse
  onAsk = () => {}, // Chrome asked to connect: main.js brings the window forward
} = {}) {
  const SETTINGS = path.join(d.HOME, "desktop.json");
  const own = new Map();     // app id -> a session this process runs (daemon/desktop.js startSession)
  const pending = new Map(); // app id -> "opening" | "disconnecting"
  const icons = new Map();   // app id -> data URL or null
  let found = null, foundAt = 0;
  let helper = { bridge: null, running: false, ours: false, error: "" };
  let lastCheck = null;      // { ok, ms, error, at, label }
  let asks = [];             // Chrome asking to connect, waiting for Allow or Deny (daemon/pair-ask.js)
  let pairAsk = null;        // the helper's side of those requests
  let settings = null;

  const changed = () => { try { emit(); } catch {} };
  const fail = e => ({ error: plain(d.plainError ? d.plainError(e) : e?.message || e) });

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
  async function appList({ fresh = false } = {}) {
    const ctx = d.hostContext();
    if (fresh || !found || now() - foundAt > 60000) {
      found = scan ? d.discoverApps(ctx) : [];
      foundAt = now();
    }
    const mine = new Set(self.filter(Boolean));
    const list = found.filter(a => ![a.exe, a.resolved, a.path].some(p => mine.has(p)));
    for (const p of (await loadSettings()).apps) {
      let a;
      try { a = d.appFromPath(ctx, p); } catch { continue; }
      if (list.some(x => x.id === a.id || x.exe === a.exe)) continue;
      list.push({ ...a, added: true });
    }
    return list;
  }

  async function findApp(id) {
    const a = (await appList()).find(x => x.id === id);
    if (!a) throw Object.assign(new Error("Morse can't find that app any more. Click Look again."), { plain: true });
    return a;
  }

  async function icon(a) {
    if (!icons.has(a.id)) icons.set(a.id, await iconFor(a).catch(() => null));
    return icons.get(a.id);
  }

  async function apps({ fresh = false } = {}) {
    const list = await appList({ fresh });
    const procs = d.listProcesses();
    const sessions = (await d.readSessions()).filter(s => s.state !== "stopped");
    const mods = await d.listMods().catch(() => []);
    const rows = [];
    for (const a of list) {
      const s = sessions.find(x => x.id === a.id);
      const p = a.canAttach === false ? [] : d.findAppProcesses(a, procs, { extraArgs: argsFor(settings, a.id) });
      const port = p.map(x => d.debugPortOf(x.cmd)).find(Boolean) || null;
      const state = pending.get(a.id)
        || (s ? (s.state === "attached" ? "connected" : s.state === "waiting" ? "waiting" : "connecting")
          : p.length ? (port ? "open-connectable" : "open") : "closed");
      rows.push({
        id: a.id, name: a.name, version: (a.version || "").split(".").slice(0, 3).join("."), why: a.why, canAttach: a.canAttach,
        known: !!a.known, added: !!a.added, state, windows: s?.windows?.length || 0, mine: own.has(a.id),
        mods: mods.filter(m => m.match?.app === a.id).length, modsOn: mods.filter(m => m.match?.app === a.id && m.enabled).length,
        icon: await icon(a),
      });
    }
    // Apps a terminal connected to (morse attach) that aren't in the list.
    for (const s of sessions) if (!rows.some(r => r.id === s.id)) rows.push({
      id: s.id, name: s.name, version: "", why: "", canAttach: true, known: false, added: false, external: true,
      state: s.state === "attached" ? "connected" : s.state === "waiting" ? "waiting" : "connecting", windows: s.windows?.length || 0,
      mine: own.has(s.id), mods: mods.filter(m => m.match?.app === s.id).length, modsOn: mods.filter(m => m.match?.app === s.id && m.enabled).length, icon: null,
    });
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
      const ready = await d.connectApp(app, { extra: argsFor(await loadSettings(), id), ask: answer ? async () => answer : null, say: line => log(`${app.name}: ${plain(line)}`) });
      const cfg = await d.loadConfig();
      const s = d.startSession({
        port: ready.port, app, settings: d.settingsFromConfig(cfg), verify: ready.verify, who: ready.who,
        log: line => log(`${app.name}: ${plain(line).trim()}`), onChange: changed,
      });
      own.set(id, s);
      s.done.catch(e => log(`${app.name}: the connection ended with an error: ${e?.stack || e}`)).finally(() => { if (own.get(id) === s) own.delete(id); changed(); });
      await s.flushed;
      // Until the first window is connected, the row says "Opening".
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

  // ---- Chrome: the Morse helper (morse serve) and pairing
  async function startHelper() {
    const port = d.helperPort();
    if (helper.running && helper.ours) return chrome();
    if (await fetchHealth(port)) { helper = { bridge: null, running: true, ours: false, error: "" }; changed(); return chrome(); }
    // One-click pairing: Chrome asks, the person answers here (daemon/pair-ask.js).
    pairAsk = d.pairAsks({ onAsk: list => { asks = list; changed(); if (list.length) onAsk(list); }, log: line => log(`helper: ${plain(line).trim()}`) });
    const bridge = d.createBridge({ port, ask: pairAsk, log: line => log(`helper: ${plain(line).trim()}`) });
    try {
      await bridge.listen();
      helper = { bridge, running: true, ours: true, error: "" };
    } catch (e) {
      helper = { bridge: null, running: false, ours: false, error: e.code === "EADDRINUSE" ? "Another program is using the Morse helper's place on this computer. Close it, then turn the helper on again." : plain(e.message) };
    }
    changed();
    return chrome();
  }
  async function stopHelper() {
    if (helper.bridge) await helper.bridge.close().catch(() => {});
    helper = { bridge: null, running: false, ours: false, error: "" };
    pairAsk = null;
    asks = [];
    changed();
    return chrome();
  }

  async function chrome() {
    const cfg = await d.loadConfig();
    let running = helper.running;
    // A helper started from a terminal (morse serve) counts too.
    if (!helper.ours) {
      running = !!(await fetchHealth(d.helperPort()));
      if (running !== helper.running) helper = { ...helper, running };
    }
    const p = cfg.bridge?.pairing;
    const waiting = p && p.expires > now() ? { code: p.code, expires: p.expires } : null;
    return {
      running, ours: helper.ours, error: helper.error, browsers: (cfg.bridge?.tokens || []).length, waiting,
      ask: asks[0] ? { id: asks[0].id, extension: asks[0].extension } : null, // "Allow Chrome to use your Claude Code?"
      extensionDir: copyExtension ? path.join(d.HOME, "chrome-extension") : d.EXTENSION_DIR,
    };
  }

  // "Show the extension folder": the folder Chrome's Load unpacked takes. A
  // packaged Morse keeps the extension inside its own app file (and an AppImage
  // moves on every start), so Chrome gets a copy in the Morse folder, made again
  // each time so it matches this version.
  async function extensionFolder() {
    if (!copyExtension) return d.EXTENSION_DIR;
    const to = path.join(d.HOME, "chrome-extension");
    const copyTree = async (from, dest) => {
      await fs.mkdir(dest, { recursive: true });
      for (const e of await fs.readdir(from, { withFileTypes: true })) {
        if (e.isDirectory()) await copyTree(path.join(from, e.name), path.join(dest, e.name));
        else await fs.writeFile(path.join(dest, e.name), await fs.readFile(path.join(from, e.name)));
      }
    };
    await fs.rm(to, { recursive: true, force: true });
    await copyTree(d.EXTENSION_DIR, to);
    return to;
  }

  // "Show a code": a new code to type into Morse's popup in Chrome (morse pair).
  async function newCode() {
    if (!helper.running) await startHelper();
    await d.startPairing();
    changed();
    return chrome();
  }

  // "Allow" or "Deny" for Chrome asking to connect. Only a click here makes a token.
  async function answerAsk(id, allow) {
    if (!pairAsk || !asks.some(x => x.id === id)) return { error: "Chrome stopped asking. Click Connect in Chrome again." };
    await pairAsk.answer(id, !!allow);
    return chrome();
  }

  // "Sign out browsers": morse unpair.
  async function signOutBrowsers() {
    await d.updateConfig(cfg => { if (cfg.bridge) cfg.bridge.tokens = []; return cfg; });
    changed();
    return chrome();
  }

  // ---- mods and the off switch (morse mods, pause, resume)
  async function mods() {
    const list = await d.listMods();
    const names = new Map((await appList()).map(a => [a.id, a.name]));
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
    const c = await chrome();
    rows.push({ label: "Morse helper", ok: c.running ? true : null, text: c.running ? `Running${c.ours ? " in Morse" : ""}. ${c.browsers} browser${c.browsers === 1 ? "" : "s"} connected.` : "Off. Chrome can't use your model until it's on." });
    const m = await model();
    rows.push({ label: "Model", ok: m.none ? false : true, text: m.none ? "None chosen. Choose one under Model." : `${m.label}${m.detected ? " (found by itself)" : ""}` });
    if (test && !m.none) {
      const r = await check();
      rows.push({ label: "Answers", ok: r.ok, text: r.ok ? `Answered in ${(r.ms / 1000).toFixed(1)}s` : r.error });
    }
    return rows;
  }

  // ---- everything the window shows at once
  async function state({ fresh = false } = {}) {
    const [m, a, c, md, p, s] = await Promise.all([model(), apps({ fresh }), chrome(), mods(), pause(), loadSettings()]);
    const keys = await d.configuredHotkeys().catch(() => ({}));
    return { version: d.VERSION, platform: process.platform, keys: { open: keys.open || "", mods: keys.mods || "", off: keys.off || "" }, model: m, apps: a, chrome: c, mods: md, pause: p, settings: { startAtLogin: !!s.startAtLogin, helper: !!s.helper, welcomed: !!s.welcomed } };
  }

  async function setSetting(name, value) {
    if (!(name in DEFAULTS) || name === "apps" || name === "appArgs") return { error: "There's no such setting." };
    await saveSettings({ [name]: !!value });
    if (name === "helper") await (value ? startHelper() : stopHelper());
    changed();
    return { ok: true };
  }

  // On quit: every app this window connected is disconnected (its mods come
  // off and it keeps running), and the helper stops.
  async function shutdown() {
    await Promise.all([...own.values()].map(s => s.stop().catch(() => {})));
    own.clear();
    await stopHelper();
  }

  return {
    state, apps, openApp, disconnectApp, addApp, model, modelChoices, chooseModel, check, chrome, startHelper, stopHelper, newCode,
    extensionFolder, answerAsk, signOutBrowsers, mods, setModOn, pause, setAllModsOff, doctor, setSetting, loadSettings, shutdown,
    get sessions() { return own; },
  };
}

async function defaultHealth(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); return r.ok ? await r.json() : null; } catch { return null; }
}
