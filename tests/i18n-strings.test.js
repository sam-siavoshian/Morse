// Every word the runtime shows goes through t() (core/i18n.js), so it reads
// in the person's language. Scans runtime/src and runtime/boot.js the way
// tests/words.test.js does: a sentence or a label written as a literal, a
// word between tags, or a literal title, aria-label, placeholder or alt is
// an English string that bypassed the catalog.
//
// What is allowed stays English on purpose, each with why (ALLOWED below).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { jsStrings, readable, noConsole } from "./helpers/strings.js";

const ROOT = new URL("../", import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), "utf8");

// Files that never show words to a person.
const SKIP_FILES = new Set([
  "20-context.js", // the page outline sent to the model
  "01-rpc.js", "02-state.js", "05-radar.js", "90-effect.js", "94-editable-host.js",
]);

// English on purpose: [file, text it contains, why]. Keep this short.
export const ALLOWED = [
  ["runtime/src/00-trusted-html.js", "isn't a position", "an error for developers, about the code"],
  ["runtime/src/56-settings.js", "Language", "the English word beside the translated label, so anyone can find the setting"],
  ["runtime/src/58-suggest.js", "Sponsored", "matches the page's own English labels, to spot ads"],
  ["runtime/src/64-guard.js", "this page", "matches core/guard.js's English refusal to pick the translated words (guard.refused.*)"],
  ["runtime/src/64-guard.js", "Morse didn't", "the fallback for a refusal core/guard.js may add later"],
  ["runtime/src/65-a11y.js", "Accessibility fixes:", "the request saved with the fixes lists them as core/a11y.js words them"],
  ["runtime/src/70-panel.js", "matched nothing on the page", "the reason Fix it gives the model"],
  ["runtime/src/70-panel.js", "neither did", "the reason Fix it gives the model"],
  ["runtime/src/70-panel.js", "It stopped working.", "the reason Fix it gives the model"],
  ["runtime/src/64-guard.js", "Morse paused it", "the reason Fix it gives the model"],
  ["runtime/src/64-guard.js", "whole page", "matches core/guard.js's English refusal to pick the translated words (guard.refused.*)"],
  ["runtime/src/97-boot.js", "Morse paused it", "the reason Fix it gives the model"],
  ["runtime/src/68-describe.js", "Describe this picture", "the request sent to the model"],
  ["runtime/src/72-style.js", "the window", "what the model reads about the page (Fit to this site)"],
  ["runtime/src/63-control.js", "Morse", "the product's name, on the control notice"],
  ["runtime/boot.js", "The page was suspended", "an error for developers (the console)"],
  ["runtime/boot.js", "the Morse UI did not start", "an error for developers (the console)"],
  ["runtime/boot.js", "couldn't load", "a warning for developers (the console)"],
];

// The person-facing text in one string: a sentence or label, the words
// between tags, and literal title / aria-label / placeholder / alt values.
// Not words: class lists ("gm-menu menu"), selector lists ("input, textarea"),
// CSS values ("600 34px …", "translate( px, px)") and HTML comments. Text
// that starts lowercase counts only when it reads like English ("is marked
// on the page"), not like a list of names.
const WORDY = /\b(the|a|an|to|is|it|its|on|of|and|or|with|this|that|was|be|can|not|no|your|you|for|in|at|from|did|does)\b/;
const wordsish = s => !/translate\(|\d+px|<!--|^[\w-]+(,\s*[\w-]+)+$/.test(s) && (/^[A-Z]/.test(s) || (WORDY.test(s) && /\s/.test(s)));
function visible(raw) {
  const out = [];
  const r = readable(raw).replace(/^[^A-Za-z]+/, ""); // "${title}. That didn't work" reads from "That"
  if (r && wordsish(r)) out.push(r);
  for (const m of raw.matchAll(/>\s*([A-Z][a-z]{2,}(?:[ -][A-Za-z]+)*)\s*</g)) out.push(m[1]);
  for (const m of raw.matchAll(/\b(?:title|aria-label|placeholder|alt)="([A-Z][a-z][^"$]*)"/g)) out.push(m[1]);
  return [...new Set(out)];
}

export function untranslated() {
  const found = [];
  const files = readdirSync(new URL("runtime/src/", ROOT)).filter(f => f.endsWith(".js") && !/-css\.js$/.test(f) && !SKIP_FILES.has(f)).map(f => `runtime/src/${f}`);
  files.push("runtime/boot.js");
  for (const file of files) {
    const src = read(file);
    // A single word handed straight to the screen: a label set from code, or a toast or announcement.
    for (const m of src.matchAll(/(?:setAttribute\(\s*"(?:aria-label|title|placeholder|alt)",\s*|\b(?:announce|toast|controlToast|say|note)\(\s*)(["'`])([A-Z][^"'`$]*)\1/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      if (!ALLOWED.some(([f, s]) => f === file && m[2].includes(s))) found.push(`${file}:${line} “${m[2].slice(0, 100)}”`);
    }
    for (const { text, line } of jsStrings(noConsole(src))) {
      if (/\[morse\]/.test(text)) continue;
      for (const v of visible(text)) {
        if (ALLOWED.some(([f, s]) => f === file && (v.includes(s) || text.includes(s)))) continue;
        found.push(`${file}:${line} “${v.slice(0, 100)}”`);
      }
    }
  }
  return found;
}

test("every word the runtime shows goes through t()", () => {
  const found = untranslated();
  assert.deepEqual(found, [], `English strings that bypass t() (move them to core/locales/en.js, or allow them on purpose):\n${found.join("\n")}`);
});

test("every allowed string is still in its file", () => {
  const gone = ALLOWED.filter(([f, text]) => !read(f).includes(text)).map(([f, text]) => `${f}: “${text}”`);
  assert.deepEqual(gone, [], "remove these from ALLOWED");
});

test("the scanner finds a label, a sentence and an attribute, and skips t() and code", () => {
  const src = 'const a = `<button>Share</button>`; const b = "That didn\'t work. Try again."; const c = `<i title="Close this"></i>`;'
    + ' const d = t("btn.share"); const e = `.panel > b`; // A comment, not shown';
  const got = jsStrings(src).flatMap(s => visible(s.text));
  assert.deepEqual(got.sort(), ["Close this", "Share", "That didn't work. Try again."].sort());
});
