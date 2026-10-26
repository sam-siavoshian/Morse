// Hooks a page already has: click and submit handlers, the functions that call
// them, and the backend URLs in its source. The model sees these names (not a
// guessed API) and a new control has to call one. Pure: no files, no network.

const RESERVED = new Set(("function return if else for while switch case break continue new typeof instanceof void delete try catch finally throw class const let var async await of in do default export import from true false null undefined this super yield static get set document window console Math JSON Object Array String Number Boolean Date RegExp Promise Error Map Set fetch axios").split(" "));
// At least three characters, so a minified `h` in el.on("click", h) is not a hook.
const isName = n => typeof n === "string" && /^[A-Za-z_$][\w$]{2,60}$/.test(n) && !RESERVED.has(n);

const empty = () => ({ handlers: [], endpoints: [], functions: [], modules: [] });

const CAP = { handlers: 80, endpoints: 80, functions: 60, modules: 80 };

function cleanUrl(u) {
  let s = String(u || "").trim();
  if (!s || /^(data|javascript|blob):/i.test(s) || s.includes("${")) return "";
  s = s.split(/[?#]/)[0];
  if (s.length > 120) s = s.slice(0, 120);
  return s;
}

const add = (list, item, max, key) => {
  if (list.length >= max) return;
  const k = key(item);
  if (list.some(x => key(x) === k)) return;
  list.push(item);
};

// What `text` (one file, or the page's inline scripts) already wires up.
export function scanHooks(text) {
  let src = String(text || "");
  if (src.length > 2_000_000) src = src.slice(0, 1_000_000) + "\n" + src.slice(-1_000_000);
  const out = empty();
  const takeFn = (event, fn) => { if (isName(fn)) add(out.handlers, { event, fn }, CAP.handlers, h => `${h.event}\0${h.fn}`); };

  for (const m of src.matchAll(/\.(?:addEventListener|on|once)\(\s*["'`](click|submit|change|input)["'`]\s*,\s*([A-Za-z_$][\w$]*)/g)) takeFn(m[1], m[2]);
  for (const m of src.matchAll(/\bon(click|submit)\s*=\s*["'`]([A-Za-z_$][\w$]*)\s*\(/g)) takeFn(m[1], m[2]);
  for (const m of src.matchAll(/\bon(click|submit)\s*=\s*([A-Za-z_$][\w$]*)\b/g)) takeFn(m[1], m[2]);
  for (const m of src.matchAll(/\bon(Click|Submit)\s*:\s*([A-Za-z_$][\w$]*)/g)) takeFn(m[1].toLowerCase(), m[2]);

  const methodNear = (index, fallback) => {
    const near = src.slice(index, index + 160);
    const m = /\bmethod\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i.exec(near);
    return m ? m[1].toUpperCase() : fallback;
  };
  for (const m of src.matchAll(/fetch\s*\(\s*["'`]([^"'`]{1,180})["'`]/g)) {
    const url = cleanUrl(m[1]);
    if (url) add(out.endpoints, { method: methodNear(m.index, "GET"), url }, CAP.endpoints, e => `${e.method}\0${e.url}`);
  }
  for (const m of src.matchAll(/\baxios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]{1,180})["'`]/gi)) {
    const url = cleanUrl(m[2]);
    if (url) add(out.endpoints, { method: m[1].toUpperCase(), url }, CAP.endpoints, e => `${e.method}\0${e.url}`);
  }
  for (const m of src.matchAll(/\.open\s*\(\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]\s*,\s*["'`]([^"'`]{1,180})["'`]/gi)) {
    const url = cleanUrl(m[2]);
    if (url) add(out.endpoints, { method: m[1].toUpperCase(), url }, CAP.endpoints, e => `${e.method}\0${e.url}`);
  }

  const called = new Set(out.handlers.map(h => h.fn));
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (out.functions.length >= CAP.functions) break;
    const name = m[1];
    if (!isName(name) || out.functions.includes(name)) continue;
    const body = src.slice(m.index, m.index + 600);
    if (called.has(name) || /fetch\s*\(|\baxios\b|\.open\s*\(/.test(body)) out.functions.push(name);
  }
  for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) if (isName(m[1])) add(out.modules, m[1], CAP.modules, x => x);
  for (const m of src.matchAll(/\bexport\s*\{([^}]{1,2000})\}/g)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (isName(n)) add(out.modules, n, CAP.modules, x => x);
    }
  }
  for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) if (isName(m[1])) add(out.modules, m[1], CAP.modules, x => x);
  return out;
}

export function mergeHookLists(a, b) {
  const out = empty();
  const src = [a || empty(), b || empty()];
  for (const s of src) {
    for (const h of s.handlers || []) add(out.handlers, h, CAP.handlers, x => `${x.event}\0${x.fn}`);
    for (const e of s.endpoints || []) add(out.endpoints, e, CAP.endpoints, x => `${x.method}\0${x.url}`);
    for (const f of s.functions || []) add(out.functions, f, CAP.functions, x => x);
    for (const m of s.modules || []) add(out.modules, m, CAP.modules, x => x);
  }
  return out;
}

// Feature and behavior requests. Visual tweaks ("make the status bar taller",
// "hide this ribbon") stay false so they still get an empty profile slice.
const WANTS = /\b(features?|change this|add (?:a |an |another )?(?:new )?(?:button|card|section|control|widget|panel)|buttons?\b[^.]{0,40}\b(?:that|to|which|for)|when(?:ever)?|shortcuts?|keyboard|hotkeys?|commands?|functions?|modules?|hooks?|backend|apis?|fetch|submit|sav(?:e|es|ed|ing)|timer)\b/i;
export const wantsHooks = request => WANTS.test(String(request || ""));

const SKIP_WORD = new Set("add feature features button buttons this change make makes made app page the and for that with from your into new control widget card section panel when then also all any just like want please here there".split(" "));
const stem = w => (w.length < 4 ? w : w.replace(/ies$/, "y").replace(/s$/, ""));
const wordsOf = s => String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z][a-z0-9]*/g) || [];

// How many of the request's words show up in a function name or URL.
export function hookFits(request, name) {
  const words = (String(request || "").toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter(w => !SKIP_WORD.has(w)).map(stem);
  const have = new Set(wordsOf(name).map(stem));
  let score = 0;
  for (const w of words) {
    if (have.has(w)) score++;
    else if (w.length > 3 && [...have].some(h => h.length > 3 && (h.startsWith(w) || w.startsWith(h)))) score++;
  }
  return score;
}

const pick = (list, label, request, n) => {
  const scored = list.map(x => ({ x, s: hookFits(request, label(x)) }));
  const hit = scored.filter(i => i.s > 0).sort((a, b) => b.s - a.s);
  return (hit.length ? hit : scored).slice(0, n).map(i => i.x);
};

// Prompt block, or "" when the scan found nothing.
export function formatHooks(found, request) {
  if (!found) return "";
  const handlers = pick(found.handlers || [], h => `${h.event} ${h.fn}`, request, 8);
  const functions = pick(found.functions || [], f => f, request, 8);
  const endpoints = pick(found.endpoints || [], e => `${e.method} ${e.url}`, request, 8);
  const modules = pick(found.modules || [], m => m, request, 8);
  if (!handlers.length && !functions.length && !endpoints.length && !modules.length) return "";
  const lines = ["Hooks this app already has (call these from anything you add; names and URLs are from its code, not a guessed API):"];
  for (const h of handlers) lines.push(`- ${h.event} handler: ${h.fn}`);
  for (const f of functions) lines.push(`- function: ${f}`);
  for (const e of endpoints) lines.push(`- backend: ${e.method} ${e.url}`);
  for (const m of modules) lines.push(`- module: ${m}`);
  lines.push("A new control must call one of these when one does that action. If none does, do not add a button that only toggles a class, and do not cover or remove the working control: morse.toast(\"This app has no function for that\").");
  return lines.join("\n");
}

// The same facts, read back out of a profile slice or a formatHooks block.
export function hooksFromText(text) {
  const found = empty();
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = /^- (click|submit|change|input) handler:\s*([A-Za-z_$][\w$]+)/i.exec(line))) found.handlers.push({ event: m[1].toLowerCase(), fn: m[2] });
    else if ((m = /^- function:\s*([A-Za-z_$][\w$]+)/.exec(line))) { if (isName(m[1])) found.functions.push(m[1]); }
    else if ((m = /^- backend:\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/i.exec(line))) found.endpoints.push({ method: m[1].toUpperCase(), url: m[2].replace(/[,.)]+$/, "") });
    else if ((m = /^- module:\s*([A-Za-z_$][\w$]+)/.exec(line))) { if (isName(m[1])) found.modules.push(m[1]); }
    else if ((m = /^- Handlers in its code:\s*(.+)/.exec(line))) {
      for (const h of m[1].matchAll(/\b(click|submit|change|input)\s+([A-Za-z_$][\w$]+)/gi)) if (isName(h[2])) found.handlers.push({ event: h[1].toLowerCase(), fn: h[2] });
    } else if ((m = /^- Functions that call its backend or those handlers:\s*(.+)/.exec(line))) {
      for (const n of m[1].split(/[^A-Za-z0-9_$]+/)) if (isName(n)) found.functions.push(n);
    } else if ((m = /^- Backend calls in its code:\s*(.+)/.exec(line))) {
      for (const e of m[1].matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/gi)) found.endpoints.push({ method: e[1].toUpperCase(), url: e[2].replace(/[,.)]+$/, "") });
    } else if ((m = /^- Modules it exports:\s*(.+)/.exec(line))) {
      for (const n of m[1].split(/[^A-Za-z0-9_$]+/)) if (isName(n)) found.modules.push(n);
    }
  }
  return found;
}

export function collectHooks(context) {
  let found = empty();
  const hooks = context?.hooks;
  if (hooks && typeof hooks === "object") found = mergeHookLists(found, hooks);
  if (typeof hooks === "string") found = mergeHookLists(found, hooksFromText(hooks));
  if (context?.sources) found = mergeHookLists(found, scanHooks(context.sources));
  if (context?.appLogic) found = mergeHookLists(found, hooksFromText(context.appLogic));
  return found;
}

// const/let/var, including a comma declarator: `const a = morse.el(), b = morse.el()`.
const SAFE_EL = /(?:const|let|var|,)\s*([A-Za-z_$][\w$]*)\s*=\s*(?:morse\.el|document\.createElement)\s*\(/g;

// JS that would replace a node the app already rendered. "" when it only
// fills an element the mod itself created (morse.el / createElement).
export function replacesHost(js) {
  const code = String(js || "");
  if (!/\.innerHTML|\.outerHTML|\.replaceWith\s*\(|\.replaceChildren\s*\(/.test(code)) return "";
  const safe = new Set();
  for (const m of code.matchAll(SAFE_EL)) safe.add(m[1]);
  let bad = false;
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(innerHTML|outerHTML)\s*[+]?=/g)) if (!safe.has(m[1])) bad = true;
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(replaceWith|replaceChildren)\s*\(/g)) if (!safe.has(m[1])) bad = true;
  if (/querySelector(?:All)?\s*\([^)]*\)\s*\.\s*(innerHTML|outerHTML)\s*[+]?=/.test(code)) bad = true;
  if (/querySelector(?:All)?\s*\([^)]*\)\s*\.\s*(replaceWith|replaceChildren)\s*\(/.test(code)) bad = true;
  if (!bad) return "";
  return "Setting innerHTML, outerHTML, replaceWith or replaceChildren on an element the app already rendered drops its listeners. Insert a new element beside it with morse.el and call the app's own function from the new control. Do not replace the live node.";
}

const ADDS_CONTROL = /morse\.el\s*\(\s*["'`](button|a|input)\b|createElement\s*\(\s*["'`](button|a|input)\b|<button[\s>/]|<input[\s>/]/i;
const LIFE = /fetch\s*\(|\baxios\s*\.|\.open\s*\(|morse\.app\.command\s*\(|morse\.every\s*\(|morse\.after\s*\(|\.click\s*\(|clipboard|morse\.confirm\s*\(/;

// A button whose handler only flips a class (or similar) and never calls the app.
// A control with no click, submit, input, or change handler is a visual widget
// (a timer readout). Polish still looks at it. Only a handler that never calls
// the app is a fake feature.
function deadControl(js) {
  if (LIFE.test(js)) return false;
  const code = String(js);
  const handled = /\bon\s*:\s*\{[\s\S]{0,800}?\b(?:click|submit|input|change)\b|\bon(?:click|submit)\s*=|\.addEventListener\s*\(\s*["'`](?:click|submit|change|input)|(?:^|[^.\w$])(?:click|submit|input|change)\s*\([^)]*\)\s*\{/.test(code);
  if (!handled) return false;
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\b(?:click|submit|input|change|keydown|keyup)\s*\(\s*\)\s*\{/g, "{")
    .replace(/morse\s*\.\s*[A-Za-z_$][\w$]*/g, " ");
  const calls = [...stripped.matchAll(/\b([A-Za-z_$][\w$]{2,})\s*\(/g)].map(m => m[1]);
  const boring = new Set("if for while switch catch function return querySelector querySelectorAll getElementById getAttribute setAttribute removeAttribute preventDefault stopPropagation Number String Boolean parseInt parseFloat Math JSON Object Array Date RegExp console setTimeout setInterval requestAnimationFrame encodeURIComponent decodeURIComponent classList toggle contains add append prepend before after remove appendChild".split(" "));
  return !calls.some(c => !boring.has(c));
}

export const UNWIRED_ERROR = "That control wasn't wired to this app, so Morse removed it.";

// null when the draft is fine. Otherwise { model, user }: what the model
// should fix, and the short line the bar shows after the edit is rolled back.
export function unwiredFeature(draft, context, request) {
  const js = String(draft?.js || "");
  const found = collectHooks(context);
  const listed = (found.handlers.length + found.functions.length + found.endpoints.length + found.modules.length) > 0;
  if ((!wantsHooks(request) && !listed) || !ADDS_CONTROL.test(js)) return null;
  const items = [
    ...found.handlers.map(h => ({ name: h.fn, score: hookFits(request, h.fn) })),
    ...found.functions.map(f => ({ name: f, score: hookFits(request, f) })),
    ...found.modules.map(m => ({ name: m, score: hookFits(request, m) })),
    ...found.endpoints.map(e => ({ name: e.url, score: hookFits(request, `${e.method} ${e.url}`) })),
  ];
  const fits = items.filter(i => i.score > 0);
  const unique = [...new Set(fits.map(i => i.name))];
  if (unique.length && !unique.some(name => js.includes(name))) {
    return {
      model: `The new control does not call this app. Call one of these from its click or submit (they are in the app's code): ${unique.slice(0, 6).join(", ")}. A button that only toggles a class does not do the feature, and it must not cover or remove the working control.`,
      user: UNWIRED_ERROR,
    };
  }
  if (!unique.length && deadControl(js)) {
    return {
      model: "The new control only toggles a class or restyles itself, and this app has no function listed for that action. Do not pretend it works. If nothing in the app does it, morse.toast(\"This app has no function for that\") and do not cover, hide, or replace the working control.",
      user: UNWIRED_ERROR,
    };
  }
  return null;
}
