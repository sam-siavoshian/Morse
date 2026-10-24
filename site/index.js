// The landing page: the nav, the links and the film from config.js, the
// before and after pairs and the real-apps strip (also from config.js), the
// three steps, and the radar's pixels behind the headline.
import { initPage, esc, appIcon } from "./common.js";
import { SHOWCASE, REAL_APPS } from "./config.js";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- see it change ----------
// One picture slides over the other. The range input underneath does the
// work, so it is a real control: drag, tap, or the arrow keys.
function pairHtml(p, i) {
  const n = String(i + 1).padStart(2, "0");
  const total = String(SHOWCASE.length).padStart(2, "0");
  const img = (src, alt, eager) => `<img src="${esc(src)}" width="${p.width}" height="${p.height}" alt="${esc(alt)}" ${eager ? "" : 'loading="lazy" '}decoding="async">`;
  return `
    <article class="pair">
      <div class="pair-text">
        <p class="pair-n">${n} / ${total}</p>
        <h3 class="pair-app">${appIcon(p.app, 28)}${esc(p.app)}</h3>
        <p class="pair-kind">${esc(p.kind)}</p>
        <p class="pair-ask"><span class="sr-only">Asked: </span>${esc(p.ask)}</p>
        <p class="pair-by">${esc(p.by)}</p>
        ${p.note ? `<p class="pair-note">${esc(p.note)}</p>` : ""}
      </div>
      <figure class="shot compare" data-side="both">
        ${img(p.after, `After: ${p.alt.after}`)}
        <div class="compare-before">${img(p.before, `Before: ${p.alt.before}`)}</div>
        <span class="compare-tag is-before" aria-hidden="true">Before</span>
        <span class="compare-tag is-after" aria-hidden="true">After</span>
        <input class="compare-range" type="range" min="0" max="100" value="50" step="1" aria-label="${esc(p.app)}: slide to compare before and after">
        <span class="compare-line" aria-hidden="true"></span>
        <span class="compare-knob" aria-hidden="true"><span class="icon">⟷</span></span>
      </figure>
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
          ${a.ask ? `<q class="app-ask">${esc(a.ask)}</q>` : ""}
          ${a.by ? `<span class="app-by">${esc(a.by)}</span>` : ""}
        </figcaption>
      </figure>
    </li>`).join("");
}

// ---------- how it works ----------
// Each step shows its picture. On its own it moves to the next step every few
// seconds while on screen, until someone picks a step.
function mountSteps(root) {
  if (!root) return;
  const steps = [...root.querySelectorAll(".step")];
  const shots = [...root.querySelectorAll(".steps-shots img")];
  let at = 0, timer = 0, visible = false, chosen = false;
  const show = i => {
    at = i;
    steps.forEach((s, j) => { s.classList.toggle("is-on", j === i); s.querySelector(".step-btn").setAttribute("aria-pressed", String(j === i)); });
    shots.forEach((s, j) => s.classList.toggle("is-on", j === i));
  };
  const tick = () => {
    clearTimeout(timer);
    if (chosen || !visible || reducedMotion()) return;
    timer = setTimeout(() => { show((at + 1) % steps.length); tick(); }, 3600);
  };
  root.addEventListener("click", e => {
    const b = e.target.closest(".step-btn");
    if (!b) return;
    chosen = true;
    clearTimeout(timer);
    show(Number(b.dataset.step));
  });
  // The pictures are lazy; load all three once the steps are near, so a
  // switch never shows an empty frame.
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) for (const s of shots) s.loading = "eager";
    tick();
  }, { rootMargin: "100px 0px" }).observe(root);
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
mountPairs(document.getElementById("pairs"));
mountApps(document.getElementById("apps-grid"));
mountSteps(document.querySelector("[data-steps]"));
for (const el of document.querySelectorAll("[data-pixels]")) mountPixels(el);
