// Assembles the unpacked extension into dist/extension: the service worker
// bundled with core/ and the Anthropic SDK (esbuild), the extension's own
// files, the design tokens, the injected runtime, an options page, and icons.
//
//   node scripts/build.js                  dist/extension, for tests and Load unpacked
//   MORSE_STORE=1 node scripts/build.js    the Chrome Web Store build: leaves out
//                                          what only tests use (STORE_ONLY below)
//   node scripts/build.js --out <dir>      build somewhere else (npm run store
//                                          uses dist/store/extension)

import { promises as fs } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleRuntime, bundleBoot, bundleUI } from "../runtime/bundle.js";

// fileURLToPath, not URL.pathname: that gives /C:/… on Windows and %20 for spaces.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(root, "dist", "extension");
const STORE = process.env.MORSE_STORE === "1";

let esbuild;
try { esbuild = await import("esbuild"); } catch {
  console.error("esbuild is missing: run `npm install` first.");
  process.exit(1);
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "icons"), { recursive: true });

// The worker's own modules import ../core and are only ever bundled into
// background.js; copied raw they'd be dead files with broken imports.
const BUNDLED_ONLY = ["background.js", "bar-host.js", "onboarding-host.js", "control-host.js", "gallery-host.js", "style-host.js" /* your-style hook */, "pack-host.js" /* packs hook */];
for (const f of await fs.readdir(path.join(root, "extension"))) {
  if (!BUNDLED_ONLY.includes(f)) await fs.copyFile(path.join(root, "extension", f), path.join(out, f));
}
// Store builds drop what only tests use. Each entry has to match exactly once,
// so a reworded line fails the build instead of shipping by accident.
//   host.js: the local copy of the share page (http://127.0.0.1:8787), which
//   tests use to ask for an install the way the real share page does
const STORE_ONLY = [["host.js", /, "http:\/\/127\.0\.0\.1:8787" \/\* test-only \*\//g, ""]];
if (STORE) {
  for (const [file, re, to] of STORE_ONLY) {
    const f = path.join(out, file);
    const src = await fs.readFile(f, "utf8");
    const hits = src.match(re)?.length || 0;
    if (hits !== 1) { console.error(`MORSE_STORE=1: expected ${re} once in ${file}, found it ${hits} times.`); process.exit(1); }
    await fs.writeFile(f, src.replace(re, to));
  }
}
// One version for everything: package.json's. extension/manifest.json has none of its own.
const { version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(root, "extension", "manifest.json"), "utf8"));
await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify({ manifest_version: manifest.manifest_version, name: manifest.name, version, ...manifest }, null, 2) + "\n");
await esbuild.build({
  entryPoints: [path.join(root, "extension", "background.js")],
  outfile: path.join(out, "background.js"),
  bundle: true, format: "esm", platform: "browser", target: "chrome135",
  // core/transcribe.js lazily imports node: modules for local whisper, a path
  // the extension never takes.
  external: ["node:*"],
  legalComments: "none", logLevel: "warning",
});
await fs.copyFile(path.join(root, "design", "tokens.css"), path.join(out, "tokens.css"));
// Extension pages (popup, welcome) import ./core/*.js directly; only the worker
// is bundled. Ship just the core modules they reach, not all of core/: the
// store reviews every file in the zip.
await fs.mkdir(path.join(out, "core"), { recursive: true });
const shipped = new Set();
async function shipCore(file) {
  const src = await fs.readFile(file, "utf8");
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"|(?:^|\n)\s*import\s+"(\.{1,2}\/[^"]+)"/g)) {
    const rel = path.relative(out, path.resolve(path.dirname(file), m[1] || m[2])).split(path.sep).join("/");
    if (!rel.startsWith("core/") || shipped.has(rel)) continue;
    shipped.add(rel);
    await fs.copyFile(path.join(root, rel), path.join(out, rel));
    await shipCore(path.join(out, rel));
  }
}
for (const f of await fs.readdir(out)) if (f.endsWith(".js") && f !== "background.js") await shipCore(path.join(out, f));
// boot.js is the content script on every page; ui.js is injected on first use;
// runtime.js is both in one file, for the demo pages that load Morse directly.
await fs.writeFile(path.join(out, "boot.js"), bundleBoot());
await fs.writeFile(path.join(out, "ui.js"), bundleUI());
// The options page is the popup's model section, full-page.
const popup = await fs.readFile(path.join(root, "extension", "popup.html"), "utf8");
await fs.writeFile(path.join(out, "options.html"), popup.replace("<title>Morse</title>", "<title>Morse settings</title>").replace("<body>", '<body data-page="options">'));
await fs.writeFile(path.join(out, "runtime.js"), bundleRuntime());
await fs.copyFile(path.join(root, "design", "tokens.css"), path.join(out, "tokens.css")); // extension pages (welcome) share the design tokens

