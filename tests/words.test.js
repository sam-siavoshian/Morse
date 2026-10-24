// The words people read: no developer jargon in anything Morse shows a
// person (docs/WRITING.md, "Words people don't know"). Scans every string in
// runtime/src that reads like a sentence or a label, and the visible text of
// the extension's pages, the share page and the website.
//
// Places written for developers are allowed explicitly below, each with why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import en from "../core/locales/en.js";
import { jsStrings, readable, noConsole } from "./helpers/strings.js";

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


test("the runtime shows no developer jargon", () => {
  const found = [];
  let seen = 0;
  for (const f of readdirSync(new URL("runtime/src/", ROOT)).filter(f => f.endsWith(".js") && !/^9[89]-/.test(f) && !SKIP_FILES.has(f))) {
    const file = `runtime/src/${f}`;
    const strings = jsStrings(noConsole(read(file)));
    seen += strings.filter(s => readable(s.text)).length;
    found.push(...hits(file, strings));
  }
  // Most of what the runtime shows now comes from the English catalog (scanned below).
  const catalog = catalogStrings().filter(s => readable(s.text)).length;
  assert.ok(seen + catalog > 400, `the scan reads the runtime's sentences and labels (saw ${seen} in the source, ${catalog} in the catalog)`);
  assert.deepEqual(found, [], `jargon a person would read:\n${found.join("\n")}`);
});

// ---- the English catalog (core/locales/en.js): what people read in every
// part of Morse that says it through t(). Code shown as code (<code>…</code>)
// and {placeholders} aren't prose; the code view's headings are allowed, as
// in the source above.
const CATALOG_ALLOWED = new Set([
  "install.code.style", // "Style (CSS)": the share page's code view
  "install.code.script", // "Script (JavaScript)": the share page's code view
  "code.scriptHelp", // the Edit code view, under its Script heading
  "code.scriptRuns", // the Show code view, under its Script heading
]);
function catalogStrings() {
  return Object.entries(en).flatMap(([id, v]) => (typeof v === "object" ? Object.values(v) : [v]).map(text => ({
    id, line: id, text: String(text).replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, " ").replace(/\{\w+\}/g, "something"),
  })));
}

test("the English catalog shows no developer jargon", () => {
  const strings = catalogStrings().filter(s => !CATALOG_ALLOWED.has(s.id));
  assert.ok(strings.filter(s => readable(s.text)).length > 400, "the scan reads the catalog's sentences and labels");
  const found = hits("core/locales/en.js", strings);
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

test("the extension's pages, the share page, the website and Morse Desktop show no developer jargon", () => {
  const files = [
    ...readdirSync(new URL("extension/", ROOT)).filter(f => f.endsWith(".html")).map(f => `extension/${f}`),
    ...readdirSync(new URL("extension/", ROOT)).filter(f => /^(popup|popup-control|popup-states|welcome)\.js$/.test(f)).map(f => `extension/${f}`),
    "share/install.html", "site/index.html", "site/gallery.html",
    "desktop-app/ui/index.html", "desktop-app/ui/app.js", // Morse Desktop's window
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

// ---- the user pages in docs/ (not docs/dev, not the style guide itself).
// Code in backticks and code blocks is skipped (commands and file names are
// fine), and so are link addresses; link text, headings and tables are read.
function markdownProse(src) {
  let fence = null;
  return src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, "")).split("\n").map((l, k) => {
    const f = /^\s*(```|~~~)/.exec(l);
    if (fence) { if (f && l.trim().startsWith(fence)) fence = null; return { text: "", line: k + 1 }; }
    if (f) { fence = f[1]; return { text: "", line: k + 1 }; }
    const text = l
      .replace(/(`+)[^`]*?\1/g, " ")            // inline code
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images: keep the alt text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // links: keep the text
      .replace(/<\/?(kbd|b|i|em|strong|br)\s*\/?>/gi, "")
      .replace(/[*_|]/g, " ");
    return { text, line: k + 1 };
  });
}

// Words a user page may use on purpose: [file, text the line contains, why].
const DOCS_ALLOWED = [
  ["docs/privacy.md", "API address you entered", "the privacy policy names exactly where data goes (site/privacy.html is built from it)"],
  ["docs/privacy.md", "the CSS rules that style", "the privacy policy names exactly what is sent"],
  ["docs/privacy.md", "Anthropic API key", "the privacy policy names the account whose terms apply"],
];

test("the user pages in docs/ show no developer jargon", () => {
  const files = readdirSync(new URL("docs/", ROOT)).filter(f => f.endsWith(".md") && f !== "WRITING.md").map(f => `docs/${f}`);
  assert.ok(files.length >= 10, `scans the user pages (found ${files.length})`);
  const found = [];
  for (const file of files) {
    const strings = markdownProse(read(file)).filter(s => !DOCS_ALLOWED.some(([f, t]) => f === file && s.text.includes(t)));
    found.push(...hits(file, strings));
  }
  assert.deepEqual(found, [], `jargon a person would read:\n${found.join("\n")}`);
});

test("the docs scanner reads prose, and skips code and link addresses", () => {
  const src = "Run `morse config --provider openai` and see [the guide](dev/runtime.md).\n```\nCSS here\n```\nThe CSS changes.";
  const found = hits("x.md", markdownProse(src));
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0], /^x\.md:5 CSS/);
});
