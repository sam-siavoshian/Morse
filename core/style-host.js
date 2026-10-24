// Your style, host side: builds the style's code from its building blocks (no
// model), puts it at the top of every page's mod list, and answers the
// runtime's style.* requests. Shared by the Chrome extension
// (extension/style-host.js) and the Morse helper for desktop apps
// (daemon/style.js); each passes its own storage.
//
// Because the style arrives as the first entry of "mods.list", every boot path
// (the full runtime, or a lean boot that applies mods before any UI) puts it on
// the page the same way it puts on mods: CSS at once, code only when a block
// needs it (no autoplay, dark pages), and the off switch, pause and safe start
// hold it back like any mod.
//
//   style.get      -> { style, entry, summary, here: { key, excepted } }
//   style.preview  { words } -> the same, for the style with these words added (nothing is saved)
//   style.save     { add: words } | { patch } | { reset: true } -> the same, saved
//   style.except   { on, key? } leave this site (or key) out, or bring it back
//   style.tried    the model fitted the style to this site once (or the person said no)
//   mods.save / mods.delete of STYLE_ID: the Mods panel's switch and Safe start

import {
  STYLE_ID, STYLE_TITLE, normalizeStyle, hasStyle, parseStyleWords, mergeStyle, styleSummary, styleKey, styleExcepted,
  withException, withoutExceptionsFor, isStyleChild,
} from "./style.js";
import { compileA11y, A11Y_FONTS } from "./a11y.js";
import { compileEdits, zoomFor } from "./edits.js";

export const STYLE_REQUESTS = new Set(["style.get", "style.preview", "style.save", "style.except", "style.tried"]);

// ---- the code

// Red and green easier to tell apart: the error a red-green color blind eye
// can't see is moved into blue (daltonize, deuteranopia). Grays stay gray.
const RED_GREEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="morse-rg" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  -0.4375 1.4375 0 0 0  0.2625 -0.5625 1.3 0 0  0 0 0 1 0"/></filter></svg>`;
const RED_GREEN = `url("data:image/svg+xml,${encodeURIComponent(RED_GREEN_SVG)}#morse-rg")`;
const SOFT = "saturate(0.72) contrast(0.92)";
const SPACING = { roomy: 1.6, roomier: 1.9 };
const INVERT = "filter: invert(0.93) hue-rotate(180deg) !important;";

/* global morse */
function noAutoplay() {
  // Video and sound that start by themselves are paused; a play you start stays.
  let lastInput = 0;
  const touched = () => { lastInput = Date.now(); };
  morse.on(document, "pointerdown", touched, true);
  morse.on(document, "keydown", touched, true);
  const hold = m => { if (Date.now() - lastInput > 1500 && !m.paused) m.pause(); };
  morse.on(document, "play", e => { if (e.target && e.target.matches && e.target.matches("video, audio")) hold(e.target); }, true);
  for (const m of document.querySelectorAll("video, audio")) { m.autoplay = false; hold(m); }
}

// A named font that isn't on this computer falls back to one of its kind.
const SERIF = /georgia|times|garamond|palatino|baskerville|charter|iowan|caladea|cambria|book|serif(?!.*sans)|merriweather|lora|playfair|crimson|libre caslon|minion|didot|bodoni/i;
const MONO = /mono|courier|consolas|menlo|code|fira code/i;
function fontCss(font) {
  if (font === "readable" || font === "dyslexia") return compileA11y("readable", { dyslexia: font === "dyslexia" }).css.replace(/^\/\*.*\*\/\n/, "");
  const generic = ["serif", "sans-serif", "monospace", "system-ui", "cursive"].includes(font);
  const family = generic ? font : `"${font}", ${MONO.test(font) ? "ui-monospace, monospace" : SERIF.test(font) ? "serif" : A11Y_FONTS.read}`;
  return `:where(body, body :not(${A11Y_FONTS.keep})) {\n  font-family: ${family} !important;\n}`;
}

let memo = { key: "", code: null };
// -> { css, js }. CSS for everything it can; code only for no autoplay and dark pages.
export function buildStyleCode(style) {
  const b = normalizeStyle(style).blocks;
  const key = JSON.stringify(b);
  if (memo.key === key) return memo.code;
  const css = [], bodies = [], filters = [];
  if (b.font) css.push(fontCss(b.font));
  if (b.size) css.push(`body {\n  zoom: ${zoomFor(b.size)} !important;\n}`);
  if (b.spacing) css.push(`:where(p, li, dd, dt, blockquote, figcaption, td, th, label, summary) {\n  line-height: ${SPACING[b.spacing]} !important;\n}`);
  if (b.soft) filters.push(SOFT);
  if (b.redgreen) filters.push(RED_GREEN);
  if (filters.length) css.push(`html {\n  filter: ${filters.join(" ")} !important;\n}`);
  if (b.lessMotion) css.push(compileA11y("still").css.replace(/^\/\*.*\*\/\n/, "").trim());
  if (b.underline) css.push(compileA11y("underline").css.replace(/^\/\*.*\*\/\n/, "").trim());
  if (b.noAutoplay) bodies.push(`${noAutoplay.toString()}\nnoAutoplay();`);
  if (b.dark) {
    // Page tools' dark mode, skipped on pages that are already dark. Its filter
    // replaces the one above, so the color changes go along with it.
    let dark = compileEdits([{ op: "page", kind: "dark" }]).js;
    if (filters.length) dark = dark.replace(INVERT, `filter: invert(0.93) hue-rotate(180deg) ${filters.join(" ").replace(/"/g, '\\"')} !important;`);
    bodies.push(dark);
  }
  const head = "/* Your style: made by Morse on every site, no model involved */";
  const js = !bodies.length ? "" : [
    "// Your style: made by Morse on every site, no model involved. Turning it off undoes all of it.",
    "const done = [];",
    ...bodies.map(body => `done.push((() => {\n${body}\n})());`),
    "return () => done.forEach(f => typeof f === \"function\" && f());",
    "",
  ].join("\n");
  const code = { css: css.length ? `${head}\n${css.join("\n")}\n` : "", js };
  memo = { key, code };
  return code;
}

