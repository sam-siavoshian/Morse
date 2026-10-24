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
 * runtime/bundle.js wraps this file in an IIFE with core/hotkeys.js and
 * core/prefs.js inlined, inside a try/catch: Morse never throws into a page. */

const W = window, D = document;
const BOOT = Symbol.for("morse.boot"), PRISTINE = Symbol.for("morse.pristine");
if (W[BOOT] || W.__morseRuntime) return;
const host = W.__morseHost;
if (!host || typeof host.send !== "function" || typeof host.onMessage !== "function") return;

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
  const wrapped = function (e) { try { return apply(fn, this, [e]); } catch (err) { warn(err); } };
  regs.push({ target, type, fn, wrapped, opts, cap: capture(opts) });
  pristine.addEventListener(target, type, wrapped, opts);
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
  if (!msg || typeof msg !== "object") return;
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
let DEBUG = false;
try { DEBUG = !!W.localStorage.getItem("morse:debug"); } catch {}

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

async function applyMod(m) {
  setCss(m.id, m.css);
  if (!m.js || !m.js.trim()) return;
  await domReady;
  const r = await call("exec", { modId: m.id, js: m.js });
  if (r && !r.ok) notify(`“${m.title}” failed: ${r.error}`);
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
function urlChanged() {
  if (location.href === S.url) return;
  S.url = location.href;
  syncMods().catch(warn);
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

// ---- the UI, loaded on first use
let ui = null, uiLoading = null, pendingKey = null;
const queued = [], toasts = [];
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
  else if (UI_EVENTS.has(msg.type)) { queued.push(msg); loadUI().catch(() => {}); }
});

// Hotkeys: the only keys Morse ever takes from the page while it's closed.
on(W, "keydown", e => {
  if (ui || e.isComposing || e.keyCode === 229) return;
  const id = hotkeyFor(e);
  if (!id) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat || pendingKey) return;
  pendingKey = { id, combo: keys[id], at: pristine.now(), up: false };
  loadUI().catch(() => {});
}, true);
on(W, "keyup", e => {
  if (ui || !pendingKey || pendingKey.up || !releasesCombo(e, pendingKey.combo)) return;
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

// ---- start: hello and the mods in parallel
syncMods().catch(e => warn("couldn't load mods", e));
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
  if (!hello.quiet && hello.mode && prefs.welcome) notify(`Morse is ready · press ${formatCombo(keys.open, PLATFORM) || "the Morse hotkey"}`, true);
  if (DEBUG) loadUI().catch(() => {}); // screenshots and tests read the overlay's status
}).catch(warn);

// ---- the handoff the UI (runtime/src, 01-rpc.js) picks up
Object.defineProperty(W, BOOT, { value: Object.freeze({
  v: 1, host, call, listeners, outgoing, S, pristine, on, off, debug: DEBUG, platform: PLATFORM,
  ready, prefs: () => prefs, setCss, applyMod, removeMod, syncMods, domHooks,
  // The UI calls this once it is built; whatever happened before it arrived
  // (a hotkey, a host event, a toast) is handed over.
  adopt(api) {
    if (ui) return false;
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
  },
}) });
// The helper kit (core/kit.js) runs in this world on the desktop; it uses these too.
if (!W[PRISTINE]) Object.defineProperty(W, PRISTINE, { value: pristine });
