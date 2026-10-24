// Easier to use: accessibility for any app, with no model needed for the basics.
//
//   1. Page tools in the "Easier to use" group: higher contrast, bigger click
//      targets, easier to read font, underline links, stop animations, focus
//      outline everywhere, reading ruler, hide distractions.
//      compileA11y(kind, opts) -> { css, js }, saved as a quick mod per site.
//   2. Check this page: auditPage(document) finds common problems. The fixes
//      compile with compileFixes(fixes) -> { css, js } into one "Accessibility
//      fixes" mod per site; what needs judgment becomes a precise request to
//      the model (fixRequest).
//   3. Describe this image: imageMessages() is the model prompt. core/prompt.js
//      hands it every request that carries an image.
//
// Pure and dependency-free like core/edits.js: tests import it, core/prompt.js
// imports it, and runtime/bundle.js inlines it into the runtime (exports become
// locals there). Helpers that run inside the page are real functions here,
// embedded with .toString(), so "Edit code" shows plain, readable JavaScript.

export const A11Y_TOOLS = {
  contrast: { title: "Higher contrast" },
  targets: { title: "Bigger click targets" },
  readable: { title: "Easier to read font" },
  underline: { title: "Underline links" },
  still: { title: "Stop animations" },
  outline: { title: "Focus outline everywhere" },
  ruler: { title: "Reading ruler" },
  calm: { title: "Hide distractions" },
};
export const A11Y_KINDS = Object.keys(A11Y_TOOLS);
export const FIX_TITLE = "Accessibility fixes";

export function a11yTitle(kind, opts = {}) {
  const t = A11Y_TOOLS[kind]?.title || FIX_TITLE;
  return kind === "readable" && opts.dyslexia ? `${t} (dyslexia-friendly)` : t;
}

// ---- colors (also run in the page, embedded via toString)

export function parseColor(s) {
  s = String(s || "").trim().toLowerCase();
  if (!s || s === "none") return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[5] ? m[4] / 100 : +m[4] };
  m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = i => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  // Anything else (oklch(), color(), names): let a canvas work it out.
  if (typeof document === "undefined" || !document.createElement) return null;
  try {
    const g = parseColor.g || (parseColor.g = document.createElement("canvas").getContext("2d", { willReadFrequently: true }));
    g.fillStyle = "#010203";
    g.fillStyle = s;
    if (g.fillStyle === "#010203") return null;
    g.clearRect(0, 0, 1, 1);
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch { return null; }
}

export function relLuminance(c) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function contrastRatio(a, b) {
  const x = relLuminance(a), y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// fg painted over an opaque bg.
export function overColor(fg, bg) {
  const a = fg.a == null ? 1 : fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

// The color closest to fg (same hue, pushed toward black or white, whichever
// the background allows) that reaches the target contrast on bg.
export function strongerColor(fg, bg, target) {
  const round = c => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 1 });
  fg = overColor(fg, bg);
  if (contrastRatio(fg, bg) >= target) return round(fg);
  const black = { r: 0, g: 0, b: 0 }, white = { r: 255, g: 255, b: 255 };
  const end = contrastRatio(black, bg) >= contrastRatio(white, bg) ? black : white;
  const mix = t => ({ r: fg.r + (end.r - fg.r) * t, g: fg.g + (end.g - fg.g) * t, b: fg.b + (end.b - fg.b) * t });
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(round(mix(mid)), bg) >= target) hi = mid; else lo = mid;
  }
  return round(mix(hi));
}

export const hexColor = c => "#" + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

// What a piece of text sits on: the backgrounds of its ancestors, composited.
// null when it sits on a picture or a gradient (no single color to measure).
export function backgroundOf(el) {
  const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  const dark = /dark/.test(getComputedStyle(document.documentElement).colorScheme || "") && !layers.some(l => l.a >= 1);
  let bg = dark ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) bg = overColor(layers[i], bg);
  return bg;
}

// The color text actually shows: its color, faded by its own and its
// ancestors' opacity, over its background.
export function textColorOf(el, bg) {
  const fg = parseColor(getComputedStyle(el).color);
  if (!fg || !bg) return null;
  let o = 1;
  for (let n = el; n && n.nodeType === 1 && o > 0; n = n.parentElement) o *= +getComputedStyle(n).opacity;
  return overColor({ ...fg, a: (fg.a == null ? 1 : fg.a) * o }, bg);
}

function hasOwnText(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  return false;
}

// ---- page tools: helpers that run in the page

/* global morse, undo */
function attrStyles(attr) {
  // One CSS rule per distinct value, keyed by a short attribute: re-renders
  // that keep the element keep the fix, and nothing is written into style="".
  const sheet = morse.css("");
  const seen = new Map();
  return (el, decl) => {
    let k = seen.get(decl);
    if (k == null) {
      k = String(seen.size);
      seen.set(decl, k);
      sheet.textContent += `[${attr}="${k}"] { ${decl} }\n`;
    }
    el.setAttribute(attr, k);
    undo.push(() => el.removeAttribute(attr));
  };
}

