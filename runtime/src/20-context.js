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
function snippet(el) {
  const clone = el.cloneNode(true);
  const walk = (n, depth) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) { if (c.textContent.length > 120) c.textContent = c.textContent.slice(0, 120) + "…"; continue; }
      if (c.nodeType !== 1) { c.remove(); continue; }
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(c.tagName) || c.hasAttribute("data-morse-ui")) { c.remove(); continue; }
      if (c.tagName === "svg") { c.innerHTML = ""; }
      for (const a of [...c.attributes]) {
        if (a.name === "style" || a.name.startsWith("on")) c.removeAttribute(a.name);
        else if (a.value.length > 80) c.setAttribute(a.name, a.value.slice(0, 80) + "…");
      }
      if (depth > 4) { c.innerHTML = "…"; continue; }
      walk(c, depth + 1);
    }
    const kids = [...n.children];
    if (kids.length > 12) kids.slice(12).forEach(k => k.remove());
  };
  walk(clone, 0);
  clone.removeAttribute?.("style");
  const html = clone.outerHTML;
  return html.length > 3000 ? html.slice(0, 3000) + "…" : html;
}
function outline() {
  const lines = [];
  const q = "header,nav,main,aside,footer,[role=main],[role=navigation],h1,h2,h3,button,[role=button],input,textarea,form";
  for (const el of document.querySelectorAll(q)) {
    if (el.closest("[data-morse-ui]") || !el.getClientRects().length) continue;
    const t = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().split("\n")[0].slice(0, 40);
    lines.push(`${selectorFor(el)}${t ? `  "${t}"` : ""}`);
    if (lines.length >= 40) break;
  }
  return lines.join("\n").slice(0, 1800);
}
function context() {
  const cs = getComputedStyle(document.body);
  const ctx = {
    url: location.href, title: document.title, app: S.app,
    theme: { bg: cs.backgroundColor, fg: cs.color, font: cs.fontFamily.split(",")[0] },
    outline: outline(),
  };
  if (S.target && S.target.isConnected) {
    const path = [];
    for (let n = S.target.parentElement, i = 0; n && n !== document.body && i < 5; n = n.parentElement, i++) path.unshift(segment(n).s);
    ctx.target = { selector: selectorFor(S.target), label: describe(S.target), html: snippet(S.target), path: path.join(" > ") };
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
