// Your style, everywhere: one personal style that follows the person to every
// site and app ("use my font everywhere", "everything calmer", "make red and
// green easy to tell apart on every site except Figma").
//
// A style is the person's words plus building blocks that need no model:
//   font       a family name, "readable" or "dyslexia" ("" = as the site has it)
//   size       text size in Page tools' steps (10% each, -2..6)
//   spacing    "" | "roomy" | "roomier" (space between lines)
//   soft       softer colors (a CSS filter)
//   redgreen   red and green easier to tell apart (an SVG color filter)
//   dark       dark pages (Page tools' dark mode, skipped on pages already dark)
//   lessMotion fewer animations (Easier to use's "Stop animations" CSS)
//   noAutoplay video and sound don't start by themselves
//   underline  underlined links (Easier to use's "Underline links")
// What no block covers is kept as `extra`; with `adapt` on, the model fits it
// (and fixes what the generic style breaks) per site, on the first visit, as a
// child mod (parent: STYLE_ID) the person reviews like any change.
//
// The hosts (core/style-host.js) build the code and put the style at the top
// of every page's mod list, so it runs at boot like a mod, with no model call.
//
// Pure and dependency-free: tests import it, core/style-host.js imports it, and
// runtime/bundle.js inlines it into the runtime (exports become locals there).
import { t } from "./i18n.js"; // the words, in the language the host speaks (core/i18n.js)

export const STYLE_ID = "morse-style";
export const STYLE_TITLE = "Your style";
export const STYLE_SIZES = [-2, 0, 2, 4];
const MAX_WORDS = 600, MAX_EXTRA = 400, MAX_EXCEPT = 100, MAX_TRIED = 300;

const DEFAULT_BLOCKS = { font: "", size: 0, spacing: "", soft: false, redgreen: false, dark: false, lessMotion: false, noAutoplay: false, underline: false };
export const STYLE_BLOCKS = Object.keys(DEFAULT_BLOCKS);

// Fonts people name, spelled the way the computer knows them.
const KNOWN_FONTS = ["Atkinson Hyperlegible", "OpenDyslexic", "Lexend", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Arial", "Helvetica Neue", "Helvetica",
  "Inter", "Roboto", "Open Sans", "Lato", "Source Sans Pro", "Noto Sans", "Times New Roman", "Garamond", "Palatino", "Baskerville", "Charter", "Iowan Old Style",
  "Comic Sans MS", "Courier New", "Menlo", "Consolas", "JetBrains Mono", "Fira Sans", "IBM Plex Sans", "Segoe UI", "Avenir", "Futura", "Gill Sans", "Optima"];
const GENERIC_FONTS = ["serif", "sans-serif", "monospace", "system-ui", "cursive"];
const FONT_OK = /^[A-Za-z0-9][\w .'-]{0,39}$/;

const str = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u2028\u2029]+/g, " ").trim().slice(0, n) : "");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

