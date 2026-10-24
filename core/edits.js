// God mode: manual edits -> deterministic mod code, with no model involved.
//
// The in-app toolbar records what the user did as a list of small edit
// objects; compileEdits() turns that list into the same { css, js } every mod
// has, so manual edits persist, undo, export and share like generated ones.
//
// Pure and dependency-free: tests import it, and runtime/bundle.js inlines it
// into the runtime (exports become locals there). The helpers that run inside
// the page are real functions here and are embedded with .toString(), so the
// code a user sees under "Code" is plain, readable JavaScript.
//
// Edit shapes (every edit may also carry `shadow: [hostSelector, ...]` for
// elements inside open shadow roots, and a `label` for summaries):
//   { op: "hide",      sel }
//   { op: "move",      sel, x, y, base?, inline? }  absolute offset in CSS px; base = original transform
//   { op: "resize",    sel, w?, h?, inline?, flex? }
//   { op: "style",     sel, props: { "color": "#fff", ... } }
//   { op: "text",      sel, i, text, was }       i-th non-empty text run directly inside sel
//   { op: "duplicate", sel, key }                copy inserted after sel, tagged data-morse-dup=key
//   { op: "page",      kind: "dark" | "light" | "zoom" | "noads" | "focus", level?, sel? }

export const EDIT_TITLE = "Manual edits";

export const PAGE_TOOLS = {
  dark: { title: "Dark mode" },
  light: { title: "Light mode" },
  zoom: { title: "Text size" },
  noads: { title: "Hide ads & popups" },
  focus: { title: "Focus mode" },
};

const ZOOM_STEP = 1.1;
export const zoomFor = level => Math.round(Math.pow(ZOOM_STEP, Math.max(-6, Math.min(8, Number(level) || 0))) * 1000) / 1000;

// ---- validation: edits can come from shared mods, so nothing is trusted.
const SEL_OK = s => typeof s === "string" && s.length > 0 && s.length < 800 && !/[{};]|\/\*|<\//.test(s.replace(/\\./g, ""));
const PROP_OK = p => typeof p === "string" && /^-?[a-z][a-z-]{0,40}$/.test(p);
const cssValue = v => String(v ?? "").replace(/[;{}!\\<>]/g, "").replace(/\/\*/g, "").trim().slice(0, 300);
const px = v => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) ? n : 0; };
const targetOk = e => SEL_OK(e.sel) && (!e.shadow || (Array.isArray(e.shadow) && e.shadow.every(SEL_OK)));
const str = v => JSON.stringify(v);

// ---- page tools
// Smart invert. 0.93 instead of 1 keeps whites off pure black and text off
// pure white; media get a plain invert back, which leaves them very slightly
// dimmed, the way dark themes usually show photos.
const INVERT_CSS = `html {
  filter: invert(0.93) hue-rotate(180deg) !important;
  background-color: #fff !important;
}
:where(img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"], [style*="background: url"], [style*="background:url"]):not(:where(picture, video, [style*="background-image"], [style*="background: url"], [style*="background:url"]) *) {
  filter: invert(1) hue-rotate(180deg) !important;
}`;

const ADS_CSS = `:where(ins.adsbygoogle, [id^="google_ads"], [id^="div-gpt-ad"], [data-ad], [data-ad-slot], [data-adunit], [data-ad-unit],
  .ad, .ads, .advert, .advertisement, [class*="ad-slot"], [class*="adslot"], [class*="ad-container"], [class*="ad-banner"],
  [aria-label="Advertisement" i], [aria-label="Sponsored" i], [aria-label="Ads" i],
  iframe[src*="doubleclick."], iframe[src*="googlesyndication."], iframe[id^="google_ads"],
  [id^="taboola"], [id*="outbrain"], [class*="taboola"], [class*="outbrain"], [data-morse-popup]) {
  display: none !important;
}`;

const FOCUS_CSS = `[data-morse-focus-hide] { display: none !important; }
[data-morse-focus-path] { grid-template-columns: minmax(0, 1fr) !important; grid-template-areas: none !important; }
[data-morse-focus] { grid-column: 1 / -1 !important; float: none !important; width: auto !important; max-width: 760px !important; margin-left: auto !important; margin-right: auto !important; }`;

// ---- helpers that run in the page (embedded via toString)

/* global morse, undo, dupHooks */
function luminance(c) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c);
  if (!m || (m[4] !== undefined && +m[4] < 0.5)) return null;
  return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
}

export function pageIsDark() {
  const starts = [document.elementFromPoint(innerWidth / 2, innerHeight / 3), document.body, document.documentElement];
  for (const start of starts) {
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const l = luminance(getComputedStyle(n).backgroundColor);
      if (l != null) return l < 0.45;
    }
  }
  return false;
}

