// Parses a model response into a mod draft. Works on partial (streaming) text,
// so the runtime can apply CSS while the model is still writing it.
//
// Expected shape:
//   TITLE: Word count under the composer
//   ```css
//   ...
//   ```
//   ```js
//   ...
//   ```

const FENCE = /```([a-zA-Z]*)[^\n]*\n([\s\S]*?)(```|$)/g;

export function parseModResponse(text) {
  const out = { title: "", css: "", js: "", cssComplete: false, jsComplete: false };
  const t = text.match(/^\s*TITLE:\s*(.+)$/m);
  if (t) out.title = t[1].trim().slice(0, 80);

  for (const m of text.matchAll(FENCE)) {
    const lang = m[1].toLowerCase();
    const body = m[2];
    const closed = m[3] === "```";
    if (lang === "css" && !out.css) { out.css = body; out.cssComplete = closed; }
    else if ((lang === "js" || lang === "javascript") && !out.js) { out.js = body; out.jsComplete = closed; }
  }
  return out;
}

// Returns the prefix of a (possibly partial) stylesheet that ends on a complete
// top-level rule, so applying it never leaves a half-written declaration.
export function completeCssPrefix(css) {
  let depth = 0, end = 0, inStr = null, inComment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (inComment) { if (c === "*" && css[i + 1] === "/") { inComment = false; i++; } continue; }
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (c === "/" && css[i + 1] === "*") { inComment = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) end = i + 1; if (depth < 0) depth = 0; }
  }
  return css.slice(0, end);
}
