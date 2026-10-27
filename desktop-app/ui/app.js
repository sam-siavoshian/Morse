// The Morse app's window. It only talks to window.morse (preload.cjs); every
// name it shows that came from a mod or an app goes in as text, never as markup.
// Its words are in core/locales/*.js (desk.*), in the computer's language.

import { t, setLanguage, loadLanguage, pickLanguage, setLanguageLoader, translatePage } from "./core/i18n.js";
import { comboFromEvent, comboParts, formatCombo, formatPartial, defaultHotkeys, decideOpenShortcut, detectPlatform } from "./core/hotkeys.js";
import { formName } from "./formation.js";
import { mountStage } from "./zephium/stage.js";
import { mountDither } from "./dither.js";
import { filterApps, nativeAction } from "./app-list.js";
import { afterOpenBar, noticeStillShown } from "./open-bar.js";

setLanguageLoader(code => import(`./core/locales/${code}.js`).then(m => m.default));
setLanguage(await loadLanguage(pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language])));
translatePage(document);

mountStage(document.getElementById("first"));
const morse = window.morse;
const $ = id => document.getElementById(id);
const platform = new URLSearchParams(location.search).get("platform") || "";
document.body.classList.toggle("mac", platform === "darwin");
$("ob-mac-allow").hidden = platform !== "darwin";
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
// Consistent line icons with text labels; never the only accessible name.
function setupIcon(name) {
  const paths = {"key": "M8 15a5 5 0 1 1 4-8l9 0v4h-3v3h-3l-3-3M7 7h.01", "plug": "M8 3v4m8-4v4M6 7h12v3a6 6 0 0 1-6 6v5M6 7v3a6 6 0 0 0 6 6", "pointer": "m5 3 14 9-7 1-3 7-4-17Z", "message": "M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0ZM7 9h9M7 13h6", "keyboard": "M3 5h18v14H3ZM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8", "shield": "m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Zm-4 9 3 3 5-6", "arrow": "M5 12h14m-5-5 5 5-5 5", "apps": "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z", "check": "m5 12 4 4L19 6"};
  const icon = document.createElementNS(svgNS, "svg");
  for (const [key, value] of Object.entries({class:"setup-icon",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"1.6","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"})) icon.setAttribute(key,value);
  const path = document.createElementNS(svgNS,"path"); path.setAttribute("d",paths[name] || paths.apps); icon.append(path);
  return icon;
}
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
// The still radars in the page (data-radar="size"): the brand, the empty Mods, the update.
for (const el of document.querySelectorAll("[data-radar]")) { const r = radar(Number(el.dataset.radar) || 16); r.classList.remove("live"); el.append(r); }
// The skies' pixel edges (dither.js), as on the website.
for (const c of document.querySelectorAll("canvas.dither")) mountDither(c);
// An app's own icon, or (for an app with none Morse can read) four squares
// standing for an app: never a letter standing in for a picture.
const appsGlyph = () => h("span", { class: "apps-glyph", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
function trashGlyph() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7");
  svg.append(path);
  return svg;
}
function appIcon(a) {
  return h("div", { class: `appicon${a.icon ? " has-img" : ""}`, "aria-hidden": "true" }, a.icon ? h("img", { src: a.icon, alt: "" }) : appsGlyph());
}
const caps = combo => h("span", { class: "caps" }, ...String(combo || "").split("+").filter(Boolean).map(k => h("kbd", { text: k })));
const openKey = () => st.keys.open || formatCombo(defaultHotkeys(HK_PLATFORM).open, HK_PLATFORM);
// A message with the shortcut's keys in it: t() with {key} as a marker, then the keys put in its place.
function withKeys(id) {
  const [before, after = ""] = t(id, { key: "\u0000" }).split("\u0000");
  return [before, keyCaps(st.keys.combo || defaultHotkeys(HK_PLATFORM).open), after];
}
// The mark of what writes your changes (ui/icons/NOTICE): Claude Code, Codex,
// an API key (both providers' marks), or Morse's own radar for the rest.
const MARKS = { "claude-code": ["claude"], "codex": ["openai"], anthropic: ["anthropic"], openai: ["openai"], "api-key": ["anthropic", "openai"], ollama: ["ollama"], lmstudio: ["lmstudio"], llama: ["llamacpp"], llamacpp: ["llamacpp"] };
function providerMark(id, big = false) {
  const names = MARKS[id];
  const tile = h("span", { class: `mark-tile${big ? " big" : ""}${names?.length > 1 ? " pair" : ""}`, "aria-hidden": "true" });
  if (id === "local") {
    const icon = document.createElementNS(svgNS, "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: big ? "22" : "18", height: big ? "22" : "18", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" })) icon.setAttribute(key, value);
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 22h8M12 18v4");
    icon.append(path); tile.append(icon);
  }
  else if (!names) { const r = radar(big ? 22 : 18); r.classList.remove("live"); tile.append(r); }
  else for (const n of names) tile.append(h("img", { src: `icons/${n}.png`, alt: "", class: ["anthropic", "openai"].includes(n) ? "mono" : "", draggable: "false" }));
  return tile;
}
const secs = ms => (ms / 1000).toFixed(1);
// The model's name: "Claude Code" and "Codex" as they are, the rest in the person's words.
const modelName = m => m.provider === "local" && m.runtime === "local" ? t("desk.endpoint.name") : ({ anthropic: t("desk.model.anthropic"), openai: t("desk.model.openai"), demo: t("desk.model.demo") }[m.provider] || m.name);

let st = null;
const errorText = error => String(error?.message || error || t("err.generic"));
function showError(id, error) {
  const el = $(id);
  el.textContent = error ? errorText(error) : "";
  el.hidden = !error;
}
function actionError(error) {
  const tab = document.querySelector("main > section:not([hidden])")?.id || "apps";
  if (tab === "apps") appError(error ? errorText(error) : "");
  else showError(`${tab}-error`, error);
}

