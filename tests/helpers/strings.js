// The strings in JS source that a person would read: a small tokenizer that
// knows comments, strings, template literals (with nested ${}) and regex
// literals, and a filter for text that reads like words. Used by
// tests/words.test.js (no jargon) and tests/i18n-strings.test.js (every
// word goes through t()).
export function jsStrings(src) {
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
export function readable(s) {
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

// Strings passed to console.* are for developers: drop those calls first.
export const noConsole = src => src.replace(/console\.(log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, "");
