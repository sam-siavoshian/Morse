/* Morse boot: the only part of Morse that loads on every page.
 *
 * It applies the saved mods, follows SPA navigations, and listens for Morse's
 * hotkeys. Nothing else: no overlay, no styles, no layout reads, no timers.
 * The UI (runtime/src/*.js, ~200 KB) is fetched from the host on first use
 * ("ui.load": chrome.scripting in the extension, Runtime.evaluate on the
 * desktop) and takes over through the handoff object below.
 *
 * Hosts run this as early as they can (document_start / a new-document
 * script), so the built-ins captured here are the page's originals even when
 * the page later replaces addEventListener, MutationObserver or rAF.
 *
 * runtime/bundle.js wraps this file in an IIFE with core/hotkeys.js,
 * core/prefs.js, core/control.js and the detection half of core/heal.js
 * inlined, inside a try/catch: Morse never throws into a page. */

const W = window, D = document;
const BOOT = Symbol.for("morse.boot"), PRISTINE = Symbol.for("morse.pristine");
// A detached host (`morse stop`) bumps __morseGen: that copy goes quiet and a
// later attach starts a fresh one here.
const prior = W[BOOT];
if (prior ? prior.live() : W.__morseRuntime) return;
const host = W.__morseHost;
if (!host || typeof host.send !== "function" || typeof host.onMessage !== "function") return;
const GEN = W.__morseGen = (W.__morseGen || 0) + 1;
const live = () => W.__morseGen === GEN;

// ---- the page's own built-ins, before it can replace them
const apply = Reflect.apply;
const ET = EventTarget.prototype;
const raw = {
  ael: ET.addEventListener, rel: ET.removeEventListener,
  st: W.setTimeout, ct: W.clearTimeout, si: W.setInterval, ci: W.clearInterval,
  raf: W.requestAnimationFrame, caf: W.cancelAnimationFrame, ric: W.requestIdleCallback,
  gcs: W.getComputedStyle, now: performance.now, ce: Document.prototype.createElement,
};
const pristine = Object.freeze({
  MutationObserver: W.MutationObserver,
  setTimeout: (...a) => apply(raw.st, W, a),
  clearTimeout: id => apply(raw.ct, W, [id]),
  setInterval: (...a) => apply(raw.si, W, a),
  clearInterval: id => apply(raw.ci, W, [id]),
  requestAnimationFrame: fn => apply(raw.raf, W, [fn]),
  cancelAnimationFrame: id => apply(raw.caf, W, [id]),
  requestIdleCallback: raw.ric ? (fn, o) => apply(raw.ric, W, [fn, o]) : (fn => apply(raw.st, W, [fn, 1])),
  getComputedStyle: (...a) => apply(raw.gcs, W, a),
  now: () => apply(raw.now, performance, []),
  addEventListener: (t, type, fn, o) => apply(raw.ael, t, [type, fn, o]),
  removeEventListener: (t, type, fn, o) => apply(raw.rel, t, [type, fn, o]),
});
const warn = (...a) => { try { console.warn("[morse]", ...a); } catch {} };

// Listeners on window/document go through here: errors stay inside Morse, and
// they are re-added if document.open() erases them.
const regs = [];
const capture = o => !!(o === true || (o && o.capture));
function on(target, type, fn, opts) {
  if (regs.some(r => r.target === target && r.type === type && r.fn === fn && r.cap === capture(opts))) return;
  const reg = { target, type, fn, opts, cap: capture(opts) };
  const forget = () => { const i = regs.indexOf(reg); if (i >= 0) regs.splice(i, 1); };
  reg.wrapped = function (e) {
    if (opts && opts.once) forget();
    if (!live()) return; // detached: keep none of the page's events
    try { return apply(fn, this, [e]); } catch (err) { warn(err); }
  };
  if (opts && opts.signal) { if (opts.signal.aborted) return; pristine.addEventListener(opts.signal, "abort", forget, { once: true }); }
  regs.push(reg);
  pristine.addEventListener(target, type, reg.wrapped, opts);
}
function off(target, type, fn, opts) {
  const i = regs.findIndex(r => r.target === target && r.type === type && r.fn === fn && r.cap === capture(opts));
  if (i < 0) return;
  pristine.removeEventListener(target, type, regs[i].wrapped, opts);
  regs.splice(i, 1);
}
// Adding the same listener twice is a no-op, so this only restores erased ones.
const relisten = () => { for (const r of regs) if (r.target === W || r.target === D) pristine.addEventListener(r.target, r.type, r.wrapped, r.opts); };