// ---------------------------------------------------------------- sections
const navButtons = [...document.querySelectorAll(".side nav button[data-tab]")];
const panels = [...document.querySelectorAll("main > section")];
const main = document.querySelector("main");
const scrollPositions = new Map();
let activeTab = null;
function show(tab) {
  if (tab === "checks") tab = "model";
  if (!["apps", "model", "mods", "settings"].includes(tab)) tab = "apps";
  // A second click must not reset the page or interrupt an in-progress edit.
  if (tab === activeTab) return;
  if (activeTab) scrollPositions.set(activeTab, main.scrollTop);
  if (activeTab === "settings" && recording) stopRecording();
  const previous = panels.find(panel => panel.id === activeTab);
  const moveFocus = previous?.contains(document.activeElement);
  activeTab = tab;
  for (const button of navButtons) {
    if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (tab !== "mods") hideUndo();
  for (const panel of panels) panel.hidden = panel.id !== tab;
  main.scrollTop = scrollPositions.get(tab) || 0;
  // Links within a page must not leave keyboard focus inside its hidden panel.
  if (moveFocus) navButtons.find(button => button.dataset.tab === tab)?.focus({ preventScroll: true });
  try { sessionStorage.setItem("tab", tab); } catch {}
  if (tab === "model" && !$("check-list").children.length) $("check-list").replaceChildren(h("li", { class: "empty" }, t("desk.checks.first")));
}
for (const b of navButtons) b.onclick = () => show(b.dataset.tab);
for (const b of document.querySelectorAll("[data-go]")) b.onclick = () => show(b.dataset.go);
for (const b of document.querySelectorAll("[data-link]")) b.onclick = () => morse.openLink(b.dataset.link);

function clearAppFilters() {
  $("app-search").value = "";
  $("connected-filter").setAttribute("aria-pressed", "false");
  renderApps();
  $("app-search").focus();
}
$("app-search").addEventListener("input", () => { if (st) renderApps(); });
$("app-search").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); clearAppFilters(); }
});
$("connected-filter").onclick = () => {
  const button = $("connected-filter");
  button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
  if (st) renderApps();
};
document.addEventListener("keydown", event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing || !$("first").hidden || document.querySelector("dialog[open]") || recording) return;
  if (event.key.toLowerCase() === "f") { event.preventDefault(); show("apps"); $("app-search").focus(); $("app-search").select(); }
  const tab = { "1": "apps", "2": "model", "3": "mods", "4": "settings" }[event.key];
  if (tab) { event.preventDefault(); show(tab); document.querySelector(`[data-tab="${tab}"]`).focus(); }
});
for (const [index, button] of [...document.querySelectorAll(".side nav button")].entries()) {
  const shortcut = `${platform === "darwin" ? "⌘" : "Ctrl+"}${index + 1}`;
  button.title = `${button.textContent.trim()} · ${shortcut}`;
  button.setAttribute("aria-keyshortcuts", `${platform === "darwin" ? "Meta" : "Control"}+${index + 1}`);
}
$("app-search").title = platform === "darwin" ? "⌘F" : "Ctrl+F";

// The footer light from site/motion.js: settle toward the pointer, then stop.
const liquidMotion = matchMedia("(prefers-reduced-motion: reduce)");
for (const zone of document.querySelectorAll(".head-actions, .app-tools")) {
  let frame = 0, x = 0, y = 0, aimX = 0, aimY = 0;
  const step = () => {
    x += (aimX - x) * 0.16; y += (aimY - y) * 0.16;
    zone.style.setProperty("--light-x", `${x.toFixed(1)}px`);
    zone.style.setProperty("--light-y", `${y.toFixed(1)}px`);
    frame = Math.abs(aimX - x) + Math.abs(aimY - y) > 0.5 ? requestAnimationFrame(step) : 0;
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; zone.classList.remove("lit"); };
  zone.addEventListener("pointermove", event => {
    if (liquidMotion.matches || event.pointerType !== "mouse") return;
    const box = zone.getBoundingClientRect();
    aimX = event.clientX - box.left; aimY = event.clientY - box.top;
    if (!zone.classList.contains("lit")) { x = aimX; y = aimY; }
    zone.classList.add("lit");
    if (!frame) frame = requestAnimationFrame(step);
  }, { passive: true });
  zone.addEventListener("pointerleave", stop);
  liquidMotion.addEventListener("change", stop);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
}

// ---------------------------------------------------------------- apps
const STATUS = {
  connected: a => [h("i", { class: "dot on" }), h("span", { text: [t("desk.app.connected"), a.windows ? t("desk.app.windows", { n: a.windows }) : "", a.modsOn ? t("desk.app.modsOn", { n: a.modsOn }) : ""].filter(Boolean).join(" · ") })],
  waiting: () => [h("i", { class: "dot wait" }), h("span", { text: t("desk.app.waiting") })],
  "waiting-page": () => [h("i", { class: "dot wait" }), h("span", { text: t("desk.app.waitingPage") })],
  connecting: () => [radar(12), h("span", { text: t("desk.app.connecting") })],
  opening: a => [radar(12), h("span", { text: t("desk.app.opening", { name: a.name }) })],
  disconnecting: () => [radar(12), h("span", { text: t("desk.app.disconnecting") })],
  "open-connectable": () => [h("i", { class: "dot" }), h("span", { text: t("desk.app.ready") })],
  open: () => [h("i", { class: "dot" }), h("span", { text: t("desk.app.openWithout") })],
  closed: a => [h("span", { text: [t("desk.app.notOpen"), a.mods ? t("desk.app.mods", { n: a.mods }) : ""].filter(Boolean).join(" · ") })],
};

