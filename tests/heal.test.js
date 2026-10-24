// Self-heal, the pure part (core/heal.js): the fingerprint a saved mod keeps
// of what it changed, and the rules that decide it stopped working because
// the site changed. No false alarms: another page, a page still loading, or
// something that only shows in a dialog never counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectorsIn, modCodeHash, pagePathShape, makeFingerprint, fingerprintCurrent, assessFingerprint,
  siteChangedReason, siteChangedNote, selectorWords, candidateScore, fixIssue, HEAL_MAX_SELECTORS,
} from "../core/heal.js";
import { selectorsIn as engineSelectors } from "../core/engine.js";
import { submitIssue } from "../core/gallery.js";
import { stripLocal } from "../core/mod.js";
import { forGallery } from "../core/gallery.js";
import { normalizePrefs, DEFAULT_PREFS } from "../core/prefs.js";
import { buildMessages } from "../core/prompt.js";
import { demoResponse } from "../core/demo.js";

const COVERS = {
  id: "covers", title: "Bigger covers", prompt: "make the album covers bigger",
  target: { selector: '[data-testid="album-grid"]', label: "Album grid" },
  css: '[data-testid="album-grid"] { gap: 24px }\n[data-testid="album-grid"] > div:hover { transform: scale(1.02) }\n.morse-badge { color: red }',
  js: 'morse.watch(".q8c .cv", el => el.classList.add("big"));',
};
const URL1 = "http://127.0.0.1:8789/demo/sites/tunes/";
const counts1 = { '[data-testid="album-grid"]': 2, '[data-testid="album-grid"] > div': 12, ".morse-badge": 0, ".q8c .cv": 12 };

test("the engine and the self-heal check read a mod's selectors the same way", () => {
  assert.equal(engineSelectors, selectorsIn);
  assert.deepEqual(selectorsIn(COVERS), ['[data-testid="album-grid"]', '[data-testid="album-grid"] > div', ".morse-badge", ".q8c .cv"]);
});

test("a fingerprint keeps only what matched, on the page at rest, for this version of the code", () => {
  const fp = makeFingerprint(COVERS, counts1, { url: URL1 + "?x=1#top", size: 240, at: "2026-10-24T10:00:00.000Z", transient: [".q8c .cv"] });
  assert.deepEqual(fp, {
    v: 1, code: modCodeHash(COVERS), path: "/demo/sites/tunes/", size: 240, at: "2026-10-24T10:00:00.000Z",
    sels: [['[data-testid="album-grid"]', 2], ['[data-testid="album-grid"] > div', 12]],
  }, "Morse's own elements (0 here) and things only in a dialog are left out");
  assert.equal(makeFingerprint(COVERS, {}, { url: URL1 }), null, "nothing matches: nothing to remember");
  const many = { css: Array.from({ length: 20 }, (_, i) => `.c${i} { color: red }`).join("\n"), js: "" };
  assert.equal(makeFingerprint(many, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`.c${i}`, 1])), { url: URL1 }).sels.length, HEAL_MAX_SELECTORS);

  const mod = { ...COVERS, fp };
  assert.equal(fingerprintCurrent(mod), true);
  assert.equal(fingerprintCurrent({ ...mod, css: mod.css + "\na { color: red }" }), false, "refined code: the fingerprint is stale");
  assert.equal(fingerprintCurrent({ ...mod, fp: { ...fp, sels: [] } }), false);
  assert.equal(fingerprintCurrent({ ...mod, fp: { ...fp, sels: [["x", 0]] } }), false);
  assert.equal(fingerprintCurrent({ ...COVERS }), false);
});

test("page paths: ids and numbers blanked, hash routes kept", () => {
  assert.equal(pagePathShape("https://x.com/album/42/tracks?sort=1#x"), "/album/*/tracks");
  assert.equal(pagePathShape("https://x.com/u/AbCdEfGhIjKlMnOpQrStUvWxYz0"), "/u/*");
  assert.equal(pagePathShape("https://app.test/index.html#/inbox/123"), "/index.html#/inbox/*");
  assert.equal(pagePathShape("https://app.test/Index.html#!/Settings"), "/index.html#/settings");
  assert.equal(pagePathShape("not a url"), "");
});

test("broken only when everything it used to change is gone from the same page", () => {
  const fp = makeFingerprint(COVERS, counts1, { url: URL1, size: 240 });
  const page = (counts, extra = {}) => ({ path: "/demo/sites/tunes/", size: 236, counts, ...extra });
  const none = { '[data-testid="album-grid"]': 0, '[data-testid="album-grid"] > div': 0, ".q8c .cv": 0 };

  assert.equal(assessFingerprint(fp, page(counts1)).verdict, "ok");
  const b = assessFingerprint(fp, page(none));
  assert.equal(b.verdict, "broken");
  assert.deepEqual(b.lost.map(x => x[0]), ['[data-testid="album-grid"]', '[data-testid="album-grid"] > div', ".q8c .cv"]);

  // Signals that it can't tell: another page of the site, a page still loading.
  assert.equal(assessFingerprint(fp, page(none, { path: "/demo/sites/tunes/search" })).verdict, "skip");
  assert.equal(assessFingerprint(fp, page(none, { size: 40 })).verdict, "skip", "a page a fraction of the size is still loading (or a sign-in page)");
  assert.equal(assessFingerprint(null, page(none)).verdict, "skip");
  assert.equal(assessFingerprint({ ...fp, sels: [] }, page(none)).verdict, "skip");

  // Part of it still matches: the page moved around, but the mod still works.
  const some = { ...none, ".q8c .cv": 12 };
  const partly = assessFingerprint(fp, page(some));
  assert.equal(partly.verdict, "ok");
  assert.equal(partly.lost.length, 2);
  // ...unless its script also fails now.
  assert.equal(assessFingerprint(fp, page(some, { errors: 2 })).verdict, "broken");
  assert.equal(assessFingerprint(fp, page({ ...none, '[data-testid="album-grid"]': 2, '[data-testid="album-grid"] > div': 12 }, { errors: 1 })).verdict, "ok");

  // Its watch matched earlier on this visit (a list that comes and goes): not broken.
  assert.equal(assessFingerprint(fp, page(none, { seen: ['[data-testid="album-grid"]', '[data-testid="album-grid"] > div', ".q8c .cv"] })).verdict, "ok");
  // Fewer elements is still working.
  assert.equal(assessFingerprint(fp, page({ ...none, '[data-testid="album-grid"]': 1 })).verdict, "ok");
});

