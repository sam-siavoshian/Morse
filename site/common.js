// Small shared pieces for the site pages: the nav bar, the links and video
// from config.js, the radar marks, a tiny monochrome highlighter, mod cards,
// copy buttons and a toast.
import { mountAll } from "./radar.js";
import { LINKS, DEMO_VIDEO } from "./config.js";

export const REPO = LINKS.github;

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initPage() {
  mountAll();
  applyLinks();
  initNav();
  // The share page's header (share/install.html) gets a line once scrolled.
  const top = document.querySelector(".top");
  if (top) {
    const onScroll = () => top.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  for (const el of document.querySelectorAll("[data-film]")) mountFilm(el);
  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      const src = document.getElementById(btn.dataset.copy);
      await copyText(src ? src.innerText.replace(/^\$ /gm, "") : btn.dataset.copy);
      flash(btn, "Copied");
    });
  }
}

// Buttons name a key in LINKS (data-link="chrome"); the HTML carries the same
// placeholder so they work before this runs.
export function applyLinks(root = document) {
  for (const a of root.querySelectorAll("a[data-link]")) {
    const href = LINKS[a.dataset.link];
    if (!href) continue;
    // A link to this same page stays a fragment, so it scrolls instead of
    // loading the page again (/site/ and /site/index.html are one page).
    const page = u => u.origin + u.pathname.replace(/\/index\.html$/, "/");
    const url = new URL(href, location.href);
    a.href = url.hash && page(url) === page(new URL(location.href)) ? url.hash : href;
  }
}

// ---------- the nav bar ----------
// Wide screens: menus open on hover (with a short grace period so the pointer
// can travel into the panel), on click and from the keyboard: Enter or Space
// toggles, ArrowDown opens and moves into the first link, Escape closes and
// returns focus, and tabbing out closes. Narrow screens: a toggle opens a
// sheet with the same links. It closes on a link, on Escape, on a press
// outside it, and when the window grows past the breakpoint.
const CLOSE_DELAY_MS = 140;
const WIDE = "(min-width: 900px)";

export function initNav(nav = document.querySelector("header.nav")) {
  if (!nav?.querySelector(".nav-bar")) return;
  const items = [...nav.querySelectorAll(".nav-item[data-menu]")];
  const toggle = nav.querySelector(".nav-toggle");
  const sheet = nav.querySelector(".nav-menu");
  let open = null, hoverOpened = null, timer = 0;

  const panelOf = item => item.querySelector(".nav-panel");
  const triggerOf = item => item.querySelector(".nav-trigger");
  const setOpen = item => {
    open = item;
    for (const it of items) {
      const on = it === item;
      it.classList.toggle("is-open", on);
      triggerOf(it).setAttribute("aria-expanded", String(on));
      panelOf(it).hidden = !on;
    }
  };
  const closeSoon = () => { clearTimeout(timer); timer = setTimeout(() => { hoverOpened = null; setOpen(null); }, CLOSE_DELAY_MS); };
  const setSheet = on => {
    nav.classList.toggle("is-open", on);
    toggle?.setAttribute("aria-expanded", String(on));
    toggle?.setAttribute("aria-label", on ? "Close menu" : "Open menu");
    if (sheet) sheet.inert = !on;
  };
  setSheet(false);

  for (const item of items) {
    const trigger = triggerOf(item), panel = panelOf(item);
    item.addEventListener("pointerenter", e => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(timer);
      if (open !== item) hoverOpened = item;
      setOpen(item);
    });
    item.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") closeSoon(); });
    item.addEventListener("focusout", e => {
      if (e.relatedTarget && !item.contains(e.relatedTarget) && open === item) setOpen(null);
    });
    trigger.addEventListener("click", e => {
      // detail 0 is Enter or Space, which always toggles. A mouse user who
      // hovered it open and then presses means "open".
      if (e.detail > 0 && hoverOpened === item) { hoverOpened = null; setOpen(item); return; }
      hoverOpened = null;
      setOpen(open === item ? null : item);
    });
    trigger.addEventListener("keydown", e => {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      setOpen(item);
      requestAnimationFrame(() => panel.querySelector("a")?.focus());
    });
    panel.addEventListener("keydown", e => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const links = [...panel.querySelectorAll("a")];
      const at = links.indexOf(document.activeElement);
      if (at === -1) return;
      e.preventDefault();
      if (e.key === "ArrowUp" && at === 0) { trigger.focus(); return; }
      links[Math.min(links.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    });
    panel.addEventListener("click", e => { if (e.target.closest("a")) setOpen(null); });
  }

  toggle?.addEventListener("click", () => setSheet(!nav.classList.contains("is-open")));
  sheet?.addEventListener("click", e => { if (e.target.closest("a")) setSheet(false); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (open) { triggerOf(open).focus(); setOpen(null); }
    if (nav.classList.contains("is-open")) { setSheet(false); toggle?.focus(); }
  });
  document.addEventListener("pointerdown", e => {
    if (nav.contains(e.target)) return;
    setOpen(null);
    setSheet(false);
  });
  nav.addEventListener("focusout", e => {
    if (e.relatedTarget && !nav.contains(e.relatedTarget)) { setOpen(null); setSheet(false); }
  });
  matchMedia(WIDE).addEventListener("change", e => { if (e.matches) setSheet(false); });
}