const nativePending = new Set();
let nativeGuide = null;
let nativeCheck = false;
let nativeRecheckOnFocus = false;
function dismissNativeGuide() {
  const row = nativeGuideRow();
  nativeGuide = null;
  nativeRecheckOnFocus = false;
  $("native-setup").hidden = true;
  $("native-setup-home").append($("native-setup"));
  row?.querySelector('[data-act="native-controls"]')?.focus();
}
function nativeGuideRow() {
  if (!nativeGuide) return null;
  const list = $(nativeGuide.onboarding ? "first-apps" : "app-list");
  const key = nativeGuide.onboarding ? "data-first-app" : "data-app";
  return list.querySelector(`[${key}="${CSS.escape(nativeGuide.app.id)}"]`);
}
function placeNativeGuide() {
  if (!nativeGuide) return;
  const box = $("native-setup"), row = nativeGuideRow();
  // Keep the one guide alive across status updates; filters never move it to another app.
  if (row) { row.append(box); box.hidden = false; }
  else { $("native-setup-home").append(box); box.hidden = true; }
}
async function setupNativeForApp(app, button) {
  button.disabled = true;
  try {
    const access = await morse.nativeSetup("status");
    nativeGuide = { app, access, onboarding: true, checked: false, error: access.error || "" };
    renderNativeGuide();
    $("native-setup-title").focus({ preventScroll: true });
  } catch (error) { button.disabled = false; button.title = errorText(error); }
  finally { button.disabled = false; }
}
function renderNativeGuide() {
  const box = $("native-setup");
  box.hidden = !nativeGuide;
  if (!nativeGuide) return;
  placeNativeGuide();
  const { app, access, checked, error } = nativeGuide;
  const ready = access.trusted;
  const check = h("button", { type: "button", "data-act": "check-access", class: ready ? "btn primary" : "btn", disabled: nativeCheck,
    onclick: async event => {
      if (!ready) return checkNativeAccess();
      if (nativeGuide.onboarding) return dismissNativeGuide();
      await inspectNative(app, event.currentTarget);
    } }, t(nativeCheck ? "desk.native.checking" : ready ? (nativeGuide.onboarding ? "desk.ob.continue" : "desk.native.continue") : "desk.native.check", { name: app.name }));
  box.classList.toggle("ready", ready);
  box.replaceChildren(
    h("div", { class: "native-setup-head" },
      h("h2", { id: "native-setup-title", tabindex: "-1" }, setupIcon(ready ? "check" : "shield"), t("desk.native.title", { name: app.name })),
      h("button", { type: "button", class: "btn quiet", onclick: dismissNativeGuide }, t("desk.native.later"))),
    ...(!ready ? [h("p", { class: "native-setup-instructions" },
      t("desk.native.step1"), " ", t("desk.native.step2", { app: access.targetName || "Morse" }))] : []),
    h("div", { class: "native-setup-actions" },
      ...(!ready ? [h("button", { type: "button", class: "btn primary", onclick: () => nativeSetupAction("settings") }, t("desk.native.settings")),
        ...(access.canReveal ? [h("button", { type: "button", class: "btn quiet", onclick: () => nativeSetupAction("reveal") }, t("desk.native.reveal"))] : [])] : []), check),
    h("p", { role: "status", "aria-live": "polite", class: error ? "error" : "native-setup-status", text: error || t(ready ? "desk.native.ready" : checked ? "desk.native.off" : "desk.native.optional", { app: access.targetName || "Morse" }) }));
}
async function checkNativeAccess() {
  if (!nativeGuide || nativeCheck) return;
  const guide = nativeGuide;
  const restoreFocus = $("native-setup").contains(document.activeElement);
  nativeCheck = true;
  renderNativeGuide();
  try {
    const access = await morse.nativeSetup("status");
    if (access.error) throw new Error(access.error);
    if (nativeGuide === guide) Object.assign(guide, { access, checked: true, error: "" });
  } catch (e) { if (nativeGuide === guide) guide.error = errorText(e); }
  finally {
    nativeCheck = false; renderNativeGuide();
    if (nativeGuide === guide && restoreFocus) $("native-setup").querySelector('[data-act="check-access"]')?.focus({ preventScroll: true });
  }
}
async function nativeSetupAction(action) {
  const guide = nativeGuide;
  nativeRecheckOnFocus = true;
  try {
    const result = await morse.nativeSetup(action);
    if (result.error) throw new Error(result.error);
  } catch (e) { if (guide === nativeGuide) { guide.error = errorText(e); renderNativeGuide(); } }
}
window.addEventListener("focus", () => {
  if (!nativeGuide || !nativeRecheckOnFocus) return;
  nativeRecheckOnFocus = false;
  checkNativeAccess();
});

async function inspectNative(a, button) {
  if (nativePending.has(a.id)) return;
  nativePending.add(a.id);
  appError("");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const label = button.textContent;
  button.textContent = t("desk.app.opening", { name: a.name });
  try {
    const result = await morse.nativeControls(a.id);
    if (result.permissionNeeded) {
      nativeGuide = { app: a, access: result.access, checked: false, error: "" };
      renderNativeGuide();
      $("native-setup-title").focus({ preventScroll: true });
      $("native-setup").scrollIntoView({ block: "nearest", behavior: "auto" });
    } else if (result.error) appError(result.error);
    else if (result.ok && nativeGuide?.app.id === a.id) dismissNativeGuide();
  } catch (e) { appError(errorText(e)); }
  finally {
    nativePending.delete(a.id);
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = label;
  }
}

function appRow(a) {
  const cant = a.canAttach === false;
  const native = nativeAction(a, platform);
  const status = cant ? [h("span", { text: platform === "darwin" && a.engine === "native" ? t(a.running ? "desk.app.nativeReady" : "desk.app.nativeClosed", { name: a.name }) : t("desk.app.cant", { why: a.why }) })]
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
  const nativeButton = native ? h("button", {
    type: "button", class: native === "browser" ? "native-link" : "btn", "data-act": "native-controls",
    disabled: nativePending.has(a.id),
    title: t(native === "browser" ? "desk.app.browserControlsHint" : "desk.app.inspectControlsHint", { name: a.name }),
    onclick: event => inspectNative(a, event.currentTarget),
  }, t(native === "browser" ? "desk.app.browserControls" : "desk.app.inspectControls")) : null;
  return h("li", { class: cant ? "cant" : a.state, "data-app": a.id },
    appIcon(a),
    h("div", { class: "grow" }, h("b", { text: a.name, title: a.version ? `${a.name} · ${t("desk.app.version", { version: a.version })}` : a.name }), h("small", {}, ...status), native === "browser" ? nativeButton : null),
    h("div", { class: "actions" }, native === "native" ? nativeButton : button));
}

