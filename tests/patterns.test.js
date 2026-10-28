// The loading field's pattern catalog and shuffle (core/patterns.js).
// The canvas draws these; this checks the sequence rules: no immediate
// repeat, and every pattern can actually come up.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOAD_PATTERNS, PATTERN_HOLD, PATTERN_BLEND, nextPattern, shapeLift } from "../core/patterns.js";

test("every loading pattern is reachable, and the next one is never the one on screen", () => {
  assert.ok(LOAD_PATTERNS.length >= 5, "more than the single orbit");
  assert.equal(new Set(LOAD_PATTERNS).size, LOAD_PATTERNS.length, "ids are unique");
  assert.ok(LOAD_PATTERNS.includes("orbit"));

  const fromCold = LOAD_PATTERNS.map((_, i) => nextPattern(null, () => (i + 0.01) / LOAD_PATTERNS.length));
  assert.deepEqual(fromCold, LOAD_PATTERNS, "a fresh load can land on any pattern");
  assert.equal(nextPattern("nope", () => 0), LOAD_PATTERNS[0], "an unknown current is a fresh load");

  for (const cur of LOAD_PATTERNS) {
    const rest = LOAD_PATTERNS.filter(id => id !== cur);
    const got = rest.map((_, i) => nextPattern(cur, () => (i + 0.01) / rest.length));
    assert.deepEqual(got, rest, `${cur}: every other pattern is reachable`);
    assert.equal(nextPattern(cur, () => 0), rest[0]);
    assert.equal(nextPattern(cur, () => 0.999999), rest.at(-1));
    assert.notEqual(nextPattern(cur, () => 0), cur);
  }

  let cur = "orbit";
  for (let i = 0; i < 24; i++) {
    const n = nextPattern(cur, () => ((i * 3) % 7) / 7);
    assert.notEqual(n, cur, "no immediate repeat");
    assert.ok(LOAD_PATTERNS.includes(n));
    cur = n;
  }
});

// A wide, short target, like the release-notes card the field covers.
function raster(name, time, cols = 96, rows = 32) {
  const lit = [];
  const cx = cols / 2, cy = rows / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy, th = Math.atan2(dy, dx);
      const v = shapeLift(name, x, y, Math.hypot(dx, dy), Math.hypot(x + 0.5 - cx, y + 0.5 - cy), Math.hypot(Math.cos(th) * cx, Math.sin(th) * cy), th, time, cols, rows);
      if (v >= 0.35) lit.push(x, y);
    }
  }
  return lit;
}

test("each figure is a shape that moves, not a flat line of marks", () => {
  const shapes = LOAD_PATTERNS.filter(id => id !== "orbit");
  assert.ok(shapes.length >= 6);
  for (const name of shapes) {
    const a = raster(name, 0.2);
    const b = raster(name, 0.55);
    assert.ok(a.length > 80, `${name} lights a figure (${a.length} cells)`);
    assert.ok(a.length < 96 * 32 * 0.72, `${name} is a figure, not the whole field (${a.length})`);
    let minY = 99, maxY = 0;
    for (let i = 1; i < a.length; i += 2) { minY = Math.min(minY, a[i]); maxY = Math.max(maxY, a[i]); }
    assert.ok(maxY - minY >= 6, `${name} has height (${maxY - minY} rows), not a Morse line`);
    const seen = new Set();
    for (let i = 0; i < a.length; i += 2) seen.add(a[i] * 1000 + a[i + 1]);
    let moved = 0;
    for (let i = 0; i < b.length; i += 2) if (!seen.has(b[i] * 1000 + b[i + 1])) moved++;
    assert.ok(moved > 25, `${name} moves (${moved} cells)`);
  }
  assert.equal(shapeLift("orbit", 10, 10, 0.2, 4, 20, 0, 0.4, 40, 20), -1, "orbit stays with the effect");
  assert.equal(shapeLift("line", 10, 10, 0.2, 4, 20, 0, 0.4, 40, 20), -1, "the Morse line is gone");
});

test("a pattern holds long enough to read, and the handover is only a short blend", () => {
  assert.ok(PATTERN_HOLD >= 2.5, "not a flicker");
  assert.ok(PATTERN_BLEND >= 0.3 && PATTERN_BLEND <= 0.8);
  assert.ok(PATTERN_BLEND < PATTERN_HOLD / 4, "the blend is the handover, not the pattern");
});
