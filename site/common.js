// Small shared pieces for the site pages: the nav bar, the links and video
// from config.js, the radar marks, a tiny monochrome highlighter, mod cards,
// copy buttons and a toast.
import { mountAll } from "./radar.js";
import { LINKS, DEMO_VIDEO, APP_ICONS } from "./config.js";

export const REPO = LINKS.github;

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Phones, touch screens and Save-Data: nothing heavy loads by itself.
const lightOnly = () => !!navigator.connection?.saveData || matchMedia("(max-width: 700px), (hover: none) and (pointer: coarse)").matches;

export function initPage() {
  mountAll();
  applyLinks();
  initNav();
  openDetailsOnHash();
  // The nav bar (and the share page's header) gets a line once scrolled.
  const bars = document.querySelectorAll("header.nav, .top");
  if (bars.length) {
    const onScroll = () => { for (const b of bars) b.classList.toggle("scrolled", scrollY > 8); };
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
// "desktop" (Download Morse) is this visitor's own download when the browser
// says which system it is on (a Mac gets the Apple silicon one; the steps
// under the button list every download).
export function desktopLink(nav = globalThis.navigator) {
  const p = `${nav?.userAgentData?.platform || ""} ${nav?.platform || ""} ${nav?.userAgent || ""}`;
  if (/android|iphone|ipad|cros/i.test(p)) return LINKS.desktop;
  if (/mac/i.test(p)) return LINKS.desktopMac;
  if (/win/i.test(p)) return LINKS.desktopWindows;
  if (/linux/i.test(p)) return LINKS.desktopLinux;
  return LINKS.desktop;
}

export function applyLinks(root = document) {
  for (const a of root.querySelectorAll("a[data-link]")) {
    const href = a.dataset.link === "desktop" ? desktopLink() : LINKS[a.dataset.link];
    if (!href) continue;
    // A link to this same page stays a fragment, so it scrolls instead of
    // loading the page again (/site/ and /site/index.html are one page).
    const page = u => u.origin + u.pathname.replace(/\/index\.html$/, "/");
    const url = new URL(href, location.href);
    a.href = url.hash && page(url) === page(new URL(location.href)) ? url.hash : href;
  }
}

// A link to a <details> (the install steps: ./#chrome-steps) opens it, on
// load and on every later jump to it.
export function openDetailsOnHash() {
  // A broken link (#%E0) can't be read: then it names nothing.
  const target = hash => { try { return document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return null; } };
  const open = el => { if (el?.tagName === "DETAILS") el.open = true; };
  addEventListener("hashchange", () => open(target(location.hash)));
  document.addEventListener("click", e => {
    const a = e.target.closest?.('a[href*="#"]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.pathname === location.pathname) open(target(url.hash));
  });
  if (location.hash.length > 1) open(target(location.hash));
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
// The poster shows at once (it is an <img> in the page, so the first screen
// is fast). The loop (a small 1280-wide copy, WebM or MP4, no sound) loads
// only after the page has loaded and the film is near the screen; then it
// plays muted. The press starts the full-quality file from the beginning,
// with sound and controls. No autoplay with reduced motion, on phones and
// touch screens, or with Save-Data on: the poster stays until the press. The loop has its own pause control, apart from
// the play press (WCAG 2.2.2).
export function mountFilm(figure, film = DEMO_VIDEO) {
  const frame = figure.querySelector(".film-frame");
  const play = figure.querySelector(".film-play");
  const toggle = figure.querySelector(".film-toggle");
  const caption = figure.querySelector("figcaption");
  const strip = figure.querySelector("[data-film-strip]");
  const poster = figure.querySelector(".film-poster");
  if (!frame || frame.querySelector("video")) return;
  frame.style.setProperty("--film-ratio", `${film.width} / ${film.height}`);
  if (poster && poster.getAttribute("src") !== film.poster) poster.src = film.poster;
  if (caption && film.caption) caption.textContent = film.caption;
  if (strip && film.strip) strip.textContent = film.strip;

  const video = document.createElement("video");
  Object.assign(video, { muted: true, loop: true, playsInline: true, preload: "none", poster: film.poster });
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-label", film.label);
  video.width = film.width;
  video.height = film.height;
  frame.prepend(video);

  let loaded = null;
  // "loop": the small web copies; "full": the file with sound, for the press.
  const load = (kind = "loop") => {
    if (loaded === kind || (kind === "loop" && loaded)) return;
    loaded = kind;
    video.replaceChildren();
    const files = kind === "loop" && film.loop ? [[film.loop.webm, "video/webm"], [film.loop.mp4, "video/mp4"]] : [[film.mp4, "video/mp4"]];
    for (const [src, type] of files) if (src) video.append(Object.assign(document.createElement("source"), { src, type }));
    video.load();
  };
  const state = () => {
    figure.classList.toggle("is-paused", video.paused);
    figure.classList.toggle("is-playing", !video.paused || video.currentTime > 0);
  };
  video.addEventListener("play", state);
  video.addEventListener("pause", state);
  video.addEventListener("playing", state);

  // Autoplay the loop once the page is in, and only while it is on screen.
  if (!reducedMotion() && !lightOnly()) {
    const start = () => {
      const io = new IntersectionObserver(([e]) => {
        if (figure.classList.contains("is-started")) return;
        if (e.isIntersecting) { load(); video.play().catch(state); }
        else if (!video.paused) video.pause();
      }, { rootMargin: "200px 0px" });
      io.observe(figure);
    };
    if (document.readyState === "complete") start();
    else addEventListener("load", start, { once: true });
  }

  toggle?.addEventListener("click", () => { video.paused ? video.play().catch(() => {}) : video.pause(); });
  play?.addEventListener("click", () => {
    load("full");
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
// The app's real icon (config.js APP_ICONS), or its first letter when there is none.
export function appIcon(app, size = 30) {
  const src = APP_ICONS[app];
  return src ? `<img class="glyph glyph-img" src="${esc(src)}" width="${size}" height="${size}" alt="" aria-hidden="true">`
    : `<span class="glyph" aria-hidden="true">${esc(appGlyph(app))}</span>`;
}

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
      <span class="card-app">${appIcon(entry.app)}${esc(entry.app)}</span>
      ${entry.surface ? `<span class="card-surface">${esc(entry.surface)}</span>` : ""}
    </div>
    <h3>${esc(entry.title)}</h3>
    <p class="prompt">“${esc(entry.prompt)}”</p>
    <div class="tags">${(entry.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    <span class="card-arrow" aria-hidden="true">→</span>`;
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
