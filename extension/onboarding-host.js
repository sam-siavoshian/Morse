// First run and help, extension side. Imported by background.js, which routes
// ONBOARDING_REQUESTS here and asks Practice whether a tab is the practice area.
//
//   - opens the welcome page on install
//   - progress in chrome.storage.local "morse.onboarding" (see core/onboarding.js)
//   - onboarding.get / .set / .open for the runtime; "onboarding.status" for
//     the popup and the welcome page (runtime.sendMessage)
//   - Practice: the tabs showing the welcome page's practice area, a
//     sandboxed sample article where changes show their CSS only (mod code
//     never runs there; background.js cantRun)
//   - the keyboard command on a page Chrome keeps extensions out of opens the
//     popup, which says why

import * as providers from "../core/providers.js"; // namespace import: a renamed export can't break the worker
import { normalizeOnboarding, mergeOnboarding, pageSupport } from "../core/onboarding.js";

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
// background.js registers its own backend lookup (helper / API key) here,
// so onboarding and generation always agree on what's connected.
let model = null, modelAt = 0, resolveModel = null;
export function setModelResolver(fn) { resolveModel = fn; model = null; }
async function modelStatus() {
  if (model && Date.now() - modelAt < 15000) return model;
  if (resolveModel) {
    try { model = await resolveModel(); } catch { model = { connected: false, provider: "", label: "" }; }
    modelAt = Date.now();
    return model;
  }
  try {
    const saved = await local("settings", {});
    const s = { ...providers.DEFAULT_SETTINGS, ...saved };
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
    // first-run hook: the welcome page connects a model with one command (and
    // pairs by itself), so "Connect a model" goes there, to a tab already open if any.
    const base = chrome.runtime.getURL(WELCOME), url = `${base}#model`;
    const open = (await chrome.tabs.query({})).find(t => t.url?.startsWith(base));
    if (open) await chrome.tabs.update(open.id, { active: true, url });
    else await chrome.tabs.create({ url });
    return { ok: true };
  }
  if (what === "practice" || what === "welcome") {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${WELCOME}${what === "practice" ? "#practice" : ""}`) });
    return { ok: true };
  }
  throw new Error(`Unknown setup page ${what}`);
}

// The practice area works before a model is connected: the sample answers
// below (core/demo.js's replies for the practice page's markup), clearly
// called sample answers on the welcome page. Anything else asks for a model.
const SAMPLE = /\b(read|reading|clean|clutter|ads?|distract\w*|word|count)\b/i;
export const practiceSample = request => SAMPLE.test(String(request || ""));
export const SAMPLE_ONLY = "The practice page only knows “make this easier to read” and “add a word count”. Connect a model for more.";

// `practice`: the request comes from the welcome page's practice area.
export async function handleOnboarding(msg, { practice = false } = {}) {
  switch (msg.type) {
    case "onboarding.get": {
      const status = await onboardingStatus();
      if (practice && !status.model.connected) status.sample = true; // first-run hook: no "connect a model" note over the sample answers
      return { state: await loadOnboarding(), status };
    }
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
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse-practice") return;
  const tabId = port.sender?.tab?.id;
  if (tabId == null || port.sender.url?.split("#")[0] !== chrome.runtime.getURL(WELCOME)) return port.disconnect();
  practice.set(tabId, port);
  port.onDisconnect.addListener(() => { if (practice.get(tabId) === port) practice.delete(tabId); });
});
export const Practice = {
  has: tabId => practice.has(tabId),
};

// The command (Ctrl+Shift+Y) where content scripts can't run: open the
// popup, which says why. On the welcome page, it opens the practice bar.
// It must differ from every platform's default Open Morse hotkey (core/hotkeys.js):
// Chrome takes a command's keys before the page, so the bar would never see them
// and hold-to-talk could not work.
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== "toggle-morse") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (practice.has(tab.id)) return practice.get(tab.id).postMessage({ toggle: true });
  const fileAccess = await new Promise(r => chrome.extension.isAllowedFileSchemeAccess(r));
  if (pageSupport(tab.url, { fileAccess, extensionId: chrome.runtime.id })) chrome.action.openPopup().catch(() => {});
});