// Parts that already look the way the page is heading (a dark masthead or a
// brand-colored button on a light page) are flipped back, so they keep their
// colors and only the rest of the page changes.
function keepAsIs(toDark) {
  const media = "img, video, picture, canvas, iframe, embed, object, svg image";
  morse.css(`[data-morse-keep] { filter: invert(1) hue-rotate(180deg) !important; }\n[data-morse-keep] :where(${media}) { filter: none !important; }`);
  const page = innerWidth * innerHeight;
  morse.watch("body *", el => {
    if (el.closest("[data-morse-keep]")) return;
    const l = luminance(getComputedStyle(el).backgroundColor);
    if (l == null || (toDark ? l > 0.3 : l < 0.75)) return;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > page * 0.5) return;
    el.setAttribute("data-morse-keep", "");
    undo.push(() => el.removeAttribute("data-morse-keep"));
  });
}

function each(sel, shadow, fn) {
  const observe = (root, go) => {
    const mo = new MutationObserver(go);
    mo.observe(root, { childList: true, subtree: true });
    undo.push(() => mo.disconnect());
  };
  const scan = (root, s, f) => {
    const seen = new WeakSet();
    const go = () => root.querySelectorAll(s).forEach(el => { if (!seen.has(el)) { seen.add(el); f(el); } });
    go();
    observe(root, go);
  };
  if (shadow && shadow.length) {
    const step = (root, i) => scan(root, shadow[i], host => {
      if (host.shadowRoot) i + 1 < shadow.length ? step(host.shadowRoot, i + 1) : (sel === ":host" ? fn(host.shadowRoot) : scan(host.shadowRoot, sel, fn));
    });
    return step(document, 0);
  }
  const dup = /^\[data-morse-dup="([^"]+)"\]\s*(.*)$/.exec(sel);
  if (dup) {
    const [, key, rest] = dup;
    const run = copy => { const el = rest ? copy.querySelector(":scope " + rest) : copy; if (el) fn(el); };
    (dupHooks[key] = dupHooks[key] || []).push(run);
    document.querySelectorAll(`[data-morse-dup="${key}"]`).forEach(run);
    return;
  }
  morse.watch(sel, fn);
}

function rename(el, i, text, was) {
  const runs = () => [...el.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim());
  const set = () => {
    const n = runs()[i];
    if (!n || n.nodeValue.trim() === text) return;
    const [, before, , after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.nodeValue);
    n.nodeValue = before + text + after;
  };
  set();
  // Apps re-render text in place; put the new text back whenever they do.
  const mo = new MutationObserver(set);
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  undo.push(() => {
    mo.disconnect();
    const n = runs()[i];
    if (n && was != null && n.nodeValue.trim() === text) n.nodeValue = n.nodeValue.replace(text, was);
  });
}

function cloneAfter(el, key) {
  const next = el.nextElementSibling;
  if (next && next.getAttribute("data-morse-dup") === key) return;
  const copy = el.cloneNode(true);
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
  copy.setAttribute("data-morse", morse.id);
  copy.setAttribute("data-morse-dup", key);
  el.after(copy);
  // A copied button or link does what the original does.
  if (el.matches("a[href], button, [role=button], [role=link], summary, label")) {
    morse.on(copy, "click", e => { e.preventDefault(); e.stopPropagation(); el.click(); });
  }
  (dupHooks[key] || []).forEach(f => f(copy));
}

function addStyle(root, css) {
  const s = document.createElement("style");
  s.setAttribute("data-morse", morse.id);
  s.textContent = css;
  root.append(s);
  undo.push(() => s.remove());
}

function focusOn(main) {
  const hidden = [], path = [];
  for (let n = main; n && n.parentElement && n !== document.body; n = n.parentElement) {
    path.push(n.parentElement);
    for (const sib of n.parentElement.children) {
      if (sib === n || sib.matches("script, style, link, template, [data-morse-ui], [data-morse]")) continue;
      sib.setAttribute("data-morse-focus-hide", "");
      hidden.push(sib);
    }
  }
  path.forEach(p => p.setAttribute("data-morse-focus-path", ""));
  main.setAttribute("data-morse-focus", "");
  undo.push(() => {
    hidden.forEach(s => s.removeAttribute("data-morse-focus-hide"));
    path.forEach(p => p.removeAttribute("data-morse-focus-path"));
    main.removeAttribute("data-morse-focus");
  });
}

