// The radar: OpenCode's 4x4 pixel spinner. Corners are off, the inner four
// pulse bright, the outer eight pulse dim, each pixel on its own random phase.
// Static (live=false) it's the Morse mark; live it means "a model is working".
const RADAR_OUTER = new Set([1, 2, 4, 7, 8, 11, 13, 14]);
const RADAR_CORNER = new Set([0, 3, 12, 15]);

function radar(size = 16, cls = "") {
  let rects = "";
  for (let i = 0; i < 16; i++) {
    if (RADAR_CORNER.has(i)) continue;
    const outer = RADAR_OUTER.has(i);
    const delay = (Math.random() * 1.5).toFixed(2), dur = (1 + Math.random()).toFixed(2);
    rects += `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx="1" class="${outer ? "o" : "c"}" style="animation-delay:${delay}s;animation-duration:${dur}s"/>`;
  }
  return `<svg class="radar ${cls}" viewBox="0 0 15 15" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

// The app's own theme decides ours, so the overlay feels native on both.
function luminance(color) {
  const m = String(color).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (!m || (m[4] !== undefined && +m[4] === 0)) return null;
  return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
}
function pageTheme() {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const l = luminance(getComputedStyle(el).backgroundColor);
    if (l != null) return l > 0.5 ? "light" : "dark";
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
