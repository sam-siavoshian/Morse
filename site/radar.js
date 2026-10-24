// The radar: Morse's mark and loading indicator (OpenCode's pixel spinner).
// A 4x4 grid of 3x3 rounded squares in a 15x15 viewBox. The four corners are
// off; the outer eight pulse dim (0.15 <-> 0.35), the inner four pulse bright
// (0.4 <-> 1), each on its own random delay and duration.
//
//   import { radar } from "./radar.js";
//   radar(document.querySelector(".logo"), { size: 20 });
//
// Options: size (px, default 16), still (no animation), label (aria-label;
// omit for a decorative mark). Color is currentColor.

const NS = "http://www.w3.org/2000/svg";
const CORNERS = new Set([0, 3, 12, 15]);
const INNER = new Set([5, 6, 9, 10]);

let styled = false;
function injectStyle() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const s = document.createElement("style");
  s.dataset.radar = "";
  s.textContent = `
@keyframes m-radar-in { 0%, 100% { opacity: .4 } 50% { opacity: 1 } }
@keyframes m-radar-out { 0%, 100% { opacity: .15 } 50% { opacity: .35 } }
.m-radar { display: inline-block; flex: none; vertical-align: middle; overflow: visible; }
.m-radar rect { animation: var(--k) var(--d) ease-in-out var(--w) infinite; }
.m-radar rect.in { opacity: .7; --k: m-radar-in; }
.m-radar rect.out { opacity: .25; --k: m-radar-out; }
.m-radar.still rect { animation: none; }
@media (prefers-reduced-motion: reduce) { .m-radar rect { animation: none; } }`;
  document.head.append(s);
}

export function radar(el, { size = 16, still = false, label = "" } = {}) {
  injectStyle();
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 15 15");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("class", "m-radar" + (still ? " still" : ""));
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); }
  else svg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 16; i++) {
    if (CORNERS.has(i)) continue;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", (i % 4) * 4);
    r.setAttribute("y", Math.floor(i / 4) * 4);
    r.setAttribute("width", 3);
    r.setAttribute("height", 3);
    r.setAttribute("rx", 0.75);
    r.setAttribute("class", INNER.has(i) ? "in" : "out");
    r.style.setProperty("--w", (Math.random() * 1.5).toFixed(2) + "s");
    r.style.setProperty("--d", (1 + Math.random()).toFixed(2) + "s");
    svg.append(r);
  }
  if (el) el.append(svg);
  return svg;
}

// Fills every [data-radar] element on the page: <span data-radar="20"></span>
export function mountAll(root = document) {
  for (const el of root.querySelectorAll("[data-radar]")) {
    if (el.querySelector(".m-radar")) continue;
    radar(el, { size: Number(el.dataset.radar) || 16, still: "still" in el.dataset, label: el.dataset.label || "" });
  }
}
