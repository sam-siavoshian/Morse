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
// The squares don't overlap, so only the one under (u, v) is asked: the
// window icon is drawn at start-up and this is its inner loop.
function radarAlpha(u, v, dim = 0.3) {
  const col = Math.floor(u / 4), row = Math.floor(v / 4);
  if (col < 0 || row < 0 || col > 3 || row > 3) return 0;
  const i = row * 4 + col;
  if (CORNER.has(i) || !inRound(u, v, col * 4, row * 4, 3, 3, 1)) return 0;
  return OUTER.has(i) ? dim : 0.9;
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
  const tx = size * 0.06, tw = size * 0.88, tr = radius * 0.88;
  const toU = p => ((p - pad) / box) * 15;
  const lo = 0.5 / S, hi = (S - 0.5) / S; // the first and last sample in a pixel
  // Every shape is convex: when a pixel's four outermost samples are inside
  // one, all its samples are; when its samples' box misses a shape's box,
  // none are. Only pixels on an edge are sampled one by one (the same
  // samples, so the same bytes), which keeps the 256 px window icon cheap.
  const tileFast = (x, y) => {
    if (x + hi < tx || y + hi < ty || x + lo > tx + tw || y + lo > ty + tw) return 0;
    if (inRound(x + lo, y + lo, tx, ty, tw, tw, tr) && inRound(x + hi, y + lo, tx, ty, tw, tw, tr)
      && inRound(x + lo, y + hi, tx, ty, tw, tw, tr) && inRound(x + hi, y + hi, tx, ty, tw, tw, tr)) return 1;
    return -1;
  };
  const ty = tx;
  // a pixel all at alpha a, added up the way the samples are (16 x 0.3 is not 4.8)
  const full = a => { let m = 0; for (let k = 0; k < S * S; k++) m += a; return m / (S * S); };
  const markFast = (x, y) => {
    const u0 = toU(x + lo), u1 = toU(x + hi), v0 = toU(y + lo), v1 = toU(y + hi);
    const a = radarAlpha(u0, v0, dim);
    if (a === radarAlpha(u1, v0, dim) && a === radarAlpha(u0, v1, dim) && a === radarAlpha(u1, v1, dim)) {
      // The same square (or none) at all four: inside it, or in a gap no
      // wider than the samples' box only when that box misses every square.
      if (a > 0 && Math.floor(u0 / 4) === Math.floor(u1 / 4) && Math.floor(v0 / 4) === Math.floor(v1 / 4)) return full(a);
      if (a === 0 && !touchesSquare(Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1))) return 0;
    }
    return -1;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let markA = markFast(x, y), tileA = tile ? tileFast(x, y) : 0;
    if (markA < 0 || tileA < 0) {
      let m = 0, t = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
        if (tileA < 0 && inRound(px, py, tx, ty, tw, tw, tr)) t += 1;
        if (markA < 0) m += radarAlpha(toU(px), toU(py), dim);
      }
      if (markA < 0) markA = m / (S * S);
      if (tileA < 0) tileA = t / (S * S);
    }
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

// Does the box [u0, u1] x [v0, v1] (radar units) reach any lit square's box?
function touchesSquare(u0, u1, v0, v1) {
  for (let i = 0; i < 16; i++) {
    if (CORNER.has(i)) continue;
    const x = (i % 4) * 4, y = Math.floor(i / 4) * 4;
    if (u1 >= x && u0 <= x + 3 && v1 >= y && v0 <= y + 3) return true;
  }
  return false;
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
