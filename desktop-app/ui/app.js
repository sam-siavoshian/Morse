// The Morse app's window. It only talks to window.morse (preload.cjs); every
// name it shows that came from a mod or an app goes in as text, never as markup.
// Its words are in core/locales/*.js (desk.*), in the computer's language.

import { t, setLanguage, loadLanguage, pickLanguage, setLanguageLoader, translatePage } from "./core/i18n.js";
import { comboFromEvent, comboParts, formatCombo, formatPartial, defaultHotkeys, decideOpenShortcut, detectPlatform } from "./core/hotkeys.js";
import { formName } from "./formation.js";
import { afterOpenBar, noticeStillShown } from "./open-bar.js";

setLanguageLoader(code => import(`./core/locales/${code}.js`).then(m => m.default));
setLanguage(await loadLanguage(pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language])));
translatePage(document);

const morse = window.morse;
const $ = id => document.getElementById(id);
const platform = new URLSearchParams(location.search).get("platform") || "";
document.body.classList.toggle("mac", platform === "darwin");
// The same names core/hotkeys.js uses: the window is told its OS in the page URL.
const HK_PLATFORM = platform === "darwin" ? "mac" : platform === "win32" ? "win" : platform === "linux" ? "linux" : detectPlatform();

// A small element builder: h("li", { class: "x", onclick }, child, "text").
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const svgNS = "http://www.w3.org/2000/svg";
// The radar, pulsing: Morse is working on it.
function radar(size = 16) {
  const s = document.createElementNS(svgNS, "svg");
  s.setAttribute("viewBox", "0 0 15 15"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("fill", "currentColor");
  s.setAttribute("class", "radar live"); s.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 16; i++) {
    if ([0, 3, 12, 15].includes(i)) continue;
    const r = document.createElementNS(svgNS, "rect");
    for (const [k, v] of Object.entries({ x: (i % 4) * 4, y: Math.floor(i / 4) * 4, width: 3, height: 3, rx: 1 })) r.setAttribute(k, v);
    r.setAttribute("class", [5, 6, 9, 10].includes(i) ? "c" : "o");
    s.append(r);
  }
  return s;
}
// An app's own icon, or (for an app with none Morse can read) the Apps glyph
// from the sidebar: never a letter standing in for a picture.
function appsGlyph() {
  const s = document.createElementNS(svgNS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "aria-hidden": "true" })) s.setAttribute(k, v);
  for (const [x, y] of [[2.5, 2.5], [9, 2.5], [2.5, 9], [9, 9]]) {
    const r = document.createElementNS(svgNS, "rect");
    for (const [k, v] of Object.entries({ x, y, width: 4.5, height: 4.5, rx: 1.2 })) r.setAttribute(k, v);
    s.append(r);
  }
  return s;
}
function trashGlyph() {
  const s = document.createElementNS(svgNS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "aria-hidden": "true" })) s.setAttribute(k, v);
  const p = document.createElementNS(svgNS, "path");
  p.setAttribute("d", "M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.8 7v4M9.2 7v4");
  s.append(p);
  return s;
}
function appIcon(a) {
  return h("div", { class: `appicon${a.icon ? " has-img" : ""}`, "aria-hidden": "true" }, a.icon ? h("img", { src: a.icon, alt: "" }) : appsGlyph());
}
const caps = combo => h("span", { class: "caps" }, ...String(combo || "").split("+").filter(Boolean).map(k => h("kbd", { text: k })));
const openKey = () => st.keys.open || (platform === "darwin" ? "⌥+Space" : "Ctrl+Shift+Space");
// A message with the shortcut's keys in it: t() with {key} as a marker, then the keys put in its place.
function withKeys(id, combo) {
  const [before, after = ""] = t(id, { key: "\u0000" }).split("\u0000");
  return [before, caps(combo), after];
}
// Small monochrome marks, drawn here. Claude Code and an Anthropic key share
// the spark, Codex and an OpenAI key share the blossom, a local model is a chip.
function svgEl(tag, attrs) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function markSvg(extra) {
  return svgEl("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "currentColor", "aria-hidden": "true", ...extra });
}
function claudeMark() {
  const s = markSvg();
  for (let i = 0; i < 8; i++) s.append(svgEl("rect", { x: "11.05", y: "2.1", width: "1.9", height: "6.6", rx: "0.95", transform: `rotate(${i * 45} 12 12)` }));
  return s;
}
function openaiMark() {
  const s = markSvg();
  for (let i = 0; i < 6; i++) s.append(svgEl("rect", { x: "10.2", y: "1.5", width: "3.6", height: "8.4", rx: "1.8", transform: `rotate(${i * 60} 12 12)` }));
  return s;
}
function localMark() {
  const s = markSvg({ fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" });
  s.append(svgEl("rect", { x: "7", y: "7", width: "10", height: "10", rx: "2" }));
  s.append(svgEl("rect", { x: "10", y: "10", width: "4", height: "4", rx: "0.6", fill: "currentColor", stroke: "none" }));
  for (const d of ["M9 7V4", "M12 7V4", "M15 7V4", "M9 17v3", "M12 17v3", "M15 17v3", "M7 9H4", "M7 12H4", "M7 15H4", "M17 9h3", "M17 12h3", "M17 15h3"]) s.append(svgEl("path", { d }));
  return s;
}
const MARKS = { "claude-code": claudeMark, claude: claudeMark, anthropic: claudeMark, codex: openaiMark, openai: openaiMark, local: localMark };
function providerMark(id, big = false) {
  const tile = h("span", { class: `mark-tile${big ? " big" : ""}`, "aria-hidden": "true" });
  const draw = MARKS[id];
  if (!draw) { const r = radar(big ? 22 : 20); r.classList.remove("live"); tile.append(r); }
  else tile.append(draw());
  return tile;
}
const secs = ms => (ms / 1000).toFixed(1);
// The model's name, in the person's words. Product names stay as people say them.
const modelName = m => {
  if (m.provider === "local" && m.runtime && m.runtime !== "local" && m.name) return m.name;
  return ({ "claude-code": t("desk.model.claude"), codex: t("desk.model.codex"), anthropic: t("desk.model.anthropic"), openai: t("desk.model.openai"), local: t("desk.model.local"), demo: t("desk.model.demo") }[m.provider] || m.name);
};

let st = null;

// ---------------------------------------------------------------- sections
function show(tab) {
  for (const b of document.querySelectorAll("nav button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  if (tab === "checks") tab = "model"; // simplify: Checks is a card in Model now
  if (tab !== "mods") hideUndo(); // a stale "Undo delete" shouldn't wait on another page
  for (const s of document.querySelectorAll("main > section")) {
    const on = s.id === tab;
    // Fade only a section that was hidden. The one painted first stays still.
    if (on && s.hidden) s.classList.add("arrive");
    else if (!on) s.classList.remove("arrive");
    s.hidden = !on;
  }
  try { sessionStorage.setItem("tab", tab); } catch {}
  $(tab).closest("main").scrollTop = 0;
  // Checks ask the model a question, so they run only when asked.
  if (tab === "model" && !$("check-list").children.length) $("check-list").replaceChildren(h("li", { class: "empty" }, t("desk.checks.first")));
  if (tab === "model") refreshChoices();
}
for (const b of document.querySelectorAll("nav button")) b.onclick = () => show(b.dataset.tab);
for (const b of document.querySelectorAll("[data-go]")) b.onclick = () => show(b.dataset.go);
for (const b of document.querySelectorAll("[data-link]")) b.onclick = () => morse.openLink(b.dataset.link);

// ---------------------------------------------------------------- apps
const STATUS = {
  connected: a => [h("i", { class: "dot on" }), h("span", { text: [t("desk.app.connected"), a.windows ? t("desk.app.windows", { n: a.windows }) : "", a.modsOn ? t("desk.app.modsOn", { n: a.modsOn }) : ""].filter(Boolean).join(" · ") })],
  waiting: () => [h("i", { class: "dot wait" }), h("span", { text: t("desk.app.waiting") })],
  connecting: () => [radar(12), h("span", { text: t("desk.app.connecting") })],
  opening: a => [radar(12), h("span", { text: t("desk.app.opening", { name: a.name }) })],
  disconnecting: () => [radar(12), h("span", { text: t("desk.app.disconnecting") })],
  "open-connectable": () => [h("i", { class: "dot" }), h("span", { text: t("desk.app.ready") })],
  open: () => [h("i", { class: "dot" }), h("span", { text: t("desk.app.openWithout") })],
  closed: a => [h("span", { text: [a.version ? t("desk.app.version", { version: a.version }) : t("desk.app.notOpen"), a.mods ? t("desk.app.mods", { n: a.mods }) : ""].filter(Boolean).join(" · ") })],
};

function appRow(a) {
  const cant = a.canAttach === false;
  const status = cant ? [h("span", { text: t("desk.app.cant", { why: a.why }) })]
    : a.canAttach === null && a.state === "closed" ? [h("span", { text: t("desk.app.unknown") })]
    : (STATUS[a.state] || STATUS.closed)(a);
  const busy = ["opening", "disconnecting", "connecting"].includes(a.state);
  let button = null;
  if (cant) button = null;
  else if (a.state === "connected" || a.state === "waiting" || a.canStop) button = h("span", { class: "row-acts" },
    ...(a.state === "connected" ? [h("button", { type: "button", class: "btn primary", "data-act": "open-bar", onclick: () => openBar(a) }, t("desk.app.openBar"))] : []),
    h("button", { type: "button", class: "btn", "data-act": "disconnect", onclick: () => disconnect(a) }, t("desk.app.disconnect")));
  else if (a.state === "open-connectable") button = h("button", { type: "button", class: "btn", "data-act": "connect", onclick: () => open(a) }, t("desk.app.connect"));
  else button = h("button", { type: "button", class: "btn", "data-act": "open", disabled: busy, onclick: () => open(a) }, t("desk.app.open"));
  return h("li", { class: cant ? "cant" : a.state, "data-app": a.id },
    appIcon(a),
    h("div", { class: "grow" }, h("b", { text: a.name }), h("small", {}, ...status)),
    h("div", { class: "actions" }, button));
}

// Three quiet rows, the same shape as an app, while the list is not ready yet.
// No copy: the heading already says what this screen is.
function skeletonItems(n = 3) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(h("li", { class: "skel", "aria-hidden": "true" },
    h("span", { class: "skel-icon" }),
    h("span", { class: "skel-copy" }, h("span"), h("span"))));
  return rows;
}

// Rows are only rebuilt when what they show changed, so focus stays put
// while the list refreshes.
function renderApps() {
  showAppsError(); // a Connected row clears a stale "isn't running yet" banner
  const list = $("app-list");
  // appsPending: the shell is up before the scan (icons, process list). The
  // skeleton stays until that pass replaces it. data-ready is not held for it.
  if (st.appsPending) {
    if (!list.querySelector("li.skel")) list.replaceChildren(...skeletonItems());
    list.setAttribute("aria-busy", "true");
    list.dataset.pending = "1";
    $("no-model").hidden = !st.model?.none;
    const nav = $("nav-apps");
    nav.textContent = "";
    nav.className = "";
    $("apps-lede").replaceChildren(...withKeys("desk.apps.lede", openKey()));
    return;
  }
  list.removeAttribute("aria-busy");
  delete list.dataset.pending;
  const rows = st.apps || [];
  const seen = new Set();
  if (!rows.length) {
    // Pending scans already returned the skeleton above. An empty list here is a finished scan.
    list.replaceChildren(h("li", { class: "empty" }, t("desk.apps.none")));
  } else {
    if (list.querySelector("li.empty, li.skel")) list.replaceChildren();
    let prev = null;
    for (const a of rows) {
      const sig = JSON.stringify([a.name, a.state, a.canStop ? 1 : 0, a.windows, a.mods, a.modsOn, a.version, a.icon ? 1 : 0, a.canAttach, a.why]);
      let li = list.querySelector(`li[data-app="${CSS.escape(a.id)}"]`);
      if (!li || li.dataset.sig !== sig) {
        const fresh = appRow(a);
        fresh.dataset.sig = sig;
        // A connected row rebuilds on every status tick; keep focus on the same
        // action (Disconnect stays Disconnect), not always the first button.
        const act = li?.contains(document.activeElement) ? document.activeElement.dataset.act : null;
        if (li) li.replaceWith(fresh); else list.append(fresh);
        li = fresh;
        if (act) (li.querySelector(`[data-act="${act}"]`) || li.querySelector("button"))?.focus();
      }
      if (prev ? prev.nextElementSibling !== li : list.firstElementChild !== li) prev ? prev.after(li) : list.prepend(li);
      prev = li;
      seen.add(a.id);
    }
  }
  for (const li of [...list.querySelectorAll("li[data-app]")]) if (!seen.has(li.dataset.app)) li.remove();
  $("no-model").hidden = !st.model.none;
  const on = rows.filter(a => a.state === "connected").length;
  const nav = $("nav-apps");
  nav.textContent = on ? t("desk.nav.on", { n: on }) : rows.filter(a => a.canAttach !== false).length || "";
  nav.className = on ? "on" : "";
  $("apps-lede").replaceChildren(...withKeys("desk.apps.lede", openKey()));
}

// plainError: a failure that stands on its own (couldn't open, opened outside
// Morse). barMiss: Open the bar said Morse isn't in that app yet. The two
// can't be the screenshot: a Connected row and that banner at once.
let plainError = "";
let barMiss = null;
function showAppsError() {
  const app = barMiss && st?.apps?.find(a => a.id === barMiss);
  const code = noticeStillShown(app ? app.state : null, barMiss ? "notReady" : null);
  if (code !== "notReady") barMiss = null;
  const text = code === "notReady" && app ? t("desk.openBar.notReady", { name: app.name }) : plainError;
  const el = $("apps-error");
  if ((el.textContent || "") !== (text || "")) el.textContent = text || "";
  el.hidden = !text;
}
function appError(text) { plainError = text || ""; barMiss = null; showAppsError(); }

async function open(a, answer) {
  appError("");
  const r = await morse.openApp(a.id, answer);
  if (r?.needsRestart) return askRestart(a);
  if (r?.error) appError(r.error);
}
// "Open the bar": Morse's bar in the app, for when the shortcut does nothing
// (another app took it, or the keyboard makes it hard to press).
async function openBar(a) {
  appError("");
  const r = await morse.openBar(a.id);
  if (!r?.code) return;
  if (r.code === "notReady") {
    // Too early: the row must not keep saying Connected next to this banner.
    const row = st?.apps?.find(x => x.id === a.id);
    const next = afterOpenBar(row?.state, r.code);
    if (row && next.state !== row.state) { row.state = next.state; row.canStop = next.canStop; }
    barMiss = a.id;
    renderApps();
    return;
  }
  appError(t(`desk.openBar.${r.code}`, { name: a.name }));
}
async function disconnect(a) {
  appError("");
  const r = await morse.disconnectApp(a.id);
  if (r?.error) appError(r.error);
}

// "Tunes is open. Restart it with Morse?" (the same question as `morse launch`)
function askRestart(a, then = open) {
  const d = $("ask-restart");
  $("ask-restart-h").textContent = t("desk.restart.h", { name: a.name });
  $("always-label").textContent = t("desk.restart.always", { name: a.name });
  $("always-restart").checked = false;
  $("restart-ok").onclick = () => { const always = $("always-restart").checked; d.close(); then(a, always ? "a" : "y"); };
  $("restart-cancel").onclick = () => d.close();
  d.showModal();
  $("restart-ok").focus();
}

$("refresh").onclick = async () => {
  $("refresh").classList.add("spin");
  try { st = await morse.refreshApps(); render(); } finally { setTimeout(() => $("refresh").classList.remove("spin"), 300); }
};
$("add-app").onclick = async () => {
  appError("");
  const r = await morse.addApp();
  if (r?.error) appError(r.error);
  else if (r?.ok) { st = await morse.state(); render(); }
};

// ---------------------------------------------------------------- model
// One choice per model Morse can connect. The key choice is Anthropic and
// OpenAI separately. Local is its own choice. Words for a failure come from
// the check Morse already ran. With nothing to show, the line stays neutral.
const CONNECT = [
  { id: "claude-code", choice: "claude-code", mark: "claude-code", fields: "path", name: () => t("desk.model.claude"), line: () => t("desk.model.lineApp") },
  { id: "codex", choice: "codex", mark: "codex", fields: "path", name: () => t("desk.model.codex"), line: () => t("desk.model.lineApp") },
  { id: "anthropic", choice: "anthropic", vendor: "anthropic", mark: "anthropic", fields: "key", name: () => t("desk.model.anthropic"), line: () => t("desk.model.lineKey") },
  { id: "openai", choice: "openai", vendor: "openai", mark: "openai", fields: "key", name: () => t("desk.model.openai"), line: () => t("desk.model.lineKey") },
  { id: "local", choice: "local", mark: "local", fields: "local", name: () => t("desk.model.local"), line: () => t("desk.model.lineLocal") },
];
const optLabel = opt => opt.nameText || opt.name();
const optLine = opt => opt.lineText || opt.line();
let choiceRows = null;
let picked = null;
let pickedTouched = false;
let pendingId = null;
let connectNote = null;

function lineFor(fields) {
  if (fields === "key") return () => t("desk.model.lineKey");
  if (fields === "local") return () => t("desk.model.lineLocal");
  return () => t("desk.model.lineApp");
}
function fieldsOf(row) {
  if (row.kind === "api" || row.id === "anthropic" || row.id === "openai" || row.id === "api-key") return "key";
  if (row.kind === "local" || row.id === "local" || row.id === "ollama" || row.id === "lmstudio" || row.id === "llamacpp" || row.id === "llama") return "local";
  return "path";
}
function markOf(row, fields) {
  if (MARKS[row.logo]) return row.logo;
  if (MARKS[row.id]) return row.id;
  if (fields === "key") return row.id === "openai" ? "openai" : "anthropic";
  if (fields === "local") return "local";
  return row.id || "local";
}
function optionFromRow(row) {
  const known = CONNECT.find(o => o.id === row.id);
  const fields = known?.fields || fieldsOf(row);
  return {
    id: row.id, choice: row.id, vendor: row.vendor || known?.vendor || "",
    mark: known?.mark || markOf(row, fields), fields,
    name: known ? known.name : () => row.name || row.id,
    line: known ? known.line : lineFor(fields),
  };
}
function ensureLocal(opts) {
  if (opts.some(o => o.id === "local")) return opts;
  return [...opts, CONNECT.find(o => o.id === "local")];
}
function connectOptions() {
  const rows = choiceRows;
  if (!Array.isArray(rows) || !rows.length) return CONNECT;
  const ids = new Set(rows.map(r => r.id));
  let opts;
  // An older list has one key row. The screen still offers Anthropic and OpenAI apart.
  if (ids.has("api-key") && !ids.has("anthropic") && !ids.has("openai")) {
    const rest = rows.filter(r => r.id && r.id !== "api-key" && r.id !== "demo").map(optionFromRow);
    opts = [
      ...rest,
      { ...CONNECT.find(o => o.id === "anthropic"), choice: "api-key" },
      { ...CONNECT.find(o => o.id === "openai"), choice: "api-key" },
    ];
  } else opts = rows.filter(r => r?.id && r.id !== "demo" && r.id !== "api-key").map(optionFromRow);
  return ensureLocal(opts);
}
function keyFor(opt, row) {
  if (!row?.found || !row.keyEnv || opt.fields !== "key") return false;
  if (row.id === opt.id || (opt.vendor && row.vendor === opt.vendor)) return true;
  if (row.id !== "api-key" || !opt.vendor) return false;
  return opt.vendor === "anthropic" ? /ANTHROPIC/i.test(row.keyEnv) : /OPENAI/i.test(row.keyEnv);
}
function providerOptionId(provider, runtime) {
  if (provider === "local") return runtime || "local";
  if (provider === "claude-code" || provider === "codex" || provider === "anthropic" || provider === "openai") return provider;
  return null;
}
function rowFor(opt) {
  const rows = choiceRows || [];
  if (!opt) return null;
  return rows.find(r => r.id === opt.id) || (opt.fields === "key" ? rows.find(r => r.id === "api-key") : null);
}
function pathOf(row) {
  if (row?.path) return row.path;
  if (!row?.found) return "";
  const parts = String(row.detail || "").split(/\s{2,}/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last.startsWith("~") || last.startsWith("/") || /^[A-Za-z]:[\\/]/.test(last)) return last;
  return "";
}
function sameWords(a, b) {
  const n = s => String(s || "").replace(/[.…]+$/g, "").trim();
  return n(a) === n(b);
}
function serverish(detail) {
  const d = String(detail || "");
  return d === t("desk.model.notRunning") || /server not running|isn't running|not running|connection refused/i.test(d);
}
function classify(error) {
  const e = String(error || "");
  if (!e) return "";
  if (e === t("err.signIn") || /rejected the API key|didn't accept the sign-in|\b401\b/i.test(e)) return "key";
  if (e === t("err.unreachable") || serverish(e) || /couldn't reach the model/i.test(e)) return "server";
  if (e === t("err.notInstalled") || e === t("setup.notInstalled") || /isn't installed|not installed/i.test(e)) return "missing";
  return "";
}
function errorState(text) {
  const e = String(text || "");
  const kind = classify(e);
  if (kind === "key") return { state: "key", label: t("desk.model.keyRejected"), text: e || t("desk.model.keyRejected") };
  if (kind === "server") return { state: "server", label: t("desk.model.notRunning"), text: e || t("desk.model.notRunning") };
  if (kind === "missing") return { state: "missing", label: t("desk.model.notInstalled"), text: e || t("desk.model.notInstalled") };
  return { state: "not-connected", label: t("desk.model.notConnected"), text: e || t("desk.model.notConnected") };
}
function fromRow(opt, row) {
  const detail = String(row?.detail || "");
  const status = row?.status || "";
  if (status === "server-down" || serverish(detail)) return { state: "server", label: t("desk.model.notRunning"), text: detail || t("desk.model.notRunning") };
  if (status === "bad-key" || classify(detail) === "key") return { state: "key", label: t("desk.model.keyRejected"), text: detail || t("desk.model.keyRejected") };
  if (opt.fields === "path" && (status === "missing" || row?.found === false)) {
    const text = detail && !/not installed/i.test(detail) ? detail : t("desk.model.notInstalled");
    return { state: "missing", label: t("desk.model.notInstalled"), text };
  }
  if (status === "signed-out") return { state: "not-connected", label: t("desk.model.notConnected"), text: detail || t("desk.model.notConnected") };
  if (keyFor(opt, row)) return { state: "not-connected", label: t("desk.model.notConnected"), text: t("desk.model.keySet", { env: row.keyEnv }) };
  if (detail && status && status !== "ready") return { state: "not-connected", label: t("desk.model.notConnected"), text: detail };
  return { state: "not-connected", label: t("desk.model.notConnected"), text: t("desk.model.notConnected") };
}
function optionState(opt) {
  const m = st?.model;
  const row = rowFor(opt);
  const active = !!(m && !m.none && providerOptionId(m.provider, m.runtime) === opt.id);
  if (pendingId === opt.id || (active && checking)) return { state: "checking", label: t("desk.model.stateChecking"), text: t("desk.model.checking", { name: optLabel(opt) }) };
  if (connectNote?.id === opt.id) return errorState(connectNote.text);
  if (active && m.check?.ok) return { state: "connected", label: t("desk.app.connected"), text: m.detected ? t("desk.model.answeredFound", { secs: secs(m.check.ms) }) : t("desk.model.answered", { secs: secs(m.check.ms) }) };
  if (active && m.check && m.check.ok === false) return errorState(unprefixed(m.check.error, m.name));
  if (row) return fromRow(opt, row);
  return { state: "not-connected", label: t("desk.model.notConnected"), text: t("desk.model.notConnected") };
}
function currentState() {
  const m = st?.model;
  if (pendingId) {
    const opt = connectOptions().find(o => o.id === pendingId);
    return { state: "checking", label: t("desk.model.stateChecking"), text: t("desk.model.checking", { name: opt ? optLabel(opt) : modelName(m || {}) }) };
  }
  if (checking) return { state: "checking", label: t("desk.model.stateChecking"), text: t("desk.model.checking", { name: modelName(m || {}) }) };
  if (!m || m.none) return { state: "not-connected", label: t("desk.model.notConnected"), text: t("desk.model.notConnected") };
  const opt = connectOptions().find(o => o.id === providerOptionId(m.provider, m.runtime));
  if (opt) return optionState(opt);
  if (m.check?.ok) return { state: "connected", label: t("desk.app.connected"), text: t("desk.model.answered", { secs: secs(m.check.ms) }) };
  if (m.check && m.check.ok === false) return errorState(unprefixed(m.check.error, m.name));
  return { state: "not-connected", label: t("desk.model.notConnected"), text: t("desk.model.notConnected") };
}
function stateMark(s) {
  if (s.state === "checking") return h("i", { class: "dot wait" });
  if (s.state === "connected") return h("i", { class: "dot on" });
  if (s.state === "key" || s.state === "server" || s.state === "missing") return h("i", { class: "dot bad" });
  return h("i", { class: "dot warn" });
}
function statusLine(node, s) {
  const kids = [h("span", { class: "badge", "data-state": s.state }, stateMark(s), s.label)];
  if (s.text && !sameWords(s.text, s.label)) kids.push(h("span", { text: s.text }));
  node.replaceChildren(...kids);
}
function renderModel() {
  const m = st.model;
  const cur = currentState();
  $("model-name").textContent = m.none ? t("desk.model.none") : modelName(m);
  const mark = $("model-mark");
  if (mark.dataset.p !== m.provider || mark.dataset.logo !== (m.logo || "")) {
    const next = providerMark(m.provider, true);
    next.id = "model-mark"; next.dataset.p = m.provider; next.dataset.logo = m.logo || "";
    mark.replaceWith(next);
  }
  $("model-pill").hidden = !m.model;
  $("model-pill").textContent = m.model;
  $("check-model").hidden = m.none;
  $("check-model").disabled = checking || !!pendingId;
  $("change-model").textContent = m.none ? t("desk.model.chooseShort") : t("desk.model.change");
  statusLine($("model-live"), cur);
  const nav = $("nav-model");
  const warn = cur.state !== "connected" && cur.state !== "checking";
  nav.textContent = warn ? "!" : "";
  nav.className = warn ? "warn" : "";
  renderConnect();
}

// "Claude Code: You've hit your limit" under Claude Code's own name: the words, without the name again.
const unprefixed = (error, name) => { const e = String(error || ""); return name && e.startsWith(name + ": ") ? e.slice(name.length + 2) : e; };
let checking = false;
async function checkModel() {
  if (checking || pendingId || st?.model?.none) return;
  checking = true;
  renderModel();
  if (st && !st.settings.welcomed) renderFirst();
  try { await morse.checkModel(); } finally { checking = false; st = await morse.state(); render(); }
}
$("check-model").onclick = checkModel;

function refreshChoices() {
  if (!morse?.modelChoices) return;
  const n = ++refreshChoices.n;
  morse.modelChoices().then(rows => {
    if (n !== refreshChoices.n || !Array.isArray(rows)) return;
    choiceRows = rows;
    if (st && !st.loading) renderConnect();
  }).catch(() => {});
}
refreshChoices.n = 0;

function renderConnect() {
  const list = $("connect-list");
  if (!list || !st) return;
  if (!pickedTouched && !picked && st.model && !st.model.none) {
    const id = providerOptionId(st.model.provider, st.model.runtime);
    if (id) picked = id;
  }
  const opts = connectOptions();
  const focused = document.activeElement?.dataset?.connect;
  list.replaceChildren(...opts.map(opt => {
    const s = optionState(opt);
    return h("button", {
      type: "button", class: "connect-choice", "data-connect": opt.id, "data-state": s.state,
      "aria-pressed": opt.id === picked ? "true" : "false", "aria-busy": s.state === "checking" ? "true" : "false",
      onclick: () => { picked = opt.id; pickedTouched = true; if (connectNote?.id !== opt.id) connectNote = null; renderConnect(); },
    },
      (MARKS[opt.mark] || localMark)(),
      h("span", { class: "connect-copy" }, h("b", { text: optLabel(opt) }), h("small", { text: optLine(opt) })),
      h("span", { class: "badge", "data-state": s.state }, stateMark(s), s.label));
  }));
  if (focused) list.querySelector(`[data-connect="${CSS.escape(focused)}"]`)?.focus();
  renderForm(opts.find(o => o.id === picked) || null);
}
function fieldSnapshot(form) {
  const prev = {};
  form.querySelectorAll("[data-field]").forEach(el => { prev[el.dataset.field] = { value: el.value, touched: el.dataset.touched || "" }; });
  return prev;
}
function restoreFields(form, prev) {
  form.querySelectorAll("[data-field]").forEach(el => {
    const p = prev[el.dataset.field];
    if (el.readOnly || !p || (!p.touched && !p.value)) return;
    el.value = p.value;
    if (p.touched) el.dataset.touched = p.touched;
  });
}
function hintSig(opt) {
  const row = rowFor(opt);
  return [opt.id, opt.choice, opt.fields, row?.found, row?.status, row?.install || "", row?.keyEnv || "", row?.vendor || "", row?.baseUrl || "", pathOf(row), (row?.models || []).map(m => m.id).join(",")].join(":");
}
function renderForm(opt) {
  const form = $("connect-form");
  if (!form) return;
  if (!opt) { form.hidden = true; form.dataset.for = ""; return; }
  const sig = hintSig(opt);
  const same = form.dataset.for === opt.id && form.dataset.hint === sig && form.querySelector(".connect-fields");
  if (!same) {
    const prev = fieldSnapshot(form);
    const row = rowFor(opt);
    const fields = h("div", { class: "connect-fields" });
    if (opt.fields === "path") {
      const input = h("input", { type: "text", "data-field": "path", readonly: true, spellcheck: "false", autocomplete: "off", "aria-label": t("desk.model.path") });
      input.value = pathOf(row);
      fields.append(h("label", { class: "field" }, h("span", { text: t("desk.model.path") }), input));
      if (row && row.found === false && row.install) fields.append(...installHint(opt, row));
    } else if (opt.fields === "key") {
      const known = keyFor(opt, row);
      fields.append(
        h("label", { class: "field" },
          h("span", { text: t("desk.key.label") }),
          h("input", { type: "password", "data-field": "key", id: "api-key", autocomplete: "off", spellcheck: "false", "aria-label": t("desk.key.label"), placeholder: t("desk.key.placeholder") })),
        h("small", { class: "hint", text: known ? t("desk.model.keySet", { env: row.keyEnv }) : t("desk.key.stays") }),
      );
    } else {
      const fixed = opt.id !== "local" && row?.baseUrl ? row.baseUrl : "";
      const address = h("input", { type: "text", "data-field": "address", spellcheck: "false", autocomplete: "off", "aria-label": t("desk.model.address"), placeholder: t("desk.model.addressPh"), ...(fixed ? { readonly: true } : {}) });
      address.value = fixed;
      const model = h("input", { type: "text", "data-field": "model", spellcheck: "false", autocomplete: "off", "aria-label": t("desk.model.modelName"), placeholder: t("desk.model.modelPh") });
      fields.append(
        h("label", { class: "field" }, h("span", { text: t("desk.model.address") }), address),
        h("label", { class: "field" }, h("span", { text: t("desk.model.modelName") }), model),
      );
      if (row?.models?.length) {
        model.setAttribute("list", "connect-models");
        fields.append(h("datalist", { id: "connect-models" }, ...row.models.map(m => h("option", { value: m.id }))));
      }
      if (row && row.found === false && row.install) fields.append(...installHint(opt, row));
    }
    const fade = form.dataset.for !== opt.id;
    form.dataset.for = opt.id;
    form.dataset.hint = sig;
    form.replaceChildren(
      fields,
      h("p", { class: "live", id: "connect-status", role: "status" }),
      h("div", { class: "row-end" }, h("button", { type: "button", class: "btn primary", id: "connect-go", onclick: connectPicked }, t("desk.app.connect"))),
    );
    restoreFields(form, prev);
    form.hidden = false;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fade || reduce) form.style.opacity = "1";
    else { form.style.opacity = "0"; requestAnimationFrame(() => { if (form.dataset.for === opt.id) form.style.opacity = "1"; }); }
  } else if (form.hidden) form.hidden = false;
  const go = $("connect-go");
  if (go) go.disabled = !!pendingId || checking;
  const status = $("connect-status");
  if (status) statusLine(status, optionState(opt));
}
$("connect-form").addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.isComposing || !e.target.matches?.("input")) return;
  e.preventDefault();
  const b = $("connect-go");
  if (b && !b.disabled) b.click();
});
$("change-model").onclick = () => {
  const list = $("connect-list");
  (list.querySelector('[aria-pressed="true"]') || list.querySelector("button"))?.focus();
};
function installHint(opt, row) {
  return [
    h("p", { class: "hint", text: t("desk.model.installFrom", { name: optLabel(opt) }) }),
    h("code", { class: "install", text: row.install }),
    h("div", { class: "row-end" }, h("button", { type: "button", class: "btn", onclick: () => refreshChoices() }, t("desk.lookAgain"))),
  ];
}
function fieldValue(name) {
  return $("connect-form")?.querySelector(`[data-field="${name}"]`)?.value || "";
}
async function connectPicked() {
  const opt = connectOptions().find(o => o.id === picked);
  if (!opt || pendingId) return;
  pendingId = opt.id;
  connectNote = null;
  renderModel();
  const key = opt.fields === "key" ? fieldValue("key") : opt.fields === "local" ? fieldValue("model").trim() : "";
  const extra = opt.id === "local" ? fieldValue("address").trim() : "";
  let r;
  try {
    const args = [opt.choice, key];
    if (extra) args.push(extra);
    r = await morse.chooseModel(...args);
    // This copy accepts "api-key". A newer copy also accepts "anthropic" and "openai".
    if (r?.error === "Not allowed." && opt.fields === "key" && opt.choice !== "api-key") r = await morse.chooseModel("api-key", key);
  } catch (e) { r = { error: e?.message || "" }; }
  pendingId = null;
  if (!r || r.error === "Not allowed." || (r && !r.error && !r.check && !r.ok)) connectNote = { id: opt.id, text: "" };
  else if (r.error) connectNote = { id: opt.id, text: r.error };
  else if (r.check && r.check.ok === false) connectNote = { id: opt.id, text: r.check.error || "" };
  else connectNote = null;
  if (!r?.error) {
    st = await morse.state();
    if (st?.model?.check) connectNote = null;
  }
  render();
}

// ---------------------------------------------------------------- mods
function renderMods() {
  const groups = st.mods;
  const total = groups.reduce((n, g) => n + g.mods.length, 0);
  $("no-mods").hidden = total > 0;
  $("paused").hidden = !st.pause.all;
  $("mods-on").checked = !st.pause.all;
  const nav = $("nav-mods");
  nav.textContent = st.pause.all ? t("desk.nav.off") : total || "";
  nav.className = st.pause.all ? "warn" : "";
  const sig = JSON.stringify([groups, groups.map(g => !!st.apps.find(a => a.id === g.app)?.icon)]);
  if ($("mod-groups").dataset.sig === sig) return;
  $("mod-groups").dataset.sig = sig;
  const focused = document.activeElement?.dataset?.mod;
  $("mod-groups").replaceChildren(...groups.map(groupBlock));
  if (focused) document.querySelector(`[data-mod="${CSS.escape(focused)}"]`)?.focus();
}
// The name and the count are separate lines. A heading that puts them in one
// run of text reads "Obsidian1 mod" — the number glued to the name.
function groupBlock(g) {
  const on = g.mods.filter(m => m.on).length;
  const count = t("desk.mods.count", { n: g.mods.length, on });
  const icon = st.apps.find(a => a.id === g.app)?.icon;
  const mark = icon
    ? h("img", { class: "gicon", src: icon, alt: "", draggable: "false" })
    : h("span", { class: "gicon none", "aria-hidden": "true" }, appsGlyph());
  return h("div", { class: "group" },
    h("h2", { "aria-label": `${g.name}, ${count}` },
      mark,
      h("span", { class: "gmeta" }, h("span", { class: "gname", text: g.name }), h("small", { text: count }))),
    h("ul", { class: "list mods" }, ...g.mods.map(modRow)));
}
function modRow(m) {
  const request = m.paused ? t("desk.mods.stopped") : `“${m.request}”`;
  return h("li", { class: m.on ? "" : "off" },
    h("div", { class: "grow" }, h("b", { text: m.title }), h("small", {}, h("span", { text: request }))),
    h("div", { class: "mod-actions" },
      h("button", { type: "button", class: "ibtn", title: t("btn.delete"), "aria-label": t("desk.mods.delete", { title: m.title }), "data-del": m.id, onclick: () => deleteMod(m) }, trashGlyph()),
      h("label", { class: "modsw" },
        h("input", { type: "checkbox", role: "switch", "aria-label": t("desk.mods.on", { title: m.title }), "data-mod": m.id, checked: m.on, onchange: e => toggleMod(m.id, e.target) }))));
}
// A switch that lies is worse than a slow one: if the change is refused (the
// mod is gone, or couldn't be written), put the switch back where it was.
async function toggleMod(id, el) {
  const want = el.checked;
  const r = await morse.setModOn(id, want);
  if (r?.error) el.checked = !want;
}
// Delete takes one click; Undo, above the list, brings it back for a while.
let undoTimer = 0;
function hideUndo() { clearTimeout(undoTimer); $("mod-undo").hidden = true; }
async function deleteMod(m) {
  const r = await morse.deleteMod(m.id);
  if (r?.error) return;
  $("mod-undo-text").textContent = t("toast.deleted", { title: m.title });
  $("mod-undo").hidden = false;
  $("mod-undo-btn").focus();
  $("mod-undo-btn").onclick = async () => { hideUndo(); await morse.undeleteMod(m.id); };
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 15000);
}
$("resume").onclick = () => morse.setAllModsOff(false);
$("mods-on").onchange = async e => { const off = !e.target.checked; const r = await morse.setAllModsOff(off); if (r?.error) e.target.checked = off; };

// ---------------------------------------------------------------- checks
async function runChecks() {
  const b = $("run-checks");
  b.disabled = true;
  b.textContent = t("desk.checks.running");
  $("check-list").replaceChildren(h("li", { class: "empty" }, radar(14), " ", t("desk.checks.looking")));
  try {
    const rows = await morse.runChecks();
    if (rows?.error) throw new Error(rows.error);
    $("check-list").replaceChildren(...rows.map(r => h("li", { class: r.ok === false ? "bad" : "" },
      h("span", { class: `mark ${r.ok === true ? "ok" : r.ok === false ? "bad" : "info"}`, "aria-label": r.ok === true ? t("desk.checks.fine") : r.ok === false ? t("desk.checks.fix") : t("desk.checks.info") }, r.ok === true ? "✓" : r.ok === false ? "!" : "i"),
      h("span", { class: "label", text: r.label }),
      h("span", { class: "text", text: r.text }))));
    const bad = rows.filter(r => r.ok === false).length;
    $("checks").classList.toggle("warn", !!bad);
  } catch (e) {
    $("check-list").replaceChildren(h("li", { class: "empty" }, e.message));
  } finally { b.disabled = false; b.textContent = t("desk.checks.run"); }
}
$("run-checks").onclick = runChecks;

// ---------------------------------------------------------------- settings
$("auto-open").onchange = async e => { const on = e.target.checked; const r = await morse.setAutoOpen(on); if (r?.error) e.target.checked = !on; };

// Enter in an API-key field is "use this key", the same as the button: typing a
// key and pressing Enter should save it, not sit there.
const submitOnEnter = (field, button) => $(field).addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  if (!$(button).disabled) $(button).click();
});
submitOnEnter("first-key-input", "first-key-use");

