// Suggestion chips under an empty input, chosen from what you pointed at.
// Tab reaches them; ←/→ move between them; Enter fills the input; Esc goes back to
// the input. A chip with `fill` puts its text in the input to finish instead.

// A chip in the person's language: label "sug.<id>", what it asks "sug.<id>.p"
// (core/locales/en.js). The request goes to the model in that language too.
const sugOf = (id, extra) => ({ id, label: t(`sug.${id}`), prompt: t(`sug.${id}.p`), ...extra });
const PAGE_SUGGESTIONS = () => ["darkPage", "distractions", "readPage"].map(id => sugOf(id));

// Three good first changes for THIS page, from what's on it: ads, a player, a
// long read, a box to type in, its colors (first-run hook: the first try
// should be one that works and shows). Read once per address, only when the
// bar shows its suggestions, never on page load.
const PAGE_IDEAS = { ads: "ads", media: "sleep", read: "readPage", type: "wordCountPage", dark: "darkPage", light: "lightPage", popups: "popups" };
let pageIdeasFor = "", pageIdeas = null;
let genericSuggestions = null;
let pageScanQueued = false;
// The first open paints generic chips. Reading the page (rects, styles) waits
// a frame so the bar is on screen first.
function genericPageSuggestions() {
  return genericSuggestions || (genericSuggestions = PAGE_SUGGESTIONS());
}
function schedulePageIdeas() {
  if (pageScanQueued || (pageIdeas && pageIdeasFor === location.href + getLanguage())) return;
  pageScanQueued = true;
  const run = () => {
    pageScanQueued = false;
    if (!S.open || S.phase !== "idle" || input.value) return;
    const had = sugEl.contains(root.activeElement);
    const at = had ? [...sugEl.querySelectorAll(".sug")].indexOf(root.activeElement) : -1;
    pageSuggestions();
    updateChips();
    if (!had) return;
    const items = [...sugEl.querySelectorAll(".sug")];
    items[Math.max(0, Math.min(at, items.length - 1))]?.focus();
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}
function pageSuggestions() {
  if (pageIdeas && pageIdeasFor === location.href + getLanguage()) return pageIdeas;
  const shown = el => !el.closest("[data-morse-ui]") && el.getClientRects().length > 0;
  const some = (sel, test = shown) => { try { return [...document.querySelectorAll(sel)].slice(0, 60).some(test); } catch { return false; } };
  const found = [];
  if (some('[data-ad], .ad-slot, .adsbygoogle, [id^="google_ads"], [aria-label="Sponsored" i], [aria-label="Advertisement" i], [class~="ad"], [class~="ads"], [class*="advert"], iframe[src*="doubleclick"], iframe[src*="googlesyndication"]')) found.push("ads");
  if (some('audio, video, [data-testid*="player" i], [aria-label*="player" i], [class*="player" i]')) found.push("media");
  const words = (document.querySelector("article, main, [role=main]")?.innerText || "").length;
  if (words > 600 || [...document.querySelectorAll("p")].slice(0, 80).filter(p => (p.textContent || "").length > 120).length >= 3) found.push("read");
  if (some('textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]', el => shown(el) && el.getBoundingClientRect().width > 200)) found.push("type");
  found.push(pageTheme() === "dark" ? "light" : "dark");
  // Floating boxes: fixed to the window, not a top or side bar.
  const floats = [...(document.body?.children || [])].slice(0, 80).some(el => {
    if (!shown(el)) return false;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return cs.position === "fixed" && r.width < innerWidth * 0.9 && r.height > 40 && r.top > 60;
  });
  if (floats) found.push("popups");
  const list = found.slice(0, 3).map(k => sugOf(PAGE_IDEAS[k]));
  const themed = found.includes("light") || found.includes("dark");
  for (const s of [sugOf(PAGE_IDEAS.read), ...PAGE_SUGGESTIONS()]) if (list.length < 3 && !list.some(x => x.label === s.label) && !(themed && s.id === "darkPage")) list.push(s);
  pageIdeasFor = location.href + getLanguage();
  return (pageIdeas = list);
}

function looksMedia(el) {
  if (el.closest("audio, video") || el.querySelector?.("audio, video")) return true;
  const MEDIA = /\b(play(er|back)?|pause|track|shuffle|repeat|volume|scrub|seek|now-?playing|transport)\b/i;
  for (let n = el, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) {
    const words = [n.getAttribute("aria-label"), n.getAttribute("data-testid"), n.className && String(n.className), n.id].filter(Boolean).join(" ").replace(/[-_]/g, " ");
    if (MEDIA.test(words)) return true;
  }
  return /[⏮⏭⏯▶⏸⤮↻🔀🔁]/u.test((el.textContent || "").slice(0, 200));
}
const looksButton = el => el.matches("button, [role=button], input[type=button], input[type=submit], summary") || (el.matches("a") && /\b(btn|button)\b/i.test(el.className));
const looksField = el => el.matches("input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=''], [contenteditable=true], [role=textbox]");
function looksText(el) {
  if (el.matches("p, h1, h2, h3, h4, h5, h6, li, blockquote, article, pre, dd, figcaption, label")) return true;
  const t = (el.innerText || "").trim();
  return t.length > 24 && !el.querySelector("button, input, select, textarea, video, img, svg");
}

function suggestionsFor(el) {
  const steps = showOnceChips(); if (steps) return steps; // show-once hook: 64-show-once.js
  if (!el || el === document.body || el === document.documentElement) {
    if (pageIdeas && pageIdeasFor === location.href + getLanguage()) return pageIdeas;
    schedulePageIdeas();
    return genericPageSuggestions(); // first-run hook: the page's own chips replace these
  }
  if (looksMedia(el)) return [sugOf("sleep"), sugOf("speed"), sugOf("biggerControls")];
  if (looksButton(el)) return [sugOf("rename", { fill: true, caret: -1 }), sugOf("biggerButton"), sugOf("hideButton")]; // the request ends in its closing quote: the caret goes inside
  if (looksField(el)) return [sugOf("wordCount"), sugOf("tallerField")];
  if (el.matches("img, picture, video, canvas, svg")) return [sugOf("hide"), sugOf("bigger")];
  if (looksText(el)) return [sugOf("readText"), sugOf("biggerText"), sugOf("hide")];
  return [sugOf("hide"), sugOf("bigger"), sugOf("tidy")];
}

let shownSuggestions = [];
function updateChips() {
  // A picked capture has its own next step (Use it here). The Try row would hide that.
  const show = S.open && S.phase === "idle" && !input.value && !paneKind && !Voice.active() && !GodCapture.picked;
  if (!show) { if (!sugEl.hidden && sugEl.contains(root.activeElement)) input.focus(); sugEl.hidden = true; return; }
  const list = suggestionsFor(S.target);
  if (sugEl.hidden || list !== shownSuggestions) {
    shownSuggestions = list;
    sugEl.innerHTML = `<span class="try" aria-hidden="true">${t("sug.try")}</span>` +
      list.map((s, i) => `<button type="button" class="sug" data-i="${i}" tabindex="${i ? -1 : 0}" title="${esc(s.prompt)}">${esc(s.label)}${s.fill ? `<span class="ell">…</span>` : ""}</button>`).join("");
  }
  sugEl.hidden = false;
}
function useSuggestion(i) {
  const s = shownSuggestions[i];
  if (!s) return;
  if (s.fill) {
    setInput(s.prompt);
    const at = s.prompt.length + (s.caret || 0);
    input.focus();
    input.setSelectionRange(at, at);
    return;
  }
  setInput(s.prompt);
  // Suggestions are starting points. Let the person review or edit before sending.
  input.focus();
}
sugEl.addEventListener("click", e => { const b = e.target.closest(".sug"); if (b) useSuggestion(+b.dataset.i); });
sugEl.addEventListener("mousedown", e => e.preventDefault());
langSubs.add(() => {
  genericSuggestions = null;
  pageIdeas = null;
  pageIdeasFor = "";
  if (S.open) updateChips();
});
sugEl.addEventListener("keydown", e => {
  const items = [...sugEl.querySelectorAll(".sug")];
  const i = items.indexOf(root.activeElement);
  if (i < 0) return;
  let n = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % items.length;
  if (e.key === "ArrowLeft") n = (i - 1 + items.length) % items.length;
  if (e.key === "Home") n = 0;
  if (e.key === "End") n = items.length - 1;
  if (e.key === "ArrowUp") { e.preventDefault(); input.focus(); return; }
  if (n < 0) return;
  e.preventDefault();
  items.forEach((b, k) => (b.tabIndex = k === n ? 0 : -1));
  items[n].focus();
});
