// Morse Desktop's window. It only talks to window.morse (preload.cjs); every
// name it shows that came from a mod or an app goes in as text, never as markup.

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
const caps = combo => h("span", { class: "caps" }, ...String(combo || "").split("+").filter(Boolean).map(k => h("kbd", { text: k })));
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

let st = null;

// ---------------------------------------------------------------- sections
function show(tab) {
  for (const b of document.querySelectorAll("nav button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== tab;
  try { sessionStorage.setItem("tab", tab); } catch {}
  $(tab).closest("main").scrollTop = 0;
  // Checks ask the model a question, so they run only when asked.
  if (tab === "checks" && !$("check-list").children.length) $("check-list").replaceChildren(h("li", { class: "empty" }, "Run checks to see what Morse found on this computer. It also asks your model a short question."));
}
for (const b of document.querySelectorAll("nav button")) b.onclick = () => show(b.dataset.tab);
for (const b of document.querySelectorAll("[data-go]")) b.onclick = () => show(b.dataset.go);
for (const b of document.querySelectorAll("[data-link]")) b.onclick = () => morse.openLink(b.dataset.link);

// ---------------------------------------------------------------- apps
const STATUS = {
  connected: a => [h("i", { class: "dot on" }), h("span", { text: ["Connected", a.windows ? plural(a.windows, "window") : "", a.modsOn ? `${plural(a.modsOn, "mod")} on` : ""].filter(Boolean).join(" · ") })],
  waiting: () => [h("i", { class: "dot wait" }), h("span", { text: "Waiting for it to open again" })],
  connecting: () => [radar(12), h("span", { text: "Connecting…" })],
  opening: a => [radar(12), h("span", { text: `Opening ${a.name} with Morse…` })],
  disconnecting: () => [radar(12), h("span", { text: "Disconnecting…" })],
  "open-connectable": () => [h("i", { class: "dot" }), h("span", { text: "Open, ready to connect" })],
  open: () => [h("i", { class: "dot" }), h("span", { text: "Open without Morse" })],
  closed: a => [h("span", { text: [a.version ? `Version ${a.version}` : "Not open", a.mods ? plural(a.mods, "mod") : ""].filter(Boolean).join(" · ") })],
};

function appRow(a) {
  const cant = a.canAttach === false;
  const icon = h("div", { class: `appicon${a.icon ? " has-img" : ""}`, "aria-hidden": "true" }, a.icon ? h("img", { src: a.icon, alt: "" }) : (a.name || "?").trim()[0].toUpperCase());
  const status = cant ? [h("span", { text: `Can't connect: ${a.why}` })]
    : a.canAttach === null && a.state === "closed" ? [h("span", { text: "Morse couldn't tell what it's built on. You can still try." })]
    : (STATUS[a.state] || STATUS.closed)(a);
  const busy = ["opening", "disconnecting", "connecting"].includes(a.state);
  let button = null;
  if (cant) button = null;
  else if (a.state === "connected" || a.state === "waiting") button = h("button", { type: "button", class: "btn", "data-act": "disconnect", onclick: () => disconnect(a) }, "Disconnect");
  else if (a.state === "open-connectable") button = h("button", { type: "button", class: "btn", "data-act": "connect", onclick: () => open(a) }, "Connect");
  else button = h("button", { type: "button", class: "btn", "data-act": "open", disabled: busy, onclick: () => open(a) }, "Open with Morse");
  return h("li", { class: cant ? "cant" : a.state, "data-app": a.id },
    icon,
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
    list.replaceChildren(h("li", { class: "empty" }, "Morse didn't find any apps it can connect to. Use Add an app… to choose one."));
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
  nav.textContent = on ? `${on} on` : rows.filter(a => a.canAttach !== false).length || "";
  nav.className = on ? "on" : "";
  $("open-key").replaceChildren(caps(st.keys.open || (platform === "darwin" ? "⌥+Space" : "Ctrl+Shift+Space")));
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
  $("ask-restart-h").textContent = `${a.name} is open. Restart it with Morse?`;
  $("always-label").textContent = `Always restart ${a.name}`;
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
  $("model-name").textContent = m.none ? "No model yet" : m.name;
  $("model-pill").hidden = !m.model;
  $("model-pill").textContent = m.model;
  $("check-model").hidden = m.none;
  $("change-model").textContent = m.none ? "Choose…" : "Change…";
  if (!checking) {
    const live = $("model-live");
    if (m.none) live.replaceChildren(h("i", { class: "dot warn" }), h("span", { text: "Choose Claude Code, Codex or an API key to start." }));
    else if (m.check?.ok) live.replaceChildren(h("i", { class: "dot on" }), h("span", { text: `Answered in ${(m.check.ms / 1000).toFixed(1)}s${m.detected ? " · found on this computer" : ""}` }));
    else if (m.check) live.replaceChildren(h("i", { class: "dot bad" }), h("span", { text: `Didn't answer: ${m.check.error}` }));
    else live.replaceChildren(h("i", { class: "dot" }), h("span", { text: m.detected ? "Found on this computer. Not checked yet." : "Not checked yet." }));
  }
  const nav = $("nav-model");
  nav.textContent = m.none ? "!" : m.check && !m.check.ok ? "!" : "";
  nav.className = m.none || (m.check && !m.check.ok) ? "warn" : "";
}

let checking = false;
async function checkModel() {
  checking = true;
  $("check-model").disabled = true;
  $("model-live").replaceChildren(radar(12), h("span", { text: `Checking that ${st.model.name} answers. This can take a few seconds…` }));
  if (st && !st.settings.welcomed) renderFirst();
  try { await morse.checkModel(); } finally { checking = false; $("check-model").disabled = false; st = await morse.state(); render(); }
}
$("check-model").onclick = checkModel;

let choices = [];
$("change-model").onclick = async () => {
  $("choices").hidden = false;
  $("choice-list").replaceChildren(h("p", { class: "live" }, radar(12), h("span", { text: "Looking for what's installed…" })));
  choices = await morse.modelChoices();
  const current = { "claude-code": "claude-code", codex: "codex", anthropic: "api-key", openai: "api-key" }[st.model.provider];
  const pick = current || choices.find(c => c.recommended)?.id || "api-key";
  $("choice-list").replaceChildren(...choices.map(c => h("label", { class: "choice" },
    h("input", { type: "radio", name: "choice", value: c.id, checked: c.id === pick, onchange: syncChoice }),
    h("div", {},
      c.recommended ? h("span", { class: "tag tagline", text: "recommended" }) : null,
      h("b", { text: c.name }), h("span", { class: "why", text: c.why }),
      c.id === "api-key"
        ? h("span", { class: `found${c.found ? " yes" : ""}`, text: c.found ? `${c.keyEnv} is set` : "Paste one below" })
        : h("span", { class: `found${c.found ? " yes" : ""}`, text: c.found ? `Found · ${c.detail}` : `Not installed. To install it: ${c.install}` })))));
  syncChoice();
  $("choices").scrollIntoView({ block: "nearest", behavior: "smooth" });
};
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
  const name = choices.find(c => c.id === v)?.name || "it";
  checking = true;
  $("use-choice").disabled = true;
  $("model-live").replaceChildren(radar(12), h("span", { text: `Saved. Checking that ${name} answers…` }));
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
function renderChrome() {
  const c = st.chrome;
  $("helper-on").checked = st.settings.helper;
  const live = $("helper-live");
  if (c.error) live.replaceChildren(h("i", { class: "dot bad" }), h("span", { text: c.error }));
  else if (c.running) live.replaceChildren(h("i", { class: "dot on" }),
    h("span", { text: `${c.ours ? "On." : "On, started from a terminal."} ${c.browsers ? `${plural(c.browsers, "browser")} connected.` : "No browser connected yet."}` }),
    c.browsers ? h("button", { type: "button", class: "link", onclick: () => morse.signOutBrowsers() }, "Sign out browsers") : "");
  else live.replaceChildren(h("i", { class: "dot" }), h("span", { text: "Off. Chrome can't use your model until it's on." }));
  // A code waiting: from "Show a code", or the one Chrome's welcome page sent.
  const w = c.waiting;
  $("pair-code").hidden = !w || w.fromChrome;
  if (w && !w.fromChrome) {
    $("pair-code").textContent = w.code;
    const min = Math.max(1, Math.round((w.expires - Date.now()) / 60000));
    $("code-note").textContent = `Works once, for ${plural(min, "minute")}`;
  } else $("code-note").textContent = "";
  $("new-code").textContent = w ? "New code" : "Show a code";
  const nav = $("nav-chrome");
  nav.textContent = c.browsers ? "on" : "";
  nav.className = c.browsers && c.running ? "on" : "";
  // The Morse extension asked to connect: only Allow here makes it a token.
  const d = $("ask-pair");
  if (c.ask && d.dataset.id !== c.ask.id) {
    d.dataset.id = c.ask.id;
    $("ask-pair-h").textContent = `Allow Chrome to use ${modelPhrase()}?`;
    $("ask-ext").textContent = `Extension ${c.ask.extension.slice(0, 12)}…`;
    if (!d.open) d.showModal();
    $("pair-yes").focus();
  }
  if (!c.ask && d.open) { d.close(); delete d.dataset.id; }
}
// "your Claude Code", "your Codex", "your API key": what Chrome would use.
function modelPhrase() {
  const p = st.model.provider;
  return p === "claude-code" ? "your Claude Code" : p === "codex" ? "your Codex" : p === "anthropic" || p === "openai" ? "your API key" : p === "demo" ? "the demo model" : "your model";
}
async function answerAsk(allow) {
  const d = $("ask-pair"), id = d.dataset.id;
  d.close();
  delete d.dataset.id;
  if (id) await morse.answerAsk(id, allow);
}
$("helper-on").onchange = e => morse.setHelper(e.target.checked);
$("new-code").onclick = () => morse.newPairingCode();
$("show-ext").onclick = async () => { const r = await morse.showExtensionFolder(); if (r?.error) $("code-note").textContent = r.error; };
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
  nav.textContent = st.pause.all ? "off" : total || "";
  nav.className = st.pause.all ? "warn" : "";
  const sig = JSON.stringify(groups);
  if ($("mod-groups").dataset.sig === sig) return;
  $("mod-groups").dataset.sig = sig;
  const focused = document.activeElement?.dataset?.mod;
  $("mod-groups").replaceChildren(...groups.map(g => h("div", { class: "group" },
    h("h2", {}, h("span", { text: g.name }), h("small", { text: `${plural(g.mods.length, "mod")} · ${g.mods.filter(m => m.on).length} on` })),
    h("ul", { class: "list mods" }, ...g.mods.map(m => h("li", { class: m.on ? "" : "off" },
      h("div", { class: "grow" }, h("b", { text: m.title }), h("small", {}, h("span", { text: m.paused ? "Stopped because it slowed down or broke the app. Turn it on to try again." : `“${m.request}”` }))),
      h("input", { type: "checkbox", role: "switch", "aria-label": `${m.title} on`, "data-mod": m.id, checked: m.on, onchange: e => morse.setModOn(m.id, e.target.checked) })))))));
  if (focused) document.querySelector(`[data-mod="${CSS.escape(focused)}"]`)?.focus();
}
$("resume").onclick = () => morse.setAllModsOff(false);
$("mods-on").onchange = e => morse.setAllModsOff(!e.target.checked);

// ---------------------------------------------------------------- checks
async function runChecks() {
  const b = $("run-checks");
  b.disabled = true;
  b.textContent = "Checking…";
  $("check-list").replaceChildren(h("li", { class: "empty" }, radar(14), " Looking at this computer and asking your model to answer…"));
  try {
    const rows = await morse.runChecks();
    if (rows?.error) throw new Error(rows.error);
    $("check-list").replaceChildren(...rows.map(r => h("li", { class: r.ok === false ? "bad" : "" },
      h("span", { class: `mark ${r.ok === true ? "ok" : r.ok === false ? "bad" : "info"}`, "aria-label": r.ok === true ? "fine" : r.ok === false ? "worth fixing" : "for your information" }, r.ok === true ? "✓" : r.ok === false ? "!" : "i"),
      h("span", { class: "label", text: r.label }),
      h("span", { class: "text", text: r.text }))));
    const bad = rows.filter(r => r.ok === false).length;
    $("nav-checks").textContent = bad ? String(bad) : "";
    $("nav-checks").className = bad ? "warn" : "";
  } catch (e) {
    $("check-list").replaceChildren(h("li", { class: "empty" }, e.message));
  } finally { b.disabled = false; b.textContent = "Run checks"; }
}
$("run-checks").onclick = runChecks;

// ---------------------------------------------------------------- settings
$("at-login").onchange = e => morse.setStartAtLogin(e.target.checked);

// ---------------------------------------------------------------- state
// ---------------------------------------------------------------- first run
// One screen: the model Morse found by itself (checked once), and the apps to
// open. Opening one, or Skip, leads to the main window for good.
let firstChecked = false;
function renderFirst() {
  const first = !st.settings.welcomed;
  $("first").hidden = !first;
  document.querySelector(".app").hidden = first;
  if (!first) return;
  const m = st.model;
  $("first-key").hidden = !m.none;
  const live = $("first-model");
  if (m.none) live.replaceChildren(h("i", { class: "dot warn" }), h("span", { text: "Morse didn't find Claude Code or Codex on this computer. Paste an API key, or install Claude Code and open Morse again." }));
  else if (checking) live.replaceChildren(radar(12), h("span", { text: `Morse will use ${m.name}. Checking that it answers…` }));
  else if (m.check?.ok) live.replaceChildren(h("i", { class: "dot on" }), h("span", { text: `Morse will use ${m.name}. It answered in ${(m.check.ms / 1000).toFixed(1)}s.` }));
  else if (m.check) live.replaceChildren(h("i", { class: "dot bad" }), h("span", { text: `Morse will use ${m.name}, but it didn't answer: ${m.check.error}` }));
  else live.replaceChildren(h("i", { class: "dot" }), h("span", { text: `Morse will use ${m.name}.` }));
  if (!m.none && !m.check && !firstChecked) { firstChecked = true; checkModel(); }
  $("first-key-caps").replaceChildren(caps(st.keys.open || (platform === "darwin" ? "⌥+Space" : "Ctrl+Shift+Space")));
  const apps = st.apps.filter(a => a.canAttach !== false).slice(0, 6);
  const sig = JSON.stringify(apps.map(a => [a.id, a.state, a.icon ? 1 : 0]));
  if ($("first-apps").dataset.sig === sig) return;
  $("first-apps").dataset.sig = sig;
  $("first-apps").replaceChildren(...(apps.length ? apps.map(a => {
    const busy = ["opening", "connecting"].includes(a.state);
    return h("li", { "data-first-app": a.id },
      h("div", { class: `appicon${a.icon ? " has-img" : ""}`, "aria-hidden": "true" }, a.icon ? h("img", { src: a.icon, alt: "" }) : (a.name || "?").trim()[0].toUpperCase()),
      h("div", { class: "grow" }, h("b", { text: a.name }), h("small", {}, ...(busy ? [radar(12), h("span", { text: `Opening ${a.name} with Morse…` })] : [h("span", { text: a.state === "closed" ? "Not open" : "Open now" })]))),
      h("button", { type: "button", class: "btn primary", disabled: busy, onclick: () => openFirst(a) }, "Open with Morse"));
  }) : [h("li", { class: "empty" }, "Morse didn't find any apps it can open. Skip for now, then use Add an app….")]));
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
