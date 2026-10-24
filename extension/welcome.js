// The welcome page, onboarding v2 (docs/dev/onboarding.md): one question, a
// model connected in one click, the first change guided on the practice page,
// then a real site. One screen at a time (welcome.html):
//
//   choose → connect → try → win
//
// Where you are is kept in chrome.storage.local "morse.start" { want, screen },
// so a reload (or "Connect a model" from the bar, #model) lands in the right place.
//
// Connecting looks for the Morse helper on this computer (popup.state reads its
// health). Morse Desktop runs one, and so does `morse serve`:
//   - it can ask (health.ask): one button. The helper asks a person there,
//     "Allow Chrome to use your Claude Code?", and Allow hands this browser a
//     token (popup.askStart / popup.askCheck, daemon/bridge.js /v1/pair/ask).
//   - it waits with a code (`morse setup --pair <this page's code>`): the page
//     pairs by itself, nothing to type.
//   - it shows its own code (`morse serve` without a terminal): a code box.
//   - nothing found: Get Morse Desktop, or paste an Anthropic API key, or (for
//     people with a terminal) `morse setup --pair <code>`.
//
// The practice area is practice.html in a sandboxed frame; this page relays its
// requests to the service worker (port "morse", the same dispatch websites use)
// and watches them to tick the steps: the bar opened ("warm"), a change was
// asked for ("generate"), a change was saved ("mods.save").

import "./i18n-page.js"; // the page in the person's language, before anything below runs
import { t } from "./core/i18n.js";
import { normalizePrefs } from "./core/prefs.js";
import { plainError } from "./core/onboarding.js";
import { detectPlatform, resolveHotkeys, comboParts, matchCombo } from "./core/hotkeys.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PLATFORM = detectPlatform(navigator);
const send = msg => chrome.runtime.sendMessage({ ...msg, url: location.href }).catch(e => ({ error: e.message }));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DESKTOP_URL = "https://github.com/sam-siavoshian/RRAA/releases/latest"; // Morse Desktop's downloads (docs/desktop-app.md)
// The marks of the models (brand/: desktop-app/ui/icons, one set for Morse
// Desktop and the extension; its NOTICE says where they came from).
const MARKS = { "claude-code": ["claude"], codex: ["openai"], anthropic: ["anthropic"], openai: ["openai"] };
const mark = (provider, cls = "pmark") => {
  const names = MARKS[provider];
  return names ? `<span class="${cls}" aria-hidden="true">${names.map(n => `<img src="brand/${n}.png" alt=""${n === "claude" ? "" : ' class="mono"'}>`).join("")}</span>` : "";
};
const CHECK = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;