// Rows are only rebuilt when what they show changed, so focus stays put
// while the list refreshes.
function renderApps() {
  showAppsError(); // a Connected row clears a stale "isn't running yet" banner
  const list = $("app-list");
  const rows = filterApps(st.apps, $("app-search").value, $("connected-filter").getAttribute("aria-pressed") === "true");
  const seen = new Set();
  list.setAttribute("aria-busy", String(!!st.appsPending));
  if (!rows.length) {
    list.replaceChildren(h("li", { class: "empty", role: "status" }, ...(st.appsPending ? [radar(14), t("desk.apps.looking")] : [t(st.apps.length ? "desk.apps.noMatch" : "desk.apps.none"), ...(st.apps.length ? [h("button", { type: "button", class: "btn", onclick: clearAppFilters }, t("desk.apps.clear"))] : [])])));
  } else {
    if (list.querySelector("li.empty")) list.replaceChildren();
    let prev = null;
    for (const a of rows) {
      const sig = JSON.stringify([a.name, a.state, a.running, a.browser, a.engine, a.canStop ? 1 : 0, a.windows, a.mods, a.modsOn, a.version, a.icon ? 1 : 0, a.canAttach, a.why]);
      let li = list.querySelector(`li[data-app="${CSS.escape(a.id)}"]`);
      if (!li || li.dataset.sig !== sig) {
        const fresh = appRow(a);
        fresh.dataset.sig = sig;
        // A connected row rebuilds on every status tick; keep focus on the same
        // action (Disconnect stays Disconnect), not always the first button.
        const act = li?.contains(document.activeElement) ? document.activeElement.dataset.act : null;
        if (li?.contains($("native-setup"))) $("native-setup-home").append($("native-setup"));
        if (li) li.replaceWith(fresh); else list.append(fresh);
        li = fresh;
        if (act) (li.querySelector(`[data-act="${act}"]`) || li.querySelector("button"))?.focus();
      }
      if (prev ? prev.nextElementSibling !== li : list.firstElementChild !== li) prev ? prev.after(li) : list.prepend(li);
      prev = li;
      seen.add(a.id);
    }
  }
  placeNativeGuide();
  for (const li of [...list.querySelectorAll("li[data-app]")]) if (!seen.has(li.dataset.app)) {
    if (li.contains($("native-setup"))) { $("native-setup-home").append($("native-setup")); $("native-setup").hidden = true; }
    li.remove();
  }
  $("no-model").hidden = !st.model.none;
  const on = st.apps.filter(a => a.state === "connected").length;
  const nav = $("nav-apps");
  nav.textContent = on ? t("desk.nav.on", { n: on }) : st.apps.filter(a => a.canAttach !== false).length || "";
  nav.className = on ? "on" : "";
  $("apps-lede").replaceChildren(...withKeys("desk.apps.lede"));
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
  try {
    const r = await morse.openApp(a.id, answer);
    if (r?.needsRestart) return askRestart(a);
    if (r?.error) appError(r.error);
  } catch (e) { appError(errorText(e)); }
}
// "Open the bar": Morse's bar in the app, for when the shortcut does nothing
// (another app took it, or the keyboard makes it hard to press).
async function openBar(a) {
  appError("");
  let r;
  try { r = await morse.openBar(a.id); }
  catch (e) { appError(errorText(e)); return; }
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
  try {
    const r = await morse.disconnectApp(a.id);
    if (r?.error) appError(r.error);
  } catch (e) { appError(errorText(e)); }
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
  $("restart-cancel").focus();
}

$("refresh").onclick = async () => {
  if ($("refresh").disabled) return;
  $("refresh").disabled = true;
  appError("");
  $("refresh").classList.add("spin");
  try {
    const next = await morse.refreshApps();
    if (next?.error) throw new Error(next.error);
    st = next; render();
  } catch (e) { appError(errorText(e)); }
  finally { $("refresh").disabled = false; $("refresh").classList.remove("spin"); }
};
$("add-app").onclick = async () => {
  appError("");
  $("add-app").disabled = true;
  try {
    const r = await morse.addApp();
    if (r?.error) appError(r.error);
    else if (r?.ok) { st = await morse.state(); render(); }
  } catch (e) { appError(errorText(e)); }
  finally { $("add-app").disabled = false; }
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
  renderFast();
}

// "Claude Code: You've hit your limit" under Claude Code's own name: the words, without the name again.
const unprefixed = (error, name) => { const e = String(error || ""); return name && e.startsWith(name + ": ") ? e.slice(name.length + 2) : e; };
let checking = false;
async function checkModel() {
  if (checking || choosing) return;
  checking = true;
  showError("model-error", "");
  $("check-model").disabled = true;
  $("model-live").replaceChildren(radar(12), h("span", { text: t("desk.model.checking", { name: modelName(st.model) }) }));
  if (st && !st.settings.welcomed) renderFirst();
  try { await morse.checkModel(); st = await morse.state(); }
  catch (e) { showError("model-error", errorText(e)); }
  finally { checking = false; $("check-model").disabled = false; render(); syncChoice(); }
}
$("check-model").onclick = checkModel;
$("fast-mode").addEventListener("change", async () => {
  if (!st?.model) return;
  const on = $("fast-mode").checked;
  const prev = !!st.model.fastMode;
  showError("model-error", "");
  $("fast-mode").disabled = true;
  st.model.fastMode = on;
  fastSent = on;
  let r;
  try { r = await morse.setFastMode(on); }
  catch (e) { r = { error: errorText(e) }; }
  $("fast-mode").disabled = false;
  if (r?.error) {
    st.model.fastMode = prev;
    fastSent = prev;
    $("fast-mode").checked = prev;
    showError("model-error", r.error);
  }
});

// Hidden unless the model already chosen has a faster mode. The choice list
// below is unchanged.
let fastSent = null;
function fastForSelection() {
  const saved = st?.model || {};
  const map = st?.fastModels || {};
  if (!saved.provider || saved.none) return { id: "", known: true };
  if (Object.prototype.hasOwnProperty.call(map, saved.provider)) return { id: map[saved.provider] || "", known: true };
  if (saved.fastKnown) return { id: saved.fastModel || "", known: true };
  return { id: "", known: false };
}
function renderFast() {
  const row = $("fast-mode-row");
  const input = $("fast-mode");
  if (!row || !input || !st?.model) return;
  const { id, known } = fastForSelection();
  row.hidden = !id;
  if (document.activeElement !== input) input.checked = !!st.model.fastMode && !!id;
  if (known && !id && st.model.fastMode) {
    st.model.fastMode = false;
    input.checked = false;
    if (fastSent !== false && morse.setFastMode) {
      fastSent = false;
      morse.setFastMode(false).then(r => { if (r?.error) fastSent = null; }, () => { fastSent = null; });
    }
  }
}

