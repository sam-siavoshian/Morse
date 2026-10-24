// A mod is a small JSON document: what the user asked for, where it applies,
// and the CSS/JS that implements it. This is the unit people share.

import { KIT_SOURCE } from "./kit.js";

export const SHARE_BASE = "https://sam-siavoshian.github.io/RRAA/share/install.html";

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function createMod({ id, title, prompt, css, js, url, app, target, model, kind, edits, from }) {
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
  };
}

export function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? "file" : u.host;
  } catch { return "*"; }
}

export function modMatches(mod, { url, app }) {
  if (mod.match?.app && app && mod.match.app !== app) return false;
  if (mod.match?.app && !app) return false;
  const h = hostOf(url);
  return (mod.match?.hosts || ["*"]).some(p => p === "*" || p === h || (p.startsWith("*.") && h.endsWith(p.slice(1))));
}

export function validateMod(m) {
  if (!m || typeof m !== "object" || m.morse !== 1) throw new Error("Not a Morse mod");
  for (const k of ["id", "title", "prompt"]) if (typeof m[k] !== "string") throw new Error(`Mod is missing ${k}`);
  if (!/^[\w-]{1,40}$/.test(m.id)) throw new Error("This mod has an invalid id");
  if (typeof m.css !== "string" || typeof m.js !== "string") throw new Error("Mod has no code");
  return m;
}

// Header values must stay on one line, or a title could add @match/@grant lines.
const oneLine = s => String(s).replace(/[\r\n\u2028\u2029]+/g, " ");

// Tampermonkey / Violentmonkey compatible export: the helper kit is inlined so
// the script runs without Morse installed.
export function toUserscript(mod) {
  const matches = (mod.match?.hosts || ["*"]).map(h => h === "file" ? "file:///*" : h === "*" ? "*://*/*" : `*://${h}/*`);
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
  if (!frag) throw new Error("Not a Morse share link");
  const json = new TextDecoder().decode(await inflate(unb64url(frag)));
  return validateMod(JSON.parse(json));
}

export function stripLocal(mod) {
  const { enabled, ...rest } = mod;
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
