// Bug and security hunt, round 6: mod packs, installs, the Trusted Types
// builder, and app discovery from hostile files. Each test failed before its fix.
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { chromium, noBrowser as skip } from "./helpers/browser.js";

import { parsePack, clashesFor, planInstall, planUpdate } from "../core/pack.js";
import { createPacks } from "../core/pack-host.js";
import { prepareInstall } from "../core/backup.js";

void home;
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => {}); });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const mod = (id, extra = {}) => ({ morse: 1, id, title: `Mod ${id}`, prompt: `do ${id}`, css: `.${id} { color: red; }`, js: "", match: { hosts: ["team.example"], app: null }, enabled: true, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", ...extra });
const pack = (mods, extra = {}) => ({ morse: "morse-pack", version: 1, id: "team", name: "Team", note: "", mods, ...extra });

// Runs `code` (an ES module) in its own Node process, so a hang fails the test instead of the run.
function isolated(code, timeout = 20000) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, timeout, encoding: "utf8", env: { ...process.env, MORSE_HOME: home } });
  return { ok: r.status === 0 && !r.error, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), timedOut: r.error?.code === "ETIMEDOUT" };
}

// ======================================================================
// Mod packs

test("packs: a pack mod whose id differs from yours only in case is a clash (one file on macOS and Windows), never a silent overwrite", () => {
  const mine = [mod("abc123", { title: "My notes" })];
  const p = parsePack(pack([mod("ABC123", { title: "Theirs" })])).pack;
  assert.deepEqual(clashesFor(p, mine), { ABC123: { kind: "clash", id: "abc123", title: "My notes" } });
  assert.throws(() => planInstall(p, [{ id: "ABC123" }], mine), /Choose Keep both or Replace yours/);
  const both = planInstall(p, [{ id: "ABC123", as: "copy" }], mine).put;
  assert.notEqual(both[0].id.toLowerCase(), "abc123", "Keep both keeps yours");
  // Replace yours replaces that mod (its own file), not a second one beside it.
  assert.deepEqual(planInstall(p, [{ id: "ABC123", as: "replace" }], mine).put.map(m => m.id), ["abc123"]);
  // Two mods in one pack that are one file: the second is left out, and said so.
  const twice = parsePack(pack([mod("Dup"), mod("dup")]));
  assert.deepEqual(twice.pack.mods.map(m => m.id), ["Dup"]);
  assert.match(twice.errors[0], /same id/);
});

test("packs: Keep both never gives the copy an id another mod in the same pack has", () => {
  const mine = [mod("a", { title: "Mine" })];
  const p = parsePack(pack([mod("a"), mod("a-2", { title: "Second" })])).pack;
  const { put } = planInstall(p, [{ id: "a", as: "copy" }, { id: "a-2" }], mine);
  const ids = put.map(m => m.id);
  assert.equal(new Set(ids.map(i => i.toLowerCase())).size, ids.length, `distinct ids: ${ids.join(", ")}`);
  assert.ok(!ids.includes("a"), "yours stays");
  assert.deepEqual(put.map(m => m.pack.mod).sort(), ["a", "a-2"]);
  // The same in an update that brings both.
  const installed = [mod("a", { title: "Mine" }), mod("z", { pack: { id: "team", name: "Team", mod: "z" } })];
  const next = parsePack(pack([mod("z"), mod("a"), mod("a-2")])).pack;
  const up = planUpdate(installed, next, { add: ["a", "a-2"] }).put.map(m => m.id);
  assert.equal(new Set(up.map(i => i.toLowerCase())).size, up.length, `distinct ids: ${up.join(", ")}`);
});

test("packs: an https address that redirects to http (this computer included) is refused", async () => {
  const text = JSON.stringify(pack([mod("a")]));
  const asked = [];
  const fakeFetch = async (url, opts) => {
    asked.push(url);
    return { url: "http://127.0.0.1:9/team.json", status: 200, headers: new Headers(), body: null, text: async () => text, redirected: true };
  };
  const packs = createPacks({ store: { get: async () => ({}), set: async () => {} }, mods: { list: async () => [], put: async () => {}, remove: async () => {} }, fetch: fakeFetch });
  await assert.rejects(packs.fetchAddress("https://team.example/team.json"), /https/);
  // Making a pack on this computer, http://127.0.0.1 itself still works.
  const local = createPacks({ store: { get: async () => ({}), set: async () => {} }, mods: { list: async () => [], put: async () => {}, remove: async () => {} },
    fetch: async url => ({ url, status: 200, headers: new Headers(), body: null, text: async () => text }) });
  assert.equal((await local.fetchAddress("http://127.0.0.1:9/team.json")).pack.id, "team");
});

