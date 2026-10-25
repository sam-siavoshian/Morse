// The Morse app's window. It only talks to window.morse (preload.cjs); every
// name it shows that came from a mod or an app goes in as text, never as markup.
// Its words are in core/locales/*.js (desk.*), in the computer's language.

import { t, setLanguage, loadLanguage, pickLanguage, setLanguageLoader, translatePage } from "./core/i18n.js";

setLanguageLoader(code => import(`./core/locales/${code}.js`).then(m => m.default));
setLanguage(await loadLanguage(pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language])));
translatePage(document);

const morse = window.morse;
const $ = id => document.getElementById(id);
const platform = new URLSearchParams(location.search).get("platform") || "";
document.body.classList.toggle("mac", platform === "darwin");

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
  else if (a.state === "connected" || a.state === "waiting") button = h("button", { type: "button", class: "btn", "data-act": "disconnect", onclick: () => disconnect(a) }, t("desk.app.disconnect"));
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
  const list = $("app-list");
  const rows = st.apps;
  const seen = new Set();
  if (!rows.length) {
    list.replaceChildren(h("li", { class: "empty" }, t("desk.apps.none")));
  } else {
    if (list.querySelector("li.empty")) list.replaceChildren();
    let prev = null;
    for (const a of rows) {
      const sig = JSON.stringify([a.name, a.state, a.windows, a.mods, a.modsOn, a.version, a.icon ? 1 : 0, a.canAttach, a.why]);
      let li = list.querySelector(`li[data-app="${CSS.escape(a.id)}"]`);
      if (!li || li.dataset.sig !== sig) {
        const fresh = appRow(a);
        fresh.dataset.sig = sig;
        const hadFocus = li?.contains(document.activeElement);
        if (li) li.replaceWith(fresh); else list.append(fresh);
        li = fresh;
        if (hadFocus) li.querySelector("button")?.focus();
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

function appError(text) { $("apps-error").textContent = text || ""; $("apps-error").hidden = !text; }

async function open(a, answer) {
  appError("");
  const r = await morse.openApp(a.id, answer);
  if (r?.needsRestart) return askRestart(a);
  if (r?.error) appError(r.error);
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

// ---------------------------------------------------------------- chrome
// Morse in Chrome: one button. With Morse in the Chrome Web Store it opens
// Morse's page there; until then Chrome's extensions page, the folder, and
// the picture of where to click (the guide below).
function chromeLine(c) {
  if (c.error) return [h("i", { class: "dot bad" }), h("span", { text: c.error })];
  if (!c.running) return [h("i", { class: "dot" }), h("span", { text: t("desk.chrome.off") })];
  if (c.browsers) return [h("i", { class: "dot on" }), h("span", { text: t("desk.chrome.connected", { n: c.browsers }) }),
    h("button", { type: "button", class: "link", onclick: () => morse.signOutBrowsers() }, t("desk.chrome.signOut"))];
  return [h("i", { class: "dot" }), h("span", { text: c.ours ? t("desk.chrome.notYet") : t("desk.chrome.notYetTerminal") })];
}
function renderChrome() {
  const c = st.chrome;
  $("helper-on").checked = st.settings.helper;
  $("helper-live").replaceChildren(...chromeLine(c));
  $("use-chrome").textContent = c.browsers ? t("desk.chrome.again") : t("desk.chrome.use");
  $("use-chrome").classList.toggle("primary", !c.browsers);
  // A code waiting: from "Show a code", or the one Chrome's welcome page sent.
  const w = c.waiting;
  $("pair-code").hidden = !w || w.fromChrome;
  if (w && !w.fromChrome) {
    $("pair-code").textContent = w.code;
    const min = Math.max(1, Math.round((w.expires - Date.now()) / 60000));
    $("code-note").textContent = t("desk.chrome.codeOnce", { n: min });
  } else if (!codeNote) $("code-note").textContent = "";
  $("new-code").textContent = w ? t("desk.chrome.newCode") : t("desk.chrome.showCode");
  const nav = $("nav-chrome");
  nav.textContent = c.browsers ? t("desk.nav.onShort") : "";
  nav.className = c.browsers && c.running ? "on" : "";
  // The first run's card, and the guide: done once a browser is connected.
  $("first-chrome-note").textContent = c.browsers ? t("desk.chrome.card.done") : chromeNote || t("desk.chrome.card.d");
  $("first-chrome").hidden = !!c.browsers;
  $("first-chrome-card").classList.toggle("done", !!c.browsers);
  const g = $("chrome-guide");
  if (g.open) {
    $("chrome-guide-live").replaceChildren(...(c.browsers ? [h("i", { class: "dot on" }), h("span", { text: t("desk.guide.connected") })]
      : [radar(12), h("span", { text: t("desk.guide.waiting") })]));
    if (c.browsers && !guideClosing) { guideClosing = true; setTimeout(() => { if (g.open) g.close(); guideClosing = false; }, 1600); }
  }
  // The Morse extension asked to connect: only Allow here makes it a token.
  const d = $("ask-pair");
  if (c.ask && d.dataset.id !== c.ask.id) {
    d.dataset.id = c.ask.id;
    $("ask-pair-h").textContent = c.ask.words?.message || t("pair.ask.q", { label: modelPhrase() }); // the helper's own words (askWords), when it has them
    $("ask-ext").textContent = t("desk.ask.ext", { id: `${c.ask.extension.slice(0, 12)}…` });
    const mark = providerMark(st.model.provider); mark.id = "ask-mark"; $("ask-mark").replaceWith(mark);
    if (g.open) g.close(); // the question comes first
    if (!d.open) d.showModal();
    $("pair-yes").focus();
  }
  if (!c.ask && d.open) { d.close(); delete d.dataset.id; }
}
let guideClosing = false, chromeNote = "", codeNote = false;
// "Claude Code", "Codex", "API key": what Chrome would use.
function modelPhrase() {
  const p = st.model.provider;
  return p === "claude-code" ? "Claude Code" : p === "codex" ? "Codex" : p === "anthropic" || p === "openai" ? t("desk.model.apiKey") : t("pair.ask.yourModel");
}
async function answerAsk(allow) {
  const d = $("ask-pair"), id = d.dataset.id;
  d.close();
  delete d.dataset.id;
  if (id) await morse.answerAsk(id, allow);
}
async function useChrome() {
  for (const b of [$("use-chrome"), $("first-chrome")]) b.disabled = true;
  try {
    const r = await morse.useChrome();
    if (r?.error) { chromeNote = r.error; return renderChrome(); }
    if (r?.store) { chromeNote = t("desk.chrome.store"); return renderChrome(); }
    chromeNote = "";
    const g = $("chrome-guide");
    $("chrome-guide-lede").textContent = r?.opened ? t("desk.guide.opened") : t("desk.guide.noChrome");
    $("chrome-guide-3").replaceChildren(...t("desk.guide.3", { folder: "\u0000" }).split("\u0000").flatMap((s, i) => (i ? [h("code", { text: r?.folder || "" }), s] : [s])));
    if (!g.open) g.showModal();
    renderChrome();
    $("guide-done").focus();
  } finally { for (const b of [$("use-chrome"), $("first-chrome")]) b.disabled = false; }
}
$("use-chrome").onclick = useChrome;
$("first-chrome").onclick = useChrome;
$("guide-done").onclick = () => $("chrome-guide").close();
$("guide-folder").onclick = () => morse.showExtensionFolder();
$("helper-on").onchange = e => morse.setHelper(e.target.checked);
$("new-code").onclick = () => { codeNote = false; morse.newPairingCode(); };
$("show-ext").onclick = async () => { const r = await morse.showExtensionFolder(); if (r?.error) { codeNote = true; $("code-note").textContent = r.error; } };
$("pair-yes").onclick = () => answerAsk(true);
$("pair-no").onclick = () => answerAsk(false);
$("ask-pair").addEventListener("cancel", e => { e.preventDefault(); answerAsk(false); }); // Esc is Deny

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
  $("mod-groups").replaceChildren(...groups.map(g => h("div", { class: "group" },
    h("h2", {}, (icon => icon ? h("img", { class: "gicon", src: icon, alt: "" }) : h("span", { class: "gicon none", "aria-hidden": "true" }, appsGlyph()))(st.apps.find(a => a.id === g.app)?.icon), h("span", { text: g.name }), h("small", { text: t("desk.mods.count", { n: g.mods.length, on: g.mods.filter(m => m.on).length }) })),
    h("ul", { class: "list mods" }, ...g.mods.map(m => h("li", { class: m.on ? "" : "off" },
      h("div", { class: "grow" }, h("b", { text: m.title }), h("small", {}, h("span", { text: m.paused ? t("desk.mods.stopped") : `“${m.request}”` }))),
      h("input", { type: "checkbox", role: "switch", "aria-label": t("desk.mods.on", { title: m.title }), "data-mod": m.id, checked: m.on, onchange: e => morse.setModOn(m.id, e.target.checked) })))))));
  if (focused) document.querySelector(`[data-mod="${CSS.escape(focused)}"]`)?.focus();
}
$("resume").onclick = () => morse.setAllModsOff(false);
$("mods-on").onchange = e => morse.setAllModsOff(!e.target.checked);

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
$("at-login").onchange = e => morse.setStartAtLogin(e.target.checked);

// ---------------------------------------------------------------- first run
// One screen: the model Morse found by itself (checked once), the apps to
// open, and Morse in Chrome too. Opening an app, or Skip, leads to the main
// window for good.
let firstChecked = false;
function renderFirst() {
  const first = !st.settings.welcomed;
  $("first").hidden = !first;
  document.querySelector(".app").hidden = first;
  if (!first) return;
  const m = st.model, name = modelName(m);
  $("first-key").hidden = !m.none;
  const live = $("first-model");
  if (m.none) live.replaceChildren(h("i", { class: "dot warn" }), h("span", { text: t("desk.first.noModel") }));
  else if (checking) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.checking", { name }) }), radar(14));
  else if (m.check?.ok) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.answered", { name, secs: secs(m.check.ms) }) }), h("span", { class: "badge ready" }, h("i", { class: "dot on" }), t("desk.ready")));
  else if (m.check) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.noAnswer", { name, error: unprefixed(m.check.error, m.name) }) }), h("i", { class: "dot bad" }));
  else live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.willUse", { name }) }));
  if (!m.none && !m.check && !firstChecked) { firstChecked = true; checkModel(); }
  $("first-foot").replaceChildren(...withKeys("desk.first.foot", openKey()));
  const apps = st.apps.filter(a => a.canAttach !== false).slice(0, 6);
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
  if (r?.error) { $("first-model").replaceChildren(h("i", { class: "dot bad" }), h("span", { text: r.error })); return; }
  await morse.finishWelcome();
}
$("first-skip").onclick = () => morse.finishWelcome();
$("first-key-use").onclick = async () => {
  const r = await morse.chooseModel("api-key", $("first-key-input").value);
  $("first-key-input").value = "";
  if (r?.error) $("first-model").replaceChildren(h("i", { class: "dot bad" }), h("span", { text: r.error }));
};

// ---------------------------------------------------------------- state
function render() {
  if (!st || st.error) return;
  renderFirst();
  renderApps(); renderModel(); renderChrome(); renderMods();
  $("at-login").checked = st.settings.startAtLogin;
  $("version").textContent = `Morse ${st.version}`;
  document.documentElement.dataset.ready = "1";
}
morse.onChange(next => { if (next && !next.error) { st = next; render(); } });
st = await morse.state();
render();
let first = "apps";
try { first = sessionStorage.getItem("tab") || "apps"; } catch {}
show(first);
