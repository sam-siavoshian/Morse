// Motion on the landing page: parts marked data-reveal rise into view once,
// and while scrolling the headline drifts up and fades as the film settles
// into place. Nothing moves with reduced motion; the CSS rests at the end.
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
