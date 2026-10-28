// Which figure the loading field draws (runtime/src/90-effect.js).
// The dim radar pixels stay. On top of them, a bright shape actually moves:
// a sweep rotates, rings expand, arms spin, comets orbit, a wave travels.
// `next` never repeats the figure already on screen, so a long load plays
// through them instead of flickering one in place.
//
//   orbit    the original ping: a ring sweeping out from a bright core
//   radar    a wedge rotating around the center, bright at its leading edge
//   ripple   three rings expanding outward and fading
//   spinner  three arms turning, with a bead running out along each one
//   comet    two heads on one circle, opposite each other, each leaving a tail
//   wave     a sine ribbon traveling across the target
//   spiral   a spiral turning, with a head running out along it
//   bars     columns rising and falling as a wave

export const LOAD_PATTERNS = ["orbit", "radar", "ripple", "spinner", "comet", "wave", "spiral", "bars"];

// Seconds one figure stays fully itself, and how long the two overlap.
// The hold is long enough to see the motion complete; the blend is only the handover.
export const PATTERN_HOLD = 3.4;
export const PATTERN_BLEND = 0.55;

const TAU = Math.PI * 2;
const wrap = a => {
  a %= TAU;
  return a < 0 ? a + TAU : a;
};

// -1: this cell is not part of the figure (keep the dim field).
// 0..1: how bright it is. Orbit is drawn by the effect, so it returns -1 here.
// `dist` is 1 at the target's edge, `rc` and `ell` are in cells, `eang` is the
// angle of the cell in that same ellipse.
export function shapeLift(name, x, y, dist, rc, ell, eang, time, cols, rows) {
  if (name === "radar") return radar(dist, eang, time);
  if (name === "ripple") return ripple(dist, ell, time);
  if (name === "spinner") return spinner(x, y, rc, time, cols, rows);
  if (name === "comet") return comet(x, y, time, cols, rows);
  if (name === "wave") return wave(x, y, time, cols, rows);
  if (name === "spiral") return spiral(x, y, dist, ell, eang, time, cols, rows);
  if (name === "bars") return bars(x, y, time, cols, rows);
  return -1;
}

// A sector of the target, turning. The leading edge is the bright part.
function radar(dist, eang, time) {
  if (dist > 1) return -1;
  if (dist < 0.075) return 0.96;
  const behind = wrap(time * (TAU / 2.15) - eang);
  const ARC = 1.35;
  if (behind > ARC) return -1;
  const edge = 1 - behind / ARC;
  return (behind < 0.16 ? 1 : 0.2 + 0.8 * edge * edge) * (0.78 + 0.22 * (1 - dist));
}

// Solid rings, not dashes. Each one grows from the center and fades.
function ripple(dist, ell, time) {
  if (dist > 1.02) return -1;
  const thick = 2.4 / Math.max(ell, 8);
  let best = -1;
  for (let k = 0; k < 3; k++) {
    const p = ((time / 1.65) + k / 3) % 1;
    const gap = Math.abs(dist - (0.06 + p * 0.96));
    if (gap > thick) continue;
    const v = (0.5 + 0.5 * (1 - gap / thick)) * (1 - p * 0.82);
    if (v > 0.32 && v > best) best = v;
  }
  return best;
}

// Three arms in the center of the target, turning as a unit.
function spinner(x, y, rc, time, cols, rows) {
  const reach = Math.min(cols, rows) * 0.44;
  if (rc > reach) return -1;
  if (rc < Math.max(2.2, reach * 0.12)) return 0.96;
  const arm = TAU / 3;
  let m = wrap(Math.atan2(y + 0.5 - rows / 2, x + 0.5 - cols / 2) - time * (TAU / 1.3));
  m %= arm;
  if (m > arm / 2) m = arm - m;
  const arc = m * Math.max(rc, 1);
  if (arc > 2.3) return -1;
  const body = 0.4 + 0.48 * (1 - arc / 2.3);
  const along = rc / reach;
  let delta = along - ((time * 0.75) % 1);
  if (delta < 0) delta += 1;
  return delta < 0.1 ? 1 : body;
}

