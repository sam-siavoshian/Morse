// Small shared pieces for the site pages: header state, the radar marks,
// the Morse-code "signal", a tiny monochrome highlighter, mod cards, toast.
import { mountAll } from "./radar.js";

export const REPO = "https://github.com/sam-siavoshian/RRAA";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function initPage() {
  mountAll();
  const top = document.querySelector(".top");
  if (top) {
    const onScroll = () => top.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  for (const el of document.querySelectorAll("[data-signal]")) signal(el, el.dataset.signal);
  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      const src = document.getElementById(btn.dataset.copy);
      await copyText(src ? src.innerText.replace(/^\$ /gm, "") : btn.dataset.copy);
      flash(btn, "Copied");
    });
  }
}

// ---------- Morse code ----------
const CODE = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--.." };

export function signal(el, text) {
  el.classList.add("signal");
  el.setAttribute("aria-hidden", "true");
  let n = 0;
  const html = [];
  for (const ch of text.toUpperCase()) {
    if (ch === " ") { html.push("<b></b><b></b>"); continue; }
    const code = CODE[ch];
    if (!code) continue;
    if (html.length) html.push("<b></b>");
    for (const sym of code) html.push(`<i class="${sym === "-" ? "dash" : "dot"}" style="--i:${n++}"></i>`);
  }
  el.innerHTML = html.join("");
}

// ---------- highlighter (grays only: comments dim, strings mid, keywords bright) ----------
const TOKENS = /(\/\*[\s\S]*?\*\/|(?<![:\w])\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(const|let|var|if|else|return|function|new|for|of|while|true|false|null|undefined)\b|([{}();,])/g;

export function highlight(code, lang = "js") {
  let out = "", last = 0;
  for (const m of code.matchAll(TOKENS)) {
    out += esc(code.slice(last, m.index));
    const [t, com, str, kw, punct] = m;
    if (com) out += `<span class="c">${esc(t)}</span>`;
    else if (str) out += `<span class="s">${esc(t)}</span>`;
    else if (kw && lang === "js") out += `<span class="k">${esc(t)}</span>`;
    else if (punct) out += `<span class="p">${esc(t)}</span>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  return out + esc(code.slice(last));
}

// ---------- mod cards ----------
export function appGlyph(app) {
  const words = String(app).split(/\s+/);
  if (words[0].length <= 2 && words[0] === words[0].toUpperCase()) return words[0];
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0][0].toUpperCase();
}

export const slugOf = entry => entry.file.replace(/\.morse\.json$/, "");

export function modCard(entry, { href, onOpen } = {}) {
  const el = document.createElement(href ? "a" : "button");
  el.className = "card";
  if (href) el.href = href;
  else el.type = "button";
  el.dataset.slug = slugOf(entry);
  el.innerHTML = `
    <div class="card-top">
      <span class="card-app"><span class="glyph" aria-hidden="true">${esc(appGlyph(entry.app))}</span>${esc(entry.app)}</span>
      ${entry.surface ? `<span class="card-surface">${esc(entry.surface)}</span>` : ""}
    </div>
    <h3>${esc(entry.title)}</h3>
    <p class="prompt">“${esc(entry.prompt)}”</p>
    <div class="tags">${(entry.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    <svg class="card-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>`;
  if (onOpen) el.addEventListener("click", e => { e.preventDefault(); onOpen(entry, el); });
  return el;
}

// ---------- clipboard + toast ----------
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function flash(btn, text) {
  const prev = btn.dataset.label || btn.textContent;
  btn.dataset.label = prev;
  btn.textContent = text;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = prev; }, 1400);
}

let toastEl;
export function toast(message) {
  if (!toastEl) {
    toastEl = Object.assign(document.createElement("div"), { className: "s-toast", role: "status" });
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}