// ---------- the film ----------
// Before the press it plays muted on a loop, so the first screen is already
// moving; the press starts it from the beginning, with sound and controls.
// Reduced motion: no autoplay, the poster stays until the press. The loop has
// its own pause control, apart from the play press (WCAG 2.2.2).
export function mountFilm(figure, film = DEMO_VIDEO) {
  const frame = figure.querySelector(".hero-film-frame");
  const play = figure.querySelector(".hero-film-play");
  const toggle = figure.querySelector(".hero-film-toggle");
  const caption = figure.querySelector("figcaption");
  if (!frame || frame.querySelector("video")) return;
  frame.style.setProperty("--film-ratio", `${film.width} / ${film.height}`);
  // The poster behind the video too, for a browser that can't play the file.
  frame.style.backgroundImage = `url("${new URL(film.poster, location.href).href}")`;
  const video = document.createElement("video");
  Object.assign(video, { muted: true, loop: true, playsInline: true, preload: "metadata", poster: film.poster });
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-label", film.label);
  video.width = film.width;
  video.height = film.height;
  const source = Object.assign(document.createElement("source"), { src: film.mp4, type: "video/mp4" });
  video.append(source);
  frame.prepend(video);
  if (caption && film.caption) caption.textContent = film.caption;

  const paused = () => figure.classList.toggle("is-paused", video.paused);
  video.addEventListener("play", paused);
  video.addEventListener("pause", paused);
  if (reducedMotion()) paused();
  else { video.autoplay = true; video.play().catch(paused); }

  toggle?.addEventListener("click", () => { video.paused ? video.play().catch(() => {}) : video.pause(); });
  play?.addEventListener("click", () => {
    figure.classList.add("is-started");
    video.loop = false;
    video.muted = false;
    video.controls = true;
    video.currentTime = 0;
    video.play().catch(() => {});
    video.focus();
  });
}

// ---------- highlighter (grays only: comments dim, strings mid, keywords bright) ----------
const TOKENS = /(\/\*[\s\S]*?\*\/|(?<![:\w])\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(const|let|var|if|else|return|function|new|for|of|while|true|false|null|undefined)\b|([{}();,])/g;

// Characters that change how code reads without being seen (direction
// overrides, zero-width and control characters) are written out as \u202e,
// as in Morse's own review (core/summary.js shownCode; not imported here, so
// the landing page doesn't load the summary and its words).
const HIDDEN_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
export function highlight(code, lang = "js") {
  code = String(code).replace(/\r\n?/g, "\n").replace(HIDDEN_CHARS, c => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
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
  const words = String(app).split(/\s+/).filter(w => /^[\p{L}\d]/u.test(w)); // "Inkwell (demo)" is I, not I(
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