// Two heads on a round orbit in the middle of the target, always opposite
// each other. Each leaves a tail, so the circle they travel is visible.
function comet(x, y, time, cols, rows) {
  const px = x + 0.5 - cols / 2, py = y + 0.5 - rows / 2;
  const reach = Math.max(4, Math.min(cols, rows) * 0.4);
  const rx = reach, ry = reach * 0.72;
  const cellA = Math.atan2(py / ry, px / rx);
  const on = Math.abs(Math.hypot(px / rx, py / ry) - 1) * ry;
  let best = -1;
  for (let k = 0; k < 2; k++) {
    // Same direction, opposite sides, so the two heads never pile into one blob.
    const a = time * (TAU / 2.4) + k * Math.PI;
    const hd = Math.hypot(px - Math.cos(a) * rx, py - Math.sin(a) * ry);
    if (hd < 3.6) best = Math.max(best, 0.62 + 0.38 * (1 - hd / 3.6));
    if (on > 2.2) continue;
    const behind = wrap(a - cellA);
    if (behind > 1.7) continue;
    const v = (1 - behind / 1.7) * (1 - on / 2.2) * 0.85;
    if (v > 0.3 && v > best) best = v;
  }
  return best;
}

// A ribbon across the whole target. A bright head runs along it.
function wave(x, y, time, cols, rows) {
  const u = (x + 0.5) / Math.max(1, cols);
  const crest = rows * (0.5 + Math.sin(u * TAU * 1.5 - time * 2.7) * 0.34);
  const d = Math.abs(y + 0.5 - crest);
  if (d > 4.2) return -1;
  const body = 0.4 + 0.55 * (1 - d / 4.2);
  const head = (time * 0.32) % 1;
  const du = Math.abs(u - head);
  if (Math.min(du, 1 - du) < 0.04) return 1;
  return body;
}

// An elliptical spiral that turns. The head is the bright cell running outward.
function spiral(x, y, dist, ell, eang, time, cols, rows) {
  if (dist > 0.95) return -1;
  const turns = 2.1;
  const b = 0.9 / (turns * TAU);
  const a = eang < 0 ? eang + TAU : eang;
  const phi = time * 1.55;
  const k0 = Math.round((dist / b - a - phi) / TAU);
  let miss = 1e9;
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const theta = a + phi + TAU * k;
    if (theta < 0.2 || theta > turns * TAU) continue;
    const delta = Math.abs(dist - b * theta) * Math.max(ell, 1);
    if (delta < miss) miss = delta;
  }
  let v = miss < 2.9 ? 0.36 + 0.5 * (1 - miss / 2.9) : -1;
  const s = (time * 0.4) % 1;
  const th = Math.max(0.25, s * turns * TAU);
  const hr = b * th, ha = th - phi;
  const hd = Math.hypot(x + 0.5 - (cols / 2 + Math.cos(ha) * hr * (cols / 2)), y + 0.5 - (rows / 2 + Math.sin(ha) * hr * (rows / 2)));
  if (hd < 4) v = Math.max(v, 0.7 + 0.3 * (1 - hd / 4));
  return v;
}

// Columns across the target, their heights a traveling wave.
function bars(x, y, time, cols, rows) {
  const pitch = 5;
  if ((x % pitch) >= 3) return -1;
  const n = Math.max(1, Math.ceil(cols / pitch));
  const h = 0.22 + 0.78 * (0.5 + 0.5 * Math.sin((Math.floor(x / pitch) / n) * TAU * 2.2 - time * 3.1));
  const half = h * rows * 0.38;
  const dy = Math.abs(y - (rows - 1) / 2);
  if (dy > half) return -1;
  return half > 1.6 && dy > half - 1.6 ? 0.98 : 0.52;
}

// `random` returns a number in [0, 1), as Math.random does. An unknown current
// (the first time the field appears) may be any pattern.
export function nextPattern(current, random = Math.random) {
  const skip = typeof current === "string" && LOAD_PATTERNS.includes(current);
  const pool = skip ? LOAD_PATTERNS.filter(id => id !== current) : LOAD_PATTERNS;
  let r = +random();
  if (!(r >= 0 && r < 1)) r = 0;
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}
