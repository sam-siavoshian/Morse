// The loading field's pattern catalog and shuffle (core/patterns.js).
// The canvas draws these; this checks the sequence rules: no immediate
// repeat, and every pattern can actually come up.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOAD_PATTERNS, PATTERN_HOLD, PATTERN_BLEND, nextPattern } from "../core/patterns.js";

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

test("a pattern holds long enough to read, and the handover is only a short blend", () => {
  assert.ok(PATTERN_HOLD >= 2.5, "not a flicker");
  assert.ok(PATTERN_BLEND >= 0.3 && PATTERN_BLEND <= 0.8);
  assert.ok(PATTERN_BLEND < PATTERN_HOLD / 4, "the blend is the handover, not the pattern");
});