let choices = [];
let choiceRequest = 0;
let choosing = false;
async function loadChoices() {
  if (checking || choosing) return;
  const request = ++choiceRequest;
  $("choices").hidden = false;
  $("current-model").hidden = false;
  $("choices").setAttribute("aria-busy", "true");
  $("keyrow").hidden = true;
  $("use-choice").disabled = true;
  showError("choice-error", "");
  $("choice-list").replaceChildren(h("p", { class: "live" }, radar(12), h("span", { text: t("desk.model.looking") })));
  let rows;
  try { rows = await morse.modelChoices(); if (!Array.isArray(rows)) throw new Error(rows?.error || t("err.generic")); }
  catch (e) {
    if (request !== choiceRequest) return;
    $("choice-list").replaceChildren(h("button", { type: "button", class: "btn", onclick: loadChoices }, t("result.again")));
    showError("choice-error", errorText(e));
    $("choices").setAttribute("aria-busy", "false");
    return;
  }
  if (request !== choiceRequest) return;
  $("choices").setAttribute("aria-busy", "false");
  choices = rows;
  renderFast();
  const current = currentChoiceId();
  const pick = current || choices.find(c => c.recommended)?.id || "api-key";
  $("choice-list").replaceChildren(...choices.map(c => choiceRow(c, c.id === pick)));
  syncChoice();

}
// One choice: its mark, what it uses, and one word for whether it's ready.
// Not installed: "How to install" shows the one command, on request.
const choiceName = c => (c.id === "local" ? t("desk.endpoint.name") : c.id === "api-key" ? t("setup.name.key") : c.name);
const WHY = { "claude-code": "setup.why.claude", codex: "setup.why.codex", "api-key": "setup.why.key" };
function choiceRow(c, checked) {
  const ready = c.found;
  const status = c.id === "local" ? null : ready ? h("span", { class: "badge ready", title: c.id === "api-key" ? t("desk.model.keySet", { env: c.keyEnv }) : c.detail || null }, h("i", { class: "dot on" }), t("desk.ready"))
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
      h("small", { text: c.id === "local" ? t("desk.endpoint.why") : WHY[c.id] ? t(WHY[c.id]) : c.why })),
    h("span", { class: "state" }, status,
      howto ? h("button", { type: "button", class: "link", "data-howto": c.id, "aria-expanded": "false", onclick: e => {
        e.preventDefault();
        howto.hidden = !howto.hidden;
        e.currentTarget.setAttribute("aria-expanded", String(!howto.hidden));
      } }, t("desk.model.howInstall")) : null),
    howto);
}
function currentChoiceId() {
  const provider = st?.model?.provider;
  if (st?.model?.none) return "";
  return choices.find(c => c.id === provider)?.id
    || choices.find(c => c.kind === "local" && c.name === st.model.name)?.id
    || (["anthropic", "openai"].includes(provider) ? "api-key" : "");
}
function syncChoice() {
  const v = document.querySelector('input[name="choice"]:checked')?.value;
  const c = choices.find(x => x.id === v);
  $("keyrow").hidden = v !== "api-key";
  $("endpoint-fields").hidden = v !== "local";
  if (v === "local" && !$("endpoint-url").value && st.model.baseUrl) $("endpoint-url").value = st.model.baseUrl;
  if (v === "local") {
    $("use-choice").disabled = choosing || endpointLoading || !$("endpoint-model").value || endpointVerified !== endpointSignature();
    $("cancel-choice").disabled = choosing;
    return;
  }
  const unchanged = v === currentChoiceId() && !$("api-key").value.trim();
  $("cancel-choice").disabled = choosing || unchanged;
  $("use-choice").disabled = choosing || checking || unchanged || !c || (v === "api-key" ? !c.found && !$("api-key").value.trim() : !c.found);
}
let endpointLoading = false, endpointVerified = "", endpointRequest = 0;
const endpointSignature = () => JSON.stringify([$("endpoint-url").value.trim(), $("endpoint-key").value.trim()]);
function invalidateEndpoint() {
  ++endpointRequest; endpointVerified = ""; endpointLoading = false;
  $("endpoint-load").disabled = false;
  $("endpoint-status").hidden = true;
  $("endpoint-model").replaceChildren(h("option", { value: "" }, t("desk.endpoint.pick")));
  $("endpoint-model").disabled = true;
  syncChoice();
}
for (const id of ["endpoint-url", "endpoint-key"]) $(id).addEventListener("input", invalidateEndpoint);
$("endpoint-model").addEventListener("change", syncChoice);
$("endpoint-load").onclick = async () => {
  if (endpointLoading || choosing) return;
  const request = ++endpointRequest, signature = endpointSignature();
  endpointLoading = true; endpointVerified = "";
  $("endpoint-load").disabled = true;
  $("endpoint-status").hidden = false;
  $("endpoint-status").textContent = t("desk.endpoint.loading");
  showError("choice-error", ""); syncChoice();
  try {
    const result = await morse.probeEndpoint($("endpoint-url").value.trim(), $("endpoint-key").value.trim());
    if (request !== endpointRequest || signature !== endpointSignature()) return;
    if (result?.error || !result?.models?.length) throw new Error(result?.error || t("err.generic"));
    $("endpoint-model").replaceChildren(...result.models.map(m => h("option", { value: m.id }, m.name || m.id)));
    if (result.models.some(m => m.id === st.model.model)) $("endpoint-model").value = st.model.model;
    $("endpoint-model").disabled = false;
    endpointVerified = signature;
  } catch (error) { if (request === endpointRequest) showError("choice-error", errorText(error)); }
  finally {
    if (request === endpointRequest) {
      endpointLoading = false; $("endpoint-load").disabled = false; $("endpoint-status").hidden = true; syncChoice();
    }
  }
};
$("api-key").addEventListener("input", syncChoice);
$("choices").addEventListener("keydown", event => {
  if (event.key === "Escape" && !choosing) { event.preventDefault(); $("cancel-choice").click(); }
  if (event.key === "Enter" && event.target === $("api-key") && !event.isComposing) { event.preventDefault(); $("use-choice").click(); }
});
$("cancel-choice").onclick = () => {
  $("api-key").value = "";
  $("endpoint-key").value = "";
  invalidateEndpoint();
  const current = currentChoiceId();
  for (const input of $("choice-list").querySelectorAll("input")) input.checked = input.value === current;
  showError("choice-error", "");
  syncChoice();
  $("choice-list").querySelector("input:checked")?.focus({ preventScroll: true });
};
$("use-choice").onclick = async () => {
  const v = document.querySelector('input[name="choice"]:checked')?.value;
  if (!v || choosing || $("use-choice").disabled) return;
  const c = choices.find(x => x.id === v);
  checking = true;
  choosing = true;
  showError("choice-error", "");
  $("choices").setAttribute("aria-busy", "true");
  $("choice-progress").hidden = false;
  $("choice-progress").replaceChildren(radar(12), h("span", { text: t("desk.model.saved", { name: c ? choiceName(c) : t("desk.model.it") }) }));
  $("use-choice").disabled = true;
  $("cancel-choice").disabled = true;
  $("check-model").disabled = true;
  $("choice-list").querySelectorAll("input").forEach(input => { input.disabled = true; });
  $("api-key").disabled = true;
  for (const id of ["endpoint-url", "endpoint-key", "endpoint-load", "endpoint-model"]) $(id).disabled = true;
  $("model-live").replaceChildren(radar(12), h("span", { text: t("desk.model.saved", { name: c ? choiceName(c) : t("desk.model.it") }) }));
  try {
    const r = v === "local"
      ? await morse.chooseModel(v, $("endpoint-model").value, $("endpoint-url").value.trim(), $("endpoint-key").value.trim())
      : await morse.chooseModel(v, v === "api-key" ? $("api-key").value.trim() : "");
    if (r?.error) throw new Error(r.error);
    $("api-key").value = "";
    $("endpoint-key").value = "";
    endpointVerified = "";
    $("choices").hidden = false;
    $("current-model").hidden = false;
    st = await morse.state();
    $("choice-list").querySelector("input:checked")?.focus({ preventScroll: true });
  } catch (e) { showError("choice-error", errorText(e)); }
  finally {
    checking = false;
    choosing = false;
    $("choices").setAttribute("aria-busy", "false");
    $("choice-progress").hidden = true;
    for (const id of ["cancel-choice", "check-model", "api-key"]) $(id).disabled = false;
    $("choice-list").querySelectorAll("input").forEach(input => { input.disabled = false; });
    for (const id of ["endpoint-url", "endpoint-key", "endpoint-load", "endpoint-model"]) $(id).disabled = false;
    syncChoice();
    render();

  }
};

