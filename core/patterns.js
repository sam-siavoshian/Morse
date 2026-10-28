// Which bright structure the loading field draws (runtime/src/90-effect.js).
// The dim radar pixels stay; this is only the Morse-dot figure on top of them.
// `next` never repeats the pattern that is already on screen, so a long load
// reads as a sequence rather than the same orbit flickering in place.
//
//   orbit   the original ping: a ring sweeping out from a bright core
//   line    a horizontal line of Morse (the word "morse") scrolling past
//   eight   a figure-eight of Morse beads, with a brighter head
//   ring    a dashed circle that breathes in place
//   sweep   a diagonal band of Morse traveling corner to corner
//   dash    one short dash-and-dot crossing a diagonal
//   double  two tilted orbits, beads running in opposite directions
//   beat    a Morse baseline with a lub-dub of dots

export const LOAD_PATTERNS = ["orbit", "line", "eight", "ring", "sweep", "dash", "double", "beat"];

// Seconds one pattern stays fully itself, and how long the two overlap.
// The hold is a couple of orbit cycles; the blend is only the handover.
export const PATTERN_HOLD = 3.4;
export const PATTERN_BLEND = 0.55;

// `random` returns a number in [0, 1), as Math.random does. An unknown current
// (the first time the field appears) may be any pattern.
export function nextPattern(current, random = Math.random) {
  const skip = typeof current === "string" && LOAD_PATTERNS.includes(current);
  const pool = skip ? LOAD_PATTERNS.filter(id => id !== current) : LOAD_PATTERNS;
  let r = +random();
  if (!(r >= 0 && r < 1)) r = 0;
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}
