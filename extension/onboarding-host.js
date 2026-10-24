// First run and help, extension side. Imported by background.js, which routes
// ONBOARDING_REQUESTS here and asks Practice before running mod code.
//
//   - opens the welcome page on install
//   - progress in chrome.storage.local "morse.onboarding" (see core/onboarding.js)
//   - onboarding.get / .set / .open for the runtime; "onboarding.status" for
//     the popup and the welcome page (runtime.sendMessage)
//   - Practice: the welcome page's practice area is a sandboxed frame (it can
//     run mod code; extension pages can't), so mod code for that tab goes
//     through the welcome page instead of chrome.userScripts
//   - the keyboard command on a page Chrome keeps extensions out of opens the
//     popup, which says why

import * as providers from "./core/providers.js"; // namespace import: a renamed export can't break the worker
import { normalizeOnboarding, mergeOnboarding, pageSupport } from "./core/onboarding.js";

export const ONBOARDING_REQUESTS = new Set(["onboarding.get", "onboarding.set", "onboarding.open"]);
const KEY = "morse.onboarding";
const WELCOME = "welcome.html";

const local = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
export const loadOnboarding = async () => normalizeOnboarding(await local(KEY, {}));
export async function saveOnboarding(patch) {
  const next = mergeOnboarding(await loadOnboarding(), patch);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

function userScriptsOn() {
  try { chrome.userScripts.getScripts; return !!chrome.userScripts?.execute; } catch { return false; }
}

// Whether a real model is set up. The demo model doesn't count.
let model = null, modelAt = 0;
async function modelStatus() {
  if (model && Date.now() - modelAt < 15000) return model;
  try {
    const saved = await local("settings", {});
    const s = providers.resolveSettings ? await providers.resolveSettings({ ...providers.DEFAULT_SETTINGS, ...saved }) : saved;
    model = { connected: !!s.provider && s.provider !== "demo", provider: s.provider || "", label: providers.settingsLabel ? providers.settingsLabel(s) : "" };
  } catch { model = { connected: false, provider: "", label: "" }; }
  modelAt = Date.now();
  return model;
}
chrome.storage.onChanged.addListener(c => { if (c.settings) model = null; });

export async function onboardingStatus() {
  const mods = await local("mods", {});
  return { mode: "extension", userScripts: userScriptsOn(), model: await modelStatus(), mods: Object.keys(mods).length };
}

const EXT_SETTINGS = () => `chrome://extensions/?id=${chrome.runtime.id}`;
export async function openSetup(what) {
  if (what === "userscripts" || what === "extension-settings") return chrome.tabs.create({ url: EXT_SETTINGS() }).then(() => ({ ok: true }));
  if (what === "shortcuts") return chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).then(() => ({ ok: true }));
  if (what === "model") {
    // The popup holds model settings; it opens that section when this flag is set.
    await chrome.storage.local.set({ "morse.popupFocus": "model" });
    try { await chrome.action.openPopup(); return { ok: true }; } catch {}
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${WELCOME}#model`) });
    return { ok: true };
  }
  if (what === "practice" || what === "welcome") {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${WELCOME}${what === "practice" ? "#practice" : ""}`) });
    return { ok: true };
  }
  throw new Error(`Unknown setup page ${what}`);
}

export async function handleOnboarding(msg) {
  switch (msg.type) {
    case "onboarding.get": return { state: await loadOnboarding(), status: await onboardingStatus() };
    case "onboarding.set": return saveOnboarding(msg.patch);
    case "onboarding.open": return openSetup(msg.what);
  }
  throw new Error(`Unknown request ${msg.type}`);
}

// Extension pages (popup, welcome) ask through runtime.sendMessage.
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("onboarding.")) return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  (async () => {
    if (msg.type === "onboarding.status") return { state: await loadOnboarding(), status: await onboardingStatus() };
    return handleOnboarding(msg);
  })().then(respond, e => respond({ error: e.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") return chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME) });
  // Updating from a version without onboarding: people who already have mods know the ropes.
  if (reason === "update" && !(await local(KEY, null)) && Object.keys(await local("mods", {})).length) await saveOnboarding({ coach: "done", tips: { saved: true } });
});

// ---- the practice area: tabs showing welcome.html, keyed by tab id
const practice = new Map();
const waiting = new Map();
let evalSeq = 0;
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse-practice") return;
  const tabId = port.sender?.tab?.id;
  if (tabId == null || port.sender.url?.split("#")[0] !== chrome.runtime.getURL(WELCOME)) return port.disconnect();
  practice.set(tabId, port);
  port.onMessage.addListener(m => {
    const done = waiting.get(m?.evalReply);
    if (done) { waiting.delete(m.evalReply); done(m.result); }
  });
  port.onDisconnect.addListener(() => { if (practice.get(tabId) === port) practice.delete(tabId); });
});
export const Practice = {
  has: tabId => practice.has(tabId),
  // Runs code in the practice frame; resolves with what it evaluated to.
  exec(tabId, code) {
    return new Promise(resolve => {
      const id = ++evalSeq;
      waiting.set(id, resolve);
      practice.get(tabId).postMessage({ eval: code, id });
      setTimeout(() => { if (waiting.delete(id)) resolve({ ok: false, error: "The practice area didn't answer" }); }, 5000);
    });
  },
};

// The command (Ctrl+Shift+Space) where content scripts can't run: open the
// popup, which says why. On the welcome page, it opens the practice bar.
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== "toggle-morse") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (practice.has(tab.id)) return practice.get(tab.id).postMessage({ toggle: true });
  const fileAccess = await new Promise(r => chrome.extension.isAllowedFileSchemeAccess(r));
  if (pageSupport(tab.url, { fileAccess, extensionId: chrome.runtime.id })) chrome.action.openPopup().catch(() => {});
});
