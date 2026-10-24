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