// ---- talking to the host
let seq = 0;
const pending = new Map();
const listeners = new Set();
const outgoing = []; // hook: fns that may decorate a request before it is sent (God mode capture)
host.onMessage(msg => {
  if (!msg || typeof msg !== "object" || !live()) return;
  if (msg.reply != null && pending.has(msg.reply)) {
    const { resolve, reject } = pending.get(msg.reply);
    pending.delete(msg.reply);
    msg.error ? reject(new Error(msg.error)) : resolve(msg.result);
  } else listeners.forEach(fn => { try { fn(msg); } catch (e) { warn(e); } });
});
const call = (type, payload = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  try { host.send(outgoing.reduce((m, f) => f(m) || m, { id, type, ...payload })); }
  catch (e) { pending.delete(id); reject(e); }
});
// A page restored from the back/forward cache lost its connection mid-request
// (the extension's port is closed on the way in): those replies never come.
function dropPending() {
  for (const { reject } of pending.values()) reject(new Error("The page was suspended"));
  pending.clear();
}

// ---- shared state (the UI reads and writes the same object)
const S = {
  open: false, picking: false, target: null, phase: "idle",
  draft: null, before: null, after: null, label: "", mode: "", app: null, appName: null,
  mods: [], url: location.href,
};
const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
// Debug (the UI's open shadow root and status attribute, for tests and
// screenshots) only in a browser driven by automation: localStorage belongs to
// the page, so on its own the flag would let any site open Morse's UI to its
// scripts. navigator.webdriver is read here, in Morse's own world, where the
// page can't redefine it.
let DEBUG = false;
try { DEBUG = navigator.webdriver === true && !!W.localStorage.getItem("morse:debug"); } catch {}

// ---- hotkeys (core/hotkeys.js, core/prefs.js are inlined above)
const PLATFORM = detectPlatform(navigator);
let prefs = normalizePrefs({});
let keys = resolveHotkeys(prefs.hotkeys, PLATFORM);
function setBootPrefs(p) { prefs = normalizePrefs(p); keys = resolveHotkeys(prefs.hotkeys, PLATFORM); }
const lsPrefs = () => { try { return JSON.parse(W.localStorage.getItem("morse:settings") || "null"); } catch { return null; } };
async function loadPrefs() {
  try { setBootPrefs(await call("settings.get")); } catch { setBootPrefs(lsPrefs() || {}); }
}
function hotkeyFor(e) {
  for (const { id } of HOTKEY_ACTIONS) { const c = keys[id]; if (c && matchCombo(e, c)) return id; }
  return "";
}

// ---- mods
const domReady = D.readyState !== "loading" ? Promise.resolve() : new Promise(r => pristine.addEventListener(D, "DOMContentLoaded", r, { once: true }));
const styles = new Map(); // mod id -> its <style>
const styleParent = () => D.head || D.documentElement;
function setCss(id, css) {
  let s = styles.get(id);
  if (!css) { if (s) { s.remove(); styles.delete(id); } return; }
  if (!s) { s = apply(raw.ce, D, ["style"]); s.setAttribute("data-morse-css", id); styles.set(id, s); }
  if (s.textContent !== css) s.textContent = css;
  if (!s.isConnected) styleParent()?.append(s);
}
// Styles applied before <head> existed move after the page's own, so a mod
// still wins ties the way it did when it was applied last.
domReady.then(() => { const p = styleParent(); if (p) for (const s of styles.values()) if (s.parentNode !== p || s.nextElementSibling) p.append(s); });

