// Try it here: the landing page's #try section. The real Morse runtime
// (dist/extension/runtime.js) runs inside a small demo app (demo/sites/tunes
// or byte), and this page is its host, the way the extension's service worker
// or the desktop connector is everywhere else. The demo model
// (core/demo.js) writes the changes: canned answers, streamed and run through
// the real engine. A request it has no answer for gets a plain note that
// points to installing Morse, never a stand-in change.
//
// Safety: the app runs in an iframe sandboxed with allow-scripts only, so it
// has its own opaque origin: no access to this page, its storage or cookies.
// Mod code only ever runs in there (site/try/frame.js). Nothing here or in
// the frame talks to a server: the demo files come from this site, and
// saved changes stay in this browser's storage for this page.
//
// section.js loads this module when the section is about to scroll into view,
// or when something in it is clicked, and passes every click on a
// [data-try] button to the controller this returns.

import { runMorse } from "../../core/engine.js";
import { registerProvider } from "../../core/providers.js";
import { demoResponse, isDemoFallback } from "../../core/demo.js";
import { wrapModCode } from "../../core/kit.js";
import { createMod, encodeShare } from "../../core/mod.js";
import { clipAdd } from "../../core/clipboard.js";
import { controlHandler } from "../../core/control-host.js";
import { normalizeOnboarding, mergeOnboarding } from "../../core/onboarding.js";
import { detectPlatform, resolveHotkeys, matchCombo, comboParts } from "../../core/hotkeys.js";

const APPS = {
  tunes: { page: new URL("../../demo/sites/tunes/index.html", import.meta.url).href, title: "Tunes, a music app" },
  byte: { page: new URL("../../demo/sites/byte/index.html", import.meta.url).href, title: "The Daily Byte, a news site" },
};
const RUNTIME = new URL("../../dist/extension/runtime.js", import.meta.url).href;
const BRIDGE = new URL("frame.js", import.meta.url).href;

// What the bar says for a request the demo model has no answer for.
const UNKNOWN = "ANSWER: This demo only has sample answers for a few changes, like the suggested ones. " +
  "With Morse installed, your own AI writes any change you ask for, on any site or app.\n";

// ---- storage: this page's localStorage (the frame has none), in memory when blocked
const memory = new Map();
const store = {
  get(k, d) {
    try { const v = localStorage.getItem("morse:try:" + k); if (v != null) return JSON.parse(v); } catch {}
    return memory.has(k) ? memory.get(k) : d;
  },
  set(k, v) {
    memory.set(k, v);
    try { localStorage.setItem("morse:try:" + k, JSON.stringify(v)); } catch {}
  },
  drop(k) {
    memory.delete(k);
    try { localStorage.removeItem("morse:try:" + k); } catch {}
  },
};