// ---------------------------------------------------------------- mods
function renderMods() {
  const groups = st.mods;
  const total = groups.reduce((n, g) => n + g.mods.length, 0);
  $("no-mods").hidden = total > 0;
  $("paused").hidden = !st.pause.all;
  if (!$("mods-on").disabled) $("mods-on").checked = !st.pause.all;
  const nav = $("nav-mods");
  nav.textContent = st.pause.all ? t("desk.nav.off") : total || "";
  nav.className = st.pause.all ? "warn" : "";
  const sig = JSON.stringify([groups, groups.map(g => !!st.apps.find(a => a.id === g.app)?.icon)]);
  if ($("mod-groups").dataset.sig === sig) return;
  $("mod-groups").dataset.sig = sig;
  const active = document.activeElement;
  const focused = active?.dataset?.mod;
  const expanded = [...$("mod-groups").querySelectorAll("details[open]")].map(el => el.dataset.request);
  const focusedRequest = active?.closest("details")?.dataset.request;
  $("mod-groups").replaceChildren(...groups.map(groupBlock));
  for (const id of expanded) $("mod-groups").querySelector(`details[data-request="${CSS.escape(id)}"]`)?.setAttribute("open", "");
  if (focusedRequest) $("mod-groups").querySelector(`details[data-request="${CSS.escape(focusedRequest)}"] summary`)?.focus();
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
    h("details", { class: "grow mod-detail", "data-request": m.id },
      h("summary", { "aria-label": m.title }, h("b", { text: m.title }), h("small", {}, h("span", { text: request }))),
      h("p", { class: "mod-request", text: `“${m.request}”` }),
      m.paused ? h("p", { class: "mod-paused", text: t("desk.mods.stopped") }) : null),
    h("div", { class: "mod-actions" },
      h("button", { type: "button", class: "ibtn", title: t("btn.delete"), "aria-label": t("desk.mods.delete", { title: m.title }), "data-del": m.id, onclick: e => deleteMod(m, e.currentTarget) }, trashGlyph()),
      h("label", { class: "modsw" },
        h("input", { type: "checkbox", role: "switch", "aria-label": t("desk.mods.on", { title: m.title }), "data-mod": m.id, checked: m.on, onchange: e => toggleMod(m.id, e.target) }))));
}
// A switch that lies is worse than a slow one: if the change is refused (the
// mod is gone, or couldn't be written), put the switch back where it was.
async function toggleMod(id, el) {
  const want = el.checked;
  showError("mods-error", "");
  el.disabled = true;
  try {
    const r = await morse.setModOn(id, want);
    if (r?.error) throw new Error(r.error);
  } catch (e) { el.checked = !want; showError("mods-error", errorText(e)); }
  finally { el.disabled = false; }
}
// Delete takes one click; Undo, above the list, brings it back for a while.
let undoTimer = 0;
function hideUndo() { clearTimeout(undoTimer); $("mod-undo").hidden = true; }
async function deleteMod(m, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  showError("mods-error", "");
  try {
    const r = await morse.deleteMod(m.id);
    if (r?.error) throw new Error(r.error);
  } catch (e) { showError("mods-error", errorText(e)); return; }
  finally { if (button) button.disabled = false; }
  $("mod-undo-text").textContent = t("toast.deleted", { title: m.title });
  $("mod-undo").hidden = false;
  $("mod-undo-btn").focus();
  $("mod-undo-btn").onclick = async () => {
    $("mod-undo-btn").disabled = true;
    try {
      const r = await morse.undeleteMod(m.id);
      if (r?.error) throw new Error(r.error);
      hideUndo();
    } catch (e) { showError("mods-error", errorText(e)); }
    finally { $("mod-undo-btn").disabled = false; }
  };
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 15000);
}
async function setModsPaused(off) {
  if ($("mods-on").disabled) return;
  actionError("");
  $("mods-on").disabled = true;
  $("resume").disabled = true;
  try {
    const r = await morse.setAllModsOff(off);
    if (r?.error) throw new Error(r.error);
    st.pause.all = off;
    $("mods-on").checked = !off;
    renderMods();
  } catch (e) { $("mods-on").checked = off; actionError(errorText(e)); }
  finally { $("mods-on").disabled = false; $("resume").disabled = false; }
}
$("resume").onclick = () => setModsPaused(false);
$("mods-on").onchange = e => setModsPaused(!e.target.checked);

