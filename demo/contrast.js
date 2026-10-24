// WCAG contrast for every text/background token pair the overlay uses, in
// both themes, plus a check that runtime/src/99-css.js only uses token colors.
//   node demo/contrast.js          (exit code 1 on any failure)
//   node demo/contrast.js --json
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const tokens = readFileSync(new URL("design/tokens.css", ROOT), "utf8");

// ---- parse the dark (default) block and the explicit light block
function block(re) {
  const m = tokens.match(re);
  if (!m) throw new Error("token block not found: " + re);
  return Object.fromEntries([...m[1].matchAll(/(--m-[\w-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()]));
}
const dark = block(/:root, :host \{([\s\S]*?)\n\}/);
const light = { ...dark, ...block(/:root\[data-theme="light"\][^{]*\{([\s\S]*?)\n\s*\}/) };

const hex = s => { s = s.replace("#", ""); if (s.length === 3) s = [...s].map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)).concat(1); };
function color(v, T) {
  v = v.trim();
  if (v.startsWith("var(")) return color(T[v.slice(4, -1).trim()], T);
  if (v.startsWith("#")) return hex(v);
  const m = v.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error("can't parse color " + v);
}
const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bot[i] * (1 - a)).concat(1); };
const lum = c => { const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// The bar is translucent (--m-overlay) over the host app. The runtime picks
// the dark theme when the page background has luminance <= 0.5 and the light
// theme above it (its luminance is a plain weighted mean of the sRGB channels),
// so the worst case is a page right at that threshold, #7f7f7f / #808080. Check
// over the theme's own bg, pure black/white, and the threshold gray; report the worst.
const PAGES = { dark: ["--m-bg", "#000000", "#7f7f7f"], light: ["--m-bg", "#ffffff", "#808080"] };

// [what, text token, background token, min ratio]. 4.5 = body text, 3 = large
// text or non-text UI (focus rings, control borders that carry meaning).
const PAIRS = [
  ["bar: input text", "--m-text", "--m-overlay", 4.5],
  ["bar: placeholder", "--m-text-3", "--m-overlay", 4.5],
  ["bar: disabled input (working)", "--m-text-2", "--m-overlay", 4.5],
  ["bar: status hint", "--m-text-2", "--m-overlay", 4.5],
  ["bar: ticker, model label, timings", "--m-text-3", "--m-overlay", 4.5],
  ["bar: fixing / error detail", "--m-warn", "--m-overlay", 4.5],
  ["bar: chip label", "--m-text", "--m-raised", 4.5],
  ["bar: chip ×", "--m-text-3", "--m-raised", 4.5],
  ["kbd", "--m-text-2", "--m-raised", 4.5],
  ["buttons", "--m-text", "--m-overlay", 4.5],
  ["buttons (hover)", "--m-text", "--m-hover", 4.5],
  ["primary button", "--m-primary-text", "--m-primary", 4.5],
  ["primary button (hover)", "--m-primary-text", "--m-primary-hover", 4.5],
  ["picker label", "--m-text-inverse", "--m-signal-4", 4.5],
  ["panel: title, text", "--m-text", "--m-surface", 4.5],
  ["panel: prompt, tags, empty state", "--m-text-2", "--m-surface", 4.5],
  ["panel: host, footer, row buttons", "--m-text-3", "--m-surface", 4.5],
  ["panel: row hover prompt", "--m-text-2", "--m-raised", 4.5],
  ["panel: row hover buttons", "--m-text-3", "--m-raised", 4.5],
  ["panel: row button hover", "--m-text", "--m-hover", 4.5],
  ["modal: title", "--m-text", "--m-surface", 4.5],
  ["modal: subtitle", "--m-text-2", "--m-surface", 4.5],
  ["modal: field labels", "--m-text-3", "--m-surface", 4.5],
  ["modal: code", "--m-text", "--m-bg", 4.5],
  ["modal: share link", "--m-text-2", "--m-bg", 4.5],
  ["toast", "--m-text", "--m-surface", 4.5],
  ["focus ring vs surface (non-text)", "--m-signal-3", "--m-surface", 3],
  ["focus ring vs overlay (non-text)", "--m-signal-3", "--m-overlay", 3],
  ["switch on: track vs surface (non-text)", "--m-primary", "--m-surface", 3],
  ["switch off: knob vs track (non-text)", "--m-text-2", "--m-line-strong", 3],
  ["picker outline vs page (non-text)", "--m-signal-4", "--m-bg", 3],
];

function check(theme, T) {
  const rows = [];
  for (const [what, fgT, bgT, min] of PAIRS) {
    let worst = Infinity;
    for (const page of PAGES[theme]) {
      const base = color(page.startsWith("--") ? `var(${page})` : page, T);
      const bg = over(color(`var(${bgT})`, T), base);
      const fg = over(color(`var(${fgT})`, T), bg);
      worst = Math.min(worst, ratio(fg, bg));
    }
    rows.push({ theme, what, fg: fgT, bg: bgT, ratio: +worst.toFixed(2), min, pass: worst >= min });
  }
  return rows;
}
const rows = [...check("dark", dark), ...check("light", light)];

// ---- every color literal in the overlay CSS must be a token
const css = readFileSync(new URL("runtime/src/99-css.js", ROOT), "utf8");
const literals = [];
css.split("\n").forEach((line, i) => {
  const clean = line.replace(/mask-image:[^;]+;/g, "").replace(/\/\*.*?\*\//g, "");
  for (const m of clean.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|red|gray|grey)\b(?![-\w])/gi)) literals.push({ line: i + 1, literal: m[0] });
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rows, literals }, null, 1));
} else {
  for (const theme of ["dark", "light"]) {
    console.log(`\n${theme}`);
    for (const r of rows.filter(r => r.theme === theme))
      console.log(`  ${r.pass ? "✓" : "✗"} ${r.ratio.toFixed(2).padStart(5)} ≥ ${r.min}  ${r.what.padEnd(40)} ${r.fg} on ${r.bg}`);
  }
  console.log(literals.length ? `\n✗ non-token colors in 99-css.js:\n${literals.map(l => `  line ${l.line}: ${l.literal}`).join("\n")}` : "\n✓ 99-css.js uses token colors only");
}
const failed = rows.filter(r => !r.pass).length + literals.length;
if (!process.argv.includes("--json")) console.log(`\n${rows.length} pairs × worst-case host page · ${rows.filter(r => !r.pass).length} below WCAG AA · ${literals.length} non-token colors`);
process.exitCode = failed ? 1 : 0;
