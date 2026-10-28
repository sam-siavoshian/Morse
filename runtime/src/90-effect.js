// The "it's working" moment, in gray. The target becomes a field of radar
// pixels: every pixel pulses on its own phase (the OpenCode spinner, scaled
// up). The bright figure on that field shuffles through moving shapes
// (core/patterns.js): the original orbit, a rotating radar wedge, expanding
// rings, a three-arm spinner, orbiting comets, a traveling wave, a turning
// spiral, rising bars. Each character the model writes arrives as a blip of
// real Morse code (dot = 1 pixel, dash = 3). When the change lands, a ping
// ring expands from the center and clears the field. prefers-reduced-motion
// keeps the still field: no shuffle, no pulse, no ping.
const MORSE_CODE = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--",
  n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
};

// Frame budget: ~2ms on a 4K target. Per-cell geometry is computed once per
// layout, the number of drawn cells is capped (a huge target gets bigger
// pixels, not 130,000 of them), and a frame is one pass that sorts cells into
// color x alpha buckets, then one fill of plain rects per bucket plus one
// pattern fill that rounds every corner: a few dozen draw calls instead of
// one per cell. The rAF loop only runs while the effect is on screen, and a
// hidden tab ends it at once.
const Effect = (() => {
  const g = fx.getContext("2d");
  const BASE = 8, GAP = 2, MAX_CELLS = 6000, MAX_PX = 2.1e6, LEVELS = 16, BAND = 2;
  let CELL = BASE, SQ = BASE - GAP, OFF = GAP / 2, RAD = 1.5, mask = null, maskKey = "";
  let target = null, running = false, mode = "thinking", rect = null, cols = 0, rows = 0;
  let t0 = 0, end0 = 0, endResolve = null, ok = true, frame = 0, pal = null, blips = [], shown0 = 0;
  // Per-cell constants, rebuilt when the grid changes, and the cells drawn at
  // all (every cell over a target; only the edge band page-wide).
  let delay, dur, rc, ell, dist, core, per, eang, active = new Int32Array(0);
  const buckets = Array.from({ length: 4 * LEVELS }, () => []);
  const COLORS = ["lo", "mid", "hi", "top"];
  // prefers-reduced-motion: a calm, static field (no pulse, ping, scan,
  // pattern shuffle or blips) that simply fades out when the change lands.
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  // The pattern on screen, the one it is blending out of, and when this one started.
  // `pin` (debug only) holds one figure still so a single shape can be looked at.
  let motif = "", motifPrev = "", motifAt = 0, pin = "";
  let pingR = 0, pingF = 1;
  const hit = { a: 0, c: 0 };

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
    // Snapped to whole canvas pixels, so the corner mask below tiles exactly.
    const cell = Math.max(2, Math.round((n > MAX_CELLS ? BASE * Math.sqrt(n / MAX_CELLS) : BASE) * scale)) / scale;
    const nc = Math.ceil(rect.w / cell), nrw = Math.ceil(rect.h / cell);
    if (nc !== cols || nrw !== rows || cell !== CELL) {
      CELL = cell; SQ = cell - GAP * cell / BASE; OFF = GAP / 2 * cell / BASE; RAD = 1.5 * cell / BASE;
      cols = nc; rows = nrw;
      grid();
    }
    cornerMask(scale);
  }
  // Rounded pixels without rounded paths: cells are drawn as plain rects (a
  // fraction of the cost), then one fill of a one-cell pattern cuts every
  // cell's corners at once.
  function cornerMask(scale) {
    const px = Math.round(CELL * scale), key = `${px}:${scale}`;
    if (key === maskKey) return;
    maskKey = key; mask = null;
    if (RAD * scale < 0.75) return; // too small to see
    const tile = document.createElement("canvas");
    tile.width = tile.height = px;
    const c = tile.getContext("2d");
    if (!c || !c.roundRect) return;
    c.scale(scale, scale);
    c.beginPath(); c.rect(OFF, OFF, SQ, SQ); c.roundRect(OFF, OFF, SQ, SQ, RAD); c.fill("evenodd");
    mask = g.createPattern(tile, "repeat");
    mask.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, 0, 0]));
  }
  function grid() {
    const N = cols * rows, cx = cols / 2, cy = rows / 2;
    delay = new Float32Array(N); dur = new Float32Array(N); rc = new Float32Array(N); ell = new Float32Array(N);
    dist = new Float32Array(N); core = new Uint8Array(N); per = new Int32Array(N); eang = new Float32Array(N);
    const coreR = Math.max(1.6, Math.min(cx, cy) * 0.55);
    const on = [];
    for (let i = 0; i < N; i++) {
      const x = i % cols, y = (i / cols) | 0;
      delay[i] = Math.random() * 1.5; dur[i] = 1 + Math.random();
      // Radar geometry in coordinates normalized to the target's shape, so the
      // rings follow the target's shape on wide toolbars and tall sidebars.
      const dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy, th = Math.atan2(dy, dx);
      dist[i] = Math.hypot(dx, dy);
      eang[i] = th;
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
    target = el; rect = null; cols = rows = 0; mode = "thinking"; running = true; ok = true; blips = []; shown0 = 0;
    pal = palette();
    t0 = performance.now();
    readPin();
    armMotif(t0, true);
    layout();
    requestAnimationFrame(draw);
  }
  // A fresh load picks any pattern except the one the previous load ended on.
  // A shuffle while this load stays up blends out of the one on screen.
  // ?motif=radar (debug only) holds that one figure, so a shape can be looked at on its own.
  function readPin() {
    pin = "";
    if (!DEBUG) return;
    try {
      const q = new URLSearchParams(location.search).get("motif");
      if (LOAD_PATTERNS.includes(q)) pin = q;
    } catch {}
  }
  function armMotif(now, fresh) {
    const prev = motif;
    motif = pin || nextPattern(prev || null);
    motifPrev = pin || fresh ? "" : prev; // a pin, or a fresh load, has nothing to blend out of
    motifAt = now;
    if (DEBUG && fx.dataset.motif !== motif) fx.dataset.motif = motif;
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
  // speed: the first part of the change is on the page. The cover over the
  // target fades and the field dims, so you watch the change come in.
  function reveal() {
    if (running && mode !== "end" && !shown0) shown0 = performance.now();
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
  // Orbit keeps the original ping, so a steady orbit frame matches the field
  // from before the other figures existed. Anything else is a moving shape.
  function motifOf(name, i, pulse, time) {
    const x = i % cols, y = (i / cols) | 0;
    hit.a = 0.1 + pulse * 0.14; hit.c = 0;
    if (name === "orbit") {
      if (core[i]) { hit.a = 0.3 + pulse * 0.5; hit.c = core[i] === 2 ? 2 : 1; }
      const ellR = pingR * ell[i], ring = Math.abs(rc[i] - ellR);
      if (ring < 0.75) { hit.a = Math.max(hit.a, 0.6 * pingF + 0.15); hit.c = 2; }
      else if (ring < 2.2 && rc[i] < ellR) hit.a += 0.1 * pingF;
      return;
    }
    const v = shapeLift(name, x, y, dist[i], rc[i], ell[i], eang[i], time, cols, rows);
    if (v < 0) return;
    hit.a = v; hit.c = v >= 0.8 ? 3 : v >= 0.2 ? 2 : 0;
  }
  function draw(now) {
    if (!running) return;
    frame++;
    if (frame % 6 === 0) layout();
    const still = calm.matches, t = still ? 0 : (now - t0) / 1000;
    g.clearRect(0, 0, rect.w, rect.h);
    const end = mode === "end", endP = end ? Math.min(1, (now - end0) / 650) : 0;
    const maxR = Math.SQRT2, tol = 1.1 / Math.max(2, Math.min(cols / 2, rows / 2));
    const ping = ringRadius(now), pingFade = 1 - ping / maxR;
    pingR = ping; pingF = pingFade;
    // Shuffle only while a target is covered and motion is allowed. A fresh
    // pattern blends in; reduced motion never leaves the still field.
    // A pinned figure (debug) stays put so it can be looked at on its own.
    let nameA = motif, nameB = motif, blendB = 0;
    if (target && !still && !end && !pin) {
      if ((now - motifAt) / 1000 >= PATTERN_HOLD) armMotif(now, false);
      if (motifPrev) {
        const u = (now - motifAt) / 1000;
        if (u < PATTERN_BLEND) {
          const k = u / PATTERN_BLEND;
          blendB = k * k * (3 - 2 * k);
          nameA = motifPrev; nameB = motif;
        }
      }
    }
    const veil = shown0 ? Math.max(0, 1 - (now - shown0) / 300) : 1; // 1 = covered, 0 = the change shows through (reveal)
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
        if (target && !still) {
          motifOf(nameA, i, w, t);
          a = hit.a; color = hit.c;
          if (blendB > 0) {
            const a0 = a, c0 = color;
            motifOf(nameB, i, w, t);
            a = a0 * (1 - blendB) + hit.a * blendB;
            color = hit.a * blendB > a0 * (1 - blendB) ? hit.c : c0;
          }
        } else {
          a = 0.1 + w * 0.14;
          if (target) {
            // reduced motion: the still core, no ping and no shuffle
            if (core[i]) { a = 0.3 + w * 0.5; color = core[i] === 2 ? 2 : 1; }
          } else if (!still) {
            // page-wide: a scan travels the perimeter
            const d = (pos - per[i] + perim) % perim;
            if (d < 14) { a += (1 - d / 14) * 0.6; color = 2; }
          }
        }
        const l = lit && lit.get(i);
        if (l) { a = Math.max(a, 0.35 + l * 0.65); color = l > 0.5 ? 3 : 2; }
      }
      if (!end) a *= 0.35 + 0.65 * veil;
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
      for (const i of list) g.rect((i % cols) * CELL + OFF, ((i / cols) | 0) * CELL + OFF, SQ, SQ);
      g.fill();
    }
    g.globalAlpha = 1;
    if (mask) {
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = mask;
      if (target) g.fillRect(0, 0, rect.w, rect.h);
      else {
        const bw = BAND * CELL;
        g.fillRect(0, 0, rect.w, bw); g.fillRect(0, (rows - BAND) * CELL, rect.w, bw);
        g.fillRect(0, 0, bw, rect.h); g.fillRect((cols - BAND) * CELL, 0, bw, rect.h);
      }
    }
    if (target && veil > 0) {
      // the scrim goes behind the cells
      g.globalCompositeOperation = "destination-over";
      g.globalAlpha = (end ? 1 - endP : 1) * veil;
      g.fillStyle = pal.scrim;
      g.beginPath(); g.roundRect ? g.roundRect(0, 0, rect.w, rect.h, 10) : g.rect(0, 0, rect.w, rect.h); g.fill();
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
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
  return { start, token, reveal, finish };
})();