test("what the person reads, and what the model reads", () => {
  assert.equal(siteChangedReason(COVERS), "It can't find “Album grid” any more.");
  assert.equal(siteChangedReason({ ...COVERS, target: null }), "It can't find the part of the page it changes.");
  const fp = makeFingerprint(COVERS, counts1, { url: URL1, size: 240 });
  const note = siteChangedNote(fp, fp.sels, [{ selector: 'div[data-testid="release-grid"]', count: 2, html: '<div data-testid="release-grid"><div class="rl-card">…</div></div>' }]);
  assert.match(note, /^The site changed its page/);
  assert.match(note, /`\[data-testid="album-grid"\]` \(2 elements\)/);
  assert.match(note, /`\[data-testid="album-grid"\] > div` \(12 elements\)/);
  assert.match(note, /- `div\[data-testid="release-grid"\]` \(2 elements\): <div data-testid="release-grid">/);
  assert.doesNotMatch(siteChangedNote(fp, fp.sels, []), /look like/);

  // It reaches the model through the usual "fix this saved mod" prompt (core/prompt.js).
  const msgs = buildMessages({ request: COVERS.prompt, context: { url: URL1, title: "Tunes" }, base: { prompt: COVERS.prompt, css: COVERS.css, js: COVERS.js, error: note } });
  const user = msgs.at(-1).content;
  assert.match(user, /It has stopped working on the page as it is now\./);
  assert.match(user, /Original request: make the album covers bigger/);
  assert.match(user, /What went wrong: The site changed its page/);
  assert.match(user, /release-grid/);
});

test("the demo model fixes the Tunes redesign, and only that", () => {
  const css = '[data-testid="album-grid"] { gap: 24px }';
  const ask = error => demoResponse(buildMessages({ request: "make the album covers bigger, with rounded corners", context: { url: URL1, title: "Tunes" }, base: { prompt: "make the album covers bigger, with rounded corners", css, js: "", error } }));
  assert.match(ask("The site changed its page, so this code no longer finds what it changed.\n- `div[data-testid=\"release-grid\"]`"), /\[data-testid="release-grid"\] \{ gap: 24px \}/);
  assert.doesNotMatch(ask("x is not defined"), /release-grid/);
});

test("words to look for where the old selectors went", () => {
  assert.deepEqual(selectorWords('[data-testid="album-grid"] > div.coverArt'), ["album", "grid", "cover", "art"]);
  assert.deepEqual(selectorWords("div > span"), []);
  assert.deepEqual(selectorWords("#main .item"), []);
  assert.equal(candidateScore(["album", "grid"], "release-grid"), 0.5);
  assert.equal(candidateScore(["album", "grid"], "album-grid wide"), 1);
  assert.equal(candidateScore(["album"], ""), 0);
  assert.equal(candidateScore([], "x"), 0);
});

test("the fingerprint never leaves this machine; auto-fix is off by default", () => {
  const fp = makeFingerprint(COVERS, counts1, { url: URL1 });
  assert.equal("fp" in stripLocal({ ...COVERS, morse: 1, fp }), false, "share links");
  assert.equal("fp" in forGallery({ ...COVERS, morse: 1, fp }), false, "gallery submissions");
  assert.equal(DEFAULT_PREFS.autoFix, false);
  assert.equal(normalizePrefs({}).autoFix, false);
  assert.equal(normalizePrefs({ autoFix: true }).autoFix, true);
  assert.equal(normalizePrefs({ autoFix: "yes" }).autoFix, false);
});

test("sharing a fix of a gallery mod opens the gallery's issue, titled as a fix", () => {
  const mod = { morse: 1, ...COVERS, match: { hosts: ["127.0.0.1:8789"], app: null }, gallery: { id: "tunes-big-covers", version: 1 }, imported: true, refined: "Fixed after this site changed" };
  const r = fixIssue(mod, { site: "Tunes" }, submitIssue);
  const u = new URL(r.url);
  assert.equal(u.searchParams.get("title"), "Gallery fix: “Bigger covers” works again");
  assert.equal(r.title, "Gallery fix: “Bigger covers” works again");
  assert.equal(u.searchParams.get("labels"), "gallery");
  const body = u.searchParams.get("body");
  assert.match(body, /^### What this fixes\nThe site changed its page and the gallery mod `tunes-big-covers` \(version 1\) stopped working/);
  assert.match(body, /### The mod/);
  assert.match(body, /album-grid/, "the new code is in it");
  assert.doesNotMatch(body, /"gallery"|"refined"|"imported"/, "local fields stay out");
});
