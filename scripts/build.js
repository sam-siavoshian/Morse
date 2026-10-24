// Assembles the unpacked extension into dist/extension: the service worker
// bundled with core/ and the Anthropic SDK (esbuild), the extension's own
// files, the design tokens, the injected runtime, an options page, and icons.

import { promises as fs } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { bundleRuntime } from "../runtime/bundle.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist", "extension");

let esbuild;
try { esbuild = await import("esbuild"); } catch {
  console.error("esbuild is missing: run `npm install` first.");
  process.exit(1);
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "icons"), { recursive: true });

// The worker's own modules import ../core and are only ever bundled into
// background.js; copied raw they'd be dead files with broken imports.
const BUNDLED_ONLY = ["background.js", "bar-host.js", "onboarding-host.js", "control-host.js", "gallery-host.js", "style-host.js" /* your-style hook */];
for (const f of await fs.readdir(path.join(root, "extension"))) {
  if (!BUNDLED_ONLY.includes(f)) await fs.copyFile(path.join(root, "extension", f), path.join(out, f));
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
// The options page is the popup's model section, full-page.
const popup = await fs.readFile(path.join(root, "extension", "popup.html"), "utf8");
await fs.writeFile(path.join(out, "options.html"), popup.replace("<title>Morse</title>", "<title>Morse settings</title>").replace("<body>", '<body data-page="options">'));
await fs.writeFile(path.join(out, "runtime.js"), bundleRuntime());
await fs.copyFile(path.join(root, "design", "tokens.css"), path.join(out, "tokens.css")); // extension pages (welcome) share the design tokens

// The logo: a 3x3 grid in the gray signal ramp.
const GRID = ["4a4a50", "f4f4f5", "7a7a82", "b4b4bb", "f4f4f5", "7a7a82", "f4f4f5", "7a7a82", "4a4a50"];
// The Chrome Web Store wants the 128px icon's artwork in the middle 96px, with
// 16px of transparent padding on every side; the smaller sizes use all of it.
const ICON_PADDING = { 16: 0, 32: 0, 48: 0, 128: 16 };
for (const [size, pad] of Object.entries(ICON_PADDING)) await fs.writeFile(path.join(out, "icons", `${size}.png`), logoPng(+size, pad));

function logoPng(n, pad = 0) {
  const px = Buffer.alloc(n * n * 4);
  const art = n - 2 * pad, cell = art / 3, gap = Math.max(1, Math.round(art / 16));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ax = x - pad, ay = y - pad;
    if (ax < 0 || ay < 0 || ax >= art || ay >= art) continue; // the transparent padding
    const cx = Math.min(2, Math.floor(ax / cell)), cy = Math.min(2, Math.floor(ay / cell));
    const inX = ax - cx * cell, inY = ay - cy * cell;
    const on = inX >= gap / 2 && inX < cell - gap / 2 && inY >= gap / 2 && inY < cell - gap / 2;
    const i = (y * n + x) * 4;
    if (on) { const h = GRID[cy * 3 + cx]; px[i] = parseInt(h.slice(0, 2), 16); px[i + 1] = parseInt(h.slice(2, 4), 16); px[i + 2] = parseInt(h.slice(4), 16); px[i + 3] = 255; }
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

console.log(`Built ${path.relative(root, out)} (version ${version}): load it in chrome://extensions → Load unpacked.`);
