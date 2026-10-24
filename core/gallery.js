// Mods for this site: the pure part of finding, trying and updating mods
// other people made. The gallery is a static list (site/mods/index.json) plus
// one .morse.json file per mod; nothing here talks to the network.
//
//   - reading the list, and dropping entries that are broken or unsafe
//   - which entries are for the page you're on (the same rules as
//     core/mod.js modMatches, passed in so this file needs no imports)
//   - versions: is the gallery's copy newer than the one installed?
//   - when to fetch the list again (ETag, max-age, at most once a day)
//   - a short summary of what a mod does, what changed between versions,
//     and the GitHub link that submits a mod to the gallery
//
// Dependency-free: the hosts import it (core/gallery-host.js), and
// runtime/bundle.js inlines it into the in-app runtime.
import { t } from "./i18n.js"; // the words, in the language the host speaks (core/i18n.js)

// The list lives on the same site as the share page (SHARE_BASE in
// core/mod.js): https://sam-siavoshian.github.io/RRAA/ + site/mods/index.json.
export const GALLERY_INDEX_URL = "https://sam-siavoshian.github.io/RRAA/site/mods/index.json";
// `node demo/serve.js` serves the repo, list included, next to the demo sites.
export const DEMO_INDEX_URL = "http://127.0.0.1:8787/site/mods/index.json";
export const GALLERY_REPO = "https://github.com/sam-siavoshian/RRAA";

export const DAY = 24 * 60 * 60 * 1000;
export const RETRY_AFTER = 60 * 60 * 1000; // after a failed fetch (offline), wait an hour
export const MAX_ENTRIES = 1000;
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_MOD_BYTES = 512 * 1024;
// However long a server says its list stays fresh, it is checked again within
// a week: a list served once (by a bad mirror, or before a fix) can't pin itself.
export const MAX_FRESH = 7 * DAY;

const ID = /^[\w-]{1,40}$/;
const FILE = /^[\w.-]{1,80}\.morse\.json$/;       // a file next to the list, never a path or another site
const HOST = /^(\*|\*\.)?[\w.-]{1,253}(:\d{1,5})?$/;
// One line of text, without control characters, direction overrides or
// zero-width spaces (which can make a title or tag read in another order).
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

// ---- the list

// -> { entries, skipped }. Throws when the list as a whole can't be read.
// Accepts the plain array site/mods/index.json is, or { mods: [...] }.
export function parseIndex(input) {
  let data = input;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { throw new Error(t("gl.err.unreadable")); }
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.mods) ? data.mods : null;
  if (!list) throw new Error(t("gl.err.unreadable"));
  const entries = [], seen = new Set();
  let skipped = 0;
  for (const raw of list.slice(0, MAX_ENTRIES)) {
    const e = parseEntry(raw);
    if (!e || seen.has(e.id)) { skipped++; continue; }
    seen.add(e.id);
    entries.push(e);
  }
  return { entries, skipped: skipped + Math.max(0, list.length - MAX_ENTRIES) };
}

export function parseEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const file = typeof raw.file === "string" && FILE.test(raw.file) ? raw.file : null;
  if (!file) return null;
  const id = typeof raw.id === "string" ? raw.id : file.replace(/\.morse\.json$/, "");
  if (!ID.test(id)) return null;
  const title = str(raw.title, 80), prompt = str(raw.prompt, 400);
  if (!title || !prompt) return null;
  const match = parseMatch(raw.match);
  if (!match) return null; // nothing to match on: it can't be for any page
  return {
    id, file, title, prompt, match,
    app: str(raw.app, 40),
    author: str(raw.author, 60),
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => str(t, 30)).filter(Boolean).slice(0, 8) : [],
    version: normVersion(raw.version),
    changes: str(raw.changes, 400),
    created: str(raw.created, 40),
    updated: str(raw.updated, 40),
    surface: str(raw.surface, 30),
    ...(raw.demo === true ? { demo: true } : {}),
  };
}

