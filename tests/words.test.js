// The words people read: no developer jargon in anything Morse shows a
// person (docs/WRITING.md, "Words people don't know"). Scans every string in
// runtime/src that reads like a sentence or a label, and the visible text of
// the extension's pages, the share page and the website.
//
// Places written for developers are allowed explicitly below, each with why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), "utf8");

// Words a normal person doesn't know. Each is matched as a whole word, case
// as written unless noted.
const BANNED = [
  [/\bCSS\b/, "CSS"],
  [/\bJavaScript\b|\bJS\b/, "JavaScript"],
  [/\bselectors?\b/i, "selector"],
  [/\bDOM\b/, "DOM"],
  [/\bCDP\b/, "CDP"],
  [/\buserScripts\b|(?<!Allow )\buser scripts\b/, "user scripts (say “Allow User Scripts”)"],
  [/\bservice worker\b|\bcontent script\b|\bbackground page\b/i, "extension internals"],
  [/\bruntime\b/i, "runtime"],
  [/\b(provider|backend|harness|daemon)s?\b/i, "provider/backend/harness/daemon"],
  [/\bendpoints?\b|\bbase URL\b/i, "endpoint"],
  [/\blocalhost\b|\b127\.0\.0\.1\b/, "localhost"],
  [/\binject(ed|s|ion)?\b/i, "inject"],
  [/\belements?\b/i, "element (say “part of the page”)"],
  [/\bAPI\b(?! key)/, "API (fine only in “API key”)"],
  [/\bprompt\b/i, "prompt (say “request”)"],
  [/\b(enable|disable)d?\b|\btoggle\b/i, "enable/disable/toggle (say turn on, turn off)"],
  [/\bcustomi[sz](e|ation)\b/i, "customize (say change)"],
  [/\bGod mode\b/i, "God mode (say Edit tools)"],
  [/\b(hotkey|keybinding)s?\b/i, "hotkey (say shortcut)"],
];

// Developer-only or code-view text, allowed on purpose. [file, text it contains, why]
const ALLOWED = [
  ["runtime/src/80-modals.js", "Style <span class=\"dim\">CSS</span>", "the Edit code view: people chose to look at code"],
  ["runtime/src/80-modals.js", "JavaScript, can use the", "the Edit code view"],
  ["runtime/src/63-control.js", "Style <span class=\"dim\">CSS</span>", "Show code, folded under the install review"],
  ["runtime/src/63-control.js", "JavaScript, runs with the", "Show code, folded under the install review"],
  ["extension/welcome.js", "node daemon/cli.js setup --pair", "a command to type, shown in <code> like the README's install steps"],
];
// Files that never show text to a person: what the model reads, styles, plumbing.
const SKIP_FILES = new Set([
  "20-context.js", // the page outline sent to the model
  "01-rpc.js", "02-state.js", "05-radar.js", "10-dom.js", "90-effect.js", "94-editable-host.js",
]);
const allowed = (file, s) => ALLOWED.some(([f, t]) => f === file && s.includes(t));

// ---- strings in JS source: a small tokenizer that knows comments, strings,
// template literals (with nested ${}) and regex literals.
function jsStrings(src) {
  const out = [];
  let i = 0, line = 1, last = "";
  const regexAllowed = () => !last || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(last);
  const push = (text, at) => out.push({ text, line: at });
  function readTemplate() { // at the char after the opening backtick; returns the text with ${…} as a space
    let text = "", depthStart = line;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { i++; break; }
      if (c === "$" && src[i + 1] === "{") {
        i += 2; text += " ";
        let depth = 1;
        while (i < src.length && depth) { // nested code: strings in it are pushed on their own
          const d = src[i];
          if (d === "{") { depth++; i++; continue; }
          if (d === "}") { depth--; i++; continue; }
          if (d === "\n") line++;
          if (d === "'" || d === '"') { const at = line; push(readQuoted(d), at); continue; }
          if (d === "`") { i++; const at = line; push(readTemplate(), at); continue; }
          if (d === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
          if (d === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 2; continue; }
          i++;
        }
        continue;
      }
      if (c === "\n") line++;
      text += c; i++;
    }
    void depthStart;
    return text;
  }
  function readQuoted(q) {
    let text = "";
    i++;
    while (i < src.length && src[i] !== q && src[i] !== "\n") { if (src[i] === "\\") { text += src[i + 1]; i += 2; continue; } text += src[i++]; }
    i++;
    return text;
  }
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); line += src.slice(i, e).split("\n").length - 1; i = e + 2; continue; }
    if (c === "'" || c === '"') { const at = line; push(readQuoted(c), at); last = "x"; continue; }
    if (c === "`") { i++; const at = line; push(readTemplate(), at); last = "x"; continue; }
    if (c === "/" && regexAllowed()) { // a regex literal: skip it, classes and all
      i++;
      let cls = false;
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; else if (src[i] === "/" && !cls) break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] || "")) i++;
      last = "x";
      continue;
    }
    const w = src.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (w) { last = w[0]; i += w[0].length; continue; }
    last = c; i++;
  }
  return out;
}

