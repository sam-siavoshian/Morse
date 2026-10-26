// The desktop connector: attaches to every window, webview and app frame of a
// Chromium/Electron app over CDP (and keeps up as they come, go, reload or
// crash), injects the Morse runtime, and serves its requests (generate, run,
// save, share). CDP evaluation is exempt from the page's CSP, so mods work in
// locked-down apps too.
//
// Two JS worlds per page:
//   - Morse's isolated world ("morse"): the runtime and the __morseHostSend
//     binding live here, so the app's own scripts (or a website loaded in an
//     attached browser) can't see or call the host API. The runtime only
//     needs the DOM, which both worlds share.
//   - the page's main world: mod code runs here (Runtime.evaluate with the
//     main context id), because mods need the page's own JS objects.
// Host requests are answered for the page that asked: mods, history and
// saves are scoped to the calling document's URL (read from Morse's world)
// and app, never to what the message claims.

import { spawn } from "node:child_process";
import { mkdirSync, watch } from "node:fs";
import path from "node:path";
import { portBrowser } from "./cdp.js"; // a debugging port, or the private pipe (cdp.js pipeBrowser)
import { modsFor, saveMod, deleteMod, getMod, writeExport, readClipboard, putClipboard } from "./store.js";
import { createMod, encodeShare, decodeShare, toUserscript, validateMod, hostOf, modMatches, saveKeepsScope } from "../core/mod.js";
import { wrapModCode, settleMs } from "../core/kit.js";
import { asReviewed } from "../core/summary.js"; // installs keep only the reviewed code
import { runMorse } from "../core/engine.js";
import { startLabel, modelNames } from "../core/route.js"; // models: "Claude Code · Automatic"
import { settingsLabel, currentSettings } from "./models.js"; // also registers the Claude Code / Codex providers
import { configuredHotkeys } from "./store.js"; // first-run hook: what to press, once connected
import { t } from "../core/i18n.js"; // daemon/cli.js sets the language from LANG / LC_ALL
import { readWords } from "../core/languages.js"; // the bar's words in a language besides English ("i18n.words")
import { prewarm, fastModelOf, applyFastMode } from "../core/providers.js";
import { Recorder } from "./record.js";
import { loadPrefs, savePrefs, loadHistory, addHistory, watchPrefs } from "./store.js";
import { Generations } from "../core/cancel.js";
import { cachedVoiceStatus, transcribeAudio } from "./voice.js";
import { CONTROL_REQUESTS, handleControl, watchControl } from "./control.js"; // user control: pause, safe start, install review, backup
import { HOME, listMods } from "./store.js";
import { classifyTarget, describeTarget } from "./targets.js";
import { ONBOARDING_REQUESTS, handleOnboarding } from "./onboarding.js"; // onboarding hook: first-run state
import { GALLERY_REQUESTS, handleGallery } from "./gallery.js"; // gallery hook: Mods for this site
import { PACK_REQUESTS, handlePack } from "./packs.js"; // packs hook: mod packs
import { Style, onStyleChange } from "./style.js"; // your-style hook: one style on every site and app
import { Take } from "./take.js"; // take-and-bring hook: features taken in one app, brought into another
import { STYLE_ID } from "../core/style.js"; // your-style hook
import { HangGuard, FROZE_ERROR } from "./guard.js"; // guard hook: a mod that freezes the page is stopped
import { pageCollapse } from "../core/guard.js"; // guard hook: a change that hides most of the page
import { AppProfiler } from "./profile.js"; // app profiles: how the app works inside (docs/dev/rea.md)
import { barWorld } from "./open-bar.js"; // Open the bar: only a window whose Morse world is up

// Perf: only the small boot goes into every page; the UI is evaluated on first use ("ui.load").
import { bundleBoot, bundleUI } from "../runtime/bundle.js";
const RUNTIME = bundleBoot();
const UI = bundleUI();
import { trace } from "./trace.js"; // MORSE_TRACE: one line per step of a change

// "fast" when this provider has a fast mode, or "". Never a model id.
function fastModelId(settings) {
  const base = settings && typeof settings === "object" ? settings : {};
  return fastModelOf(base.provider) || "";
}

// Settings for one request. Fast mode adds the provider's speed flag on a
// copy. The saved model on the connector stays what the person chose.
function fastReady(settings, prefs) {
  const base = settings && typeof settings === "object" ? settings : {};
  const id = fastModelId(base);
  const next = applyFastMode({
    ...base,
    mode: prefs?.modelMode ?? base.mode,
    fastMode: !!prefs?.fastMode && !!id,
  });
  return { next, fastModelId: id };
}

export const WORLD = "morse";            // the isolated world's name
export const BINDING = "__morseHostSend"; // exists only in that world

// Shim + boot, run in Morse's world: the runtime starts once per document. In
// a window it runs in the top frame only; in an iframe target (an app webview)
// it runs in that frame but not in frames nested inside it.
const shim = frame => `(() => {
  const nested = ${frame ? "(() => { try { return window.parent !== window && !!window.parent.document; } catch { return false; } })()" : "window.top !== window"};
  if (nested || globalThis.__morseHost) return;
  const send = globalThis.${BINDING};
  if (typeof send !== "function") return;
  const subs = [];
  globalThis.__morseHost = { send: m => send(JSON.stringify(m)), onMessage: fn => subs.push(fn) };
  globalThis.__morseHostReceive = m => subs.forEach(f => f(m));
})();`;

// Page.addScriptToEvaluateOnNewDocument runs before the page's own scripts.
// perf: the boot runs right away (it waits for the DOM itself, and applies
// CSS mods as early as it can); the UI comes later through "ui.load".
const boot = frame => `${shim(frame)}\n${RUNTIME}`;
export const BOOT = { window: boot(false), frame: boot(true) };