function parseMatch(m) {
  if (!m || typeof m !== "object") return null;
  const hosts = Array.isArray(m.hosts) ? m.hosts.filter(h => typeof h === "string" && HOST.test(h)).slice(0, 20) : [];
  if (!hosts.length) return null;
  // A gallery mod for every website is not a "mod for this site", and neither
  // is one for every .com (or .co.uk) site.
  if (hosts.some(tooWide)) return null;
  const app = typeof m.app === "string" && /^[\w.-]{1,40}$/.test(m.app) ? m.app : null;
  return { hosts, app };
}

const SUFFIX2 = /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|nic|mil|ltd|plc)\.[a-z]{2}$/i;
function tooWide(h) {
  if (h === "*") return true;
  if (!h.startsWith("*.")) return false;
  const rest = h.slice(2).replace(/:\d+$/, "").replace(/\.$/, "");
  return !rest.includes(".") || SUFFIX2.test(rest);
}

// Which list to read for a page: the one set in the host's settings, the
// local one for the demo sites (`node demo/serve.js`), or the public one.
export function indexUrlFor(pageUrl, configured = "") {
  if (configured && /^https?:\/\//.test(configured)) return configured;
  try {
    const u = new URL(pageUrl);
    // demo/serve.js: the demo apps on 8787-8797
    if (/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && /^87(8[7-9]|9[0-7])$/.test(u.port)) return DEMO_INDEX_URL;
  } catch {}
  return GALLERY_INDEX_URL;
}

// The entries for one page. `matches` is core/mod.js modMatches, so the
// gallery follows exactly the rules saved mods do.
export function matchEntries(entries, where, matches) {
  return (entries || []).filter(e => {
    try { return matches({ match: e.match }, where); } catch { return false; }
  });
}

// Where the mod's own file is: next to the list.
export function modUrl(entry, indexUrl) {
  return new URL(entry.file, indexUrl).href;
}

// ---- versions: 3, "3", "1.2", "v1.2.0". Anything else counts as 1.

export function normVersion(v) {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && /^v?\d{1,6}(\.\d{1,6}){0,3}$/i.test(v.trim())) {
    const s = v.trim().replace(/^v/i, "");
    return /^\d+$/.test(s) ? Number(s) : s;
  }
  return 1;
}
const parts = v => String(normVersion(v)).split(".").map(Number);

