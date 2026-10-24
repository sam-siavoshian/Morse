// First run and help: the pure parts, shared by the runtime (inlined by
// runtime/bundle.js), the extension (background, popup, welcome page) and the
// desktop host. No imports and no globals, so node tests can load it as is.
//
//   onboarding state   { coach: "" | "done", tips: { saved, share }, dismissed: { model, userScripts } }
//   pageSupport(url)   why Morse can't run on a page, in one plain sentence, or null
//   explainError(msg)  a generation error in plain words, with what to do about it

export const ONBOARDING_DEFAULT = { coach: "", tips: { saved: false, share: false }, dismissed: { model: false, userScripts: false } };

export function normalizeOnboarding(s) {
  const src = s && typeof s === "object" ? s : {};
  const bools = (o, keys) => Object.fromEntries(keys.map(k => [k, !!(o && typeof o === "object" && o[k])]));
  return {
    coach: src.coach === "done" ? "done" : "",
    tips: bools(src.tips, Object.keys(ONBOARDING_DEFAULT.tips)),
    dismissed: bools(src.dismissed, Object.keys(ONBOARDING_DEFAULT.dismissed)),
  };
}

// One level deep, like prefs: { tips: { saved: true } } keeps tips.share.
export function mergeOnboarding(base, patch) {
  const a = normalizeOnboarding(base), out = { ...a };
  for (const [k, v] of Object.entries(patch || {})) out[k] = v && typeof v === "object" && a[k] && typeof a[k] === "object" ? { ...a[k], ...v } : v;
  return normalizeOnboarding(out);
}

// Pages where Chrome doesn't run extension content scripts (or Morse can't
// work). `fileAccess` is chrome.extension.isAllowedFileSchemeAccess();
// `extensionId` is Morse's own id (its welcome page has a practice area).
// Returns { id, text, action? } or null when the page is fine.
export function pageSupport(url, { fileAccess = true, extensionId = "" } = {}) {
  let u;
  try { u = new URL(String(url || "")); } catch { return { id: "blank", text: "Open any website, then press the Morse hotkey there." }; }
  const host = u.hostname.toLowerCase();
  if (u.protocol === "chrome-extension:" && host === extensionId && /\/welcome\.html$/.test(u.pathname)) return null;
  if (u.protocol === "chrome:" && /^(newtab|new-tab-page)$/.test(host) || u.protocol === "about:" || u.href === "chrome-search://local-ntp/local-ntp.html")
    return { id: "newtab", text: "This is a new tab. Open any website, then press the Morse hotkey there.", action: "practice" };
  if (/^(chrome|edge|brave|opera|vivaldi|devtools|chrome-search|chrome-untrusted|view-source):$/.test(u.protocol))
    return { id: "browser", text: "Chrome doesn't let extensions change its own pages. Any website works.", action: "practice" };
  if (u.protocol === "chrome-extension:")
    return { id: "extension", text: "Chrome doesn't let extensions change other extensions' pages. Any website works.", action: "practice" };
  if (host === "chromewebstore.google.com" || host === "chrome.google.com" && u.pathname.startsWith("/webstore"))
    return { id: "webstore", text: "Chrome doesn't let extensions change the Chrome Web Store. Any other site works.", action: "practice" };
  if (u.protocol === "file:" && !fileAccess)
    return { id: "file", text: "To use Morse on files from your computer, turn on “Allow access to file URLs” for Morse.", action: "extension-settings" };
  if (/\.pdf$/i.test(u.pathname) && /^(https?|file):$/.test(u.protocol))
    return { id: "pdf", text: "Morse can't change PDFs in Chrome's PDF viewer. Web pages work." };
  if (!/^(https?|file):$/.test(u.protocol))
    return { id: "other", text: "Morse works on websites (http and https). Open one, then press the Morse hotkey." };
  return null;
}

// Generation errors in plain words. `action` names a button the runtime can
// offer: "userscripts" (open Morse's extension settings), "model" (model
// settings, or `morse setup` on the desktop), "setup" (copy `morse setup`).
const ERROR_RULES = [
  [/user ?scripts|unsafe-eval|content.security.policy|blocks injected scripts/i,
    "This site blocks scripts that Morse adds. Turn on “Allow User Scripts” for Morse, then try again.", "userscripts"],
  [/127\.0\.0\.1:7457|morse helper|helper (is )?not running|helper.*(unreachable|offline)/i,
    "The Morse helper isn't running on this computer. Run morse setup in a terminal to start it.", "setup"],
  [/(claude|codex)\b.*(ENOENT|not found|not installed)|(ENOENT|command not found).*(claude|codex)/i,
    "Claude Code or Codex isn't installed here. Run morse setup in a terminal to pick what Morse uses.", "setup"],
  [/\b401\b|unauthori[sz]ed|invalid.{0,20}(api.?key|token|x-api-key)|incorrect api key|authentication|not logged in|please (log|sign) ?in/i,
    "The model didn't accept the sign-in or API key. Check it in model settings.", "model"],
  [/\b429\b|rate.?limit|quota|overloaded|insufficient.{0,10}(credit|balance)|credit balance/i,
    "The model is busy or out of quota. Wait a minute and try again.", ""],
  [/model.{0,40}(not found|does not exist|unknown)|no such model|\b404\b/i,
    "That model isn't available. Pick another one in model settings.", "model"],
  [/ECONNREFUSED|failed to fetch|fetch failed|networkerror|ENOTFOUND|EAI_AGAIN|socket hang up|could not connect|connection refused/i,
    "Morse couldn't reach the model. Make sure it's running, or choose another one in model settings.", "model"],
  [/timed? ?out|ETIMEDOUT|deadline/i,
    "The model took too long to answer. Try again, or ask for something smaller.", ""],
  [/no ```css or ```js block|did not produce a usable change|unusable/i,
    "The model's answer wasn't a change Morse could apply. Try saying it another way.", ""],
  [/TypeError|ReferenceError|SyntaxError|is not a function|is not defined|Cannot read prop|null \(reading/i,
    "The code the model wrote didn't work on this page. Try again, or describe it differently.", ""],
];
export function explainError(message) {
  const m = String(message || "");
  if (!m || /^stopped$/i.test(m)) return null;
  for (const [re, text, action] of ERROR_RULES) if (re.test(m)) return { text, action };
  return null;
}

// "No model connected" from what a host reports, or from its label when it
// reports nothing else (the demo model's label says so).
export function modelMissing(status, label) {
  if (status && status.model && typeof status.model.connected === "boolean") return !status.model.connected;
  return /\bdemo model\b|no (local )?model|not set up|not connected/i.test(String(label || ""));
}