// The logo: a 3x3 grid in the gray signal ramp, on a dark rounded tile so the
// light squares show on light backgrounds too (the store page, a light
// toolbar, chrome://extensions).
const GRID = ["4a4a50", "f4f4f5", "7a7a82", "b4b4bb", "f4f4f5", "7a7a82", "f4f4f5", "7a7a82", "4a4a50"];
const TILE = "111113", TILE_EDGE = "2e2e33"; // --m-surface, --m-line-strong
// The Chrome Web Store wants the 128px icon's artwork in the middle 96px, with
// 16px of transparent padding on every side; the smaller sizes use all of it.
const ICON_PADDING = { 16: 0, 32: 0, 48: 0, 128: 16 };
// Whole pixels for the squares at each size, so they stay sharp:
// art size -> [inset from the tile's edge, square, gap, tile corner radius].
const LAYOUT = { 16: [1, 4, 1, 3], 32: [5, 6, 2, 7], 48: [10, 8, 2, 10.5], 96: [20, 16, 4, 21] };
for (const [size, pad] of Object.entries(ICON_PADDING)) await fs.writeFile(path.join(out, "icons", `${size}.png`), logoPng(+size, pad));

// Inside a rounded rectangle (x0, y0)-(x1, y1) with corner radius r.
function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r)), dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}
// 4x4 samples a pixel, for smooth rounded corners.
function logoPng(n, pad = 0) {
  const px = Buffer.alloc(n * n * 4);
  const art = n - 2 * pad, S = 4;
  const [inset, cell, gap, radius] = LAYOUT[art];
  const edge = art >= 96 ? 2 : 1, cellR = cell >= 8 ? cell * 0.18 : 0;
  const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, hits = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const ax = x + (sx + 0.5) / S - pad, ay = y + (sy + 0.5) / S - pad;
      if (!inRound(ax, ay, 0, 0, art, art, radius)) continue; // the transparent padding and corners
      let c = inRound(ax, ay, edge, edge, art - edge, art - edge, radius - edge) ? TILE : TILE_EDGE;
      const gx = ax - inset, gy = ay - inset;
      const cx = Math.floor(gx / (cell + gap)), cy = Math.floor(gy / (cell + gap));
      if (cx >= 0 && cx < 3 && cy >= 0 && cy < 3 && inRound(gx, gy, cx * (cell + gap), cy * (cell + gap), cx * (cell + gap) + cell, cy * (cell + gap) + cell, cellR)) c = GRID[cy * 3 + cx];
      const [cr, cg, cb] = rgb(c);
      r += cr; g += cg; b += cb; hits++;
    }
    if (!hits) continue;
    const i = (y * n + x) * 4;
    px[i] = Math.round(r / hits); px[i + 1] = Math.round(g / hits); px[i + 2] = Math.round(b / hits); px[i + 3] = Math.round((255 * hits) / (S * S));
  }
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

console.log(`Built ${path.relative(root, out)} (version ${version}${STORE ? ", store build" : ""}): load it in chrome://extensions → Load unpacked.`);