function contrastUp(min) {
  const text = attrStyles("data-morse-hc"), border = attrStyles("data-morse-hcb");
  const rgb = c => `rgb(${c.r}, ${c.g}, ${c.b})`;
  morse.watch("body *", el => {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|IMG|VIDEO|CANVAS|IFRAME)$/i.test(el.tagName)) return;
    const cs = getComputedStyle(el);
    const textual = hasOwnText(el) || (el.matches("input, textarea, select") && el.value);
    if (textual) {
      const bg = backgroundOf(el);
      const fg = bg && parseColor(cs.color);
      if (fg && fg.a > 0) {
        let decl = "";
        if (+cs.opacity < 1 && +cs.opacity >= 0.2) decl += "opacity: 1 !important; ";
        const shown = overColor(fg, bg);
        if (contrastRatio(shown, bg) < min) decl += `color: ${rgb(strongerColor(shown, bg, min))} !important; -webkit-text-fill-color: currentColor !important;`;
        if (decl) text(el, decl.trim());
      }
    }
    // Faint borders on fields, buttons, tables and rules.
    if (el.matches("input, select, textarea, button, [role=button], [role=textbox], [role=combobox], fieldset, hr, table, th, td")) {
      const w = ["Top", "Right", "Bottom", "Left"].find(s => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none");
      const bc = w && parseColor(cs[`border${w}Color`]);
      const bg = bc && backgroundOf(el.parentElement || el);
      if (bc && bg && bc.a > 0 && contrastRatio(overColor(bc, bg), bg) < 3) border(el, `border-color: ${rgb(strongerColor(overColor(bc, bg), bg, 3))} !important;`);
    }
  });
}

function bigTargets() {
  const SEL = "button, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], summary, select, input:not([type=hidden]):not([type=range]):not([type=color]):not([type=file]), a[href]"; // no :has(), so older Electron apps run it too
  const inText = el => {
    if (!el.matches("a")) return false;
    const block = el.parentElement && (el.parentElement.closest("p, li, dd, td, th, blockquote, figcaption, label") || el.parentElement);
    if (!block) return false;
    const links = [...block.querySelectorAll("a")].reduce((n, a) => n + a.textContent.trim().length, 0);
    return block.textContent.trim().length - links > 20;
  };
  morse.watch(SEL, el => {
    let kind = "min";
    if (el.matches("input[type=checkbox], input[type=radio]")) kind = "box";
    else if (inText(el)) return; // links inside a sentence stay as they are
    else if (!el.matches("button, input, select, textarea")) {
      const d = getComputedStyle(el).display;
      const plain = [...el.children].every(k => /^(svg|img|span|i|b|strong|em|small|abbr|kbd)$/i.test(k.localName));
      if (d === "inline") kind = "inline";
      else if (plain && (d === "inline-block")) kind = "inline";
      else if (plain && (d === "block" || d === "list-item")) kind = "flex";
    }
    el.setAttribute("data-morse-big", kind);
    undo.push(() => el.removeAttribute("data-morse-big"));
  });
}

function stillPage() {
  // Video and sound: pause what plays by itself; a play you start stays.
  let lastInput = 0;
  const touched = () => { lastInput = Date.now(); };
  morse.on(document, "pointerdown", touched, true);
  morse.on(document, "keydown", touched, true);
  const paused = new Set();
  // (Autoplay that starts later is caught by the "play" listener below, so
  // the page's own autoplay attribute is left as it is.)
  morse.watch("video, audio", m => { if (!m.paused) { m.pause(); paused.add(m); } });
  morse.on(document, "play", e => {
    const m = e.target;
    if (m && m.matches && m.matches("video, audio") && Date.now() - lastInput > 1500) { m.pause(); paused.add(m); }
  }, true);
  undo.push(() => paused.forEach(m => { if (m.isConnected && m.paused) m.play().catch(() => {}); }));

  // Moving pictures: show the first frame of GIFs (when the browser lets
  // Morse read their pixels), stop marquees and SVG animations.
  morse.watch('img[src*=".gif" i], img[src^="data:image/gif" i]', img => {
    const still = () => {
      if (!img.naturalWidth || img.hasAttribute("data-morse-still")) return;
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const url = c.toDataURL();
        const was = { src: img.getAttribute("src"), srcset: img.getAttribute("srcset") };
        img.setAttribute("data-morse-still", "");
        img.removeAttribute("srcset");
        img.setAttribute("src", url);
        undo.push(() => {
          img.removeAttribute("data-morse-still");
          if (img.getAttribute("src") !== url) return;
          img.setAttribute("src", was.src);
          if (was.srcset != null) img.setAttribute("srcset", was.srcset);
        });
      } catch {} // another site's picture: it can't be read, so it keeps moving
    };
    if (img.complete) still(); else morse.on(img, "load", still, { once: true });
  });
  morse.watch("marquee", m => { if (m.stop) { m.stop(); undo.push(() => m.start && m.start()); } });
  morse.watch("svg", s => {
    if (s.pauseAnimations && s.animationsPaused && !s.animationsPaused()) { s.pauseAnimations(); undo.push(() => s.unpauseAnimations()); }
  });
  // Animations started from scripts: finish the ones that end, pause the ones that loop.
  const scripted = new Set();
  const settle = () => {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (scripted.has(a) || a.playState !== "running" || (globalThis.CSSAnimation && a instanceof CSSAnimation) || (globalThis.CSSTransition && a instanceof CSSTransition)) continue;
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      scripted.add(a);
      try { t.iterations === Infinity ? a.pause() : a.finish(); } catch { try { a.pause(); } catch {} }
    }
  };
  settle();
  morse.every(1000, settle);
  undo.push(() => scripted.forEach(a => { try { if (a.playState === "paused") a.play(); } catch {} }));
}

