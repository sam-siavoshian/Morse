// The Morse mark (the radar, runtime/src/05-radar.js) drawn as pixels, for
// the tray icon, the window icon and the packaged app's icon. Drawn in code
// so no image files live in the repo. No Electron here: build.js uses it too.
//
//   markPixels(size, { tile, color })  RGBA bytes
//   png(rgba, size)                    a PNG file's bytes

import zlib from "node:zlib";

const CORNER = new Set([0, 3, 12, 15]);
const OUTER = new Set([1, 2, 4, 7, 8, 11, 13, 14]);

// Inside a rounded rectangle (x, y, w, h, r)?
function inRound(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// The radar on its 15-unit grid: 3x3 squares every 4 units, corners off, the
// inner four bright (0.9) and the outer eight dim (0.3), like the still mark.
function radarAlpha(u, v, dim = 0.3) {
  for (let i = 0; i < 16; i++) {
    if (CORNER.has(i)) continue;
    if (inRound(u, v, (i % 4) * 4, Math.floor(i / 4) * 4, 3, 3, 1)) return OUTER.has(i) ? dim : 0.9;
  }
  return 0;
}

// tile: draw the mark on a dark rounded square (the app icon); without it,
// only the mark, in `color` (the tray). Edges are smoothed by sampling each
// pixel 4x4 times.
export function markPixels(size, { tile = false, color = [237, 237, 239], tileColor = [17, 17, 19], inset = null, dim = 0.3 } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  // The mark's box inside the image, in pixels.
  const pad = inset ?? (tile ? size * 0.25 : size * 0.06);
  const box = size - pad * 2;
  const radius = size * 0.225; // the app icon's corner
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let markA = 0, tileA = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
      if (tile && inRound(px, py, size * 0.06, size * 0.06, size * 0.88, size * 0.88, radius * 0.88)) tileA += 1;
      markA += radarAlpha(((px - pad) / box) * 15, ((py - pad) / box) * 15, dim);
    }
    markA /= S * S; tileA /= S * S;
    const i = (y * size + x) * 4;
    if (tile) {
      // The mark over the tile: light on dark.
      const a = Math.min(markA, tileA);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(tileColor[c] * (1 - a) + color[c] * a);
      out[i + 3] = Math.round(tileA * 255);
    } else {
      for (let c = 0; c < 3; c++) out[i + c] = color[c];
      out[i + 3] = Math.round(Math.min(1, markA) * 255);
    }
  }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// RGBA (size x size) -> PNG bytes.
export function png(rgba, size) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6; // 8 bits, RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const markPng = (size, opts) => png(markPixels(size, opts), size);
