// Your style, everywhere: the words -> building blocks, the code built from
// them (CSS only unless a block needs code), where it runs and where it
// doesn't (exceptions), the host requests, and the desktop's style.json.
import { home } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  STYLE_ID, parseStyleWords, isEverywhere, isNotHere, normalizeStyle, mergeStyle, styleSummary, styleKey, exceptionKey,
  exceptionMatches, styleExcepted, withException, withoutExceptionsFor, hasStyle, adaptRequest, isStyleChild, FIT_TITLE,
} from "../core/style.js";
import { buildStyleCode, styleEntry, createStyleHost, STYLE_REQUESTS } from "../core/style-host.js";
import { makeFingerprint } from "../core/heal.js";
import { createMod, validateMod } from "../core/mod.js";

const web = url => ({ url, app: null });
const T = "2026-10-24T10:00:00.000Z";

// ---- words

test("the four things people ask for become building blocks, with no model", () => {
  assert.deepEqual(parseStyleWords("use Georgia font everywhere").blocks, { font: "Georgia" });
  assert.deepEqual(parseStyleWords("everything calmer everywhere: no autoplay, fewer animations, softer colors").blocks, { lessMotion: true, noAutoplay: true, soft: true });
  const cb = parseStyleWords("I'm colorblind, make red and green easy to tell apart everywhere");
  assert.deepEqual(cb.blocks, { redgreen: true });
  assert.equal(cb.extra, "", "nothing is left for the model");
  const big = parseStyleWords("bigger text on every site except Figma");
  assert.deepEqual(big.blocks, { size: 2 });
  assert.deepEqual(big.except, ["figma"]);
});

test("more ways to say it: named fonts, sizes, spacing, links, dark pages, and what no block covers", () => {
  assert.deepEqual(parseStyleWords("Atkinson Hyperlegible and more space between lines on every site").blocks, { font: "Atkinson Hyperlegible", spacing: "roomy" });
  assert.deepEqual(parseStyleWords("text size 120% on all sites").blocks, { size: 2 });
  assert.deepEqual(parseStyleWords("much bigger text everywhere").blocks, { size: 4 });
  assert.deepEqual(parseStyleWords("smaller text everywhere").blocks, { size: -2 });
  assert.deepEqual(parseStyleWords("bigger font everywhere"), { blocks: { size: 2 }, extra: "", except: [], notes: [] }, "“bigger font” is a size, not a font name");
  assert.deepEqual(parseStyleWords("underline links and no animations in every app").blocks, { underline: true, lessMotion: true });
  assert.deepEqual(parseStyleWords("dyslexia friendly font everywhere").blocks, { font: "dyslexia" });
  assert.deepEqual(parseStyleWords("dark mode everywhere except google docs and figma.com"), { blocks: { dark: true }, extra: "", except: ["google docs", "figma.com"], notes: [] });
  assert.deepEqual(parseStyleWords("use my font everywhere").notes, ["font"], "the font wasn't named: Morse asks");
  assert.deepEqual(parseStyleWords("make buttons rounder everywhere"), { blocks: {}, extra: "make buttons rounder", except: [], notes: [] });
  assert.equal(parseStyleWords("softer colors and make buttons rounder everywhere").extra, "make buttons rounder");
});

test("“everywhere” and “not on this site” are told apart from ordinary changes", () => {
  for (const t of ["bigger text everywhere", "dark mode on every site", "underline links in all apps", "softer colors across all my sites", "Georgia on all websites and apps"]) assert.ok(isEverywhere(t), t);
  for (const t of ["make everything bigger", "hide the sidebar", "every site has a header", "add a word count"]) assert.ok(!isEverywhere(t), t);
  for (const t of ["not on this site", "Not here", "turn off my style here", "my style should be off on this site", "no your style on this page"]) assert.ok(isNotHere(t), t);
  for (const t of ["not on hover", "make this not bold here", "hide the banner on this site"]) assert.ok(!isNotHere(t), t);
});

// ---- where it runs

