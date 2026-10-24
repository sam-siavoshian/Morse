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
function nameOf(el) {
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
  if (bgs.length) lines.push(`${media.length ? "Also" : "No <img>: the visuals are"} CSS background images on ${[...new Set(bgs.map(nameOf))].slice(0, 3).join(", ")}`);
  const kind = kindOf(el);
  let n = 0;
  try { n = document.querySelectorAll(kind).length; } catch {}
  if (n > 1) lines.push(`${n} elements on the page match ${kind} (the same kind of element)`);
  const p = el.parentElement;
  if (p && p !== document.documentElement) {
    const pc = getComputedStyle(p);
    lines.push(`Parent ${nameOf(p)}: ${Math.round(p.getBoundingClientRect().width)}px wide, display ${pc.display}${/grid/.test(pc.display) ? `, ${pc.gridTemplateColumns.split(" ").length} columns` : ""}`);
  }
  const own = rulesFor(el), up = p ? rulesFor(p, 3) : [];
  if (own.length) lines.push("CSS rules on it:\n" + own.join("\n"));
  if (up.length) lines.push("CSS rules on its parent:\n" + up.join("\n"));
  // The grid/flex container that decides its size, when that's further up.
  for (let a = p?.parentElement, i = 0; a && a !== document.body && i < 3; a = a.parentElement, i++) {
    if (!/grid|flex/.test(getComputedStyle(a).display)) continue;
    const rs = rulesFor(a, 3);
    if (rs.length) lines.push(`CSS rules on the ${getComputedStyle(a).display} container ${nameOf(a)}:\n` + rs.join("\n"));
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
    return "  ".repeat(depth) + (n > 1 ? `${kindOf(el)} ×${n}` : nameOf(el)) + (attrs ? ` [${attrs}]` : "") + ` (${f.join(", ")})` + (text ? ` "${text}"` : "");
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
      while (c.children.length === 1 && nameOf(c) === c.tagName.toLowerCase() && !/auto|scroll/.test(getComputedStyle(c).overflowY)) {
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