// -1, 0 or 1, like a sort comparator. 1.10 is newer than 1.9.
export function compareVersions(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// The gallery id of an installed mod: recorded when it was installed from
// Mods for this site, or the id it came with from a gallery share link.
export function galleryIdOf(mod) {
  if (mod?.gallery && typeof mod.gallery.id === "string") return mod.gallery.id;
  return mod?.imported && typeof mod.id === "string" ? mod.id : null;
}
export function installedVersion(mod) {
  return normVersion(mod?.gallery?.version ?? mod?.version);
}
// The entry that is newer than the installed mod, or null.
export function updateFor(mod, entries) {
  const id = galleryIdOf(mod);
  const e = id && (entries || []).find(x => x.id === id);
  return e && compareVersions(e.mod?.version ?? e.version, installedVersion(mod)) > 0 ? e : null;
}

// ---- when to fetch the list again
//
// cache = { entries, etag, lastModified, maxAge (s), fetchedAt, failedAt, error }
// A list is fetched at most once a day, or less often if the server says it
// stays fresh longer. After a failure (offline) the old list keeps being used
// and Morse waits an hour before trying again.

export function maxAgeOf(cacheControl) {
  const s = String(cacheControl || "").toLowerCase();
  if (/no-store|no-cache/.test(s)) return 0;
  const m = s.match(/(?:^|[,\s])max-age\s*=\s*"?(\d{1,10})/);
  return m ? Number(m[1]) : 0;
}

export function freshFor(cache) {
  return Math.min(MAX_FRESH, Math.max(DAY, (cache?.maxAge || 0) * 1000));
}

export function needsFetch(cache, now = Date.now()) {
  if (!cache) return true;
  if (cache.failedAt && now >= cache.failedAt && now - cache.failedAt < RETRY_AFTER) return false;
  if (!cache.fetchedAt || cache.fetchedAt > now) return true; // never, or the clock went back
  return now - cache.fetchedAt >= freshFor(cache);
}

export function conditionalHeaders(cache) {
  const h = {};
  if (cache?.etag && Array.isArray(cache.entries)) h["If-None-Match"] = cache.etag;
  else if (cache?.lastModified && Array.isArray(cache.entries)) h["If-Modified-Since"] = cache.lastModified;
  return h;
}

// The cache after a response: { status, etag, lastModified, cacheControl, body }.
export function afterResponse(cache, res, now = Date.now()) {
  if (res.status === 304 && Array.isArray(cache?.entries)) {
    return { ...cache, fetchedAt: now, failedAt: 0, error: "", maxAge: maxAgeOf(res.cacheControl) || cache.maxAge || 0 };
  }
  if (res.status !== 200) return afterFailure(cache, now, t("gl.err.status", { status: res.status }));
  if (typeof res.body === "string" && res.body.length > MAX_INDEX_BYTES) return afterFailure(cache, now, t("gl.err.tooBig"));
  let parsed;
  try { parsed = parseIndex(res.body); } catch (e) { return afterFailure(cache, now, e.message); }
  return {
    entries: parsed.entries,
    etag: res.etag || "",
    lastModified: res.lastModified || "",
    maxAge: maxAgeOf(res.cacheControl),
    fetchedAt: now, failedAt: 0, error: "",
  };
}

export function afterFailure(cache, now = Date.now(), error = "") {
  return { entries: [], fetchedAt: 0, ...cache, failedAt: now, error: String(error?.message || error || t("gl.err.unreachable")) };
}

// ---- what a mod does, in a few words
//
// core/summary.js has the full review; this short version is for a line in
// the Mods panel, and for hosts and runtimes that don't have summary.js.
// The words: message ids "gl.brief.<id>" (core/locales/en.js).
const BRIEF = ["looks", "hides", "buttons", "adds", "typing", "ongoing", "storage", "network"];
export function briefSummary(mod) { return briefIds(mod).map(id => t(`gl.brief.${id}`)); }
function briefIds(mod) {
  const css = String(mod?.css || ""), js = String(mod?.js || "");
  const found = new Set();
  if (css.trim()) {
    found.add("looks");
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(css)) found.add("hides");
  }
  if (js.trim()) {
    if (/\.style\b|classList|morse\.css\s*\(/.test(js)) found.add("looks");
    // Not .remove(): mods mostly remove what they added themselves.
    if (/\.hidden\s*=\s*(true|!0)|display\s*[:=]\s*["'`]?none|visibility\s*[:=]\s*["'`]?hidden/.test(js)) found.add("hides");
    if (/(morse\.el|createElement)\s*\(\s*["'`]button/i.test(js)) found.add("buttons");
    else if (/morse\.el\s*\(|createElement\s*\(|insertAdjacent|\.(append|prepend|before|after)\s*\(/.test(js)) found.add("adds");
    if (/["'`](input|keydown|keyup|keypress|paste|change)["'`]|\.value\b/.test(js)) found.add("typing");
    if (/morse\.(every|watch)\s*\(|setInterval|MutationObserver/.test(js)) found.add("ongoing");
    if (/morse\.store\b|localStorage|sessionStorage|indexedDB/.test(js)) found.add("storage");
    if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|new\s+Image\b/.test(js)) found.add("network");
  }
  return BRIEF.filter(id => found.has(id));
}
// Lines that should send someone to the full review rather than a quick try.
export function needsCarefulLook(mod) {
  const s = briefIds(mod);
  return s.includes("network") || s.includes("typing");
}

// ---- what changed between two versions

// A line diff (longest common subsequence), for the update review.
// -> { added, removed, lines: [{ op: "+" | "-" | " ", text }] }
export function lineDiff(a, b, { max = 1500 } = {}) {
  const x = String(a || "").replace(/\s+$/, "").split("\n"), y = String(b || "").replace(/\s+$/, "").split("\n");
  if (!String(a || "").trim()) x.length = 0;
  if (!String(b || "").trim()) y.length = 0;
  if (x.length * y.length > max * max) {
    return { added: y.length, removed: x.length, lines: [...x.map(text => ({ op: "-", text })), ...y.map(text => ({ op: "+", text }))] };
  }
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const lines = [];
  let i = 0, j = 0, added = 0, removed = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { lines.push({ op: " ", text: x[i] }); i++; j++; }
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) { lines.push({ op: "-", text: x[i++] }); removed++; } // removed lines first
    else { lines.push({ op: "+", text: y[j++] }); added++; }
  }
  return { added, removed, lines };
}

// Keeps changed lines and `context` lines around them; the rest become
// { op: "…", text: "12 lines" }.
export function trimDiff(lines, context = 2) {
  const keep = lines.map(l => l.op !== " ");
  const near = lines.map((_, k) => keep.slice(Math.max(0, k - context), k + context + 1).some(Boolean));
  const out = [];
  let skip = 0;
  lines.forEach((l, k) => {
    if (near[k]) {
      if (skip) out.push({ op: "…", text: `${skip} line${skip > 1 ? "s" : ""} the same` });
      skip = 0;
      out.push(l);
    } else skip++;
  });
  if (skip && out.length) out.push({ op: "…", text: `${skip} line${skip > 1 ? "s" : ""} the same` });
  return out;
}

// What an update changes, in words: what the mod now also does, what it no
// longer does, and how many lines of style and script changed.
// `summarize(mod)` returns a list of plain lines (briefSummary, or
// core/summary.js items).
export function whatChanged(before, after, summarize = briefSummary) {
  const a = summarize(before), b = summarize(after);
  const css = lineDiff(before?.css, after?.css), js = lineDiff(before?.js, after?.js);
  return {
    added: b.filter(t => !a.includes(t)),
    removed: a.filter(t => !b.includes(t)),
    css, js,
    same: !css.added && !css.removed && !js.added && !js.removed,
  };
}

// ---- submitting a mod to the gallery
//
// A prefilled GitHub "new issue" link: no account on our side, no server.
// GitHub turns down very long links, so past ~7500 characters the mod is
// left out of the link and the person attaches the downloaded file instead.
export const SUBMIT_MAX_URL = 7500;

// What goes into a public issue: the mod, not this machine's page. `target`
// names what was pointed at with the page's own words, and `from` the page a
// captured element came from (its full address and title).
export function forGallery(mod) {
  const { enabled, history, imported, gallery, refined, fp, fixShared, target, from, pack, ...rest } = mod || {}; // self-heal hook: fp, fixShared; packs hook: pack
  return rest;
}

// title / intro: a different title, and lines before the usual body (core/heal.js
// fixIssue), counted in the length like everything else.
export function submitIssue(mod, { site = "", summary = [], repo = GALLERY_REPO, title: asTitle = "", intro = [] } = {}) {
  const m = forGallery(mod);
  const where = site || m.match?.app || (m.match?.hosts || []).join(", ") || "any site";
  const title = asTitle || `Gallery: “${m.title}” for ${where}`;
  const head = [
    ...intro,
    "### What it does",
    m.prompt || m.title,
    "",
    "### Which site or app",
    where,
    "",
    ...(summary.length ? ["### What it changes", ...summary.map(s => `- ${s}`), ""] : []),
    "### Anything people should know",
    "(Optional: what it needs, when it works best, what it doesn't do.)",
    "",
    "### The mod",
  ];
  const tail = ["", "Made with Morse. Someone reads the code before a mod goes in the gallery."];
  const json = JSON.stringify(m, null, 2);
  const build = body => `${repo}/issues/new?${new URLSearchParams({ title, labels: "gallery", body: body.join("\n") })}`;
  const full = build([...head, "```json", json, "```", ...tail]);
  if (full.length <= SUBMIT_MAX_URL) return { url: full, attached: false, title };
  const slug = String(m.title || "mod").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mod";
  return { url: build([...head, `The mod is too long for a link. Its file is attached: ${slug}.morse.json`, "(Drag the file from your Downloads folder into this box.)", ...tail]), attached: true, title };
}
