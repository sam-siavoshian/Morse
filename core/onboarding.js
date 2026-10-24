// First run and help: the pure parts, shared by the runtime (inlined by
// runtime/bundle.js), the extension (background, popup, welcome page) and the
// desktop host. No globals, and no imports besides core/i18n.js (the words,
// in the person's language), so node tests can load it as is.
//
//   onboarding state   { coach: "" | "done", tips: { saved, share }, dismissed: { model, userScripts } }
//   pageSupport(url)   why Morse can't run on a page, in one plain sentence, or null
//   explainError(msg)  a raw error in plain words, with a button to offer, or null
//   plainError(msg)    the one string to show for any error (plain words, never raw jargon)

import { t } from "./i18n.js";

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
  try { u = new URL(String(url || "")); } catch { return { id: "blank", text: t("page.blank") }; }
  const host = u.hostname.toLowerCase();
  if (u.protocol === "chrome-extension:" && host === extensionId && /\/welcome\.html$/.test(u.pathname)) return null;
  if (u.protocol === "chrome:" && /^(newtab|new-tab-page)$/.test(host) || u.protocol === "about:" || u.href === "chrome-search://local-ntp/local-ntp.html")
    return { id: "newtab", text: t("page.newtab"), action: "practice" };
  if (/^(chrome|edge|brave|opera|vivaldi|devtools|chrome-search|chrome-untrusted|view-source):$/.test(u.protocol))
    return { id: "browser", text: t("page.browser"), action: "practice" };
  if (u.protocol === "chrome-extension:")
    return { id: "extension", text: t("page.extension"), action: "practice" };
  if (host === "chromewebstore.google.com" || host === "chrome.google.com" && u.pathname.startsWith("/webstore"))
    return { id: "webstore", text: t("page.webstore"), action: "practice" };
  if (u.protocol === "file:" && !fileAccess)
    return { id: "file", text: t("page.file"), action: "extension-settings" };
  if (/\.pdf$/i.test(u.pathname) && /^(https?|file):$/.test(u.protocol))
    return { id: "pdf", text: t("page.pdf") };
  if (!/^(https?|file):$/.test(u.protocol))
    return { id: "other", text: t("page.other") };
  return null;
}

// Generation errors in plain words. `action` names a button the runtime can
// offer: "userscripts" (open Morse's extension settings), "model" (model
// settings, or `morse setup` on the desktop), "setup" (copy `morse setup`).
// The words are message ids (core/locales/en.js), shown in the person's language.
const ERROR_RULES = [
  // Morse's own refusals (core/guard.js draftHarm), said by a host in English: in the person's words here.
  [/^The change would have frozen this page/, "err.harmLoop", ""],
  [/^The change would have replaced this whole page/, "err.harmWipe", ""],
  [/^The change would have reloaded or left this page/, "err.harmNav", ""],
  [/^The change would have hidden this whole page/, "err.harmHide", ""],
  [/user ?scripts|unsafe-eval|content.security.policy|blocks injected scripts/i,
    "err.userScripts", "userscripts"],
  [/127\.0\.0\.1:7457|can't reach the morse helper|helper (is )?not running|helper.*(unreachable|offline)/i,
    "err.helper", "setup"],
  [/(claude|codex)\b.*(ENOENT|not found|not installed)|(ENOENT|command not found).*(claude|codex)/i,
    "err.notInstalled", "setup"],
  [/\b401\b|unauthori[sz]ed|invalid.{0,20}(api.?key|token|x-api-key)|incorrect api key|authentication|not logged in|please (log|sign) ?in/i,
    "err.signIn", "model"],
  [/\b429\b|rate.?limit|quota|overloaded|insufficient.{0,10}(credit|balance)|credit balance/i,
    "err.busy", ""],
  [/\b(500|502|503|504|529)\b|internal server error|bad gateway|service unavailable/i,
    "err.server", ""],
  [/model.{0,40}(not found|does not exist|unknown)|no such model|\b404\b/i,
    "err.noModel", "model"],
  [/could not establish connection|receiving end does not exist|extension context invalidated|message port closed/i,
    "err.lostPage", ""],
  [/ECONNREFUSED|ECONNRESET|failed to fetch|fetch failed|connection error|networkerror|network request failed|ERR_(CONNECTION|NAME_NOT_RESOLVED|INTERNET|NETWORK)|ENOTFOUND|EAI_AGAIN|socket hang up|could not connect|connection refused/i,
    "err.unreachable", "model"],
  [/timed? ?out|ETIMEDOUT|deadline/i,
    "err.slow", ""],
  [/no ```css or ```js block|did not produce a usable change|unusable/i,
    "err.noChange", ""],
  [/nothing on the page changed/i,
    "err.nothingVisible", ""],
  [/^no result$/i,
    "err.didntRun", ""],
  [/^Unexpected end of JSON|is not valid JSON|JSON\.parse/i,
    "err.unreadable", ""],
  [/TypeError|ReferenceError|SyntaxError|is not a function|is not defined|Cannot read prop|Cannot set prop|is not iterable|is not a valid selector|Failed to execute|null \(reading/i,
    "err.badCode", ""],
];

// Words and shapes that only make sense to a developer. A raw message with
// any of these never reaches a person as is (plainError).
const TECHNICAL = /\b[A-Z][A-Za-z]*(Error|Exception)\b|\bE[A-Z]{4,}\b|=>|[{}]|\b(undefined|null|NaN|stack|selector|DOM|CDP|userScripts|service worker|runtime|stdout|stderr|exit code|errno|spawn|JSON|HTTP|status \d{3})\b/;
export function explainError(message) {
  const m = String(message || "");
  if (!m || /^stopped$/i.test(m)) return null;
  for (const [re, id, action] of ERROR_RULES) if (re.test(m)) return { text: t(id), action, id };
  return null;
}

// The one string to show for any error, in the bar, toasts, the popup and the
// install page: explainError's sentence when there is one, Morse's own
// message when it already reads well, and "Something went wrong" for a raw
// technical message nobody could act on. Never an empty line.
export function plainError(err) {
  const raw = String((err && err.message) || err || "").trim();
  if (!raw) return t("err.generic");
  if (/^(stopped|aborted|AbortError.*|The (user|operation) aborted.*|signal is aborted.*)$/i.test(raw)) return t("err.stopped");
  const known = explainError(raw)?.text;
  if (known) return known;
  if (TECHNICAL.test(raw) || raw.length > 200) return t("err.generic");
  return raw;
}

// "No model connected" from what a host reports, or from its label when it
// reports nothing else (the demo model's label says so).
export function modelMissing(status, label) {
  if (status && status.model && typeof status.model.connected === "boolean") return !status.model.connected;
  return /\bdemo model\b|no (local )?model|not set up|not connected/i.test(String(label || ""));
}
