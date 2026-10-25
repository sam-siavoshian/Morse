// A mod is a small JSON document: what the user asked for, where it applies,
// and the CSS/JS that implements it. This is the unit people share.

import { KIT_SOURCE } from "./kit.js";
import { versionsOf } from "./versions.js";
import { modHosts } from "./summary.js";
import { t } from "./i18n.js"; // the words, in the language the host speaks (core/i18n.js)

// Version history (refine, restore, step back) lives in versions.js so the
// runtime can inline it; it is part of this module's API.
export { HISTORY_CAP, versionsOf, currentVersion, reviseMod, restoreVersion, stepBack, relativeTime } from "./versions.js";

export const SHARE_BASE = "https://sam-siavoshian.github.io/RRAA/share/install.html";

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function createMod({ id, title, prompt, css, js, url, app, target, model, kind, edits, from, history, refined, parent }) {
  const now = new Date().toISOString();
  const manual = kind === "manual" || kind === "quick";
  return {
    morse: 1,
    id: id || newId(),
    title: title || prompt.slice(0, 48),
    prompt,
    match: { hosts: [hostOf(url)], app: app || null },
    target: target ? { selector: target.selector, label: target.label } : null,
    css: css || "",
    js: js || "",
    enabled: true,
    model: manual ? null : model || null,
    created: now,
    updated: now,
    // God mode: manual/quick mods keep their edit list (core/edits.js) so they
    // stay editable; mods rebuilt from a captured element record where it came from.
    ...(manual ? { kind, edits: Array.isArray(edits) ? edits : [] } : {}),
    ...(from && typeof from === "object" ? { from: { app: from.app || null, url: from.url || null, title: from.title || null,
      ...(typeof from.taken === "string" ? { taken: from.taken.slice(0, 40) } : {}) } } : {}), // take-and-bring hook: brought from a taken feature
    // A draft refined in the bar before it was kept arrives with its versions.
    ...(Array.isArray(history) && history.length ? { history: versionsOf({ history }) } : {}),
    ...(typeof refined === "string" && refined && refined !== prompt ? { refined } : {}),
    ...(parent === "morse-style" ? { parent } : {}), // your-style hook: fits Your style to this site (core/style.js)
  };
}

// Saved mods in the order they were made. Installed files may lack "created"
// (or have it as a number): that must not break the list for every site.
export const byCreated = (a, b) => String(a?.created ?? "").localeCompare(String(b?.created ?? ""));

// What a mod is filed under: the host for web pages, and the file itself
// (file://<dir>/<name>, no query or hash) for local files, so a mod made on
// one local page doesn't follow you to every other one.
export function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? `file://${u.host}${u.pathname}` : u.host;
  } catch { return "*"; }
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

// A broken mod (bad match) matches nothing, so it can't stop the others loading.
export function modMatches(mod, { url, app }) {
  if (!mod || typeof mod !== "object") return false;
  const m = mod.match && typeof mod.match === "object" ? mod.match : {};
  if (m.app && m.app !== app) return false;
  const hosts = modHosts(mod);
  if (!hosts) return false;
  const h = hostOf(url);
  // "file" is how mods made before per-file matching were filed: keep them
  // working on local files.
  const legacyFile = h.startsWith("file://") ? "file" : null;
  return hosts.some(p => p === "*" || p === h || p === legacyFile || (!legacyFile && p.startsWith("*.") && h.endsWith(p.slice(1)))
    // Desktop apps often serve their UI from a random localhost port: within
    // the app, a mod follows its local UI whatever port it loads from.
    || (!!m.app && LOOPBACK.test(p) && LOOPBACK.test(h))
    // An AppImage runs from a new folder every launch (/tmp/.mount_JoplinAbC123/):
    // within the app, a file:// UI is matched by its path inside the app.
    || (!!m.app && !!inApp(p) && inApp(p) === inApp(h)));
}
const inApp = h => h.startsWith("file://") ? h.match(/\/resources\/(app(?:\.asar)?\/.+)$/i)?.[1] || null : null;

// A save from a page may change a mod, not widen where it runs: its match
// stays what it was, or is exactly the caller's own site (or app). Wider
// matches ("*", other hosts) only come in through a confirmed install.
const matchKey = m => JSON.stringify({ app: m?.app || null, hosts: [...(Array.isArray(m?.hosts) ? m.hosts : [])].map(String).sort() });
export function saveKeepsScope(next, existing, where) {
  if (next && existing && matchKey(next) === matchKey(existing)) return true;
  return !!next && (next.app || null) === (where.app || null)
    && Array.isArray(next.hosts) && next.hosts.length > 0 && next.hosts.every(h => h === hostOf(where.url));
}

