// The overlay speaks the person's language: Settings → Language, or this
// computer's (navigator.languages) for "Same as my computer". t() and the
// catalogs are core/i18n.js, inlined by runtime/bundle.js. Persian and Arabic
// lay the overlay out right to left: the shadow host gets dir="rtl", the CSS
// uses logical sides (margin-inline-start…), key caps stay left to right.
//
// Words set once (aria-labels, titles, placeholders) are bound with tBind(),
// so a language change repaints them; everything rendered later calls t().

const systemLanguage = () => pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
setLanguage(systemLanguage()); // before 10-dom.js builds the overlay
const langBindings = [];
const langSubs = new Set(); // repaint what is showing (bar hint, panel)

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
function applyLanguage() {
  const before = getLanguage();
  const lang = setLanguage(PREFS.language || systemLanguage());
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
queueMicrotask(applyLanguage); // the host exists once the whole bundle has run
