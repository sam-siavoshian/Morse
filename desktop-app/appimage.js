// An AppImage's own icon, read from inside it without running it.
//
// An AppImage (type 2) is a small ELF program followed by a SquashFS image of
// the app's folder. The folder's top holds `.DirIcon` (the icon, or a link to
// it) and usually `<name>.png`. This reads just enough of SquashFS 4.0 to
// find that file: the superblock, the root folder and one file's blocks,
// decompressed with gzip or zstd (what appimagetool writes). Read only, and
// capped, so a broken or odd file gives null, never a hang or a big read.
//
//   appImageIcon(file, name?)  -> a PNG Buffer, or null (name: the app's name)

import { openSync, readSync, fstatSync, closeSync } from "node:fs";
import zlib from "node:zlib";

const MAX_ICON = 4 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function appImageIcon(file, name) {
  let fd;
  try {
    fd = openSync(file, "r");
    if (!fstatSync(fd).isFile()) return null;
    return new SquashFS(fd, squashOffset(fd)).icon(name);
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

function read(fd, pos, len) {
  const b = Buffer.alloc(len);
  let n = 0;
  while (n < len) { const got = readSync(fd, b, n, len - n, pos + n); if (!got) break; n += got; }
  return b.subarray(0, n);
}

// Where the SquashFS image starts: right after the ELF file's section headers.
function squashOffset(fd) {
  const h = read(fd, 0, 64);
  if (h.length < 52 || h.readUInt32BE(0) !== 0x7f454c46) throw new Error("not ELF");
  const le = h[5] === 1;
  const u16 = o => le ? h.readUInt16LE(o) : h.readUInt16BE(o);
  const u32 = o => le ? h.readUInt32LE(o) : h.readUInt32BE(o);
  if (h[4] === 2) return Number(le ? h.readBigUInt64LE(0x28) : h.readBigUInt64BE(0x28)) + u16(0x3a) * u16(0x3c);
  return u32(0x20) + u16(0x2e) * u16(0x30);
}

class SquashFS {
  constructor(fd, base) {
    this.fd = fd; this.base = base;
    const s = read(fd, base, 96);
    if (s.length < 96 || s.toString("latin1", 0, 4) !== "hsqs" || s.readUInt16LE(28) !== 4) throw new Error("not SquashFS 4");
    this.blockSize = s.readUInt32LE(12);
    const comp = s.readUInt16LE(20);
    const opts = { maxOutputLength: Math.max(this.blockSize, 8192) };
    this.unpack = comp === 1 ? b => zlib.inflateSync(b, opts)
      : comp === 6 && zlib.zstdDecompressSync ? b => zlib.zstdDecompressSync(b, opts)
      : null;
    if (!this.unpack) throw new Error("compression not supported");
    const u64 = o => Number(s.readBigUInt64LE(o));
    this.rootRef = s.readBigUInt64LE(32);
    this.inodeTable = u64(64);
    this.dirTable = u64(72);
    this.fragTable = u64(80);
  }

  at(pos, len) { return read(this.fd, this.base + pos, len); }

  // One metadata block (at most 8 KiB once unpacked): { data, next }.
  meta(pos) {
    const h = this.at(pos, 2).readUInt16LE(0);
    const size = h & 0x7fff;
    const raw = this.at(pos + 2, size);
    return { data: h & 0x8000 ? raw : this.unpack(raw), next: pos + 2 + size };
  }

  // A reader over consecutive metadata blocks, from block `start` at `offset`.
  cursor(table, start, offset) {
    let pos = table + start, buf = Buffer.alloc(0), i = offset, blocks = 0;
    const need = n => {
      while (buf.length - i < n) {
        if (++blocks > 64) throw new Error("too long");
        const m = this.meta(pos);
        buf = Buffer.concat([buf, m.data]); pos = m.next;
      }
    };
    const take = n => { need(n); const b = buf.subarray(i, i + n); i += n; return b; };
    return { take, u16: () => take(2).readUInt16LE(0), u32: () => take(4).readUInt32LE(0), u64: () => Number(take(8).readBigUInt64LE(0)) };
  }

  inode(ref) {
    const c = this.cursor(this.inodeTable, Number(BigInt(ref) >> 16n), Number(BigInt(ref) & 0xffffn));
    const type = c.u16(); c.take(14);
    if (type === 1) { const block = c.u32(); c.u32(); const size = c.u16(); const offset = c.u16(); return { dir: true, block, offset, size }; }
    if (type === 8) { c.u32(); const size = c.u32(); const block = c.u32(); c.u32(); c.u16(); const offset = c.u16(); return { dir: true, block, offset, size }; }
    if (type === 3 || type === 10) { c.u32(); const n = c.u32(); return { link: c.take(Math.min(n, 4096)).toString("utf8") }; }
    if (type === 2 || type === 9) {
      let start, size, frag, fragOffset;
      if (type === 2) { start = c.u32(); frag = c.u32(); fragOffset = c.u32(); size = c.u32(); }
      else { start = c.u64(); size = c.u64(); c.u64(); c.u32(); frag = c.u32(); fragOffset = c.u32(); c.u32(); }
      if (size > MAX_ICON) throw new Error("too big");
      const count = frag === 0xffffffff ? Math.ceil(size / this.blockSize) : Math.floor(size / this.blockSize);
      const blocks = Array.from({ length: count }, () => c.u32());
      return { file: true, start, size, frag, fragOffset, blocks };
    }
    return {};
  }

  list(dir) {
    const c = this.cursor(this.dirTable, dir.block, dir.offset);
    const out = [];
    let left = dir.size - 3;
    while (left > 0) {
      const count = c.u32() + 1, start = c.u32(); c.u32(); left -= 12;
      if (count > 256) throw new Error("bad folder");
      for (let k = 0; k < count && left > 0; k++) {
        const offset = c.u16(); c.u16(); c.u16(); const len = c.u16() + 1;
        out.push({ name: c.take(len).toString("utf8"), ref: (BigInt(start) << 16n) | BigInt(offset) });
        left -= 8 + len;
      }
    }
    return out;
  }

  // A path from the top of the image, following links (relative to the top
  // or to the link's own folder) a few times at most.
  find(path, hops = 0) {
    if (hops > 8) return null;
    let node = this.inode(this.rootRef), parts = path.split("/").filter(p => p && p !== ".");
    const seen = [];
    for (let k = 0; k < parts.length; k++) {
      if (parts[k] === "..") { seen.pop(); return this.find([...seen, ...parts.slice(k + 1)].join("/"), hops + 1); }
      if (!node.dir) return null;
      const e = this.list(node).find(x => x.name === parts[k]);
      if (!e) return null;
      node = this.inode(e.ref);
      if (node.link !== undefined) {
        const target = node.link.startsWith("/") ? node.link : [...seen, node.link].join("/");
        return this.find([target, ...parts.slice(k + 1)].join("/"), hops + 1);
      }
      seen.push(parts[k]);
    }
    return node;
  }

  readFile(f) {
    const parts = [];
    let pos = f.start;
    for (const b of f.blocks) {
      const size = b & 0xffffff;
      if (!size) { parts.push(Buffer.alloc(this.blockSize)); continue; }
      const raw = this.at(pos, size); pos += size;
      parts.push(b & 0x1000000 ? raw : this.unpack(raw));
    }
    if (f.frag !== 0xffffffff) {
      const ptr = Number(this.at(this.fragTable + 8 * Math.floor(f.frag / 512), 8).readBigUInt64LE(0));
      const c = this.cursor(ptr, 0, (f.frag % 512) * 16);
      const start = c.u64(), size = c.u32();
      const raw = this.at(start, size & 0xffffff);
      const block = size & 0x1000000 ? raw : this.unpack(raw);
      parts.push(block.subarray(f.fragOffset, f.fragOffset + (f.size % this.blockSize)));
    }
    return Buffer.concat(parts).subarray(0, f.size);
  }

  png(path) {
    try {
      const f = this.find(path);
      if (!f?.file) return null;
      const b = this.readFile(f);
      return b.subarray(0, 4).equals(PNG) ? b : null;
    } catch { return null; }
  }

  // The app's own icon when it ships unpacked (resources/app/icons/<name>.png
  // or resources/app/icon.png: some packagers leave Electron's default atom
  // in .DirIcon), then .DirIcon; when that is an SVG (Electron can't draw
  // those), a PNG beside it or in the icon theme folders inside.
  icon(name) {
    const top = this.list(this.inode(this.rootRef));
    const names = top.map(e => e.name);
    const own = [...new Set([name, ...names.filter(n => /\.desktop$/i.test(n)).map(n => n.slice(0, -8))].filter(Boolean).map(n => n.toLowerCase()))];
    const tries = [...own.map(n => `resources/app/icons/${n}.png`), "resources/app/icon.png", ".DirIcon", ...names.filter(n => /\.png$/i.test(n))];
    for (const p of tries) { const b = this.png(p); if (b) return b; }
    const stems = names.filter(n => /\.(png|svg)$/i.test(n)).map(n => n.replace(/\.(png|svg)$/i, ""));
    for (const s of ["512x512", "256x256", "128x128"]) for (const n of stems) {
      const b = this.png(`usr/share/icons/hicolor/${s}/apps/${n}.png`);
      if (b) return b;
    }
    return null;
  }
}
