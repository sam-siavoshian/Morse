// Mods for this site: the gallery list (parsing, matching, versions, when to
// fetch again, broken lists), the host's fetch-and-cache flow with a fake
// network, update diffs and the "Submit to the gallery" link.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import {
  parseIndex, matchEntries, indexUrlFor, modUrl, GALLERY_INDEX_URL, DEMO_INDEX_URL, normVersion, compareVersions,
  galleryIdOf, installedVersion, updateFor, maxAgeOf, needsFetch, conditionalHeaders, afterResponse, afterFailure,
  DAY, RETRY_AFTER, briefSummary, needsCarefulLook, lineDiff, trimDiff, whatChanged, submitIssue, forGallery, SUBMIT_MAX_URL,
} from "../core/gallery.js";
import { createGallery } from "../core/gallery-host.js";
import { modMatches, validateMod, SHARE_BASE } from "../core/mod.js";
import { normalizePrefs, mergePrefs } from "../core/prefs.js";
import { modOrigin } from "../core/summary.js";

const SITE = new URL("../site/mods/", import.meta.url);
const realIndex = () => readFileSync(new URL("index.json", SITE), "utf8");
const entry = (over = {}) => ({ file: "x-thing.morse.json", title: "Thing", prompt: "do the thing", match: { hosts: ["www.example.com"], app: null }, ...over });

// ---- the list

test("the gallery list in the repo parses, and every entry has a matching mod file", () => {
  const { entries, skipped } = parseIndex(realIndex());
  assert.equal(skipped, 0);
  assert.ok(entries.length >= 40);
  for (const e of entries) {
    const mod = validateMod(JSON.parse(readFileSync(new URL(e.file, SITE), "utf8")));
    assert.equal(mod.id, e.id, `${e.file}: id`);
    assert.deepEqual(mod.match, e.match, `${e.file}: match`);
    assert.equal(compareVersions(mod.version ?? 1, e.version), 0, `${e.file}: version`);
  }
  // The demo-site mods (for `node demo/serve.js`) are in the list, flagged,
  // and match a demo app's own address.
  const demo = entries.filter(e => e.demo);
  assert.ok(demo.length >= 15);
  for (const e of demo) assert.match(e.match.hosts.join(), /^127\.0\.0\.1:87(8[7-9]|9[0-7])$/, e.id);
});

