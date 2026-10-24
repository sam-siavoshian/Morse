// The welcome page: real hotkeys, a practice area, and a checklist that ticks
// itself. The practice area is practice.html in a sandboxed frame; this page
// relays its requests to the service worker (port "morse", the same dispatch
// websites use) and runs mod code in it for the worker (port "morse-practice",
// see Practice in onboarding-host.js). "Connect a model" pairs with the Morse
// helper by itself once `morse setup --pair <code>` has run (see below).

import "./i18n-page.js"; // the page in the person's language, before anything below runs
import { t } from "./core/i18n.js";
import { normalizePrefs } from "./core/prefs.js";
import { plainError } from "./core/onboarding.js";
import { detectPlatform, resolveHotkeys, comboParts, matchCombo } from "./core/hotkeys.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PLATFORM = detectPlatform(navigator);

// ---- the mark: the radar's still frame
{
  const OUTER = new Set([1, 2, 4, 7, 8, 11, 13, 14]), CORNER = new Set([0, 3, 12, 15]);
  let rects = "";
  for (let i = 0; i < 16; i++) if (!CORNER.has(i)) rects += `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx="1" class="${OUTER.has(i) ? "o" : "c"}"/>`;
  document.querySelector(".brand .mark").outerHTML = `<svg viewBox="0 0 15 15" width="18" height="18" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

// ---- real hotkeys, from the same settings the bar uses
let HOTKEYS = resolveHotkeys({}, PLATFORM);
async function loadHotkeys() {
  let stored;
  try { stored = (await chrome.storage.sync.get("morse.settings"))["morse.settings"]; } catch {}
  if (stored === undefined) stored = (await chrome.storage.local.get("morse.settings"))["morse.settings"];
  HOTKEYS = resolveHotkeys(normalizePrefs(stored).hotkeys, PLATFORM);
  for (const el of document.querySelectorAll(".hk[data-hk]")) {
    const parts = comboParts(HOTKEYS[el.dataset.hk] || "", PLATFORM);
    el.innerHTML = parts.length ? `<span class="caps">${parts.map(k => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : esc(t("welcome.theShortcut"));
  }
}
await loadHotkeys();
chrome.storage.onChanged.addListener(c => { if (c["morse.settings"]) loadHotkeys(); });

// ---- the practice area
const frame = document.createElement("iframe");
frame.title = t("welcome.frameTitle");
let practicePort = null;
function connectPractice() {
  practicePort = chrome.runtime.connect({ name: "morse-practice" });
  practicePort.onMessage.addListener(m => {
    if (typeof m.eval === "string") evalInFrame(m.eval).then(result => practicePort?.postMessage({ evalReply: m.id, result }));
    if (m.toggle) openBar();
  });
  // The service worker can be recycled; the practice area keeps working.
  practicePort.onDisconnect.addListener(() => { practicePort = null; setTimeout(connectPractice, 50); });
}
connectPractice();

const evals = new Map();
let evalSeq = 0;
function evalInFrame(code) {
  return new Promise(resolve => {
    const id = ++evalSeq;
    evals.set(id, resolve);
    frame.contentWindow.postMessage({ morseEval: code, id }, "*");
    setTimeout(() => { if (evals.delete(id)) resolve({ ok: false, error: t("welcome.practiceSilent") }); }, 4000);
  });
}

let port = null; // { p, inflight }: requests the practice bar still waits on (see host.js)
function relay(m) {
  if (!port) {
    const p = chrome.runtime.connect({ name: "morse" });
    const inflight = new Set();
    port = { p, inflight };
    p.onMessage.addListener(r => {
      if (r && r.reply != null) inflight.delete(r.reply);
      frame.contentWindow?.postMessage({ morseMsg: r }, "*");
    });
    p.onDisconnect.addListener(() => {
      if (port?.p === p) port = null;
      const lost = [...inflight];
      inflight.clear();
      for (const id of lost) frame.contentWindow?.postMessage({ morseMsg: { reply: id, error: "message port closed" } }, "*");
    });
  }
  port.p.postMessage(m);
  if (m && m.id != null) port.inflight.add(m.id);
}
addEventListener("message", e => {
  if (e.source !== frame.contentWindow || !e.data) return;
  if (e.data.morsePractice) relay(e.data.morsePractice);
  if (e.data.morseEvalReply != null) { const done = evals.get(e.data.morseEvalReply); evals.delete(e.data.morseEvalReply); done?.(e.data.result); }
});
frame.src = "practice.html";
$("frame").append(frame);

// The whole practice frame in view while it's in use: the bar sits at its
// bottom, and on a laptop screen Save would otherwise be below the fold.
const showFrame = () => $("frame").scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
addEventListener("blur", () => setTimeout(() => { if (document.activeElement === frame) showFrame(); }, 0));
function openBar() {
  frame.focus();
  showFrame();
  frame.contentWindow.postMessage({ morseMsg: { type: "toggle" } }, "*");
}
$("try").onclick = openBar;
// The hotkey pressed on this page (outside the frame) opens the practice bar.
addEventListener("keydown", e => {
  const open = HOTKEYS.open;
  if (open && open !== "none" && matchCombo(e, open)) { e.preventDefault(); openBar(); }
});

// ---- setup buttons
const openExtensionSettings = () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
$("open-ext").onclick = openExtensionSettings;
$("open-ext-2").onclick = openExtensionSettings;

// ---- connect a model, in one command
// This page makes a pairing code and shows `morse setup --pair <code>`. That
// command chooses the model, starts the Morse helper and leaves the code
// waiting there; this page sees the helper (popup.state polls its health)
// and pairs with its own code. Nothing to type back. A helper started some
// other way (`morse serve`) shows its own code: then the code box appears.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // daemon/bridge.js CODE_ALPHABET
const send = msg => chrome.runtime.sendMessage({ ...msg, url: location.href }).catch(e => ({ error: e.message }));
let pairCode = "";
async function loadCode(fresh = false) {
  let rec = null;
  try { rec = (await chrome.storage.local.get("morse.pairCode"))["morse.pairCode"]; } catch {}
  if (fresh || !rec?.code) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    rec = { code: [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join("") };
    await chrome.storage.local.set({ "morse.pairCode": rec }).catch(() => {});
  }
  pairCode = rec.code;
  $("setup-cmd").textContent = `morse setup --pair ${pairCode}`;
  $("node-cmd").textContent = `node daemon/cli.js setup --pair ${pairCode}`;
}
await loadCode();

// What the model step says right now, in one line. `st` is popup.state.
let st = null, copied = false, tried = false, triedAt = 0, pairError = "", busy = false;
const LIVE = (text, kind = "wait") => `<span class="dot ${kind}" aria-hidden="true"></span><span>${text}</span>`;
function render() {
  const live = $("live"), h = st?.helper;
  const connected = !!st && st.kind !== "none";
  // The code box: only for a helper that's running without our code waiting.
  const manual = !connected && !!h && !h.paired && (!h.pairing || !!pairError);
  $("pairrow").hidden = !manual;
  if (connected) live.innerHTML = "";
  else if (busy) live.innerHTML = LIVE(esc(t("welcome.live.connecting")));
  else if (pairError) live.innerHTML = LIVE(esc(pairError), "bad");
  else if (h?.paired && h.provider === "none") live.innerHTML = LIVE(esc(t("welcome.live.noModel")), "bad");
  else if (manual) live.innerHTML = LIVE(esc(t("welcome.live.manual")), "ok");
  else if (h) live.innerHTML = LIVE(esc(t("welcome.live.found")));
  else live.innerHTML = LIVE(esc(copied ? t("welcome.live.waitingCopied") : t("welcome.live.waiting")));
  $("model-label").textContent = connected ? t("welcome.using", { label: st.label }) : "";
}

$("copy-setup").onclick = async e => {
  const b = e.currentTarget;
  copied = true;
  try { await navigator.clipboard.writeText($("setup-cmd").textContent); b.textContent = t("btn.copied"); }
  catch { b.textContent = t("welcome.selectCopy"); }
  setTimeout(() => (b.textContent = t("welcome.copy")), 2400);
  render();
};

async function pair(code, auto) {
  busy = true; pairError = ""; render();
  const r = await send({ type: "popup.pair", code });
  busy = false;
  if (!r || r.error) {
    // Our own code didn't match: the helper waits for a different one
    // (started with morse serve). Ask for that one instead of retrying.
    pairError = auto ? t("welcome.pair.different") : plainError(r?.error);
  } else {
    pairError = "";
    if (auto) await loadCode(true); // a code is used once
    st = r;
  }
  render();
  refresh();
}
$("code").oninput = () => {
  $("code").value = $("code").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if ($("code").value.length === 6) $("pair").click();
};
$("code").onkeydown = e => { if (e.key === "Enter") $("pair").click(); };
$("pair").onclick = () => {
  const code = $("code").value.trim();
  if (code.length !== 6) { pairError = t("welcome.pair.short"); return render(); }
  pair(code, false);
};
// The API key's own note, under its field (pairing keeps the live line).
const KEYNOTE = $("keynote").textContent;
const keyNote = (text, bad) => { $("keynote").textContent = text || KEYNOTE; $("keynote").classList.toggle("bad", !!bad); };
$("key").oninput = () => keyNote();
$("key").onkeydown = e => { if (e.key === "Enter") $("save-key").click(); };
$("save-key").onclick = async () => {
  const key = $("key").value.trim();
  if (!/^sk-ant-/.test(key)) return keyNote(t("welcome.key.bad"), true);
  const r = await send({ type: "popup.save", anthropicKey: key, backend: "anthropic" });
  $("key").value = "";
  if (!r || r.error) return keyNote(plainError(r?.error), true);
  keyNote(t("welcome.key.saved"));
  st = r;
  render();
  refresh();
};

async function modelState() {
  const r = await send({ type: "popup.state" });
  if (!r || r.error) return;
  const h = r.helper;
  // The helper is up with a code waiting: try ours, once per waiting code.
  if (r.kind === "none" && h && !h.paired && h.pairing && !busy && !pairError && (!tried || Date.now() - triedAt > 30000)) {
    tried = true; triedAt = Date.now();
    st = r;
    return pair(pairCode, true);
  }
  if (!h?.pairing) tried = false;
  st = r;
  render();
}

// ---- the checklist: ticks itself from chrome.storage and Chrome's own state
function userScriptsOn() {
  try { chrome.userScripts.getScripts; return !!chrome.userScripts?.execute; } catch { return false; }
}
async function refresh() {
  const [ob, pinned] = await Promise.all([
    chrome.runtime.sendMessage({ type: "onboarding.status" }).catch(() => null),
    chrome.action.getUserSettings ? chrome.action.getUserSettings().then(s => !!s.isOnToolbar).catch(() => false) : false,
    modelState(),
  ]);
  const status = ob?.status || {}, state = ob?.state || {};
  const model = st ? st.kind !== "none" : !!status.model?.connected;
  const done = {
    model,
    scripts: userScriptsOn() || status.userScripts === true,
    first: !!state.tips?.saved || status.mods > 0,
    pin: pinned,
  };
  for (const [step, ok] of Object.entries(done)) document.querySelector(`[data-step="${step}"]`).classList.toggle("done", ok);
  const n = Object.values(done).filter(Boolean).length;
  $("progress").textContent = n === 4 ? t("welcome.progress.all") : t("welcome.progress", { n });
  // The practice page works before a model is connected, with sample answers (onboarding-host.js).
  $("practice-note").innerHTML = model
    ? esc(t("welcome.practice.model"))
    : t("welcome.practice.sample");
}
refresh();
chrome.storage.onChanged.addListener(() => refresh());
addEventListener("focus", refresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 1500); // the helper, pinning and Allow User Scripts don't fire events
