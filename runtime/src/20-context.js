const HASHED = /^(css|sc|jsx|emotion|styled|svelte|chakra|mui)-|^_?[a-z0-9]{5,}$|[A-Z][a-z]+_[a-z]+__[a-zA-Z0-9]{5}/;
const looksHashed = s => /\d/.test(s) && /[a-z]/i.test(s) && HASHED.test(s) || /^[a-z]{1,3}[0-9][a-z0-9]{3,}$/i.test(s);
const cssEsc = s => (globalThis.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));

function stableAttr(el) {
  for (const a of ["data-testid", "data-test", "data-qa", "data-id", "aria-label", "name", "role", "placeholder", "title"]) {
    const v = el.getAttribute?.(a);
    if (v && v.length < 60 && !looksHashed(v)) return `[${a}="${cssEsc(v)}"]`;
  }
  return "";
}
function segment(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id && !looksHashed(el.id)) return { s: `#${cssEsc(el.id)}`, anchor: true };
  const attr = stableAttr(el);
  if (attr && !/^\[role=/.test(attr)) return { s: tag + attr, anchor: true };
  const classes = [...el.classList].filter(c => !looksHashed(c)).slice(0, 2).map(c => "." + cssEsc(c)).join("");
  let s = tag + (attr || classes);
  const p = el.parentElement;
  if (p) {
    const same = [...p.children].filter(c => c.tagName === el.tagName);
    if (same.length > 1 && !classes && !attr) s += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return { s, anchor: false };
}
function selectorFor(el) {
  const parts = [];
  for (let n = el, i = 0; n && n.nodeType === 1 && n !== document.documentElement && i < 5; n = n.parentElement, i++) {
    const seg = segment(n);
    parts.unshift(seg.s);
    if (seg.anchor) break;
    if (n === document.body) break;
  }
  let sel = parts.join(" > ");
  try { if (document.querySelector(sel) !== el) sel = parts.slice(-3).join(" > "); } catch {}
  return sel;
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
  return { name: text, from: "text" };
}
function describe(el) {
  const role = roleWord(el);
  const { name, from } = nameOf(el);
  const short = name.length > 28 ? name.slice(0, 27).trimEnd() + "…" : name;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if (!short) return cap(role || (el.children.length ? "section" : "text"));
  // A container named by its first line of text is "“Release notes” section", not "Release notes".
  const kind = role || (from === "text" && el.children.length ? "section" : "");
  if (!kind || short.toLowerCase().endsWith(kind)) return from === "text" && !kind ? `“${short}”` : short;
  const words = short.split(" ").length;
  const plain = words <= 3 && !short.endsWith("…") && (from === "label" || /button|link|tab|menu item|option|checkbox|switch/.test(kind));
  return plain ? `${short} ${kind}` : `“${short}” ${kind}`;
}
function snippet(el, { styles = false } = {}) {
  const clone = el.cloneNode(true);
  const walk = (n, depth) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) { if (c.textContent.length > 120) c.textContent = c.textContent.slice(0, 120) + "…"; continue; }
      if (c.nodeType !== 1) { c.remove(); continue; }
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(c.tagName) || c.hasAttribute("data-morse-ui")) { c.remove(); continue; }
      if (c.tagName === "svg") { c.innerHTML = ""; }
      for (const a of [...c.attributes]) {
        if ((a.name === "style" && !styles) || a.name.startsWith("on")) c.removeAttribute(a.name);
        else if (a.value.length > 80) c.setAttribute(a.name, a.value.slice(0, 80) + "…");
      }
      if (depth > 4) { c.innerHTML = "…"; continue; }
      walk(c, depth + 1);
    }
    const kids = [...n.children];
    if (kids.length > 12) kids.slice(12).forEach(k => k.remove());
  };
  walk(clone, 0);
  if (!styles) clone.removeAttribute?.("style");
  else if ((clone.getAttribute?.("style") || "").length > 80) clone.setAttribute("style", clone.getAttribute("style").slice(0, 80) + "…");
  const html = clone.outerHTML;
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
const outlineLabel = el => (el.getAttribute("aria-label") || el.innerText || el.textContent || el.getAttribute("placeholder") || el.getAttribute("title") || "")
  .trim().split("\n")[0].replace(/\s+/g, " ").slice(0, 40);
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
  try {
    if (document.querySelectorAll(sel).length <= 1 || !el.parentElement) return sel;
    const k = [...el.parentElement.children].filter(c => c.localName === el.localName).indexOf(el) + 1;
    const nth = `${sel}:nth-of-type(${k})`;
    if (document.querySelector(nth) === el) return nth;
  } catch {}
  return sel;
}
function outline() {
  const label = outlineLabel, isTrigger = isMenuTrigger;
  const shown = el => el.getClientRects().length > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true }));
  const whereHidden = el => {
    const w = hiddenWhere(el);
    return !w ? "" : w.menu ? `in closed menu "${w.menu}"` : `in "${w.panel}", not open`;
  };
  const picked = [[], [], [], []];
  let i = 0;
  for (const el of document.querySelectorAll(OUTLINE_Q)) {
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
  // Within a kind, the ways around (settings, account, export…) go first.
  const lines = picked.flatMap((list, k) => [...list].sort((a, b) => b.ways - a.ways || a.i - b.i).slice(0, OUTLINE_BUDGET[k]))
    .sort((a, b) => a.i - b.i).map(x => uniqueSelector(x.el) + x.rest);
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
function kindOf(el) {
  const tag = el.tagName.toLowerCase();
  const cls = [...el.classList].find(c => !looksHashed(c) && !STATE_CLASS.test(c));
  const data = [...el.attributes].find(a => a.name.startsWith("data-") && !a.name.startsWith("data-morse"));
  const role = el.getAttribute("role");
  return tag + (cls ? "." + cssEsc(cls) : "") + (data ? `[${data.name}]` : role ? `[role="${role}"]` : "");
}
function selName(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id && !looksHashed(el.id)) return `${tag}#${cssEsc(el.id)}`;
  const attr = stableAttr(el);
  const cls = [...el.classList].filter(c => !looksHashed(c)).slice(0, 2).map(c => "." + cssEsc(c)).join("");
  return tag + (attr && !/^\[role=/.test(attr) ? attr : cls || attr);
}
function rulesFor(el, max = 5) {
  const out = [];
  const walk = rules => {
    for (const r of rules) {
      if (out.length >= max) return;
      if (r.selectorText) {
        if (/^\s*\*\s*$/.test(r.selectorText)) continue;
        try { if (el.matches(r.selectorText)) out.push(clip(r.cssText, 240)); } catch {}
      } else if (r.cssRules && (!r.media || matchMedia(r.media.mediaText).matches)) walk(r.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    const owner = sheet.ownerNode;
    if (owner?.hasAttribute?.("data-morse-css") || owner?.hasAttribute?.("data-morse") || owner?.closest?.("[data-morse-ui]")) continue;
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin
    walk(rules);
  }
  return out;
}
function looks(el) {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const bits = [`${Math.round(r.width)}×${Math.round(r.height)}px`, `display ${cs.display}`];
  if (cs.position !== "static") bits.push(`position ${cs.position}`);
  bits.push(`color ${cs.color}`, `background ${cs.backgroundColor}${cs.backgroundImage !== "none" ? " + " + clip(cs.backgroundImage, 70) : ""}`);
  bits.push(`font ${cs.fontSize} ${cs.fontWeight}`);
  if (cs.borderRadius !== "0px") bits.push(`radius ${cs.borderRadius}`);
  return bits.join(", ");
}
function targetFacts(el) {
  const lines = [`Looks: ${looks(el)}`];
  const media = el.matches("img,video,canvas,svg,picture,iframe") ? [el] : [...el.querySelectorAll("img,video,canvas,svg,picture,iframe")];
  const bgs = [el, ...el.querySelectorAll("*")].slice(0, 300).filter(e => getComputedStyle(e).backgroundImage !== "none");
  if (media.length) lines.push(`Media inside: ${[...new Set(media.map(m => m.tagName.toLowerCase()))].map(t => `<${t}>`).join(", ")}`);
  if (bgs.length) lines.push(`${media.length ? "Also" : "No <img>: the visuals are"} CSS background images on ${[...new Set(bgs.map(selName))].slice(0, 3).join(", ")}`);
  const kind = kindOf(el);
  let n = 0;
  try { n = document.querySelectorAll(kind).length; } catch {}
  if (n > 1) lines.push(`${n} elements on the page match ${kind} (the same kind of element)`);
  const p = el.parentElement;
  if (p && p !== document.documentElement) {
    const pc = getComputedStyle(p);
    lines.push(`Parent ${selName(p)}: ${Math.round(p.getBoundingClientRect().width)}px wide, display ${pc.display}${/grid/.test(pc.display) ? `, ${pc.gridTemplateColumns.split(" ").length} columns` : ""}`);
  }
  const own = rulesFor(el), up = p ? rulesFor(p, 3) : [];
  if (own.length) lines.push("CSS rules on it:\n" + own.join("\n"));
  if (up.length) lines.push("CSS rules on its parent:\n" + up.join("\n"));
  // The grid/flex container that decides its size, when that's further up.
  for (let a = p?.parentElement, i = 0; a && a !== document.body && i < 3; a = a.parentElement, i++) {
    if (!/grid|flex/.test(getComputedStyle(a).display)) continue;
    const rs = rulesFor(a, 3);
    if (rs.length) lines.push(`CSS rules on the ${getComputedStyle(a).display} container ${selName(a)}:\n` + rs.join("\n"));
    break;
  }
  return lines.join("\n").slice(0, 2400);
}
// Visible blocks as an indented tree: name, size, layout and look flags,
// repeated siblings collapsed to ×N. Wrappers that only hold one child of the
// same size are skipped.
function layout(maxLines = 70) {
  const lines = [], minArea = innerWidth * innerHeight * 0.004;
  const skip = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|BR|HR|OPTION)$/;
  const line = (el, n, depth) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const f = [`${Math.round(r.width)}×${Math.round(r.height)}`];
    if (/fixed|sticky/.test(cs.position)) f.push(cs.position);
    if (/grid|flex/.test(cs.display)) f.push(cs.display.replace("inline-", ""));
    if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) f.push("scrolls");
    if (cs.backgroundImage !== "none") f.push(/url\(/.test(cs.backgroundImage) ? "bg-image" : "bg-gradient");
    const own = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(" ").trim();
    const text = clip(own || (el.children.length <= 3 ? el.innerText : ""), 32);
    // Repeated items show their attributes: that's where state lives (data-unread, aria-selected).
    const attrs = n < 2 ? "" : [...el.attributes].filter(a => !/^(class|style|on|href$|src$)/.test(a.name)).slice(0, 5)
      .map(a => `${a.name}="${clip(a.value, 20)}"`).join(" ");
    return "  ".repeat(depth) + (n > 1 ? `${kindOf(el)} ×${n}` : selName(el)) + (attrs ? ` [${attrs}]` : "") + ` (${f.join(", ")})` + (text ? ` "${text}"` : "");
  };
  const visit = (el, depth) => {
    const kids = [...el.children].filter(c => !skip.test(c.tagName) && !c.hasAttribute("data-morse-ui"));
    for (let i = 0; i < kids.length && lines.length < maxLines;) {
      let c = kids[i], j = i + 1;
      const key = kindOf(c);
      while (j < kids.length && kindOf(kids[j]) === key) j++;
      const n = j - i;
      i = j;
      const r = c.getBoundingClientRect(), area = r.width * r.height;
      if (area < minArea && !(n >= 3 && area >= minArea / 4)) continue;
      const cs = getComputedStyle(c);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      // Skip anonymous same-size single-child wrappers.
      while (c.children.length === 1 && selName(c) === c.tagName.toLowerCase() && !/auto|scroll/.test(getComputedStyle(c).overflowY)) {
        const only = c.children[0], o = only.getBoundingClientRect();
        if (o.width * o.height < area * 0.9 || skip.test(only.tagName)) break;
        c = only;
      }
      lines.push(line(c, n, depth));
      if (depth < 8) visit(c, depth + 1);
    }
  };
  visit(document.body, 0);
  return lines.join("\n").slice(0, 3500);
}
// For the engine's "did the change do anything?" check: a fingerprint of what
// is rendered (boxes, key styles, text), plus which of the mod's selectors
// match nothing. Hosts call it before and after applying a draft.
function effectProbe(target, selectors = []) {
  let h = 7;
  const add = s => { s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; };
  const els = document.body.getElementsByTagName("*");
  add(els.length); add(document.title); add(document.body.innerText);
  const root = getComputedStyle(document.documentElement);
  add(root.filter + root.backgroundColor + getComputedStyle(document.body).backgroundColor);
  for (let i = 0; i < Math.min(els.length, 4000); i++) {
    const e = els[i], r = e.getBoundingClientRect(), s = getComputedStyle(e);
    add(`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}|${s.color}|${s.backgroundColor}|${s.backgroundImage.length}|${s.opacity}|${s.visibility}|${s.fontSize}|${s.fontWeight}|${s.fontFamily.length}|${s.borderRadius}|${s.borderColor}|${s.boxShadow.length}|${s.filter}|${s.transform}|${s.outlineStyle}|${s.position}|${s.cursor}`);
  }
  const unmatched = selectors.filter(sel => { try { return !document.querySelector(sel); } catch { return true; } });
  return { fp: String(h), unmatched };
}
function context() {
  const cs = getComputedStyle(document.body);
  const ctx = {
    url: location.href, title: document.title, app: S.app,
    theme: { bg: cs.backgroundColor, fg: cs.color, font: cs.fontFamily.split(",")[0] },
    outline: outline(),
    layout: layout(),
  };
  if (S.target && S.target.isConnected) {
    const path = [];
    for (let n = S.target.parentElement, i = 0; n && n !== document.body && i < 5; n = n.parentElement, i++) path.unshift(segment(n).s);
    ctx.target = { selector: selectorFor(S.target), label: describe(S.target), html: snippet(S.target, { styles: true }), path: path.join(" > "), facts: targetFacts(S.target) };
  }
  return ctx;
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