function readingRuler() {
  morse.css(`.morse-ruler { position: fixed; left: 0; right: 0; pointer-events: none; z-index: 2147483646; background: rgba(0, 0, 0, 0.42); }
.morse-ruler.top { top: 0; border-bottom: 2px solid rgba(255, 255, 255, 0.85); }
.morse-ruler.bottom { bottom: 0; border-top: 2px solid rgba(255, 255, 255, 0.85); }
@media print { .morse-ruler { display: none; } }`);
  const top = morse.el("div", { class: "morse-ruler top", "aria-hidden": "true" });
  const bottom = morse.el("div", { class: "morse-ruler bottom", "aria-hidden": "true" });
  document.documentElement.append(top, bottom);
  // A band about three lines tall, centered on the pointer.
  const band = () => Math.max(44, Math.round(parseFloat(getComputedStyle(document.body).fontSize || "16") * 3.4));
  let y = innerHeight / 3, raf = 0;
  const draw = () => {
    raf = 0;
    const h = band();
    top.style.height = Math.max(0, y - h / 2) + "px";
    bottom.style.height = Math.max(0, innerHeight - y - h / 2) + "px";
  };
  const at = v => { y = Math.max(0, Math.min(innerHeight, v)); if (!raf) raf = requestAnimationFrame(draw); };
  morse.on(document, "pointermove", e => at(e.clientY), { capture: true, passive: true });
  // Keyboard users: the band follows focus.
  morse.on(document, "focusin", e => {
    if (!e.target.getBoundingClientRect) return;
    const r = e.target.getBoundingClientRect();
    if (r.height && r.height < innerHeight / 2) at(r.top + r.height / 2);
  }, true);
  morse.on(window, "resize", () => at(y));
  undo.push(() => cancelAnimationFrame(raf));
  draw();
}

function calmPage() {
  // Fixed or sticky strips that announce, sell, ask about cookies or offer a
  // chat. Never the site's own header, navigation or main content.
  const HINT = /cookie|consent|gdpr|privacy-?banner|announce|promo|newsletter|subscribe|sign-?up-?bar|app-?banner|smart-?banner|notice-?bar|alert-?bar|top-?bar-?promo|chat|messenger|livechat|intercom|drift|crisp|zendesk|hubspot|tawk|olark|freshchat|helpscout|launcher/i;
  const words = el => [el.id, typeof el.className === "string" ? el.className : "", el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("name"), el.getAttribute("data-testid")].filter(Boolean).join(" ");
  let unlocked = false;
  const sweep = () => {
    for (const el of document.querySelectorAll("body *")) {
      if (el.hasAttribute("data-morse-calm") || el.closest("[data-morse-ui], [data-morse], [data-morse-calm]")) continue;
      if (el.matches("header, nav, main, article, [role=banner], [role=navigation], [role=main]") || el.querySelector("nav, main, article, h1, [role=main], [role=navigation]")) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      const tag = words(el) + (el.localName === "iframe" ? " " + (el.getAttribute("src") || "") : "");
      if (!HINT.test(tag)) continue;
      const r = el.getBoundingClientRect();
      el.setAttribute("data-morse-calm", "");
      undo.push(() => el.removeAttribute("data-morse-calm"));
      if (!unlocked && r.width * r.height > innerWidth * innerHeight * 0.3) {
        unlocked = true;
        morse.css("html, body { overflow: auto !important; }");
      }
    }
  };
  sweep();
  morse.every(1500, sweep);
}

function noJustify() {
  morse.watch("p, li, dd, blockquote, td, div", el => {
    if (getComputedStyle(el).textAlign !== "justify") return;
    el.setAttribute("data-morse-nojustify", "");
    undo.push(() => el.removeAttribute("data-morse-nojustify"));
  });
}

// ---- page tools: the CSS

const READ_FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
// Only fonts already on the computer; nothing is downloaded.
const DYSLEXIA_FONT = `"OpenDyslexic", "Atkinson Hyperlegible", "Lexend", Verdana, Tahoma, "Trebuchet MS", sans-serif`;
// Icons drawn with fonts and code keep their own font.
const KEEP_FONT = `code, pre, kbd, samp, tt, var, code *, pre *, kbd *, i, svg, svg *, math, math *, [class*="icon" i], [class*="icon" i] *, [class*="symbol" i], [class*="material" i], [class*="glyph" i], [class^="fa"], [class*=" fa-"], [aria-hidden="true"], [aria-hidden="true"] *`;
const ARTICLE = `article, main, [role=main], [role=article], [itemprop=articleBody], .post, .article, .entry-content, .post-content, .article-body, .story-body`;

function readableCss(dys) {
  const font = dys ? DYSLEXIA_FONT : READ_FONT;
  return `:where(body, body :not(${KEEP_FONT})) {
  font-family: ${font} !important;
  letter-spacing: ${dys ? "0.05em" : "0.02em"} !important;
  word-spacing: ${dys ? "0.16em" : "0.08em"} !important;
}
:where(p, li, dd, dt, blockquote, figcaption, td, th, label, summary, article, section) {
  line-height: ${dys ? 1.8 : 1.6} !important;
}
:where(${ARTICLE}) :where(p, li, dd, blockquote, figcaption, h1, h2, h3, h4, h5, h6) {
  max-width: 70ch !important;
}
/* Justified text leaves uneven gaps between words; line it up on one side. */
[data-morse-nojustify] {
  text-align: start !important;
}`;
}

const TARGETS_CSS = `[data-morse-big]:not([data-morse-big="box"]) {
  min-width: 44px !important;
  min-height: 44px !important;
  box-sizing: border-box !important;
}
[data-morse-big="inline"] {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
[data-morse-big="flex"] {
  display: flex !important;
  align-items: center !important;
}
[data-morse-big="box"] {
  width: 24px !important;
  height: 24px !important;
}`;