// ---- user control (63-control.js has the UI; the rules are core/control.js):
// the off switch (per tab, survives reloads), pauses (here or everywhere) and
// safe start (a mod that keeps ending the page right after it runs is held
// back). Mods are applied here, before any UI, so the rules live here too.
const Control = { pause: { all: false, sites: {} }, off: false, held: new Set(), suspect: null, tab: "" };
try { Control.off = W.sessionStorage.getItem("morse:off") === "1"; } catch {}
try { Control.tab = W.sessionStorage.getItem("morse:tab") || newId(); W.sessionStorage.setItem("morse:tab", Control.tab); } catch {}
// Requests older (and demo) hosts may not answer.
function ctl(type, payload = {}, ms = 4000) {
  return new Promise(resolve => {
    const t = pristine.setTimeout(() => resolve(null), ms);
    call(type, { url: location.href, app: S.app, tab: Control.tab, ...payload })
      .then(r => resolve(r), () => resolve(null)).finally(() => pristine.clearTimeout(t));
  });
}
const held = m => Control.off || isPaused({ pause: Control.pause }, { url: location.href, app: S.app }) || Control.held.has(m.id);
// Once per page load: pauses and the safe-start suspect, before any mod runs.
const controlled = ctl("control.boot", {}, 2500).then(r => {
  if (r?.pause) Control.pause = normalizeControl({ pause: r.pause }).pause;
  if (typeof r?.off === "boolean") Control.off = r.off; // the host keeps the off switch per tab (a page can clear its storage)
  if (r?.suspect?.id) { Control.suspect = r.suspect; Control.held.add(r.suspect.id); }
});
let aliveTimers = [];
function ran(m) {
  ctl("control.applied", { mod: { id: m.id, title: m.title, updated: m.updated || "", js: !!(m.js || "").trim() } });
  aliveTimers.forEach(pristine.clearTimeout);
  aliveTimers = [2000, 5000, SAFE_WINDOW + 1000].map(ms => pristine.setTimeout(() => ctl("control.alive"), ms));
}
// Pause changes while the UI isn't here (the UI has its own, with toasts).
function changeHeld(fn) {
  const running = m => !!m.enabled && !held(m);
  const before = new Map(S.mods.map(m => [m.id, running(m)]));
  fn();
  for (const m of S.mods) {
    const now = running(m);
    if (before.get(m.id) && !now) { setCss(m.id, ""); if ((m.js || "").trim()) call("off", { modId: m.id }).catch(() => {}); }
    else if (!before.get(m.id) && now) applyMod(m).catch(warn);
  }
}
// Repair health for the Mods panel (70-panel.js), kept until the UI is here.
const healthLog = new Map();
function health(m, r) { if (ui?.health) { try { ui.health(m, r); } catch (e) { warn(e); } } else healthLog.set(m.id, [m, r]); }

async function applyMod(m) {
  await controlled;
  if (held(m) || !live()) return;
  setCss(m.id, m.css);
  if ((m.js || "").trim()) {
    await domReady;
    if (!live()) return;
    const r = await call("exec", { modId: m.id, js: m.js });
    health(m, r);
    if (r && !r.ok) { warn(m.title, r.error); notify(`“${m.title}” didn't work on this page. Open Mods to turn it off or fix it.`); }
  }
  ran(m);
}
async function removeMod(id) { setCss(id, ""); await call("off", { modId: id }); }

// Concurrent requests (URL change during a sync, mods.changed) coalesce into
// one more pass. All CSS lands in one go; mod JS runs in parallel, outside the
// lock (hosts hold an exec ~600ms to collect late errors; a navigation must
// not wait for that).
let syncing = null, syncAgain = false;
function syncMods() {
  if (syncing) syncAgain = true;
  else syncing = (async () => {
    const work = [];
    try {
      do {
        syncAgain = false;
        let list;
        try { list = await call("mods.list", { url: location.href, app: S.app }); }
        catch (e) { if (syncAgain) continue; throw e; } // superseded (e.g. a bfcache restore): go again
        const prev = new Map(S.mods.map(m => [m.id, m]));
        S.mods = Array.isArray(list) ? list : [];
        for (const m of S.mods) {
          const was = prev.get(m.id);
          if (m.enabled && (!was || !was.enabled || was.updated !== m.updated)) work.push(applyMod(m));
          if (!m.enabled && was?.enabled) work.push(removeMod(m.id));
        }
        for (const id of prev.keys()) if (!S.mods.some(m => m.id === id)) work.push(removeMod(id));
      } while (syncAgain);
    } finally { syncing = null; }
    return work;
  })();
  return syncing.then(async work => {
    for (const p of work) await p.catch(warn);
    try { ui?.modsChanged?.(); } catch (e) { warn(e); }
  });
}