// ---- the mark: the radar's still frame
{
  const OUTER = new Set([1, 2, 4, 7, 8, 11, 13, 14]), CORNER = new Set([0, 3, 12, 15]);
  let rects = "";
  for (let i = 0; i < 16; i++) if (!CORNER.has(i)) rects += `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx="1" class="${OUTER.has(i) ? "o" : "c"}"/>`;
  document.querySelector(".brand .mark").outerHTML = `<svg viewBox="0 0 15 15" width="18" height="18" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

// ---- the real shortcut, from the same settings the bar uses
let HOTKEYS = resolveHotkeys({}, PLATFORM);
const caps = id => {
  const parts = comboParts(HOTKEYS[id] || "", PLATFORM);
  return parts.length ? `<span class="caps">${parts.map(k => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : esc(t("welcome.theShortcut"));
};
async function loadHotkeys() {
  let stored;
  try { stored = (await chrome.storage.sync.get("morse.settings"))["morse.settings"]; } catch {}
  if (stored === undefined) stored = (await chrome.storage.local.get("morse.settings"))["morse.settings"];
  HOTKEYS = resolveHotkeys(normalizePrefs(stored).hotkeys, PLATFORM);
  $("step-open").innerHTML = t("start.step.open.d", { key: caps("open") });
  $("open-bar")?.addEventListener("click", openBar);
  renderWin();
}

// ---- where you are
const SCREENS = ["choose", "connect", "try", "win"];
let want = "", screen = "choose", sample = false;
async function loadStart() {
  let rec = null;
  try { rec = (await chrome.storage.local.get("morse.start"))["morse.start"]; } catch {}
  want = ["web", "apps", "both"].includes(rec?.want) ? rec.want : "";
  const hash = location.hash.slice(1);
  screen = hash === "model" ? "connect" : hash === "practice" ? "try" : SCREENS.includes(rec?.screen) ? rec.screen : "choose";
  if (screen !== "choose" && !want) want = "web";
}
const saveStart = () => chrome.storage.local.set({ "morse.start": { want, screen } }).catch(() => {});
function go(to, { focus = true } = {}) {
  screen = to;
  $("app").dataset.screen = to;
  for (const s of SCREENS) $(`s-${s}`).hidden = s !== to;
  const at = SCREENS.indexOf(to);
  for (const li of document.querySelectorAll("[data-dot]")) {
    const i = SCREENS.indexOf(li.dataset.dot);
    li.classList.toggle("done", i < at || (to === "win" && i <= 2));
    li.classList.toggle("now", li.dataset.dot === to || (to === "win" && li.dataset.dot === "try"));
    li.querySelector("button").disabled = i > at && !(to === "win" && i <= 2) || !want && i > 0;
    if (li.classList.contains("now")) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
  if (history.replaceState && location.hash) history.replaceState(null, "", location.pathname);
  saveStart();
  if (to === "connect") { arrived = st && st.kind !== "none"; renderConnect(); }
  if (to === "try") startPractice();
  if (to === "win") renderWin();
  scrollTo({ top: 0, behavior: "auto" });
  if (focus) $(`s-${to}`).querySelector("h1")?.focus({ preventScroll: true });
}
for (const b of document.querySelectorAll("[data-want]")) b.addEventListener("click", () => {
  want = b.dataset.want;
  go(st && st.kind !== "none" ? "try" : "connect");
});
for (const b of document.querySelectorAll("[data-go]")) b.addEventListener("click", () => go(b.dataset.go));
$("skip").addEventListener("click", () => { sample = true; go("try"); });

// ---- connect a model
// `st` is popup.state: { kind: helper|anthropic|none, label, helper: health | null }.
let st = null, looked = false, arrived = false;
let asking = null;   // { state: "waiting" } while the helper asks a person
let askError = "", pairError = "", keyError = "", busy = false, tried = false, triedAt = 0, copied = false;

// The code for `morse setup --pair <code>` (the terminal path): made here, kept
// until it is used, so the command shown doesn't change under you.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // daemon/bridge.js CODE_ALPHABET
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
}

const providerName = h => ({ "claude-code": "Claude Code", codex: "Codex", anthropic: t("start.keyModel"), openai: t("start.keyModel"), demo: t("start.demoModel") }[h?.provider] || h?.label || "");
const signedOut = h => {
  const k = h?.provider === "claude-code" ? "claude" : h?.provider === "codex" ? "codex" : "";
  return k && h.signedIn?.[k] === false;
};
const LIVE = (text, kind = "wait") => `<p class="live" role="status"><span class="dot ${kind}" aria-hidden="true"></span><span>${text}</span></p>`;

// What the connect screen shows, from what was found.
function connectView() {
  const h = st?.helper;
  if (st && st.kind !== "none") return "connected";
  if (!looked) return "looking";
  if (!h) return "none";
  if (h.provider === "none") return "noModel";
  if (h.ask && !pairError) return "ask";
  if (h.pairing && !pairError) return "auto";
  return "code";
}
let shownView = "", shownKey = "";
function renderConnect() {
  if (screen !== "connect") return;
  const view = connectView(), h = st?.helper;
  const where = h?.app === "desktop" ? t("start.desktop") : t("start.helper");
  const key = JSON.stringify([view, h?.app, h?.label, h?.provider, signedOut(h), asking?.state, askError, pairError, keyError, busy, copied, st?.label, want]);
  if (key === shownKey) return;
  shownKey = key;
  const box = $("connect");
  const keep = view === shownView && (view === "none" || view === "code") ? document.activeElement?.id : "";
  const keyValue = $("key")?.value || "", codeValue = $("code")?.value || "";
  shownView = view;
  let html = "";
  if (view === "looking") html = `<div class="card quiet">${LIVE(esc(t("start.looking")))}</div>`;
  else if (view === "connected") {
    const using = st.kind === "anthropic" ? "anthropic" : st.helper?.provider;
    html = `<div class="card ok" data-view="connected"><div class="head">${mark(using, "mtile") || `<span class="badge">${CHECK}</span>`}<div><b>${esc(t("start.connected"))}</b><span>${esc(t("welcome.using", { label: st.label }))}</span></div></div>
      ${arrived ? `<button type="button" class="primary big" id="next">${esc(t("start.next"))}</button>` : ""}</div>`;
  } else if (view === "ask") {
    const name = providerName(h);
    const waiting = asking?.state === "waiting";
    html = `<div class="card found" data-view="ask"><div class="head"><span class="badge">${CHECK}</span><div><b>${esc(t("start.found", { where }))}</b><span>${esc(t("start.canUse", { name }))}</span></div></div>
      ${signedOut(h) ? `<p class="note bad">${esc(t("start.signedOut", { name }))}</p>` : ""}
      <button type="button" class="primary big" id="use"${waiting ? " disabled" : ""}>${mark(h.provider)}${esc(t("start.use", { name }))}</button>
      ${waiting ? LIVE(esc(h.app === "desktop" ? t("start.allowDesktop") : t("start.allowTerminal")))
        : askError ? LIVE(esc(askError), "bad")
        : `<p class="small">${esc(h.app === "desktop" ? t("start.askNote") : t("start.askNoteTerminal"))}</p>`}</div>`;
  } else if (view === "auto") {
    html = `<div class="card found">${LIVE(esc(busy ? t("welcome.live.connecting") : t("welcome.live.found")))}</div>`;
  } else if (view === "noModel") {
    html = `<div class="card found" data-view="noModel"><div class="head"><span class="badge">${CHECK}</span><div><b>${esc(t("start.found", { where }))}</b><span>${esc(t("start.noModel"))}</span></div></div>
      ${LIVE(esc(h.app === "desktop" ? t("start.noModelDesktop") : t("start.noModelTerminal")))}</div>`;
  } else if (view === "code") {
    html = `<div class="card found" data-view="code"><div class="head"><span class="badge">${CHECK}</span><div><b>${esc(t("start.found", { where }))}</b><span>${esc(t("start.typeCode"))}</span></div></div>
      <div class="row"><input id="code" maxlength="7" placeholder="${esc(t("welcome.code"))}" aria-label="${esc(t("welcome.code.label"))}" autocomplete="off" spellcheck="false"><button type="button" class="primary" id="pair">${esc(t("welcome.connect"))}</button></div>
      ${pairError ? LIVE(esc(pairError), "bad") : busy ? LIVE(esc(t("welcome.live.connecting"))) : ""}</div>`;
  } else { // none: Morse Desktop, an API key, or a terminal
    const keyCard = `<div class="card" data-view="key"><b class="with-mark">${mark("anthropic")}${esc(t("start.key.h"))}</b><p>${esc(t("start.key.d"))}</p>
      <div class="row"><input id="key" type="password" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" aria-label="${esc(t("welcome.key.label"))}"><button type="button" class="primary" id="save-key">${esc(t("welcome.connect"))}</button></div>
      <p class="small${keyError ? " bad" : ""}" id="keynote" role="status">${keyError ? esc(keyError) : t("start.key.where")}</p></div>`;
    html = `<div class="cards${want === "web" ? " two" : ""}">
      <div class="card rec" data-view="desktop"><span class="tag">${esc(t("start.recommended"))}</span><b>${esc(t("start.getDesktop.h"))}</b>
        <p>${esc(t(want === "web" ? "start.getDesktop.web" : "start.getDesktop.d"))}</p>
        <a class="btn primary big" id="get-desktop" href="${DESKTOP_URL}" target="_blank" rel="noopener">${esc(t("start.getDesktop"))}</a>
        <p class="small">${t("start.haveDesktop")}</p>
        ${LIVE(esc(t("start.watching")))}</div>
      ${want === "web" ? keyCard : ""}</div>
      ${want === "web" ? "" : `<details class="more" id="key-more"${keyError || keyValue ? " open" : ""}><summary>${esc(t("start.key.more"))}</summary>${keyCard}</details>`}
      <details class="more" id="term"><summary>${esc(t("start.terminal"))}</summary><div class="card">
        <p>${esc(t("start.terminal.d"))}</p>
        <div class="cmd"><code id="setup-cmd">morse setup --pair ${esc(pairCode)}</code><button type="button" id="copy-setup" class="quiet">${esc(copied ? t("btn.copied") : t("welcome.copy"))}</button></div>
        <p class="small">${t("start.terminal.fallback", { cmd: `<code id="node-cmd">node daemon/cli.js setup --pair ${esc(pairCode)}</code>` })}</p></div></details>`;
  }
  const open = [...box.querySelectorAll("details[open]")].map(d => d.id);
  box.innerHTML = html;
  for (const id of open) { const d = $(id); if (d) d.open = true; }
  if ($("key")) $("key").value = keyValue;
  if ($("code")) $("code").value = codeValue;
  if (keep && $(keep)) $(keep).focus();
  wireConnect();
}
function wireConnect() {
  $("next")?.addEventListener("click", () => go("try"));
  $("use")?.addEventListener("click", askHelper);
  $("open-desktop")?.addEventListener("click", () => { location.href = "morse://open"; }); // Morse Desktop opens itself for its link (desktop-app/main.js)
  $("copy-setup")?.addEventListener("click", async () => {
    copied = true;
    try { await navigator.clipboard.writeText($("setup-cmd").textContent); } catch {}
    renderConnect();
    setTimeout(() => { copied = false; renderConnect(); }, 2400);
  });
  const key = $("key");
  if (key) {
    key.addEventListener("input", () => { if (keyError) { keyError = ""; const n = $("keynote"); n.classList.remove("bad"); n.innerHTML = t("start.key.where"); } });
    key.addEventListener("keydown", e => { if (e.key === "Enter") saveKey(); });
    $("save-key").addEventListener("click", saveKey);
  }
  const code = $("code");
  if (code) {
    code.addEventListener("input", () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (code.value.length === 6) pair(code.value, false);
    });
    code.addEventListener("keydown", e => { if (e.key === "Enter") $("pair").click(); });
    $("pair").addEventListener("click", () => {
      if (code.value.length !== 6) { pairError = t("welcome.pair.short"); return renderConnect(); }
      pair(code.value, false);
    });
  }
}

// One click: the helper asks a person on this computer, then hands over a token.
async function askHelper() {
  askError = "";
  asking = { state: "waiting" };
  renderConnect();
  const r = await send({ type: "popup.askStart" });
  if (!r || r.error || !r.id) { asking = null; askError = plainError(r?.error); return renderConnect(); }
  const end = Date.now() + (r.expires ? Math.max(5000, r.expires - Date.now()) : 120000);
  while (asking && Date.now() < end) {
    await new Promise(res => setTimeout(res, 700));
    const c = await send({ type: "popup.askCheck", id: r.id });
    if (c?.state === "waiting") continue;
    asking = null;
    if (c?.state === "allowed" && c.status) { st = c.status; arrived = false; afterConnect(); return; }
    askError = c?.state === "denied" ? t("start.denied") : c?.state === "expired" ? t("start.expired") : plainError(c?.error);
    return renderConnect();
  }
  if (asking) { asking = null; askError = t("start.expired"); renderConnect(); }
}

// The terminal path: our code, waiting in the helper (`morse setup --pair`), or one typed.
async function pair(code, auto) {
  busy = true; pairError = ""; renderConnect();
  const r = await send({ type: "popup.pair", code });
  busy = false;
  if (!r || r.error) pairError = auto ? t("welcome.pair.different") : plainError(r?.error);
  else { if (auto) await loadCode(true); st = r; return afterConnect(); }
  renderConnect();
}

async function saveKey() {
  const key = $("key").value.trim();
  if (!/^sk-ant-/.test(key)) { keyError = t("welcome.key.bad"); return renderConnect(); }
  const r = await send({ type: "popup.save", anthropicKey: key, backend: "anthropic" });
  $("key").value = "";
  if (!r || r.error) { keyError = plainError(r?.error); return renderConnect(); }
  keyError = "";
  st = r;
  afterConnect();
}

// Connected: say so for a moment, then on to the first change.
function afterConnect() {
  sample = false;
  renderPracticeNote();
  if (screen !== "connect") return;
  renderConnect();
  setTimeout(() => { if (screen === "connect" && st?.kind !== "none") go("try"); }, reduced ? 400 : 1100);
}

async function modelState() {
  const r = await send({ type: "popup.state" });
  if (!r || r.error) return;
  const was = st?.kind;
  st = r;
  looked = true;
  const h = r.helper;
  // A helper waiting with a code (morse setup --pair <our code>): try ours, once per waiting code.
  if (r.kind === "none" && h && !h.paired && h.pairing && !h.ask && !busy && !pairError && (!tried || Date.now() - triedAt > 30000)) {
    tried = true; triedAt = Date.now();
    return pair(pairCode, true);
  }
  if (!h?.pairing) tried = false;
  if (!h) { pairError = ""; askError = ""; }
  if (was === "none" && r.kind !== "none" && screen === "connect") return afterConnect();
  renderConnect();
  renderPracticeNote();
  renderWin(); // Morse Desktop found after the win: the apps part says so
}

// ---- the first change, on the practice page
const frame = document.createElement("iframe");
frame.title = t("welcome.frameTitle");
let practicePort = null, started = false;
const done = { open: false, ask: false, save: false };
function connectPractice() {
  practicePort = chrome.runtime.connect({ name: "morse-practice" });
  practicePort.onMessage.addListener(m => { if (m.toggle) openBar(); });
  // The service worker can be recycled; the practice area keeps working.
  practicePort.onDisconnect.addListener(() => { practicePort = null; setTimeout(connectPractice, 50); });
}
let port = null; // { p, inflight }: requests the practice bar still waits on (see host.js)
function relay(m) {
  watch(m);
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
});
function startPractice() {
  renderSteps();
  renderPracticeNote();
  loadPractice();
}
// The practice page loads with the welcome page (hidden until "try"), so the
// bar opens at once when you get there.
function loadPractice() {
  if (started) return;
  started = true;
  connectPractice();
  frame.src = "practice.html";
  $("frame").append(frame);
}
// The steps tick from what the practice bar asks for.
function watch(m) {
  if (!m || typeof m.type !== "string") return;
  if (m.type === "hello" && !practiceReady) { practiceReady = true; if (openWaiting) setTimeout(openBar, 150); } // the practice bar can open now
  if (m.type === "warm") done.open = true;
  if (m.type === "generate") done.open = done.ask = true;
  if (m.type === "mods.save" && m.draft && m.draft.kind !== "manual" && m.draft.kind !== "quick") {
    done.open = done.ask = done.save = true;
    setTimeout(() => go("win"), reduced ? 600 : 1600); // a moment to see it saved
  }
  renderSteps();
}
function renderSteps() {
  const order = ["open", "ask", "save"];
  const now = order.find(s => !done[s]);
  for (const li of document.querySelectorAll("#steps [data-step]")) {
    const s = li.dataset.step;
    li.classList.toggle("done", done[s]);
    li.classList.toggle("now", s === now);
    li.querySelector(".n").innerHTML = done[s] ? CHECK : String(order.indexOf(s) + 1);
  }
}
function renderPracticeNote() {
  const model = st ? st.kind !== "none" : false;
  $("practice-note").innerHTML = model ? esc(t("start.practice.model", { label: st.label })) : t("start.practice.sample");
  $("practice-note").querySelector("#to-connect")?.addEventListener("click", () => go("connect"));
}
// The whole practice frame in view while it's in use: the bar sits at its bottom.
const showFrame = () => $("frame").scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
addEventListener("blur", () => setTimeout(() => { if (document.activeElement === frame) showFrame(); }, 0));
let practiceReady = false, openWaiting = false;
function openBar() {
  if (screen !== "try") go("try", { focus: false });
  frame.focus();
  showFrame();
  openWaiting = !practiceReady; // clicked before the practice page was ready: open it once it is
  if (practiceReady) frame.contentWindow?.postMessage({ morseMsg: { type: "toggle" } }, "*");
}
// The shortcut pressed on this page (outside the frame) opens the practice bar.
addEventListener("keydown", e => {
  const open = HOTKEYS.open;
  if (e.isTrusted && screen === "try" && open && open !== "none" && matchCombo(e, open)) { e.preventDefault(); openBar(); }
});

