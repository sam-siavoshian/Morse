// First run and help: the pure parts, shared by the runtime (inlined by
// runtime/bundle.js) and the desktop host. No globals, and no imports besides core/i18n.js (the words,
// in the person's language), so node tests can load it as is.
//
//   onboarding state   { coach: "" | "done", tips: { saved, share }, dismissed: { model } }
//   explainError(msg)  a raw error in plain words, with a button to offer, or null
//   plainError(msg)    the one string to show for any error (plain words, never raw jargon)

import { t } from "./i18n.js";

export const ONBOARDING_DEFAULT = { coach: "", tips: { saved: false, share: false }, dismissed: { model: false } };

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

// Generation errors in plain words. `action` names a button the runtime can
// offer: "model" (choose a model in the Morse app).
// The words are message ids (core/locales/en.js), shown in the person's language.
const ERROR_RULES = [
  // Morse's own refusals (core/guard.js draftHarm), said by a host in English: in the person's words here.
  [/^The change would have frozen this page/, "err.harmLoop", ""],
  [/^The change would have replaced this whole page/, "err.harmWipe", ""],
  [/^The change would have reloaded or left this page/, "err.harmNav", ""],
  [/^The change would have hidden this whole page/, "err.harmHide", ""],
  [/^That would have hidden most of the page, so Morse didn't keep it/, "err.collapse", ""],
  [/^The change would delete, buy or send something without asking you first/, "err.unasked", ""],
  [/^This share link is broken\./, "err.shareBroken", ""],
  [/(claude|codex)\b.*(ENOENT|not found|not installed)|(ENOENT|command not found).*(claude|codex)/i,
    "err.notInstalled", "model"],
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
//
// An error Morse wrote for a person (plain: true, like `morse launch` saying
// why an app quit) shows as it is, however long. Whatever plainError hides
// still reaches developers: onHiddenError(fn) is called with the raw message
// (the runtime logs it to the console; the terminal prints it dimmed).
let hiddenTo = null;
export function onHiddenError(fn) { hiddenTo = typeof fn === "function" ? fn : null; }
export function plainError(err) {
  const raw = String((err && err.message) || err || "").trim();
  if (raw && err && typeof err === "object" && err.plain === true) return raw;
  const out = plainWords(raw);
  if (out !== raw && raw && hiddenTo && out !== t("err.stopped")) try { hiddenTo(raw); } catch {}
  return out;
}
function plainWords(raw) {
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