function hidePopups() {
  const HINT = '[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], [class*="newsletter" i], [id*="newsletter" i], [class*="subscribe" i], [class*="paywall" i], [class*="popup" i], [id*="popup" i], [class*="interstitial" i], [class*="promo-modal" i]';
  let unlocked = false;
  const sweep = () => {
    for (const el of document.querySelectorAll(HINT)) {
      if (el.hasAttribute("data-morse-popup") || el.closest("[data-morse-ui], [data-morse]") || el === document.body || el === document.documentElement) continue;
      if (el.querySelector("main, [role=main], article")) continue;
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      const r = el.getBoundingClientRect();
      el.setAttribute("data-morse-popup", "");
      undo.push(() => el.removeAttribute("data-morse-popup"));
      if (!unlocked && r.width * r.height > innerWidth * innerHeight * 0.3) {
        unlocked = true;
        morse.css("html, body { overflow: auto !important; }");
      }
    }
  };
  sweep();
  morse.every(1500, sweep);
}

// ---- compiler

export function compileEdits(edits = []) {
  const rules = new Map();       // scope + selector -> { shadow, sel, decls }
  const js = [];
  const need = new Set();
  const texts = new Map();       // dedupe renames of the same text run
  const page = new Map();        // last edit per page tool wins
  const set = (e, props) => {
    if (!targetOk(e)) return;
    const scope = e.shadow && e.shadow.length ? e.shadow.join("\u0000") : "";
    const key = scope + "\u0001" + e.sel;
    let r = rules.get(key);
    if (!r) rules.set(key, r = { shadow: scope ? e.shadow : null, sel: e.sel, decls: new Map() });
    for (const [p, v] of Object.entries(props)) {
      if (!PROP_OK(p)) continue;
      const value = v == null ? "" : cssValue(v);
      if (value) { r.decls.delete(p); r.decls.set(p, value); } else r.decls.delete(p);
    }
  };

  for (const e of Array.isArray(edits) ? edits : []) {
    if (!e || typeof e !== "object") continue;
    switch (e.op) {
      case "hide":
        set(e, { display: "none" });
        break;
      case "move": {
        const x = px(e.x), y = px(e.y), base = e.base && e.base !== "none" ? " " + cssValue(e.base) : "";
        set(e, { transform: x || y ? `translate(${x}px, ${y}px)${base}` : null, ...(e.inline ? { display: x || y ? "inline-block" : null } : {}) });
        break;
      }
      case "resize": {
        const d = { "box-sizing": "border-box" };
        if (e.w != null) Object.assign(d, { width: `${Math.max(0, px(e.w))}px`, "min-width": "0", "max-width": "none" });
        if (e.h != null) Object.assign(d, { height: `${Math.max(0, px(e.h))}px`, "min-height": "0", "max-height": "none" });
        if (e.inline) d.display = "inline-block";
        if (e.flex) d.flex = "none";
        set(e, d);
        break;
      }
      case "style":
        if (e.props && typeof e.props === "object") set(e, e.props);
        break;
      case "text": {
        if (!targetOk(e) || typeof e.text !== "string" || !e.text.trim()) break;
        const key = str([e.shadow || null, e.sel, e.i | 0]);
        const prev = texts.get(key);
        texts.set(key, { ...e, i: e.i | 0, text: e.text.trim().slice(0, 2000), was: prev ? prev.was : e.was });
        // keep its place in the program order
        if (!prev) js.push({ text: key });
        break;
      }
      case "duplicate":
        if (!targetOk(e) || typeof e.key !== "string" || !/^[\w-]{1,40}$/.test(e.key)) break;
        need.add("each").add("dup");
        js.push({ code: `each(${str(e.sel)}, ${str(e.shadow || null)}, el => cloneAfter(el, ${str(e.key)}));` });
        break;
      case "page":
        if (PAGE_TOOLS[e.kind]) { page.delete(e.kind); page.set(e.kind, e); }
        break;
    }
  }

  // CSS: document rules go in the mod's css; shadow-root rules are injected by JS.
  const block = r => `${r.sel} {\n${[...r.decls].map(([p, v]) => `  ${p}: ${v} !important;`).join("\n")}\n}`;
  const docRules = [], shadowRules = new Map();
  for (const r of rules.values()) {
    if (!r.decls.size) continue;
    if (!r.shadow) { docRules.push(block(r)); continue; }
    const k = str(r.shadow);
    if (!shadowRules.has(k)) shadowRules.set(k, []);
    shadowRules.get(k).push(block(r));
  }
  const cssParts = [];
  if (docRules.length) cssParts.push(docRules.join("\n"));

  const body = [];
  for (const [chain, list] of shadowRules) {
    need.add("each").add("style");
    body.push(`each(":host", ${chain}, root => addStyle(root, ${str(list.join("\n"))}));`);
  }
  for (const item of js) {
    if (item.code) { body.push(item.code); continue; }
    const e = texts.get(item.text);
    need.add("each").add("rename");
    body.push(`each(${str(e.sel)}, ${str(e.shadow || null)}, el => rename(el, ${e.i}, ${str(e.text)}, ${str(e.was == null ? null : String(e.was).trim())}));`);
  }

  for (const [kind, e] of page) {
    if (kind === "zoom") {
      const z = zoomFor(e.level);
      if (z !== 1) cssParts.push(`body {\n  zoom: ${z} !important;\n}`);
    } else if (kind === "dark" || kind === "light") {
      need.add("dark");
      body.push(`// ${PAGE_TOOLS[kind].title}: smart invert, skipped on pages that are already ${kind}.\nif (${kind === "dark" ? "!" : ""}pageIsDark()) {\n  morse.css(${str(INVERT_CSS)});\n  keepAsIs(${kind === "dark"});\n}`);
    } else if (kind === "noads") {
      cssParts.push(ADS_CSS);
      need.add("popups");
      body.push("hidePopups();");
    } else if (kind === "focus") {
      if (!SEL_OK(e.sel)) continue;
      cssParts.push(FOCUS_CSS);
      need.add("each").add("focus");
      body.push(`each(${str(e.sel)}, null, focusOn);`);
    }
  }

  const css = cssParts.length ? `/* ${EDIT_TITLE}: generated by Morse, no model involved */\n${cssParts.join("\n")}\n` : "";
  if (!body.length) return { css, js: "" };

  const helpers = [];
  if (need.has("dup")) helpers.push("const dupHooks = {};");
  if (need.has("each")) helpers.push(each.toString());
  if (need.has("rename")) helpers.push(rename.toString());
  if (need.has("dup")) helpers.push(cloneAfter.toString());
  if (need.has("style")) helpers.push(addStyle.toString());
  if (need.has("dark")) helpers.push(luminance.toString(), pageIsDark.toString(), keepAsIs.toString());
  if (need.has("focus")) helpers.push(focusOn.toString());
  if (need.has("popups")) helpers.push(hidePopups.toString());
  const js2 = [
    `// ${EDIT_TITLE}: generated by Morse, no model involved. Re-applies after re-renders.`,
    "const undo = [];",
    ...helpers,
    "",
    ...body,
    "",
    "return () => undo.splice(0).reverse().forEach(f => f());",
  ].join("\n");
  return { css, js: js2 + "\n" };
}