// What a person would read: tags and placeholders out, then only text that
// looks like words (a sentence, a label), not a class list or a selector.
function readable(s) {
  const text = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<([a-z][\w-]*)([^>]*)>/gi, (_, tag, attrs) => " " + [...attrs.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[2]).join(" ") + " ")
    .replace(/<\/[a-z][\w-]*>/gi, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}[,.:'’]?\s+[A-Za-z]|[A-Za-z]{2,}['’][a-z]/.test(text)) return "";
  if (/[{};]|=>|^\.{0,2}\/|^[.#[*:]/.test(text)) return ""; // style rules, code, paths, selectors
  if (!/^[A-Z]/.test(text) && /\[[\w-]+[=\]]|\s>\s|(^|\s)\.[a-z]/.test(text)) return ""; // "panel article[data-id]"
  return text;
}

function hits(file, strings) {
  const found = [];
  for (const { text, line } of strings) {
    if (/console\.|\[morse\]/.test(text)) continue;
    // Buttons for an unsaved change say Save and Undo; a saved mod's follow-up button says Change.
    for (const m of text.matchAll(/>\s*(Refine|Keep|Remove|Apply)\s*<\/button>/g)) found.push(`${file}:${line} button “${m[1]}” (say Save, Undo or Change)`);
    const r = readable(text);
    if (!r || allowed(file, text)) continue;
    for (const [re, why] of BANNED) if (re.test(r)) found.push(`${file}:${line} ${why}: “${r.slice(0, 120)}”`);
  }
  return found;
}

// Strings passed to console.* are for developers: drop those calls first.
const noConsole = src => src.replace(/console\.(log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, "");

test("the runtime shows no developer jargon", () => {
  const found = [];
  let seen = 0;
  for (const f of readdirSync(new URL("runtime/src/", ROOT)).filter(f => f.endsWith(".js") && !/^9[89]-/.test(f) && !SKIP_FILES.has(f))) {
    const file = `runtime/src/${f}`;
    const strings = jsStrings(noConsole(read(file)));
    seen += strings.filter(s => readable(s.text)).length;
    found.push(...hits(file, strings));
  }
  assert.ok(seen > 400, `the scan reads the runtime's sentences and labels (saw ${seen})`);
  assert.deepEqual(found, [], `jargon a person would read:\n${found.join("\n")}`);
});

// Visible text of a page: text between tags and the attributes people see,
// plus the strings its own scripts show (inline modules are scanned like JS).
function pageStrings(src) {
  const scripts = [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => jsStrings(noConsole(m[1])));
  // Comments, scripts, styles and code samples (<pre>, <code>) are not prose;
  // blank them out but keep their lines, so line numbers stay right.
  const blank = m => m.replace(/[^\n]/g, "");
  const html = src.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style|pre|code)\b[\s\S]*?<\/\1>/gi, blank);
  return [...html.split("\n").map((text, k) => ({ text, line: k + 1 })), ...scripts];
}

test("the extension's pages, the share page and the website show no developer jargon", () => {
  const files = [
    ...readdirSync(new URL("extension/", ROOT)).filter(f => f.endsWith(".html")).map(f => `extension/${f}`),
    ...readdirSync(new URL("extension/", ROOT)).filter(f => /^(popup|popup-control|popup-states|welcome)\.js$/.test(f)).map(f => `extension/${f}`),
    "share/install.html", "site/index.html", "site/gallery.html",
  ];
  const found = [];
  for (const file of files) {
    const src = read(file);
    let strings = file.endsWith(".js") ? jsStrings(noConsole(src)) : pageStrings(src);
    // The share page and the gallery show a mod's code on purpose, under these headings.
    strings = strings.filter(s => !/^(Style \(CSS\)|Script \(JavaScript\))/.test(readable(s.text)));
    found.push(...hits(file, strings));
  }
  assert.deepEqual(found, [], `jargon a person would read:\n${found.join("\n")}`);
});

test("the scanner finds jargon, and skips code, comments and regexes", () => {
  const src = [
    "// A comment about the DOM and CSS selectors",
    "const re = /user scripts|CSS/i;",
    "const sel = \".panel article[data-id=x]\";",
    "toast(`Couldn't inject the CSS into ${where}.`);",
    "el.title = \"Pick an element\";",
    "console.warn(\"[morse] the runtime failed\", e);",
    "const fine = \"Turn on “Allow User Scripts” for Morse\";",
    "b.innerHTML = `<button data-gl=\"keep\">Keep</button><button data-gl=\"remove\">Undo</button>`;",
  ].join("\n");
  const found = hits("x.js", jsStrings(noConsole(src)));
  assert.equal(found.length, 4, found.join("\n")); // inject, CSS, element, Keep
  assert.ok(found.some(f => /inject/.test(f)) && found.some(f => /CSS/.test(f)) && found.some(f => /element/.test(f)) && found.some(f => /“Keep”/.test(f)));
  assert.ok(found.every(f => /^x\.js:(4|5|8) /.test(f)), "only the toast, the title and the button");
});
