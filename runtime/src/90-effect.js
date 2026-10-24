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

const Effect = (() => {
  const g = fx.getContext("2d");
  const CELL = 8, SQ = 6;
  let target = null, running = false, mode = "thinking", rect = null, cols = 0, rows = 0, cells = [];
  let t0 = 0, end0 = 0, endResolve = null, ok = true, frame = 0, pal = null, blips = [];
  // prefers-reduced-motion: a calm, static field (no pulse, ping, scan or
  // blips) that simply fades out when the change lands.
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  function palette() {
    const cs = getComputedStyle(hostEl);
    const v = n => cs.getPropertyValue(n).trim() || "#888";
    return { lo: v("--m-signal-1"), mid: v("--m-signal-2"), hi: v("--m-signal-3"), top: v("--m-signal-4"), scrim: v("--m-overlay") };
  }
  function layout() {
    const r = target && target.isConnected ? target.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const pad = target ? 6 : 0;
    const nr = { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), w: Math.min(innerWidth, r.width + pad * 2), h: Math.min(innerHeight, r.height + pad * 2) };
    if (rect && Math.abs(nr.w - rect.w) < 1 && Math.abs(nr.h - rect.h) < 1 && Math.abs(nr.x - rect.x) < 1 && Math.abs(nr.y - rect.y) < 1) return;
    rect = nr;
    const dpr = devicePixelRatio || 1;
    fx.width = Math.ceil(rect.w * dpr); fx.height = Math.ceil(rect.h * dpr);
    Object.assign(fx.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px", display: "block" });
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const nc = Math.ceil(rect.w / CELL), nrw = Math.ceil(rect.h / CELL);
    if (nc !== cols || nrw !== rows) {
      cols = nc; rows = nrw;
      cells = Array.from({ length: cols * rows }, (_, i) => ({
        delay: Math.random() * 1.5, dur: 1 + Math.random(), lit: 0,
        band: !target && isBand(i),
      }));
    }
  }
  function isBand(i) {
    const x = i % cols, y = Math.floor(i / cols), b = 2;
    return x < b || y < b || x >= cols - b || y >= rows - b;
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
    return new Promise(r => (endResolve = r));
  }
  const PING = 1.6; // seconds between rings
  const ringRadius = now => ((((now - t0) / 1000) % PING) / PING) * Math.SQRT2;
  function wave(c, t) {
    // OpenCode-style pulse: opacity oscillates between lo and hi on a per-pixel phase.
    const p = (Math.sin(((t + c.delay) / c.dur) * Math.PI * 2) + 1) / 2;
    return p;
  }
  function draw(now) {
    if (!running) return;
    frame++;
    if (frame % 6 === 0) layout();
    const still = calm.matches, t = still ? 0 : (now - t0) / 1000;
    g.clearRect(0, 0, rect.w, rect.h);
    const endP = mode === "end" ? Math.min(1, (now - end0) / 650) : 0;
    // Radar geometry in coordinates normalized to the target's shape, so the
    // rings follow the target's shape on wide toolbars and tall sidebars.
    const cx = cols / 2, cy = rows / 2, maxR = Math.SQRT2;
    const tol = 1.1 / Math.max(2, Math.min(cx, cy));
    if (target) {
      g.globalAlpha = mode === "end" ? 1 - endP : 1;
      g.fillStyle = pal.scrim;
      roundRect(g, 0, 0, rect.w, rect.h, 10); g.fill();
    }
    const ping = ringRadius(now);
    // Morse blips light cells; collect them per frame.
    const lit = new Map();
    blips = blips.filter(b => now - b.born < 750);
    for (const b of blips) {
      const life = 1 - (now - b.born) / 750;
      let x = b.x;
      for (const s of b.code) {
        const n = s === "-" ? 3 : 1;
        for (let k = 0; k < n; k++) lit.set(b.y * cols + x + k, Math.max(lit.get(b.y * cols + x + k) || 0, life));
        x += n + 1;
      }
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!target && !c.band) continue;
      const x = i % cols, y = (i / cols) | 0;
      const dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy, dist = Math.hypot(dx, dy);
      let a, color = pal.lo;
      if (mode === "end") {
        const front = endP * (maxR + 0.2);
        if (!still && dist < front - tol * 2) continue; // cleared
        if (dist < front) { a = 1; color = pal.top; } // the ring
        else a = 0.25 * (1 - endP);
        if (!ok || still) { a = 0.25 * (1 - endP); color = pal.lo; }
      } else {
        a = 0.1 + wave(c, t) * 0.14;                // dim field, every pixel alive
        if (target) {
          // Measure in cells so the ring is one pixel thick on any shape.
          const cdx = x + 0.5 - cx, cdy = y + 0.5 - cy, rCell = Math.hypot(cdx, cdy);
          const th = Math.atan2(dy, dx), ellR = ping * Math.hypot(Math.cos(th) * cx, Math.sin(th) * cy);
          // the spinner's inner four, scaled up: a small bright pulsing core
          const core = Math.max(1.6, Math.min(cx, cy) * 0.55);
          if (rCell < core) { a = 0.3 + wave(c, t) * 0.5; color = rCell < core * 0.6 ? pal.hi : pal.mid; }
          // the radar ping: a thin ring sweeping outward, fading with distance
          const ring = Math.abs(rCell - ellR);
          if (still) { /* no ping */ }
          else if (ring < 0.75) { a = Math.max(a, 0.6 * (1 - ping / maxR) + 0.15); color = pal.hi; }
          else if (ring < 2.2 && rCell < ellR) { a += 0.1 * (1 - ping / maxR); }
        } else {
          // page-wide: a scan travels the perimeter
          const per = 2 * (cols + rows), pos = (t * 40) % per;
          const p = y < 2 ? x : x >= cols - 2 ? cols + y : y >= rows - 2 ? cols + rows + (cols - x) : 2 * cols + rows + (rows - y);
          const d = (pos - p + per) % per;
          if (d < 14 && !still) { a += (1 - d / 14) * 0.6; color = pal.hi; }
        }
        const l = lit.get(i);
        if (l) { a = Math.max(a, 0.35 + l * 0.65); color = l > 0.5 ? pal.top : pal.hi; }
      }
      g.globalAlpha = Math.max(0, Math.min(1, a));
      g.fillStyle = color;
      roundRect(g, x * CELL + 1, y * CELL + 1, SQ, SQ, 1.5); g.fill();
    }
    g.globalAlpha = 1;
    if (mode === "end" && endP >= 1) {
      running = false;
      fx.style.display = "none";
      logo.classList.remove("live");
      if (target && ok) pulse(target);
      endResolve?.();
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
