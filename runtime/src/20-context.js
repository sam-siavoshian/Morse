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
function describe(el) {
  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.innerText || "").trim().split("\n")[0];
  return name ? `${tag} · “${name.slice(0, 28)}${name.length > 28 ? "…" : ""}”` : tag;
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
    picked[tier].push({ i: i++, line: `${uniqueSelector(el)}${t ? `  "${t.replace(/"/g, "'")}"` : ""}${note ? `  (${note})` : ""}`, ways: OUTLINE_WAYS.test(t) });
  }
  // Within a kind, the ways around (settings, account, export…) go first.
  const lines = picked.flatMap((list, k) => [...list].sort((a, b) => b.ways - a.ways || a.i - b.i).slice(0, OUTLINE_BUDGET[k]))
    .sort((a, b) => a.i - b.i).map(x => x.line);
  let out = "";
  for (const l of lines) { if (out.length + l.length + 1 > 3600) break; out += (out ? "\n" : "") + l; }
  return out;
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