test("packs: the pack's switch doesn't turn back on a mod Morse paused because it froze or blanked the page", async () => {
  let all = [
    mod("a", { enabled: false, pack: { id: "team", name: "Team", mod: "a" } }),
    mod("b", { enabled: false, paused: { why: "froze", at: "2026-01-01T00:00:00Z", error: "froze" }, pack: { id: "team", name: "Team", mod: "b" } }),
  ];
  const packs = createPacks({ store: { get: async () => ({}), set: async () => {} },
    mods: { list: async () => all, put: async list => { all = all.map(m => list.find(x => x.id === m.id) || m); }, remove: async () => {} } });
  await packs.enable({ pack: "team", on: true });
  assert.deepEqual(all.map(m => [m.id, m.enabled]), [["a", true], ["b", false]]);
  await packs.enable({ pack: "team", on: false });
  assert.deepEqual(all.map(m => [m.id, m.enabled]), [["a", false], ["b", false]]);
});

test("morse pack install / morse install: a mod's words and sites can't move the cursor, rewrite the review or reach the clipboard", async () => {
  const { describe } = await import("../daemon/control.js");
  const evil = mod("evil", {
    title: "Fine\x1b[2K",
    prompt: "tidy\x1b[3A\x1b[2K\r\x1b]52;c;ZWNobyBoaQ==\x07 up\u009b2J",
    match: { hosts: ["*\x1b[1A\x1b[2Kexample.com"], app: null },
  });
  const out = describe(evil).replace(/\x1b\[[0-9;]*m/g, ""); // our own colors
  assert.doesNotMatch(out, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/, JSON.stringify(out));
  assert.match(out, /tidy/);
});

// ======================================================================
// Installing one shared mod

test("a shared mod can't arrive as Your style (hidden from the Mods panel), skip the guard, or bring this computer's state", () => {
  const sent = mod("hide1", { kind: "style", parent: "morse-style", guardOk: "x", paused: { why: "hid" }, fp: { v: 1 } });
  for (const kind of ["link", "mod"]) {
    const m = prepareInstall(sent, { kind });
    for (const k of ["kind", "parent", "guardOk", "paused", "fp"]) assert.ok(!(k in m), `${kind}: ${k}`);
    assert.equal(m.enabled, true);
  }
  // A backup is your own: it keeps its fits and guard state, but nothing is ever Your style.
  const b = prepareInstall(sent, { kind: "backup" });
  assert.ok(!("kind" in b));
  assert.equal(b.guardOk, "x");
  assert.equal(b.parent, "morse-style");
});

// ======================================================================
// The Trusted Types builder

test("the HTML builder also drops javascript: links spelled with tabs or control characters, SVG animation of links; a bad entity doesn't throw, and text that grows when lower-cased (İ) no longer loops forever", { skip, timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  cleanups.push(() => browser.close());
  const page = await browser.newPage();
  const src = await fs.readFile(new URL("../runtime/src/00-trusted-html.js", import.meta.url), "utf8");
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">`);
  const out = await page.evaluate(code => {
    globalThis.__morseHost = {};
    new Function(code)();
    const d = document.createElement("div");
    d.innerHTML = `<a id="t" href="java&#9;script:alert(1)">t</a><a id="c" href="&#1;javascript:alert(1)">c</a><a id="n" href="jav&#x0A;ascript:alert(1)">n</a>`
      + `<svg><a id="s"><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/><use href="data:image/svg+xml,x"/><text>s</text></a></svg>`
      + `<iframe srcdoc="<script>1</script>"></iframe><p id="ok" title="a">fine</p>`;
    let bad = "ok";
    try { const e = document.createElement("div"); e.innerHTML = "x &#99999999; y"; bad = e.textContent; } catch (err) { bad = "threw: " + err.message; }
    // A textarea's text with letters that grow when lower-cased ends where it ends.
    const t = document.createElement("div");
    t.innerHTML = `<textarea>${"İ".repeat(40)}</textarea><b id="after">after</b>`;
    return { html: d.innerHTML, bad, hrefs: [...d.querySelectorAll("a")].map(a => a.getAttribute("href")), ta: t.querySelector("textarea").value, after: t.querySelector("#after")?.textContent };
  }, src);
  assert.equal(out.ta, "İ".repeat(40));
  assert.equal(out.after, "after");
  assert.deepEqual(out.hrefs, [null, null, null, null]);
  assert.doesNotMatch(out.html, /animate|<set|<use|srcdoc/i);
  assert.match(out.html, /<p id="ok" title="a">fine<\/p>/);
  assert.doesNotMatch(out.bad, /threw/);
});

// ======================================================================
// App discovery: hostile files in the places Morse looks

// A binary plist of 31 objects: each of the first 30 is an array holding the
// next one 14 times (never deeper than 31, so no depth limit stops it), the last
// is `true`. Read naively, that is 14^30 visits.
function fanOutPlist() {
  const N = 30, objs = [], offs = [];
  let at = 8;
  for (let i = 0; i < N; i++) { const o = Buffer.from([0xae, ...Array(14).fill(i + 1)]); offs.push(at); objs.push(o); at += o.length; }
  offs.push(at); objs.push(Buffer.from([0x09])); at += 1;
  const table = Buffer.alloc(offs.length * 2);
  offs.forEach((o, i) => table.writeUInt16BE(o, i * 2));
  const trailer = Buffer.alloc(32);
  trailer[6] = 2; trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(offs.length), 8); trailer.writeBigUInt64BE(0n, 16); trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([Buffer.from("bplist00"), ...objs, table, trailer]);
}

