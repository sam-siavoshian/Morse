// Self-heal: notice when a saved mod stopped working because the site changed
// its page, and say what used to match so the model can fix it.
//
// When a mod is saved (or, for older and installed mods, the first time it
// works on a visit), the runtime records a small fingerprint of what it
// changed: which of its selectors matched, and how many elements each found.
//
//   mod.fp = { v: 1, code, path, size, at, sels: [[selector, count], ...] }
//     code  hash of the mod's CSS and JS: a fingerprint only describes the
//           version it was taken for (refine, restore and update make it stale)
//     path  the page's path, with ids and numbers blanked: another page of the
//           same site can show other things, so it is never compared
//     size  how many elements the page had: a page that is still loading, or a
//           sign-in or error page, is much smaller and is never compared
//     sels  only selectors that matched something that sits on the page at
//           rest (not inside a dialog, menu or pop-up), at most HEAL_MAX_SELECTORS
//
// On later visits, after the page settles, the runtime counts the same
// selectors again and assessFingerprint() decides. A mod is "broken" only
// when every selector that used to match now matches nothing, on the same
// kind of page, at a similar size, twice in a row (runtime/src/71-heal.js).
//
// Pure and dependency-free: core/engine.js imports the selector parsing, and
// runtime/bundle.js inlines the whole file into the in-app runtime.

export const HEAL_MAX_SELECTORS = 12;
export const HEAL_MIN_SIZE = 0.3; // a page under 30% of the elements it had is not comparable

// ---- the selectors a mod relies on
// Every CSS rule's selector list, and string selectors passed to
// morse.watch / querySelector(All) / morse.byText. Pseudo-classes for states
// that come and go (:hover, ::before) are dropped, so the selector names what
// is on the page.
export function selectorLists({ css = "", js = "" } = {}) {
  const fromCss = new Set(), fromJs = new Set();
  const clean = s => s.replace(/::(part|slotted)\([^)]*\)/g, "").replace(/::?(before|after|placeholder|selection|marker|backdrop|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)\b/g, "")
    .replace(/:(hover|focus|focus-within|focus-visible|active|visited|checked|disabled|enabled|target)\b/g, "").trim();
  const body = String(css).replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{;]*[{;]/g, "{");
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    for (const part of m[1].split(",")) {
      const s = clean(part);
      if (s && !/^(from|to|[\d.]+%)$/.test(s) && !/^:root$|^html$|^body$/.test(s)) fromCss.add(s);
    }
  }
  for (const m of String(js).matchAll(/(?:\b(?:watch|querySelectorAll|querySelector|byText)|\.\$\$?)\(\s*(["'`])((?:\\.|(?!\1)[^\\])+)\1/g)) {
    if (!m[2].includes("${")) for (const part of m[2].replace(/\\(.)/g, "$1").split(",")) { const s = clean(part); if (s) fromJs.add(s); }
  }
  return { css: [...fromCss].slice(0, 30), js: [...fromJs].slice(0, 20) };
}

export function selectorsIn(draft) {
  const { css, js } = selectorLists(draft);
  return [...new Set([...css, ...js])].slice(0, 40);
}

// ---- the fingerprint

// Which version of the code a fingerprint belongs to.
export function modCodeHash(mod) {
  const s = `${mod?.css || ""}\u0000${mod?.js || ""}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// "/album/42/tracks?x#y" -> "/album/*/tracks". Segments with digits or that
// look like ids are blanked; a hash route ("#/inbox") counts as part of the path.
export function pagePathShape(url) {
  let u;
  try { u = new URL(url); } catch { return ""; }
  const route = /^#!?\//.test(u.hash) ? u.hash.replace(/^#!?/, "").split("?")[0] : "";
  const shape = p => p.split("/").map(seg => (/\d/.test(seg) || seg.length > 24 ? "*" : seg.toLowerCase())).join("/");
  return shape(u.pathname) + (route ? "#" + shape(route) : "");
}

// counts: { selector: elements it matches now (Morse's own elements left out) }
// transient: selectors whose every match sits inside a dialog, menu or pop-up.
// null when nothing the mod relies on is on the page now.
export function makeFingerprint(mod, counts, { url = "", size = 0, at = new Date().toISOString(), transient = [] } = {}) {
  if (mod?.kind === "style") return null; // your-style hook: Your style is generic; a site without links or videos is no sign it broke
  const skip = new Set(transient);
  const sels = selectorsIn(mod)
    .filter(s => s.length <= 200 && !skip.has(s) && Number(counts?.[s]) > 0)
    .slice(0, HEAL_MAX_SELECTORS)
    .map(s => [s, Math.min(9999, Math.round(Number(counts[s])))]);
  if (!sels.length) return null;
  return { v: 1, code: modCodeHash(mod), path: pagePathShape(url), size: Math.max(0, Math.round(Number(size) || 0)), at, sels };
}

// A fingerprint the runtime can trust: well formed, and for this version of the code.
export function fingerprintCurrent(mod) {
  const fp = mod?.fp;
  return !!fp && typeof fp === "object" && fp.v === 1 && fp.code === modCodeHash(mod)
    && Array.isArray(fp.sels) && fp.sels.length > 0
    && fp.sels.every(x => Array.isArray(x) && typeof x[0] === "string" && Number(x[1]) > 0);
}

// page = { counts, path, size, seen, errors }
//   seen    selectors the mod's own watches matched at some point on this visit
//   errors  the mod's script errors so far on this visit (core/kit.js __stats)
// -> { verdict: "ok" | "broken" | "skip", lost: [[selector, countBefore]], why }
// "skip" means this page can't tell (another page of the site, still loading).
export function assessFingerprint(fp, page = {}) {
  if (!fp || !Array.isArray(fp.sels) || !fp.sels.length) return { verdict: "skip", lost: [], why: "nothing to compare" };
  if (fp.path && page.path != null && page.path !== fp.path) return { verdict: "skip", lost: [], why: "another page" };
  if (fp.size && Number(page.size) < fp.size * HEAL_MIN_SIZE) return { verdict: "skip", lost: [], why: "page not loaded" };
  const counts = page.counts || {}, seen = new Set(page.seen || []);
  const lost = fp.sels.filter(([s]) => !(Number(counts[s]) > 0) && !seen.has(s));
  if (!lost.length) return { verdict: "ok", lost, why: "" };
  if (lost.length === fp.sels.length) return { verdict: "broken", lost, why: "nothing it changed is on the page" };
  // Some of it is gone and its script fails: the page moved under it.
  if (Number(page.errors) > 0 && lost.length * 2 >= fp.sels.length) return { verdict: "broken", lost, why: "parts are gone and it fails" };
  return { verdict: "ok", lost, why: "some parts are gone" };
}

// ---- what the person reads, and what the model reads

// "It can't find “Album grid” any more." The selector never reaches the person.
export function siteChangedReason(mod) {
  const label = String(mod?.target?.label || "").trim();
  return label ? `It can't find “${label.length > 40 ? label.slice(0, 39) + "…" : label}” any more.` : "It can't find the part of the page it changes.";
}

// For core/prompt.js basePrompt ("What went wrong"): what used to match, that
// it matches nothing now, and what on the page now looks like it.
// candidates: [{ selector, html }] from the runtime (rankCandidates order).
export function siteChangedNote(fp, lost, candidates = []) {
  const n = c => `${c} element${c === 1 ? "" : "s"}`;
  const was = (lost && lost.length ? lost : fp?.sels || []).slice(0, 8);
  const lines = [
    "The site changed its page, so this code no longer finds what it changed.",
    `When it was saved, these matched: ${was.map(([s, c]) => `\`${s}\` (${n(c)})`).join(", ")}. After the page finished loading they now match nothing.`,
  ];
  if (candidates.length) {
    lines.push("Parts of the page now that look like what it used to change (renamed classes, ids or attributes are likely):");
    for (const c of candidates.slice(0, 4)) lines.push(`- \`${c.selector}\`${c.count > 1 ? ` (${n(c.count)})` : ""}: ${String(c.html || "").slice(0, 400)}`);
  }
  lines.push("Use selectors that exist on the page as it is now. Keep everything else the change did.");
  return lines.join("\n");
}

