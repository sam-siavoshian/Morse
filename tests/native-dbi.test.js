// The native-DBI prototype's pure modules, exercised without Frida or a
// target: signature scanning, mod-spec validation/applicability, binary-header
// classification, and the security gate + platform diagnostics.
//
// The Frida paths (frida-runner.js, agent.js) need `npm install frida` and a
// real user-owned process, so they aren't covered here; these are the parts
// that must be correct on their own.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePattern, scan, find, resolveOffset, toFridaPattern, uniqueness, patternFromCode } from "../native-dbi/sigscan.js";
import { createModSpec, validateModSpec, isApplicable, createContext } from "../native-dbi/schema.js";
import { classifyHeader } from "../native-dbi/discover.js";
import { authorizeTarget, probeRestrictions, assess } from "../native-dbi/boundaries.js";

test("sigscan: parses IDA-style patterns with wildcards", () => {
  const p = parsePattern("48 8B ?? ?? E8 ?");
  assert.equal(p.length, 6);
  assert.deepEqual([...p.bytes.slice(0, 2)], [0x48, 0x8b]);
  assert.deepEqual(p.mask, [true, true, false, false, true, false]);
  assert.throws(() => parsePattern("zz"), /bad pattern token/);
  assert.throws(() => parsePattern("?? ??"), /all wildcards/);
  assert.throws(() => parsePattern(""), /empty/);
});

test("sigscan: finds matches honoring wildcards", () => {
  const buf = Buffer.from([0x90, 0x48, 0x8b, 0x11, 0x22, 0xe8, 0x00, 0x48, 0x8b, 0xff, 0xee, 0xe8]);
  // both runs (48 8b 11 22 e8 at 1, and 48 8b ff ee e8 at 7) match, wildcards and all
  assert.deepEqual(scan(buf, parsePattern("48 8B ?? ?? E8")), [1, 7]);
  assert.deepEqual(scan(buf, "48 8B ?? ?? E8", { limit: 1 }), [1]);
  assert.equal(find(buf, "48 8B"), 1);
  assert.equal(find(buf, "DE AD"), -1);
});

test("sigscan: resolveOffset requires a unique match", () => {
  const buf = Buffer.from([0x00, 0x55, 0x48, 0x89, 0xe5, 0x00, 0x55, 0x48, 0x89, 0xe5]);
  assert.throws(() => resolveOffset(buf, "55 48 89 E5"), /ambiguous/);
  assert.equal(resolveOffset(buf, "55 48 89 E5", { from: 5 }), 6);
  assert.equal(resolveOffset(buf, "55 48 89 E5", { from: 5, base: 0x1000 }), 0x1006);
  assert.throws(() => resolveOffset(buf, "DE AD BE EF"), /not found/);
});

test("sigscan: round-trips to Frida pattern string, uniqueness, and code-derived patterns", () => {
  assert.equal(toFridaPattern(parsePattern("48 8B ?? E8")), "48 8b ?? e8");
  const buf = Buffer.from([0x48, 0x8b, 0x01, 0xe8, 0x48, 0x8b, 0x02, 0xe8]);
  assert.equal(uniqueness(buf, "48 8B ?? E8"), 2);
  // bytes [0..3] with the operand byte (index 2) wildcarded
  const p = patternFromCode([0x48, 0x8b, 0x01, 0xe8], [[2, 1]]);
  assert.equal(toFridaPattern(p), "48 8b ?? e8");
});

test("schema: validates mod specs by kind", () => {
  const good = createModSpec({
    title: "t", target: { kind: "export", module: "App", symbol: "foo" },
    action: { kind: "observe", onEnter: "log(1)" }, active: true,
  });
  assert.equal(validateModSpec(good).ok, true);

  const noSym = createModSpec({ target: { kind: "export", module: "App" }, action: { kind: "observe", onEnter: "x" } });
  assert.match(validateModSpec(noSym).errors.join(), /export target needs target.symbol/);

  const badOffset = createModSpec({ target: { kind: "offset", module: "App", offset: "nope" }, action: { kind: "observe", onEnter: "x" } });
  assert.match(validateModSpec(badOffset).errors.join(), /offset target needs/);

  const repl = createModSpec({ target: { kind: "signature", module: "A", pattern: "48 8B" }, action: { kind: "replace", retType: "int", argTypes: [], body: "return 0" } });
  assert.equal(validateModSpec(repl).ok, true);

  const replBad = createModSpec({ target: { kind: "signature", module: "A", pattern: "48" }, action: { kind: "replace", retType: "int" } });
  assert.match(validateModSpec(replBad).errors.join(), /argTypes|body/);
});

