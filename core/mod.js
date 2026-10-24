// A mod is a small JSON document: what the user asked for, where it applies,
// and the CSS/JS that implements it. This is the unit people share.

import { KIT_SOURCE } from "./kit.js";
import { versionsOf } from "./versions.js";
import { modHosts } from "./summary.js";

// Version history (refine, restore, step back) lives in versions.js so the
// runtime can inline it; it is part of this module's API.
export { HISTORY_CAP, versionsOf, currentVersion, reviseMod, restoreVersion, stepBack, relativeTime } from "./versions.js";

export const SHARE_BASE = "https://sam-siavoshian.github.io/RRAA/share/install.html";

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function createMod({ id, title, prompt, css, js, url, app, target, model, kind, edits, from, history, refined }) {
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
    ...(from && typeof from === "object" ? { from: { app: from.app || null, url: from.url || null, title: from.title || null } } : {}),
    // A draft refined in the bar before it was kept arrives with its versions.
    ...(Array.isArray(history) && history.length ? { history: versionsOf({ history }) } : {}),
    ...(typeof refined === "string" && refined && refined !== prompt ? { refined } : {}),
  };
}

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
    || (!!m.app && LOOPBACK.test(p) && LOOPBACK.test(h)));
}

export function validateMod(m) {
  if (!m || typeof m !== "object" || m.morse !== 1) throw new Error("This isn't a Morse mod. Check that you copied all of it.");
  for (const k of ["id", "title", "prompt"]) if (typeof m[k] !== "string") throw new Error(`This mod is incomplete (no ${k}). Ask for a new share link.`);
  if (!/^[\w-]{1,40}$/.test(m.id)) throw new Error("This mod's name is broken (invalid id). Ask for a new share link.");
  if (typeof m.css !== "string" || typeof m.js !== "string") throw new Error("This mod has no code in it. Ask for a new share link.");
  const where = m.match;
  if (!where || typeof where !== "object" || Array.isArray(where)
    || !Array.isArray(where.hosts) || !where.hosts.length || !where.hosts.every(h => typeof h === "string" && h && h.length <= 253)
    || !(where.app == null || typeof where.app === "string")) {
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
  const json = JSON.stringify(stripLocal(mod));
  const bytes = await deflate(new TextEncoder().encode(json));
  return `${SHARE_BASE}#m=${b64url(bytes)}`;
}

export async function decodeShare(link) {
  const frag = String(link).split("#m=")[1];
  if (!frag) throw new Error("This isn't a Morse share link. Check that you copied the whole link.");
  const json = new TextDecoder().decode(await inflate(unb64url(frag)));
  return validateMod(JSON.parse(json));
}

// Links carry the current version only; the history stays on this machine.
export function stripLocal(mod) {
  const { enabled, history, fp, ...rest } = mod; // self-heal hook: fp describes this machine's page
  return rest;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const deflate = b => pipe(b, new CompressionStream("deflate-raw"));
const inflate = b => pipe(b, new DecompressionStream("deflate-raw"));

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
