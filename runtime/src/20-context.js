const HASHED = /^(css|sc|jsx|emotion|styled|svelte|chakra|mui)-|^_?[a-z0-9]{5,}$|[A-Z][a-z]+_[a-z]+__[a-zA-Z0-9]{5}/;
const looksHashed = s => /\d/.test(s) && /[a-z]/i.test(s) && HASHED.test(s) || /^[a-z]{1,3}[0-9][a-z0-9]{3,}$/i.test(s);
const cssEsc = s => (globalThis.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));

// redact: what never goes into the prompt, in one place. context() runs it on
// the whole context object, and snippet() on every element clone before it is
// serialized:
//   - input values: never read from the live page; `value` attributes are
//     dropped from inputs other than buttons and checkboxes (passwords, card
//     fields, anything prefilled), hidden inputs keep only type/name/id, and
//     textarea contents are emptied
//   - things that look like secrets: JWTs, API keys, long random tokens,
//     token/key/session values in URLs, card numbers (Luhn-checked)
//   - email addresses
// redact(string) returns it scrubbed; redact(clonedElement) scrubs the clone
// in place (each attribute through redactAttr below too); redact(object or
// array) scrubs every string in it. This is the one gate: whatever else
// scrubs early (redactAttr, redactCss) only adds to it.
const REDACT = [
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, "[token]"],
  [/\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/g, "[token]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g, "[token]"],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [token]"],
  [/([?&#;](?:access_|refresh_|id_|auth_|api_|csrf_|xsrf_)?(?:token|key|apikey|auth|session|sessionid|sid|sig|signature|code|password|passwd|pwd|secret|jwt|otp|nonce)=)[^&#\s"'<>]+/gi, "$1[redacted]"],
  // Long random strings: 32+ hex digits, or 24+ characters mixing digits, upper and lower case.
  [/[A-Za-z0-9_+/=-]{24,}/g, m => /^[a-f0-9]{32,}$/i.test(m) && /\d/.test(m) && /[a-f]/i.test(m)
    || (m.match(/\d/g) || []).length >= 2 && (m.match(/[A-Z]/g) || []).length >= 2 && (m.match(/[a-z]/g) || []).length >= 2 && (m.match(/[-_/]/g) || []).length <= 3 ? "[token]" : m],
  [/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi, "[email]"],
];
const luhn = d => { let s = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; } return s % 10 === 0; };
const KEEP_VALUE = /^(button|submit|reset|image|checkbox|radio|range|color)$/i;
function redact(x) { // redact
  if (typeof x === "string") {
    let s = x;
    for (const [re, to] of REDACT) s = s.replace(re, to);
    return s.replace(/\b\d(?:[ -]?\d){12,18}\b/g, m => luhn(m.replace(/\D/g, "")) ? "[card]" : m);
  }
  if (x && x.nodeType === 1) {
    for (const e of [x, ...x.querySelectorAll("*")]) {
      const tag = e.localName, type = e.getAttribute("type") || "";
      if (tag === "input" && !KEEP_VALUE.test(type)) e.removeAttribute("value");
      if (tag === "input" && /^hidden$/i.test(type)) for (const a of [...e.attributes]) if (!/^(type|name|id)$/.test(a.name)) e.removeAttribute(a.name);
      if (tag === "textarea") e.textContent = "";
      for (const a of [...e.attributes]) { const v = redact(redactAttr(e, a.name, a.value)); if (v !== a.value) e.setAttribute(a.name, v); }
    }
    const w = (x.ownerDocument || document).createTreeWalker(x, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { const v = redact(n.textContent); if (v !== n.textContent) n.textContent = v; }
    return x;
  }
  if (Array.isArray(x)) return x.map(redact);
  if (x && typeof x === "object") { const o = {}; for (const k of Object.keys(x)) o[k] = redact(x[k]); return o; }
  return x;
}

// ---- Roots: open shadow roots and same-origin frames are part of the page the
// user sees. A selector that crosses into one is written "host >>> inside"
// (core/kit.js understands it: morse.watch, morse.css(css, where)).
const isMorseUI = el => !!el.closest?.("[data-morse-ui]");
function frameDoc(el) {
  if (el.localName !== "iframe" && el.localName !== "frame") return null;
  try { const d = el.contentDocument; return d && d.documentElement ? d : null; } catch { return null; }
}
const innerRoot = el => (el.shadowRoot && !el.hasAttribute("data-morse-ui") ? el.shadowRoot : null) || frameDoc(el);
// The shadow host or frame element el is inside of; null in the page itself.
function outerOf(el) {
  const r = el.getRootNode();
  if (r.nodeType === 11 && r.host) return r.host;
  if (r.nodeType === 9 && r !== document) { try { return r.defaultView?.frameElement || null; } catch { return null; } }
  return null;
}
// The document plus every open shadow root (nested) and same-origin frame.
function allRoots(limit = 80) {
  const out = [document];
  for (let i = 0; i < out.length && out.length < limit; i++) {
    for (const el of out[i].querySelectorAll("*")) {
      const r = innerRoot(el);
      if (r && !isMorseUI(el)) { out.push(r); if (out.length >= limit) break; }
    }
  }
  return out;
}
// Every element matching a selector that may contain ">>>". Throws on a bad selector.
function deepAll(sel, root = document) {
  const parts = String(sel).split(/\s*>>>\s*/);
  let scopes = [root];
  for (let i = 0; i < parts.length; i++) {
    const found = [];
    for (const sc of scopes) found.push(...sc.querySelectorAll(parts[i]));
    if (i === parts.length - 1) return found.filter(e => !isMorseUI(e));
    scopes = found.map(innerRoot).filter(Boolean);
  }
  return [];
}

// ---- What never goes to the model from the page's markup: what was typed
// into fields (React and others mirror it into the value attribute), hidden
// fields (CSRF tokens), attributes named or shaped like secrets, email
// addresses, and the query strings of signed URLs. The page's visible text
// is what the model is for; these aren't.
const REDACTED = "[redacted]";
const SECRET_NAME = /password|passwd|passcode|\bpass\b|pwd|secret|token|csrf|xsrf|nonce|\bauth(?!or)|session|cookie|api[-_]?key|signature|\botp\b|one-time|cvc|cvv|card-?(num|number|no)\b|cc-?(num|number|exp|csc)|iban|\bssn\b/i;
const EMAILS = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// A JWT, a long hex string, or a long run of mixed-case letters and digits
// (not a path or a slug like "album-cover-2024-large").
const TOKENISH = v => /^eyJ[\w-]{8,}\.[\w-]{8,}/.test(v) || /^[a-f0-9]{32,}$/i.test(v)
  || (/^[A-Za-z0-9+/=_-]{24,}$/.test(v) && /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && (v.match(/[-_/]/g) || []).length < 3);
const decoded = v => { try { return decodeURIComponent(v); } catch { return v; } };
// a=1&token=abc -> a=1&token=[redacted]; every value of a URL whose query is long or secret-looking.
const redactUrl = s => String(s).replace(/([?&#][^=&#\s"')]*=)([^&#\s"')]*)/g, (m, k, v) => (SECRET_NAME.test(k) || /^(sig|s|k|key|code|state|access_token|id_token|t|x-amz-[\w-]+|expires)=$/i.test(k.slice(1)) || TOKENISH(decoded(v).slice(0, 400)) ? k + REDACTED : m));
function redactAttr(el, name, value) {
  const n = name.toLowerCase(), v = String(value ?? "");
  if (n === "value" && el.localName === "input" && !KEEP_VALUE.test((el.getAttribute("type") || "text").toLowerCase())) return v ? REDACTED : v;
  if (n === "class" || n === "id" || n === "role" || n === "type" || n === "tabindex") return v;
  if (n === "value" && el.localName === "input" && SECRET_NAME.test(`${el.getAttribute("name") || ""} ${el.id || ""} ${el.getAttribute("autocomplete") || ""}`)) return REDACTED;
  if (n !== "name" && n !== "autocomplete" && SECRET_NAME.test(n.replace(/^(data|aria)-/, ""))) return v ? REDACTED : v;
  if (TOKENISH(v)) return REDACTED;
  let out = v.replace(EMAILS, "[email]");
  if (/^(href|src|srcset|action|formaction|poster|ping|style|data-[\w-]+)$/.test(n)) out = redactUrl(out).replace(/url\((["']?)([^)"']*)\1\)/g, (m, q, u) => `url(${q}${redactUrl(u)}${q})`);
  return out;
}
// CSS text (rules, computed backgrounds): signed URLs keep their path only.
const redactCss = s => String(s || "").replace(/url\((["']?)([^)"']*)\1\)/g, (m, q, u) => `url(${q}${u.replace(/[?#].*$/, u.includes("?") ? "?…" : "")}${q})`);

function stableAttr(el) {
  for (const a of ["data-testid", "data-test", "data-qa", "data-id", "aria-label", "name", "role", "placeholder", "title"]) {
    const v = el.getAttribute?.(a);
    // Never an email or a token in a selector: the selector goes to the model.
    if (v && v.length < 60 && !looksHashed(v) && redactAttr(el, a, v) === v) return `[${a}="${cssEsc(v)}"]`;
  }
  return "";
}
// The parent for sibling counts, including the top of a shadow root.
const parentOf = el => el.parentElement || (el.parentNode?.nodeType === 11 ? el.parentNode : null);
function segment(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id && !looksHashed(el.id)) return { s: `#${cssEsc(el.id)}`, anchor: true };
  const attr = stableAttr(el);
  if (attr && !/^\[role=/.test(attr)) return { s: tag + attr, anchor: true };
  const classes = [...el.classList].filter(c => !looksHashed(c)).slice(0, 2).map(c => "." + cssEsc(c)).join("");
  let s = tag + (attr || classes);
  const p = parentOf(el);
  if (p) {
    const same = [...p.children].filter(c => c.tagName === el.tagName);
    // Table cells are columns: their position always counts.
    if (same.length > 1 && (!classes && !attr || /^t[dh]$/.test(tag))) s += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return { s, anchor: false };
}
// Inside a shadow root or a frame the selector reads "outer >>> inner".
function selectorFor(el) {
  const outer = outerOf(el);
  const doc = el.ownerDocument, root = el.getRootNode();
  const parts = [];
  for (let n = el, i = 0; n && n.nodeType === 1 && n !== doc.documentElement && i < 5; n = n.parentElement, i++) {
    const seg = segment(n);
    parts.unshift(seg.s);
    if (seg.anchor) break;
    if (n === doc.body) break;
  }
  let sel = parts.join(" > ");
  try { if (root.querySelector(sel) !== el) sel = parts.slice(-3).join(" > "); } catch {}
  return outer ? `${selectorFor(outer)} >>> ${sel}` : sel;
}
// What a person would call an element: its visible label plus what kind of
// thing it is, e.g. "Player controls", "Send button", "“Release notes” heading".
const ROLE_WORDS = {
  button: "button", link: "link", textbox: "field", searchbox: "search field", checkbox: "checkbox", radio: "option",
  switch: "switch", combobox: "menu", listbox: "list", menu: "menu", menuitem: "menu item", tab: "tab", tablist: "tabs",
  slider: "slider", heading: "heading", img: "image", image: "image", navigation: "menu bar", banner: "header",
  contentinfo: "footer", complementary: "sidebar", main: "main content", article: "article", dialog: "window",
  alertdialog: "window", list: "list", listitem: "list item", table: "table", grid: "table", form: "form",
  search: "search", toolbar: "toolbar", progressbar: "progress bar", tooltip: "tooltip", region: "section",
};
const TAG_ROLES = {
  a: "link", button: "button", summary: "button", textarea: "field", select: "menu", img: "image", picture: "image",
  svg: "icon", canvas: "image", video: "video", audio: "audio player", iframe: "embedded page", frame: "embedded page",
  h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", p: "paragraph",
  nav: "menu bar", header: "header", footer: "footer", aside: "sidebar", main: "main content", article: "article",
  ul: "list", ol: "list", li: "list item", table: "table", tr: "table row", td: "table cell", th: "table cell",
  form: "form", label: "label", dialog: "window", blockquote: "quote", code: "code", pre: "code", hr: "divider",
};
function roleWord(el) {
  const role = (el.getAttribute("role") || "").split(" ")[0];
  if (ROLE_WORDS[role]) return ROLE_WORDS[role];
  const tag = el.localName;
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    return t === "checkbox" ? "checkbox" : t === "radio" ? "option" : t === "range" ? "slider"
      : /^(button|submit|reset|image)$/.test(t) ? "button" : t === "search" ? "search field" : "field";
  }
  if (TAG_ROLES[tag]) return TAG_ROLES[tag];
  if (el instanceof SVGElement) return "icon";
  return "";
}
function nameOf(el) {
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const by = el.getAttribute("aria-labelledby");
  const labelled = by && clean(by.split(" ").map(id => el.ownerDocument.getElementById(id)?.textContent).join(" "));
  const own = clean(el.getAttribute("aria-label")) || labelled;
  if (own) return { name: own, from: "label" };
  if (el.labels?.[0]) return { name: clean(el.labels[0].textContent), from: "label" };
  const attr = clean(el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder"));
  if (attr) return { name: attr, from: "label" };
  if (el.localName === "input" && /^(button|submit|reset)$/i.test(el.type)) return { name: clean(el.value), from: "label" };
  const text = clean((el.innerText || el.textContent || "").trim().split("\n")[0]);
  // A first line with no words ("0" in VS Code's status bar, "12:30", "⚠ 3")
  // names nothing: the part's own id or class says more ("status bar"), and
  // with neither, its kind alone does (describe).
  if (text && !/\p{L}{2}/u.test(text)) return { name: namedBy(el), from: "class" };
  return { name: text, from: "text" };
}
// "workbench.parts.statusbar" -> "statusbar", "side-panel" -> "side panel";
// never a generated name ("css-1x2y3a") or a word that says nothing ("part").
const NAMELESS = /^(part|parts|container|wrapper|wrap|inner|outer|content|item|items|block|box|row|col|cell|root|el|elem|element|div|span|flex|grid|clearfix|active|selected|show|visible|hidden|left|right|top|bottom)$/i;
function namedBy(el) {
  for (const raw of [el.id, ...(el.classList || [])]) {
    if (!raw || looksHashed(raw)) continue;
    const last = String(raw).split(".").pop();
    const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[-_\s]+/).filter(w => /^\p{L}{2,}$/u.test(w) && !NAMELESS.test(w));
    if (words.length && words.length <= 3) return words.join(" ").toLowerCase();
  }
  return "";
}
// The kind word in the person's language: message ids "kind.<word>" ("kind.menu-item").
// lang "en" for what the model reads (the target's label in context()).
const kindWord = (k, lang) => t(`kind.${k.replace(/ /g, "-")}`, {}, lang);
// A saved mod keeps the English label the model read ("Section", "“Release
// notes” section", "Save button"); the Mods panel shows it in the person's
// language. Names stay as they are; a label it can't take apart stays English.
function shownLabel(label) {
  const s = String(label || "");
  if (!s || getLanguage() === "en") return s;
  const kinds = Object.keys(CATALOGS.en).filter(id => /^kind\./.test(id) && id !== "kind.named" && id !== "kind.quoted").map(id => [CATALOGS.en[id], id.slice(5)]);
  const word = w => kinds.find(([en]) => en.toLowerCase() === w.toLowerCase())?.[1];
  const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
  const alone = word(s);
  if (alone) return cap(t(`kind.${alone}`));
  for (const [en, k] of [...kinds].sort((x, y) => y[0].length - x[0].length)) {
    if (!s.toLowerCase().endsWith(` ${en.toLowerCase()}`)) continue;
    const name = s.slice(0, -en.length - 1).trim();
    const q = /^“(.*)”$/.exec(name);
    return t(q ? "kind.quoted" : "kind.named", { name: q ? q[1] : name, kind: t(`kind.${k}`) });
  }
  return s;
}
function describe(el, lang) {
  const role = roleWord(el);
  const { name, from } = nameOf(el);
  const short = name.length > 28 ? name.slice(0, 27).trimEnd() + "…" : name;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if (!short) return cap(kindWord(role || (el.children.length ? "section" : "text"), lang));
  if (from === "class") return cap(short); // "Statusbar", "Side panel": its own name for itself
  // A container named by its first line of text is "“Release notes” section", not "Release notes".
  const kind = role || (from === "text" && el.children.length ? "section" : "");
  if (!kind || short.toLowerCase().endsWith(kind) || short.toLowerCase().endsWith(kindWord(kind, lang).toLowerCase())) return from === "text" && !kind ? `“${short}”` : short;
  const words = short.split(" ").length;
  const plain = words <= 3 && !short.endsWith("…") && (from === "label" || /button|link|tab|menu item|option|checkbox|switch/.test(kind));
  return t(plain ? "kind.named" : "kind.quoted", { name: short, kind: kindWord(kind, lang) }, lang);
}
function snippet(el, { styles = false } = {}) {
  const clone = el.cloneNode(true);
  // Redacted before anything is cut short (the element itself included).
  const clean = c => {
    for (const a of [...c.attributes]) {
      const v = redactAttr(c, a.name, a.value);
      if (v !== a.value) c.setAttribute(a.name, v);
    }
    if (c.localName === "textarea" && c.textContent) c.textContent = REDACTED;
  };
  if (clone.nodeType === 1) clean(clone);
  // n is a node of the clone and o the same node in the page: what an open
  // shadow root renders is shown as a <shadow-root> first child.
  const walk = (n, o, depth) => {
    const orig = o ? [...o.childNodes] : [];
    [...n.childNodes].forEach((c, i) => {
      if (c.nodeType === 3) { if (c.textContent.length > 120) c.textContent = c.textContent.slice(0, 120) + "…"; return; }
      if (c.nodeType !== 1) { c.remove(); return; }
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(c.tagName) || c.hasAttribute("data-morse-ui")) { c.remove(); return; }
      if (c.tagName === "svg") { c.innerHTML = ""; }
      clean(c);
      for (const a of [...c.attributes]) {
        if ((a.name === "style" && !styles) || a.name.startsWith("on")) c.removeAttribute(a.name);
        else if (a.value.length > 80) c.setAttribute(a.name, a.value.slice(0, 80) + "…");
      }
      if (depth > 4) { c.innerHTML = "…"; return; }
      walk(c, orig[i], depth + 1);
    });
    const sr = o?.nodeType === 1 && o.shadowRoot && !o.hasAttribute("data-morse-ui") ? o.shadowRoot : null;
    if (sr && depth <= 4) {
      const s = document.createElement("shadow-root");
      for (const k of sr.childNodes) s.append(k.cloneNode(true));
      walk(s, sr, depth + 1);
      n.prepend(s);
    }
    const kids = [...n.children];
    if (kids.length > 12) kids.slice(12).forEach(k => k.remove());
  };
  walk(clone, el, 0);
  if (!styles) clone.removeAttribute?.("style");
  else if ((clone.getAttribute?.("style") || "").length > 80) clone.setAttribute("style", clone.getAttribute("style").slice(0, 80) + "…");
  for (const a of [...(clone.attributes || [])]) if (a.name.startsWith("on")) clone.removeAttribute(a.name);
  const html = redact(clone).outerHTML; // redact
  return html.length > 3000 ? html.slice(0, 3000) + "…" : html;
}
// The page outline the model sees: landmarks, headings and controls, plus the
// ways around an app (menu buttons, tabs, settings-like links) and what sits
// inside closed menus, so "where is X?" can name the menu to open. One line
// each, in page order: `selector  "label"  (note)`. Capped by kind so a long
// list of links never crowds out the menus.
const OUTLINE_Q = "header,nav,main,aside,footer,dialog,[role=main],[role=navigation],[role=dialog],h1,h2,h3,button,[role=button],input,textarea,select,form,a[href],summary,[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[aria-haspopup]";
const OUTLINE_WAYS = /setting|preference|account|profile|option|notification|privacy|security|password|billing|help|export|import|download|share|log ?out|sign ?(in|out)|more|menu/i;
const OUTLINE_BUDGET = [28, 20, 10, 16]; // ways around + landmarks, controls, other links, inside closed menus
// A field's own text is never its label (a textarea's text is what was typed).
const outlineLabel = el => (el.getAttribute("aria-label") || (/^(input|textarea)$/.test(el.localName) ? "" : el.innerText || el.textContent) || el.getAttribute("placeholder") || el.getAttribute("title") || "")
  .trim().split("\n")[0].replace(/\s+/g, " ").replace(EMAILS, "[email]").slice(0, 40);
const isMenuTrigger = el => el.localName === "summary" || (el.getAttribute("aria-haspopup") || "false") !== "false";
// Where a control that isn't showing lives: a closed <details>, or a
// menu/popover/dialog whose opener we can name. { menu, opener } for a closed
// menu, { panel } for a closed dialog or tab; null when hidden for any other
// reason. Also used by Ask and find (61-ask.js) to say where a marker is.
function hiddenWhere(el) {
  const d = el.closest("details:not([open])");
  if (d && el.parentElement !== d) { const s = d.querySelector(":scope > summary"); return s ? { menu: outlineLabel(s), opener: s } : null; }
  const box = el.closest("[role=menu],[role=listbox],[popover],dialog,[role=dialog],[role=tabpanel],[hidden],[aria-hidden=true]");
  if (!box) return null;
  let opener = null;
  if (box.id) {
    const id = cssEsc(box.id);
    opener = document.querySelector(`[aria-controls~="${id}"],[popovertarget="${id}"],a[href="#${id}"]`);
  }
  if (!opener && box.getAttribute("aria-labelledby")) opener = document.getElementById(box.getAttribute("aria-labelledby").split(" ")[0]);
  if (opener && isMenuTrigger(opener)) return { menu: outlineLabel(opener), opener };
  const panel = opener ? outlineLabel(opener) : box.getAttribute("aria-label") || "";
  return panel ? { panel, opener } : null;
}
// selectorFor() is about the element's role in the page, so siblings can
// share one (two tabs); the outline needs each line to name exactly one.
function uniqueSelector(el) {
  const sel = selectorFor(el);
  const root = el.getRootNode(), p = parentOf(el);
  const local = sel.split(" >>> ").pop(), outer = sel.slice(0, sel.length - local.length);
  try {
    if (root.querySelectorAll(local).length <= 1 || !p) return sel;
    const k = [...p.children].filter(c => c.localName === el.localName).indexOf(el) + 1;
    const nth = `${local}:nth-of-type(${k})`;
    if (root.querySelector(nth) === el) return outer + nth;
  } catch {}
  return sel;
}
function outline(roots = [document]) {
  const label = outlineLabel, isTrigger = isMenuTrigger;
  const shown = el => el.getClientRects().length > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true }));
  const whereHidden = el => {
    const w = hiddenWhere(el);
    return !w ? "" : w.menu ? `in closed menu "${w.menu}"` : `in "${w.panel}", not open`;
  };
  const picked = [[], [], [], []];
  let i = 0;
  // Open shadow roots and same-origin frames count too (their lines read
  // "host >>> inside"). Selectors are worked out only for the lines kept: on
  // a page with thousands of links that is most of the cost.
  for (const el of roots.flatMap(r => [...r.querySelectorAll(OUTLINE_Q)])) {
    if (el.closest("[data-morse-ui]") || el.type === "hidden") continue;
    const tag = el.localName, role = el.getAttribute("role") || "", t = label(el);
    const vis = shown(el);
    let note = "", tier;
    if (isTrigger(el)) {
      const open = tag === "summary" ? el.parentElement?.open : el.getAttribute("aria-expanded") === "true";
      note = `menu button, ${open ? "open" : "closed"}`; tier = 0;
    } else if (role === "tab") { note = `tab${el.getAttribute("aria-selected") === "true" ? ", selected" : ""}`; tier = 0; }
    else if (/^menuitem/.test(role)) { note = "menu item"; tier = 1; }
    else if (tag === "a") { note = "link"; tier = OUTLINE_WAYS.test(t) || el.closest("header,[role=banner]") ? 0 : 2; }
    else if (tag === "button" || role === "button") { note = `button${el.disabled || el.getAttribute("aria-disabled") === "true" ? ", disabled" : ""}`; tier = OUTLINE_WAYS.test(t) ? 0 : 1; }
    else if (/^(input|textarea|select)$/.test(tag)) {
      note = el.type === "checkbox" || el.type === "radio" ? `${el.type}, ${el.checked ? "on" : "off"}` : "field";
      if (el.disabled) note += ", disabled";
      tier = 1;
    } else tier = /^(h3|form)$/.test(tag) ? 1 : 0;
    if (!vis) {
      if (!note || !t) continue;
      const where = whereHidden(el);
      if (!where) continue;
      note += `, ${where}`;
      tier = 3;
    }
    // speed: the selector is built only for lines that make the cut below.
    // uniqueSelector queries the whole page, so building it for every one of
    // thousands of buttons took seconds on big pages (5,000 table rows: 27 s).
    picked[tier].push({ i: i++, el, rest: `${t ? `  "${t.replace(/"/g, "'")}"` : ""}${note ? `  (${note})` : ""}`, ways: OUTLINE_WAYS.test(t) });
  }
  // The same control repeated (a Reply button on every comment) is one line
  // with a selector for all of them.
  for (const list of picked) {
    const first = new Map();
    for (let k = 0; k < list.length; k++) {
      const x = list[k], f = first.get(x.rest);
      if (!f) { first.set(x.rest, x); x.n = 1; continue; }
      f.n++;
      list.splice(k--, 1);
    }
  }
  const lineOf = x => {
    const all = x.n >= 3 && similar(x.el);
    return all ? `${all.sel}${x.rest} ×${x.n}` : uniqueSelector(x.el) + x.rest;
  };
  // Within a kind, the ways around (settings, account, export…) go first.
  const lines = picked.flatMap((list, k) => [...list].sort((a, b) => b.ways - a.ways || a.i - b.i).slice(0, OUTLINE_BUDGET[k]))
    .sort((a, b) => a.i - b.i).map(lineOf);
  let out = "";
  for (const l of lines) { if (out.length + l.length + 1 > 3600) break; out += (out ? "\n" : "") + l; }
  return out;
}
// ---- Beyond the HTML: what the target looks like and which CSS rules size it,
// how many similar elements exist, and a compact layout tree of the page. A
// model that only sees markup guesses (e.g. `img` for album covers that are
// divs with gradient backgrounds); these facts are what it needs instead.
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const STATE_CLASS = /^(is-|has-)?(active|selected|open|on|cur|current|hover|focus|show|visible)$/;
// Computed style from the element's own window (it may live in a frame).
const styleOf = (el, pseudo) => (el.ownerDocument.defaultView || window).getComputedStyle(el, pseudo);
function kindOf(el) {
  const tag = el.tagName.toLowerCase();
  const cls = [...el.classList].find(c => !looksHashed(c) && !STATE_CLASS.test(c));
  const data = [...el.attributes].find(a => a.name.startsWith("data-") && !a.name.startsWith("data-morse"));
  const role = el.getAttribute("role");
  return tag + (cls ? "." + cssEsc(cls) : "") + (data ? `[${data.name}]` : role ? `[role="${role}"]` : "");
}
// Siblings that are the same component: kindOf plus generated class names
// (those are stable within one page load, so they tell components apart).
const groupKey = el => kindOf(el) + "|" + [...el.classList].filter(looksHashed).sort().join(".");
function selName(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id && !looksHashed(el.id)) return `${tag}#${cssEsc(el.id)}`;
  const attr = stableAttr(el);
  const cls = [...el.classList].filter(c => !looksHashed(c)).slice(0, 2).map(c => "." + cssEsc(c)).join("");
  return tag + (attr && !/^\[role=/.test(attr) ? attr : cls || attr);
}
// Style sheets of a root: the page's, or a shadow root's (adopted ones too).
const sheetsOf = root => [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])];
function rulesFor(el, max = 5) {
  const out = [], win = el.ownerDocument.defaultView || window;
  const walk = rules => {
    for (const r of rules) {
      if (out.length >= max) return;
      if (r.selectorText) {
        if (/^\s*\*\s*$/.test(r.selectorText)) continue;
        try { if (el.matches(r.selectorText)) out.push(clip(redactCss(r.cssText), 240)); } catch {}
      } else if (r.cssRules && (!r.media || win.matchMedia(r.media.mediaText).matches)) walk(r.cssRules);
    }
  };
  for (const sheet of sheetsOf(el.getRootNode())) {
    const owner = sheet.ownerNode;
    if (owner?.hasAttribute?.("data-morse-css") || owner?.hasAttribute?.("data-morse") || owner?.closest?.("[data-morse-ui]")) continue;
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin
    walk(rules);
  }
  return out;
}
function looks(el) {
  const cs = styleOf(el), r = el.getBoundingClientRect();
  const bits = [`${Math.round(r.width)}×${Math.round(r.height)}px`, `display ${cs.display}`];
  if (cs.position !== "static") bits.push(`position ${cs.position}`);
  bits.push(`color ${cs.color}`, `background ${cs.backgroundColor}${cs.backgroundImage !== "none" ? " + " + clip(redactCss(cs.backgroundImage), 70) : ""}`);
  bits.push(`font ${cs.fontSize} ${cs.fontWeight}`);
  if (cs.borderRadius !== "0px") bits.push(`radius ${cs.borderRadius}`);
  return bits.join(", ");
}
// "These" usually means the same part of every repeated item (each card's
// price, each row): one selector for all of them, without generated class
// names, crossing into shadow roots when the items are components.
// { sel, n } or null when el isn't part of a repeated item.
function similar(el) {
  const outer = outerOf(el), up = outer ? similar(outer) : null;
  const doc = el.ownerDocument, parts = [];
  let repeated = !!up;
  for (let n = el, i = 0; n && n.nodeType === 1 && n !== doc.body && n !== doc.documentElement && i < 9; n = n.parentElement, i++) {
    const p = parentOf(n), key = groupKey(n);
    const same = p ? [...p.children].filter(c => groupKey(c) === key).length : 1;
    if (/^t[dh]$/.test(n.localName)) { parts.unshift(`${n.localName}:nth-child(${[...p.children].indexOf(n) + 1})`); continue; } // table columns are positions
    if (same >= 2 && !/^(html|body|main|header|footer|nav|aside)$/.test(n.localName)) {
      repeated = true;
      const cls = [...n.classList].find(c => !looksHashed(c) && !STATE_CLASS.test(c));
      parts.unshift(n.localName + (cls ? "." + cssEsc(cls) : ""));
    } else {
      const seg = segment(n);
      parts.unshift(seg.s);
      if (seg.anchor) break;
    }
  }
  if (!repeated) return null;
  const local = parts.join(" > ");
  const sel = up ? `${up.sel} >>> ${local}` : outer ? `${selectorFor(outer)} >>> ${local}` : local;
  let n = 0;
  try { n = deepAll(sel).length; } catch { return null; }
  return n >= 2 ? { sel, n } : null;
}
// A selector as a JS string literal for the notes (attribute selectors carry double quotes).
const jsStr = s => (s.includes('"') && !s.includes("'") ? `'${s}'` : JSON.stringify(s));
// CSS custom properties a shadow root's styles read, and its exposed parts.
function shadowApi(root) {
  const vars = new Set();
  for (const sh of sheetsOf(root)) { try { for (const r of sh.cssRules) for (const m of r.cssText.matchAll(/var\(\s*(--[\w-]+)/g)) vars.add(m[1]); } catch {} }
  const parts = [...new Set([...root.querySelectorAll("[part]")].flatMap(e => e.getAttribute("part").split(/\s+/)))];
  return { vars: [...vars].slice(0, 6), parts: parts.slice(0, 6) };
}
// Where el lives and what that means for a change: inside a component's
// shadow root or a frame, a component or frame itself, a canvas, a recycled row.
function placeFacts(el) {
  const lines = [], outer = outerOf(el);
  if (outer && frameDoc(outer)) {
    const f = selectorFor(outer);
    lines.push(`It is inside the frame ${f} (a page of its own): page CSS doesn't apply in there. Use JS: morse.css(css, ${jsStr(f)}) adds CSS inside it; morse.watch(${jsStr(f + " >>> selector")}, fn) finds elements in it.`);
  } else if (outer) {
    const tag = outer.localName, api = shadowApi(outer.shadowRoot), part = el.closest("[part]")?.getAttribute("part").split(/\s+/)[0];
    const hosts = similar(outer)?.sel || selectorFor(outer);
    lines.push(`It is inside the open shadow root of <${tag}>: page CSS can't reach it.`
      + (part ? ` It is exposed as part="${part}": ${tag}::part(${part}) { … } styles it from page CSS.` : "")
      + (api.vars.length ? ` The component's CSS reads ${api.vars.join(", ")}: setting them on ${tag} restyles it from page CSS.` : "")
      + ` Anything else needs JS: morse.css(css, ${jsStr(hosts)}) adds CSS inside every one (plain selectors there, e.g. "${el.localName}${el.classList[0] && !looksHashed(el.classList[0]) ? "." + cssEsc(el.classList[0]) : ""}"); morse.watch(${jsStr(hosts + " >>> selector")}, fn) finds elements inside.`);
  }
  if (el.shadowRoot && !el.hasAttribute("data-morse-ui")) {
    const api = shadowApi(el.shadowRoot);
    lines.push(`It is a web component: what it shows is in its open shadow root (<shadow-root> in the HTML), which page CSS can't reach.`
      + (api.parts.length ? ` Exposed parts: ${api.parts.map(p => `${el.localName}::part(${p})`).join(", ")}.` : "")
      + (api.vars.length ? ` Its CSS reads ${api.vars.join(", ")}.` : "")
      + ` For anything else: morse.css(css, ${jsStr(selectorFor(el))}) / morse.watch(${jsStr(selectorFor(el) + " >>> selector")}, fn).`);
  }
  if (el.localName === "iframe" || el.localName === "frame") {
    const d = frameDoc(el), f = selectorFor(el);
    if (!d) lines.push("It shows a page from another site: what's inside is out of reach. Only the frame's box (size, position, hiding) can change.");
    else {
      lines.push(`It shows another page of this site ("${clip(d.title, 40)}"): page CSS doesn't apply inside it. Use JS: morse.css(css, ${jsStr(f)}) adds CSS inside it (plain selectors there, like "body" or "p"); morse.watch(${jsStr(f + " >>> selector")}, fn) finds elements in it. Its page:`);
      lines.push(layout(24, d.body).split("\n").map(l => "  " + l).join("\n"));
      // What sizes and colors its text.
      const rules = [d.body, d.querySelector("h1,h2"), d.querySelector("p")].filter(Boolean).flatMap(e => rulesFor(e, 2));
      if (rules.length) lines.push("CSS rules in it:\n" + [...new Set(rules)].join("\n"));
    }
  }
  if (el.localName === "canvas") lines.push(`It is a <canvas>: what it shows is pixels the app draws, not elements. CSS can only size, move or hide the box. To read or save the picture: el.toBlob(b => …, "image/png") or el.toDataURL(); the app's own buttons (in the outline) may already do what's asked.`);
  const v = virtualLists().find(x => x.list.contains(el));
  if (v) lines.push(virtualNote(v));
  return lines;
}
function targetFacts(el) {
  const lines = [`Looks: ${looks(el)}`];
  const media = el.matches("img,video,canvas,svg,picture,iframe") ? [el] : [...el.querySelectorAll("img,video,canvas,svg,picture,iframe")];
  const bgs = [el, ...el.querySelectorAll("*")].slice(0, 300).filter(e => styleOf(e).backgroundImage !== "none");
  if (media.length) lines.push(`Media inside: ${[...new Set(media.map(m => m.tagName.toLowerCase()))].map(t => `<${t}>`).join(", ")}`);
  if (bgs.length) lines.push(`${media.length ? "Also" : "No <img>: the visuals are"} CSS background images on ${[...new Set(bgs.map(selName))].slice(0, 3).join(", ")}`);
  lines.push(...placeFacts(el));
  const same = similar(el);
  if (same) {
    lines.push(`${same.n} similar elements (the same part of each repeated item): ${same.sel}`);
    // A few labels (High / Medium / Low): say whether anything but the text tells them apart.
    const els = same.n <= 500 ? deepAll(same.sel) : [];
    const counts = new Map();
    for (const e of els) { const t = clip(e.textContent, 30); counts.set(t, (counts.get(t) || 0) + 1); }
    if (counts.size >= 2 && counts.size <= 8 && !counts.has("")) {
      const sig = e => [...e.attributes].map(a => `${a.name}=${a.value}`).sort().join("|");
      const list = [...counts].map(([t, n]) => `"${t}" ×${n}`).join(", ");
      lines.push(new Set(els.map(sig)).size === 1
        ? `Their text differs (${list}) but none of their attributes do: CSS can't pick them by it. Pick by text in JS (morse.watch on the item, test the text, toggle a class).`
        : `Their texts: ${list}.`);
    }
  }
  else {
    const kind = kindOf(el);
    let n = 0;
    try { n = el.getRootNode().querySelectorAll(kind).length; } catch {}
    if (n > 1 && kind !== el.localName) lines.push(`${n} elements match ${kind} (the same kind of element)`);
  }
  const p = el.parentElement;
  if (p && p !== el.ownerDocument.documentElement) {
    const pc = styleOf(p);
    lines.push(`Parent ${selName(p)}: ${Math.round(p.getBoundingClientRect().width)}px wide, display ${pc.display}${/grid/.test(pc.display) ? `, ${pc.gridTemplateColumns.split(" ").length} columns` : ""}`);
    // A cell's class is often shared by other columns: name the column.
    if (/^t[dh]$/.test(el.localName)) {
      const k = kindOf(el), cols = [...p.children].filter(c => kindOf(c) === k);
      if (cols.length > 1) lines.push(`Careful: ${k} matches ${cols.length} cells in each row; this column is ${el.localName}:nth-child(${[...p.children].indexOf(el) + 1}).`);
    }
  }
  const own = rulesFor(el), up = p ? rulesFor(p, 3) : [];
  if (own.length) lines.push("CSS rules on it:\n" + own.join("\n"));
  if (up.length) lines.push("CSS rules on its parent:\n" + up.join("\n"));
  // The grid/flex container that decides its size, when that's further up.
  for (let a = p?.parentElement, i = 0; a && a !== el.ownerDocument.body && i < 3; a = a.parentElement, i++) {
    if (!/grid|flex/.test(styleOf(a).display)) continue;
    const rs = rulesFor(a, 3);
    if (rs.length) lines.push(`CSS rules on the ${styleOf(a).display} container ${selName(a)}:\n` + rs.join("\n"));
    break;
  }
  return lines.join("\n").slice(0, 3200);
}

// ---- What kind of page this is. Each note says what it means for a change.
// Re-renders: elements whose children the page replaced lately.
const Churn = (() => {
  const seen = new Map(); // element -> recent times its child elements were replaced
  try {
    const mo = new MutationObserver(recs => {
      if (!live()) { mo.disconnect(); seen.clear(); return; } // `morse stop`: stop watching every change on the page
      const now = Date.now();
      for (const r of recs) {
        const t = r.target;
        if (t.nodeType !== 1 || !r.removedNodes.length || t.closest("[data-morse-ui],[data-morse]")) continue;
        if (![...r.removedNodes].some(n => n.nodeType === 1 && !n.hasAttribute("data-morse") && !n.hasAttribute("data-morse-ui"))) continue;
        let ts = seen.get(t);
        if (!ts) { if (seen.size > 200) seen.clear(); seen.set(t, ts = []); }
        if (now - (ts.at(-1) || 0) > 50) ts.push(now); // one render, many records
        if (ts.length > 30) ts.shift();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  return {
    // [element, renders] in the last windowMs, busiest first; outermost wins.
    recent(windowMs = 20000) {
      const now = Date.now(), out = [];
      for (const [el, ts] of seen) {
        const n = ts.filter(t => now - t < windowMs).length;
        if (!el.isConnected) seen.delete(el);
        else if (n) out.push([el, n]);
      }
      return out.filter(([el]) => !out.some(([o]) => o !== el && o.contains(el))).sort((a, b) => b[1] - a[1]).slice(0, 3);
    },
  };
})();
// Virtualized lists: a scroller much taller than the rows it holds, whose rows
// are positioned (absolute/transform): the same row elements are reused for
// other items as you scroll.
let virtualCache = null;
function virtualLists() {
  if (virtualCache && Date.now() - virtualCache.at < 500) return virtualCache.lists;
  const lists = [];
  const els = document.body ? document.body.getElementsByTagName("*") : [];
  for (let i = 0; i < els.length && i < 8000 && lists.length < 3; i++) {
    const el = els[i];
    if (el.clientHeight < 80 || el.scrollHeight < el.clientHeight * 4 || el.closest("[data-morse-ui]")) continue;
    if (!/auto|scroll/.test(styleOf(el).overflowY)) continue;
    // The rows' parent: el itself or a descendant a few levels down.
    const queue = [[el, 0]];
    while (queue.length) {
      const [p, d] = queue.shift();
      const kids = [...p.children];
      if (kids.length >= 6) {
        const key = groupKey(kids[kids.length >> 1]), rows = kids.filter(k => groupKey(k) === key);
        const placed = rows.filter(k => { const s = styleOf(k); return /absolute|fixed/.test(s.position) || s.transform !== "none"; });
        if (rows.length >= 6 && placed.length >= rows.length * 0.8) {
          const h = Math.max(1, rows[0].getBoundingClientRect().height);
          lists.push({ list: el, row: rows[0], n: rows.length, total: Math.round(el.scrollHeight / h) });
          break;
        }
      }
      if (d < 3) for (const k of kids.slice(0, 20)) queue.push([k, d + 1]);
    }
  }
  virtualCache = { at: Date.now(), lists };
  return lists;
}
function virtualNote(v) {
  const row = similar(v.row)?.sel || selectorFor(v.row);
  const fields = [...v.row.children].slice(0, 6).map(selName);
  return `${selectorFor(v.list)} is a virtualized list: ${v.n} row elements (${row}) stand in for about ${v.total.toLocaleString("en-US")} items. As you scroll, the same row elements are reused for other items (their text and attributes change, the elements stay). So decide from a row's current content every time it changes: morse.watch(${jsStr(row)}, fn, { live: true }) re-runs fn whenever a row changes. fn must set and unset (classList.toggle(cls, condition), el.hidden = !condition), and read the row's text when clicked, not when a button is made.${fields.length > 1 ? ` Each row holds ${fields.join(", ")}: read a field from its own element (the row's textContent runs them together).` : ""}`;
}
function pageNotes(roots) {
  const notes = [];
  // Generated class names (CSS modules, emotion, Tailwind JIT builds…)
  let withClass = 0, hashed = 0;
  const examples = new Set(), modules = new Set();
  for (const root of roots) {
    for (const el of root.querySelectorAll("[class]")) {
      if (++withClass > 3000) break;
      const cl = [...el.classList];
      if (!cl.length || !cl.every(looksHashed)) continue;
      hashed++;
      if (examples.size < 3) examples.add(cl[0]);
      const m = cl[0].match(/^([A-Z][A-Za-z0-9]*_[A-Za-z0-9]+__)[A-Za-z0-9_-]{4,}$/);
      if (m && modules.size < 2) modules.add(m[1]);
    }
  }
  if (withClass >= 20 && hashed / withClass > 0.4) notes.push(`Class names here are generated (${[...examples].join(", ")}) and change with every release of the app: never use them. Use the selectors given (tags and structure), ids, aria-*/data-* attributes, roles or text.${modules.size ? ` CSS-module names keep a readable start that stays stable: [class*="${[...modules][0]}"].` : ""}`);
  // Web components
  const hosts = new Map();
  for (const r of roots) if (r.nodeType === 11 && r.host) {
    const t = r.host.localName, h = hosts.get(t) || { n: 0, root: r, outer: outerOf(r.host) };
    h.n++;
    hosts.set(t, h);
  }
  if (hosts.size) {
    const list = [...hosts].slice(0, 5).map(([t, h]) => {
      const api = shadowApi(h.root);
      return `<${t}>${h.n > 1 ? ` ×${h.n}` : ""}${h.outer ? ` (inside <${h.outer.localName}>)` : ""}${api.parts.length ? `, parts: ${api.parts.join(", ")}` : ""}${api.vars.length ? `, reads ${api.vars.join(", ")}` : ""}`;
    });
    const most = [...hosts].sort((a, b) => b[1].n - a[1].n)[0][0];
    notes.push(`Web components with open shadow roots: ${list.join("; ")}. Page CSS stops at a shadow root (only inherited text styles, ::part() and CSS variables get in). To change what's inside, use JS: morse.css(css, "${most}") puts CSS inside each matching component, with plain selectors; morse.watch("${most} >>> selector", fn) finds elements inside ("a >>> b >>> c" for nested ones). The layout marks components "shadow root"; the lines under them are inside.`);
  }
  // Frames
  const frames = [...document.querySelectorAll("iframe,frame")].filter(f => !f.closest("[data-morse-ui]") && f.getBoundingClientRect().width > 40);
  if (frames.length) {
    const same = frames.filter(frameDoc), other = frames.filter(f => !frameDoc(f));
    if (same.length) notes.push(`Frames showing pages of this site: ${same.slice(0, 4).map(f => `${selectorFor(f)} ("${clip(frameDoc(f).title || f.title, 30)}")`).join(", ")}. Page CSS doesn't apply inside a frame: use JS, morse.css(css, ${jsStr(selectorFor(same[0]))}) for CSS inside it and morse.watch(${jsStr(selectorFor(same[0]) + " >>> selector")}, fn) for its elements. The layout shows what's inside under the frame's line.`);
    if (other.length) notes.push(`Frames from other sites (out of reach, only their box can change): ${other.slice(0, 3).map(selectorFor).join(", ")}.`);
  }
  for (const v of virtualLists()) notes.push(virtualNote(v));
  const churn = Churn.recent();
  if (churn.length) notes.push(`This page re-renders: lately the app replaced what is inside ${churn.map(([el, n]) => `${selectorFor(el)} (${n}×)`).join(", ")}. Anything a script adds there, or changes on elements in there, is wiped on the next render. CSS keeps working. In JS, use morse.watch (it puts things back after a re-render), never a one-time querySelector. Something computed from the page (a count, a total) must be computed again when the page changes: watch it with { live: true }.`);
  const canvases = [...document.querySelectorAll("canvas")].filter(c => { const r = c.getBoundingClientRect(); return r.width >= 150 && r.height >= 100 && !c.closest("[data-morse-ui]"); });
  if (canvases.length) notes.push(`Drawn on <canvas>: ${canvases.slice(0, 3).map(c => `${selectorFor(c)} (${c.width}×${c.height})`).join(", ")}. What a canvas shows is pixels, not elements: CSS can size, move or hide it; reading or saving the picture is canvas.toBlob()/toDataURL(); drawing is the app's job (use its own buttons and shortcuts where they exist).`);
  // Trusted Types (VS Code): HTML strings throw in the page's world, where mods run.
  if (/require-trusted-types-for/.test([...document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')].map(m => m.content).join(" ")))
    notes.push("This app refuses HTML strings (Trusted Types): innerHTML, insertAdjacentHTML and morse.el's html throw. Build elements with morse.el(tag, { text, class }, ...kids) and textContent.");
  return notes.map(n => "- " + n).join("\n");
}

// ---- design: the app's own design language, so a new button, panel or count
// looks like it shipped with the app (core/prompt.js, "Design system").
// designOf(el) returns a few compact lines:
//   - light or dark, and whether the app has both (theme classes, media queries)
//   - the CSS variables near what was pointed at: the ones its rules (and the
//     exemplars' rules) read, ones named after where it is, the core palette
//   - fonts, and the text size, spacing and radius the app uses most
//   - 2 to 4 of the app's own components nearby (a button, a field, a list row,
//     a header) with their classes and look, variables kept as written
//   - its icons (codicons, lucide, Font Awesome, a sprite, inline SVG) and emoji
// Everything goes through redact() with the rest of the context.
const DESIGN_KINDS = [
  ["button", "button,[role=button],input[type=button],input[type=submit],a[class*=button],a[class*=btn]"],
  ["field", "input:not([type]),input[type=text],input[type=search],input[type=number],textarea,select"],
  ["list row", "[role=treeitem],[role=option],[role=listitem],li,[role=row],[class*=tree-item],[class*=list-item],[class*=listitem]"],
  ["header", "h2,h3,h4,[role=heading],[class*=header]:not([class*=item],button),[class*=title]:not([class*=item],button)"],
];
const DESIGN_PROPS = ["color", "background-color", "background", "border", "border-color", "border-bottom", "border-radius", "padding", "font-family", "font-size", "font-weight", "line-height", "height", "box-shadow", "outline"];
const CORE_VAR = /(^|-)(fore|back)ground$|accent|interactive|primary|secondary|focus|border(-colou?r)?$|font-(family|size|interface|text|ui|mono)|radius|button-(back|fore|border|hover)|input-(back|fore|border)|text-(normal|muted|faint|accent)|(^|-)(bg|fg)(-|$)|hover|selection|widget-(back|border|shadow)|shadow|spacing|(^|-)size-\d/i;
const DESIGN_STOP = /^(border|outline|shadow|radius|colou?r|background|foreground|item|items|label|icon|icons|text|title|action|actions|link|style|styled|theme|dark|light|show|enabled|disabled|motion|enable|modern|linux|chromium|windows|frameless|focused|scrollbars|floating|connected|visible|hidden|default|status|separator|view|node|grid|split|branch|vertical|horizontal|monaco|wrapper|layout|flex)$/;
const DARK_SEL = /(?:\.(?:dark|dark-mode|dark-theme|theme-dark|vs-dark)|\[data-(?:theme|color-mode|mode|bs-theme)[~^*]?=["']?dark["']?\])(?![\w-])/;
const NOISE_VAR = /^--tw-|twoslash|icon-[\w-]*(content|font-family)$|-ansi|z-index|^--layer-|-animation|-duration|transition|-easing|csstools|^--cursor$|-position$|corner-shape/i;
// "??", "Segoe UI", sans-serif -> "Segoe UI", sans-serif (Obsidian leaves placeholders in its font lists)
const fontList = f => String(f || "").split(",").map(s => s.trim()).filter(s => /\p{L}/u.test(s)).join(", ");
const designShown = el => { const r = el.getBoundingClientRect(); return r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && !isMorseUI(el) && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true })); };
const px = v => (/^-?[\d.]+px$/.test(v) ? Math.round(parseFloat(v)) + "px" : v);
const hex = c => { const m = String(c).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/); if (!m) return c; if (m[4] != null && +m[4] < 1) return +m[4] === 0 ? "transparent" : c; return "#" + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, "0")).join(""); };
const lum = c => { const m = String(c).match(/\d+(\.\d+)?/g); if (!m) return 1; const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// The background that shows behind el: the first one up its ancestors that isn't transparent.
function shownBg(el) {
  const doc = el.ownerDocument;
  // The body's background paints the whole window when the root has none.
  const clear = b => /^(transparent|rgba\(.*,\s*0\))$/.test(b);
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const b = styleOf(n).backgroundColor; if (!clear(b)) return b; }
  const b = doc.body ? styleOf(doc.body).backgroundColor : "";
  return b && !clear(b) ? b : "rgb(255, 255, 255)";
}
// The nearest visible element of a kind: searched in el's ancestors from the
// closest out, the one nearest to el on screen; with no el, the first on screen.
function nearestOf(sel, el, skip) {
  const doc = el?.ownerDocument || document, at = el?.getBoundingClientRect();
  const ok = e => e !== el && !skip.has(e) && designShown(e) && e.getBoundingClientRect().height <= 90 && e.getBoundingClientRect().width <= innerWidth * 0.6
    && !/transparent|rgba\(.*,\s*0\)$/.test(styleOf(e).color); // not a hidden helper (VS Code's IME textarea)
  for (let a = el || doc.body, i = 0; a && i < 12; a = a.parentElement || outerOf(a), i++) {
    let found;
    try { found = [...a.querySelectorAll(sel)].slice(0, 300).filter(ok); } catch { return null; }
    if (!found.length) continue;
    if (!at) return found[0];
    const d = e => { const r = e.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - at.x - at.width / 2, r.y + r.height / 2 - at.y - at.height / 2); };
    return found.sort((x, y) => d(x) - d(y))[0];
  }
  return null;
}
// One pass over the style sheets for a few elements: the declarations each
// matches (hover ones apart) and the CSS variables those rules read.
function designRules(els) {
  const out = new Map(els.map(e => [e, { decl: {}, hover: {}, vars: new Set() }]));
  const marks = new Set();
  for (const e of els) { for (const c of e.classList) marks.add("." + c); if (e.id) marks.add("#" + e.id); }
  const roots = [...new Set(els.map(e => e.getRootNode()))];
  let budget = 30000, dark = false, darkSel = "";
  const take = (r, hover) => {
    const sel = hover ? r.selectorText.replace(/:hover\b/g, "") : r.selectorText;
    const named = sel.match(/[.#][\w-]+/g);
    if (named && !named.some(n => marks.has(n.replace(/\\/g, "")))) return; // speed: only rules that name these elements' classes or ids (or none)
    for (const e of els) {
      let hit = false;
      try { hit = e.matches(sel); } catch {}
      if (!hit) continue;
      const o = out.get(e), into = hover ? o.hover : o.decl;
      for (const p of DESIGN_PROPS) {
        const v = r.style.getPropertyValue(p);
        if (v && (!into[p] || r.style.getPropertyPriority(p) || !into[p].imp)) into[p] = { v, imp: !!r.style.getPropertyPriority(p) };
      }
      for (const m of r.cssText.matchAll(/var\(\s*(--[\w-]+)/g)) o.vars.add(m[1]);
    }
  };
  const walk = (rules, win) => {
    for (const r of rules) {
      if (--budget < 0) return;
      if (r.selectorText) {
        if (!darkSel) darkSel = (r.selectorText.match(DARK_SEL) || [""])[0]; // a theme switched by a class or attribute
        take(r, /:hover\b/.test(r.selectorText));
      }
      else if (r.cssRules) {
        if (r.media && /prefers-color-scheme/.test(r.media.mediaText)) dark = true;
        if (!r.media || win.matchMedia(r.media.mediaText).matches) walk(r.cssRules, win);
      }
    }
  };
  for (const root of roots) {
    const win = (root.ownerDocument || root).defaultView || window;
    for (const sheet of sheetsOf(root)) {
      if (sheet.ownerNode?.hasAttribute?.("data-morse-css") || sheet.ownerNode?.closest?.("[data-morse-ui]")) continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      walk(rules, win);
    }
  }
  for (const e of els) for (const m of (e.getAttribute("style") || "").matchAll(/var\(\s*(--[\w-]+)/g)) out.get(e).vars.add(m[1]);
  return { per: out, darkMedia: dark, darkSel };
}
// "background var(--x) = #1e1e1e": as the rule says it, and what it is now.
function designLook(el, rules) {
  const cs = styleOf(el), r = el.getBoundingClientRect(), d = rules?.decl || {};
  const say = (p, now) => { const v = d[p]?.v; return v && /var\(/.test(v) ? `${clip(v, 70)}${now && now !== v ? ` = ${now}` : ""}` : now; };
  const bits = [`${Math.round(r.height)}px tall`];
  const pad = cs.padding.split(" ").map(px).join(" ");
  if (pad !== "0px") bits.push(`padding ${pad}`);
  bits.push(`font ${px(cs.fontSize)} ${cs.fontWeight !== "400" ? cs.fontWeight + " " : ""}${clip(fontList(cs.fontFamily).split(",")[0], 30)}`);
  bits.push(`color ${say("color", hex(cs.color))}`);
  const bg = hex(cs.backgroundColor);
  if (bg !== "transparent" || d["background-color"] || d.background) bits.push(`background ${say(d["background-color"] ? "background-color" : "background", bg)}`);
  const bw = parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth);
  if (bw) bits.push(`border ${say(d.border ? "border" : d["border-bottom"] ? "border-bottom" : "border-color", `${px(cs.borderTopWidth)} ${cs.borderTopStyle} ${hex(cs.borderTopColor)}`)}`);
  if (cs.borderRadius !== "0px") bits.push(`radius ${say("border-radius", px(cs.borderRadius))}`);
  if (cs.boxShadow !== "none") bits.push(`shadow ${clip(say("box-shadow", cs.boxShadow), 70)}`);
  const hv = rules?.hover || {}, hk = ["background-color", "background", "color"].find(p => hv[p]);
  if (hk) bits.push(`hover ${hk.replace("-color", "")} ${clip(hv[hk].v, 60)}`);
  return bits.join(", ");
}
const designTag = (el, wrap = true) => {
  const cls = [...el.classList].filter(c => !looksHashed(c) && !STATE_CLASS.test(c)).slice(0, 4);
  const role = el.getAttribute("role");
  const tag = `<${el.localName}${cls.length ? ` class="${cls.join(" ")}"` : ""}${role ? ` role="${role}"` : ""}>`;
  // A wrapper that is part of the component (VS Code's div.statusbar-item around its label).
  const p = el.parentElement;
  return wrap && p && p.children.length === 1 && [...p.classList].some(c => !looksHashed(c)) ? `${designTag(p, false)} > ${tag}` : tag;
};
function iconsOf(el) {
  const doc = el?.ownerDocument || document;
  const near = sel => { const e = el ? nearestOf(sel, el, new Set()) : null; try { return e || doc.querySelector(sel); } catch { return null; } };
  const names = (sel, re) => { const s = new Set(); try { for (const e of doc.querySelectorAll(sel)) { for (const c of (e.getAttribute("class") || "").split(/\s+/)) { const m = c.match(re); if (m && s.size < 4) s.add(m[0]); } if (s.size >= 4) break; } } catch {} return [...s]; };
  if (near('.codicon[class*="codicon-"]')) return `codicons, an icon font: <span class="codicon codicon-NAME"></span> (in use: ${names(".codicon", /^codicon-[\w-]+$/).join(", ")}). Sized by font-size (16px), colored by color.`;
  const luc = near('svg[class*="lucide-"]');
  if (luc) return `lucide SVG icons (<svg class="${clip(luc.getAttribute("class"), 50)}">, ${Math.round(luc.getBoundingClientRect().width)}px, stroke currentColor). There is no icon font: copy one the app already shows with cloneNode(true) (in use: ${names('svg[class*="lucide-"]', /^lucide-[\w-]+$/).join(", ")}).`;
  if (near('[class*="fa-"]:is(.fa,.fas,.far,.fab,.fa-solid,.fa-regular,i)')) return `Font Awesome: <i class="fas fa-NAME"></i> (in use: ${names('[class*="fa-"]', /^fa-(?!solid|regular|brands|fw|lg)[\w-]+$/).join(", ")}).`;
  if (near(".material-icons,.material-symbols-outlined,.material-symbols-rounded")) return `Material icons: <span class="material-icons">NAME</span>.`;
  const font = names('[class^="icon-"],[class*=" icon-"]', /^icon-[\w-]+$/);
  if (font.length) return `icon-font classes: <i class="icon-NAME"></i> (in use: ${font.join(", ")}).`;
  const use = near('svg use[href^="#"],svg use[*|href^="#"]');
  if (use) return `an SVG sprite: <svg><use href="#ID"></use></svg> (e.g. ${clip(use.getAttribute("href") || use.getAttribute("xlink:href"), 30)}).`;
  const svg = near("svg");
  if (svg) { const r = svg.getBoundingClientRect(), s = styleOf(svg); return `inline SVG icons (${Math.round(r.width)}px, ${s.stroke && s.stroke !== "none" ? "stroked" : "filled"} with currentColor): copy one the app shows, or draw a simple one the same way.`; }
  return "";
}
function designOf(el) {
  const doc = el?.ownerDocument || document, body = doc.body;
  if (!body) return "";
  const here = el || body, lines = [];
  // Exemplars: the app's own components near what was pointed at.
  const skip = new Set(), ex = [];
  // The items that already live where it was pointed (a status bar's entries,
  // a toolbar's buttons): a new one there should look like them.
  if (el) {
    const kids = [...el.children].filter(c => designShown(c) && c.getBoundingClientRect().height <= 90);
    const item = kids.find(c => kids.filter(d => groupKey(d) === groupKey(c)).length >= 2 && /\S/.test(c.textContent));
    if (item) { skip.add(item); ex.push(["item here", item]); }
  }
  for (const [kind, sel] of DESIGN_KINDS) {
    if (ex.length >= 4) break;
    const e = nearestOf(sel, el, skip);
    if (!e || (kind === "header" && !/\S/.test([...e.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join("")) && e.children.length > 2)) continue;
    skip.add(e); ex.push([kind, e]);
  }
  const ups = [];
  for (let a = el?.parentElement, i = 0; a && a !== body && i < 4; a = a.parentElement, i++) ups.push(a);
  const { per, darkMedia, darkSel } = designRules([...(el ? [el] : []), ...ups, ...ex.map(x => x[1])]);
  // ---- light or dark: the page's, from what fills the middle of the window
  // (the part pointed at may differ, like a dark sidebar)
  const mid = [...(doc.elementsFromPoint?.(innerWidth / 2, innerHeight / 2) || [])].find(e => !isMorseUI(e)) || body;
  const bg = shownBg(mid), dark = lum(bg) < 0.25, own = el ? shownBg(el) : bg;
  const marks = new Set();
  const chain = [];
  for (let a = here; a; a = a.parentElement || outerOf(a)) chain.push(a);
  for (const n of [...new Set([doc.documentElement, body, body.firstElementChild, ...chain])].filter(Boolean)) {
    for (const c of n.classList) if (/(^|[-_])(dark|light)([-_]|$)|^(vs|vs-dark|hc-black|hc-light)$/i.test(c)) marks.add(`.${c}`);
    for (const a of ["data-theme", "data-color-mode", "data-mode", "data-color-scheme", "data-bs-theme"]) if (n.getAttribute(a)) marks.add(`[${a}="${n.getAttribute(a)}"]`);
  }
  const scheme = styleOf(doc.documentElement).colorScheme;
  if (darkSel) marks.add(darkSel);
  const both = marks.size || darkMedia || /light dark|dark light/.test(scheme);
  lines.push(`Mode: ${dark ? "dark" : "light"} (background ${hex(bg)}${Math.abs(lum(own) - lum(bg)) > 0.2 ? `; the part pointed at: ${hex(own)}` : ""}${marks.size ? `; ${[...marks].slice(0, 4).join(" ")}` : ""}). ${both ? "The app has light and dark themes: use its variables (or inherit/currentColor) so the change follows the theme." : "No dark theme found."}`);
  // ---- variables
  const cs = styleOf(here), vars = new Map();
  let defined = 0;
  // Words naming where this is ("statusbar", "sidebar", "nav"), never how it looks ("border", "active").
  const words = new Set();
  for (const n of [here, ...ups.slice(0, 1)]) for (const raw of [n.id, ...n.classList]) for (const w of String(raw || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/)) if (w.length >= 4 && !NAMELESS.test(w) && !DESIGN_STOP.test(w) && !looksHashed(w)) words.add(w);
  const regionWords = [...words].slice(0, 8);
  const usedNear = new Map();
  for (const [e, o] of per) for (const v of o.vars) usedNear.set(v, (usedNear.get(v) || 0) + (e === el || ex.some(x => x[1] === e) ? 2 : 1));
  for (let i = 0; i < cs.length && i < 6000; i++) {
    const name = cs[i];
    if (!name.startsWith("--")) continue;
    defined++;
    if (NOISE_VAR.test(name)) continue;
    const flat = name.toLowerCase().replace(/[^a-z]/g, "");
    const score = Math.min(3, usedNear.get(name) || 0) * 3 + (regionWords.some(w => flat.includes(w)) ? 3 : 0) + (CORE_VAR.test(name) ? 2 : 0);
    if (score < 2) continue;
    const v = cs.getPropertyValue(name).trim(); // speed: only the ones that may be kept (VS Code defines 3,000+)
    if (v && v.length <= 60 && !/url\(|^["']|^\\/.test(v)) vars.set(name, { v, score });
  }
  for (const [name] of usedNear) if (!vars.has(name) && !NOISE_VAR.test(name)) { const v = cs.getPropertyValue(name).trim(); if (v && v.length <= 60 && !/url\(/.test(v)) vars.set(name, { v, score: 9 }); }
  const picked = [...vars].sort((a, b) => b[1].score - a[1].score || a[0].length - b[0].length).slice(0, 30).sort((a, b) => a[0].localeCompare(b[0]));
  if (picked.length) lines.push(`CSS variables (${picked.length} of the ${defined} the app defines, picked for this spot):\n` + picked.map(([n, o]) => `${n}: ${clip(o.v, 50)}`).join("; "));
  else lines.push("CSS variables: none. The app sets colors directly: reuse the exact values of the components below.");
  // ---- fonts and scale: what the visible elements around here use most
  const area = (() => { for (let a = el; a && a !== body; a = a.parentElement) { const r = a.getBoundingClientRect(); if (r.width * r.height >= innerWidth * innerHeight * 0.15) return a; } return body; })();
  const count = new Map(), bump = (k, v) => { if (!v || v === "0px" || v === "normal" || v === "auto") return; const m = count.get(k) || new Map(); m.set(v, (m.get(v) || 0) + 1); count.set(k, m); };
  const w = doc.createTreeWalker(area, NodeFilter.SHOW_ELEMENT);
  let mono = "";
  for (let n = w.currentNode, k = 0; n && k < 900; n = w.nextNode(), k++) {
    if (isMorseUI(n) || !designShown(n)) continue;
    const s = styleOf(n);
    if (!n.closest("pre,code") && [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) { bump("text", px(s.fontSize)); bump("font", fontList(s.fontFamily)); }
    for (const p of ["paddingTop", "paddingLeft", "gap"]) if (/^\d+(\.\d+)?px$/.test(s[p])) bump("space", px(s[p]));
    if (s.borderTopLeftRadius !== "0px" && parseFloat(s.borderTopLeftRadius) < 40) bump("radius", px(s.borderTopLeftRadius));
    if (/^(button|input|select)$/.test(n.localName) || n.getAttribute("role") === "button") bump("control", Math.round(n.getBoundingClientRect().height) + "px");
    if (!mono && /^(code|pre|kbd)$/.test(n.localName)) mono = `${clip(fontList(s.fontFamily).split(",")[0], 30)} ${px(s.fontSize)}`;
  }
  const top = (k, n) => [...(count.get(k) || [])].sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  const font = top("font", 1)[0] || fontList(styleOf(here).fontFamily);
  lines.push(`Fonts: ${clip(font, 90)}${mono ? `; code: ${mono}` : ""}. Text sizes, most used first: ${top("text", 4).join(", ") || px(styleOf(here).fontSize)}. Spacing: ${top("space", 6).sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ") || "-"}. Radius: ${top("radius", 3).join(", ") || "none (square)"}.${count.get("control") ? ` Control heights: ${top("control", 3).join(", ")}.` : ""}`);
  // ---- components
  if (ex.length) lines.push("The app's own components near here (reuse their classes and look for new ones of the same kind):\n" + ex.map(([kind, e]) => `- ${kind}: ${designTag(e)} ${clip(e.innerText || e.getAttribute("aria-label") || "", 24) ? `"${clip(e.innerText || e.getAttribute("aria-label"), 24)}" ` : ""}${designLook(e, per.get(e))}`).join("\n"));
  // ---- icons
  const icons = iconsOf(el);
  const emoji = /\p{Extended_Pictographic}/u.test(clip(body.innerText, 4000).replace(/[©®™]/g, ""));
  lines.push(`Icons: ${icons || "none found."}${emoji ? " The app shows emoji in its text." : " The app uses no emoji: don't use emoji as icons."}`);
  return lines.join("\n").slice(0, 3400);
}

// Visible blocks as an indented tree: name, size, layout and look flags,
// repeated siblings collapsed to ×N. Wrappers that only hold one child of the
// same size are skipped. Components show what's in their shadow root and
// frames show their page, under their own line. A parent with many kinds of
// children lists the first and last ones, so the end of a long page shows too.
function layout(maxLines = 70, top = document.body) {
  const lines = [], minArea = innerWidth * innerHeight * 0.004;
  const skip = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|BR|HR|OPTION)$/;
  const line = (el, n, depth) => {
    const cs = styleOf(el), r = el.getBoundingClientRect();
    const f = [`${Math.round(r.width)}×${Math.round(r.height)}`];
    if (/fixed|sticky/.test(cs.position)) f.push(cs.position);
    if (/grid|flex/.test(cs.display)) f.push(cs.display.replace("inline-", ""));
    if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) f.push("scrolls");
    if (cs.backgroundImage !== "none") f.push(/url\(/.test(cs.backgroundImage) ? "bg-image" : "bg-gradient");
    if (el.shadowRoot && !el.hasAttribute("data-morse-ui")) f.push("shadow root");
    if (/^i?frame$/.test(el.localName)) f.push(frameDoc(el) ? `frame: "${clip(frameDoc(el).title, 24)}"` : "frame from another site");
    if (el.localName === "canvas") f.push(`canvas ${el.width}×${el.height}`);
    const own = /^(input|textarea|select)$/.test(el.localName) ? "" : [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(" ").trim();
    const text = clip(own || (el.children.length <= 3 && !/^(input|textarea|select)$/.test(el.localName) ? el.innerText : ""), 32);
    // Repeated items show their attributes: that's where state lives (data-unread, aria-selected).
    const attrs = n < 2 ? "" : [...el.attributes].filter(a => !/^(class|style|on|href$|src$|value$)/.test(a.name)).slice(0, 5)
      .map(a => `${a.name}="${clip(redactAttr(el, a.name, a.value), 20)}"`).join(" ");
    // A list's container with no name of its own gets its full selector.
    const bare = n < 2 && selName(el) === el.localName && [...el.children].filter(k => groupKey(k) === groupKey(el.children[0] || el)).length >= 3;
    return "  ".repeat(depth) + (n > 1 ? `${kindOf(el)} ×${n}` : selName(el)) + (attrs ? ` [${attrs}]` : "") + ` (${f.join(", ")})` + (text ? ` "${text}"` : "") + (bare ? ` = ${selectorFor(el)}` : "");
  };
  const childrenOf = el => {
    const inner = innerRoot(el);
    if (inner && !isMorseUI(el)) return inner.nodeType === 9 ? (inner.body ? [inner.body] : []) : [...inner.children, ...el.children];
    return [...el.children];
  };
  const visit = (el, depth) => {
    const kids = childrenOf(el).filter(c => !skip.test(c.tagName) && !c.hasAttribute("data-morse-ui"));
    const groups = [];
    for (let i = 0; i < kids.length;) {
      let j = i + 1;
      const key = groupKey(kids[i]);
      while (j < kids.length && groupKey(kids[j]) === key) j++;
      groups.push([kids[i], j - i]);
      i = j;
    }
    const shown = groups.length > 14 ? [...groups.slice(0, 9), null, ...groups.slice(-4)] : groups;
    for (const g of shown) {
      if (lines.length >= maxLines) return;
      if (!g) { lines.push("  ".repeat(depth) + `… ${groups.length - 13} more blocks`); continue; }
      let [c, n] = g;
      const r = c.getBoundingClientRect(), area = r.width * r.height;
      if (area < minArea && !(n >= 3 && area >= minArea / 4)) continue;
      const cs = styleOf(c);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      // Skip anonymous same-size single-child wrappers.
      while (c.children.length === 1 && !innerRoot(c) && selName(c) === c.tagName.toLowerCase() && !/auto|scroll/.test(styleOf(c).overflowY)) {
        const only = c.children[0], o = only.getBoundingClientRect();
        if (o.width * o.height < area * 0.9 || skip.test(only.tagName)) break;
        c = only;
      }
      lines.push(line(c, n, depth));
      if (depth < 8) visit(c, depth + 1);
    }
  };
  if (top) visit(top, 0);
  return lines.join("\n").slice(0, 3500);
}
// For the engine's "did the change do anything?" check: a fingerprint of what
// is rendered (boxes, key styles, text) in the page, its open shadow roots and
// same-origin frames, plus which of the mod's selectors match nothing. Hosts
// call it before and after applying a draft.
function effectProbe(target, selectors = []) {
  // Styles for the first 4000 elements, boxes for the rest (both cost little
  // per element, but styles add up on a page of 10,000+).
  let h = 7, budget = 4000, boxes = 20000;
  const add = s => { s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; };
  for (const root of allRoots(40)) {
    const doc = root.nodeType === 9 ? root : null;
    if (doc && !doc.body) continue;
    const els = doc ? doc.body.getElementsByTagName("*") : root.querySelectorAll("*");
    add(els.length);
    if (doc) {
      add(doc.title); add(doc.body.innerText);
      const rs = styleOf(doc.documentElement);
      add(rs.filter + rs.backgroundColor + styleOf(doc.body).backgroundColor);
    } else add(root.textContent);
    for (let i = 0; i < els.length && boxes > 0; i++, boxes--) {
      const e = els[i];
      if (e.hasAttribute("data-morse-ui")) continue;
      const r = e.getBoundingClientRect();
      if (budget-- <= 0) { add(`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`); continue; }
      const s = styleOf(e);
      add(`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}|${s.color}|${s.backgroundColor}|${s.backgroundImage.length}|${s.opacity}|${s.visibility}|${s.fontSize}|${s.fontWeight}|${s.fontFamily.length}|${s.borderRadius}|${s.borderColor}|${s.boxShadow.length}|${s.filter}|${s.transform}|${s.outlineStyle}|${s.position}|${s.cursor}|${s.textDecorationLine}`);
    }
  }
  const unmatched = selectors.filter(sel => { try { return !deepAll(sel).length; } catch { return true; } });
  return { fp: String(h), unmatched };
}
// The hosts' effect check asks for it from Morse's own JS world (the desktop
// connector over CDP, the extension's content script): never the page's. A
// short wait lets just-applied CSS start rendering (transitions move) first.
globalThis.__morseProbe = (target, selectors) => new Promise(r => setTimeout(() => r(effectProbe(target, selectors)), 100));
// polish (core/polish.js): the part of the window to show the model, in CSS
// px of the viewport: what was pointed at plus what the mod made, with some
// of the app around it (at least 560×260), within the window. Its scale keeps
// the picture within 1280×900. Only for the top document; null in a frame.
function shotArea(selector, modId) {
  if (window.top !== window) return null;
  const rects = [];
  let t = null;
  try { t = selector ? deepAll(selector).find(e => e.ownerDocument === document) : null; } catch {}
  if (t) rects.push(t.getBoundingClientRect());
  if (modId) for (const e of document.querySelectorAll(`[data-morse="${cssEsc(modId)}"]`)) { const r = e.getBoundingClientRect(); if (r.width && r.height) rects.push(r); }
  const W = innerWidth, H = innerHeight, on = rects.filter(r => r.bottom > 0 && r.right > 0 && r.top < H && r.left < W);
  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (on.length) {
    x0 = Math.min(...on.map(r => r.left)) - 32; y0 = Math.min(...on.map(r => r.top)) - 32;
    x1 = Math.max(...on.map(r => r.right)) + 32; y1 = Math.max(...on.map(r => r.bottom)) + 32;
    const grow = (a, b, min) => { const d = Math.max(0, min - (b - a)) / 2; return [a - d, b + d]; };
    [x0, x1] = grow(x0, x1, 560); [y0, y1] = grow(y0, y1, 260);
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  const width = x1 - x0, height = y1 - y0;
  if (width < 8 || height < 8) return null;
  return { x: x0, y: y0, width, height, scrollX, scrollY, vw: W, vh: H, scale: Math.min(1, 1280 / width, 900 / height) };
}
function context() {
  const cs = getComputedStyle(document.body);
  const roots = allRoots();
  const ctx = {
    url: location.href, title: document.title, app: S.app, lang: getLanguage(), // Ask answers in the language Morse speaks (core/prompt.js)
    theme: { bg: cs.backgroundColor, fg: cs.color, font: cs.fontFamily.split(",")[0] },
    notes: pageNotes(roots),
    outline: outline(roots),
    layout: layout(),
  };
  try { ctx.design = designOf(S.target && S.target.isConnected ? S.target : null); } catch {} // design: never in the way of the rest
  if (S.target && S.target.isConnected) {
    const path = [], t = S.target, outer = outerOf(t);
    for (let n = t.parentElement, i = 0; n && n !== t.ownerDocument.body && i < 5; n = n.parentElement, i++) path.unshift(segment(n).s);
    if (outer) path.unshift(`${selectorFor(outer)} >>>`);
    ctx.target = { selector: selectorFor(t), label: describe(t, "en"), html: snippet(t, { styles: true }), path: path.join(" > ").replace(">>> >", ">>>"), facts: targetFacts(t) };
  }
  return redact(ctx); // redact: nothing secret leaves the page
}

// Small targets (one button) are framed by their component, so the effect
// and the share-card crop are big enough to see.
function focusFor(el) {
  let n = el;
  const area = innerWidth * innerHeight;
  while (n.parentElement && n.parentElement !== document.body) {
    const r = n.getBoundingClientRect();
    if (r.width >= 220 || r.height >= 90) break;
    const pr = n.parentElement.getBoundingClientRect();
    if (pr.width * pr.height > area * 0.35) break;
    n = n.parentElement;
  }
  return n;
}
