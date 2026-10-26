// Mod packs: the format, reading hostile packs, what installing one does,
// what changed in an update, and the host's fetch-and-cache rules for packs
// that update (core/pack.js, core/pack-host.js).
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makePack, parsePack, encodePackLink, decodePackLink, packHash, isWide, clashesFor, planInstall, diffPack, planUpdate,
  checkPackUrl, isPackAddress, packGroups, cleanText, packFilename, MAX_PACK_MODS, MAX_PACK_BYTES, MAX_PACK_LINK,
} from "../core/pack.js";
import { createPacks } from "../core/pack-host.js";
import { parseImport } from "../core/backup.js";
import { encodeShareText, SHARE_BASE } from "../core/mod.js";
import { modOrigin } from "../core/summary.js";
import { controlHandler } from "../core/control-host.js";
import { DAY } from "../core/gallery.js";

const mod = (id, extra = {}) => ({ morse: 1, id, title: `Mod ${id}`, prompt: `do ${id}`, css: `.${id} { color: red; }`, js: "", match: { hosts: ["team.example"], app: null }, enabled: true, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", ...extra });
const pack = (mods, extra = {}) => ({ morse: "morse-pack", version: 1, id: "team", name: "Team", note: "", mods, ...extra });

// ---- the format

test("a pack carries the shared part of each mod: nothing about this computer", () => {
  const p = makePack([
    mod("a", { history: [{ css: "x", js: "", prompt: "old" }], enabled: false, fp: { x: 1 }, paused: { why: "slow" }, guardOk: true }),
    mod("b", { imported: true, importedFrom: "pack", importedAt: "2026-02-02T00:00:00Z", pack: { id: "other", name: "Other", mod: "b" } }),
  ], { name: "  Team\ntools  ", note: "For the board team", now: new Date("2026-03-03T00:00:00Z") });
  assert.equal(p.morse, "morse-pack");
  assert.equal(p.version, 1);
  assert.equal(p.name, "Team tools");
  assert.match(p.id, /^team-tools-\w{4}$/);
  assert.equal(p.made, "2026-03-03T00:00:00.000Z");
  for (const k of ["enabled", "history", "fp", "paused", "guardOk", "imported", "importedFrom", "importedAt", "pack"]) assert.ok(p.mods.every(m => !(k in m)), k);
  assert.deepEqual(p.mods.map(m => m.id), ["a", "b"]);
  assert.equal(packFilename(p), "team-tools.morse-pack.json");
  // Sharing an installed pack again keeps its id (so it stays the same pack).
  assert.equal(makePack([mod("a")], { name: "Team", id: "team-x1" }).id, "team-x1");
});

test("making a pack needs a name and at least one mod, at most 50, and never Your style", () => {
  assert.throws(() => makePack([mod("a")], { name: "  " }), /Give the pack a name/);
  assert.throws(() => makePack([], { name: "x" }), /at least one mod/);
  assert.throws(() => makePack(Array.from({ length: MAX_PACK_MODS + 1 }, (_, i) => mod(`m${i}`)), { name: "x" }), /up to 50/);
  assert.throws(() => makePack([mod("morse-style", { kind: "style" })], { name: "x" }), /Your style can't go in a pack/);
});

test("a pack link uses the #m= scheme, reads back as the same pack, and a big pack is shared as a file", async () => {
  const p = makePack([mod("a"), mod("b")], { name: "Team" });
  const link = await encodePackLink(p);
  assert.equal(new URL(link).origin + new URL(link).pathname, SHARE_BASE);
  assert.match(link, /#m=[\w-]+$/);
  const back = await decodePackLink(link);
  assert.equal(await packHash(back.pack), await packHash(p));
  const r = await parseImport(link);
  assert.equal(r.kind, "pack");
  assert.equal(r.pack.name, "Team");
  assert.equal((await parseImport(JSON.stringify(p))).kind, "pack", "a pack file too");
  // Random code doesn't compress: past the link limit, a file it is.
  const noise = () => Array.from({ length: 12000 }, () => Math.random().toString(36).slice(2)).join("");
  const big = makePack([mod("a", { js: noise() }), mod("b", { js: noise() })], { name: "Big" });
  await assert.rejects(encodePackLink(big), /too big for a link\. Share it as a file/);
  assert.ok(MAX_PACK_LINK >= 50_000);
});

// ---- hostile packs

test("hostile: a huge pack is refused before it is read", async () => {
  const huge = JSON.stringify(pack([mod("a", { css: "x".repeat(MAX_PACK_BYTES) })]));
  assert.throws(() => parsePack(huge), /too big.*up to 2 MB/);
  await assert.rejects(parseImport(huge), /too big/);
  // A link that inflates past the cap stops while inflating (core/mod.js).
  const bomb = await encodeShareText(JSON.stringify(pack([mod("a", { css: " ".repeat(6_000_000) })])));
  assert.ok(bomb.length < 100_000, "a small link…");
  await assert.rejects(parseImport(bomb), /too big/);
});

test("hostile: malformed packs say what's wrong in plain words", () => {
  assert.throws(() => parsePack("{not json"), /isn't a Morse pack/);
  assert.throws(() => parsePack(JSON.stringify({ morse: 1, id: "a" })), /isn't a Morse pack/);
  assert.throws(() => parsePack(JSON.stringify(pack("nope"))), /no mods/);
  assert.throws(() => parsePack(JSON.stringify(pack([]))), /no mods/);
  assert.throws(() => parsePack(JSON.stringify(pack([{ morse: 1 }, null, 7]))), /isn't a Morse mod|incomplete/);
  // A bad mod among good ones is left out, and said so.
  const r = parsePack(pack([mod("a"), { morse: 1, id: "../../etc", title: "x", prompt: "x", css: "", js: "", match: { hosts: ["x"] } }, mod("c", { match: { hosts: [] } })]));
  assert.deepEqual(r.pack.mods.map(m => m.id), ["a"]);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /^Mod 2: .*invalid id/);
  assert.match(r.errors[1], /^Mod 3: .*doesn't say where it runs/);
  // A broken pack id: one made from the name instead.
  assert.equal(parsePack(pack([mod("a")], { id: "<script>" })).pack.id, "team");
});

test("hostile: too many mods are refused as a whole", () => {
  const many = pack(Array.from({ length: MAX_PACK_MODS + 1 }, (_, i) => mod(`m${i}`)));
  assert.throws(() => parsePack(many), /51 mods\. Morse installs up to 50 from one pack/);
  assert.equal(parsePack(pack(Array.from({ length: MAX_PACK_MODS }, (_, i) => mod(`m${i}`)))).pack.mods.length, 50);
});

test("hostile: duplicate ids in one pack: the first is kept, the rest left out", () => {
  const r = parsePack(pack([mod("a", { title: "first" }), mod("a", { title: "second" }), mod("b")]));
  assert.deepEqual(r.pack.mods.map(m => [m.id, m.title]), [["a", "first"], ["b", "Mod b"]]);
  assert.match(r.errors[0], /Mod 2: It has the same id as another mod in this pack \(a\)/);
});

test("hostile: script in names stays text; line breaks and direction tricks are taken out", () => {
  const name = "<img src=x onerror=alert(1)>‮gnp.exe\nsecond line\u0000";
  const r = parsePack(pack([mod("a", { title: "<script>alert(1)</script>\r\nx", author: "<b>me</b>⁦" })], { name, note: "a b" }));
  assert.equal(r.pack.name, "<img src=x onerror=alert(1)> gnp.exe second line");
  assert.equal(r.pack.note, "a b");
  assert.equal(r.pack.mods[0].title, "<script>alert(1)</script> x");
  assert.equal(r.pack.mods[0].author, "<b>me</b>");
  assert.equal(cleanText("x".repeat(500), 80).length, 80);
});

test("hostile: History, on/off and where it came from never come in with a pack", () => {
  const r = parsePack(pack([mod("a", {
    history: [{ css: "body { display: none }", js: "", prompt: "old" }], enabled: false, imported: true, importedFrom: "backup",
    pack: { id: "someone-else", name: "x", mod: "zzz" }, fp: { x: 1 }, kind: "weird", refined: "fine",
  })]));
  const m = r.pack.mods[0];
  for (const k of ["history", "enabled", "imported", "importedFrom", "pack", "fp", "kind"]) assert.ok(!(k in m), k);
  const saved = planInstall(r.pack, [{ id: "a" }], []).put[0];
  assert.equal(saved.history, undefined);
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.pack.id, "team");
});

test("hostile: a mod can't arrive as Your style or a part of it", () => {
  const r = parsePack(pack([mod("a"), mod("morse-style", { kind: "style", match: { hosts: ["*"] } }), mod("b", { parent: "morse-style" })]));
  assert.deepEqual(r.pack.mods.map(m => m.id), ["a"]);
  assert.match(r.errors.join(" "), /Your style can't come in a pack/);
});

test("hostile: mods for every website (or every .com) are flagged; app mods aren't", () => {
  assert.equal(isWide(mod("a", { match: { hosts: ["*"], app: null } })), true);
  assert.equal(isWide(mod("a", { match: { hosts: ["*.com"], app: null } })), true);
  assert.equal(isWide(mod("a", { match: { hosts: ["*.co.uk"], app: null } })), true);
  assert.equal(isWide(mod("a", { match: { hosts: ["*.team.example"], app: null } })), false);
  assert.equal(isWide(mod("a", { match: { hosts: ["*"], app: "slack" } })), false);
});

// ---- installing

test("an id that clashes with one of your mods: never overwritten without a choice", () => {
  const p = parsePack(pack([mod("a"), mod("b")])).pack;
  const mine = [mod("b", { title: "My b" })];
  assert.deepEqual(clashesFor(p, mine), { b: { kind: "clash", id: "b", title: "My b" } });
  assert.throws(() => planInstall(p, [{ id: "a" }, { id: "b" }], mine), /already have this mod \(b, “My b”\)\. Choose Keep both or Replace yours/);
  const both = planInstall(p, [{ id: "a" }, { id: "b", as: "copy" }], mine).put;
  assert.deepEqual(both.map(m => m.id), ["a", "b-2"]);
  assert.equal(both[1].pack.mod, "b", "remembers which mod of the pack it is");
  const replaced = planInstall(p, [{ id: "b", as: "replace" }], mine).put;
  assert.deepEqual(replaced.map(m => [m.id, m.title]), [["b", "Mod b"]]);
  // Copies never take an id that's in use.
  assert.equal(planInstall(p, [{ id: "b", as: "copy" }], [mod("b"), mod("b-2")]).put[0].id, "b-3");
});

test("installing marks each mod with its pack; unticked or unknown ids are left out", () => {
  const p = parsePack(pack([mod("a"), mod("b"), mod("c")], { name: "Team tools" })).pack;
  const { put } = planInstall(p, [{ id: "a" }, { id: "c" }, { id: "zzz" }], [], { now: new Date("2026-05-05T00:00:00Z") });
  assert.deepEqual(put.map(m => m.id), ["a", "c"]);
  assert.deepEqual(put[0].pack, { id: "team", name: "Team tools", mod: "a", at: "2026-05-05T00:00:00.000Z" });
  assert.equal(put[0].importedFrom, "pack");
  assert.equal(put[0].imported, true);
  assert.equal(modOrigin(put[0]), "From the pack “Team tools” on May 5");
  assert.throws(() => planInstall(p, [], []), /Tick at least one mod/);
  assert.deepEqual(packGroups(put), [{ id: "team", name: "Team tools", count: 2, on: 2, url: "" }]);
});

test("hostile: a single shared mod can't claim to be part of one of your packs, and its link never carries the pack's address", async () => {
  const { prepareInstall } = await import("../core/backup.js");
  const { stripLocal } = await import("../core/mod.js");
  const { forGallery } = await import("../core/gallery.js");
  const spoof = mod("x", { pack: { id: "team", name: "Team tools", mod: "x", url: "https://raw.example/private/pack.json" } });
  assert.equal(prepareInstall(spoof, { kind: "link" }).pack, undefined);
  assert.equal(prepareInstall(spoof, { kind: "mod" }).pack, undefined);
  assert.ok(prepareInstall(spoof, { kind: "backup" }).pack, "your own backup keeps it");
  assert.equal(stripLocal(spoof).pack, undefined);
  assert.equal(forGallery(spoof).pack, undefined);
  const r = await parseImport(await (await import("../core/mod.js")).encodeShare(spoof));
  assert.equal(r.mods[0].pack, undefined);
});

test("installing the same pack again updates your copies from it, old versions in History", () => {
  const p = parsePack(pack([mod("a")])).pack;
  const first = planInstall(p, [{ id: "a" }], []).put;
  const p2 = parsePack(pack([mod("a", { css: ".a { color: blue; }" })])).pack;
  assert.equal(clashesFor(p2, first).a.kind, "update");
  const again = planInstall(p2, [{ id: "a" }], first).put[0];
  assert.equal(again.id, "a");
  assert.equal(again.css, ".a { color: blue; }");
  assert.equal(again.history.at(-1).css, ".a { color: red; }");
});

// ---- updates

test("what changed: new, removed and changed mods, and where a mod would newly run", () => {
  const v1 = parsePack(pack([mod("a"), mod("b"), mod("c")])).pack;
  const installed = [...planInstall(v1, [{ id: "a" }, { id: "b" }, { id: "c" }], []).put, mod("mine")];
  const v2 = parsePack(pack([
    mod("a"),
    mod("b", { js: "fetch('https://x.example')", match: { hosts: ["team.example", "*"], app: null } }),
    mod("d"),
  ])).pack;
  const d = diffPack(installed, v2);
  assert.deepEqual(d.added.map(m => m.id), ["d"]);
  assert.deepEqual(d.removed.map(m => m.id), ["c"]);
  assert.deepEqual(d.changed.map(c => c.after.id), ["b"]);
  assert.equal(d.changed[0].match, true);
  assert.deepEqual(d.changed[0].wider, ["*"]);
  assert.equal(d.same, 1);
  // Take the new one and the change; keep the removed one as your own.
  const plan = planUpdate(installed, v2, { add: ["d"], change: ["b"], remove: [] });
  const by = id => plan.put.find(m => m.id === id);
  assert.equal(by("b").js, "fetch('https://x.example')");
  assert.equal(by("b").history.at(-1).js, "", "your version is in History");
  assert.ok(by("d").pack);
  assert.equal(by("c").pack, undefined, "kept as your own");
  assert.deepEqual(plan.remove, []);
  // Nothing ticked: nothing changes but the removed mod leaving the pack.
  const none = planUpdate(installed, v2, {});
  assert.deepEqual(none.put.map(m => m.id), ["c"]);
  assert.deepEqual(planUpdate(installed, v2, { remove: ["c"] }).remove, ["c"]);
});

test("a new mod in an update with the id of one of yours is added beside it, never over it", () => {
  const v1 = parsePack(pack([mod("a")])).pack;
  const installed = [...planInstall(v1, [{ id: "a" }], []).put, mod("b", { title: "mine" })];
  const v2 = parsePack(pack([mod("a"), mod("b")])).pack;
  const plan = planUpdate(installed, v2, { add: ["b"] });
  assert.deepEqual(plan.put.map(m => m.id), ["b-2"]);
});

// ---- the address

test("a pack that updates comes from https only (or this computer, for making one)", () => {
  assert.equal(checkPackUrl("https://raw.githubusercontent.com/team/repo/main/pack.json#x"), "https://raw.githubusercontent.com/team/repo/main/pack.json");
  assert.ok(checkPackUrl("http://127.0.0.1:8080/p.json"));
  assert.ok(checkPackUrl("http://localhost:8080/p.json"));
  for (const bad of ["http://team.example/p.json", "ftp://team.example/p.json", "file:///etc/passwd", "javascript:alert(1)", "data:application/json,{}", "http://127.0.0.1.evil.example/p.json"]) {
    assert.throws(() => checkPackUrl(bad), /https:\/\/ address|isn't a web address/, bad);
  }
  assert.throws(() => checkPackUrl("https://me:secret@team.example/p.json"), /name and password/);
  assert.throws(() => checkPackUrl("not a url"), /isn't a web address/);
  assert.equal(isPackAddress("https://team.example/p.json"), true);
  assert.equal(isPackAddress("https://x/install.html#m=abc"), false);
  assert.equal(isPackAddress("{\"morse\":1}"), false);
});

// ---- the host: fetch, cache, install what the review showed

function memory() {
  const data = {}, mods = {};
  return {
    data, mods,
    store: { get: async k => structuredClone(data[k]), set: async (k, v) => { data[k] = structuredClone(v); } },
    modsApi: { list: async () => Object.values(structuredClone(mods)), put: async l => { for (const m of l) mods[m.id] = structuredClone(m); }, remove: async ids => { for (const id of ids) delete mods[id]; } },
  };
}
// A fake network: url -> () => Response
function net(routes) {
  const calls = [];
  return {
    calls,
    fetch: async (url, opts = {}) => {
      calls.push({ url, headers: opts.headers || {} });
      const r = routes[url];
      if (!r) throw new TypeError("Failed to fetch");
      return r(opts);
    },
  };
}
const json = (body, headers = {}) => () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
const ADDR = "https://raw.example/team/pack.json";

test("host: install checks the hash the review showed, and the clash choices", async () => {
  const m = memory();
  m.mods.b = mod("b", { title: "Mine" });
  const packs = createPacks({ store: m.store, mods: m.modsApi, fetch: net({}).fetch });
  const source = JSON.stringify(pack([mod("a"), mod("b")]));
  const ctl = controlHandler({ load: async () => ({}), save: async () => {}, listMods: m.modsApi.list, putMods: m.modsApi.put });
  const preview = await ctl({ type: "mods.preview", source, url: "https://team.example/" });
  assert.equal(preview.kind, "pack");
  assert.match(preview.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(preview.clash, { b: { kind: "clash", id: "b", title: "Mine" } });
  await assert.rejects(packs.install({ source, hash: "0".repeat(64), picks: [{ id: "a" }] }), /changed while you were looking/);
  await assert.rejects(packs.install({ source, hash: preview.hash, picks: [{ id: "b" }] }), /Choose Keep both or Replace yours/);
  const r = await packs.install({ source, hash: preview.hash, picks: [{ id: "a" }, { id: "b", as: "copy" }] });
  assert.deepEqual(r.saved.map(x => x.id), ["a", "b-2"]);
  assert.equal(m.mods.b.title, "Mine");
  assert.deepEqual(m.data.subs, undefined, "no updates unless asked for");
  await assert.rejects(packs.install({ source: JSON.stringify(mod("x")), hash: preview.hash, picks: [] }), /isn't a Morse pack/);
});

test("host: a pack from an address; updates only when asked for; checked at most once a day with ETag; offline keeps the old copy", async () => {
  const m = memory();
  let now = 1_800_000_000_000;
  let body = pack([mod("a"), mod("b")]), etag = '"v1"', down = false;
  const routes = {
    [ADDR]: opts => {
      if (down) throw new TypeError("Failed to fetch");
      if (opts.headers?.["If-None-Match"] === etag) return new Response(null, { status: 304, headers: { etag } });
      return json(body, { etag, "cache-control": "max-age=60" })();
    },
  };
  const n = net(routes);
  const packs = createPacks({ store: m.store, mods: m.modsApi, fetch: n.fetch, now: () => now });
  const p = await packs.fetchAddress(ADDR);
  assert.equal(p.url, ADDR);
  assert.equal(p.subscribed, false);
  await packs.install({ source: p.source, hash: p.hash, picks: [{ id: "a" }], url: ADDR, subscribe: true });
  assert.equal(m.mods.a.pack.url, ADDR);
  assert.deepEqual(m.data.subs[ADDR].declined, ["b"], "what you unticked is remembered");
  n.calls.length = 0;
  let s = await packs.status();
  assert.equal(n.calls.length, 0, "not checked again the same day");
  assert.equal(s[0].update, null);

  // A day later, unchanged: a conditional request, 304, no update.
  now += DAY + 1;
  s = await packs.status();
  assert.equal(n.calls.length, 1);
  assert.equal(s[0].update, null);
  // (the first check after subscribing has no ETag yet; the next one does)
  now += DAY + 1;
  await packs.status();
  assert.equal(n.calls.at(-1).headers["If-None-Match"], '"v1"');

  // The team changes the pack.
  body = pack([mod("a", { css: ".a { color: green; }" }), mod("b"), mod("c")]);
  etag = '"v2"';
  now += DAY + 1;
  s = await packs.status();
  assert.deepEqual(s[0].update.changed.map(c => c.after.id), ["a"]);
  assert.deepEqual(s[0].update.added.map(x => x.id), ["b", "c"]);
  assert.deepEqual(s[0].declined, ["b"]);
  assert.deepEqual(s[0].update.fresh, ["c"], "what you left out before isn't news");
  assert.equal(m.mods.a.css, ".a { color: red; }", "nothing changes on its own");

  // Offline: the copy Morse has stays, and the update is still there to review.
  down = true;
  now += DAY + 1;
  s = await packs.status();
  assert.equal(s[0].offline, true);
  assert.match(s[0].error, /Couldn't reach/);
  assert.ok(s[0].update, "the old copy is kept");
  const calls = n.calls.length;
  now += 10 * 60 * 1000;
  await packs.status();
  assert.equal(n.calls.length, calls, "waits an hour before trying again");

  // Update: only what was ticked, after checking the hash.
  await assert.rejects(packs.update({ url: ADDR, hash: "nope", picks: {} }), /changed while you were looking/);
  await packs.update({ url: ADDR, hash: s[0].hash, picks: { change: ["a"], add: ["c"] } });
  assert.equal(m.mods.a.css, ".a { color: green; }");
  assert.ok(m.mods.c);
  assert.equal(m.mods.b, undefined);
  assert.deepEqual(m.data.subs[ADDR].declined, ["b"]);
  s = await packs.status();
  assert.equal(s[0].update, null, "reviewed");
  // A new copy that only has the mod you left out again: no update to show.
  body = pack([mod("a", { css: ".a { color: green; }" }), mod("b"), mod("c")], { note: "same mods, new note" });
  etag = '"v3"';
  down = false;
  now += DAY + 1;
  s = await packs.status();
  assert.equal(s[0].update, null, "only what you left out before: nothing new");

  // Stop updates: the mods stay.
  assert.equal(await packs.unsubscribe({ url: ADDR }), 1);
  assert.deepEqual(await packs.status(), []);
  assert.ok(m.mods.a);
  await assert.rejects(packs.update({ url: ADDR, hash: s[0]?.hash || "x" }), /don't get updates/);
});

test("host: a server can't pin a pack with a huge max-age, or swap in another pack", async () => {
  const m = memory();
  let now = 1_800_000_000_000, body = pack([mod("a")]);
  const n = net({ [ADDR]: () => json(body, { "cache-control": "max-age=999999999" })() });
  const packs = createPacks({ store: m.store, mods: m.modsApi, fetch: n.fetch, now: () => now });
  const p = await packs.fetchAddress(ADDR);
  await packs.install({ source: p.source, hash: p.hash, picks: [{ id: "a" }], url: ADDR, subscribe: true });
  now += DAY + 1;
  await packs.status(); // learns the max-age
  const calls = n.calls.length;
  now += 3 * DAY;
  await packs.status();
  assert.equal(n.calls.length, calls, "a long max-age is honoured for a while");
  now += 5 * DAY;
  body = pack([mod("evil", { match: { hosts: ["*"], app: null } })], { id: "someone-else" });
  const s = await packs.status();
  assert.equal(n.calls.length, calls + 1, "but checked again within a week");
  assert.match(s[0].error, /different pack now/);
  assert.equal(s[0].update, null);
});

test("host: huge, endless or redirected answers are refused while reading", async () => {
  const m = memory();
  let pulled = 0;
  const endless = () => new Response(new ReadableStream({ pull(c) { if (pulled > 64e6) return c.close(); pulled += 1e6; c.enqueue(new Uint8Array(1e6).fill(32)); } }), { status: 200 });
  const redirected = () => { const r = json(pack([mod("a")]))(); Object.defineProperty(r, "url", { value: "http://evil.example/p.json" }); return r; };
  const n = net({ [ADDR]: endless, "https://r.example/p.json": redirected, "https://e.example/p.json": () => new Response("nope", { status: 404 }) });
  const packs = createPacks({ store: m.store, mods: m.modsApi, fetch: n.fetch });
  await assert.rejects(packs.fetchAddress(ADDR), /too big/);
  assert.ok(pulled <= 4e6, `stopped early (read ${pulled} bytes)`);
  await assert.rejects(packs.fetchAddress("https://r.example/p.json"), /https:\/\/ address/);
  await assert.rejects(packs.fetchAddress("https://e.example/p.json"), /error 404/);
  await assert.rejects(packs.fetchAddress("http://team.example/p.json"), /https:\/\/ address/);
  await assert.rejects(packs.fetchAddress("https://down.example/p.json"), /Couldn't reach/);
  assert.equal(n.calls.filter(c => c.url.startsWith("http://team")).length, 0, "an http address is never fetched");
});

test("host: share a pack as a link, a file or text; the pack's switch; re-sharing an installed pack", async () => {
  const m = memory();
  m.mods.a = mod("a");
  m.mods.b = mod("b");
  const files = [];
  const packs = createPacks({ store: m.store, mods: m.modsApi, fetch: net({}).fetch, writeFile: async (f, t) => (files.push([f, t]), { path: `/tmp/${f}` }) });
  const link = await packs.share({ ids: ["a", "b"], name: "Team", note: "hi", kind: "link" });
  assert.match(link.link, /#m=/);
  assert.equal(link.count, 2);
  const file = await packs.share({ ids: ["a"], name: "Team", kind: "file" });
  assert.equal(file.path, "/tmp/team.morse-pack.json");
  assert.equal(JSON.parse(files[0][1]).mods.length, 1);
  await assert.rejects(packs.share({ ids: ["a", "gone"], name: "Team" }), /aren't saved anymore/);
  // Install it, then the pack's switch, then share the installed pack again.
  for (const k of Object.keys(m.mods)) delete m.mods[k]; // on another computer
  const r = await parseImport(link.link);
  const prev = await controlHandler({ load: async () => ({}), save: async () => {}, listMods: m.modsApi.list, putMods: m.modsApi.put })({ type: "mods.preview", source: link.link });
  await packs.install({ source: link.link, hash: prev.hash, picks: [{ id: "a" }, { id: "b" }] });
  assert.equal(r.pack.id, Object.values(m.mods)[0].pack.id);
  assert.deepEqual(await packs.enable({ pack: r.pack.id, on: false }), { count: 2, changed: 2 });
  assert.ok(Object.values(m.mods).every(x => x.enabled === false));
  const again = await packs.share({ pack: r.pack.id, kind: "json" });
  assert.equal(again.pack.id, r.pack.id, "the same pack");
  assert.equal(again.pack.name, "Team");
  const listed = await packs.list();
  assert.deepEqual(listed.packs.map(g => [g.name, g.count, g.on]), [["Team", 2, 0]]);
});