export function cleanFont(v) {
  const s = str(v, 40).replace(/["“”‘’`;{}<>\\]/g, "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "readable" || low === "dyslexia" || GENERIC_FONTS.includes(low)) return low;
  return FONT_OK.test(s) ? s : "";
}

export function normalizeBlocks(b) {
  const src = b && typeof b === "object" ? b : {};
  return {
    font: cleanFont(src.font),
    size: clamp(src.size, -2, 6),
    spacing: ["roomy", "roomier"].includes(src.spacing) ? src.spacing : "",
    soft: src.soft === true, redgreen: src.redgreen === true, dark: src.dark === true,
    lessMotion: src.lessMotion === true, noAutoplay: src.noAutoplay === true, underline: src.underline === true,
  };
}

export function normalizeStyle(s) {
  const src = s && typeof s === "object" ? s : {};
  const except = [...new Set((Array.isArray(src.except) ? src.except : []).map(exceptionKey).filter(Boolean))].slice(0, MAX_EXCEPT);
  const tried = {};
  if (src.tried && typeof src.tried === "object") for (const [k, v] of Object.entries(src.tried).slice(-MAX_TRIED)) if (typeof v === "string" && k.length <= 260) tried[k] = v.slice(0, 40);
  return {
    v: 1,
    words: str(src.words, MAX_WORDS),
    blocks: normalizeBlocks(src.blocks),
    extra: str(src.extra, MAX_EXTRA),
    except,
    adapt: src.adapt === true,
    enabled: src.enabled !== false,
    created: str(src.created, 40),
    updated: str(src.updated, 40),
    tried,
  };
}

// Anything to run: a block, or words the model fits per site.
export function hasStyle(s) {
  if (!s || typeof s !== "object") return false;
  const n = normalizeStyle(s), b = n.blocks;
  return !!(n.words || n.extra || b.font || b.size || b.spacing || STYLE_BLOCKS.some(k => b[k] === true));
}
export const blockCount = s => { const b = normalizeStyle(s).blocks; return STYLE_BLOCKS.filter(k => k === "size" ? b.size !== 0 : !!b[k]).length; };

// ---- where it runs: every site and app, minus the exceptions

// The key a site or app is known by: the app's id in a desktop app, the host
// (with its port) on the web, "file" for local files.
export function styleKey({ url = "", app = null } = {}) {
  if (app) return `app:${String(app).toLowerCase()}`;
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return "file";
    return u.host.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

// What people type ("Figma", "https://www.figma.com/files", "app:slack") ->
// the key kept in the list ("figma", "figma.com", "app:slack").
export function exceptionKey(v) {
  let s = str(v, 260).toLowerCase();
  if (!s) return "";
  if (/^app:[\w.-]{1,80}$/.test(s)) return s;
  s = s.replace(/^[a-z][\w+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "");
  s = s.replace(/^(the|my)\s+/, "").replace(/\s+(app|site|website|page|pages|desktop app)$/, "").replace(/[.,;:!]+$/, "").trim();
  return /^[a-z0-9][a-z0-9 .:_-]{0,99}$/.test(s) ? s.replace(/\s+/g, " ") : "";
}

// "figma" leaves out figma.com, www.figma.com and the Figma app; "google docs"
// leaves out docs.google.com; "figma.com" leaves out figma.com and its subdomains.
export function exceptionMatches(entry, where) {
  const e = exceptionKey(entry), key = styleKey(where);
  if (!e || !key) return false;
  if (e === key) return true;
  if (e.startsWith("app:")) return false;
  if (key.startsWith("app:")) { const id = key.slice(4); return e.replace(/\s+/g, "") === id.replace(/[\s_-]+/g, "") || e.split(" ").includes(id); }
  const host = key.replace(/:\d+$/, "");
  if (e.includes(".")) return host === e || host.endsWith("." + e);
  const labels = host.split(".");
  return e.split(" ").every(w => labels.includes(w));
}

export const styleExcepted = (style, where) => normalizeStyle(style).except.some(e => exceptionMatches(e, where));

// "figma.com" -> "figma.com", "app:slack" -> "slack"
export const exceptionName = e => (String(e).startsWith("app:") ? String(e).slice(4) : String(e));

export function withException(style, key, on = true) {
  const s = normalizeStyle(style), k = exceptionKey(key);
  if (!k) return s;
  s.except = on ? [...new Set([...s.except, k])].slice(0, MAX_EXCEPT) : s.except.filter(e => e !== k);
  return s;
}
// Turning it back on for a site removes every entry that leaves this site out.
export function withoutExceptionsFor(style, where) {
  const s = normalizeStyle(style);
  s.except = s.except.filter(e => !exceptionMatches(e, where));
  return s;
}

// ---- words in the bar

const EVERYWHERE = /\b(?:every\s?where|on\s+(?:every|all|each|any)\s+(?:of\s+my\s+)?(?:sites?|websites?|web\s?pages?|pages?|apps?|tabs?)(?:\s+(?:and|&)\s+(?:apps?|sites?|websites?))?|in\s+(?:every|all|each|any)\s+(?:of\s+my\s+)?(?:apps?|sites?|websites?|programs?)(?:\s+(?:and|&)\s+(?:apps?|sites?|websites?))?|across\s+(?:every|all)\s+(?:my\s+)?(?:sites?|apps?|websites?)|(?:on|across)\s+the\s+whole\s+web|all\s+over\s+the\s+web)\b/i;
export const isEverywhere = text => EVERYWHERE.test(String(text || ""));

const NOT_HERE = [
  /^\s*(?:not|never)\s+(?:on|in|for)\s+this\s+(?:site|page|app|website)\s*\.?\s*$/i,
  /^\s*not\s+here\s*\.?\s*$/i,
  /\b(?:my|your)\s+style\b.{0,30}\b(?:off|not|never)\b.{0,12}\b(?:here|(?:on|in|for)\s+this\s+(?:site|page|app|website))\b/i,
  /\b(?:turn\s+off|stop|pause|no|without|hide|remove)\s+(?:my|your)\s+style\s+(?:here|(?:on|in|for)\s+this\s+(?:site|page|app|website))\b/i,
];
export const isNotHere = text => NOT_HERE.some(re => re.test(String(text || "")));

const EXCEPT = /\b(?:except|excluding|but\s+not|apart\s+from|other\s+than|besides)\b\s*(?:on|in|for|at)?\s+(.+)$/i;

const DETECT = [
  ["redgreen", /\bcolou?r\s?-?blind(?:ness)?\b|\bred\s*(?:and|\/|&|-|or|vs\.?)\s*green\b|\bgreen\s*(?:and|\/|&|or)\s*red\b|\bdeuteran|\bprotan/i],
  ["dark", /\bdark\s+(?:mode|theme|backgrounds?|pages?|sites?)\b|\bnight\s+mode\b|\blight\s+text\s+on\s+dark\b|\bmake\s+(?:it|them|everything|pages)\s+dark\b/i],
  ["noAutoplay", /\bauto-?\s?play(?:ing|s)?\b|\b(?:videos?|sound|music|audio)\s+(?:that\s+)?(?:starts?|plays?)\s+(?:by\s+(?:it|them)sel(?:f|ves)|automatically|on\s+(?:its|their)\s+own)\b/i],
  ["lessMotion", /\b(?:no|fewer|less|reduced?|stop|without|minimal|turn\s+off|no\s+more)\s+(?:the\s+)?(?:animations?|motion|moving\s+things|movement|transitions?|parallax)\b|\breduced?\s?-?motion\b|\b(?:animations?|motion)\s+off\b|\bstill\s+pages?\b/i],
  ["soft", /\b(?:soft(?:er)?|muted|gentler?|calm(?:er)?|duller|pastel|dimmer|warmer|easier\s+on\s+the\s+eyes)\s+colou?rs?\b|\bcolou?rs?\s+(?:softer|muted|less\s+(?:bright|vivid|intense|saturated))\b|\bless\s+(?:bright|saturated|vivid|colou?rful|harsh)\b|\btone\s+down\s+(?:the\s+)?colou?rs?\b|\bdesaturat/i],
  ["underline", /\bunderline(?:d|s)?\b[^.]{0,20}\blinks?\b|\blinks?\b[^.]{0,20}\bunderline(?:d|s)?\b/i],
  ["spacing", /\bline[\s-]?(?:spacing|height)\b|\bspace\s+between\s+(?:the\s+)?lines\b|\bspacing\s+between\s+lines\b|\bleading\b|\b(?:more|extra)\s+space\b|\broomier\b|\bairier\b|\bspaced\s+out\b|\bdouble[\s-]spac/i],
  ["size", /\b(?:bigger|larger|large|big|huge|biggest|largest|smaller|tiny|small|increase|decrease)\b[^.]{0,24}\b(?:text|font|fonts|type|letters|words|print|writing)\b|\b(?:text|font|type|letters|print|writing)\b[^.]{0,16}\b(?:bigger|larger|smaller|size|bigger)\b|\b\d{2,3}\s*%/i],
  ["font", /\b(?:font|fonts|typeface|type\s?face|lettering)\b|\bdyslexi|\bin\s+(?:serif|sans-serif|monospace)\b/i],
  ["font", { test: c => KNOWN_FONTS.some(f => new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "i").test(c)) || /\bcomic\s+sans\b|\batkinson\b/i.test(c) }],
  ["calm", /\b(?:calm(?:er)?|quiet(?:er)?|less\s+busy|less\s+distracting|fewer\s+distractions|soothing|gentler|relax(?:ed|ing)?)\b/i],
];

function fontIn(clause) {
  const low = clause.toLowerCase();
  if (/dyslexi/.test(low)) return "dyslexia";
  const q = clause.match(/["“‘']([^"”’']{2,40})["”’']/);
  if (q && cleanFont(q[1])) return cleanFont(q[1]);
  const known = KNOWN_FONTS.find(f => new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "i").test(clause))
    || (/\bcomic\s+sans\b/i.test(clause) && "Comic Sans MS") || (/\bopen\s?dyslexic\b/i.test(clause) && "OpenDyslexic") || (/\batkinson\b/i.test(clause) && "Atkinson Hyperlegible");
  if (known) return known;
  const generic = low.match(/\b(sans-serif|sans serif|serif|monospace|mono)\b/);
  if (generic) return generic[1] === "sans serif" ? "sans-serif" : generic[1] === "mono" ? "monospace" : generic[1];
  if (/\b(easier|easy)\s+to\s+read\b|\breadable\b|\blegible\b|\bclearer\b/.test(low)) return "readable";
  const named = clause.match(/\b(?:font|typeface)\s+(?:to|as|is|=|:|called|named)?\s*([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/)
    || clause.match(/\b(?:use|in|with)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})(?:\s+(?:font|typeface))/)
    || clause.match(/^(?:use\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+(?:font|typeface)\b/);
  return named ? cleanFont(named[1]) : "";
}

function sizeIn(clause) {
  const pct = clause.match(/\b(\d{2,3})\s*%/);
  if (pct) return clamp(Math.log(Number(pct[1]) / 100) / Math.log(1.1), -2, 6);
  const low = clause.toLowerCase();
  const down = /\b(smaller|tiny|small|decrease)\b/.test(low);
  const lot = /\b(much|a\s+lot|way|really|huge|biggest|largest|very)\b/.test(low);
  const bit = /\b(slightly|a\s+bit|a\s+little|little)\b/.test(low);
  return (down ? -1 : 1) * (lot ? 4 : bit ? 1 : 2);
}

const FILLER = new Set("i im i'm am is are a an the my me it its this that these all everything every everywhere thing things make please want would like use to and or so just also always more of on in for be with feel".split(" "));

// Words -> { blocks (only what was said), extra (what no block covers),
// except (sites and apps named after "except"), notes ("font" when the font
// wasn't named) }.
export function parseStyleWords(text) {
  let body = str(text, MAX_WORDS);
  const out = { blocks: {}, extra: "", except: [], notes: [] };
  const ex = body.match(EXCEPT);
  if (ex) {
    body = body.slice(0, ex.index);
    out.except = ex[1].replace(EVERYWHERE, " ").split(/,|\band\b|\bor\b|\bnor\b|&/i).map(exceptionKey).filter(Boolean);
  }
  body = body.replace(EVERYWHERE, " ");
  const extra = [];
  // "red and green" stays one clause; other "and"s split.
  const clauses = body.split(/[,;:\n]|\.(?:\s|$)|\s-\s|\band\s+(?!green\b|red\b)|\bplus\b|\balso\b/i).map(c => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const kinds = new Set(DETECT.filter(([, re]) => re.test(clause)).map(([k]) => k));
    for (const k of kinds) {
      if (k === "calm") Object.assign(out.blocks, { lessMotion: true, noAutoplay: true, soft: true });
      else if (k === "size") out.blocks.size = sizeIn(clause);
      else if (k === "spacing") out.blocks.spacing = /\b(double|much|lots|a\s+lot|way)\b/i.test(clause) ? "roomier" : "roomy";
      else if (k === "font") {
        const f = fontIn(clause);
        if (f) out.blocks.font = f;
        else if (!kinds.has("size") && !kinds.has("spacing")) out.notes.push("font"); // "use my font": which one?
      } else out.blocks[k] = true;
    }
    if (kinds.size) continue;
    const words = clause.toLowerCase().match(/[a-z']+/g) || [];
    if (words.filter(w => !FILLER.has(w)).length) extra.push(clause);
  }
  out.extra = extra.join("; ").slice(0, MAX_EXTRA);
  out.notes = [...new Set(out.notes)].filter(n => !(n === "font" && out.blocks.font));
  return out;
}

// The bar's "…everywhere" adds to the style there is (say it once, add later).
export function mergeStyle(style, parsed, words, now = new Date().toISOString()) {
  const s = normalizeStyle(style);
  const p = parsed || {};
  const said = str(words, MAX_WORDS);
  return normalizeStyle({
    ...s,
    words: [s.words, said].filter(Boolean).join("; ").slice(-MAX_WORDS),
    blocks: { ...s.blocks, ...(p.blocks || {}) },
    extra: [s.extra, p.extra].filter(Boolean).join("; ").slice(-MAX_EXTRA),
    except: [...s.except, ...(p.except || [])],
    enabled: true,
    created: s.created || now,
    updated: now,
  });
}

// Plain words for what the style does, one item per block.
export function styleSummary(style, lang) { // lang "en": for the model
  const s = normalizeStyle(style), b = s.blocks, out = [];
  if (b.font) out.push(b.font === "readable" ? t("a11y.readable", {}, lang) : b.font === "dyslexia" ? t("a11y.dyslexia", {}, lang) : t("ys.sum.font", { font: b.font }, lang));
  if (b.size) out.push(t("ys.sum.size", { pct: Math.round(Math.pow(1.1, b.size) * 100) }, lang));
  if (b.spacing) out.push(b.spacing === "roomier" ? t("ys.sum.roomier", {}, lang) : t("ys.sum.roomy", {}, lang));
  if (b.soft) out.push(t("ys.soft", {}, lang));
  if (b.redgreen) out.push(t("ys.redgreen", {}, lang));
  if (b.dark) out.push(t("ys.dark", {}, lang));
  if (b.lessMotion) out.push(t("ys.lessMotion", {}, lang));
  if (b.noAutoplay) out.push(t("ys.noAutoplay", {}, lang));
  if (b.underline) out.push(t("ys.sum.underline", {}, lang));
  return out;
}

// ---- fitting it to one site (the model, only when the person turned it on)

export const FIT_TITLE = "Nothing to fit";
// facts: what Morse measured on the page with the style on ("footer ends at
// 951px, below the bottom of the window (800px), and can't be scrolled to").
export function adaptRequest(style, css = "", facts = []) {
  const s = normalizeStyle(style);
  const parts = [
    `Your style, for this site. The user wants this on every site and app: “${s.words || styleSummary(s, "en").join(", ")}”.`,
    "Morse already adds this general style to every page, and it is on this page now:",
    "```css\n" + String(css).trim().slice(0, 3000) + "\n```",
    "Look at this page with it and fix only what it breaks here: text that overflows, overlaps or gets cut off, icons that lost their icon font, controls or headers that no longer fit, colors that became hard to read.",
  ];
  const seen = (Array.isArray(facts) ? facts : []).filter(f => typeof f === "string" && f).slice(0, 8);
  if (seen.length) parts.push("Measured on this page with the style on:\n" + seen.map(f => `- ${f.slice(0, 300)}`).join("\n"));
  if (s.extra) parts.push(`Also do what the general style can't, for this page: ${s.extra}.`);
  parts.push(`Keep it small and specific to this page. Don't undo the user's style. If nothing needs fixing, reply with TITLE: ${FIT_TITLE} and empty code blocks.`);
  return parts.join("\n\n");
}

export const isStyleChild = m => !!m && m.parent === STYLE_ID;
