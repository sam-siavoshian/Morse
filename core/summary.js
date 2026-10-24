// What a mod does, in plain words, for people deciding whether to install it.
//
// This is simple pattern matching over the mod's CSS and JS, not a proof. It
// errs on the side of mentioning things: a word in a string or a comment can
// add a line, and nothing is ever left out because it looked harmless. Code
// that builds itself while it runs (eval, encoded strings, window["..."])
// gets its own note, because then reading the code isn't enough.
//
// Pure: the share page imports it, the hosts import it, and
// runtime/bundle.js inlines it into the in-app runtime (so no imports besides
// core/i18n.js, which the bundle inlines first). The words are in the
// person's language: message ids "sum.<id>" and "sum.<id>.detail".
import { t, getLanguage } from "./i18n.js";

// One line of a summary: its words are read when shown, in the current language.
function summaryItem(id, detail = false) {
  const item = { id };
  Object.defineProperty(item, "text", { get: () => t(`sum.${id}`), enumerable: true });
  if (detail) Object.defineProperty(item, "detail", { get: () => t(`sum.${id}.detail`), enumerable: true });
  return item;
}
// Every line a summary can contain, in the order they're shown.
export const SUMMARY_ITEMS = [
  summaryItem("looks"),
  summaryItem("hides"),
  summaryItem("text"),
  summaryItem("buttons"),
  summaryItem("adds"),
  summaryItem("clicks"),
  summaryItem("typing", true),
  summaryItem("acts"),
  summaryItem("ongoing", true),
  summaryItem("storage", true),
  summaryItem("cookies", true),
  summaryItem("clipboard", true),
  summaryItem("navigates"),
  summaryItem("loads", true),
  summaryItem("network", true),
  summaryItem("device", true),
  summaryItem("notify"),
  summaryItem("dynamic", true),
  summaryItem("code", true),
];

// The ones that get a clearly worded note above the Install button.
export const SUMMARY_NOTES = {
  get network() { return t("sum.note.network"); },
  get typing() { return t("sum.note.typing"); },
  get dynamic() { return t("sum.note.dynamic"); },
};

const TYPING_EVENTS = /^(input|beforeinput|change|key(down|up|press)|paste|cut|copy|composition(start|update|end)|submit|formdata|select|selectionchange)$/i;
const POINTER_EVENTS = /^(click|dblclick|auxclick|contextmenu|mouse\w*|pointer\w*|touch\w*|wheel|scroll\w*|drag\w*|drop|focus\w*|blur|hover)$/i;

const has = (src, re) => re.test(src);