// What the gallery page and Morse show about each mod must be true of the mod.
test("every gallery entry is a proper one: tight match, plain title, the right badges", () => {
  const raw = JSON.parse(realIndex());
  const CATS = ["Reading", "Dark mode", "Declutter", "Layout", "Keyboard", "New features"];
  for (const e of raw) {
    const mod = JSON.parse(readFileSync(new URL(e.file, SITE), "utf8"));
    const id = e.file;
    assert.equal(e.author, "Morse team", `${id}: author`);
    assert.equal(mod.author, "Morse team", `${id}: author in the mod file`);
    assert.equal(e.title, mod.title, `${id}: title`);
    assert.equal(e.prompt, mod.prompt, `${id}: the request as written`);
    assert.ok(e.match.hosts.length && e.match.hosts.every(h => h && !h.includes("*")), `${id}: exact hosts, no wildcards`);
    assert.ok(CATS.includes(e.category), `${id}: category ${e.category}`);
    // "Works without Allow User Scripts" only when there is no code to run.
    assert.equal(e.userScripts, !!mod.js.trim(), `${id}: userScripts`);
    assert.match(e.title, /^[A-Z][\w ,'’“”.-]+$/, `${id}: a plain title`);
    assert.doesNotMatch(`${e.title} ${e.prompt}`, /\b(CSS|JS|JavaScript|DOM|selector|element|script)\b/i, `${id}: no jargon`);
    if (e.shots) for (const f of [e.shots.before, e.shots.after]) assert.ok(statSync(new URL(f, SITE)).size > 10_000, `${id}: ${f}`);
    if (e.checked) assert.match(e.checked, /^\w{3} \d{1,2}, \d{4}, on the (real site|demo app): it works, and still works after a reload\./, id);
  }
  assert.equal(raw.filter(e => e.shots).length, 8, "before and after pictures for the 8 best");
  assert.ok(raw.filter(e => e.checked).length >= 30);
});

test("the default list is on the same site as share links", () => {
  assert.equal(GALLERY_INDEX_URL, new URL("../site/mods/index.json", SHARE_BASE).href);
});

test("a broken list throws a plain error; broken entries are skipped", () => {
  assert.throws(() => parseIndex("{not json"), /gallery list isn't readable/);
  assert.throws(() => parseIndex(JSON.stringify({ hello: 1 })), /isn't readable/);
  assert.throws(() => parseIndex("null"), /isn't readable/);
  assert.deepEqual(parseIndex("[]"), { entries: [], skipped: 0 });
  const { entries, skipped } = parseIndex({ mods: [
    entry(),
    entry(), // same id again
    entry({ file: "../escape.morse.json" }),
    entry({ file: "https://evil.example/x.morse.json" }),
    entry({ file: "sub/dir.morse.json" }),
    entry({ file: "plain.json" }),
    entry({ file: "no-title.morse.json", title: "" }),
    entry({ file: "no-match.morse.json", match: undefined }),
    entry({ file: "everywhere.morse.json", match: { hosts: ["*"] } }),
    entry({ file: "bad-host.morse.json", match: { hosts: ["exa mple.com"] } }),
    entry({ file: "bad-id.morse.json", id: "has spaces" }),
    "a string", null, 42, [],
    entry({ file: "ok-two.morse.json", version: "1.2", tags: ["a", 3, "b"], title: "  Spaced   out  " }),
  ] });
  assert.deepEqual(entries.map(e => e.id), ["x-thing", "ok-two"]);
  assert.equal(skipped, 14);
  assert.equal(entries[1].version, "1.2");
  assert.deepEqual(entries[1].tags, ["a", "b"]);
  assert.equal(entries[1].title, "Spaced out");
  assert.equal(entries[0].version, 1, "no version means version 1");
});

test("matching uses the same host and app rules as saved mods", () => {
  const { entries } = parseIndex([
    entry({ file: "yt.morse.json", match: { hosts: ["www.youtube.com"], app: null } }),
    entry({ file: "sub.morse.json", match: { hosts: ["*.example.com"], app: null } }),
    entry({ file: "spotify.morse.json", match: { hosts: ["xpui.app.spotify.com"], app: "spotify" } }),
    entry({ file: "tunes.morse.json", match: { hosts: ["127.0.0.1:8789"], app: null } }),
  ]);
  const ids = where => matchEntries(entries, where, modMatches).map(e => e.id);
  assert.deepEqual(ids({ url: "https://www.youtube.com/watch?v=1", app: null }), ["yt"]);
  assert.deepEqual(ids({ url: "https://youtube.com/", app: null }), []);
  assert.deepEqual(ids({ url: "https://docs.example.com/a", app: null }), ["sub"]);
  assert.deepEqual(ids({ url: "https://xpui.app.spotify.com/index.html", app: "spotify" }), ["spotify"]);
  assert.deepEqual(ids({ url: "https://xpui.app.spotify.com/index.html", app: null }), [], "a desktop-app mod isn't offered on the website");
  assert.deepEqual(ids({ url: "http://127.0.0.1:8789/demo/sites/tunes/", app: null }), ["tunes"]);
  assert.deepEqual(ids({ url: "not a url", app: null }), []);
  // A web mod also shows in a desktop app on the same host (as saved mods do).
  assert.deepEqual(ids({ url: "https://www.youtube.com/", app: "someapp" }), ["yt"]);
});

test("which list a page reads", () => {
  assert.equal(indexUrlFor("https://www.youtube.com/"), GALLERY_INDEX_URL);
  // The demo sites' local list, where the host asks for it (not the store build).
  assert.equal(indexUrlFor("http://127.0.0.1:8789/demo/sites/tunes/", "", DEMO_INDEX_URL), DEMO_INDEX_URL);
  assert.equal(indexUrlFor("http://localhost:8787/x", "", DEMO_INDEX_URL), DEMO_INDEX_URL);
  assert.equal(indexUrlFor("http://127.0.0.1:8795/demo/sites/wiki/", "", DEMO_INDEX_URL), DEMO_INDEX_URL, "every demo app in demo/serve.js");
  assert.equal(indexUrlFor("http://127.0.0.1:8798/", "", DEMO_INDEX_URL), GALLERY_INDEX_URL);
  assert.equal(indexUrlFor("http://127.0.0.1:3000/", "", DEMO_INDEX_URL), GALLERY_INDEX_URL);
  assert.equal(indexUrlFor("http://127.0.0.1:8789/demo/sites/tunes/"), GALLERY_INDEX_URL, "without it, the public list");
  assert.equal(indexUrlFor("https://www.youtube.com/", "https://me.example/list.json"), "https://me.example/list.json");
  assert.equal(indexUrlFor("https://www.youtube.com/", "javascript:alert(1)"), GALLERY_INDEX_URL);
  assert.equal(modUrl({ file: "a.morse.json" }, "https://h.example/RRAA/site/mods/index.json"), "https://h.example/RRAA/site/mods/a.morse.json");
});

// ---- versions

test("versions compare as numbers, part by part", () => {
  assert.equal(compareVersions(2, 1), 1);
  assert.equal(compareVersions("2", 2), 0);
  assert.equal(compareVersions("1.10", "1.9"), 1);
  assert.equal(compareVersions("v1.2.0", "1.2"), 0);
  assert.equal(compareVersions("1.2.1", "1.2"), 1);
  assert.equal(compareVersions(undefined, 1), 0, "missing counts as 1");
  assert.equal(compareVersions("banana", "1"), 0);
  assert.equal(compareVersions(-3, 1), 0);
  assert.equal(normVersion("7"), 7);
  assert.equal(normVersion(" v3.1 "), "3.1");
});

test("an installed mod knows where it came from and whether there's a newer one", () => {
  const entries = [{ id: "tunes-sleep-timer", version: 2, mod: { version: 2 } }, { id: "other", version: 1, mod: { version: 1 } }];
  const fromPanel = { id: "tunes-sleep-timer", imported: true, gallery: { id: "tunes-sleep-timer", version: 1 } };
  assert.equal(galleryIdOf(fromPanel), "tunes-sleep-timer");
  assert.equal(installedVersion(fromPanel), 1);
  assert.equal(updateFor(fromPanel, entries).id, "tunes-sleep-timer");
  assert.equal(updateFor({ ...fromPanel, gallery: { id: "tunes-sleep-timer", version: 2 } }, entries), null);
  // Installed with a share link from the gallery page: the mod's own id and version.
  const fromLink = { id: "tunes-sleep-timer", imported: true, version: 1 };
  assert.equal(updateFor(fromLink, entries).id, "tunes-sleep-timer");
  assert.equal(updateFor({ ...fromLink, version: 3 }, entries), null, "a newer local copy is not an update");
  // Made here: never a gallery mod, whatever its id.
  assert.equal(galleryIdOf({ id: "other" }), null);
  assert.equal(updateFor({ id: "other", version: 0 }, entries), null);
  // The Mods panel says so.
  assert.match(modOrigin({ ...fromPanel, author: "june", importedAt: "2026-10-01T10:00:00Z" }), /^Installed from the Morse gallery by june on /);
  assert.match(modOrigin(fromLink), /^Installed from a shared link/);
});

// ---- when to fetch again

test("cache rules: at most daily, longer if max-age says so, an hour after a failure", () => {
  const t = 1_800_000_000_000;
  assert.equal(needsFetch(null, t), true);
  const ok = { entries: [], fetchedAt: t, maxAge: 600 };
  assert.equal(needsFetch(ok, t + 60_000), false, "max-age of 10 minutes still waits a day");
  assert.equal(needsFetch(ok, t + DAY - 1), false);
  assert.equal(needsFetch(ok, t + DAY), true);
  assert.equal(needsFetch({ ...ok, maxAge: 2 * 86400 }, t + DAY + 1), false, "a longer max-age is honored");
  assert.equal(needsFetch({ ...ok, maxAge: 2 * 86400 }, t + 2 * DAY), true);
  assert.equal(needsFetch(ok, t - 5000), true, "the clock went back");
  const failed = afterFailure({ ...ok, fetchedAt: t - 2 * DAY }, t, new Error("offline"));
  assert.equal(failed.error, "offline");
  assert.equal(needsFetch(failed, t + RETRY_AFTER - 1), false, "offline: wait before trying again");
  assert.equal(needsFetch(failed, t + RETRY_AFTER), true);
  assert.equal(needsFetch(afterFailure(null, t), t + 1000), false, "even with nothing cached");

  assert.equal(maxAgeOf("public, max-age=600"), 600);
  assert.equal(maxAgeOf("max-age=\"90\""), 90);
  assert.equal(maxAgeOf("no-cache, max-age=600"), 0);
  assert.equal(maxAgeOf(""), 0);
  assert.equal(maxAgeOf("s-maxage=100"), 0);

  assert.deepEqual(conditionalHeaders(null), {});
  assert.deepEqual(conditionalHeaders({ entries: [], etag: "W/\"abc\"" }), { "If-None-Match": "W/\"abc\"" });
  assert.deepEqual(conditionalHeaders({ entries: [], lastModified: "Tue, 20 Oct 2026 10:00:00 GMT" }), { "If-Modified-Since": "Tue, 20 Oct 2026 10:00:00 GMT" });
  assert.deepEqual(conditionalHeaders({ etag: "x" }), {}, "no list cached: ask for the whole thing");
});

test("responses: 200 replaces, 304 keeps the list, a broken list keeps the old one", () => {
  const t = 1_800_000_000_000;
  const body = JSON.stringify([entry()]);
  const first = afterResponse(null, { status: 200, etag: "\"v1\"", cacheControl: "max-age=600", body }, t);
  assert.equal(first.entries.length, 1);
  assert.equal(first.etag, "\"v1\"");
  assert.equal(first.maxAge, 600);
  assert.equal(first.fetchedAt, t);
  const same = afterResponse(first, { status: 304, cacheControl: "max-age=60" }, t + DAY);
  assert.equal(same.entries, first.entries);
  assert.equal(same.fetchedAt, t + DAY);
  assert.equal(same.maxAge, 60);
  const broken = afterResponse(first, { status: 200, body: "<html>Not found</html>" }, t + DAY);
  assert.equal(broken.entries, first.entries, "a broken list never wipes the good one");
  assert.equal(broken.failedAt, t + DAY);
  assert.match(broken.error, /isn't readable/);
  const down = afterResponse(first, { status: 503, body: "" }, t + DAY);
  assert.equal(down.entries.length, 1);
  assert.match(down.error, /error 503/);
  const bare304 = afterResponse(null, { status: 304 }, t);
  assert.deepEqual(bare304.entries, []);
  assert.ok(bare304.failedAt);
});

// ---- the host's fetch-and-cache flow

function fakeNet(files) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    if (fetch.offline) throw new TypeError("Failed to fetch");
    const f = files[url];
    if (!f) return new Response("not found", { status: 404 });
    if (f.etag && opts.headers?.["If-None-Match"] === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } });
    return new Response(typeof f.body === "string" ? f.body : JSON.stringify(f.body), { status: 200, headers: { etag: f.etag || "", "cache-control": "max-age=600" } });
  };
  return { fetch, calls };
}
function memStore() {
  const data = {};
  return { data, get: async k => structuredClone(data[k]), set: async (k, v) => { data[k] = structuredClone(v); } };
}
const IDX = "https://g.example/site/mods/index.json";
const sleepV1 = { morse: 1, id: "sleep", title: "Sleep timer", prompt: "add a sleep timer", match: { hosts: ["tunes.example"], app: null }, css: ".a{}", js: "morse.every(1000, () => {});", version: 1 };

test("the host fetches once a day, revalidates with the ETag, and works offline", async () => {
  let now = 1_800_000_000_000;
  const files = {
    [IDX]: { etag: "\"i1\"", body: [{ file: "sleep.morse.json", title: "Sleep timer", prompt: "add a sleep timer", author: "june", match: sleepV1.match, version: 1 },
      { file: "other.morse.json", title: "Other", prompt: "other site", match: { hosts: ["else.example"], app: null } }] },
    "https://g.example/site/mods/sleep.morse.json": { body: sleepV1 },
  };
  const net = fakeNet(files), store = memStore();
  const g = createGallery({ store, fetch: net.fetch, now: () => now, configured: async () => IDX });
  const page = { url: "https://tunes.example/home", app: null };

  let r = await g.list(page);
  assert.equal(r.on, true);
  assert.equal(r.site, "tunes.example");
  assert.deepEqual(r.items.map(e => [e.id, e.author, e.mod.css]), [["sleep", "june", ".a{}"]]);
  assert.deepEqual(r.items[0].summary, ["Changes how the page looks", "Keeps running while the page is open"]);
  assert.equal(net.calls.length, 2, "the list, then only the mod file this page needs");

  now += 60 * 60 * 1000;
  r = await g.list(page);
  assert.equal(r.items.length, 1);
  assert.equal(net.calls.length, 2, "an hour later: all from the cache");

  now += DAY;
  r = await g.list(page);
  assert.equal(net.calls.length, 3, "a day later: the list is checked again");
  assert.equal(net.calls[2].headers["If-None-Match"], "\"i1\"");
  assert.equal(r.items.length, 1, "304: same list, mod file still cached");

  // Version 2 is published.
  files[IDX] = { etag: "\"i2\"", body: [{ ...files[IDX].body[0], version: 2, changes: "Shows the time left" }] };
  files["https://g.example/site/mods/sleep.morse.json"] = { body: { ...sleepV1, version: 2, css: ".a{color:red}" } };
  now += DAY;
  r = await g.list(page);
  assert.equal(r.items[0].version, 2);
  assert.equal(r.items[0].changes, "Shows the time left");
  assert.equal(r.items[0].mod.css, ".a{color:red}", "the newer mod file is fetched");

  // Offline: the cached list and files keep working, and the host waits an hour.
  net.fetch.offline = true;
  now += 2 * DAY;
  const before = net.calls.length;
  r = await g.list(page);
  assert.equal(r.items.length, 1);
  assert.equal(r.offline, true);
  await g.list(page);
  assert.equal(net.calls.length, before + 1, "one try, then it waits");

  // Concurrent asks share one fetch.
  net.fetch.offline = false;
  now += 2 * DAY;
  const n = net.calls.length;
  await Promise.all([g.list(page), g.list(page), g.list(page)]);
  assert.equal(net.calls.length, n + 1);
});

test("the host fetches nothing when Show mods others made is off, and copes with no network at all", async () => {
  const net = fakeNet({});
  let on = false;
  const g = createGallery({ store: memStore(), fetch: net.fetch, enabled: async () => on, configured: async () => IDX });
  assert.deepEqual(await g.list({ url: "https://tunes.example/", app: null }), { on: false, items: [] });
  assert.equal(net.calls.length, 0);
  on = true;
  net.fetch.offline = true;
  const r = await g.list({ url: "https://tunes.example/", app: null });
  assert.deepEqual(r.items, []);
  assert.equal(r.offline, true);
});

test("the host skips mod files that are broken or for another mod", async () => {
  const net = fakeNet({
    [IDX]: { body: [
      { file: "wrong-id.morse.json", title: "A", prompt: "a", match: sleepV1.match },
      { file: "broken.morse.json", title: "B", prompt: "b", match: sleepV1.match },
      { file: "missing.morse.json", title: "C", prompt: "c", match: sleepV1.match },
      { file: "good.morse.json", title: "D", prompt: "d", match: sleepV1.match },
    ] },
    "https://g.example/site/mods/wrong-id.morse.json": { body: { ...sleepV1, id: "something-else" } },
    "https://g.example/site/mods/broken.morse.json": { body: "{ nope" },
    "https://g.example/site/mods/good.morse.json": { body: { ...sleepV1, id: "good", match: { hosts: ["*"], app: null } } },
  });
  const g = createGallery({ store: memStore(), fetch: net.fetch, configured: async () => IDX });
  const r = await g.list({ url: "https://tunes.example/", app: null });
  assert.deepEqual(r.items.map(e => e.id), ["good"]);
  assert.deepEqual(r.items[0].mod.match, sleepV1.match, "the list decides where a gallery mod runs");
});

// ---- what a mod does, what changed

test("a short summary of what a mod does", () => {
  assert.deepEqual(briefSummary({ css: "a { display: none }", js: "" }), ["Changes how the page looks", "Hides parts of the page"]);
  assert.deepEqual(briefSummary({ css: "", js: "morse.el('button', {})" }), ["Adds buttons"]);
  assert.deepEqual(briefSummary({ css: "", js: "" }), []);
  assert.equal(needsCarefulLook({ css: "", js: "fetch('https://x.example', { method: 'POST' })" }), true);
  assert.equal(needsCarefulLook({ css: "", js: "box.addEventListener('input', f)" }), true);
  assert.equal(needsCarefulLook({ css: "a{}", js: "morse.watch('a', a => a.remove())" }), false);
});

test("what changed between two versions", () => {
  const d = lineDiff("a\nb\nc\n", "a\nB\nc\nd\n");
  assert.deepEqual([d.added, d.removed], [2, 1]);
  assert.deepEqual(d.lines.map(l => l.op + l.text), [" a", "-b", "+B", " c", "+d"]);
  assert.deepEqual(lineDiff("", "x").lines, [{ op: "+", text: "x" }]);
  assert.deepEqual(lineDiff("same", "same").added, 0);
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`);
  const t = trimDiff(lineDiff(long.join("\n"), [...long.slice(0, 15), "new", ...long.slice(15)].join("\n")).lines);
  assert.deepEqual(t.map(l => l.op), ["…", " ", " ", "+", " ", " ", "…"]);
  assert.equal(t[0].text, "13 lines the same");
  const w = whatChanged({ css: "a{}", js: "" }, { css: "a{}", js: "fetch('https://x.example')" });
  assert.deepEqual(w.added, ["Sends data to another website"]);
  assert.deepEqual(w.removed, []);
  assert.equal(w.js.added, 1);
  assert.equal(whatChanged({ css: "a{}", js: "" }, { css: "a{}", js: "" }).same, true);
});

// ---- submitting

test("Submit to the gallery opens a prefilled GitHub issue", () => {
  const mod = { morse: 1, id: "abc123", title: "Sleep timer", prompt: "add a sleep timer", match: { hosts: ["127.0.0.1:8789"], app: null },
    css: ".a{}", js: "", enabled: true, history: [{ prompt: "x", css: "", js: "" }], refined: "smaller", imported: false };
  const r = submitIssue(mod, { site: "127.0.0.1:8789", summary: ["Changes how the page looks"] });
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, "https://github.com/sam-siavoshian/RRAA/issues/new");
  assert.equal(u.searchParams.get("title"), "Gallery: “Sleep timer” for 127.0.0.1:8789");
  assert.equal(u.searchParams.get("labels"), "gallery");
  const body = u.searchParams.get("body");
  assert.match(body, /### What it does\nadd a sleep timer/);
  assert.match(body, /### Which site or app\n127\.0\.0\.1:8789/);
  assert.match(body, /- Changes how the page looks/);
  const json = JSON.parse(body.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(json.id, "abc123");
  for (const k of ["enabled", "history", "refined", "imported"]) assert.equal(k in json, false, `${k} stays on this computer`);
  assert.equal(r.attached, false);
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(body), "no emoji");

  const big = submitIssue({ ...mod, js: "x".repeat(20000) });
  assert.equal(big.attached, true);
  assert.ok(big.url.length <= SUBMIT_MAX_URL);
  assert.match(new URL(big.url).searchParams.get("body"), /sleep-timer\.morse\.json/);
  assert.deepEqual(Object.keys(forGallery({ id: "a", enabled: true, gallery: {} })), ["id"]);
});

test("Show mods others made is on by default and can be turned off", () => {
  assert.equal(normalizePrefs({}).gallery, true);
  assert.equal(normalizePrefs({ gallery: false }).gallery, false);
  assert.equal(mergePrefs({}, { gallery: false }).gallery, false);
  assert.equal(mergePrefs({ gallery: false }, { theme: "dark" }).gallery, false);
});
