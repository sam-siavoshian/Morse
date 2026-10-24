// Empty and error states for the toolbar popup, added on top of popup.js:
// pages Morse can't run on (Chrome's own pages, the Web Store, the PDF viewer,
// files without permission, tabs opened before install), no model connected,
// and user scripts off. Each says what to do in one sentence, with a button
// that does it when it can. popup.html loads this with one marked line.
//
//   ?url=<url>   check this URL instead of the active tab's (screenshots)
//   ?tab=<id>    probe this tab instead of the active one

import { pageSupport, modelMissing } from "./core/onboarding.js";

const q = new URLSearchParams(location.search);
const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabId = q.has("tab") ? Number(q.get("tab")) : active?.id;
const tab = q.has("tab") ? await chrome.tabs.get(tabId).catch(() => null) : active;
const url = q.get("url") || tab?.url || "";

const style = document.createElement("style");
style.textContent = `
  .ps { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 12px; padding: 10px 12px; border-radius: 8px;
    background: var(--m-raised, #18181b); border: 1px solid var(--m-line-strong, #2e2e33); color: var(--m-text, #ededef); font-size: 12px; line-height: 17px; }
  .ps i { flex: none; width: 6px; height: 6px; margin-top: 6px; border-radius: 1.5px; background: var(--m-warn, #e5a54b); }
  .ps div { min-width: 0; }
  .ps button { display: block; margin-top: 8px; height: 28px; padding: 0 10px; border-radius: 6px; font-size: 12px; }
  #go:disabled { opacity: .45; cursor: default; }
  #warn button { display: block; margin-top: 8px; height: 26px; padding: 0 10px; font-size: 12px; }`;
document.head.append(style);

function notice(text, label, run, where = document.querySelector("header")) {
  const el = document.createElement("div");
  el.className = "ps";
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
let why = pageSupport(url, { fileAccess, extensionId: chrome.runtime.id });
// A page that looks fine may still have no Morse: opened before install, a PDF,
// or a page Chrome protects. Ask the page itself (host.js marks it).
if (!why && !q.has("url") && tabId != null && /^(https?|file):/.test(url)) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ morse: document.documentElement.dataset.morseExtension === "1", type: document.contentType }) });
    if (r?.result?.type === "application/pdf") why = { id: "pdf", text: "Morse can't change PDFs in Chrome's PDF viewer. Web pages work." };
    else if (r?.result && !r.result.morse) why = { id: "reload", text: "This tab was open before Morse was installed. Reload it to use Morse here.", action: "reload" };
  } catch {
    why = { id: "blocked", text: "Chrome doesn't let extensions run on this page. Any other website works.", action: "practice" };
  }
}
if (why) {
  const go = document.getElementById("go");
  if (go) go.disabled = true;
  const actions = {
    practice: ["Open the practice page", () => openSetup("practice")],
    "extension-settings": ["Open Morse's settings", () => openSetup("extension-settings")],
    reload: ["Reload this tab", () => { chrome.tabs.reload(tabId); window.close(); }],
  };
  const [label, run] = actions[why.action] || [];
  notice(why.text, label, run).dataset.state = why.id;
}

// ---- no model, user scripts off
const st = await send({ type: "onboarding.status" });
const status = st?.status || {};
if (!why && modelMissing(status, document.getElementById("label")?.textContent)) {
  const details = document.querySelector("details");
  notice("No model connected yet, so Morse uses a demo that only knows a few requests.", "Choose a model", () => {
    if (details) { details.open = true; details.scrollIntoView({ block: "start" }); details.querySelector("select, input")?.focus(); }
  }).dataset.state = "model";
}
const warn = document.getElementById("warn");
if (warn && !warn.querySelector("button")) {
  const b = document.createElement("button");
  b.textContent = "Turn it on";
  b.onclick = () => openSetup("userscripts");
  warn.append(b);
}
// Opened from "Connect a model" (the bar or the welcome page): show model settings.
if ((await chrome.storage.local.get("morse.popupFocus"))["morse.popupFocus"] === "model") {
  await chrome.storage.local.remove("morse.popupFocus");
  const details = document.querySelector("details");
  if (details) details.open = true;
}