// ---- the demo model: core/demo.js's replies, streamed like a model's, in
// about two seconds whatever their length (a real model takes longer)
let onUnknown = () => {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
registerProvider("demo", async (s, messages, { onToken, signal }) => {
  let full = demoResponse(messages);
  if (isDemoFallback(full)) { full = UNKNOWN; onUnknown(); }
  await sleep(300);
  let text = "";
  const step = Math.max(4, Math.ceil(full.length / 110));
  for (let i = 0; i < full.length;) {
    if (signal?.aborted) throw Object.assign(new Error("Stopped"), { name: "AbortError" });
    const n = step + Math.floor(Math.random() * 3);
    const tok = full.slice(i, i += n);
    text += tok;
    onToken?.(tok);
    await sleep(16);
  }
  return text;
});

export function startTry(section) {
  const $ = sel => section.querySelector(sel);
  const view = $(".try-view");
  const status = $(".try-status");
  const platform = detectPlatform();
  let app = store.get("app", "tunes") in APPS ? store.get("app", "tunes") : "tunes";
  let frame = null, ready = false, readyWait = null, pages = {};
  let draft = null; // the id of a change that waits for Save or Undo
  const running = new Map(); // genId -> AbortController
  const ops = new Map(); // frame op seq -> resolve
  let opSeq = 0;

  const modsKey = () => "mods:" + app;
  const mods = () => store.get(modsKey(), {});
  const putMods = all => store.set(modsKey(), all);

  // ---- what the page says
  function say(html, kind = "") {
    status.innerHTML = html;
    status.dataset.kind = kind;
  }
  const savedCount = () => Object.keys(mods()).length;
  function showCount() {
    const n = savedCount();
    const el = $(".try-count");
    if (el) el.textContent = n ? (n === 1 ? "1 saved change" : `${n} saved changes`) : "";
    $(".try-reset").hidden = !n;
  }

  // ---- the frame
  const post = msg => { try { frame?.contentWindow?.postMessage({ morseTry: 1, ...msg }, "*"); } catch {} };
  const event = ev => post({ event: ev });
  function frameOp(op, id, code) {
    return new Promise(resolve => {
      const seq = ++opSeq;
      ops.set(seq, resolve);
      post({ op, seq, id, code });
      setTimeout(() => { if (ops.delete(seq)) resolve({ ok: false, error: "The demo app didn't answer" }); }, 8000);
    });
  }
  async function pageHtml(name) {
    if (!pages[name]) pages[name] = fetch(APPS[name].page).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    return pages[name];
  }
  async function load() {
    const html = await pageHtml(app);
    const doc = html.replace(/<\/body>/i, `<script src="${BRIDGE}"></script><script src="${RUNTIME}"></script></body>`);
    for (const c of running.values()) c.abort();
    running.clear();
    ops.clear();
    draft = null;
    ready = false;
    const next = document.createElement("iframe");
    next.className = "try-frame";
    next.title = `Demo app: ${APPS[app].title}`;
    next.setAttribute("sandbox", "allow-scripts");
    next.setAttribute("allow", "clipboard-write");
    next.srcdoc = doc;
    readyWait = new Promise(r => { next.addEventListener("load", r, { once: true }); });
    if (frame) frame.replaceWith(next); else view.append(next);
    frame = next;
    section.classList.add("is-live");
    await readyWait;
    showCount();
  }

  addEventListener("message", e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.morseTry !== 1) return;
    if (d.ready) ready = true;
    if (d.done != null && ops.has(d.done)) { ops.get(d.done)(d.result); ops.delete(d.done); }
    if (d.host && typeof d.host === "object" && typeof d.host.type === "string") {
      const m = d.host;
      Promise.resolve().then(() => handle(m))
        .then(result => { if (m.id != null) event({ reply: m.id, result: result ?? null }); })
        .catch(err => { if (m.id != null) event({ reply: m.id, error: String(err?.message || err) }); });
    }
  });

  // ---- Morse's host, for the runtime in the frame (demo/playground.html's fake host, over postMessage)
  let ctl = null;
  const control = () => (ctl ||= controlHandler({
    load: () => store.get("control:" + app, {}), save: s => store.set("control:" + app, s),
    listMods: () => Object.values(mods()),
    putMods: list => { const all = mods(); for (const x of list) all[x.id] = x; putMods(all); },
    onPause: pause => setTimeout(() => event({ type: "control.changed", pause }), 0),
  }));
  const NOT_HERE = "That isn't part of this demo. Install Morse to use it.";
  const onboarding = () => normalizeOnboarding({ ...store.get("onboarding", {}), coach: "done" });
  async function handle(m) {
    switch (m.type) {
      case "hello":
        return { mode: "try", label: "sample answers", quiet: true, debug: navigator.webdriver === true };
      case "ui.load": case "warm": case "capture": case "heal.badge":
      case "clip.start": case "clip.stop": case "clip.cancel": case "history.get": case "history.add":
        return null;
      case "settings.get": return store.get("settings", {});
      case "settings.set": {
        const cur = store.get("settings", {}), next = { ...cur };
        for (const [k, v] of Object.entries(m.settings || {})) next[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(cur[k] || {}), ...v } : v;
        store.set("settings", next);
        return next;
      }
      // The steps beside the app stand in for the bar's own first-run coach,
      // so the bar keeps its height for the app and shows every tool now
      // (it holds back Page tools and the Edit tools until a first Save).
      case "onboarding.get": return { state: onboarding(), status: { mode: "try", sample: true, model: { connected: false } } };
      case "onboarding.set": { const s = mergeOnboarding(onboarding(), m.patch || {}); store.set("onboarding", s); return s; }
      case "mods.list": return Object.values(mods());
      case "mods.save": {
        const x = m.draft ? createMod({ ...m.draft, app: null, model: m.draft.kind ? null : "sample answers" }) : m.mod;
        if (!x || typeof x !== "object" || !x.id) throw new Error("Nothing to save");
        const all = mods(); all[x.id] = x; putMods(all);
        if (draft && x.id === draft) {
          draft = null;
          say(`<b>Saved.</b> Now press <b>Reload app</b>: your change comes back, the way Morse brings back every mod.`, "saved");
        } else if (m.draft) say(`<b>Saved “${esc(x.title)}”.</b> Press <b>Reload app</b> and it comes back.`, "saved");
        showCount();
        return x;
      }
      case "mods.delete": { const all = mods(); delete all[m.modId]; putMods(all); showCount(); return true; }
      case "exec": return frameOp("exec", m.modId, wrapModCode(m.modId, String(m.js || "")));
      case "off":
        if (draft && m.modId === draft) { draft = null; say("Undone. Nothing was saved. Pick another change, or describe your own.", ""); }
        return frameOp("off", m.modId);
      case "stats": return frameOp("stats", m.modId);
      case "clipboard.list": return store.get("clipboard", []);
      case "clipboard.put": { const l = clipAdd(store.get("clipboard", []), m.item); store.set("clipboard", l); return l; }
      case "share":
        if (m.kind === "link") return { link: await encodeShare(m.mod) };
        throw new Error(NOT_HERE);
      case "gallery.list": return [];
      case "generate": return generate(m);
      case "generate.cancel": running.get(m.genId)?.abort(); return true;
    }
    if (m.type.startsWith("control.") || m.type === "mods.preview") return control()(m, { url: m.url || "about:srcdoc", app: null });
    throw new Error(NOT_HERE);
  }

  async function generate(m) {
    const abort = new AbortController();
    running.set(m.genId, abort);
    let unknown = false;
    onUnknown = () => { unknown = true; };
    say("Morse is writing the change. Watch the app.", "working");
    try {
      const res = await runMorse({
        settings: { provider: "demo" }, request: String(m.request || ""), context: m.context || {}, base: m.base, signal: abort.signal,
        exec: js => frameOp("exec", m.genId, wrapModCode(m.genId, js)),
        emit: ev => event({ ...ev, genId: m.genId }),
      }).catch(e => ({ ok: false, error: e?.name === "AbortError" ? "Stopped" : e.message }));
      if (unknown) {
        say(`This demo only has sample answers for the suggested changes. <a href="${esc(section.dataset.install || "#install")}">Get Morse</a> to ask for anything, on any site or app.`, "unknown");
      } else if (res.ok && res.kind === "answer") {
        say("Answered in the app.", "");
      } else if (res.ok) {
        draft = m.genId;
        const second = res.attempts > 1 ? " Morse found a mistake in the first try and fixed it." : "";
        say(`<b>Done.</b>${second} Press <b>Save</b> in the bar to keep it, or <b>Undo</b>.`, "done");
      } else if (res.error === "Stopped") say("Stopped. Nothing was changed.", "");
      else say("That didn't work. Try another change.", "");
      return { ok: res.ok, kind: res.kind, error: res.error, title: res.title, css: res.css, js: res.js, attempts: res.attempts };
    } finally {
      running.delete(m.genId);
    }
  }

  // ---- the controls next to the app
  // The whole window in view while Morse works in it (on a phone the buttons
  // are under it).
  function showWindow() {
    const win = $(".try-window"), r = win.getBoundingClientRect();
    if (r.top >= 76 && r.bottom <= innerHeight) return;
    win.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  async function focusFrame() {
    showWindow();
    if (!frame) await load();
    if (!ready) await readyWait;
    frame.focus({ preventScroll: true });
    try { frame.contentWindow.focus(); } catch {}
  }
  async function open() {
    await focusFrame();
    event({ type: "open" });
  }
  async function ask(btn) {
    if (draft) {
      say("Save or Undo the change in the bar first.", "");
      await focusFrame();
      return;
    }
    await focusFrame();
    event({ type: "request", text: btn.dataset.text || btn.textContent.trim(), at: btn.dataset.at || undefined });
  }
  async function pickApp(name) {
    if (!(name in APPS) || (name === app && frame)) return;
    app = name;
    ctl = null;
    store.set("app", app);
    syncTabs();
    say("");
    await load();
  }
  function syncTabs() {
    section.dataset.app = app;
    for (const t of section.querySelectorAll("[data-try=app]")) {
      const on = t.dataset.app === app;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const g of section.querySelectorAll("[data-asks]")) g.hidden = g.dataset.asks !== app;
  }
  async function reload() {
    const n = savedCount();
    await load();
    say(n ? `<b>Reloaded.</b> ${n === 1 ? "Your saved change came back" : `Your ${n} saved changes came back`}. That's a mod: a change you saved. Morse brings it back every time you open that site or app.` : "Reloaded. Nothing is saved yet, so the app is as it was.", n ? "back" : "");
  }
  async function reset() {
    store.drop(modsKey());
    store.drop("control:" + app);
    ctl = null;
    await load();
    say("Started over. Every change in this demo app is gone.", "");
  }

  // The shortcut, pressed on this page while the demo is in view, opens Morse
  // in the app (inside the app, the runtime catches it itself).
  let inView = false;
  new IntersectionObserver(es => { inView = es.some(e => e.isIntersecting); }, { threshold: 0.2 }).observe(view);
  addEventListener("keydown", e => {
    if (!inView || !e.isTrusted || e.repeat) return;
    const keys = resolveHotkeys(store.get("settings", {}).hotkeys, platform);
    if (keys.open && keys.open !== "none" && matchCombo(e, keys.open)) { e.preventDefault(); open(); }
  });
  const caps = comboParts(resolveHotkeys(store.get("settings", {}).hotkeys, platform).open, platform);
  for (const el of section.querySelectorAll(".try-keys")) el.innerHTML = caps.map(k => `<kbd>${esc(k)}</kbd>`).join(" ");

  // Arrow keys move between the app tabs.
  section.querySelector("[role=tablist]")?.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = [...section.querySelectorAll("[data-try=app]")];
    const i = tabs.findIndex(t => t.dataset.app === app);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    e.preventDefault();
    next.focus();
    pickApp(next.dataset.app);
  });

  syncTabs();
  const loading = load().catch(() => {
    section.classList.add("is-failed");
    say("The demo couldn't load. Reload this page to try again.", "");
  });

  return {
    loading,
    // section.js passes every click on a [data-try] button here.
    async click(btn) {
      await loading;
      const what = btn.dataset.try;
      if (what === "open") return open();
      if (what === "ask") return ask(btn);
      if (what === "app") return pickApp(btn.dataset.app);
      if (what === "reload") return reload();
      if (what === "reset") return reset();
    },
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
