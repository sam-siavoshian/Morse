// Zips the built extension (dist/extension) for the Chrome Web Store:
// dist/morse-extension-<version>.zip, with manifest.json at the root of the zip.
//
//   npm run package:extension        (builds first)
//   node scripts/package-extension.js [--out <file>]
//
// No dependencies: a plain zip writer (deflate, CRC-32, central directory).

import { promises as fs } from "node:fs";
import { deflateRawSync } from "node:zlib";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "dist", "extension");

export async function packageExtension({ dir = src, out } = {}) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")); }
  catch { throw new Error(`No built extension in ${path.relative(root, dir) || dir}. Run npm run build first.`); }
  if (manifest.version !== pkg.version) throw new Error(`The built extension is version ${manifest.version}, package.json says ${pkg.version}. Run npm run build again.`);
  out ||= path.join(root, "dist", `morse-extension-${pkg.version}.zip`);

  const files = (await walk(dir)).sort();
  const zip = zipFiles(await Promise.all(files.map(async rel => ({ name: rel, data: await fs.readFile(path.join(dir, rel)) }))));
  await fs.writeFile(out, zip);
  return { out, files, bytes: zip.length, version: pkg.version };
}

async function walk(dir, base = "") {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.name.startsWith(".")) continue; // .DS_Store and friends
    if (e.isDirectory()) out.push(...await walk(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// A fixed timestamp (2026-01-01 00:00) so the same build gives the same zip.
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function zipFiles(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const i = process.argv.indexOf("--out");
  try {
    const r = await packageExtension({ out: i > 0 ? path.resolve(process.argv[i + 1]) : undefined });
    console.log(`${path.relative(process.cwd(), r.out)}  ${r.files.length} files, ${(r.bytes / 1024).toFixed(0)} KB, version ${r.version}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
