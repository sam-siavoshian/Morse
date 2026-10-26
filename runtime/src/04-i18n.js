// The overlay speaks the person's language: Settings → Language, or this
// computer's (navigator.languages) for "Same as my computer". t() is
// core/i18n.js, inlined by runtime/bundle.js with English only: another
// language's words come from the host ("i18n.words": the extension's package,
// or core/locales/ on the computer) when it is chosen. The bar opens without
// waiting for them (97-boot.js); showLanguage swaps the words when they arrive.
// Persian and Arabic lay the overlay out right to left: the shadow
// host gets dir="rtl", the CSS uses logical sides (margin-inline-start…), key
// caps stay left to right.
//
// Words set once (aria-labels, titles, placeholders) are bound with tBind(),
// so a language change repaints them; everything rendered later calls t().

const systemLanguage = () => pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
setLanguageLoader(lang => call("i18n.words", { lang })); // the host answers with the words, or null
setLanguage(systemLanguage()); // before 10-dom.js builds the overlay (English until its words are here)
const langBindings = [];
const langSubs = new Set(); // repaint what is showing (bar hint, panel)
let languageReady = null; // while the words of the language asked for are on their way (97-boot.js waits for them)
let langAsked = 0;

function paintBinding(b) {
  const text = t(b.id, typeof b.vars === "function" ? b.vars() : b.vars);
  if (b.attr === "text") b.node.textContent = text;
  else b.node.setAttribute(b.attr, text);
}
function tBind(node, attr, id, vars) {
  const b = { node, attr, id, vars };
  langBindings.push(b);
  paintBinding(b);
  return node;
}
// A language whose words are here shows at once; another one once the host
// has sent them (until then the overlay keeps the language it has). If they
// can't be had, English.
function applyLanguage(p = PREFS) {
  const ask = ++langAsked, want = matchLanguage(p.language || systemLanguage()) || "en";
  if (CATALOGS[want]) { languageReady = null; showLanguage(want); return; }
  const ready = languageReady = loadLanguage(want).then(lang => {
    if (ask !== langAsked) return;
    languageReady = null;
    showLanguage(lang);
  });
  return ready;
}
function showLanguage(want) {
  const before = getLanguage();
  const lang = setLanguage(want);
  const dir = isRtl(lang) ? "rtl" : "ltr";
  hostEl.dir = dir;
  hostEl.lang = lang;
  hostEl.style.setProperty("direction", dir, "important");
  if (lang === before && langBindings.painted) return;
  langBindings.painted = true;
  langBindings.forEach(paintBinding);
  langSubs.forEach(fn => { try { fn(lang); } catch (e) { console.warn("[morse]", e); } });
}
prefsSubs.add(applyLanguage);
// The host exists once the whole bundle has run; the boot's settings are the
// ones 97-boot.js adopts, so their language is the one to fetch.
queueMicrotask(() => applyLanguage(B.prefs?.() || PREFS));