// reliability: mod code runs in the page's main world, so the helper kit
// (core/kit.js) takes MutationObserver, rAF and timers from here: captured
// before the page's own scripts can replace or stub them.
export const PRISTINE = `(() => { try {
  const k = Symbol.for("morse.pristine"), W = window, a = Reflect.apply;
  if (W[k]) return;
  const f = { st: W.setTimeout, ct: W.clearTimeout, si: W.setInterval, ci: W.clearInterval, raf: W.requestAnimationFrame };
  Object.defineProperty(W, k, { value: Object.freeze({
    MutationObserver: W.MutationObserver,
    setTimeout: (...x) => a(f.st, W, x), clearTimeout: id => a(f.ct, W, [id]),
    setInterval: (...x) => a(f.si, W, x), clearInterval: id => a(f.ci, W, [id]),
    requestAnimationFrame: fn => a(f.raf, W, [fn]),
  }) });
} catch {} })();`;

// What `morse stop` leaves behind: no bar, no mods, no hooks for new pages.
// In Morse's world, first: the runtime there goes quiet (so it won't put the
// bar back) and a later attach can start a fresh one.
const QUIET = `(() => { try {
  globalThis.__morseGen = (globalThis.__morseGen || 0) + 1;
  delete globalThis.__morseHost; delete globalThis.__morseHostReceive; delete globalThis.__morseRuntime; delete globalThis.__morseProbe;
} catch {} })()`;
// Then in the page's main world, where the mods run.
const cleanup = ids => `(() => { try {
  for (const s of document.querySelectorAll("style[data-morse-css]")) { globalThis.morse?.__off?.(s.dataset.morseCss); s.remove(); }
  for (const id of ${JSON.stringify(ids)}) globalThis.morse?.__off?.(id);
  document.querySelectorAll("[data-morse-ui]").forEach(e => e.remove());
  delete window[Symbol.for("morse.app")]; // app profiles: the command handle (daemon/profile.js)
} catch {} })()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));


export class Connector {
  // port: the app's debugging port; or browser: how to reach the app
  // (cdp.js portBrowser / pipeBrowser: listTargets() and connect(target)).
  // watch: keep waiting when the app quits and attach again when it's back.
  // verify(): called before attaching again after a restart; { ok, why }.
  // onChange(connector): windows or state changed (for `morse status`).
  constructor({ port = null, browser = null, app = null, settings, log = console.log, watch = false, verify = null, onChange = null, interval = 1000 }) {
    // Log lines name windows (the page's own title), mods (a shared mod's
    // title) and the model's results: as text, never escape sequences that
    // could rewrite the terminal or set its clipboard.
    const shown = s => String(s).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, " ");
    Object.assign(this, { app, settings, log: line => log(shown(line)), watch, verify, onChange, interval });
    this.browser = browser || portBrowser(port);
    this.pages = new Map();   // target id -> CDPSession (null while connecting)
    this.windows = new Map(); // target id -> { id, type, kind, title, url, frame, session, since }
    this.retry = new Map();   // target id -> { at, n } after a failed attach
    this.recentSaves = new Map();
    this.gens = new Generations();
    this.state = "starting";  // starting | attached | waiting | stopped
    // app profiles: built in the background once Morse is in the app's window
    this.profiler = app && AppProfiler.enabled() ? new AppProfiler({ app, port, log: this.log }) : null;
  }

  // app profiles: the window a session belongs to
  windowOf(s) { for (const w of this.windows.values()) if (w.session === s) return w; return null; }

  get appName() { return this.app?.name || "The app"; }
  get port() { return this.browser.port ?? null; }
  get transport() { return this.browser.kind || "port"; }

  // The app was opened again (on a new pipe, or a port): reach it this way
  // from now on. While waiting (--watch), the next poll attaches to it.
  useBrowser(browser, verify = null) {
    if (this.browser !== browser) Promise.resolve(this.browser.close?.()).catch(() => {});
    this.browser = browser;
    this.verify = verify;
  }

  changed() { try { this.onChange?.(this); } catch {} }

  // Polls the app's target list: new windows, popups, webviews and frames get
  // attached as they appear; resolves when the app quits (unless watching) or
  // on stop().
  async run() {
    this.running = true;
    this.watchMods();
    this.controlWatcher ||= watchControl(this); // user control: tell windows when Morse is paused or resumed
    this.prefsWatcher ||= watchPrefs(prefs => this.applySettings(prefs)); // one shortcut: a change on disk reaches this app
    this.styleWatch ||= onStyleChange(() => this.modsChanged()); // your-style hook: a style change reaches every window
    let misses = 0;
    while (this.running) {
      let list = null;
      try { list = await this.browser.listTargets(); misses = 0; }
      catch (e) { misses += /ECONNREFUSED|ECONNRESET/.test(String(e?.cause?.code || e?.code || e?.message)) ? 3 : 1; }
      if (!this.running) break; // stop() landed during the poll: don't mark attached or attach again
      if (list && this.state === "waiting") {
        const v = this.verify ? await this.verify().catch(e => ({ ok: false, why: e.message })) : { ok: true };
        if (!this.running) break;
        if (!v.ok) {
          if (this.refused !== v.why) this.log(`  ! Morse didn't connect: ${v.why}.`);
          this.refused = v.why;
          list = null;
        } else {
          this.refused = null;
          this.log(`  ↻ ${t("launch.openAgain", { name: this.appName })}`);
        }
      }
      if (list) {
        if (this.state !== "attached") { this.state = "attached"; this.changed(); }
        this.sync(list);
      } else if (misses >= 3 && (this.state === "attached" || (this.state === "starting" && this.browser.closed))) {
        this.dropAll();
        const pipe = this.transport === "pipe";
        if (this.browser.closed) this.browser.close(); // a pipe whose app quit: let go of Morse's ends too
        if (!this.watch) { this.log(t("launch.closed", { name: this.appName })); this.state = "stopped"; break; }
        this.state = "waiting";
        // On a port the app can come back by itself (on that port); on the
        // pipe only Morse can open it again.
        this.log(`  … ${pipe ? t("launch.closedWaitingPipe", { name: this.appName, cmd: `morse launch ${this.app?.id || ""}`.trim() }) : t("launch.closedWaiting", { name: this.appName })}`);
        this.changed();
      }
      await sleep(this.interval);
    }
    this.running = false;
    this.modWatcher?.close();
    this.controlWatcher?.close(); this.controlWatcher = null;
    this.prefsWatcher?.close(); this.prefsWatcher = null;
    this.styleWatch?.(); this.styleWatch = null; // your-style hook
    return this.state;
  }

  sync(list) {
    const byId = new Map(list.map(t => [t.id, t]));
    let dirty = false;
    for (const t of list) {
      const w = this.windows.get(t.id);
      if (w) {
        if (w.title !== t.title || w.url !== t.url) { w.title = t.title; w.url = t.url; dirty = true; }
        continue;
      }
      if (this.pages.has(t.id)) continue;
      const c = classifyTarget(t, t.parentId ? byId.get(t.parentId)?.url : null);
      if (!c.attach) continue;
      const r = this.retry.get(t.id);
      if (r && Date.now() < r.at) continue;
      this.pages.set(t.id, null);
      this.attach(t, c).then(() => this.retry.delete(t.id), e => {
        this.pages.delete(t.id);
        this.windows.get(t.id)?.session?.close();
        this.windows.delete(t.id);
        if (this.state === "stopped") return; // `morse stop` closed it mid-attach: not a failure to report
        const n = (r?.n || 0) + 1;
        this.retry.set(t.id, { at: Date.now() + Math.min(30000, 500 * 2 ** n), n });
        if (n === 1) this.log(`  ! Couldn't connect to ${describeTarget(t).title}: ${e.message}`);
      });
    }
    // soak: targets that are gone (a closed popup that never attached) don't keep a retry entry
    for (const id of this.retry.keys()) if (!byId.has(id)) this.retry.delete(id);
    if (dirty) this.changed();
  }

  async attach(target, how = classifyTarget(target)) {
    const s = await this.browser.connect(target);
    if (!this.running && this.state === "stopped") { s.close(); return; }
    const { kind, title } = describeTarget(target);
    const w = { id: target.id, type: target.type, kind, title: target.title, url: target.url, frame: !!how.frame, session: s, since: Date.now() };
    const source = how.frame ? BOOT.frame : BOOT.window;
    this.pages.set(target.id, s);
    this.windows.set(target.id, w);
    s.hang = new HangGuard(s, { onFroze: (id, how) => this.froze(s, w, id, how) }); // guard hook: frozen pages (guard.js)
    this.everAttached = true;
    s.on("close", () => {
      this.pages.delete(target.id);
      this.windows.delete(target.id);
      this.changed();
      // A window closing on its own (the app keeps running) is worth a line.
      if (!w.crashed && !w.detaching && this.state === "attached") setTimeout(() => {
        if (this.state === "attached" && !this.pages.has(target.id)) this.browser.listTargets().then(l => {
          if (!l.some(t => t.id === target.id)) this.log(`  − ${kind} closed: ${describeTarget(w).title}`);
        }, () => {});
      }, 600);
    });
    // The renderer died (sad page). Drop this session; the target usually
    // stays listed, so the next poll attaches a fresh one, and the runtime
    // comes back with the page's next document.
    s.on("Inspector.targetCrashed", () => {
      w.crashed = true;
      this.log(`  ! ${describeTarget(w).title} stopped working. Morse will connect again when it reloads.`);
      s.close();
    });

    // Execution contexts per frame: the page's main world and Morse's world.
    // Each document gets new ones, so these follow navigations.
    const frames = w.frames = new Map(); // frameId -> { main, world }
    const worlds = new Map();             // Morse world context id -> frameId
    const frame = id => frames.get(id) || frames.set(id, { main: null, world: null }).get(id);
    s.on("Runtime.executionContextCreated", ({ context: c }) => {
      const frameId = c.auxData?.frameId;
      if (!frameId) return;
      if (c.auxData.isDefault) {
        frame(frameId).main = c.id;
        // Belt and braces for documents the new-document script misses (a
        // renderer that came back after a crash, or one whose world came up
        // without the binding): boot() makes the world if there's none and
        // starts the runtime unless it's already running there.
        if (w.ready && frameId === w.frameId) setTimeout(() => {
          const f = frames.get(frameId);
          if (f && f.main === c.id) this.boot(s, w, source).catch(() => {});
        }, 400);
      } else if (c.name === WORLD) { frame(frameId).world = c.id; worlds.set(c.id, frameId); }
    });
    s.on("Runtime.executionContextDestroyed", ({ executionContextId: id }) => {
      worlds.delete(id);
      for (const f of frames.values()) { if (f.main === id) f.main = null; if (f.world === id) f.world = null; }
    });
    s.on("Runtime.executionContextsCleared", () => { frames.clear(); worlds.clear(); });
    s.on("Page.frameDetached", ({ frameId }) => frames.delete(frameId));

    // Listen before injecting: the runtime says hello during evaluation.
    s.on("Runtime.bindingCalled", p => {
      if (p.name !== BINDING) return;
      // Only Morse's own world can reach the host. (The binding exists only
      // there; this also refuses any context we don't know.)
      const frameId = worlds.get(p.executionContextId);
      if (!frameId) return;
      let msg;
      try { msg = JSON.parse(p.payload); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      // Pin the caller's documents now: if the page navigates mid-request,
      // these contexts die with it and nothing lands on the next page.
      const done = this.handle(s, { world: p.executionContextId, main: frames.get(frameId)?.main ?? null, frameId }, msg);
      if (/^mods\.(save|delete|import)$/.test(msg.type)) Promise.resolve(done).finally(() => this.modsChanged(s));
    });
    s.on("Page.frameNavigated", ({ frame }) => {
      if (frame.id === w.frameId && frame.url !== w.url) { w.url = frame.url; this.changed(); }
    });
    // Frame targets are listed by url; read their document title for `morse status`.
    const readTitle = () => s.send("Runtime.evaluate", { expression: "document.title", returnByValue: true })
      .then(r => { const t = r?.result?.value; if (t && t !== w.docTitle) { w.docTitle = t; this.changed(); } }, () => {});
    s.on("Page.loadEventFired", readTitle);
    await s.send("Inspector.enable").catch(() => {});
    await s.send("Page.enable");
    w.frameId = (await s.send("Page.getFrameTree").catch(() => null))?.frameTree?.frame?.id || target.id;
    await s.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD });
    // Every new document: Chromium creates Morse's world and runs the runtime in it.
    w.pristine = (await s.send("Page.addScriptToEvaluateOnNewDocument", { source: PRISTINE }))?.identifier; // reliability: for the kit, in the main world
    w.script = (await s.send("Page.addScriptToEvaluateOnNewDocument", { source, worldName: WORLD }))?.identifier;
    await s.send("Runtime.enable"); // reports existing contexts, including a Morse world left by an earlier session
    w.ready = true;
    // The document that's already loaded. A page that is mid-crash or
    // mid-navigation gets the runtime from its next document.
    await this.boot(s, w, source).catch(() => {});
    if (w.detaching || this.state === "stopped") return; // stopped meanwhile: nothing was connected
    readTitle();
    this.log(`  ✓ ${t("launch.connected", { title })}${kind === "window" ? "" : ` (${kind})`}`);
    trace("connect", `CDP attached to "${title}": Morse's code runs in its own isolated world ("morse"), talks to this process through the __morseHostSend binding`);
    this.profiler?.attached(s, w); // app profiles: in the background, never awaited
    if (!this.hinted && kind === "window") { // first-run hook: say what to do next, once
      this.hinted = true;
      configuredHotkeys().then(k => k.open && this.log(`\n  ${t("launch.ready", { name: this.app?.name || title || t("launch.theApp"), key: k.open })}\n`), () => {});
    }
    this.changed();
  }

  // Runs the runtime in Morse's world of the target's top frame: the one
  // that's there (left by an earlier session: its runtime keeps going, or a
  // stopped one starts fresh) or a new one.
  async boot(s, w, source) {
    let ctx = w.frames.get(w.frameId)?.world;
    if (ctx == null) ctx = (await s.send("Page.createIsolatedWorld", { frameId: w.frameId, worldName: WORLD })).executionContextId;
    const probe = (await s.send("Runtime.evaluate", { expression: `[!!globalThis.__morseHost, typeof globalThis.${BINDING}]`, contextId: ctx, returnByValue: true }).catch(() => null))?.result?.value;
    if (probe?.[0]) return; // already running in this document
    // `morse stop` came while this was on its way: its clean-up may already
    // have run, and a runtime started now would be left on the page.
    if (w.detaching || this.state === "stopped") return;
    // A document that committed in a new renderer while we were attaching (an
    // app still starting up) can come without the binding: add it back first.
    if (probe && probe[1] !== "function") await s.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD }).catch(() => {});
    if (w.detaching || this.state === "stopped") return;
    await s.send("Runtime.evaluate", { expression: source, contextId: ctx });
  }

  // The shortcut (and the rest of settings) changed. Every window Morse is in
  // picks it up, including one whose bar is already open.
  applySettings(prefs) {
    if (!prefs || typeof prefs !== "object") return;
    if (this.settings) {
      const next = { ...this.settings };
      if (typeof prefs.fastMode === "boolean") next.fastMode = prefs.fastMode;
      if (prefs.modelMode) next.mode = prefs.modelMode;
      this.settings = next;
    }
    const expression = `globalThis.__morseHostReceive && __morseHostReceive(${JSON.stringify({ type: "settings.changed", settings: prefs, fastModel: fastModelId(this.settings) })})`;
    for (const w of this.windows.values()) {
      const world = w.frames?.get(w.frameId)?.world;
      if (world == null) continue;
      w.session?.send("Runtime.evaluate", { expression, contextId: world }).catch(() => {});
    }
  }

  // Tell every other window to re-read its mods, so a mod saved in one window
  // (or with `morse install` / `morse rm`) shows up in all windows it matches.
  modsChanged(origin = null) {
    if (origin) this.recentSaves.set(origin, Date.now());
    clearTimeout(this.modsTimer);
    this.modsTimer = setTimeout(() => {
      const now = Date.now();
      for (const w of this.windows.values()) {
        if (!w.session || now - (this.recentSaves.get(w.session) || 0) < 1500) continue;
        const world = w.frames?.get(w.frameId)?.world;
        if (world == null) continue;
        w.session.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive({ type: "mods.changed" })`, contextId: world }).catch(() => {});
      }
      for (const [s, t] of this.recentSaves) if (now - t > 5000) this.recentSaves.delete(s);
    }, 300);
  }

  watchMods() {
    try {
      const dir = path.join(HOME, "mods");
      mkdirSync(dir, { recursive: true });
      this.modWatcher = watch(dir, () => this.modsChanged());
      this.modWatcher.on("error", () => {});
    } catch {}
  }

  dropAll() {
    for (const w of this.windows.values()) { w.detaching = true; w.session?.close(); }
    this.windows.clear();
    this.pages.clear();
    this.retry.clear();
  }

  // Detach from every window: stop injecting into new pages, take the bar and
  // the mods off the open ones, close the sessions. The app keeps running.
  // first-run hook: `morse launch` started before any model was set up. Once
  // `morse setup` has run (the bar says to), pick it up without a relaunch.
  async freshSettings() {
    if (this.settings?.provider && this.settings.provider !== "none") return this.settings;
    try { const s = await currentSettings(); if (s.provider !== "none") this.settings = s; } catch {}
    return this.settings;
  }

  async stop({ keepBrowser = false } = {}) {
    this.running = false;
    this.state = "stopped";
    this.recorder?.stop(); this.recorder = null; // soak: a clip being recorded keeps its frames (and the session) otherwise
    this.modWatcher?.close();
    this.controlWatcher?.close(); this.controlWatcher = null;
    this.prefsWatcher?.close(); this.prefsWatcher = null;
    this.styleWatch?.(); this.styleWatch = null; // your-style hook
    const ids = (await listMods().catch(() => [])).map(m => m.id).concat(STYLE_ID); // your-style hook: its code goes too
    await Promise.all([...this.windows.values()].map(async w => {
      w.detaching = true;
      const s = w.session;
      try {
        if (w.script) await s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: w.script });
        if (w.pristine) await s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: w.pristine });
        const world = w.frames?.get(w.frameId)?.world;
        if (world != null) await s.send("Runtime.evaluate", { expression: QUIET, contextId: world }).catch(() => {});
        await s.send("Runtime.evaluate", { expression: cleanup(ids) });
        await s.send("Runtime.removeBinding", { name: BINDING });
      } catch {}
      s.close();
    }));
    this.windows.clear();
    this.pages.clear();
    // On the pipe, Morse lets go of its ends now (once the detaching went
    // out); the app keeps running. A port stays open until the app quits.
    // keepBrowser: Morse Desktop holds on to the pipe, to connect again.
    if (!keepBrowser) await Promise.resolve(this.browser.close?.()).catch(() => {});
    this.changed();
  }

  // The URL of the document that called, read from Morse's own world (the
  // page can't change what our world sees, and it follows pushState).
  async callerUrl(s, caller) {
    const r = await s.send("Runtime.evaluate", { expression: "location.href", contextId: caller.world, returnByValue: true });
    if (typeof r.result?.value !== "string") throw new Error("The page closed or reloaded. Try again.");
    return r.result.value;
  }

  // A mod the caller may change: one that applies to the caller's page.
  async ownMod(id, where) {
    const existing = await getMod(id);
    if (existing && !modMatches(existing, where)) throw new Error("That mod belongs to another app or site");
    return existing;
  }

  // Voice input records in the page; let it use the microphone without a
  // prompt the app may never show. Scoped to this page's origin.
  async grantMic(s, url) {
    let origin;
    try { origin = new URL(url).origin; } catch { return; }
    if (!/^https?:/.test(origin) || this.granted?.has(origin)) return;
    try {
      const info = await s.send("Target.getTargetInfo").catch(() => null);
      const browserContextId = info?.targetInfo?.browserContextId;
      await s.send("Browser.grantPermissions", { origin, permissions: ["audioCapture"], ...(browserContextId && { browserContextId }) });
      (this.granted ||= new Set()).add(origin);
    } catch {}
  }

  async windowFocused(w, world) {
    return w.session.send("Runtime.evaluate", { expression: "document.hasFocus()", contextId: world, returnByValue: true }).then(r => r?.result?.value === true).catch(() => false);
  }

  // true when one of this app's pages has keyboard focus.
  async barFocused() {
    for (const w of this.windows.values()) {
      const world = barWorld(w);
      if (world != null && await this.windowFocused(w, world)) return true;
    }
    return false;
  }

  async deliverBar(w, world, type, front) {
    if (front) await w.session.send("Page.bringToFront").catch(() => {});
    await w.session.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive({ type: ${JSON.stringify(type)} })`, contextId: world }).catch(() => {});
    return true;
  }

  // preferFocus: the window the user is in, else the first one Morse runs in.
  async signalBar(type, { preferFocus = false } = {}) {
    let fallback = null;
    for (const w of this.windows.values()) {
      const world = barWorld(w);
      if (world == null) continue;
      if (preferFocus && await this.windowFocused(w, world)) return this.deliverBar(w, world, type, false);
      if (!fallback) fallback = { w, world };
    }
    if (!fallback) return false;
    return this.deliverBar(fallback.w, fallback.world, type, true);
  }

  // Morse Desktop's "Open the bar": the app's window comes to the front and
  // Morse's bar opens in it, no shortcut needed (one taken by another app,
  // or a keyboard where it is hard to press). The main window: the first one
  // Morse runs in.
  async openBar() {
    return this.signalBar("open");
  }

  // The global shortcut. A press opens the bar, or closes it when it's already
  // open. The focused window wins; a native widget (the page isn't focused)
  // still reaches the first window Morse runs in.
  async toggleBar() {
    return this.signalBar("toggle", { preferFocus: true });
  }

  // To the runtime, in Morse's world.
  push(s, caller, msg) {
    return s.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive(${JSON.stringify(msg)})`, contextId: caller.world }).catch(() => {});
  }

  // guard hook: how much of the page shows with and without a draft's CSS
  // (core/guard.js pageCollapse), in Morse's world, where the page's own
  // scripts can't change the answer.
  async collapse(s, caller, id, css) {
    const r = await s.send("Runtime.evaluate", { expression: `(${pageCollapse})(${JSON.stringify(css)}, ${JSON.stringify(id)})`, contextId: caller.world, returnByValue: true });
    return r?.result?.value ?? null;
  }

  // Mod code, in the page's main world of the document that asked.
  async exec(s, caller, modId, js) {
    const ctx = caller.main;
    if (ctx == null) return { ok: false, error: "The page isn't ready yet. Try again." };
    // app profiles: mod code that runs the app's commands needs the handle in this document
    if (this.profiler && /\bmorse\.app\b/.test(js || "")) { const w = this.windowOf(s); if (w) await this.profiler.ready(s, w, ctx).catch(() => {}); }
    const done = s.hang?.exec(modId, ctx, js); // guard hook: while mod code is here, notice if the page freezes
    let r;
    try { r = await s.send("Runtime.evaluate", { expression: wrapModCode(modId, js), contextId: ctx, returnByValue: true }); }
    catch (e) { if (!/Execution was terminated/.test(e.message) && !s.hang?.froze(modId)) throw e; r = null; }
    finally { done?.(); }
    if (!r || s.hang?.froze(modId)) return { ok: false, error: FROZE_ERROR };
    trace("page", `JS (${js.length} chars) run in the app's own page world via CDP Runtime.evaluate${r.exceptionDetails ? " → error" : ""}`);
    if (r.exceptionDetails) return { ok: false, error: r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text };
    const res = r.result?.value || { ok: false, error: "no result" };
    if (!res.ok) return res;
    // Errors inside watch/on callbacks surface a moment later. speed: the kit
    // says how long that can be for this mod (core/kit.js settle).
    await new Promise(r2 => setTimeout(r2, settleMs(res)));
    const e = await s.send("Runtime.evaluate", { expression: `morse.__errors(${JSON.stringify(modId)})`, contextId: ctx, returnByValue: true });
    const errs = e.result?.value || [];
    return errs.length ? { ok: false, error: errs[0].split("\n")[0] } : { ok: true };
  }

  // Effect check (core/engine.js): the runtime's effectProbe, in Morse's world
  // of the document that asked (it shares the DOM with the page). null when
  // it can't answer; the engine then skips the check.
  async probe(s, caller, target, selectors, opts = null) {
    if (caller.world == null) return null;
    const expression = `globalThis.__morseProbe ? globalThis.__morseProbe(${JSON.stringify(target || null)}, ${JSON.stringify(selectors || [])}${opts ? `, ${JSON.stringify(opts)}` : ""}) : null`; // opts: { quick } (take-and-bring hook), { learn } (the look before a change)
    const r = await s.send("Runtime.evaluate", { expression, contextId: caller.world, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? null : r.result?.value ?? null;
  }

  // polish (core/polish.js): a picture of the changed part of the window,
  // without Morse's own UI (runtime/src/60-generate.js __morseShotArea), as a
  // JPEG clip at most 1280×900. Only the top document; null when it can't.
  async shoot(s, caller, target, modId) {
    if (caller.world == null) return null;
    const ev = expression => s.send("Runtime.evaluate", { expression, contextId: caller.world, returnByValue: true, awaitPromise: true });
    const a = (await ev(`globalThis.__morseShotArea ? __morseShotArea(${JSON.stringify(target || null)}, ${JSON.stringify(modId)}) : null`).catch(() => null))?.result?.value;
    if (!a) return null;
    const from = Date.now() / 1000 - 0.15;
    try {
      const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 85, clip: { x: a.x + a.scrollX, y: a.y + a.scrollY, width: a.width, height: a.height, scale: a.scale } });
      return r?.data ? { mediaType: "image/jpeg", data: r.data, measured: a.misaligned || [] } : null;
    } catch { return null; }
    finally {
      await ev("globalThis.__morseShotArea && __morseShotArea(null, null, true)").catch(() => {});
      this.recorder?.drop(from, Date.now() / 1000 + 0.1); // the clip never shows Morse's UI blinking out
    }
  }

  // guard hook: mod code froze this window and was stopped (daemon/guard.js).
  // A saved mod is turned off with why, and the page reloads clean; a change
  // still being made just fails that run (the model gets its second try).
  async froze(s, w, id, { running } = {}) {
    const where = describeTarget(w).title;
    const mod = id ? await getMod(id).catch(() => null) : null;
    if (mod && mod.js === s.hang.code(id)) {
      if (mod.enabled) await saveMod({ ...mod, enabled: false, paused: { why: "froze", at: new Date().toISOString(), error: FROZE_ERROR, reloaded: true } }, { ifPresent: true });
      this.modsChanged(s);
      this.log(`  ! “${mod.title}” froze ${where}. Morse stopped it, turned it off and reloaded the page.`);
      await s.send("Page.reload").catch(() => {});
    } else if (id) this.log(`  ! ${running ? "A change being made" : "A change you were trying"} froze ${where}. Morse stopped it.`);
    else this.log(`  ! ${where} stopped responding. Morse stopped the script that was running.`);
  }

  // caller: { world, main, frameId } of the document whose runtime asked.
  async handle(s, caller, msg) {
    const reply = (result, error) => this.push(s, caller, { reply: msg.id, result, error });
    try { reply(await this.dispatch(s, caller, msg)); }
    catch (e) { reply(null, e.message || String(e)); }
  }

  async dispatch(s, caller, msg) {
    const app = this.app?.id || null;
    // Where the caller is, from the caller's document, not from the message.
    let at;
    const here = async () => ({ url: await (at ||= this.callerUrl(s, caller)), app });
    // App-wide in desktop apps, per site in a browser.
    const historyScope = async () => app || hostOf((await here()).url);
    if (CONTROL_REQUESTS.has(msg.type)) return handleControl({ ...msg, tab: `frame:${caller.frameId}` }, await here()); // user control (control.js); per window, not the page's own tab id
    if (ONBOARDING_REQUESTS.has(msg.type)) return handleOnboarding(msg, { settings: await this.freshSettings() }); // onboarding hook
    if (GALLERY_REQUESTS.has(msg.type)) return handleGallery(msg, await here()); // gallery hook: Mods for this site
    if (PACK_REQUESTS.has(msg.type)) { const r = await handlePack(msg); if (/^pack\.(install|update|enable)$/.test(msg.type)) this.modsChanged(s); return r; } // packs hook: mod packs (packs.js)
    if (Take.owns(msg)) return Take.handle(msg); // take-and-bring hook: ~/.morse/taken.json (daemon/take.js)
    if (Style.owns(msg)) { const r = await Style.handle(msg, await here()); if (msg.type !== "style.get" && msg.type !== "style.preview") this.modsChanged(s); return r; } // your-style hook
    switch (msg.type) {
      case "hello": {
        this.grantMic(s, (await here()).url);
        const prefs = await loadPrefs();
        const ready = this.settings ? fastReady(this.settings, prefs) : null;
        const labelSettings = ready && prefs.fastMode && ready.fastModelId ? ready.next : (this.settings ? { ...this.settings, mode: prefs.modelMode } : null);
        return { mode: "desktop", app, appName: this.app?.name || null, label: labelSettings ? startLabel(labelSettings, settingsLabel) : settingsLabel({}),
          models: this.settings ? modelNames(this.settings, settingsLabel) : null, // models: the names the Settings sheet shows
          fastModel: ready?.fastModelId || "",
          settings: prefs, voice: await cachedVoiceStatus(),
          quiet: !!s.welcomed || !(s.welcomed = true), // perf: welcome once per window, not on every reload (it loads the UI)
          debug: process.env.MORSE_DEBUG === "1" || undefined }; // status for tests (97-boot.js debugStatus)
      }
      case "ui.load": // perf: the overlay is evaluated on first use, into the world that asked
        await s.send("Runtime.evaluate", { expression: UI, contextId: caller.world });
        return true;
      case "i18n.words": // the overlay carries English only: the words of the language it shows, from core/locales/
        return readWords(msg.lang);
      case "mods.list": {
        const list = await Style.list(await modsFor(await here()), await here()); // your-style hook: the style first
        for (const m of list || []) if (m?.id) (this.seenMods ||= new Set()).add(m.id);
        return list;
      }
      case "mods.save": {
        const where = await here();
        if (msg.draft) {
          await this.ownMod(msg.draft.id, where);
          trace("save", `Saved "${msg.draft.title || msg.draft.id}" to ${path.join(HOME, "mods")} · it runs again every time this app opens`); // dogfood: MORSE_HOME, not always ~/.morse
          const saved = await saveMod(createMod({ ...msg.draft, url: where.url, app, model: msg.draft.model || settingsLabel(this.settings) }));
          if (saved?.id) (this.seenMods ||= new Set()).add(saved.id);
          return saved;
        }
        validateMod(msg.mod);
        const onDisk = await this.ownMod(msg.mod.id, where);
        // The page still has a mod this connector already showed it. The file
        // was deleted since (a fingerprint save lands a moment later): writing
        // it back would install that mod before anyone presses Install.
        // Undo after Delete says restore, and a mod this connector has never
        // seen is a new one.
        if (!onDisk && !msg.restore && this.seenMods?.has(msg.mod.id)) return null;
        // Undo after Delete (70-panel.js): the mod as it was on disk, scope and all.
        const existing = onDisk || (msg.restore && this.deleted?.get(msg.mod.id)) || null;
        this.deleted?.delete(msg.mod.id);
        // A saved mod can be changed, not widened: its match stays what it
        // was, or is exactly this app (or this site). Wider matches ("*",
        // other hosts) only come in through a confirmed install (mods.import).
        if (!saveKeepsScope(msg.mod.match, existing?.match, where))
          throw new Error("That mod is for another app or site");
        const saved = await saveMod(msg.mod, { ifPresent: !!onDisk });
        if (saved?.id) (this.seenMods ||= new Set()).add(saved.id);
        return saved;
      }
      case "mods.delete": {
        const gone = await this.ownMod(msg.modId, await here());
        if (gone) (this.deleted ||= new Map()).set(gone.id, gone); // for Undo in the Mods panel
        return deleteMod(msg.modId);
      }
      // Decode and validate a shared mod without saving it (install confirmation).
      case "mods.import": {
        const src = msg.source.trim();
        const mod = src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
        const where = await here(); // the user confirmed this install in the runtime (64-install.js, 80-modals.js)
        return saveMod({ ...asReviewed(mod), enabled: true, imported: true, match: mod.match || { hosts: [hostOf(where.url)], app: where.app } });
      }
      // God mode: cross-app clipboard (Capture in one app, rebuild in another)
      case "clipboard.list":
        return readClipboard();
      case "clipboard.put":
        return putClipboard({ ...msg.item, from: { ...msg.item?.from, app: this.app?.name || msg.item?.from?.app || null } });
      case "warm": { // speed: the bar opened, or the person is typing; get the model ready (core/providers.js prewarm)
        const settings = await this.freshSettings();
        const typed = typeof msg.request === "string" ? msg.request.slice(0, 500) : ""; // models: the strong model for new UI and features
        if (settings?.provider && settings.provider !== "none") {
          const prefs = await loadPrefs();
          prewarm(fastReady(settings, prefs).next, typed); // models: warms the model the request starts on
        }
        return true;
      }
      case "exec":
        return this.exec(s, caller, msg.modId, msg.js);
      case "off":
        if (caller.main == null) return true;
        await s.send("Runtime.evaluate", { expression: `globalThis.morse && morse.__off(${JSON.stringify(msg.modId)})`, contextId: caller.main });
        return true;
      case "stats": // repair: does a saved mod still find its elements? (core/kit.js __stats)
        if (caller.main == null) return null;
        return (await s.send("Runtime.evaluate", { expression: `globalThis.morse?.__stats?.(${JSON.stringify(msg.modId)}) ?? null`, contextId: caller.main, returnByValue: true })).result?.value ?? null;
      case "generate": {
        if (!this.settings?.provider || this.settings.provider === "none") await this.freshSettings(); // first-run hook
        if (!this.settings?.provider || this.settings.provider === "none")
          throw new Error("No model is connected. Run morse setup in a terminal to choose one.");
        const t0 = Date.now();
        const prefs = await loadPrefs();
        const ready = fastReady({ ...this.settings, mode: prefs.modelMode }, prefs); // models: Automatic, Always fast, Always best, then Fast mode
        const sel = msg.context?.target?.selector;
        trace("bar", `"${msg.request}" · ${sel ? `pointed at ${sel}` : "the whole page"} · ${this.app?.name || "app"}`);
        trace("model", `${this.settings.provider}${this.settings.model ? ` · ${this.settings.model}` : ""}`);
        let cssPushes = 0, tokens = 0;
        // app profiles: what the request needs to know about how the app works (core/profile.js profileSlice)
        const appLogic = this.profiler ? await this.profiler.slice(s, caller, msg.request, sel).catch(() => "") : "";
        if (appLogic) trace("profile", `the prompt gets ${appLogic.split("\n").length} lines about how ${this.app?.name || "the app"} works inside`);
        const res = await this.gens.run(msg.genId, signal => runMorse({
          settings: ready.next,
          request: msg.request,
          context: { ...msg.context, app: this.app?.name || msg.context.app, ...(appLogic && { appLogic }) },
          vet: this.profiler ? d => this.profiler.vet(d) : undefined, // app profiles: commands the app has
          base: msg.base, // refine / fix: the mod as it is now (core/prompt.js)
          exec: js => this.exec(s, caller, msg.genId, js),
          // The streamed CSS reaches the runtime first: pushes and probes go
          // over the same session, in order.
          probe: (sels, opts) => this.probe(s, caller, msg.context?.target?.selector, sels, opts),
          collapse: css => this.collapse(s, caller, msg.genId, css), // guard hook: hid most of the page?
          polish: prefs.polish, review: () => this.shoot(s, caller, msg.context?.target?.selector, msg.genId), // polish: a look at the change (core/polish.js)
          look: () => this.shoot(s, caller, msg.context?.target?.selector, null), // the app as the person sees it, with the request
          emit: ev => {
            if (ev.type === "token" && !tokens++) trace("stream", `first words from the model after ${Date.now() - t0}ms`);
            if (ev.type === "css" && ev.css && !cssPushes++) trace("page", `CSS reaches the page while the model is still writing (${Date.now() - t0}ms), pushed over CDP to Morse's world`);
            if (ev.type === "phase" && ev.phase === "fixing") trace("engine", `repair round: ${String(ev.error || "").slice(0, 100)}`);
            if (!signal.aborted) this.push(s, caller, { ...ev, genId: msg.genId });
          },
          signal,
        }));
        if (res.cancelled) { this.log(`  ■ "${msg.request}" stopped after ${Date.now() - t0}ms`); return res; }
        this.log(`  ${res.ok ? "✓" : "✗"} "${msg.request}" → ${res.title || "-"} (${Date.now() - t0}ms, ${res.attempts} attempt${res.attempts > 1 ? "s" : ""}${res.model ? `, ${res.model}${res.escalated ? " after the fast model" : ""}` : ""})`);
        if (res.polish) trace("polish", `looked at the change: ${res.polish.verdict} in ${res.polish.ms}ms${res.polish.fixes?.length ? ` (${res.polish.fixes.join("; ").slice(0, 160)})` : ""}`);
        trace("done", `${res.ok ? "✓" : "✗"} "${res.title || "-"}" in ${Date.now() - t0}ms · ${tokens} chunks streamed · css ${res.css?.length || 0} chars · js ${res.js?.length || 0} chars · ${res.attempts} attempt${res.attempts > 1 ? "s" : ""}${res.model ? ` · ${res.model}` : ""}`);
        return { ok: res.ok, error: res.error, title: res.title, css: res.css, js: res.js, attempts: res.attempts, model: res.model };
      }
      case "capture": {
        const from = Date.now() / 1000 - 0.15;
        const r = await s.send("Page.captureScreenshot", { format: "png" });
        this.recorder?.drop(from, Date.now() / 1000 + 0.1);
        return `data:image/png;base64,${r.data}`;
      }
      case "clip.start":
        this.recorder?.stop();
        this.recorder = new Recorder(s);
        await this.recorder.start();
        return true;
      case "clip.cancel":
        this.recorder?.stop();
        this.recorder = null;
        return true;
      case "clip.stop": {
        if (!this.recorder) return null;
        const rec = this.recorder;
        this.recorder = null;
        await new Promise(r => setTimeout(r, 900));
        return rec.finish(msg.modId);
      }
      case "export": {
        const data = msg.dataUrl ? Buffer.from(msg.dataUrl.split(",")[1], "base64") : msg.content;
        return { path: await writeExport(msg.filename, data) };
      }
      case "share": {
        const slug = msg.mod.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mod";
        if (msg.kind === "link") return { link: await encodeShare(msg.mod) };
        if (msg.kind === "json") return { path: await writeExport(`${slug}.morse.json`, JSON.stringify(msg.mod, null, 2)) };
        if (msg.kind === "userscript") return { path: await writeExport(`${slug}.user.js`, toUserscript(msg.mod)) };
        throw new Error(`Unknown share kind ${msg.kind}`);
      }
      case "open": {
        if (!/^https:\/\//.test(msg.url)) throw new Error("Refusing to open non-https URL");
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
        spawn(cmd, [msg.url], { detached: true, stdio: "ignore" }).unref();
        return true;
      }
      // ---- command bar: stop, settings, history, voice
      case "generate.cancel":
        return this.gens.cancel(msg.genId);
      case "settings.get":
        return loadPrefs();
      case "settings.set": {
        const saved = await savePrefs(msg.settings);
        this.applySettings(saved);
        this.changed();
        return saved;
      }
      case "history.get":
        return loadHistory(await historyScope());
      case "history.add":
        return addHistory(await historyScope(), msg.text);
      case "transcribe":
        // speed: a local whisper re-reads the whole recording each time; running it
        // every 2s while you talk only slows down the one that counts, at the end
        if (msg.partial && (await cachedVoiceStatus()).provider !== "openai") return { text: "" };
        return transcribeAudio({ audio: msg.audio, mime: msg.mime });
      default:
        throw new Error(`Unknown request ${msg.type}`);
    }
  }
}
