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
// The mark of what writes your changes (ui/icons/NOTICE): Claude Code, Codex,
// an API key (both providers' marks), or Morse's own radar for the rest.
const MARKS = { "claude-code": ["claude"], codex: ["openai"], anthropic: ["anthropic"], openai: ["openai"], "api-key": ["anthropic", "openai"] };
function providerMark(id, big = false) {
  const names = MARKS[id];
  const tile = h("span", { class: `mark-tile${big ? " big" : ""}${names?.length > 1 ? " pair" : ""}`, "aria-hidden": "true" });
  if (!names) { const r = radar(big ? 22 : 18); r.classList.remove("live"); tile.append(r); }
  else for (const n of names) tile.append(h("img", { src: `icons/${n}.png`, alt: "", class: n === "claude" ? "" : "mono", draggable: "false" }));
  return tile;
}
const secs = ms => (ms / 1000).toFixed(1);
// The model's name: "Claude Code" and "Codex" as they are, the rest in the person's words.
const modelName = m => ({ anthropic: t("desk.model.anthropic"), openai: t("desk.model.openai"), demo: t("desk.model.demo") }[m.provider] || m.name);

let st = null;

// ---------------------------------------------------------------- sections
function show(tab) {
  for (const b of document.querySelectorAll("nav button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  if (tab === "checks") tab = "model"; // simplify: Checks is a card in Model now
  if (tab !== "mods") hideUndo(); // a stale "Undo delete" shouldn't wait on another page
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== tab;
  try { sessionStorage.setItem("tab", tab); } catch {}
  $(tab).closest("main").scrollTop = 0;
  // Checks ask the model a question, so they run only when asked.
  if (tab === "model" && !$("check-list").children.length) $("check-list").replaceChildren(h("li", { class: "empty" }, t("desk.checks.first")));
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

// Rows are only rebuilt when what they show changed, so focus stays put
// while the list refreshes.
function renderApps() {
  showAppsError(); // a Connected row clears a stale "isn't running yet" banner
  const list = $("app-list");
  const rows = st.apps;
  const seen = new Set();
  if (!rows.length) {
    list.replaceChildren(h("li", { class: "empty" }, t("desk.apps.none")));
  } else {
    if (list.querySelector("li.empty")) list.replaceChildren();
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
function renderModel() {
  const m = st.model;
  $("model-name").textContent = m.none ? t("desk.model.none") : modelName(m);
  const mark = $("model-mark");
  if (mark.dataset.p !== m.provider) { const next = providerMark(m.provider, true); next.id = "model-mark"; next.dataset.p = m.provider; mark.replaceWith(next); }
  $("model-pill").hidden = !m.model;
  $("model-pill").textContent = m.model;
  $("check-model").hidden = m.none;
  $("change-model").textContent = m.none ? t("desk.model.chooseShort") : t("desk.model.change");
  if (!checking) {
    const live = $("model-live");
    if (m.none) live.replaceChildren(h("i", { class: "dot warn" }), h("span", { text: t("desk.model.pick") }));
    else if (m.check?.ok) live.replaceChildren(h("i", { class: "dot on" }), h("span", { text: m.detected ? t("desk.model.answeredFound", { secs: secs(m.check.ms) }) : t("desk.model.answered", { secs: secs(m.check.ms) }) }));
    else if (m.check) live.replaceChildren(h("i", { class: "dot bad" }), h("span", { text: t("desk.model.noAnswer", { error: unprefixed(m.check.error, m.name) }) }));
    else live.replaceChildren(h("i", { class: "dot" }), h("span", { text: m.detected ? t("desk.model.found") : t("desk.model.unchecked") }));
  }
  const nav = $("nav-model");
  nav.textContent = m.none ? "!" : m.check && !m.check.ok ? "!" : "";
  nav.className = m.none || (m.check && !m.check.ok) ? "warn" : "";
}

// "Claude Code: You've hit your limit" under Claude Code's own name: the words, without the name again.
const unprefixed = (error, name) => { const e = String(error || ""); return name && e.startsWith(name + ": ") ? e.slice(name.length + 2) : e; };
let checking = false;
async function checkModel() {
  checking = true;
  $("check-model").disabled = true;
  $("model-live").replaceChildren(radar(12), h("span", { text: t("desk.model.checking", { name: modelName(st.model) }) }));
  if (st && !st.settings.welcomed) renderFirst();
  try { await morse.checkModel(); } finally { checking = false; $("check-model").disabled = false; st = await morse.state(); render(); }
}
$("check-model").onclick = checkModel;

let choices = [];
async function loadChoices() {
  $("choices").hidden = false;
  $("choice-list").replaceChildren(h("p", { class: "live" }, radar(12), h("span", { text: t("desk.model.looking") })));
  choices = await morse.modelChoices();
  const current = { "claude-code": "claude-code", codex: "codex", anthropic: "api-key", openai: "api-key" }[st.model.provider];
  const pick = current || choices.find(c => c.recommended)?.id || "api-key";
  $("choice-list").replaceChildren(...choices.map(c => choiceRow(c, c.id === pick)));
  syncChoice();
  $("choices").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
// One choice: its mark, what it uses, and one word for whether it's ready.
// Not installed: "How to install" shows the one command, on request.
const choiceName = c => (c.id === "api-key" ? t("setup.name.key") : c.name);
const WHY = { "claude-code": "setup.why.claude", codex: "setup.why.codex", "api-key": "setup.why.key" };
function choiceRow(c, checked) {
  const ready = c.found;
  const status = ready ? h("span", { class: "badge ready", title: c.id === "api-key" ? t("desk.model.keySet", { env: c.keyEnv }) : c.detail || null }, h("i", { class: "dot on" }), t("desk.ready"))
    : c.id === "api-key" ? null
    : h("span", { class: "badge" }, t("desk.model.notInstalled"));
  const howto = !ready && c.install && c.id !== "api-key"
    ? h("div", { class: "howto", hidden: true },
      h("span", { text: t("desk.model.installFrom", { name: c.name }) }),
      h("code", { text: c.install }),
      h("button", { type: "button", class: "btn", onclick: e => { e.preventDefault(); loadChoices(); } }, t("desk.lookAgain")))
    : null;
  return h("label", { class: "choice", "data-choice": c.id },
    h("input", { type: "radio", name: "choice", value: c.id, checked, onchange: syncChoice }),
    providerMark(c.id),
    h("span", { class: "grow" },
      h("b", {}, h("span", { text: choiceName(c) }), c.recommended ? h("span", { class: "rec", text: t("desk.model.recommended") }) : null),
      h("small", { text: WHY[c.id] ? t(WHY[c.id]) : c.why })),
    h("span", { class: "state" }, status,
      howto ? h("button", { type: "button", class: "link", "data-howto": c.id, "aria-expanded": "false", onclick: e => {
        e.preventDefault();
        howto.hidden = !howto.hidden;
        e.currentTarget.setAttribute("aria-expanded", String(!howto.hidden));
      } }, t("desk.model.howInstall")) : null),
    howto);
}
$("change-model").onclick = loadChoices;
function syncChoice() {
  const v = document.querySelector('input[name="choice"]:checked')?.value;
  const c = choices.find(x => x.id === v);
  $("keyrow").hidden = v !== "api-key";
  $("use-choice").disabled = !c || (v !== "api-key" && !c.found);
}
$("cancel-choice").onclick = () => { $("choices").hidden = true; $("api-key").value = ""; };
$("use-choice").onclick = async () => {
  const v = document.querySelector('input[name="choice"]:checked')?.value;
  if (!v) return;
  const c = choices.find(x => x.id === v);
  checking = true;
  $("use-choice").disabled = true;
  $("model-live").replaceChildren(radar(12), h("span", { text: t("desk.model.saved", { name: c ? choiceName(c) : t("desk.model.it") }) }));
  const r = await morse.chooseModel(v, v === "api-key" ? $("api-key").value : "");
  checking = false;
  $("use-choice").disabled = false;
  if (r?.error) { $("model-live").replaceChildren(h("i", { class: "dot bad" }), h("span", { text: r.error })); return; }
  $("api-key").value = "";
  $("choices").hidden = true;
  st = await morse.state();
  render();
};

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
submitOnEnter("api-key", "use-choice");
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
  const apps = st.apps.filter(a => a.canAttach !== false).slice(0, 5);
  const sig = JSON.stringify(apps.map(a => [a.id, a.state, a.icon ? 1 : 0]));
  if ($("first-apps").dataset.sig === sig) return;
  $("first-apps").dataset.sig = sig;
  $("first-apps").replaceChildren(...(apps.length ? apps.map(a => {
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
$("update-later").onclick = async () => { if (st.update?.phase === "ready") await morse.updateLater(); $("update").close(); st.update = { phase: "idle" }; };
$("update").addEventListener("cancel", e => { if (["downloading", "installing"].includes(st.update?.phase)) e.preventDefault(); });

// ---------------------------------------------------------------- state
function render() {
  if (!st || st.error) return;
  renderFirst();
  renderApps(); renderModel(); renderMods(); renderShortcut(); renderUpdate();
  $("auto-open").checked = st.settings.autoOpen;
  $("version").textContent = `Morse ${st.version}`;
  document.documentElement.dataset.ready = "1";
}
morse.onChange(next => { if (next && !next.error) { st = next; render(); } });
st = await morse.state();
render();
let first = "apps";
try { first = sessionStorage.getItem("tab") || "apps"; } catch {}
show(first);
