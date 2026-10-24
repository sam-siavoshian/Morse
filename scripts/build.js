// Assembles the unpacked extension into dist/extension: the extension's own
// files plus the shared core and runtime, and generated icons.

import { promises as fs } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist", "extension");

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "core"), { recursive: true });
await fs.mkdir(path.join(out, "icons"), { recursive: true });

for (const f of await fs.readdir(path.join(root, "extension"))) await fs.copyFile(path.join(root, "extension", f), path.join(out, f));
for (const f of await fs.readdir(path.join(root, "core"))) await fs.copyFile(path.join(root, "core", f), path.join(out, "core", f));
await fs.copyFile(path.join(root, "runtime", "runtime.js"), path.join(out, "runtime.js"));

// The logo: a 3x3 contribution-graph grid.
const GRID = ["0e4429", "39d353", "26a641", "006d32", "39d353", "26a641", "39d353", "26a641", "0e4429"];
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