// ---- words

const quote = (s, n = 24) => { s = String(s ?? "").trim(); return `“${s.length > n ? s.slice(0, n) + "…" : s}”`; };

export function describeEdit(e) {
  if (!e) return "edit";
  switch (e.op) {
    case "hide": return "hide";
    case "move": return "move";
    case "resize": return "resize";
    case "text": return `rename to ${quote(e.text)}`;
    case "duplicate": return "duplicate";
    case "style": {
      const p = Object.keys(e.props || {});
      if (p.some(k => /^font-size/.test(k))) return "font size";
      if (p.some(k => /^font-weight/.test(k))) return "font weight";
      if (p.some(k => /^(background|fill)/.test(k))) return "fill color";
      if (p.some(k => /^(border|stroke)/.test(k))) return "border color";
      return "text color";
    }
    case "page": return (PAGE_TOOLS[e.kind]?.title || "page tool").toLowerCase();
    default: return "edit";
  }
}

// One line for the mod's "prompt" field, e.g. "Hid 2 · moved 1 · renamed “Inbox” → “Mail”".
export function summarizeEdits(edits = []) {
  const n = {};
  let lastRename = null;
  for (const e of edits) {
    const k = e.op === "style" ? (/font/.test(describeEdit(e)) ? "restyled" : "recolored") : e.op;
    n[k] = (n[k] || 0) + 1;
    if (e.op === "text") lastRename = e;
  }
  const words = { hide: "hid", move: "moved", resize: "resized", text: "renamed", duplicate: "duplicated", recolored: "recolored", restyled: "restyled", page: "page tools" };
  const parts = Object.entries(n).map(([k, c]) => (k === "text" && c === 1 && lastRename)
    ? `renamed ${quote(lastRename.was, 18)} → ${quote(lastRename.text, 18)}`
    : `${words[k] || k} ${c}`);
  const s = parts.join(" · ");
  return s ? s[0].toUpperCase() + s.slice(1) : "No edits";
}