// ---- finding what the old selectors probably became
// Words in a selector worth looking for: class names, ids and attribute
// values, split on - _ and camelCase ("album-grid" -> album, grid).
const NOT_WORDS = new Set(["div", "span", "data", "testid", "test", "the", "and", "class", "item", "items", "wrap", "wrapper", "container", "inner", "outer", "main", "root", "aria", "label", "role", "type", "nth", "child", "not", "has", "first", "last", "true", "false"]);
export function selectorWords(sel) {
  const raw = [];
  for (const m of String(sel).matchAll(/[.#]([\w-]+)|\[[\w-]+\s*[~|^$*]?=\s*["']?([^"'\]]+)["']?\]/g)) raw.push(m[1] || m[2]);
  const words = new Set();
  for (const r of raw) {
    for (const w of r.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/)) {
      const x = w.toLowerCase();
      if (x.length >= 3 && !NOT_WORDS.has(x)) words.add(x);
    }
  }
  return [...words];
}

// How much an element's names (classes, id, data-*, aria-label) look like
// the old selector's words. 0 when nothing in common.
export function candidateScore(words, names) {
  const hay = String(names || "").toLowerCase();
  if (!hay || !words.length) return 0;
  return words.filter(w => hay.includes(w)).length / words.length;
}

// ---- sharing a fix of a gallery mod
// core/gallery.js submitIssue makes the issue for a new mod; a fix says so in
// the title and names the gallery mod and version it fixes. submitIssue is
// passed in, so this file needs no imports.
export function fixIssue(mod, opts, submitIssue) {
  const r = submitIssue(mod, opts);
  const u = new URL(r.url);
  const id = mod?.gallery?.id || mod?.id || "";
  const v = mod?.gallery?.version ?? mod?.version ?? 1;
  const title = `Gallery fix: “${mod?.title || "mod"}” works again`;
  u.searchParams.set("title", title);
  const note = [
    "### What this fixes",
    `The site changed its page and the gallery mod \`${id}\` (version ${v}) stopped working. This is the fixed version, made with Morse.`,
    "",
  ].join("\n");
  u.searchParams.set("body", note + (u.searchParams.get("body") || ""));
  return { ...r, url: u.href, title };
}
