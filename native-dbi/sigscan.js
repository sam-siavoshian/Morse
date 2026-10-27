// Byte-pattern (signature) scanning.
//
// Stripped native apps have no symbol for the function a mod wants, and the
// offset moves on every point release. A signature — a run of opcode bytes
// with the volatile bytes (embedded addresses, relocated offsets) wildcarded
// — pins the same function across minor revisions by what its code *is*.
//
// This module is pure: it searches a Buffer/Uint8Array and parses/serialises
// patterns. It never touches a process. The agent (agent.js) searches live
// memory with Frida's Memory.scan using the string from toFridaPattern(), so a
// signature resolved against a file on disk is the exact one searched in the
// running process. Keeping the search here (not in the agent) means it is
// testable with Node's test runner and no target.

// Pattern syntax (IDA / x64dbg style): space-separated bytes, each a two-hex-
// digit byte or a wildcard ("??" or "?"). Case-insensitive. Examples:
//   "48 8B ?? ?? ?? ?? E8"      "55 48 89 E5"      "FF 15 ? ? ? ?"
export function parsePattern(text) {
  if (typeof text !== "string") throw new TypeError("pattern must be a string");
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("empty pattern");
  const bytes = new Uint8Array(tokens.length);
  const mask = new Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "??" || tok === "?") { bytes[i] = 0; mask[i] = false; continue; }
    if (!/^[0-9a-fA-F]{2}$/.test(tok)) throw new Error(`bad pattern token "${tok}" at position ${i}`);
    bytes[i] = parseInt(tok, 16);
    mask[i] = true;
  }
  if (!mask.some(Boolean)) throw new Error("pattern is all wildcards");
  return { bytes, mask, length: tokens.length };
}

// Normalise any input (string or already-parsed) to a pattern object.
export function asPattern(p) {
  return p && p.bytes instanceof Uint8Array && Array.isArray(p.mask) ? p : parsePattern(p);
}

// All match offsets of `pattern` in `buf`. `limit` caps how many to return
// (default: all). `from`/`to` bound the search window within the buffer.
export function scan(buf, pattern, { limit = Infinity, from = 0, to = buf.length } = {}) {
  const { bytes, mask, length } = asPattern(pattern);
  const out = [];
  const end = Math.min(to, buf.length) - length;
  // First fixed (non-wildcard) byte: lets us skip positions cheaply instead of
  // comparing from index 0 every time. Common case — patterns start with a
  // fixed opcode — so this turns a section scan from slow to fine.
  const firstFixed = mask.indexOf(true);
  const anchor = bytes[firstFixed];

  for (let i = Math.max(0, from); i <= end; i++) {
    if (buf[i + firstFixed] !== anchor) continue;
    let ok = true;
    for (let j = 0; j < length; j++) {
      if (mask[j] && buf[i + j] !== bytes[j]) { ok = false; break; }
    }
    if (ok) {
      out.push(i);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// How many times the pattern matches in the buffer. A good signature is one
// whose uniqueness() is exactly 1: it resolves to a single function.
export function uniqueness(buf, pattern, cap = 8) {
  return scan(buf, pattern, { limit: cap }).length;
}

// First match offset, or -1.
export function find(buf, pattern, opts) {
  const hits = scan(buf, pattern, { ...opts, limit: 1 });
  return hits.length ? hits[0] : -1;
}

// Resolve a signature to a single offset, or throw with the reason — the
// caller turns that into the mod's error rather than hooking a guess.
//   base: the value to add to the file/section offset (e.g. a module base, or
//   the section's virtual address) so the result is an address the agent uses.
export function resolveOffset(buf, pattern, { base = 0, from = 0, to = buf.length } = {}) {
  const hits = scan(buf, pattern, { from, to, limit: 2 });
  if (hits.length === 0) throw new Error("signature not found");
  if (hits.length > 1) throw new Error("signature is ambiguous (matches more than one site) — make it longer or more specific");
  return base + hits[0];
}

// The string Frida's Memory.scan / Module.scan take: lowercase hex bytes,
// wildcards as "??". Round-trips with parsePattern.
export function toFridaPattern(pattern) {
  const { bytes, mask, length } = asPattern(pattern);
  const parts = new Array(length);
  for (let i = 0; i < length; i++) parts[i] = mask[i] ? bytes[i].toString(16).padStart(2, "0") : "??";
  return parts.join(" ");
}

// Build a signature *from* known code: take the bytes of a function and
// wildcard the runs the caller marks volatile (relocations, rel32 displacement
// operands). `volatile` is a list of [start, len] byte ranges within `code`.
// This is how analyze_function's bytes become a portable signature.
export function patternFromCode(code, volatile = []) {
  const bytes = Uint8Array.from(code);
  const mask = new Array(bytes.length).fill(true);
  for (const [start, len] of volatile) {
    for (let i = start; i < start + len && i < mask.length; i++) mask[i] = false;
  }
  return { bytes, mask, length: bytes.length };
}