// ---- the first win, then somewhere real
// Sites with a change worth trying first. Clicking one opens it with the bar
// open and the words typed (onboarding.firstSite in onboarding-host.js).
const SITES = [
  { id: "wiki", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Special:Random", ask: "make this easier to read" },
  { id: "hn", name: "Hacker News", url: "https://news.ycombinator.com/", ask: "dark mode with bigger text" },
  { id: "yt", name: "YouTube", url: "https://www.youtube.com/", ask: "hide Shorts" },
  { id: "bbc", name: "BBC News", url: "https://www.bbc.com/news", ask: "hide everything but the headlines" },
];
const APPS = ["VSCodium", "Obsidian", "Joplin"]; // the apps Morse was tested on (docs/desktop.md#tested-on)
let winKey = "";
function renderWin() {
  if (screen !== "win") return;
  const model = st ? st.kind !== "none" : true;
  const desktop = st?.helper?.app === "desktop";
  // drawn again only when what it shows changed (the model, Morse Desktop, the keys), so a site being typed stays
  const key = JSON.stringify([model, desktop, want, HOTKEYS.open, HOTKEYS.mods]);
  if (key === winKey && $("win").childElementCount) return;
  winKey = key;
  const sites = want !== "apps" ? `<section class="next" aria-labelledby="sites-h"><h2 id="sites-h">${esc(t("start.sites.h"))}</h2>
      <p class="small">${esc(t("start.sites.d"))}</p>
      <div class="sites">${SITES.map(s => `<button type="button" class="site" data-site="${s.id}"><b>${esc(s.name)}</b><span><q>${esc(s.ask)}</q></span></button>`).join("")}</div>
      <form class="row go" id="go-site"><input id="site" type="text" inputmode="url" placeholder="${esc(t("start.sites.placeholder"))}" aria-label="${esc(t("start.sites.label"))}" autocomplete="off" spellcheck="false"><button type="submit" class="primary">${esc(t("start.sites.go"))}</button></form>
      <p class="small" id="site-note" role="status">${t("start.sites.key", { key: caps("open") })}</p></section>` : "";
  const apps = want !== "web" ? `<section class="next" aria-labelledby="apps-h"><h2 id="apps-h">${esc(t("start.apps.h"))}</h2>
      <p class="small">${esc(desktop ? t("start.apps.d") : t("start.apps.get"))}</p>
      <ul class="apps">${APPS.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
      ${desktop ? `<p class="small">${t("start.apps.key", { key: caps("open") })}</p>` : `<a class="btn primary" href="${DESKTOP_URL}" target="_blank" rel="noopener">${esc(t("start.getDesktop"))}</a>`}</section>` : "";
  const connect = model ? "" : `<div class="card rec" data-view="win-connect"><b>${esc(t("start.win.sample"))}</b><p>${esc(t("start.win.sample.d"))}</p><button type="button" class="primary" id="win-connect">${esc(t("welcome.model.b"))}</button></div>`;
  $("win").innerHTML = `${connect}${want === "apps" ? apps + sites : sites + apps}
    <p class="small more-help">${t("start.win.help", { mods: caps("mods") })}</p>`;
  $("win-connect")?.addEventListener("click", () => go("connect"));
  for (const b of $("win").querySelectorAll("[data-site]")) b.addEventListener("click", () => { const s = SITES.find(x => x.id === b.dataset.site); openSite(s.url, s.ask); });
  $("go-site")?.addEventListener("submit", e => {
    e.preventDefault();
    let v = $("site").value.trim();
    if (!v) return $("site").focus();
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    try { const u = new URL(v); if (!/\./.test(u.hostname)) throw 0; openSite(u.href, ""); }
    catch { $("site-note").textContent = t("start.sites.bad"); }
  });
}
function openSite(url, ask) {
  send({ type: "onboarding.open", what: "site", site: url, ask }).then(r => { if (!r || r.error) chrome.tabs.create({ url }); });
}

// ---- start
await loadStart();
await loadCode();
await loadHotkeys();
chrome.storage.onChanged.addListener(c => {
  if (c["morse.settings"]) loadHotkeys();
  if (c.helper || c.model) modelState();
});
go(screen, { focus: false });
loadPractice();
modelState();
setInterval(() => { if (!document.hidden && (screen === "connect" || !st || st.kind === "none")) modelState(); }, 1500);
addEventListener("focus", modelState);
