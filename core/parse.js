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

// speed: what can go on the page while the model is still writing. Like
// completeCssPrefix, plus the finished declarations of a rule still being
// written (and finished rules inside an open @media), with its braces closed:
//   "a{color:red} b{margin:0;padding:4p"  ->  "a{color:red} b{margin:0;}"
// so each property shows up as soon as its ";" arrives, not when the rule ends.
const CONTAINER = /^@(media|supports|container|layer|document|scope|starting-style|keyframes|-webkit-keyframes)\b/i;
export function liveCss(css) {
  const stack = []; // per open block: true if it holds rules, false if declarations
  let end = 0, cut = 0, cutDepth = 0, from = 0, paren = 0, inStr = null, inComment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (inComment) { if (c === "*" && css[i + 1] === "/") { inComment = false; i++; } continue; }
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (c === "/" && css[i + 1] === "*") { inComment = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (paren) continue;
    else if (c === "{") { stack.push(CONTAINER.test(css.slice(from, i).trim())); from = i + 1; }
    else if (c === "}") {
      stack.pop();
      from = i + 1;
      if (stack.length) { cut = i + 1; cutDepth = stack.length; } else { end = i + 1; cut = 0; }
    } else if (c === ";") {
      from = i + 1;
      if (stack.length && !stack[stack.length - 1]) { cut = i + 1; cutDepth = stack.length; }
    }
  }
  return cut > end ? css.slice(0, cut) + "}".repeat(cutDepth) : css.slice(0, end);
}