test("schema: isApplicable needs valid + active + matching context", () => {
  const ctx = createContext({ pid: 10, exe: "/a/App", format: "macho", arch: "arm64" });
  const base = { target: { kind: "export", module: "App", symbol: "f" }, action: { kind: "observe", onEnter: "x" } };
  assert.equal(isApplicable(createModSpec({ ...base, active: true, match: { format: "macho" } }), ctx), true);
  assert.equal(isApplicable(createModSpec({ ...base, active: false }), ctx), false); // not active
  assert.equal(isApplicable(createModSpec({ ...base, active: true, match: { format: "elf" } }), ctx), false); // wrong format
  assert.equal(isApplicable(createModSpec({ ...base, active: true, match: { arch: "arm64" } }), ctx), true);
});

test("discover: classifies Mach-O / PE / ELF magic", () => {
  // Mach-O 64-bit arm64 thin (LE magic cffaedfe, cputype 0x0100000c at offset 4)
  const macho = Buffer.alloc(64);
  macho.writeUInt32BE(0xcffaedfe, 0); macho.writeUInt32LE(0x0100000c, 4);
  assert.deepEqual(classifyHeader(macho), { format: "macho", arch: "arm64" });

  // Universal/fat
  const fat = Buffer.alloc(64); fat.writeUInt32BE(0xcafebabe, 0);
  assert.equal(classifyHeader(fat).format, "macho");

  // PE x86_64: "MZ", e_lfanew -> "PE\0\0" + machine 0x8664
  const pe = Buffer.alloc(64); pe[0] = 0x4d; pe[1] = 0x5a; pe.writeUInt32LE(0x30, 0x3c);
  pe[0x30] = 0x50; pe[0x31] = 0x45; pe.writeUInt16LE(0x8664, 0x34);
  assert.deepEqual(classifyHeader(pe), { format: "pe", arch: "x86_64" });

  // ELF x86_64 little-endian
  const elf = Buffer.alloc(64); elf[0] = 0x7f; elf[1] = 0x45; elf[2] = 0x4c; elf[3] = 0x46; elf[4] = 2; elf[5] = 1;
  elf.writeUInt16LE(0x3e, 18);
  assert.deepEqual(classifyHeader(elf), { format: "elf", arch: "x86_64" });

  assert.deepEqual(classifyHeader(Buffer.from([0, 1, 2, 3])), { format: null, arch: null });
});

test("boundaries: ownership gate refuses what it should", () => {
  const mine = createContext({ pid: 100, exe: "/a/App", user: "alice" });
  assert.equal(authorizeTarget(mine, { platform: "linux", me: "alice", uid: 1000 }).ok, true);

  const theirs = createContext({ pid: 101, exe: "/a/App", user: "bob" });
  assert.equal(authorizeTarget(theirs, { platform: "linux", me: "alice", uid: 1000 }).ok, false);

  // root attaching into another user's process is refused
  assert.equal(authorizeTarget(theirs, { platform: "linux", me: "root", uid: 0 }).ok, false);

  // unknown owner: not guessed permissively
  const unknown = createContext({ pid: 102, exe: "/a/App", user: null });
  assert.equal(authorizeTarget(unknown, { platform: "linux", me: "alice" }).ok, false);

  // refuses to instrument Morse itself
  const self = createContext({ pid: process.pid, exe: "/a/App", user: "alice" });
  assert.equal(authorizeTarget(self, { platform: "linux", me: "alice" }).ok, false);
});

test("boundaries: detects macOS hardened runtime and Linux ptrace_scope", () => {
  const ctx = createContext({ pid: 1, exe: "/Users/me/App.app/Contents/MacOS/App", format: "macho" });
  const hardened = probeRestrictions(ctx, {
    platform: "darwin",
    run: (file) => file === "codesign" ? "...flags=0x10000(runtime)...\n<key>com.apple.security.cs.allow-jit</key>" : null,
  });
  const hr = hardened.find(r => r.id === "hardened-runtime");
  assert.ok(hr && hr.blocking, "hardened runtime without get-task-allow should block");
  assert.match(hr.remedy, /won't strip or forge/);

  const linux = probeRestrictions(createContext({ pid: 2, exe: "/opt/app" }), {
    platform: "linux",
    read: p => p.endsWith("ptrace_scope") ? "2\n" : "CapEff:\t0000000000000000\n",
  });
  const ps = linux.find(r => r.id === "ptrace_scope");
  assert.ok(ps && ps.blocking, "ptrace_scope=2 blocks non-child attach");
  assert.match(ps.remedy, /won't change it for you/);
});

test("boundaries: SIP-protected system path is out of scope", () => {
  const ctx = createContext({ pid: 3, exe: "/System/Applications/Mail.app/Contents/MacOS/Mail", user: "me" });
  const r = probeRestrictions(ctx, { platform: "darwin", run: () => null });
  assert.ok(r.some(x => x.id === "sip" && x.blocking));
  // with the ownership gate passing, assess() surfaces the SIP block and isn't attachable
  const verdict = assess(ctx, { platform: "darwin", me: "me", run: () => null, uid: 1 });
  assert.equal(verdict.attachable, false);
  assert.match(verdict.text, /SIP|out of scope/i);
});
