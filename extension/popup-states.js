// Empty and error states for the toolbar popup, added on top of popup.js:
// pages Morse can't run on (Chrome's own pages, the Web Store, the PDF viewer,
// files without permission, tabs opened before install), no model connected,
// and user scripts off. Each says what to do in one sentence, with a button
// that does it when it can. popup.html loads this with one marked line.
//
//   ?url=<url>   check this URL instead of the active tab's (screenshots)
//   ?tab=<id>    probe this tab instead of the active one

import "./i18n-page.js"; // the person's language (pageSupport's words follow it)
import { t } from "./core/i18n.js";
import { pageSupport, modelMissing } from "./core/onboarding.js";

const q = new URLSearchParams(location.search);
const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabId = q.has("tab") ? Number(q.get("tab")) : active?.id;
const tab = q.has("tab") ? await chrome.tabs.get(tabId).catch(() => null) : active;
const url = q.get("url") || tab?.url || "";

const style = document.createElement("style");
style.textContent = `
  /* the popup's .notice (popup.css), with the radar-square status dot; tokens only */
  .ps { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 12px; color: var(--m-text); line-height: 18px; }
  .ps i { flex: none; width: 6px; height: 6px; margin-top: 6px; border-radius: 1.5px; background: var(--m-warn); }
  .ps div { min-width: 0; }
  .ps button, #warn button { display: block; margin-top: 8px; height: 28px; padding: 0 10px; font-size: var(--m-text-sm); }
  #go:disabled { background: var(--m-raised); border-color: var(--m-line-strong); color: var(--m-signal-1); cursor: default; }
  #go:disabled kbd { color: inherit; }`;
document.head.append(style);

function notice(text, label, run, where = document.querySelector("header")) {
  const el = document.createElement("div");
  el.className = "notice ps";
  el.setAttribute("role", "status");
  el.innerHTML = `<i aria-hidden="true"></i><div><span></span></div>`;
  el.querySelector("span").textContent = text;
  if (label) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = run;
    el.querySelector("div").append(b);
  }
  where.after(el);
  return el;
}
const send = msg => chrome.runtime.sendMessage(msg).catch(() => null);
const openSetup = what => send({ type: "onboarding.open", what }).then(() => window.close());

// ---- can Morse run on this page?
const fileAccess = await new Promise(r => chrome.extension.isAllowedFileSchemeAccess(r));
// The options page is not about a page at all (first-run hook: it said
// "Chrome doesn't let extensions change other extensions' pages" there).
const isOptions = document.body.dataset.page === "options";
let why = isOptions ? null : pageSupport(url, { fileAccess, extensionId: chrome.runtime.id });
// A page that looks fine may still have no Morse: opened before install, a PDF,
// or a page Chrome protects. Ask the page itself (host.js marks it).
if (!why && !q.has("url") && tabId != null && /^(https?|file):/.test(url)) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ morse: document.documentElement.dataset.morseExtension === "1", type: document.contentType }) });
    if (r?.result?.type === "application/pdf") why = { id: "pdf", text: t("page.pdf") };
    else if (r?.result && !r.result.morse) why = { id: "reload", text: t("page.reload"), action: "reload" };
  } catch {
    why = { id: "blocked", text: t("page.blocked"), action: "practice" };
  }
}
if (why) {
  const go = document.getElementById("go");
  if (go) go.disabled = true;
  const actions = {
    practice: [t("popup.openPractice"), () => openSetup("practice")],
    "extension-settings": [t("welcome.openSettings"), () => openSetup("extension-settings")],
    reload: [t("popup.reloadTab"), () => { chrome.tabs.reload(tabId); window.close(); }],
  };
  const [label, run] = actions[why.action] || [];
  notice(why.text, label, run).dataset.state = why.id;
}

// ---- no model, user scripts off
const st = await send({ type: "onboarding.status" });
const status = st?.status || {};
// first-run hook: the button used to look for a <details> the popup doesn't
// have, so it did nothing. The welcome page connects a model in one command.
if (!why && !isOptions && modelMissing(status, document.getElementById("label")?.textContent)) {
  notice(t("popup.noModel"), t("welcome.model.b"), () => openSetup("model")).dataset.state = "model";
}
const warn = document.getElementById("warn");
if (warn && !warn.querySelector("button")) {
  const b = document.createElement("button");
  b.textContent = t("popup.turnItOn");
  b.onclick = () => openSetup("userscripts");
  warn.append(b);
}
// Opened from "Connect a model" (the bar or the welcome page): show model settings.
if ((await chrome.storage.local.get("morse.popupFocus"))["morse.popupFocus"] === "model") {
  await chrome.storage.local.remove("morse.popupFocus");
  document.getElementById("modelbox")?.setAttribute("open", ""); // simplify: Model may be folded (popup.js)
  document.getElementById("model")?.scrollIntoView({ block: "start" });
}
