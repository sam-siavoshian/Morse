// The landing page: the nav and the links from config.js, the Morse bar in
// the hero, the before and after cards and the real-apps strip (also from
// config.js), the skies' pixel edges, the story, and the panes in the glass.
import { initPage, esc, appIcon } from "./common.js";
import { SHOWCASE, REAL_APPS } from "./config.js";
import { mountReveals, mountHeroScroll, mountMark, mountDither, mountStory, mountDemo, mountAsker, mountCount, mountLazySkies } from "./motion.js";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- see it change ----------
// One picture slides over the other. The range input underneath does the
// work, so it is a real control: drag, tap, or the arrow keys.
// Cards two to a row, a wide one beside a narrow one, the sides swapping
// each row.
const SPANS = ["span-7", "span-5", "span-5", "span-7"];
function pairHtml(p, i) {
  const img = (src, alt, eager) => `<img src="${esc(src)}" width="${p.width}" height="${p.height}" alt="${esc(alt)}" ${eager ? "" : 'loading="lazy" '}decoding="async">`;
  return `
    <article class="plate pair ${SPANS[i % SPANS.length]}" data-reveal="fade" style="--delay:${(i % 2) * 0.08}s">
      <figure class="shot compare" data-side="both">
        ${img(p.after, `After: ${p.alt.after}`)}
        <div class="compare-before">${img(p.before, `Before: ${p.alt.before}`)}</div>
        <span class="compare-tag is-before" aria-hidden="true">Before</span>
        <span class="compare-tag is-after" aria-hidden="true">After</span>
        <input class="compare-range" type="range" min="0" max="100" value="50" step="1" aria-label="${esc(p.app)}: slide to compare before and after">
        <span class="compare-line" aria-hidden="true"></span>
        <span class="compare-knob" aria-hidden="true"><span class="icon">⟷</span></span>
      </figure>
      <div class="plate-foot">
        <p class="plate-line"><b>${appIcon(p.app, 20)}${esc(p.app)}.</b> ${esc(p.line || p.kind)}</p>
        <p class="plate-by"><span class="sr-only">Asked: ${esc(p.ask)}. </span>${esc(p.by)}</p>
      </div>
    </article>`;
}

function mountPairs(root) {
  if (!root) return;
  root.innerHTML = SHOWCASE.map(pairHtml).join("");
  for (const fig of root.querySelectorAll(".compare")) {
    const range = fig.querySelector(".compare-range");
    const set = v => {
      fig.style.setProperty("--pos", `${v}%`);
      fig.dataset.side = v <= 4 ? "after" : v >= 96 ? "before" : "both";
      range.setAttribute("aria-valuetext", v <= 4 ? "After" : v >= 96 ? "Before" : `${v}% before`);
    };
    range.addEventListener("input", () => set(Number(range.value)));
    set(50);
    // Once, when it first comes into view, the handle sweeps to show it moves.
    if (!reducedMotion()) {
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        let t0 = 0;
        const sweep = now => {
          if (fig.matches(":hover") || document.activeElement === range) return;
          t0 ||= now;
          const k = Math.min(1, (now - t0) / 1400);
          const v = Math.round(50 + 22 * Math.sin(k * Math.PI * 2) * (1 - k));
          range.value = v;
          set(v);
          if (k < 1) requestAnimationFrame(sweep);
        };
        setTimeout(() => requestAnimationFrame(sweep), 300);
      }, { threshold: 0.6 });
      io.observe(fig);
    }
  }
}

// ---------- real apps ----------
function mountApps(root) {
  if (!root) return;
  root.innerHTML = REAL_APPS.map(a => `
    <li>
      <figure class="app-card">
        <div class="shot"><img src="${esc(a.src)}" width="${a.width}" height="${a.height}" alt="${esc(a.alt)}" loading="lazy" decoding="async"></div>
        <figcaption>
          <span class="app-name"><strong>${appIcon(a.app, 22)}${esc(a.app)}</strong><span>${esc(a.kind)}</span></span>
          ${a.ask ? `<span class="sr-only">Asked: ${esc(a.ask)}</span>` : ""}
        </figcaption>
      </figure>
    </li>`).join("");
}

// ---------- the radar's pixels ----------
// A few lit squares on the faint grid behind the headline, each pulsing on its
// own delay, like the mark while a model works. Placed on the grid's pitch.
function mountPixels(root) {
  if (!root) return;
  const pitch = 22;
  const place = () => {
    root.replaceChildren();
    const cols = Math.floor(root.clientWidth / pitch), rows = Math.floor(root.clientHeight / pitch);
    const n = Math.min(60, Math.round(cols * rows / 40));
    // Lit pixels gather in small clusters, like the radar's 4x4 grid.
    for (let c = 0; c < n / 6; c++) {
      const cx = Math.floor(cols * (0.35 + Math.random() * 0.65)), cy = Math.floor(rows * Math.random() * 0.8);
      for (let k = 0; k < 6; k++) {
        const x = cx + Math.floor(Math.random() * 4), y = cy + Math.floor(Math.random() * 4);
        const px = document.createElement("i");
        px.style.left = `${x * pitch}px`;
        px.style.top = `${y * pitch}px`;
        px.style.setProperty("--w", `${(Math.random() * 3).toFixed(2)}s`);
        px.style.setProperty("--d", `${(1.6 + Math.random() * 2).toFixed(2)}s`);
        px.style.setProperty("--peak", (0.35 + Math.random() * 0.55).toFixed(2));
        root.append(px);
      }
    }
  };
  place();
  let w = root.clientWidth;
  addEventListener("resize", () => { if (Math.abs(root.clientWidth - w) > 40) { w = root.clientWidth; place(); } }, { passive: true });
}

initPage();
mountLazySkies();
mountDemo(document.querySelector("[data-demo]"));
mountPairs(document.getElementById("pairs"));
mountApps(document.getElementById("apps-grid"));
for (const el of document.querySelectorAll("[data-pixels]")) mountPixels(el);
for (const el of document.querySelectorAll("[data-dither]")) mountDither(el);
mountStory(document.querySelector("[data-story]"));
mountReveals();
for (const sw of document.querySelectorAll("button.switch")) {
  sw.addEventListener("click", () => sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")));
}
mountAsker(document.querySelector("[data-asker]"));
for (const el of document.querySelectorAll("[data-count]")) mountCount(el);
mountHeroScroll(document.querySelector(".hero"));
mountMark(document.querySelector("[data-mark]"));
// The apps row scrolls sideways on a phone; then it takes keyboard focus, so
// the arrow keys can move it too.
function scrollRows() {
  for (const el of document.querySelectorAll("#apps-grid")) {
    if (el.scrollWidth > el.clientWidth + 1) el.tabIndex = 0; else el.removeAttribute("tabindex");
  }
}
scrollRows();
addEventListener("resize", scrollRows, { passive: true });
