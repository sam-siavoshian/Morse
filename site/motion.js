// Motion on the landing page: parts marked data-reveal rise into view once,
// while scrolling the headline drifts up and fades as the film settles into
// place, and the footer's wordmark lights up under the pointer. Nothing moves
// with reduced motion; the CSS rests at the end.
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Parts already on screen show at once, so the first screen never blinks.
export function mountReveals(root = document) {
  if (reducedMotion() || !("IntersectionObserver" in globalThis)) return;
  const show = el => el.setAttribute("data-shown", "");
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      show(e.target);
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });
  for (const el of root.querySelectorAll("[data-reveal]:not([data-shown])")) {
    if (el.getBoundingClientRect().top < innerHeight * 0.88) show(el);
    else io.observe(el);
  }
  document.documentElement.setAttribute("data-reveals", "");
}

// --intro on the hero: 0 at the top of the page, 1 once the headline is
// scrolled past. --rise on the film: 0 while it waits below the fold, 1 once
// it is well on screen. Both ease toward the scroll position, and the loop
// stops when they arrive.
export function mountHeroScroll(hero, film) {
  if (!hero || reducedMotion()) return;
  const clamp = v => Math.min(1, Math.max(0, v));
  const pageTop = el => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };
  const goal = { intro: 0, rise: 1 }, now = { intro: 0, rise: 1 };
  let frame = 0, last = 0;
  const paint = () => {
    hero.style.setProperty("--intro", now.intro.toFixed(4));
    film?.style.setProperty("--rise", now.rise.toFixed(4));
  };
  const tick = t => {
    const k = 1 - Math.exp(-Math.min(0.1, (t - last) / 1000) * 9);
    last = t;
    now.intro += (goal.intro - now.intro) * k;
    now.rise += (goal.rise - now.rise) * k;
    const settled = Math.abs(goal.intro - now.intro) < 0.001 && Math.abs(goal.rise - now.rise) < 0.001;
    if (settled) Object.assign(now, goal);
    paint();
    frame = settled ? 0 : requestAnimationFrame(tick);
  };
  const read = () => {
    goal.intro = clamp(scrollY / (innerHeight * 0.7));
    // The film's own transform moves it, so measure from its layout box.
    if (film) goal.rise = clamp((innerHeight - (pageTop(film) - scrollY)) / (innerHeight * 0.75));
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
  };
  read();
  Object.assign(now, goal);
  paint();
  addEventListener("scroll", read, { passive: true });
  addEventListener("resize", read, { passive: true });
}

// The edge of a sky, coming apart into the page: a grid of squares in the
// page's colour, none at the sky's side and whole at the page's, each a
// little bigger or smaller than its row by a fixed noise so the line is ragged.
// data-dither="down" thickens downward, "up" upward. Not motion, so it is
// drawn with reduced motion too.
export function mountDither(canvas) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  const up = canvas.dataset.dither === "up";
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0b";
  const cell = 5;
  const noise = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const draw = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color;
    for (let row = 0, y = 0; y < h; row++, y += cell) {
      const t = (y + cell / 2) / h;
      const depth = up ? 1 - t : t;
      for (let col = 0, x = 0; x < w; col++, x += cell) {
        const s = depth > 0.92 ? 1 : Math.min(1, Math.max(0, depth * 1.15 - 0.1 + (noise(col, row) - 0.5) * 0.22));
        if (s < 0.08) continue;
        const size = s > 0.94 ? cell : cell * s;
        ctx.fillRect(x + (cell - size) / 2, y + (cell - size) / 2, size, size);
      }
    }
  };
  new ResizeObserver(draw).observe(canvas);
  document.documentElement.setAttribute("data-dithered", "");
}

// The story: the band holds still while the scroll runs through its track,
// and each third of the run shows one step (data-current on the step and its
// dot). With reduced motion it stays three plates.
export function mountStory(section) {
  if (!section || reducedMotion()) return;
  const track = section.querySelector(".story-track");
  const steps = [...section.querySelectorAll(".story-steps > li")];
  const dots = [...section.querySelectorAll(".story-dots span")];
  if (!track || !steps.length) return;
  for (const li of steps) li.removeAttribute("data-reveal");
  section.style.setProperty("--steps", steps.length);
  section.setAttribute("data-pinned", "");
  let current = -1;
  const read = () => {
    const box = track.getBoundingClientRect();
    const run = Math.max(1, box.height - innerHeight);
    const p = Math.min(1, Math.max(0, -box.top / run));
    const step = Math.min(steps.length - 1, Math.floor(p * steps.length));
    if (step === current) return;
    current = step;
    steps.forEach((li, i) => li.toggleAttribute("data-current", i === step));
    dots.forEach((d, i) => d.toggleAttribute("data-current", i === step));
  };
  read();
  addEventListener("scroll", read, { passive: true });
  addEventListener("resize", read, { passive: true });
}

// A soft light follows the pointer a little behind it over the footer, and
// finds the edges of the wordmark's letters where it is (--x and --y on the
// mark). Without a fine pointer it rests in the middle.
export function mountMark(mark) {
  if (!mark || reducedMotion() || !matchMedia("(pointer: fine)").matches) return;
  const zone = mark.closest("footer") || mark;
  const aim = { x: 0, y: 0 }, now = { x: NaN, y: 0 };
  let frame = 0;
  const step = () => {
    now.x += (aim.x - now.x) * 0.16;
    now.y += (aim.y - now.y) * 0.16;
    mark.style.setProperty("--x", `${now.x.toFixed(1)}px`);
    mark.style.setProperty("--y", `${now.y.toFixed(1)}px`);
    frame = Math.abs(aim.x - now.x) + Math.abs(aim.y - now.y) > 0.5 ? requestAnimationFrame(step) : 0;
  };
  zone.addEventListener("pointermove", e => {
    const box = mark.getBoundingClientRect();
    aim.x = e.clientX - box.left;
    aim.y = e.clientY - box.top;
    if (Number.isNaN(now.x)) { now.x = box.width / 2; now.y = box.height * 0.45; }
    if (!frame) frame = requestAnimationFrame(step);
  }, { passive: true });
}
