const hostEl = document.createElement("div");
hostEl.setAttribute("data-morse-ui", "");
// Every declaration is !important so no page rule (`div { display: none !important }`,
// `* { all: unset }`, `dir=rtl`, zoom, filters) can reach the overlay's host.
hostEl.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;direction:ltr;zoom:1;display:block;"
  .replace(/;/g, " !important;");
hostEl.dir = "ltr";
// Debug (an open shadow root and the status attribute, for tests and
// screenshots) only in a browser driven by automation; boot.js decides it
// (navigator.webdriver and localStorage "morse:debug", read in Morse's own world).
const DEBUG = B.debug;
const root = hostEl.attachShadow({ mode: DEBUG ? "open" : "closed" });
// Tokens are custom properties, the one thing that inherits through a shadow
// boundary. Marked !important, ours beat any `--m-*` the page sets on our host.
root.innerHTML = `<style>${TOKENS_CSS.replace(/(--m-[\w-]+\s*:[^;!]+);/g, "$1 !important;")}\n${CSS()}\n${GOD_CSS() /* God mode hook */}\n${ASK_CSS() /* Ask and find hook */}\n${CONTROL_CSS() /* user control hook */}
${A11Y_CSS() /* Easier to use hook: 98-a11y-css.js */}</style>
  <style>${BAR_CSS()}${ONBOARDING_CSS() /* onboarding hook: 98-onboarding-css.js */}</style>
  <style>${GALLERY_CSS() /* gallery hook: 98-gallery-css.js */}</style>
  <style>${HEAL_CSS() /* self-heal hook: 98-heal-css.js */}</style>
  <style>${STYLE_CSS() /* your-style hook: 98-style-css.js */}</style>
  <style>${PACKS_CSS() /* packs hook: 98-packs-css.js */}</style>
  <canvas class="fx"></canvas>
  <div class="hl" hidden><span></span></div>
  <div class="sel" hidden></div>
  <div class="bar" hidden>
    <div class="row">
      <span class="mark">${radar(18)}</span>
      <div class="chip target" hidden><span></span><button class="x" title="Point at something else">×</button></div>
      <textarea class="in" rows="1" placeholder="Describe a change…" spellcheck="false" autocomplete="off"></textarea>
      <button class="go" title="Send (Enter)"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9.5M8.75 4.25 12.5 8l-3.75 3.75"/></svg></button>
    </div>
    <div class="status">
      <span class="hint"></span>
      <span class="ticker"></span>
      <span class="actions"></span>
    </div>
  </div>
  <aside class="panel" hidden></aside>
  <dialog class="modal" hidden></dialog>
  <div class="toast" hidden></div>`;
const $ = s => root.querySelector(s);
const fx = $(".fx"), hl = $(".hl"), selBox = $(".sel"), bar = $(".bar"), input = $(".in");
const chip = $(".chip.target"), hint = $(".hint"), ticker = $(".ticker"), actions = $(".actions");
const panel = $(".panel"), modal = $(".modal"), toastEl = $(".toast"), logo = $(".mark");

function applyTheme() {
  hostEl.dataset.theme = themeOverride() || pageTheme();
  // CSS zoom on <html> would scale the overlay and misplace the highlight boxes.
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  hostEl.style.setProperty("zoom", String(1 / z), "important");
  hostEl.style.setProperty("filter", overlayUnfilter(), "important"); // your-style hook: 72-style.js
}
// The overlay lives in the browser's top layer (a manual popover), above
// anything a page can stack with z-index, so a page can't draw over the bar or
// a review to trick a click. Reviews also open as a modal <dialog> on top of it
// (80-modals.js). TopLayer.raise() puts Morse back on top after the page adds
// something of its own to the top layer (80-modals.js watches for that).
const TopLayer = {
  ok: typeof hostEl.showPopover === "function", // desktop apps on an older Chromium: z-index only
  show() { if (this.ok && hostEl.isConnected && !hostEl.matches(":popover-open")) try { hostEl.showPopover(); } catch {} },
  raise() { if (!this.ok || !hostEl.isConnected) return; try { if (hostEl.matches(":popover-open")) hostEl.hidePopover(); } catch {} this.show(); },
};
if (TopLayer.ok) hostEl.popover = "manual";
// Built on first use, not at page load. boot.js tells us when the page swaps
// out <html> or its children (document.open, innerHTML), so we come back.
function mount() { if (!hostEl.isConnected && live()) document.documentElement?.append(hostEl); TopLayer.show(); }
mount();
applyTheme();
B.domHooks.add(mount);
// The page closed the overlay's popover (it can reach the host element): open it again.
hostEl.addEventListener("toggle", e => { if (e.newState === "closed" && live()) setTimeout(() => TopLayer.show(), 0); });
