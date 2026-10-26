// Motion on the landing page: parts marked data-reveal rise into view once,
// while scrolling the headline drifts up and fades, the Morse bar in the hero
// plays a real run, the panes under it type, step and count, and the
// footer's wordmark lights up under the pointer. Nothing moves with reduced
// motion; the HTML and CSS rest at the end.
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
// scrolled past. It eases toward the scroll position, and the loop stops
// when it arrives.
export function mountHeroScroll(hero) {
  if (!hero || reducedMotion()) return;
  let goal = 0, now = 0, frame = 0, last = 0;
  const paint = () => hero.style.setProperty("--intro", now.toFixed(4));
  const tick = t => {
    const k = 1 - Math.exp(-Math.min(0.1, (t - last) / 1000) * 9);
    last = t;
    now += (goal - now) * k;
    const settled = Math.abs(goal - now) < 0.001;
    if (settled) now = goal;
    paint();
    frame = settled ? 0 : requestAnimationFrame(tick);
  };
  const read = () => {
    goal = Math.min(1, Math.max(0, scrollY / (innerHeight * 0.7)));
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
  };
  read();
  now = goal;
  paint();
  addEventListener("scroll", read, { passive: true });
  addEventListener("resize", read, { passive: true });
}

// A clock for loops that run only while their part is on screen and the tab
// is in front: wait(ms) resolves after that much visible time.
function onScreenClock(el) {
  let visible = false;
  const waiters = new Set();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); }, { threshold: 0.25 });
  io.observe(el);
  document.addEventListener("visibilitychange", () => wake());
  const running = () => visible && !document.hidden;
  function wake() { for (const w of waiters) w(); }
  const wait = ms => new Promise(done => {
    let left = ms, from = running() ? performance.now() : 0, timer = 0;
    const check = () => {
      clearTimeout(timer);
      if (from) { left -= performance.now() - from; from = 0; }
      if (left <= 0) { waiters.delete(check); done(); return; }
      if (running()) { from = performance.now(); timer = setTimeout(check, left); }
    };
    waiters.add(check);
    check();
  });
  return { wait };
}

// Types text into el a letter at a time.
async function type(el, text, clock, perChar = 26) {
  for (let i = 1; i <= text.length; i++) {
    el.textContent = text.slice(0, i);
    await clock.wait(text[i - 1] === " " ? perChar * 0.6 : perChar);
  }
}

// Presses a key cap in and lets it out.
async function press(el, clock, hold = 160) {
  el?.classList.add("is-down");
  await clock.wait(hold);
  el?.classList.remove("is-down");
}

// The keys a person presses to open Morse here: ⌥ Space on a Mac, Ctrl Shift
// Space elsewhere (core/hotkeys.js).
export function openKeys(nav = globalThis.navigator) {
  const p = `${nav?.userAgentData?.platform || ""} ${nav?.platform || ""} ${nav?.userAgent || ""}`;
  return /mac|iphone|ipad/i.test(p) || !/win|linux|cros|android/i.test(p) ? ["⌥", "Space"] : ["Ctrl", "Shift", "Space"];
}