const UNDERLINE_CSS = `a[href]:not([role=button], [role=tab], [role=menuitem]) {
  text-decoration-line: underline !important;
  text-decoration-thickness: max(1px, 0.08em) !important;
  text-underline-offset: 0.18em !important;
}`;

// Like the reduce-motion setting, for this page: animations jump to their
// end, transitions are instant, scrolling doesn't glide.
const STILL_CSS = `*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
}`;

// A two-tone ring that shows on light and dark backgrounds alike.
const OUTLINE_CSS = `:root :focus-visible:focus-visible {
  outline: 3px solid #111 !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 2px #fff !important;
}`;

const CALM_CSS = `[data-morse-calm],
:where(#onetrust-banner-sdk, #onetrust-consent-sdk, #CybotCookiebotDialog, #cookie-law-info-bar, .cc-window, .cc-banner, #truste-consent-track, .qc-cmp2-container,
  #intercom-container, .intercom-lightweight-app, .intercom-launcher, #hubspot-messages-iframe-container, #drift-widget, #drift-frame-controller, #drift-frame-chat,
  .crisp-client, #crisp-chatbox, #launcher[title*="chat" i], iframe#launcher, .zEWidget-launcher, #tawkchat-container, #chat-widget-container, #olark-wrapper, #fc_frame, #beacon-container) {
  display: none !important;
}`;

const CONTRAST_CSS = `::placeholder {
  color: currentColor !important;
  opacity: 0.75 !important;
}`;

const NEEDS = {
  contrast: ["colors", "contrast"],
  targets: ["targets"],
  still: ["still"],
  ruler: ["ruler"],
  calm: ["calm"],
};

// One page tool -> the quick mod's code. opts: { dyslexia } for "readable".
export function compileA11y(kind, opts = {}) {
  if (!A11Y_TOOLS[kind]) return { css: "", js: "" };
  const title = a11yTitle(kind, opts);
  const css = {
    contrast: CONTRAST_CSS, targets: TARGETS_CSS, readable: readableCss(!!opts.dyslexia), underline: UNDERLINE_CSS,
    still: STILL_CSS, outline: OUTLINE_CSS, ruler: "", calm: CALM_CSS,
  }[kind];
  const body = {
    contrast: "contrastUp(7);",
    targets: "bigTargets();",
    readable: "noJustify();",
    still: "stillPage();",
    ruler: "readingRuler();",
    calm: "calmPage();",
  }[kind] || "";
  const need = new Set(NEEDS[kind] || []);
  if (kind === "readable") need.add("justify");
  const out = { css: css ? `/* ${title}: made by Morse, no model involved */\n${css}\n` : "", js: "" };
  if (!body) return out;
  const helpers = [];
  if (need.has("colors")) helpers.push(parseColor, relLuminance, contrastRatio, overColor, strongerColor, backgroundOf, hasOwnText);
  if (need.has("contrast")) helpers.push(attrStyles, contrastUp);
  if (need.has("targets")) helpers.push(bigTargets);
  if (need.has("still")) helpers.push(stillPage);
  if (need.has("ruler")) helpers.push(readingRuler);
  if (need.has("calm")) helpers.push(calmPage);
  if (need.has("justify")) helpers.push(noJustify);
  out.js = [
    `// ${title}: made by Morse, no model involved. Turning it off undoes all of it.`,
    "const undo = [];",
    ...helpers.map(f => f.toString()),
    "",
    body,
    "",
    "return () => undo.splice(0).reverse().forEach(f => f());",
    "",
  ].join("\n");
  return out;
}

// ---- Check this page: fixes
//
// Fix shapes (from auditPage, or from Describe this image):
//   { kind: "name" | "label", sel, text }   aria-label
//   { kind: "alt", sel, text }               alt text ("" marks decoration)
//   { kind: "size", sel, display? }          at least 44 x 44 pixels
//   { kind: "color", sel, color: "#rrggbb" } stronger text color
//   { kind: "still", sel }                   no autoplay

