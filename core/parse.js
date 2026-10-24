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
  return liftDeepCss(out);
}

// Top-level rules of a stylesheet: [{ text, selector }], plus what isn't one.
function topRules(css) {
  const rules = [];
  let depth = 0, start = 0, inStr = null, inComment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (inComment) { if (c === "*" && css[i + 1] === "/") { inComment = false; i++; } continue; }
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (c === "/" && css[i + 1] === "*") { inComment = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && depth > 0 && --depth === 0) {
      const text = css.slice(start, i + 1);
      rules.push({ text, selector: text.slice(0, text.indexOf("{")).replace(/\/\*[\s\S]*?\*\//g, "").trim() });
      start = i + 1;
    }
  }
  return { rules, rest: css.slice(start) };
}

// CSS rules that reach into a shadow root or frame ("host >>> inside { … }")
// can't work in a page stylesheet: they move to the JS as morse.css(…), which
// puts them inside each host (core/kit.js).
export function liftDeepCss(draft) {
  if (!draft.css.includes(">>>")) return draft;
  const { rules, rest } = topRules(draft.css);
  const deep = rules.filter(r => r.selector.includes(">>>") && !r.selector.startsWith("@"));
  if (!deep.length) return draft;
  const css = rules.filter(r => !deep.includes(r)).map(r => r.text).join("") + rest;
  const lift = `morse.css(${JSON.stringify(deep.map(r => r.text.trim()).join("\n"))});\n`;
  return { ...draft, css: css.replace(/^\s*\n/, ""), js: lift + draft.js };
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