// ---------------------------------------------------------------- first run
// In the shape of Zephium's: the name forms out of dots with its sound, then
// three steps: the AI Morse found by itself (checked once), how it works, and
// an app to open. Opening an app, Done, or Skip leads to the main window for
// good. Enter goes on; the row at the foot steers.
const STEPS = ["model", "how", "apps"];
let firstChecked = false, obStep = "welcome", obStarted = false;
function obGo(step) {
  if (!step) return;
  obStep = step;
  const f = $("first");
  f.dataset.step = step;
  for (const sec of f.querySelectorAll(".ob-step")) sec.hidden = sec.dataset.ob !== step;
  const at = STEPS.indexOf(step);
  [...$("ob-dots").children].forEach((li, i) => { li.className = i < at ? "done" : i === at ? "now" : ""; });
  $("ob-dots").setAttribute("aria-label", t("desk.ob.progress", { at: at + 1, of: STEPS.length }));
  $("ob-back").hidden = at <= 0;
  $("ob-next-label").textContent = t(step === "apps" ? "desk.ob.done" : "desk.ob.continue");
  const head = f.querySelector(`.ob-step[data-ob="${step}"] h1`);
  head?.setAttribute("tabindex", "-1");
  head?.focus({ preventScroll: true });
}
const obNext = () => (obStep === "welcome" ? obBegin() : obStep === "apps" ? morse.finishWelcome() : obGo(STEPS[STEPS.indexOf(obStep) + 1]));
function obBegin() {
  const phase = $("first").dataset.phase;
  if (obStep === "welcome" && (phase === "formed" || phase === "still")) obGo("model");
}
$("ob-begin").onclick = obBegin;
$("ob-next").onclick = obNext;
$("ob-back").onclick = () => obGo(STEPS[STEPS.indexOf(obStep) - 1]);
document.addEventListener("keydown", e => {
  if ($("first").hidden || e.key !== "Enter" || e.repeat || e.isComposing || document.querySelector("dialog[open]")) return;
  if (e.target.closest?.("button, a, input")) return;
  e.preventDefault();
  obNext();
});
// The welcome: the name gathers out of dots while the sound plays, once.
async function obWelcome() {
  if (obStarted) return;
  obStarted = true;
  const f = $("first"), canvas = $("ob-air"), name = $("ob-name");
  const phase = p => { f.dataset.phase = p; };
  phase("forming");
  const sound = new Audio("sounds/intro.m4a");
  sound.volume = 0.6;
  sound.play().catch(() => {}); // no sound device, or it's off: the name forms anyway
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { phase("still"); return; }
  await document.fonts.load(getComputedStyle(name).font).catch(() => {});
  const nr = name.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  const cs = getComputedStyle(name);
  const box = { x: nr.left - cr.left, y: nr.top - cr.top, w: nr.width, h: nr.height };
  formName(canvas, {
    box,
    draw: ctx => { ctx.font = cs.font; ctx.letterSpacing = cs.letterSpacing; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(name.textContent, box.w / 2, box.h / 2 + 2); },
    density: Math.min(2, devicePixelRatio || 1),
    color: cs.color || "#fff",
    onformed: () => phase("formed"),
    ondone: () => phase("still"),
  });
}
function renderFirst() {
  const first = !st.settings.welcomed;
  $("first").hidden = !first;
  document.querySelector(".app").hidden = first;
  if (!first) return;
  if (!obStarted) { obGo("welcome"); requestAnimationFrame(() => obWelcome()); }
  const MAC_KEYS = { Alt: "⌥", Option: "⌥", Meta: "⌘", Cmd: "⌘", Command: "⌘", Shift: "⇧", Control: "⌃", Ctrl: "⌃" };
  $("ob-key").replaceChildren(caps(platform === "darwin" ? openKey().split("+").map(k => MAC_KEYS[k] || k).join("+") : openKey()));
  const m = st.model, name = modelName(m);
  $("first-key").hidden = !m.none;
  const live = $("first-model");
  if (m.none) live.replaceChildren(h("i", { class: "dot warn" }), h("span", { text: t("desk.first.noModel") }));
  else if (checking) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.checking", { name }) }), radar(14));
  else if (m.check?.ok) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.answered", { name, secs: secs(m.check.ms) }) }), h("span", { class: "badge ready" }, h("i", { class: "dot on" }), t("desk.ready")));
  else if (m.check) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.noAnswer", { name, error: unprefixed(m.check.error, m.name) }) }), h("i", { class: "dot bad" }));
  else live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.willUse", { name }) }));
  if (!m.none && !m.check && !firstChecked) { firstChecked = true; checkModel(); }
  const host = $("first-apps");
  if (st.appsPending) {
    if (host.dataset.sig !== "pending") {
      host.dataset.sig = "pending";
      host.setAttribute("aria-busy", "true");
      host.replaceChildren(...skeletonItems());
    }
    return;
  }
  host.removeAttribute("aria-busy");
  const apps = (st.apps || []).filter(a => a.canAttach !== false).slice(0, 5);
  const sig = JSON.stringify(apps.map(a => [a.id, a.state, a.icon ? 1 : 0]));
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.replaceChildren(...(apps.length ? apps.map(a => {
    const busy = ["opening", "connecting"].includes(a.state);
    return h("li", { "data-first-app": a.id },
      appIcon(a),
      h("div", { class: "grow" }, h("b", { text: a.name }), h("small", {}, ...(busy ? [radar(12), h("span", { text: t("desk.app.opening", { name: a.name }) })] : [h("span", { text: a.state === "closed" ? t("desk.app.notOpen") : t("desk.app.openNow") })]))),
      h("button", { type: "button", class: "btn", disabled: busy, onclick: () => openFirst(a) }, t("desk.app.open")));
  }) : [h("li", { class: "empty" }, t("desk.first.noApps"))]));
}
async function openFirst(a, answer) {
  const r = await morse.openApp(a.id, answer);
  if (r?.needsRestart) return askRestart(a, openFirst); // the same question as everywhere else
  if (r?.error) { obGo("model"); $("first-model").replaceChildren(h("i", { class: "dot bad" }), h("span", { text: r.error })); return; }
  await morse.finishWelcome();
}
$("first-skip").onclick = () => morse.finishWelcome();
$("first-key-use").onclick = async () => {
  const r = await morse.chooseModel("api-key", $("first-key-input").value);
  $("first-key-input").value = "";
  if (r?.error) $("first-model").replaceChildren(h("i", { class: "dot bad" }), h("span", { text: r.error }));
};