test("exceptions: names, hosts and apps", () => {
  assert.equal(exceptionKey("https://www.Figma.com/files/x"), "figma.com");
  assert.equal(exceptionKey("the Figma app"), "figma");
  assert.equal(exceptionKey("app:slack"), "app:slack");
  assert.equal(exceptionKey("<script>"), "");
  assert.ok(exceptionMatches("figma", web("https://www.figma.com/file/1")));
  assert.ok(exceptionMatches("figma", { url: "http://127.0.0.1:5173/", app: "figma" }), "the desktop app by its name");
  assert.ok(!exceptionMatches("figma", web("https://notfigma.com/")));
  assert.ok(exceptionMatches("figma.com", web("https://a.figma.com/")));
  assert.ok(!exceptionMatches("figma.com", web("https://figma.com.evil.test/")));
  assert.ok(exceptionMatches("google docs", web("https://docs.google.com/document/d/1")));
  assert.ok(!exceptionMatches("google docs", web("https://mail.google.com/")));
  assert.ok(exceptionMatches("mail.test:8080", web("http://mail.test:8080/inbox")), "a host with its port");
  assert.ok(!exceptionMatches("mail.test:8080", web("http://mail.test:9090/")));
  assert.equal(styleKey(web("https://www.figma.com/x")), "figma.com");
  assert.equal(styleKey({ url: "http://127.0.0.1:9/", app: "Slack" }), "app:slack");
  assert.equal(styleKey(web("file:///home/me/notes.html")), "file");
});

test("adding and removing exceptions; turning it back on here removes every entry that left this site out", () => {
  let s = normalizeStyle({ blocks: { underline: true } });
  s = withException(s, "figma");
  s = withException(s, "https://www.figma.com/");
  assert.deepEqual(s.except, ["figma", "figma.com"]);
  assert.ok(styleExcepted(s, web("https://www.figma.com/")));
  assert.ok(!styleExcepted(s, web("https://news.test/")));
  s = withoutExceptionsFor(s, web("https://www.figma.com/"));
  assert.deepEqual(s.except, []);
});

test("saying more adds to the style: blocks merge, words and exceptions add up", () => {
  const a = mergeStyle(null, parseStyleWords("bigger text everywhere"), "bigger text everywhere", T);
  const b = mergeStyle(a, parseStyleWords("softer colors everywhere except figma"), "softer colors everywhere except figma", T);
  assert.deepEqual(b.blocks, { ...normalizeStyle({}).blocks, size: 2, soft: true });
  assert.equal(b.words, "bigger text everywhere; softer colors everywhere except figma");
  assert.deepEqual(b.except, ["figma"]);
  assert.deepEqual(styleSummary(b), ["Text 121%", "Softer colors"]);
  assert.ok(hasStyle(b));
  assert.ok(!hasStyle({}));
  assert.ok(!hasStyle(normalizeStyle({ blocks: { size: 0 } })));
});

test("a style read from disk or storage can't carry anything unsafe", () => {
  const s = normalizeStyle({ blocks: { font: "x}; body{display:none", size: 99, spacing: "huge", soft: "yes" }, except: ["ok.test", 5, "<b>"], words: "a".repeat(5000), enabled: "no" });
  assert.equal(s.blocks.font, "");
  assert.equal(s.blocks.size, 6);
  assert.equal(s.blocks.spacing, "");
  assert.equal(s.blocks.soft, false);
  assert.deepEqual(s.except, ["ok.test"]);
  assert.equal(s.words.length, 600);
  assert.equal(s.enabled, true, "only false turns it off");
});

// ---- the code