// A site or app name with control, direction or zero-width characters: shown
// reversed or with an invisible part, it reads as another site than the one
// it runs on ("For: moc.knab.www"), and it matches no real one.
const UNSEEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
export function validateMod(m) {
  if (!m || typeof m !== "object" || m.morse !== 1) throw new Error("This isn't a Morse mod. Check that you copied all of it.");
  for (const k of ["id", "title", "prompt"]) if (typeof m[k] !== "string") throw new Error(`This mod is incomplete (no ${k}). Ask for a new share link.`);
  if (!/^[\w-]{1,40}$/.test(m.id)) throw new Error("This mod's name is broken (invalid id). Ask for a new share link.");
  if (typeof m.css !== "string" || typeof m.js !== "string") throw new Error("This mod has no code in it. Ask for a new share link.");
  const where = m.match;
  if (!where || typeof where !== "object" || Array.isArray(where)
    || !Array.isArray(where.hosts) || !where.hosts.length || !where.hosts.every(h => typeof h === "string" && h && h.length <= 253 && !UNSEEN.test(h))
    || !(where.app == null || (typeof where.app === "string" && !UNSEEN.test(where.app)))) {
    throw new Error("This mod doesn't say where it runs. Ask for a new share link.");
  }
  return m;
}

// Header values must stay on one line, or a title could add @match/@grant lines.
const oneLine = s => String(s).replace(/[\r\n\u2028\u2029]+/g, " ");

// Tampermonkey / Violentmonkey compatible export: the helper kit is inlined so
// the script runs without Morse installed.
export function toUserscript(mod) {
  const matches = (mod.match?.hosts || ["*"]).map(h => h === "file" ? "file:///*" : h.startsWith("file://") ? h : h === "*" ? "*://*/*" : `*://${h}/*`);
  const header = [
    "// ==UserScript==",
    `// @name         ${oneLine(mod.title)}`,
    `// @namespace    morse`,
    `// @version      1`,
    `// @description  ${oneLine(mod.prompt)}`,
    ...matches.map(m => `// @match        ${m}`),
    "// @grant        none",
    "// @run-at       document-idle",
    "// ==/UserScript==",
    "// Made with Morse: customize any app in one sentence.",
  ].join("\n");
  const css = mod.css.trim() ? `morse.css(${JSON.stringify(mod.css)});\n` : "";
  return `${header}\n\n${KIT_SOURCE}\nmorse.__run(${JSON.stringify(mod.id)}, function (morse) {\n${css}${mod.js}\n});\n`;
}

// Share links carry the whole mod in the URL fragment (never sent to a server).
export async function encodeShare(mod) {
  return encodeShareText(JSON.stringify(stripLocal(mod)));
}

export async function decodeShare(link) {
  return validateMod(JSON.parse(await decodeShareText(link)));
}

// packs hook (core/pack.js): the same #m= scheme carries a pack's JSON.
export async function encodeShareText(json) {
  const bytes = await deflate(new TextEncoder().encode(json));
  return `${SHARE_BASE}#m=${b64url(bytes)}`;
}
export async function decodeShareText(link) {
  const frag = String(link).split("#m=")[1];
  if (!frag) throw new Error("This isn't a Morse share link. Check that you copied the whole link.");
  let bytes;
  try { bytes = unb64url(frag.trim()); } catch { throw Object.assign(new Error(t("err.shareBroken")), { plain: true }); }
  return new TextDecoder().decode(await inflate(bytes));
}

// Links carry the current version only; the history stays on this machine.
export function stripLocal(mod) {
  const { enabled, history, fp, paused, guardOk, pack, ...rest } = mod; // self-heal hook: fp describes this machine's page; guard hook: so do paused, guardOk; packs hook: pack (its address can be a team's private one)
  return rest;
}

// A link's mod is read up to this size (the same as a backup file): a small
// link that inflates to gigabytes stops here instead of filling memory.
export const MAX_SHARE_BYTES = 5_000_000;
async function pipe(bytes, stream, max = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); throw new Error("This share link is too big to be a Morse mod."); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
const deflate = b => pipe(b, new CompressionStream("deflate-raw"));
const inflate = b => pipe(b, new DecompressionStream("deflate-raw"), MAX_SHARE_BYTES);

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
