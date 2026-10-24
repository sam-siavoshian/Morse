// The welcome page: real hotkeys, a practice area, and a checklist that ticks
// itself. The practice area is practice.html in a sandboxed frame; this page
// relays its requests to the service worker (port "morse", the same dispatch
// websites use) and runs mod code in it for the worker (port "morse-practice",
// see Practice in onboarding-host.js).

import { normalizePrefs } from "./core/prefs.js";
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
    el.innerHTML = parts.length ? `<span class="caps">${parts.map(k => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : "the Morse shortcut";
  }
}
await loadHotkeys();
chrome.storage.onChanged.addListener(c => { if (c["morse.settings"]) loadHotkeys(); });

// ---- the practice area
const frame = document.createElement("iframe");
frame.title = "Practice page";
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
    setTimeout(() => { if (evals.delete(id)) resolve({ ok: false, error: "The practice page didn't answer. Reload this page and try again." }); }, 4000);
  });
}

let port = null;
function relay(m) {
  if (!port) {
    port = chrome.runtime.connect({ name: "morse" });
    port.onMessage.addListener(r => frame.contentWindow?.postMessage({ morseMsg: r }, "*"));
    port.onDisconnect.addListener(() => { port = null; });
  }
  port.postMessage(m);
}
addEventListener("message", e => {
  if (e.source !== frame.contentWindow || !e.data) return;
  if (e.data.morsePractice) relay(e.data.morsePractice);
  if (e.data.morseEvalReply != null) { const done = evals.get(e.data.morseEvalReply); evals.delete(e.data.morseEvalReply); done?.(e.data.result); }
});
frame.src = "practice.html";
$("frame").append(frame);

function openBar() {
  frame.focus();
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
$("open-model").onclick = async () => {
  await chrome.storage.local.set({ "morse.popupFocus": "model" });
  try { await chrome.action.openPopup(); }
  catch { chrome.tabs.create({ url: "popup.html?url=" + encodeURIComponent(location.href) }); }
};
$("copy-setup").onclick = async e => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText("morse setup"); b.textContent = "Copied"; }
  catch { b.textContent = "Run morse setup in a terminal"; }
  setTimeout(() => (b.innerHTML = "Copy <code>morse setup</code>"), 2400);
};

// ---- the checklist: ticks itself from chrome.storage and Chrome's own state
function userScriptsOn() {
  try { chrome.userScripts.getScripts; return !!chrome.userScripts?.execute; } catch { return false; }
}
async function refresh() {
  const [st, pinned] = await Promise.all([
    chrome.runtime.sendMessage({ type: "onboarding.status" }).catch(() => null),
    chrome.action.getUserSettings ? chrome.action.getUserSettings().then(s => !!s.isOnToolbar).catch(() => false) : false,
  ]);
  const status = st?.status || {}, state = st?.state || {};
  const done = {
    pin: pinned,
    scripts: userScriptsOn() || status.userScripts === true,
    model: !!status.model?.connected,
    first: !!state.tips?.saved || status.mods > 0,
  };
  for (const [step, ok] of Object.entries(done)) document.querySelector(`[data-step="${step}"]`).classList.toggle("done", ok);
  $("model-label").textContent = status.model?.label && !done.model ? `Now: ${status.model.label}` : "";
  const n = Object.values(done).filter(Boolean).length;
  $("progress").textContent = n === 4 ? "All done" : `${n} of 4 done`;
}
refresh();
chrome.storage.onChanged.addListener(() => refresh());
addEventListener("focus", refresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 2000); // pinning and Allow User Scripts don't fire events