// ---------------------------------------------------------------- shortcut
// The keys that open Morse. The same recorder as the bar (core/hotkeys.js):
// one shortcut, saved in settings.json, shown with this computer's key names.
let recording = false;
let saving = false;
let partial = "";
let shortcutNote = null; // { level, message } after a save or a refusal
let seenCombo = null;

function keyCaps(combo) {
  const parts = comboParts(combo, HK_PLATFORM);
  if (!parts.length) return h("span", { class: "dim", text: t("hk.offShort") });
  return h("span", { class: "caps" }, ...parts.map(k => h("kbd", { text: k })));
}
function partialCaps(part) {
  const text = formatPartial(part, HK_PLATFORM);
  if (!text) return h("span", { class: "dim", text: "…" });
  const bits = HK_PLATFORM === "mac" ? [...text] : text.split("+").filter(Boolean);
  return h("span", { class: "caps" }, ...bits.map(k => h("kbd", { text: k })));
}
function currentCombo() {
  if (st?.keys && Object.prototype.hasOwnProperty.call(st.keys, "combo")) return st.keys.combo || "";
  return defaultHotkeys(HK_PLATFORM).open;
}
function renderShortcut() {
  const btn = $("shortcut-key");
  if (!btn || !st) return;
  const incoming = currentCombo();
  if (shortcutNote && seenCombo !== null && seenCombo !== incoming) shortcutNote = null;
  if (!recording) seenCombo = incoming;
  const def = defaultHotkeys(HK_PLATFORM).open;
  const custom = !!st.keys?.custom;
  const reset = $("shortcut-reset");
  reset.hidden = recording || !custom;
  reset.title = t("settings.backTo", { key: formatCombo(def, HK_PLATFORM) });
  btn.classList.toggle("recording", recording);
  btn.classList.toggle("bad", shortcutNote?.level === "error");
  btn.setAttribute("aria-pressed", recording ? "true" : "false");
  const label = recording
    ? (formatPartial(partial, HK_PLATFORM) || t("hk.offShort"))
    : (incoming ? formatCombo(incoming, HK_PLATFORM) : t("hk.offShort"));
  btn.setAttribute("aria-label", t("desk.settings.hk", { key: label }));
  btn.replaceChildren(recording ? partialCaps(partial) : keyCaps(incoming));
  $("shortcut-help").textContent = recording
    ? t("desk.settings.recording", { esc: "Esc", back: HK_PLATFORM === "mac" ? "⌫" : "Backspace" })
    : t("desk.settings.open.d");
  const msg = $("shortcut-msg");
  if (shortcutNote?.message) {
    msg.hidden = false;
    msg.textContent = shortcutNote.message;
    msg.className = `shortcut-msg${shortcutNote.level === "error" ? " bad" : shortcutNote.level === "warn" ? " warn" : ""}`;
  } else {
    msg.hidden = true;
    msg.textContent = "";
    msg.className = "shortcut-msg";
  }
}
function shakeShortcut() {
  const btn = $("shortcut-key");
  btn.classList.remove("shake");
  void btn.offsetWidth;
  btn.classList.add("shake");
  btn.addEventListener("animationend", () => btn.classList.remove("shake"), { once: true });
}
function stopRecording() {
  recording = false;
  partial = "";
  renderShortcut();
}
async function commitShortcut(next) {
  if (saving) return;
  saving = true;
  try {
    const stored = st.keys?.stored && typeof st.keys.stored === "object" ? st.keys.stored : {};
    const decision = decideOpenShortcut(stored, next, HK_PLATFORM);
    if (!decision.ok) {
      partial = "";
      shortcutNote = { level: "error", message: decision.message };
      shakeShortcut();
      renderShortcut();
      return;
    }
    const r = await morse.setOpenShortcut(decision.value);
    if (r?.error) {
      partial = "";
      shortcutNote = { level: "error", message: r.error };
      shakeShortcut();
      renderShortcut();
      return;
    }
    recording = false;
    partial = "";
    const warn = decision.message || r.warn || "";
    shortcutNote = { level: warn ? "warn" : "ok", message: warn || t("settings.saved") };
    const combo = decision.value || defaultHotkeys(HK_PLATFORM).open;
    seenCombo = combo;
    if (st.keys) {
      st.keys.combo = combo;
      st.keys.custom = !!decision.value;
      st.keys.stored = { ...stored, open: decision.value };
      st.keys.open = formatCombo(combo, HK_PLATFORM);
    }
    render();
  } finally {
    saving = false;
  }
}
$("shortcut-key").onclick = () => {
  if (recording) { stopRecording(); return; }
  recording = true;
  partial = "";
  shortcutNote = null;
  renderShortcut();
  $("shortcut-key").focus();
};
$("shortcut-reset").onclick = () => { recording = false; partial = ""; commitShortcut(""); };
document.addEventListener("keydown", e => {
  if (!recording || !e.isTrusted) return;
  if (e.isComposing || e.keyCode === 229) return;
  if (saving) { e.preventDefault(); return; }
  const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
  if (bare && e.code === "Tab") { stopRecording(); return; }
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  const hit = comboFromEvent(e);
  if (!hit.combo) { partial = hit.partial; renderShortcut(); return; }
  if (bare && e.code === "Escape") { shortcutNote = null; stopRecording(); return; }
  if (bare && (e.code === "Backspace" || e.code === "Delete")) { commitShortcut(""); return; }
  commitShortcut(hit.combo);
}, true);
document.addEventListener("keyup", e => {
  if (!recording || !e.isTrusted) return;
  e.preventDefault();
  partial = comboFromEvent(e).partial;
  renderShortcut();
}, true);
document.addEventListener("pointerdown", e => {
  if (!recording) return;
  if (e.target.closest?.("#shortcut-key, #shortcut-reset")) return;
  stopRecording();
});
window.addEventListener("blur", () => { if (recording) stopRecording(); });