test("the generic style is CSS only: no code, no observers, unless a block needs it", () => {
  const all = normalizeStyle({ blocks: { font: "Georgia", size: 2, spacing: "roomy", soft: true, redgreen: true, lessMotion: true, underline: true } });
  const { css, js } = buildStyleCode(all);
  assert.equal(js, "", "CSS only");
  assert.match(css, /font-family: "Georgia", serif !important/, "a serif font falls back to a serif");
  assert.match(css, /:not\(code, pre, kbd/, "icons and code keep their font (Easier to use's list)");
  assert.match(css, /body \{\n {2}zoom: 1\.21 !important;/, "Page tools' text size steps");
  assert.match(css, /line-height: 1\.6 !important/);
  assert.match(css, /html \{\n {2}filter: saturate\(0\.72\) contrast\(0\.92\) url\("data:image\/svg\+xml,[^"]+#morse-rg"\) !important;/, "one filter for both color changes");
  assert.match(css, /animation-duration: 1ms !important/, "Easier to use's Stop animations");
  assert.match(css, /text-decoration-line: underline !important/, "Easier to use's Underline links");
  assert.doesNotMatch(css, /MutationObserver|watch\(/);
  assert.deepEqual(buildStyleCode(normalizeStyle({})), { css: "", js: "" });
  assert.match(buildStyleCode(normalizeStyle({ blocks: { font: "readable" } })).css, /letter-spacing: 0\.02em/, "Easier to read font, as in Page tools");
});

test("no autoplay and dark pages add code (only dark pages watch the page, as Page tools' dark mode does), with a cleanup", () => {
  const { css, js } = buildStyleCode(normalizeStyle({ blocks: { noAutoplay: true, dark: true, soft: true } }));
  assert.match(css, /saturate/);
  assert.match(js, /function noAutoplay\(\)/);
  assert.match(js, /morse\.on\(document, "play"/);
  assert.match(js, /pageIsDark\(\)/, "Page tools' dark mode, skipped on dark pages");
  assert.match(js, /invert\(0\.93\) hue-rotate\(180deg\) saturate\(0\.72\) contrast\(0\.92\) !important/, "dark mode keeps the softer colors");
  assert.match(js, /return \(\) => done\.forEach/);
  const quiet = buildStyleCode(normalizeStyle({ blocks: { noAutoplay: true } })).js;
  assert.doesNotMatch(quiet, /MutationObserver|morse\.watch|morse\.every/, "no autoplay listens for play; it doesn't watch the page");
  assert.doesNotThrow(() => new Function("morse", js), "the code parses");
});

test("the style's entry looks like a mod, runs everywhere but its exceptions, and is never fingerprinted by self-heal", () => {
  const s = normalizeStyle({ words: "underline links everywhere", blocks: { underline: true }, except: ["figma"], updated: T, created: T });
  const e = styleEntry(s, web("https://news.test/a"));
  assert.equal(e.id, STYLE_ID);
  assert.equal(e.kind, "style");
  assert.equal(e.enabled, true);
  assert.doesNotThrow(() => validateMod(e));
  const off = styleEntry(s, web("https://www.figma.com/"));
  assert.equal(off.enabled, false);
  assert.equal(off.excepted, true);
  assert.equal(off.on, true, "still on everywhere else");
  assert.notEqual(off.updated, e.updated, "leaving a site out changes the entry, so the page takes it off");
  assert.equal(makeFingerprint(e, { "a[href]:not([role=button], [role=tab], [role=menuitem])": 4 }, { url: "https://news.test/a" }), null);
});

// ---- the host

function memoryHost(initial = null) {
  let saved = initial, changes = 0;
  const host = createStyleHost({ load: async () => saved && structuredClone(saved), save: async s => { saved = s && structuredClone(s); }, onChange: () => changes++, now: () => T });
  return { host, get saved() { return saved; }, get changes() { return changes; } };
}
const mod = (id, hosts, extra = {}) => ({ ...createMod({ id, prompt: id, css: `#${id}{}`, url: `https://${hosts}/` }), ...extra });

test("host: the style comes first in every page's mods; its fits only run where the style does", async () => {
  const h = memoryHost();
  const mine = [mod("a", "news.test"), mod("fit", "news.test", { parent: STYLE_ID })];
  assert.deepEqual((await h.host.list(mine, web("https://news.test/"))).map(m => m.id), ["a"], "no style: its fits stay off too");
  await h.host.handle({ type: "style.save", add: "underline links everywhere" }, web("https://news.test/"));
  assert.deepEqual((await h.host.list(mine, web("https://news.test/"))).map(m => m.id), [STYLE_ID, "a", "fit"]);
  await h.host.handle({ type: "style.except", on: true }, web("https://news.test/"));
  const here = await h.host.list(mine, web("https://news.test/"));
  assert.deepEqual(here.map(m => [m.id, m.enabled]), [[STYLE_ID, false], ["a", true]], "left out here: the style is listed off, its fit is gone");
  assert.equal((await h.host.list([], web("https://other.test/")))[0].enabled, true, "still on everywhere else");
  await h.host.handle({ type: "style.except", on: false }, web("https://news.test/"));
  assert.deepEqual(h.saved.except, []);
  // The Mods panel's switch goes through mods.save, like any mod's.
  assert.ok(h.host.owns({ type: "mods.save", mod: { id: STYLE_ID } }));
  assert.ok(!h.host.owns({ type: "mods.save", mod: { id: "a" } }));
  await h.host.handle({ type: "mods.save", mod: { id: STYLE_ID, enabled: false, css: "body{display:none}" } }, web("https://news.test/"));
  assert.equal(h.saved.enabled, false);
  assert.ok(!JSON.stringify(h.saved).includes("display:none"), "only the switch is taken from a saved entry; the code is always built");
  assert.deepEqual((await h.host.list(mine, web("https://news.test/"))).map(m => [m.id, m.enabled]), [[STYLE_ID, false], ["a", true]]);
  await h.host.handle({ type: "mods.delete", modId: STYLE_ID }, web("https://news.test/"));
  assert.equal(h.saved, null);
  assert.ok(h.changes >= 5, "open pages hear about every change");
});

test("host: preview saves nothing; save adds; patch changes one block; tried is kept per site", async () => {
  const h = memoryHost();
  const p = await h.host.handle({ type: "style.preview", words: "bigger text and softer colors everywhere" }, web("https://a.test/"));
  assert.equal(h.saved, null);
  assert.deepEqual(p.summary, ["Text 121%", "Softer colors"]);
  assert.match(p.entry.css, /zoom: 1\.21/);
  assert.deepEqual(p.parsed.blocks, { size: 2, soft: true });
  let r = await h.host.handle({ type: "style.save", add: "bigger text and softer colors everywhere" }, web("https://a.test/"));
  assert.deepEqual(r.summary, p.summary);
  r = await h.host.handle({ type: "style.save", patch: { blocks: { size: 4 }, adapt: true } }, web("https://a.test/"));
  assert.deepEqual(r.summary, ["Text 146%", "Softer colors"]);
  assert.equal(h.saved.adapt, true);
  assert.equal(r.entry.fitted, false);
  await h.host.handle({ type: "style.tried" }, web("https://a.test/x"));
  assert.equal((await h.host.list([], web("https://a.test/y")))[0].fitted, true, "fitted once per site");
  assert.equal((await h.host.list([], web("https://b.test/")))[0].fitted, false);
  r = await h.host.handle({ type: "style.save", reset: true }, web("https://a.test/"));
  assert.equal(r.style, null);
  for (const t of ["style.get", "style.preview", "style.save", "style.except", "style.tried"]) assert.ok(STYLE_REQUESTS.has(t));
});

test("two quick changes from two tabs both land", async () => {
  const h = memoryHost();
  await Promise.all([
    h.host.handle({ type: "style.save", add: "underline links everywhere" }, web("https://a.test/")),
    h.host.handle({ type: "style.save", add: "no autoplay everywhere" }, web("https://b.test/")),
  ]);
  assert.equal(h.saved.blocks.underline, true);
  assert.equal(h.saved.blocks.noAutoplay, true);
});

// ---- a fit for one site

test("a fit for one site is a mod with the style as its parent, and the request carries the style", () => {
  const m = createMod({ prompt: "Fit Your style to this site", css: "nav{line-height:normal}", url: "https://news.test/", parent: STYLE_ID });
  assert.equal(m.parent, STYLE_ID);
  assert.ok(isStyleChild(m));
  assert.equal(createMod({ prompt: "x", url: "https://a.test/", parent: "other" }).parent, undefined);
  const req = adaptRequest(normalizeStyle({ words: "bigger text everywhere", extra: "rounder buttons" }), "body { zoom: 1.21 !important; }");
  assert.match(req, /“bigger text everywhere”/);
  assert.match(req, /zoom: 1\.21/);
  assert.match(req, /rounder buttons/);
  assert.match(req, new RegExp(FIT_TITLE));
});

// ---- the desktop: ~/.morse/style.json

test("desktop: the style is kept in style.json and the connector lists it first", async () => {
  const { Style, STYLE_FILE } = await import("../daemon/style.js");
  assert.equal(STYLE_FILE, path.join(home, "style.json"));
  await Style.handle({ type: "style.save", add: "underline links everywhere except slack" }, { url: "http://127.0.0.1:9/", app: "notes" });
  const disk = JSON.parse(readFileSync(STYLE_FILE, "utf8"));
  assert.equal(disk.blocks.underline, true);
  assert.deepEqual(disk.except, ["slack"]);
  const notes = await Style.list([], { url: "http://127.0.0.1:9/", app: "notes" });
  assert.equal(notes[0].enabled, true);
  const slack = await Style.list([], { url: "http://127.0.0.1:9/", app: "slack" });
  assert.equal(slack[0].enabled, false, "left out of the Slack app");
  await Style.handle({ type: "style.save", reset: true }, { url: "http://127.0.0.1:9/", app: "notes" });
  assert.ok(!existsSync(STYLE_FILE));
});