// ---------------------------------------------------------------- checks
async function runChecks() {
  const b = $("run-checks");
  if (b.disabled) return;
  $("check-list").setAttribute("aria-busy", "true");
  b.disabled = true;
  b.textContent = t("desk.checks.running");
  $("check-list").replaceChildren(h("li", { class: "empty" }, radar(14), " ", t("desk.checks.looking")));
  try {
    const rows = await morse.runChecks();
    if (!Array.isArray(rows)) throw new Error(rows?.error || t("err.generic"));
    $("check-list").replaceChildren(...rows.map(r => h("li", { class: r.ok === false ? "bad" : "" },
      h("span", { class: `mark ${r.ok === true ? "ok" : r.ok === false ? "bad" : "info"}`, "aria-label": r.ok === true ? t("desk.checks.fine") : r.ok === false ? t("desk.checks.fix") : t("desk.checks.info") }, r.ok === true ? "✓" : r.ok === false ? "!" : "i"),
      h("span", { class: "label", text: r.label }),
      h("span", { class: "text", text: r.text }))));
    const bad = rows.filter(r => r.ok === false).length;
    $("checks").classList.toggle("warn", !!bad);
  } catch (e) {
    $("check-list").replaceChildren(h("li", { class: "empty", role: "alert" }, errorText(e)));
  } finally { b.disabled = false; b.textContent = t("desk.checks.run"); $("check-list").setAttribute("aria-busy", "false"); }
}
$("run-checks").onclick = runChecks;