// The style as the first entry of a page's mod list.
export function styleEntry(style, where) {
  const s = normalizeStyle(style);
  const { css, js } = buildStyleCode(s);
  const excepted = styleExcepted(s, where);
  return {
    morse: 1, id: STYLE_ID, kind: "style", title: STYLE_TITLE,
    prompt: s.words || styleSummary(s).join(", ") || STYLE_TITLE,
    match: { hosts: ["*"], app: null }, target: null, css, js,
    enabled: s.enabled && !excepted, // runs here
    on: s.enabled,                    // on everywhere (the switch)
    excepted, summary: styleSummary(s), extra: s.extra, adapt: s.adapt, except: s.except,
    fitted: !!s.tried[styleKey(where)],
    created: s.created || s.updated, updated: `${s.updated}${excepted ? "-x" : ""}`, model: null,
  };
}

// ---- the requests

// store: { load() -> style | null, save(style | null) }; onChange(): tell open pages.
export function createStyleHost({ load, save, onChange = () => {}, now = () => new Date().toISOString() }) {
  let queue = Promise.resolve();
  const current = async () => { const raw = await load(); return raw && hasStyle(raw) ? normalizeStyle(raw) : null; };
  // One read-modify-write at a time, so two tabs can't drop each other's change.
  const update = fn => {
    const run = queue.then(async () => {
      const next = fn(await current());
      if (next === undefined) return current();
      await save(next && hasStyle(next) ? normalizeStyle(next) : null);
      try { onChange(); } catch {}
      return next && hasStyle(next) ? normalizeStyle(next) : null;
    });
    queue = run.catch(() => {});
    return run;
  };
  const view = (style, where) => ({
    style, entry: style ? styleEntry(style, where) : null, summary: style ? styleSummary(style) : [],
    here: { key: styleKey(where), excepted: style ? styleExcepted(style, where) : false },
  });
  const stamp = s => ({ ...s, created: s.created || now(), updated: now() });

  function patched(cur, patch = {}) {
    const s = normalizeStyle(cur || {});
    const p = patch && typeof patch === "object" ? patch : {};
    const next = { ...s };
    for (const k of ["words", "extra"]) if (typeof p[k] === "string") next[k] = p[k];
    for (const k of ["adapt", "enabled"]) if (typeof p[k] === "boolean") next[k] = p[k];
    if (Array.isArray(p.except)) next.except = p.except;
    if (p.blocks && typeof p.blocks === "object") next.blocks = { ...s.blocks, ...p.blocks };
    if (typeof p.words === "string" && p.reparse) { // the words were edited: what they say replaces the blocks
      const parsed = parseStyleWords(p.words);
      next.blocks = { ...normalizeStyle({}).blocks, ...parsed.blocks };
      next.extra = parsed.extra;
      next.except = [...new Set([...s.except, ...parsed.except])];
    }
    return stamp(next);
  }

  return {
    owns: msg => STYLE_REQUESTS.has(msg?.type) || (msg?.type === "mods.save" && msg.mod?.id === STYLE_ID) || (msg?.type === "mods.delete" && msg.modId === STYLE_ID),

    // The page's mods with the style first. Mods that fit the style to this
    // site (isStyleChild) only run while the style does.
    async list(mods, where) {
      let style = null;
      try { style = await current(); } catch {}
      const list = Array.isArray(mods) ? mods : [];
      if (!style) return list.filter(m => !isStyleChild(m));
      const entry = styleEntry(style, where);
      return [entry, ...list.filter(m => !isStyleChild(m) || entry.enabled)];
    },

    async handle(msg, where) {
      switch (msg.type) {
        case "style.get": return view(await current(), where);
        case "style.preview": {
          const words = String(msg.words || "");
          const parsed = parseStyleWords(words);
          return { ...view(mergeStyle(await current(), parsed, words, now()), where), parsed };
        }
        case "style.save": {
          const s = await update(cur => {
            if (msg.reset) return null;
            if (typeof msg.add === "string") {
              const next = mergeStyle(cur, parseStyleWords(msg.add), msg.add, now());
              return typeof msg.adapt === "boolean" ? { ...next, adapt: msg.adapt } : next;
            }
            return patched(cur, msg.patch);
          });
          return view(s, where);
        }
        case "style.except": {
          const s = await update(cur => {
            if (!cur) return undefined;
            const next = msg.key ? withException(cur, msg.key, msg.on !== false)
              : msg.on !== false ? withException(cur, styleKey(where), true) : withoutExceptionsFor(cur, where);
            return stamp(next);
          });
          return view(s, where);
        }
        case "style.tried": {
          await update(cur => {
            if (!cur) return undefined;
            return { ...cur, tried: { ...cur.tried, [styleKey(where)]: now() } };
          });
          return true;
        }
        case "mods.save": { // the Mods panel's switch, Safe start's "Keep it off": on or off everywhere
          const s = await update(cur => (cur ? stamp({ ...cur, enabled: msg.mod.enabled !== false }) : undefined));
          return s ? styleEntry(s, where) : null;
        }
        case "mods.delete":
          await update(() => null);
          return true;
      }
      throw new Error(`Unknown request ${msg.type}`);
    },
  };
}
