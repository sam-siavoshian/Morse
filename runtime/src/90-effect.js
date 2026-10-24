// The "it's working" moment, in gray. The target becomes a field of radar
// pixels: every pixel pulses on its own phase (the OpenCode spinner, scaled
// up), a ping ring sweeps out from a bright core, and each character the model writes
// arrives as a blip of real Morse code (dot = 1 pixel, dash = 3). When the
// change lands, a ping ring expands from the center and clears the field.
const MORSE_CODE = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--",
  n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
};

// Frame budget: ~2ms on a 4K target. Per-cell geometry is computed once per
// layout, the number of drawn cells is capped (a huge target gets bigger
// pixels, not 130,000 of them), and a frame is one pass that sorts cells into
// color x alpha buckets, then one fill per bucket: a few dozen draw calls
// instead of one per cell. The rAF loop only runs while the effect is on
// screen, and a hidden tab ends it at once.
const Effect = (() => {
  const g = fx.getContext("2d");
  const BASE = 8, GAP = 2, MAX_CELLS = 6000, MAX_PX = 2.1e6, LEVELS = 16, BAND = 2;
  let CELL = BASE, SQ = BASE - GAP, RAD = 1.5;
  let target = null, running = false, mode = "thinking", rect = null, cols = 0, rows = 0;
  let t0 = 0, end0 = 0, endResolve = null, ok = true, frame = 0, pal = null, blips = [];
  // Per-cell constants, rebuilt when the grid changes, and the cells drawn at
  // all (every cell over a target; only the edge band page-wide).
  let delay, dur, rc, ell, dist, core, per, active = new Int32Array(0);
  const buckets = Array.from({ length: 4 * LEVELS }, () => []);
  const COLORS = ["lo", "mid", "hi", "top"];
  // prefers-reduced-motion: a calm, static field (no pulse, ping, scan or
  // blips) that simply fades out when the change lands.
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  function palette() {
    const cs = getComputedStyle(hostEl);
    const v = n => cs.getPropertyValue(n).trim() || "#888";
    return { lo: v("--m-signal-1"), mid: v("--m-signal-2"), hi: v("--m-signal-3"), top: v("--m-signal-4"), scrim: v("--m-overlay") };
  }
  function drawnCells(w, h, cell) {
    const c = Math.ceil(w / cell), r = Math.ceil(h / cell);
    return target ? c * r : Math.min(c * r, 2 * BAND * (c + r));
  }
  function layout() {
    const r = target && target.isConnected ? target.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const pad = target ? 6 : 0;
    const nr = { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), w: Math.min(innerWidth, r.width + pad * 2), h: Math.min(innerHeight, r.height + pad * 2) };
    if (rect && Math.abs(nr.w - rect.w) < 1 && Math.abs(nr.h - rect.h) < 1 && Math.abs(nr.x - rect.x) < 1 && Math.abs(nr.y - rect.y) < 1) return;
    rect = nr;
    // Past ~2M pixels the canvas renders at 1/k resolution and is scaled back up
    // pixel-exact: blocks stay crisp and a 4K frame rasterizes a quarter of it.
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.ceil(Math.sqrt((rect.w * dpr * rect.h * dpr) / MAX_PX)));
    const scale = dpr / k;
    fx.width = Math.ceil(rect.w * scale); fx.height = Math.ceil(rect.h * scale);
    Object.assign(fx.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px", display: "block", imageRendering: k > 1 ? "pixelated" : "" });
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const n = drawnCells(rect.w, rect.h, BASE);
    const cell = n > MAX_CELLS ? Math.ceil(BASE * Math.sqrt(n / MAX_CELLS)) : BASE;
    const nc = Math.ceil(rect.w / cell), nrw = Math.ceil(rect.h / cell);
    if (nc !== cols || nrw !== rows || cell !== CELL) {
      CELL = cell; SQ = cell - GAP * cell / BASE; RAD = 1.5 * cell / BASE;
      cols = nc; rows = nrw;
      grid();
    }
  }
  function grid() {
    const N = cols * rows, cx = cols / 2, cy = rows / 2;
    delay = new Float32Array(N); dur = new Float32Array(N); rc = new Float32Array(N); ell = new Float32Array(N);
    dist = new Float32Array(N); core = new Uint8Array(N); per = new Int32Array(N);
    const coreR = Math.max(1.6, Math.min(cx, cy) * 0.55);
    const on = [];
    for (let i = 0; i < N; i++) {
      const x = i % cols, y = (i / cols) | 0;
      delay[i] = Math.random() * 1.5; dur[i] = 1 + Math.random();
      // Radar geometry in coordinates normalized to the target's shape, so the
      // rings follow the target's shape on wide toolbars and tall sidebars.
      const dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy, th = Math.atan2(dy, dx);
      dist[i] = Math.hypot(dx, dy);
      rc[i] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); // in cells, so the ring is one pixel thick on any shape
      ell[i] = Math.hypot(Math.cos(th) * cx, Math.sin(th) * cy);
      core[i] = rc[i] < coreR * 0.6 ? 2 : rc[i] < coreR ? 1 : 0;
      const band = x < BAND || y < BAND || x >= cols - BAND || y >= rows - BAND;
      per[i] = y < BAND ? x : x >= cols - BAND ? cols + y : y >= rows - BAND ? cols + rows + (cols - x) : 2 * cols + rows + (rows - y);
      if (target || band) on.push(i);
    }
    active = Int32Array.from(on);
  }
  function start(el) {
    target = el; rect = null; cols = rows = 0; mode = "thinking"; running = true; ok = true; blips = [];
    pal = palette();
    t0 = performance.now();
    logo.classList.add("live");
    layout();
    requestAnimationFrame(draw);
  }
  // Each token becomes a Morse blip on the current ring (or along the edge band).
  function token(text) {
    if (!running) return;
    mode = "streaming";
    if (calm.matches) return;
    // one blip per token, a handful on screen at once: signal, not noise
    const ch = [...text.toLowerCase()].find(c => MORSE_CODE[c]);
    if (ch && blips.length < 10) {
      const code = MORSE_CODE[ch];
      const len = [...code].reduce((n, s) => n + (s === "-" ? 3 : 1) + 1, -1);
      let x, y;
      if (target) {
        // blips appear where the current ping ring is passing
        const ang = Math.random() * Math.PI * 2, rr = Math.max(0.15, ringRadius(performance.now()) * 0.7);
        x = Math.round(cols / 2 + Math.cos(ang) * (cols / 2) * rr - len / 2);
        y = Math.round(rows / 2 + Math.sin(ang) * (rows / 2) * rr);
      } else {
        // edges: alternate top and bottom bands
        const top = Math.random() < 0.5;
        x = Math.floor(Math.random() * Math.max(1, cols - len));
        y = top ? 0 : rows - 2;
      }
      blips.push({ x: Math.max(0, Math.min(cols - len, x)), y: Math.max(0, Math.min(rows - 1, y)), code, born: performance.now() });
    }
  }
  function finish(success) {
    ok = success;
    mode = "end";
    end0 = performance.now();
    const done = new Promise(r => (endResolve = r));
    if (!running || document.hidden) stop(); // no frames are coming: don't hold the result back
    return done;
  }
  function stop() {
    running = false;
    fx.style.display = "none";
    logo.classList.remove("live");
    endResolve?.();
    endResolve = null;
  }
  const PING = 1.6; // seconds between rings
  const ringRadius = now => ((((now - t0) / 1000) % PING) / PING) * Math.SQRT2;
  const TAU = Math.PI * 2;
  function draw(now) {
    if (!running) return;
    frame++;
    if (frame % 6 === 0) layout();
    const still = calm.matches, t = still ? 0 : (now - t0) / 1000;
    g.clearRect(0, 0, rect.w, rect.h);
    const end = mode === "end", endP = end ? Math.min(1, (now - end0) / 650) : 0;
    const maxR = Math.SQRT2, tol = 1.1 / Math.max(2, Math.min(cols / 2, rows / 2));
    if (target) {
      g.globalAlpha = end ? 1 - endP : 1;
      g.fillStyle = pal.scrim;
      g.beginPath(); g.roundRect ? g.roundRect(0, 0, rect.w, rect.h, 10) : g.rect(0, 0, rect.w, rect.h); g.fill();
    }
    const ping = ringRadius(now), pingFade = 1 - ping / maxR;
    // Morse blips light cells; collect them per frame.
    let lit = null;
    blips = blips.filter(b => now - b.born < 750);
    if (blips.length) {
      lit = new Map();
      for (const b of blips) {
        const life = 1 - (now - b.born) / 750;
        let x = b.x;
        for (const s of b.code) {
          const n = s === "-" ? 3 : 1;
          for (let k = 0; k < n; k++) { const j = b.y * cols + x + k; lit.set(j, Math.max(lit.get(j) || 0, life)); }
          x += n + 1;
        }
      }
    }
    for (const b of buckets) b.length = 0;
    const front = endP * (maxR + 0.2), perim = 2 * (cols + rows), pos = (t * 40) % perim;
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      let a, color = 0; // 0 lo, 1 mid, 2 hi, 3 top
      if (end) {
        if (!still && dist[i] < front - tol * 2) continue; // cleared
        if (dist[i] < front) { a = 1; color = 3; } // the ring
        else a = 0.25 * (1 - endP);
        if (!ok || still) { a = 0.25 * (1 - endP); color = 0; }
      } else {
        // OpenCode-style pulse: every pixel alive on its own phase
        const w = (Math.sin(((t + delay[i]) / dur[i]) * TAU) + 1) / 2; // t is 0 when still: a fixed pattern
        a = 0.1 + w * 0.14;
        if (target) {
          // the spinner's inner four, scaled up: a small bright pulsing core
          if (core[i]) { a = 0.3 + w * 0.5; color = core[i] === 2 ? 2 : 1; }
          // the radar ping: a thin ring sweeping outward, fading with distance
          if (!still) {
            const ellR = ping * ell[i], ring = Math.abs(rc[i] - ellR);
            if (ring < 0.75) { a = Math.max(a, 0.6 * pingFade + 0.15); color = 2; }
            else if (ring < 2.2 && rc[i] < ellR) a += 0.1 * pingFade;
          }
        } else if (!still) {
          // page-wide: a scan travels the perimeter
          const d = (pos - per[i] + perim) % perim;
          if (d < 14) { a += (1 - d / 14) * 0.6; color = 2; }
        }
        const l = lit && lit.get(i);
        if (l) { a = Math.max(a, 0.35 + l * 0.65); color = l > 0.5 ? 3 : 2; }
      }
      const q = a >= 1 ? LEVELS - 1 : Math.round(a * (LEVELS - 1));
      if (q > 0) buckets[color * LEVELS + q].push(i);
    }
    // One path and one fill per color and alpha level.
    for (let b = 0; b < buckets.length; b++) {
      const list = buckets[b];
      if (!list.length) continue;
      g.globalAlpha = (b % LEVELS) / (LEVELS - 1);
      g.fillStyle = pal[COLORS[(b / LEVELS) | 0]];
      g.beginPath();
      for (const i of list) {
        const x = (i % cols) * CELL + 1, y = ((i / cols) | 0) * CELL + 1;
        g.roundRect ? g.roundRect(x, y, SQ, SQ, RAD) : g.rect(x, y, SQ, SQ);
      }
      g.fill();
    }
    g.globalAlpha = 1;
    if (end && endP >= 1) {
      stop();
      if (target && ok) pulse(target);
      return;
    }
    requestAnimationFrame(draw);
  }
  function pulse(el) {
    const r = el.getBoundingClientRect();
    const p = document.createElement("div");
    p.className = "pulse";
    Object.assign(p.style, { left: r.left - 4 + "px", top: r.top - 4 + "px", width: r.width + 8 + "px", height: r.height + 8 + "px" });
    root.append(p);
    setTimeout(() => p.remove(), 900);
  }
  return { start, token, finish };
})();