// ---------------------------------------------------------------- update
// Morse updating itself: a dialog while it downloads and installs; when apps
// are connected, Restart now or Later (it installs when Morse quits).
// 0%, 40% and 100% stay one run of digits, so the percent doesn't break apart.
function shownPercent(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
function renderUpdate() {
  const u = st.update || { phase: "idle" }, d = $("update");
  const show = ["downloading", "installing", "ready", "failed"].includes(u.phase);
  if (!show) { if (d.open) d.close(); return; }
  $("update-h").textContent = t(u.phase === "downloading" ? "desk.update.downloadingH" : u.phase === "ready" ? "desk.update.readyH" : u.phase === "failed" ? "desk.update.failedH" : "desk.update.installingH");
  const detail = $("update-d");
  const track = $("update-track");
  if (u.phase === "downloading") {
    const pct = shownPercent(u.percent);
    const msg = t("desk.update.downloading", { percent: "\u0000" });
    const at = msg.indexOf("\u0000");
    if (at < 0) detail.textContent = t("desk.update.downloading", { percent: pct });
    else detail.replaceChildren(msg.slice(0, at), h("span", { class: "update-pct", text: `${pct}${msg.slice(at + 1)}` }));
    $("update-fill").style.width = `${pct}%`;
    track.setAttribute("aria-valuenow", String(pct));
  } else {
    detail.textContent = u.phase === "ready" ? t("desk.update.ready") : u.phase === "failed" ? t("desk.update.failed") : t("desk.update.installing");
  }
  track.hidden = u.phase !== "downloading";
  $("update-acts").hidden = u.phase !== "ready" && u.phase !== "failed";
  $("update-now").hidden = u.phase !== "ready";
  $("update-later").textContent = t(u.phase === "failed" ? "desk.update.close" : "desk.update.later");
  if (!d.open) d.showModal();
}
$("update-now").onclick = () => morse.installUpdate();
$("update-later").onclick = async () => {
  const phase = st.update?.phase;
  if (phase === "ready") await morse.updateLater();
  // Later keeps the download and installs when Morse quits. Close dismisses a failure.
  st.update = phase === "ready" ? { ...(st.update || {}), phase: "later" } : { phase: "idle" };
  $("update").close();
  render();
};
$("update-restart").onclick = () => morse.installUpdate();

// Settings → Check for updates. The same check Morse runs on its own
// (updater.js): the preview release's build against this one.
function renderUpdateCheck() {
  const u = st?.update || { phase: "idle" };
  const b = $("check-updates"), msg = $("update-msg"), extra = $("update-extra");
  if (!b || !msg || !extra) return;
  const busy = ["checking", "downloading", "installing"].includes(u.phase);
  b.disabled = busy;
  b.setAttribute("aria-busy", busy ? "true" : "false");
  let text = "", level = "", showGet = false, showRestart = false;
  if (u.phase === "checking") text = t("desk.update.checking");
  else if (u.phase === "current") text = t("desk.update.current");
  else if (u.phase === "off") { text = t("desk.update.off"); level = "warn"; }
  else if (u.phase === "error" || u.phase === "failed") { text = t("desk.update.error"); level = "bad"; }
  else if (["available", "downloading", "installing", "ready", "later"].includes(u.phase)) {
    text = u.version ? t("desk.update.available", { version: u.version }) : t("desk.update.availablePlain");
    showGet = u.phase === "available";
    showRestart = u.phase === "later" || u.phase === "ready";
  }
  msg.hidden = !text;
  msg.textContent = text;
  msg.className = `shortcut-msg${level ? ` ${level}` : ""}`;
  $("update-get").hidden = !showGet;
  $("update-restart").hidden = !showRestart;
  extra.hidden = !showGet && !showRestart;
}
$("check-updates").onclick = async () => {
  if ($("check-updates").disabled) return;
  st = st || {};
  st.update = { phase: "checking" };
  renderUpdateCheck();
  let r;
  try { r = await morse.checkForUpdate(); }
  catch { r = null; }
  if (r?.phase) st.update = r;
  else st.update = { phase: "error" };
  render();
};
$("update").addEventListener("cancel", e => { if (["downloading", "installing"].includes(st.update?.phase)) e.preventDefault(); });

// ---------------------------------------------------------------- state
function render() {
  if (!st || st.error) return;
  // Asked before the daemon is in: the HTML shell (and its skeleton) is already showing.
  // data-ready is not held for the app scan; renderApps leaves the skeleton up.
  if (st.loading) { document.documentElement.dataset.ready = "1"; return; }
  renderFirst();
  renderApps(); renderModel(); renderMods(); renderShortcut(); renderUpdate(); renderUpdateCheck();
  $("auto-open").checked = st.settings.autoOpen;
  $("version").textContent = `Morse ${st.version}`;
  document.documentElement.dataset.ready = "1";
}
morse.onChange(next => { if (next && !next.error) { st = next; render(); } });
st = await morse.state();
render();
refreshChoices(); // after data-ready: the chooser is already painted
let first = "apps";
try { first = sessionStorage.getItem("tab") || "apps"; } catch {}
show(first);
