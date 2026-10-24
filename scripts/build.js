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

// bar-host.js and onboarding-host.js import ../core and are only ever bundled
// into background.js; copied raw they'd be dead files with broken imports.
const BUNDLED_ONLY = ["background.js", "bar-host.js", "onboarding-host.js"];
for (const f of await fs.readdir(path.join(root, "extension"))) {
  if (!BUNDLED_ONLY.includes(f)) await fs.copyFile(path.join(root, "extension", f), path.join(out, f));
}
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
// The options page is the popup's model section, full-page.
const popup = await fs.readFile(path.join(root, "extension", "popup.html"), "utf8");
await fs.writeFile(path.join(out, "options.html"), popup.replace("<title>Morse</title>", "<title>Morse settings</title>").replace("<body>", '<body data-page="options">'));
await fs.writeFile(path.join(out, "runtime.js"), bundleRuntime());
await fs.copyFile(path.join(root, "design", "tokens.css"), path.join(out, "tokens.css")); // extension pages (welcome) share the design tokens
// Extension pages (popup, welcome) import these dependency-free core modules as ./core/*.js.
await fs.mkdir(path.join(out, "core"), { recursive: true });
for (const f of ["onboarding.js", "prefs.js", "hotkeys.js"]) await fs.copyFile(path.join(root, "core", f), path.join(out, "core", f));

// The logo: a 3x3 grid in the gray signal ramp.
const GRID = ["4a4a50", "f4f4f5", "7a7a82", "b4b4bb", "f4f4f5", "7a7a82", "f4f4f5", "7a7a82", "4a4a50"];
for (const size of [16, 48, 128]) await fs.writeFile(path.join(out, "icons", `${size}.png`), logoPng(size));

function logoPng(n) {
  const px = Buffer.alloc(n * n * 4);
  const cell = n / 3, gap = Math.max(1, Math.round(n / 16));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const cx = Math.min(2, Math.floor(x / cell)), cy = Math.min(2, Math.floor(y / cell));
    const inX = x - cx * cell, inY = y - cy * cell;
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

console.log(`Built ${path.relative(root, out)}: load it in chrome://extensions → Load unpacked.`);