// ---- single-page apps change the URL without reloading
// At most one re-sync per 250ms (first one immediately): some sites call
// replaceState on every scroll frame. The timer exists only while they do.
let urlSyncAt = -1e9, urlTimer = 0;
function urlSync() { urlTimer = 0; urlSyncAt = pristine.now(); syncMods().then(() => Heal.soon(), warn); }
function urlChanged() {
  if (location.href === S.url) return;
  S.url = location.href;
  const wait = urlSyncAt + 250 - pristine.now();
  if (wait <= 0) urlSync();
  else if (!urlTimer) urlTimer = pristine.setTimeout(urlSync, wait);
}
const navApi = W.navigation;
if (navApi && typeof navApi.addEventListener === "function") on(navApi, "currententrychange", urlChanged);
else {
  // No Navigation API (old Electron): popstate/hashchange, plus a check right
  // after the clicks and keys that cause pushState. Never a standing poll.
  on(W, "popstate", urlChanged);
  on(W, "hashchange", urlChanged);
  const soon = () => { pristine.setTimeout(urlChanged, 0); pristine.setTimeout(urlChanged, 500); };
  on(W, "click", soon, true);
  on(W, "keyup", soon, true);
}
// Back/forward cache: the page comes back as it was, the host may not.
on(W, "pageshow", e => {
  if (!e.persisted) return;
  dropPending();
  S.url = location.href;
  syncMods().catch(warn);
});

// ---- the page replacing its own document (document.open, <html>/<head> swaps)
const domHooks = new Set();
let watchedRoot = null;
const domMo = new pristine.MutationObserver(() => {
  if (!live()) { domMo.disconnect(); return; }
  const swapped = watchedRoot && D.documentElement !== watchedRoot; // document.open() erased our window listeners
  observeDom();
  for (const s of styles.values()) if (!s.isConnected) styleParent()?.append(s);
  if (swapped) relisten();
  domHooks.forEach(fn => { try { fn(); } catch (e) { warn(e); } });
});
function observeDom() {
  domMo.observe(D, { childList: true });
  const r = D.documentElement;
  if (r && r !== watchedRoot) { watchedRoot = r; domMo.observe(r, { childList: true }); }
}
observeDom();