test("apps: a binary Info.plist whose objects refer to each other over and over is read at once, not forever", () => {
  const file = path.join(tempDir("morse-r6-plist-"), "Info.plist");
  writeFileSync(file, fanOutPlist());
  const r = isolated(`import { parseBinaryPlist } from "./daemon/apps.js"; import fs from "node:fs";
    const t = Date.now(); parseBinaryPlist(fs.readFileSync(${JSON.stringify(file)})); console.log(Date.now() - t);`, 15000);
  assert.ok(r.ok && Number(r.out) < 2000, r.timedOut ? "hung" : `${r.out} ${r.err}`);
});

test("apps: an XML Info.plist full of unclosed <dict> tags is read in linear time", async () => {
  const { parsePlist } = await import("../daemon/apps.js");
  const t = Date.now();
  parsePlist("<plist>" + "<dict>".repeat(40000));
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
  assert.deepEqual(parsePlist(`<plist><dict><key>CFBundleName</key><string>Tunes</string><key>X</key><dict><key>Y</key><string>n</string></dict></dict></plist>`), { CFBundleName: "Tunes" });
});

test("apps: a shortcut with thousands of folder items is read in linear time", async () => {
  const { parseLnk } = await import("../daemon/apps.js");
  const head = Buffer.alloc(0x4c);
  head.writeUInt32LE(0x4c, 0);
  Buffer.from("0114020000000000c000000000000046", "hex").copy(head, 4);
  head.writeUInt32LE(0x01, 0x14);
  const drive = Buffer.alloc(25); drive.writeUInt16LE(25, 0); drive[2] = 0x2f; drive.write("C:\\", 3, "latin1");
  const item = Buffer.alloc(16); item.writeUInt16LE(16, 0); item[2] = 0x31; item.write("A", 14, "latin1");
  const list = Buffer.concat([drive, ...Array(4000).fill(item)]);
  const size = Buffer.alloc(2); size.writeUInt16LE(list.length);
  const lnk = Buffer.concat([head, size, list, Buffer.alloc(6 << 20)]);
  const t = Date.now();
  parseLnk(lnk);
  assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
});

test("apps: a FIFO, /dev/zero or a huge file where an app, shortcut or menu entry should be doesn't hang or fill memory", { skip: process.platform === "win32" && "needs mkfifo" }, () => {
  const root = tempDir("morse-r6-root-");
  const p = (...a) => path.join(root, ...a);
  for (const d of ["usr/share/applications", "usr/bin", "home/sam/.local/share/applications", "opt"]) mkdirSync(p(d), { recursive: true });
  execFileSync("mkfifo", [p("usr/bin/fifo-app")]);
  execFileSync("mkfifo", [p("home/sam/.local/share/applications/pipe.desktop")]);
  symlinkSync("/dev/zero", p("usr/bin/zero-app"));
  writeFileSync(p("usr/share/applications/fifo.desktop"), "[Desktop Entry]\nType=Application\nName=Fifo\nExec=/usr/bin/fifo-app %U\n");
  writeFileSync(p("usr/share/applications/zero.desktop"), "[Desktop Entry]\nType=Application\nName=Zero\nExec=/usr/bin/zero-app\n");
  // Windows: a Start menu shortcut that is a FIFO.
  const menu = p("C", "Users", "sam", "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs");
  mkdirSync(menu, { recursive: true });
  execFileSync("mkfifo", [path.join(menu, "Pipe.lnk")]);
  const r = isolated(`import { hostContext, discoverApps } from "./daemon/apps.js";
    const linux = discoverApps(hostContext({ platform: "linux", root: ${JSON.stringify(root)}, home: "/home/sam", env: { PATH: "/usr/bin" } }));
    const win = discoverApps(hostContext({ platform: "win32", root: ${JSON.stringify(root)}, home: "C:\\\\Users\\\\sam", env: {} }));
    console.log(JSON.stringify([linux.length, win.length]));`, 20000);
  assert.ok(r.ok, r.timedOut ? "hung" : r.err);
});

test("apps: an app's executable is never read whole to see whether it is a script", async () => {
  const apps = await import("../daemon/apps.js");
  const root = tempDir("morse-r6-big-");
  mkdirSync(path.join(root, "usr/share/applications"), { recursive: true });
  mkdirSync(path.join(root, "usr/bin"), { recursive: true });
  const fh = await fs.open(path.join(root, "usr/bin/bigapp"), "w");
  await fh.truncate(64 << 20); // sparse: 64 MB that takes no disk
  await fh.close();
  writeFileSync(path.join(root, "usr/share/applications/big.desktop"), "[Desktop Entry]\nType=Application\nName=Big\nExec=/usr/bin/bigapp\n");
  const ctx = apps.hostContext({ platform: "linux", root, home: "/home/sam", env: { PATH: "/usr/bin" } });
  let most = 0;
  const read = ctx.read;
  ctx.read = (...a) => { const b = read(...a); most = Math.max(most, b?.length || 0); return b; };
  apps.discoverApps(ctx);
  assert.ok(most < 1 << 20, `read ${most} bytes at once`);
});
