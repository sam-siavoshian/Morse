const hostEl = document.createElement("div");
hostEl.setAttribute("data-morse-ui", "");
// Every declaration is !important so no page rule (`div { display: none !important }`,
// `* { all: unset }`, `dir=rtl`, zoom, filters) can reach the overlay's host.
hostEl.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;direction:ltr;zoom:1;display:block;"
  .replace(/;/g, " !important;");
hostEl.dir = "ltr";
let DEBUG = false;
try { DEBUG = !!localStorage.getItem("morse:debug"); } catch {}
const root = hostEl.attachShadow({ mode: DEBUG ? "open" : "closed" });
// Tokens are custom properties, the one thing that inherits through a shadow
// boundary. Marked !important, ours beat any `--m-*` the page sets on our host.
root.innerHTML = `<style>${TOKENS_CSS.replace(/(--m-[\w-]+\s*:[^;!]+);/g, "$1 !important;")}\n${CSS()}\n${GOD_CSS() /* God mode hook */}</style>
  <style>${BAR_CSS()}${ONBOARDING_CSS() /* onboarding hook: 98-onboarding-css.js */}</style>
  <canvas class="fx"></canvas>
  <div class="hl" hidden><span></span></div>
  <div class="sel" hidden></div>
  <div class="bar" hidden>
    <div class="row">
      <span class="mark">${radar(18)}</span>
      <div class="chip target" hidden><span></span><button class="x" title="Point at something else">×</button></div>
      <textarea class="in" rows="1" placeholder="Describe a change…" spellcheck="false" autocomplete="off"></textarea>
      <button class="go" title="Send (Enter)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg></button>
    </div>
    <div class="status">
      <span class="hint"></span>
      <span class="ticker"></span>
      <span class="actions"></span>
    </div>
  </div>
  <aside class="panel" hidden></aside>
  <div class="modal" hidden></div>
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
}
function mount() { if (!hostEl.isConnected) document.documentElement.append(hostEl); }
mount();
applyTheme();
new MutationObserver(mount).observe(document.documentElement, { childList: true });