// ---- self-heal: did a saved mod stop working because the site changed?
// Detection lives here so it works before (and without) the UI: once the page
// has loaded and gone quiet, one pass after idle counts each mod's selectors
// against its fingerprint (core/heal.js), and a second pass a few seconds
// later confirms. Never per frame, no observer: settling only compares the
// element count on a short timer that stops. A mod that has no fingerprint
// for this version learns one the first time it works here. The UI
// (71-heal.js) shows the dot, the note and Fix it from what this found; the
// extension's toolbar badge is asked for from here.
const Heal = (() => {
  const QUIET = 1200, MAX_WAIT = 15000, CONFIRM = 3000;
  const NOT_OURS = "[data-morse-ui],[data-morse]";
  const TRANSIENT = "dialog,[role=dialog],[role=alertdialog],[aria-modal=true],[popover],[role=menu],[role=listbox],[role=tooltip]";
  const broken = new Map(); // mod id -> lost selectors [[selector, countBefore]]
  let running = null, again = false, badged = -1, wantUi = false;
  const wait = ms => new Promise(r => pristine.setTimeout(r, ms));
  const pageSize = () => (D.body ? D.body.getElementsByTagName("*").length : 0);
  function countOf(sel) {
    let list;
    try { list = D.querySelectorAll(sel); } catch { return null; }
    let n = 0, rest = 0;
    for (const el of list) {
      if (el.closest(NOT_OURS)) continue;
      n++;
      if (!el.closest(TRANSIENT)) rest++;
      if (n >= 9999) break;
    }
    return { n, rest };
  }
  function measure(sels) {
    const counts = {}, transient = [];
    for (const sel of sels) {
      const c = countOf(sel);
      counts[sel] = c ? c.n : 0;
      if (c && c.n && !c.rest) transient.push(sel);
    }
    return { counts, transient };
  }
  // Loaded, the element count unchanged for QUIET ms (or MAX_WAIT passed), then idle.
  const settle = () => new Promise(resolve => {
    const begin = () => {
      const start = pristine.now();
      let size = pageSize(), since = start;
      const tick = () => {
        if (!live()) return;
        const now = pristine.now(), n = pageSize();
        if (n !== size) { size = n; since = now; }
        if (now - since >= QUIET || now - start >= MAX_WAIT) pristine.requestIdleCallback(() => resolve(), { timeout: 2000 });
        else pristine.setTimeout(tick, Math.max(200, QUIET - (now - since)));
      };
      pristine.setTimeout(tick, QUIET);
    };
    D.readyState === "complete" ? begin() : pristine.addEventListener(W, "load", begin, { once: true });
  });
  const checkable = m => m.enabled && !held(m) && !!((m.css || "").trim() || (m.js || "").trim());
  async function learn(m, size) {
    const { counts, transient } = measure(selectorsIn(m));
    const fp = makeFingerprint(m, counts, { url: location.href, size, transient });
    if (!fp) return;
    const next = { ...m, fp };
    const saved = (await call("mods.save", { mod: next }).catch(() => null)) || next;
    S.mods = S.mods.map(x => (x.id === saved.id ? saved : x));
  }
  async function pass(only) {
    const out = new Map();
    const page = { path: pagePathShape(location.href), size: pageSize() };
    for (const m of S.mods.filter(checkable)) {
      if (only && !only.has(m.id)) continue;
      if (!fingerprintCurrent(m)) { if (!only) await learn(m, page.size); continue; }
      const { counts } = measure(m.fp.sels.map(x => x[0]));
      let seen = [], errors = 0;
      if ((m.js || "").trim()) {
        const stats = await call("stats", { modId: m.id }).catch(() => null); // core/kit.js __stats
        seen = (stats?.watches || []).filter(w => w.total > 0).flatMap(w => String(w.selector).split(",").map(x => x.trim()));
        errors = stats?.errors || 0;
      }
      const a = assessFingerprint(m.fp, { ...page, counts, seen, errors });
      if (a.verdict === "broken") out.set(m.id, a.lost);
      else if (a.verdict === "ok") broken.delete(m.id); // (again: a late load)
    }
    return out;
  }
  async function run() {
    await settle();
    if (!live()) return;
    const href = location.href;
    let found = await pass(null);
    if (found.size) {
      await wait(CONFIRM);
      await settle();
      if (!live() || location.href !== href) return;
      found = await pass(new Set(found.keys()));
    }
    for (const [id, lost] of found) broken.set(id, lost);
    report();
  }
  function report() {
    const n = [...broken.keys()].filter(id => S.mods.some(m => m.id === id && m.enabled)).length;
    if (S.mode === "extension" && n !== badged) { badged = n; call("heal.badge", { count: n }).catch(() => {}); } // the toolbar button
    if (ui) { try { ui.healFound?.(); } catch (e) { warn(e); } }
    // Auto-fix (Settings) needs the model and the UI's review flow: load it now.
    else if (n && prefs.autoFix) { wantUi = true; loadUI().catch(() => {}); }
  }
  function soon() {
    if (!live()) return null;
    if (running) { again = true; return running; }
    running = run().catch(e => warn("self-heal", e)).finally(() => {
      running = null;
      if (again) { again = false; soon(); }
    });
    return running;
  }
  return {
    soon, broken: () => new Map(broken), forget: id => { broken.delete(id); },
    busy: () => !!running, // tests: a check is still on its way
    adopted() { if (broken.size || wantUi) { wantUi = false; try { ui.healFound?.(); } catch (e) { warn(e); } } },
  };
})();

// ---- the UI, loaded on first use
let ui = null, uiLoading = null, pendingKey = null;
const queued = [], toasts = [], tasks = [];
// Work only the UI can do (a toast with buttons): load it, then run.
function uiTask(name) {
  if (ui) { try { ui[name]?.(); } catch (e) { warn(e); } return; }
  tasks.push(name);
  loadUI().catch(() => {});
}
function loadUI() {
  if (ui) return Promise.resolve(ui);
  return (uiLoading ||= call("ui.load")
    .then(() => { if (!ui) throw new Error("the Morse UI did not start"); return ui; })
    .catch(e => { uiLoading = null; pendingKey = null; warn("couldn't load the UI", e); throw e; }));
}
function notify(text, idle) {
  if (ui) { try { ui.toast(text); } catch (e) { warn(e); } return; }
  toasts.push(text);
  const go = () => loadUI().catch(() => {});
  idle ? pristine.requestIdleCallback(go, { timeout: 3000 }) : go();
}
const UI_EVENTS = new Set(["toggle", "panel", "install.request"]);
listeners.add(msg => {
  if (msg.type === "settings.changed" && msg.settings) setBootPrefs(msg.settings);
  if (ui) return; // the UI handles everything else once it's here
  if (msg.type === "mods.changed") syncMods().catch(warn);
  else if (msg.type === "control.changed" && msg.pause && typeof msg.pause === "object") changeHeld(() => { Control.pause = normalizeControl({ pause: msg.pause }).pause; });
  else if (UI_EVENTS.has(msg.type)) { queued.push(msg); loadUI().catch(() => {}); }
});