const SEL_OK = s => typeof s === "string" && s.length > 0 && s.length < 800 && !/[{};]|\/\*|<\//.test(s.replace(/\\./g, ""));
const cleanText = (t, n) => String(t ?? "").replace(/[\u0000-\u001f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const FIX_KINDS = ["name", "label", "alt", "size", "color", "still"];

export function mergeFixes(old = [], add = []) {
  const out = new Map();
  for (const f of [...old, ...add]) if (f && FIX_KINDS.includes(f.kind) && SEL_OK(f.sel)) out.set(`${f.kind === "label" ? "name" : f.kind}\u0000${f.sel}`, f);
  return [...out.values()];
}

function setAttr(sel, name, value) {
  morse.watch(sel, el => {
    const had = el.hasAttribute(name), was = el.getAttribute(name);
    el.setAttribute(name, value);
    undo.push(() => {
      if (el.getAttribute(name) !== value) return;
      had ? el.setAttribute(name, was) : el.removeAttribute(name);
    });
  });
}

function noAutoplay(sel) {
  morse.watch(sel, m => {
    if (m.hasAttribute("autoplay")) { m.removeAttribute("autoplay"); undo.push(() => m.setAttribute("autoplay", "")); }
    if (m.pause && !m.paused) m.pause();
  });
}

export function compileFixes(fixes = []) {
  const css = [], body = [];
  let attrs = false, still = false;
  for (const f of mergeFixes([], Array.isArray(fixes) ? fixes : [])) {
    const sel = JSON.stringify(f.sel);
    if (f.kind === "name" || f.kind === "label") {
      const t = cleanText(f.text, 200);
      if (!t) continue;
      attrs = true;
      body.push(`setAttr(${sel}, "aria-label", ${JSON.stringify(t)});`);
    } else if (f.kind === "alt") {
      attrs = true;
      body.push(`setAttr(${sel}, "alt", ${JSON.stringify(cleanText(f.text, 400))});`);
    } else if (f.kind === "size") {
      const d = f.display === "inline" ? "\n  display: inline-flex !important;\n  align-items: center !important;\n  justify-content: center !important;"
        : f.display === "flex" ? "\n  display: flex !important;\n  align-items: center !important;" : "";
      css.push(`${f.sel} {\n  min-width: 44px !important;\n  min-height: 44px !important;\n  box-sizing: border-box !important;${d}\n}`);
    } else if (f.kind === "color") {
      if (!/^#[0-9a-f]{6}$/i.test(f.color || "")) continue;
      css.push(`${f.sel} {\n  color: ${f.color} !important;\n}`);
    } else if (f.kind === "still") {
      still = true;
      body.push(`noAutoplay(${sel});`);
    }
  }
  const out = { css: css.length ? `/* ${FIX_TITLE}: made by Morse, no model involved */\n${css.join("\n")}\n` : "", js: "" };
  if (!body.length) return out;
  out.js = [
    `// ${FIX_TITLE}: made by Morse, no model involved. Re-applies after re-renders.`,
    "const undo = [];",
    ...(attrs ? [setAttr.toString()] : []),
    ...(still ? [noAutoplay.toString()] : []),
    "",
    ...body,
    "",
    "return () => undo.splice(0).reverse().forEach(f => f());",
    "",
  ].join("\n");
  return out;
}

export function summarizeFixes(fixes = []) {
  const n = {};
  for (const f of fixes) n[f.kind] = (n[f.kind] || 0) + 1;
  const words = { name: "named", label: "labeled", alt: "described", size: "enlarged", color: "darkened", still: "stopped" };
  const s = Object.entries(n).map(([k, c]) => `${words[k]} ${c}`).join(" · ");
  return s ? s[0].toUpperCase() + s.slice(1) : "No fixes";
}

// ---- Check this page: the rules (run in the page, by the runtime)

const INTERACTIVE = "button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=option], summary, input[type=button], input[type=submit], input[type=reset], input[type=image]";
const FIELDS = "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), select, textarea, [role=textbox], [role=combobox], [role=searchbox]";
const TARGETS = "button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], summary, select, input:not([type=hidden])";

function visibleEl(el) {
  if (!el.isConnected || el.closest("[aria-hidden=true], [data-morse-ui], [inert]")) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

function nameFromContent(n) {
  let s = "";
  for (const c of n.childNodes) {
    if (c.nodeType === 3) { s += c.nodeValue; continue; }
    if (c.nodeType !== 1 || c.getAttribute("aria-hidden") === "true") continue;
    const cs = getComputedStyle(c);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (c.localName === "img" || (c.localName === "input" && c.type === "image")) s += " " + (c.getAttribute("alt") || "") + " ";
    else if (c.localName === "svg") s += " " + (c.getAttribute("aria-label") || c.querySelector("title")?.textContent || "") + " ";
    else if (c.getAttribute("aria-label")) s += " " + c.getAttribute("aria-label") + " ";
    else s += " " + nameFromContent(c) + " ";
  }
  return s;
}

// What a screen reader would call this (a simplified version of the
// accessible name rules: labelledby, aria-label, labels, alt, content, title).
export function accessibleName(el) {
  const doc = el.ownerDocument;
  const tidy = s => String(s || "").replace(/\s+/g, " ").trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = tidy(by.split(/\s+/).map(id => doc.getElementById(id)?.textContent || "").join(" ")); if (t) return t; }
  const aria = tidy(el.getAttribute("aria-label"));
  if (aria) return aria;
  if (el.matches("input, select, textarea")) {
    if (/^(button|submit|reset)$/.test(el.type)) return tidy(el.value) || (el.type === "submit" ? "Submit" : el.type === "reset" ? "Reset" : "");
    if (el.type === "image") return tidy(el.getAttribute("alt"));
    const labels = el.labels ? tidy([...el.labels].map(l => nameFromContent(l)).join(" ")) : "";
    if (labels) return labels;
    return tidy(el.getAttribute("title"));
  }
  if (el.localName === "img") return tidy(el.getAttribute("alt"));
  const text = tidy(nameFromContent(el));
  if (text) return text;
  return tidy(el.getAttribute("title"));
}

const ICON_WORDS = {
  close: "Close", x: "Close", times: "Close", xmark: "Close", cross: "Close", dismiss: "Close", cancel: "Cancel",
  trash: "Delete", delete: "Delete", bin: "Delete", remove: "Remove", minus: "Remove",
  search: "Search", magnify: "Search", magnifier: "Search", "magnifying-glass": "Search", find: "Search",
  cog: "Settings", gear: "Settings", settings: "Settings", sliders: "Settings", preferences: "Settings",
  menu: "Menu", bars: "Menu", hamburger: "Menu", navicon: "Menu",
  plus: "Add", add: "Add", new: "New", create: "Create",
  pencil: "Edit", edit: "Edit", pen: "Edit", write: "Write",
  heart: "Like", like: "Like", thumbs: "Like", star: "Favorite", favorite: "Favorite", bookmark: "Save", save: "Save",
  share: "Share", bell: "Notifications", notification: "Notifications", notifications: "Notifications", alert: "Alerts",
  user: "Account", person: "Account", account: "Account", profile: "Profile", avatar: "Account",
  home: "Home", house: "Home", download: "Download", upload: "Upload", print: "Print", printer: "Print",
  play: "Play", pause: "Pause", stop: "Stop", next: "Next", forward: "Next", previous: "Previous", prev: "Previous", back: "Back",
  "arrow-left": "Back", "chevron-left": "Previous", "chevron-right": "Next", "arrow-right": "Next", "caret-down": "Show more", "chevron-down": "Show more",
  more: "More", ellipsis: "More", dots: "More", kebab: "More", overflow: "More",
  filter: "Filter", sort: "Sort", refresh: "Refresh", reload: "Refresh", sync: "Refresh", copy: "Copy", clipboard: "Copy", link: "Copy link",
  mail: "Email", envelope: "Email", email: "Email", phone: "Call", calendar: "Calendar", info: "Information", help: "Help", question: "Help",
  lock: "Lock", unlock: "Unlock", eye: "Show", "eye-slash": "Hide", cart: "Cart", "shopping-cart": "Cart", basket: "Basket", bag: "Bag",
  send: "Send", "paper-plane": "Send", mic: "Microphone", microphone: "Microphone", camera: "Camera", image: "Picture", photo: "Picture",
  attach: "Attach", paperclip: "Attach", expand: "Expand", collapse: "Collapse", fullscreen: "Full screen", volume: "Volume", mute: "Mute",
  globe: "Language", language: "Language", moon: "Dark mode", sun: "Light mode", logout: "Sign out", "sign-out": "Sign out", login: "Sign in", "sign-in": "Sign in",
  facebook: "Facebook", twitter: "X (Twitter)", instagram: "Instagram", linkedin: "LinkedIn", github: "GitHub", youtube: "YouTube", rss: "RSS feed",
};
const SYMBOL_WORDS = { "×": "Close", "✕": "Close", "✖": "Close", "x": "Close", "☰": "Menu", "≡": "Menu", "+": "Add", "＋": "Add", "−": "Remove", "-": "Remove", "…": "More", "⋯": "More", "⋮": "More", "‹": "Previous", "«": "Previous", "←": "Back", "›": "Next", "»": "Next", "→": "Next", "✓": "Done", "✔": "Done", "🔍": "Search", "⚙": "Settings", "⚙️": "Settings", "♥": "Like", "❤": "Like", "★": "Favorite", "☆": "Favorite", "▶": "Play", "⏸": "Pause", "?": "Help" };

const sentence = s => { s = s.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : ""; };
const hashed = s => /\d{3,}|[a-z]\d[a-z]\d|^[a-z0-9]{12,}$/i.test(s);

function iconWord(token) {
  let t = String(token || "").toLowerCase().replace(/^#/, "");
  const m = /^(?:icon|icons|ico|fa|fas|far|fab|fal|fa-solid|fa-regular|bi|mdi|ri|ti|lucide|glyphicon|ion|ionicon|la|las|lab|ph|feather|octicon|gg|uil|bx|bxs|i)[-_:](.+)$/.exec(t);
  if (m) t = m[1];
  else if (/[-_](icon|ico)$/.test(t)) t = t.replace(/[-_](icon|ico)$/, "");
  else return "";
  const base = t.replace(/[-_](outline|outlined|filled|fill|solid|regular|round|rounded|sharp|alt|lg|sm|xs|xl|o|circle|square|line|light|bold|\d+)$/g, "").replace(/[-_](outline|filled|fill|alt|o|circle|\d+)$/g, "");
  return ICON_WORDS[base] || ICON_WORDS[base.split(/[-_]/)[0]] || ICON_WORDS[base.split(/[-_]/).pop()] || "";
}

// A likely name for a control that has none, from what's around it:
// { text, from } or null (then the model is asked).
export function guessName(el) {
  const tidy = s => String(s || "").replace(/\s+/g, " ").trim();
  for (const a of ["data-tooltip", "data-tip", "data-title", "data-original-title", "data-bs-original-title", "data-label", "data-hint", "tooltip", "mattooltip"]) {
    const v = tidy(el.getAttribute(a));
    if (v && v.length < 80) return { text: v, from: "tooltip" };
  }
  const desc = el.getAttribute("aria-describedby");
  if (desc) {
    const t = tidy(desc.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent || "").join(" "));
    if (t && t.length < 60) return { text: t, from: "tooltip" };
  }
  const text = tidy(el.textContent);
  if (text && SYMBOL_WORDS[text]) return { text: SYMBOL_WORDS[text], from: "symbol" };
  // Icon names in classes, data-icon or <use href="#icon-...">.
  const tokens = [];
  for (const n of [el, ...el.querySelectorAll("*")].slice(0, 12)) {
    if (typeof n.className === "string") tokens.push(...n.className.split(/\s+/));
    else if (n.className && n.className.baseVal) tokens.push(...n.className.baseVal.split(/\s+/));
    for (const a of ["data-icon", "data-lucide", "data-feather", "icon", "name"]) { const v = n.getAttribute(a); if (v && n !== el) tokens.push("icon-" + v); }
    if (n.localName === "use") tokens.push(n.getAttribute("href") || n.getAttribute("xlink:href") || "");
  }
  for (const t of tokens) { const w = iconWord(t.replace(/^.*#/, "")); if (w) return { text: w, from: "icon" }; }
  // Where a link goes.
  const href = el.localName === "a" ? el.getAttribute("href") || "" : "";
  if (/^mailto:/i.test(href)) return { text: "Email", from: "link address" };
  if (/^tel:/i.test(href)) return { text: "Call", from: "link address" };
  if (href && !/^(#|javascript:)/i.test(href)) {
    try {
      const u = new URL(href, el.ownerDocument.baseURI);
      const seg = u.pathname.split("/").filter(Boolean).pop() || (u.host !== el.ownerDocument.location?.host ? u.host.replace(/^www\./, "") : "");
      const w = seg.replace(/\.(html?|php|aspx?)$/i, "");
      if (w && w.length < 32 && !hashed(w)) return { text: ICON_WORDS[w.toLowerCase()] || sentence(w), from: "link address" };
      if (!u.pathname.replace(/\//g, "") && u.host === el.ownerDocument.location?.host) return { text: "Home", from: "link address" };
    } catch {}
  }
  for (const a of ["data-testid", "id", "name"]) {
    const v = el.getAttribute(a) || "";
    const w = v.replace(/(^|[-_])(btn|button|link|icon|ico|action|nav|js)(?=$|[-_])/gi, "$1").replace(/^[-_]+|[-_]+$/g, "");
    if (/^[a-z][a-z _-]{2,30}$/i.test(w)) return { text: ICON_WORDS[w.toLowerCase()] || sentence(w), from: a === "id" ? "its id" : "its name" };
  }
  return null;
}

// A likely label for a form field that has none.
export function guessFieldLabel(el) {
  const tidy = s => String(s || "").replace(/\s+/g, " ").trim();
  const ph = tidy(el.getAttribute("placeholder"));
  if (ph) return { text: ph.replace(/[.…]+$/, ""), from: "placeholder" };
  // Text right before it: <span>Email</span> <input>
  let prev = el.previousSibling;
  while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev = prev.previousSibling;
  const t = prev && tidy(prev.nodeType === 3 ? prev.nodeValue : !prev.matches?.("input, select, textarea, button") ? prev.textContent : "");
  if (t && t.length <= 40) return { text: t.replace(/:$/, ""), from: "nearby text" };
  for (const a of ["name", "id"]) {
    const v = el.getAttribute(a) || "";
    if (/^[a-z][a-z _-]{2,30}$/i.test(v)) return { text: sentence(v), from: a === "id" ? "its id" : "its name" };
  }
  return null;
}

const isLarge = cs => { const px = parseFloat(cs.fontSize) || 16, w = parseInt(cs.fontWeight, 10) || 400; return px >= 24 || (px >= 18.66 && w >= 700); };

// Every problem found, in page order per rule:
//   { rule: "alt" | "name" | "contrast" | "target" | "label" | "autoplay", el, ... }
export function auditPage(doc = document, { limit = 40, budget = 4000 } = {}) {
  const issues = [];
  const add = (rule, el, data = {}) => { if (issues.filter(i => i.rule === rule).length < limit) issues.push({ rule, el, ...data }); };
  const all = sel => [...doc.querySelectorAll(sel)];

  // Pictures with no description.
  for (const el of all('img:not([alt]), input[type=image]:not([alt]), [role=img]:not(svg), svg[role=img]')) {
    if (!visibleEl(el) || el.matches('[role=presentation], [role=none]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 && r.height < 8) continue; // tracking pixels
    if (el.matches("[role=img]") && accessibleName(el)) continue;
    // A picture inside a link or button that already says what it does is decoration.
    const host = el.parentElement?.closest("a, button");
    const decorative = el.localName === "img" && !!host && !!nameFromContent(host).replace(/\s+/g, "").length;
    add("alt", el, decorative ? { guess: { text: "", from: "decoration" } } : {});
  }

  // Buttons and links with no name, or only a symbol.
  for (const el of all(INTERACTIVE)) {
    if (!visibleEl(el)) continue;
    const name = accessibleName(el);
    if (name && /[\p{L}\p{N}]/u.test(name)) continue;
    add("name", el, { name, guess: guessName(el) });
  }

  // Form fields with no label (a placeholder disappears as you type).
  for (const el of all(FIELDS)) {
    if (!visibleEl(el)) continue;
    if (accessibleName(el)) continue;
    add("label", el, { guess: guessFieldLabel(el) });
  }

  // Things too small to click (under 24 x 24); links inside sentences are fine.
  for (const el of all(TARGETS)) {
    if (!visibleEl(el) || el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) continue;
    if (el.matches("a")) {
      const block = el.parentElement?.closest("p, li, dd, td, th, blockquote, figcaption, label") || el.parentElement;
      const links = block ? [...block.querySelectorAll("a")].reduce((n, a) => n + a.textContent.trim().length, 0) : 0;
      if (block && block.textContent.trim().length - links > 20) continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) continue;
    const d = getComputedStyle(el).display;
    add("target", el, { w: Math.round(r.width), h: Math.round(r.height), display: el.matches("button, input, select") ? "" : d === "inline" || d === "inline-block" ? "inline" : "flex" });
  }

  // Text too light for its background (4.5:1, or 3:1 for large text).
  let seen = 0;
  for (const el of all("body *")) {
    if (++seen > budget) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName) || !hasOwnText(el) || !visibleEl(el)) continue;
    if (el.matches(":disabled, [aria-disabled=true] *, [aria-disabled=true]")) continue;
    const cs = getComputedStyle(el), bg = backgroundOf(el), fg = textColorOf(el, bg);
    if (!fg) continue;
    const need = isLarge(cs) ? 3 : 4.5, ratio = contrastRatio(fg, bg);
    if (ratio >= need) continue;
    const fix = strongerColor(parseColor(cs.color), bg, need + 0.3);
    add("contrast", el, { ratio: Math.round(ratio * 100) / 100, need, fg: hexColor(fg), bg: hexColor(bg), color: hexColor(fix) });
  }

  // Video and sound that start by themselves.
  for (const el of all("video, audio")) {
    if (el.hasAttribute("autoplay") || (!el.paused && !el.ended && el.currentTime < 2)) add("autoplay", el, { muted: el.muted });
  }
  return issues;
}

export const AUDIT_ORDER = ["name", "alt", "label", "contrast", "target", "autoplay"];

// Plain words for a group of problems: { title, help }.
export function auditSummary(rule, n, items = []) {
  const one = n === 1;
  switch (rule) {
    case "alt": return { title: one ? "1 picture has no description" : `${n} pictures have no description`, help: "Screen readers can't say what they show." };
    case "name": return { title: one ? "1 button or link has no name" : `${n} buttons and links have no name`, help: "A screen reader only says “button”, or reads out a symbol." };
    case "label": return { title: one ? "1 form field has no label" : `${n} form fields have no label`, help: "Someone using a screen reader won't know what to type." };
    case "contrast": {
      const worst = items.length ? Math.min(...items.map(i => i.ratio || 21)) : 0;
      return { title: one ? "1 piece of text is hard to read" : `${n} pieces of text are hard to read`, help: `The text is too light for its background${worst ? ` (as low as ${worst.toFixed(1)} to 1; 4.5 to 1 is the minimum)` : ""}.` };
    }
    case "target": return { title: one ? "1 thing is too small to click" : `${n} things are too small to click`, help: "Under 24 pixels. Hard to hit with a shaky hand or a finger." };
    case "autoplay": return { title: one ? "1 video or sound plays by itself" : `${n} videos or sounds play by themselves`, help: "Moving or sounding content is distracting and hard to stop." };
    default: return { title: `${n} problems`, help: "" };
  }
}

// The request for problems that need judgment, with the exact selectors.
// A selector inside `…` in the request: built from the page's own ids and
// labels, so a backtick or a line break in one could end the quote and put
// the page's words in the request as the person's. CSS escapes (\60 is a
// backtick) keep it the same selector.
const quotedSel = s => `\`${String(s).replace(/\\?`/g, "\\60 ").replace(/\r/g, "\\d ").replace(/\n/g, "\\a ").replace(/[\u2028\u2029]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}\``;

export function fixRequest(rule, sels = []) {
  const n = sels.length, list = sels.map(quotedSel).join(", ");
  switch (rule) {
    case "name": return `Give ${n === 1 ? "this icon button or link an accessible name" : `these ${n} icon buttons and links accessible names`} (aria-label) that ${n === 1 ? "says what it does" : "say what each does"}, based on ${n === 1 ? "its icon, tooltip" : "their icons, tooltips"} and what's around ${n === 1 ? "it" : "them"}: ${list}. Change nothing else.`;
    case "label": return `Give ${n === 1 ? "this form field a label" : `these ${n} form fields labels`} that screen readers can read (aria-label), based on the text and layout around ${n === 1 ? "it" : "them"}: ${list}. Change nothing else.`;
    case "alt": return `Give ${n === 1 ? "this picture a short description" : `these ${n} pictures short descriptions`} (alt text) based on ${n === 1 ? "its" : "their"} file names, captions and nearby text: ${list}. Change nothing else.`;
    default: return "";
  }
}

// ---- Describe this image: the prompt (core/prompt.js sends requests that
// carry context.a11y.image here). Content blocks use the Anthropic format;
// core/providers.js converts them for the other models.

export const IMAGE_PROMPT = `You describe pictures for people who can't see them. The user pointed at a picture in an app or website.

Reply in exactly this format and nothing else:
ANSWER: <one or two short, plain sentences>

- Say what the picture shows and what it is for on this page. Read out any important text in it, and the main numbers of a chart.
- Don't start with "Image of" or "This picture shows". No guesses about who a person is. No jargon.
- If it is only decoration, reply: ANSWER: Decoration, nothing important.`;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_IMAGE_CHARS = 900_000; // base64; the Morse helper takes 1 MB per request

export function imageMessages({ request, context = {} }) {
  const im = context.a11y?.image || {};
  if (!IMAGE_TYPES.includes(im.mediaType) || typeof im.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(im.data.slice(0, 200))) throw new Error("Couldn't read that picture. Try another one.");
  if (im.data.length > MAX_IMAGE_CHARS) throw new Error("That picture is too big to describe. Try a smaller one.");
  const lines = [`Page: ${cleanText(context.title, 200) || "untitled"}${context.url ? ` (${cleanText(context.url, 300)})` : ""}`];
  if (im.near) lines.push(`Text near the picture: ${cleanText(im.near, 600)}`);
  if (im.alt) lines.push(`Its current description: ${cleanText(im.alt, 300)}`);
  lines.push(`Request: ${cleanText(request, 300) || "Describe this picture"}`);
  return [
    { role: "system", content: IMAGE_PROMPT },
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } }, { type: "text", text: lines.join("\n") }] },
  ];
}