// ---------------------------------------------------------------- settings
// Always open with Morse: the sidebar switch and the first-run switch are
// this one setting (desktop.json autoOpen). Neither stores a choice of its own.
function bindAutoOpen(id) {
  $(id).onchange = async e => {
    const on = e.target.checked;
    const input = e.target;
    actionError("");
    input.disabled = true;
    try {
      const r = await morse.setAutoOpen(on);
      if (r?.error) throw new Error(r.error);
      if (st?.settings) st.settings.autoOpen = on;
      for (const box of ["auto-open", "ob-auto-open"]) $(box).checked = on;
    } catch (e) {
      input.checked = !on;
      if (id === "ob-auto-open") { $("ob-mac-allow").hidden = false; $("ob-mac-allow").textContent = errorText(e); }
      else actionError(errorText(e));
    } finally { input.disabled = false; }
  };
}
bindAutoOpen("auto-open");
bindAutoOpen("ob-auto-open");

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
// In the shape of Zephium's: the name forms out of dots, then
// the AI Morse found by itself (checked once), that apps open with Morse
// (the same switch as the sidebar), how it works, and an app to open.
// Opening an app, Done, or Skip leads to the main window for good. Enter
// goes on; the row at the foot steers.
const STEPS = ["model", "open", "how", "apps"];
let firstChecked = false, obStep = "welcome", obStarted = false;
function obGo(step) {
  if (!step) return;
  if (nativeGuide?.onboarding && step !== "apps") dismissNativeGuide();
  obStep = step;
  const f = $("first");
  f.dataset.step = step;
  f.querySelector(".ob-welcome").inert = step !== "welcome";
  f.querySelector(".ob-bar").hidden = step === "welcome";
  for (const sec of f.querySelectorAll(".ob-step")) sec.hidden = sec.dataset.ob !== step;
  const at = STEPS.indexOf(step);
  [...$("ob-dots").children].forEach((li, i) => { li.className = i < at ? "done" : i === at ? "now" : ""; });
  $("ob-dots").setAttribute("aria-label", t("desk.ob.progress", { at: at + 1, of: STEPS.length }));
  $("ob-progress").textContent = t("desk.ob.progress", { at: at + 1, of: STEPS.length });
  $("ob-back").hidden = at <= 0;
  $("ob-next-label").textContent = t(step === "apps" ? "desk.ob.done" : "desk.ob.continue");
  const head = f.querySelector(`.ob-step[data-ob="${step}"] h1`);
  head?.setAttribute("tabindex", "-1");
  head?.focus({ preventScroll: true });
}
const obNext = () => (obStep === "welcome" ? obBegin() : obStep === "apps" ? finishWelcome() : obGo(STEPS[STEPS.indexOf(obStep) + 1]));
function obBegin() {
  if (obStep === "welcome") obGo("model");
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
// The welcome: the name gathers out of dots, once.
async function obWelcome() {
  if (obStarted) return;
  obStarted = true;
  const f = $("first"), canvas = $("ob-air"), name = $("ob-name");
  const phase = p => { f.dataset.phase = p; };
  phase("forming");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { phase("still"); return; }
  await document.fonts.load(getComputedStyle(name).font).catch(() => {});
  const nr = name.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  const cs = getComputedStyle(name);
  const fit = cr.width / canvas.clientWidth || 1;
  const box = { x: (nr.left - cr.left) / fit, y: (nr.top - cr.top) / fit, w: nr.width / fit, h: nr.height / fit };
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
  if (!first) { if (nativeGuide?.onboarding) dismissNativeGuide(); return; }
  if (!obStarted) { obGo("welcome"); requestAnimationFrame(() => obWelcome()); }
  $("ob-key").replaceChildren(keyCaps(st.keys?.combo || defaultHotkeys(HK_PLATFORM).open));
  const m = st.model, name = modelName(m);
  $("first-key").hidden = !m.none;
  const live = $("first-model");
  if (m.none) live.replaceChildren(h("i", { class: "dot warn" }), h("span", { text: t("desk.first.noModel") }));
  else if (checking) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.checking", { name }) }), radar(14));
  else if (m.check?.ok) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.answered", { name, secs: secs(m.check.ms) }) }), h("span", { class: "badge ready" }, h("i", { class: "dot on" }), t("desk.ready")));
  else if (m.check) live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.noAnswer", { name, error: unprefixed(m.check.error, m.name) }) }), h("i", { class: "dot bad" }));
  else live.replaceChildren(providerMark(m.provider), h("span", { text: t("desk.first.willUse", { name }) }));
  if (!m.none && !m.check && !firstChecked) { firstChecked = true; checkModel(); }
  const apps = st.apps.filter(a => a.canAttach !== false || (platform === "darwin" && a.engine === "native")).slice(0, 5);
  const sig = JSON.stringify([st.appsPending, apps.map(a => [a.id, a.state, a.browser, a.engine, a.icon ? 1 : 0])]);
  if ($("first-apps").dataset.sig === sig) return;
  $("first-apps").dataset.sig = sig;
  if ($("first-apps").contains($("native-setup"))) $("native-setup-home").append($("native-setup"));
  $("first-apps").replaceChildren(...(apps.length ? apps.map(a => {
    const busy = ["opening", "connecting"].includes(a.state);
    const needsControls = platform === "darwin" && (a.browser || a.engine === "native");
    return h("li", { "data-first-app": a.id },
      appIcon(a),
      h("div", {class:"grow"}, h("b", {text:a.name}),
        ...(needsControls ? [h("button", {type:"button",class:"native-link","data-act":"native-controls",disabled:busy,
          onclick:event=>setupNativeForApp(a,event.currentTarget)}, setupIcon("shield"), t(a.browser ? "desk.app.browserControls" : "desk.app.inspectControls"))] : [])),
      h("button", {type:"button",class:"btn first-app-open",disabled:busy,
        onclick:event=>a.canAttach===false ? setupNativeForApp(a,event.currentTarget) : openFirst(a),
        "aria-label":t("desk.app.open")+" "+a.name}, t(busy ? "desk.app.opening" : "desk.app.open",{name:a.name}), setupIcon("arrow")));
  }) : [h("li", { class: "empty", role: "status" }, t(st.appsPending ? "desk.apps.looking" : "desk.first.noApps"))]));
  placeNativeGuide();
}
function firstError(error) {
  obGo("model");
  $("first-model").replaceChildren(h("i", { class: "dot bad" }), h("span", { text: errorText(error) }));
}
async function openFirst(a, answer) {
  try {
    const r = await morse.openApp(a.id, answer);
    if (r?.needsRestart) return askRestart(a, openFirst);
    if (r?.error) throw new Error(r.error);
    await morse.finishWelcome();
  } catch (error) { firstError(error); }
}
async function finishWelcome() {
  $("first-skip").disabled = true;
  $("ob-next").disabled = true;
  try { await morse.finishWelcome(); } catch (error) { firstError(error); }
  finally { $("first-skip").disabled = false; $("ob-next").disabled = false; }
}
$("first-skip").onclick = finishWelcome;
$("first-key-use").onclick = async () => {
  const button = $("first-key-use"), input = $("first-key-input");
  if (!input.value.trim()) { input.focus(); return; }
  button.disabled = true;
  input.disabled = true;
  try {
    const r = await morse.chooseModel("api-key", input.value);
    if (r?.error) throw new Error(r.error);
    input.value = "";
  } catch (error) { firstError(error); }
  finally { button.disabled = false; input.disabled = false; }
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
  btn.setAttribute("aria-label", recording ? t("desk.settings.recording", { esc: "Esc", back: HK_PLATFORM === "mac" ? "⌫" : "Backspace" }) : t("desk.settings.hk", { key: label }));
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
  } catch (error) {
    partial = "";
    shortcutNote = { level: "error", message: errorText(error) };
    renderShortcut();
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
async function installUpdate(event) {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const errorId = $("update").open ? "update-error" : "settings-error";
  showError(errorId, "");
  try {
    const result = await morse.installUpdate();
    if (result?.error) throw new Error(result.error);
  } catch (error) { showError(errorId, errorText(error)); }
  finally { button.disabled = false; }
}
$("update-now").onclick = installUpdate;
$("update-later").onclick = async () => {
  const button = $("update-later");
  if (button.disabled) return;
  button.disabled = true;
  showError("update-error", "");
  try {
    const phase = st.update?.phase;
    if (phase === "ready") {
      const result = await morse.updateLater();
      if (result?.error) throw new Error(result.error);
    }
    st.update = phase === "ready" ? { ...(st.update || {}), phase: "later" } : { phase: "idle" };
    $("update").close();
    render();
  } catch (error) { showError("update-error", errorText(error)); }
  finally { button.disabled = false; }
};
$("update-restart").onclick = installUpdate;

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
  else if (u.phase === "failed") { text = t("desk.update.failed"); level = "bad"; }
  else if (u.phase === "error") { text = t("desk.update.error"); level = "bad"; }
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
$("update").addEventListener("cancel", event => {
  event.preventDefault();
  if (!["downloading", "installing"].includes(st.update?.phase)) $("update-later").click();
});

// ---------------------------------------------------------------- state
function render() {
  if (!st || st.error) return;
  renderFirst();
  renderApps(); renderModel(); renderMods(); renderShortcut(); renderUpdate(); renderUpdateCheck();
  for (const id of ["auto-open", "ob-auto-open"]) if (!$(id).disabled) $(id).checked = !!st.settings.autoOpen;
  $("version").textContent = `Morse ${st.version}`;
  $("settings-version").textContent = t("desk.app.version", { version: st.version });
  document.documentElement.dataset.ready = "1";
}
morse.onChange(next => {
  if (!next || next.error) return;
  // The main process also polls. An unchanged snapshot needs no DOM work.
  if (JSON.stringify(next) === JSON.stringify(st)) return;
  st = next;
  render();
});
st = await morse.state();
render();
loadChoices();
let first = "apps";
try { first = sessionStorage.getItem("tab") || "apps"; } catch {}
show(first);
