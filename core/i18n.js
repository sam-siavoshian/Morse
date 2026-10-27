// Morse's words in the person's language. Message catalogs keyed by short
// ids (core/locales/<lang>.js), with {placeholders} and simple plurals.
// English (core/locales/en.js) is the source; a key a language doesn't have
// falls back to English. docs/i18n.md says how to add or improve a language.
//
//   t("panel.deleted", { title })          "Deleted “Sleep timer”"
//   t("panel.search", { n: 7 })            plural: { one: "…", other: "…" }, picked by n
//   setLanguage(await loadLanguage(pickLanguage(navigator.languages)))   or languageFromEnv(process.env)
//   translatePage(document)                data-i18n / data-i18n-html / data-i18n-attr
//
// Only English is built in. Another language's words are loaded when that
// language is chosen (loadLanguage), from where the caller says
// (setLanguageLoader): core/languages.js reads core/locales/ (the CLI, the
// desktop connector, the website), and the in-page runtime asks its
// host (runtime/src/04-i18n.js). So no build carries every language.
//
// No dependencies besides the English catalog, which is plain data:
// runtime/bundle.js inlines this file and it into the in-page runtime; the
// desktop app, the share page and the CLI import it as a module.

import en from "./locales/en.js";

// The order Settings lists them in; each name is in its own language.
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "zh-CN", name: "简体中文" },
  { code: "ja", name: "日本語" },
  { code: "fa", name: "فارسی" },
  { code: "ar", name: "العربية" },
];
// The words of each language that is here: English always, another one once
// loadLanguage() or addLanguage() has brought it.
export const CATALOGS = { en };
const RTL_LANGS = ["fa", "ar"];

let current = "en";
let loader = null; // code -> that language's words, or a promise of them
const loading = {};

// A language tag ("es-MX", "pt", "zh-Hans-CN", "fa_IR.UTF-8") to one Morse
// has, or "" when there is none. Traditional Chinese is not Simplified.
export function matchLanguage(tag) {
  const raw = String(tag || "").trim().replace(/[.@].*$/, "").replace(/_/g, "-");
  if (!raw || /^(c|posix)$/i.test(raw)) return "";
  const [base, ...rest] = raw.toLowerCase().split("-");
  if (base === "zh") return rest.some(p => p === "hant" || p === "tw" || p === "hk" || p === "mo") ? "" : "zh-CN";
  if (base === "pt") return "pt-BR"; // the one Portuguese Morse has
  return LANGUAGES.find(l => l.code === base)?.code || "";
}
// The first of a list of tags (navigator.languages) that Morse has, else English.
export function pickLanguage(tags) {
  for (const tag of [].concat(tags || [])) { const m = matchLanguage(tag); if (m) return m; }
  return "en";
}
// The terminal's language: MORSE_LANG, else LANGUAGE (a list, like gettext)
// and LC_ALL, LC_MESSAGES or LANG. "C" or "POSIX" (a plain shell, CI) is English.
export function languageFromEnv(env = {}) {
  if (env.MORSE_LANG) return pickLanguage(env.MORSE_LANG);
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  if (/^(C|POSIX)([.@]|$)/i.test(locale) || (!locale && !env.LANGUAGE)) return "en";
  return pickLanguage([...(env.LANGUAGE ? env.LANGUAGE.split(":") : []), locale]);
}

// Where the words of the languages besides English come from.
export function setLanguageLoader(fn) { loader = typeof fn === "function" ? fn : null; }
// Keeps a language's words that came some other way (a host's reply).
export function addLanguage(code, words) {
  if (code !== "en" && LANGUAGES.some(l => l.code === code) && words && typeof words === "object" && !Array.isArray(words)) CATALOGS[code] = words;
  return !!CATALOGS[code];
}
// Brings a language's words if they aren't here yet. Resolves with the
// language Morse can show now: the one asked for, or English when Morse has
// no such language or its words couldn't be read (a later call tries again).
export function loadLanguage(code) {
  const lang = matchLanguage(code) || "en";
  if (CATALOGS[lang]) return Promise.resolve(lang);
  if (!loader) return Promise.resolve("en");
  return (loading[lang] ||= Promise.resolve()
    .then(() => loader(lang))
    .then(words => addLanguage(lang, words), () => false)
    .then(ok => { delete loading[lang]; return ok ? lang : "en"; }));
}

// Shows a language whose words are here; any other shows English (bring it
// first with loadLanguage).
export function setLanguage(code) {
  const lang = matchLanguage(code) || "en";
  current = CATALOGS[lang] ? lang : "en";
  return current;
}
export const getLanguage = () => current;
export const isRtl = (code = current) => RTL_LANGS.includes(String(code).split("-")[0]);
export const languageName = code => LANGUAGES.find(l => l.code === code)?.name || code;
// The English name of a language, for the model ("Answer in Japanese").
const ENGLISH_NAMES = { en: "English", es: "Spanish", de: "German", fr: "French", "pt-BR": "Brazilian Portuguese", "zh-CN": "Simplified Chinese", ja: "Japanese", fa: "Persian", ar: "Arabic" };
export const englishName = (code = current) => ENGLISH_NAMES[code] || "English";

function pluralForm(msg, n, lang) {
  let cat = "other";
  try { cat = new Intl.PluralRules(lang).select(n); } catch {}
  if (n === 0 && msg.zero != null) return msg.zero;
  return msg[cat] ?? msg.other ?? msg.one ?? "";
}

// The message for `id` in the current language (English when it has none),
// with {name} filled from `vars`. A plural message is { one, other, … }
// (Intl.PluralRules categories) picked by vars.n. A var that is missing
// leaves its {name} in place, so a mistake shows instead of hiding.
export function t(id, vars = {}, lang = current) {
  const cat = CATALOGS[lang] || en;
  let msg = cat[id] ?? en[id];
  if (msg == null) return id;
  if (typeof msg === "object") msg = pluralForm(msg, Number(vars.n) || 0, cat[id] != null ? lang : "en");
  return String(msg).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}
export const hasMessage = (id, lang = current) => (CATALOGS[lang] || {})[id] != null;

// Extension and share pages: elements say which message they show.
//   data-i18n="id"             text
//   data-i18n-html="id"        markup from the catalog (only tags it already had)
//   data-i18n-attr="placeholder:id;title:id2"
// The English stays in the page itself, so it reads fine before this runs.
export function translatePage(doc, lang = current) {
  if (!doc) return;
  const html = doc.documentElement;
  if (html) { html.lang = lang; html.dir = isRtl(lang) ? "rtl" : "ltr"; }
  for (const el of doc.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n, {}, lang);
  for (const el of doc.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml, {}, lang);
  for (const el of doc.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, id] = pair.split(":").map(s => s.trim());
      if (attr && id) el.setAttribute(attr, t(id, {}, lang));
    }
  }
}