// Names the mod gives to things it makes itself: `const label = morse.el(...)`,
// `let b = document.createElement(...)`. Changing the words on, or removing,
// something the mod added doesn't change the page, so those don't count as
// "Hides or removes parts of the page" or "Changes text on the page".
// A name that is also used for anything else (a callback's parameter, another
// assignment) is left out, so a page element never hides behind it.
function ownNames(js) {
  const made = new Set();
  for (const m of js.matchAll(/(?:\b(?:const|let|var)\s+)?\b([A-Za-z_$][\w$]*)\s*=\s*(?:morse\.el|document\.createElement(?:NS)?|createElement(?:NS)?)\s*\(/g)) made.add(m[1]);
  for (const name of [...made]) {
    const n = name.replace(/\$/g, "\\$");
    const assigns = [...js.matchAll(new RegExp(`(?<![\\w$.])${n}\\s*=(?![=>])\\s*(?=([\\s\\S]{0,40}))`, "g"))];
    const other = assigns.some(a => !/^(?:morse\.el|document\.createElement(?:NS)?|createElement(?:NS)?)\s*\(/.test(a[1]));
    const param = new RegExp(`(?<![\\w$.])${n}\\s*=>|\\(([^()]*[,\\s(])?${n}\\s*(?:,[^()]*)?\\)\\s*(?:=>|\\{)|\\bfunction\\b[^(]*\\(([^()]*[,\\s])?${n}\\b|\\b(?:for|catch)\\s*\\(\\s*(?:const|let|var)?\\s*${n}\\b`).test(js);
    if (other || param) made.delete(name);
  }
  return made;
}

// Does the code do this to the page, and not only to things it made itself?
// `re` is global; its `who` group, when it matches, is the name the action is
// done on. No name (a chain like a.b.remove(), `this`, a CSS string) counts.
function onPage(js, re, own) {
  for (const m of js.matchAll(re)) if (!m.groups?.who || !own.has(m.groups.who)) return true;
  return false;
}
const WHO = String.raw`(?:(?<![\w$.\])])(?<who>[A-Za-z_$][\w$]*)\s*\.\s*)?`;
const HIDES_JS = new RegExp(WHO + "(?:" + [
  String.raw`remove\s*\(\s*\)`,
  String.raw`removeChild\s*\(`,
  // hidden = anything but a plain false: `el.hidden = isDone` hides too
  String.raw`(?<![-\w])hidden\s*=(?!=)(?!\s*(?:false|!1|0)\b)`,
  // display = "none", or a choice that can be "none": `x ? "none" : ""`
  String.raw`style\s*\.\s*display\s*=(?!=)[^;\n]*?["'\`]none["'\`]`,
  String.raw`style\s*\.\s*visibility\s*=(?!=)[^;\n]*?["'\`]hidden["'\`]`,
  String.raw`style\s*\.\s*setProperty\s*\(\s*["'\`](?:display["'\`][^)]*none|visibility["'\`][^)]*hidden)`,
  String.raw`display\s*:\s*["'\`]?none`,
  String.raw`visibility\s*:\s*["'\`]?hidden`,
  String.raw`replaceChildren\s*\(\s*\)`,
  String.raw`(?:setAttribute|toggleAttribute)\s*\(\s*["'\`]hidden`,
].join("|") + ")", "gi");
const ACTS_JS = new RegExp(WHO + String.raw`(?:click\s*\(\s*\)|submit\s*\(\s*\)|requestSubmit\s*\()`, "g");
const TEXT_JS = new RegExp(WHO + String.raw`(?:textContent|innerText|nodeValue|outerText|placeholder|innerHTML|outerHTML)\s*\+?=(?!=)`, "g");

// Event names the code listens for: addEventListener("x"), morse.on(t, "x"),
// morse.el(..., { on: { x } }), el.onx = ... Quoted words right after a
// listener call are taken as event names when they look like one.
function eventNames(js) {
  const out = new Set();
  for (const m of js.matchAll(/(?:addEventListener|\.on|\bon)\s*\(([\s\S]{0,200})/g)) {
    for (const q of m[1].matchAll(/["'`]([a-z][a-z-]*)["'`]/gi)) out.add(q[1].toLowerCase());
  }
  for (const m of js.matchAll(/\bon\s*:\s*\{([^}]{0,400})\}/g)) {
    for (const k of m[1].matchAll(/["']?([a-z]+)["']?\s*(?::|\()/gi)) out.add(k[1].toLowerCase());
  }
  for (const m of js.matchAll(/\.on([a-z]+)\s*=(?!=)/gi)) out.add(m[1].toLowerCase());
  for (const m of js.matchAll(/\bon([a-z]+)\s*=\s*["'`]/gi)) out.add(m[1].toLowerCase()); // inline HTML handlers
  return out;
}

// -> { items: [{ id, text, detail }], notes: [{ id, text }], empty }
export function summarizeMod(mod) {
  const css = String(mod?.css || "");
  const js = String(mod?.js || "");
  const found = new Set();
  const add = id => found.add(id);

  // ---- CSS
  if (css.trim()) {
    add("looks");
    if (has(css, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|\[hidden\]/i)) add("hides");
    if (has(css, /content\s*:\s*(["'])(?!\1)/i) || has(css, /content\s*:\s*(attr|counter)\(/i)) add("text");
    if (has(css, /url\(\s*["']?\s*(https?:)?\/\//i) || has(css, /@import/i) || has(css, /image-set\(\s*["']?(https?:)?\/\//i)) add("loads");
    if (has(css, /url\(\s*["']?\s*https?:[^)]*[?&][^)]*=/i)) add("network"); // a URL carrying data
  }

  if (js.trim()) {
    add("code");
    const ev = eventNames(js);

    // looks
    if (has(js, /\.style\b|morse\.css\s*\(|classList|className\s*=|setAttribute\s*\(\s*["'`](style|class)|insertRule|createElement\s*\(\s*["'`]style|<style/i)) add("looks");
    // hides, and text: only when it's the page's own things, not ones the mod added
    const own = ownNames(js);
    if (onPage(js, HIDES_JS, own)) add("hides");
    if (onPage(js, TEXT_JS, own) || has(js, /document\.title\s*=(?!=)/)) add("text");
    // buttons, other new things
    if (has(js, /(morse\.el|createElement)\s*\(\s*["'`]button|<button|role\s*[:=,]\s*["'`]?button|type\s*:\s*["'`]button/i)) add("buttons");
    if (has(js, /morse\.el\s*\(|createElement(NS)?\s*\(|insertAdjacent(HTML|Element|Text)|\.(append|prepend|after|before|appendChild|insertBefore|replaceWith|replaceChildren)\s*\(|\binnerHTML\s*\+?=(?!=)|cloneNode\s*\(/)) add("adds");
    // listening to the person
    const evs = [...ev];
    if (evs.some(e => TYPING_EVENTS.test(e)) || has(js, /\.value\b|getSelection\s*\(|selection(Start|End)|isContentEditable|contenteditable|new\s+FormData|type\s*[=:]\s*["'`]?password|\binput\[|\btextarea\b/i)) add("typing");
    if (evs.some(e => POINTER_EVENTS.test(e))) add("clicks");
    // Clicking a link the mod made itself (how a download starts) isn't
    // clicking something on the page for you.
    if (onPage(js, ACTS_JS, own) || has(js, /dispatchEvent\s*\(|new\s+(Mouse|Keyboard|Pointer|Input|Touch|Submit)Event\b/)) add("acts");
    // keeps running
    if (has(js, /morse\.(every|watch)\s*\(|setInterval\s*\(|MutationObserver|requestAnimationFrame|ResizeObserver|IntersectionObserver/)) add("ongoing");
    // remembers
    if (has(js, /morse\.store\b|localStorage|sessionStorage|indexedDB|\bcaches\s*\.|openDatabase/)) add("storage");
    if (has(js, /document\s*\.\s*cookie|cookieStore/)) add("cookies");
    if (has(js, /navigator\s*\.\s*clipboard|execCommand\s*\(\s*["'`](copy|cut|paste)|ClipboardItem|clipboardData/i)) add("clipboard");
    // leaves the page
    if (has(js, /window\s*\.\s*open\s*\(|\bopen\s*\(\s*["'`]https?:|location\s*(\.\s*href\s*)?=(?!=)|location\s*\.\s*(assign|replace|reload)\s*\(|history\s*\.\s*(pushState|replaceState|go|back|forward)\s*\(/)) add("navigates");
    if (has(js, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|\bnew\s+Image\b|\.src\s*=(?!=)|\.(srcset|action|formAction|ping)\s*=(?!=)|setAttribute\s*\(\s*["'`](src|srcset|action|formaction|ping)["'`]|\bimport\s*\(|importScripts|postMessage\s*\(|new\s+Worker|serviceWorker|<(img|script|iframe|link|object|embed|form|video|audio|source)\b[^>]*\b(src|href|action|data)\s*=|\b(src|srcset|action)\s*:\s*["'`]?\s*(https?:)?\/\//)) add("network");
    if (has(js, /url\(\s*["']?\s*(https?:)?\/\//i) || has(js, /@import/)) add("loads");
    if (has(js, /getUserMedia|getDisplayMedia|mediaDevices|geolocation|DeviceOrientation|DeviceMotion/)) add("device");
    if (has(js, /\bNotification\b|showNotification/)) add("notify");
    // code that writes code, or hides what it calls
    if (has(js, /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|set(Timeout|Interval)\s*\(\s*["'`]|createElement\s*\(\s*["'`]script|<script|\bimport\s*\(|\batob\s*\(|fromCharCode|(window|globalThis|self|top|parent|frames|document|navigator)\s*\[|\bReflect\s*\.|\bProxy\b|\.constructor\s*[([]|\bwith\s*\(/)
      || has(js, /\\x[0-9a-f]{2}|\\u00[0-7][0-9a-f]|\\u\{0*[0-7]?[0-9a-f]\}/i)) add("dynamic");
  }

  const items = SUMMARY_ITEMS.filter(i => found.has(i.id)).map(i => ({ ...i, detail: i.detail || "" }));
  // "Adds new things" is implied when the new things are buttons and nothing else.
  const onlyButtons = found.has("buttons") && found.has("adds") && !has(js, /morse\.el\s*\(\s*["'`](?!button)|createElement\s*\(\s*["'`](?!button)|insertAdjacent|innerHTML/);
  const shown = onlyButtons ? items.filter(i => i.id !== "adds") : items;
  const notes = Object.keys(SUMMARY_NOTES).filter(id => found.has(id)).map(id => ({ id, text: SUMMARY_NOTES[id] }));
  return { items: shown, notes, empty: !css.trim() && !js.trim() };
}

// For the terminal: one line per item, notes last.
export function summaryLines(mod) {
  const s = summarizeMod(mod);
  if (s.empty) return [t("sum.emptyLine")];
  return [...s.items.map(i => i.text), ...s.notes.map(n => t("sum.noteLine", { text: n.text }))];
}

// The sites a mod runs on, exactly as modMatches (core/mod.js) reads them:
// no host list means every site; a list that isn't non-empty strings is
// broken (null), and a broken mod runs nowhere.
export function modHosts(mod) {
  const m = mod?.match;
  if (m === undefined || m === null) return ["*"];
  if (typeof m !== "object" || Array.isArray(m)) return null;
  const h = m.hosts;
  if (h === undefined || h === null) return ["*"];
  if (!Array.isArray(h) || !h.length || !h.every(x => typeof x === "string" && x)) return null;
  return h;
}

// Wildcards that cover a whole top-level domain ("*.com", "*.co.uk"): close to
// every website, though not written as "*". -> the endings, e.g. [".com"].
const SUFFIX2 = /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|nic|mil|ltd|plc)\.[a-z]{2}$/i;
export function broadEndings(mod) {
  if (mod?.match?.app) return [];
  return (modHosts(mod) || []).filter(h => {
    if (!h.startsWith("*.")) return false;
    const rest = h.slice(2).replace(/:\d+$/, "").replace(/\.$/, "");
    return !rest.includes(".") || SUFFIX2.test(rest);
  }).map(h => h.slice(1));
}

// "Where it runs", in words, from the same rule.
export function whereRuns(mod) {
  const app = mod?.match?.app;
  if (typeof app === "string" && app) return app;
  const h = modHosts(mod);
  if (!h) return t("where.broken");
  if (h.includes("*")) return t("where.everywhere");
  return h.map(x => (x === "file" ? t("where.files") : x)).join(", ");
}

// Where a mod came from, in a few words (Mods panel, popup, CLI).
export function modOrigin(mod) {
  const day = iso => {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toLocaleDateString(getLanguage() === "en" ? undefined : getLanguage(), { month: "short", day: "numeric", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
    } catch { return ""; }
  };
  const by = typeof mod?.author === "string" && mod.author.trim() ? t("origin.by", { author: mod.author.trim().slice(0, 60) }) : "";
  const on = iso => (iso ? t("origin.on", { day: day(iso) }) : "");
  if (mod?.imported && mod.gallery?.id) return t("origin.gallery", { by, on: on(mod.importedAt) }); // gallery hook (68-gallery.js)
  if (mod?.imported && mod.pack && typeof mod.pack.name === "string") return t("origin.pack", { name: mod.pack.name.slice(0, 80), by, on: on(mod.importedAt) }); // packs hook (core/pack.js)
  if (mod?.imported) {
    const how = mod.importedFrom === "file" ? "origin.file" : mod.importedFrom === "backup" ? "origin.backup" : "origin.link";
    return t(how, { by, on: on(mod.importedAt) });
  }
  if (mod?.from && (mod.from.title || mod.from.app || mod.from.url)) {
    let where = mod.from.title || mod.from.app || "";
    if (!where) { try { where = new URL(mod.from.url).host; } catch { where = t("origin.anotherPage"); } }
    return t("origin.rebuilt", { where, by });
  }
  const when = iso => (iso ? t("origin.when", { day: day(iso) }) : "");
  if (mod?.kind === "manual" || mod?.kind === "quick") return t("origin.own", { when: when(mod.created) });
  return t("origin.made", { with: mod?.model ? t("origin.with", { model: mod.model }) : "", by, when: when(mod?.created) });
}

// What an install keeps: the code the review showed, and nothing that could
// turn into other code later. A "manual" or "quick" mod (God mode, page tools)
// carries its edit list (core/edits.js), which Morse rebuilds into new CSS and
// JS when you use that tool again; the review never shows that list. So an
// installed mod loses it and becomes a plain mod: its CSS and JS, as shown.
export function asReviewed(mod) {
  if (!mod || typeof mod !== "object") return mod;
  const { edits, ...rest } = mod;
  if (rest.kind === "manual" || rest.kind === "quick") delete rest.kind;
  return rest;
}