// Hotkeys: the only keys Morse ever takes from the page while it's closed.
on(W, "keydown", e => {
  // Only real key presses: a page can't open Morse with a synthetic KeyboardEvent.
  if (ui || !e.isTrusted || e.isComposing || e.keyCode === 229) return;
  const id = hotkeyFor(e);
  if (!id) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat || pendingKey) return;
  pendingKey = { id, combo: keys[id], at: pristine.now(), up: false };
  loadUI().catch(() => {});
}, true);
on(W, "keyup", e => {
  if (ui || !e.isTrusted || !pendingKey || pendingKey.up || !releasesCombo(e, pendingKey.combo)) return;
  pendingKey.up = true;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
// Settings changed in another tab or window apply when this one regains focus.
let prefsAt = 0;
on(W, "focus", () => {
  if (ui || pristine.now() - prefsAt < 1500) return;
  prefsAt = pristine.now();
  loadPrefs().catch(() => {});
});

// ---- start: hello, safe start and the mods in parallel
syncMods().then(() => {
  // What the UI's controlReady() (63-control.js) would say after the first sync.
  const sus = Control.suspect, m = sus && S.mods.find(x => x.id === sus.id);
  if (sus && (!m || !m.enabled)) { Control.held.delete(sus.id); Control.suspect = null; ctl("control.forgive"); }
  else if (m || (Control.off && S.mods.some(x => x.enabled))) uiTask("controlReady");
  Heal.soon(); // self-heal: after the page settles and idles
}).catch(e => warn("couldn't load mods", e));
const ready = (async () => {
  let hello = {};
  try {
    hello = (await call("hello", { url: location.href })) || {};
    S.label = hello.label || ""; S.mode = hello.mode || ""; S.app = hello.app || null; S.appName = hello.appName || hello.app || null;
    // Hosts from before settings existed don't send them; ask (or use local ones).
    if (hello.settings) setBootPrefs(hello.settings); else await loadPrefs();
  } catch (e) { warn("host unavailable", e); }
  return hello;
})();
ready.then(hello => {
  if (!hello.quiet && hello.mode && prefs.welcome) notify(`Morse is ready. Press ${formatCombo(keys.open, PLATFORM) || "the Morse hotkey"} to change this page.`, true);
  // Screenshots and tests read the overlay's status: the UI comes at once (a
  // desktop host started with MORSE_DEBUG=1 says so in its hello).
  if (DEBUG || hello.debug) loadUI().catch(() => {});
}).catch(warn);

// ---- the handoff the UI (runtime/src, 01-rpc.js) picks up
Object.defineProperty(W, BOOT, { configurable: true, value: Object.freeze({
  v: 1, host, call, listeners, outgoing, S, pristine, on, off, live, control: Control, debug: DEBUG, platform: PLATFORM,
  ready, prefs: () => prefs, setCss, applyMod, removeMod, syncMods, domHooks, heal: Heal,
  // The UI calls this once it is built; whatever happened before it arrived
  // (a hotkey, a host event, a toast) is handed over.
  adopt(api) {
    if (ui || !live()) return false;
    ui = api;
    W.__morseRuntime = true;
    return true;
  },
  started() {
    const key = pendingKey;
    pendingKey = null;
    uiLoading = null;
    if (key) try { ui.key(key); } catch (e) { warn(e); }
    for (const m of queued.splice(0)) listeners.forEach(fn => { try { fn(m); } catch (e) { warn(e); } });
    for (const t of toasts.splice(0)) try { ui.toast(t); } catch (e) { warn(e); }
    for (const [m, r] of healthLog.values()) health(m, r);
    healthLog.clear();
    for (const name of tasks.splice(0)) try { ui[name]?.(); } catch (e) { warn(e); }
    Heal.adopted();
  },
}) });
// For a helper kit (core/kit.js) running in this same world.
if (!W[PRISTINE]) Object.defineProperty(W, PRISTINE, { value: pristine });
