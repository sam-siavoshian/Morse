const hostEl = document.createElement("div");
hostEl.setAttribute("data-morse-ui", "");
hostEl.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
let DEBUG = false;
try { DEBUG = !!localStorage.getItem("morse:debug"); } catch {}
const root = hostEl.attachShadow({ mode: DEBUG ? "open" : "closed" });
root.innerHTML = `<style>${TOKENS_CSS}\n${CSS()}</style>
  <canvas class="fx"></canvas>
  <div class="hl" hidden><span></span></div>
  <div class="sel" hidden></div>
  <div class="bar" hidden>
    <div class="row">
      <span class="mark">${radar(18)}</span>
      <div class="chip target" hidden><span></span><button class="x" title="Clear target">×</button></div>
      <input class="in" placeholder="Describe a change…" spellcheck="false" autocomplete="off">
      <button class="go" title="Run (Enter)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg></button>
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

function applyTheme() { hostEl.dataset.theme = pageTheme(); }
function mount() { if (!hostEl.isConnected) document.documentElement.append(hostEl); }
mount();
applyTheme();
new MutationObserver(mount).observe(document.documentElement, { childList: true });