// The hero's run, from docs/showcase (vscode-windows-95): the shortcut goes
// down, the bar opens, the request types in, the change arrives while Morse
// writes it, then Save and Undo. Save goes in, the bar closes, and after a
// rest it starts again. data-state on the figure is the step (site.css).
export function mountDemo(figure) {
  if (!figure) return;
  const caps = figure.querySelector("[data-keys]");
  const keys = openKeys();
  if (caps && keys.length === 3) caps.replaceChildren(...keys.map(k => Object.assign(document.createElement("kbd"), { textContent: k })));
  if (reducedMotion()) return;
  // Clipped away at the start, a lazy picture would wait for the wipe.
  const after = figure.querySelector(".demo-after");
  if (after) after.loading = "eager";
  const typed = figure.querySelector("[data-typed]");
  const clockEl = figure.querySelector("[data-clock]");
  const steps = [...figure.querySelectorAll(".mbar-steps li")];
  const send = figure.querySelector(".mbar-send");
  const save = figure.querySelector("[data-save]");
  const request = typed.textContent;
  const total = Number.parseFloat(clockEl.textContent) || 31.4;
  const clock = onScreenClock(figure);
  const state = s => figure.setAttribute("data-state", s);
  const step = n => steps.forEach((li, i) => { li.classList.toggle("is-done", i < n); li.classList.toggle("is-now", i === n); });
  const reset = () => { state("keys"); step(1); typed.textContent = ""; clockEl.textContent = "0.0s"; };
  reset();
  (async () => {
    for (;;) {
      await clock.wait(900);
      const down = [...caps.querySelectorAll("kbd")];
      for (const k of down) { k.classList.add("is-down"); await clock.wait(90); }
      await clock.wait(220);
      for (const k of down) k.classList.remove("is-down");
      state("ask");
      await clock.wait(900);
      state("typing");
      await type(typed, request, clock);
      await clock.wait(500);
      await press(send, clock);
      state("work");
      const started = performance.now();
      for (let t = 0; t < 1; ) {
        t = Math.min(1, (performance.now() - started) / 3200);
        clockEl.textContent = `${(total * t).toFixed(1)}s`;
        await clock.wait(100);
      }
      step(2);
      state("done");
      await clock.wait(3600);
      await press(save, clock, 220);
      state("closed");
      await clock.wait(1800);
      state("reset");
      await clock.wait(800);
      reset();
    }
  })();
}

// The asker: the lit row walks down the real requests, each typed into the
// bar above it, and its ↵ goes in. The palette: the lit row steps down the
// results. A highlight slides between the rows.
function slider(list) {
  const hl = document.createElement("span");
  hl.className = "ask-hl";
  hl.setAttribute("aria-hidden", "true");
  list.prepend(hl);
  return li => {
    hl.style.height = `${li.offsetHeight}px`;
    hl.style.transform = `translateY(${li.offsetTop}px)`;
  };
}

export function mountAsker(pane) {
  if (!pane || reducedMotion()) return;
  const rows = [...pane.querySelectorAll(".ask-list li")];
  const text = pane.querySelector("[data-typed]");
  const list = pane.querySelector(".ask-list");
  const clock = onScreenClock(pane);
  const move = slider(list);
  let at = 0;
  const light = i => { rows.forEach((li, k) => li.classList.toggle("is-on", k === i)); move(rows[i]); };
  light(0);
  addEventListener("resize", () => move(rows[at]), { passive: true });
  (async () => {
    for (;;) {
      await clock.wait(1600);
      await press(rows[at].querySelector("kbd"), clock, 180);
      await clock.wait(700);
      at = (at + 1) % rows.length;
      light(at);
      text.textContent = "";
      await clock.wait(250);
      await type(text, rows[at].querySelector("span").textContent, clock, 34);
    }
  })();
}

export function mountPalette(pane) {
  if (!pane || reducedMotion()) return;
  const rows = [...pane.querySelectorAll("li")];
  const clock = onScreenClock(pane);
  const move = slider(pane.querySelector("ul"));
  let at = 0;
  const light = i => { rows.forEach((li, k) => li.classList.toggle("is-on", k === i)); move(rows[i]); };
  light(0);
  addEventListener("resize", () => move(rows[at]), { passive: true });
  (async () => {
    for (;;) {
      await clock.wait(at === rows.length - 1 ? 2200 : 1100);
      at = (at + 1) % rows.length;
      light(at);
    }
  })();
}

// A number that counts up from zero the first time it comes into view.
export function mountCount(el) {
  if (!el || reducedMotion() || !("IntersectionObserver" in globalThis)) return;
  const end = Number(el.dataset.count);
  el.textContent = "0";
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    let t0 = 0;
    const tick = t => {
      t0 ||= t;
      const k = Math.min(1, (t - t0 - 400) / 900);
      el.textContent = String(Math.round(end * Math.max(0, 1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.6 });
  io.observe(el);
}

// The night sky is only on the lower part of the page: its picture loads
// once its part is within a screen or so (data-near; site.css holds it back
// until then).
export function mountLazySkies(root = document) {
  const parts = root.querySelectorAll(".sky-night, .sky-cta, .scene-night");
  const near = el => el.setAttribute("data-near", "");
  if (!("IntersectionObserver" in globalThis)) { parts.forEach(near); return; }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { near(e.target); io.unobserve(e.target); }
  }, { rootMargin: "1200px 0px" });
  for (const el of parts) io.observe(el);
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
