// Code that would obviously break the page, found before it runs: CSS that
// hides or blanks the whole page, a loop with no way out, reloading or
// leaving the page when the person didn't ask for that, wiping the page.
//
// core/engine.js checks every draft with draftHarm() and, instead of running
// it, gives the model one repair round with a plain description; the runtime
// (runtime/src/64-guard.js) checks saved mods' CSS with cssHidesPage() before
// applying it. Pure and dependency-free: runtime/bundle.js inlines it.
//
// These are deliberately narrow: only what is unmistakable. The kit's budgets
// (core/kit.js) and the desktop host's freeze check (daemon/guard.js) catch
// what can only be seen while the code runs.

// Mod code that hasn't finished after this long has frozen the page
// (daemon/guard.js on the desktop, extension/background.js exec).
export const HANG_MS = 4000;
export const FROZE_ERROR = "Morse stopped it because it froze the page: its code ran for seconds without finishing (an endless loop?). "
  + "Never loop without an exit: react to the page with morse.watch, or repeat with morse.every.";

// Selectors that mean "the whole page".
const PAGE = new Set(["*", "html", "body", ":root", "html body", "html>body", "html *", "body *", "* *", ":root *", "html>*"]);
const isPage = sel => {
  const s = sel.trim().toLowerCase().replace(/\s*([>+~])\s*/g, "$1").replace(/\s+/g, " ");
  return PAGE.has(s) || /^\*:not\([^()]*\)$/.test(s);
};
// What hides or blanks an element and everything in it; visibility and
// pointer-events can be turned back on lower down, so they only count when
// nothing in the CSS does that.
const HIDES = [
  [/^display$/, /^none$/, null],
  [/^opacity$/, /^(0|0?\.0+|0%)$/, null],
  [/^content-visibility$/, /^hidden$/, null],
  [/^filter$/, /^opacity\(\s*(0|0?\.0+|0%)\s*\)$/, null],
  [/^visibility$/, /^(hidden|collapse)$/, /visibility\s*:\s*visible/i],
  [/^pointer-events$/, /^none$/, /pointer-events\s*:\s*(auto|all|visible|painted|fill|stroke|bounding-box)/i],
];

// The first rule that hides, blanks or locks the whole page, as text
// ("* { display: none }"), or "".
export function cssHidesPage(css) {
  const text = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (!text.trim()) return "";
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").filter(isPage);
    if (!sels.length) continue;
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).replace(/!\s*important/i, "").trim().toLowerCase();
      for (const [p, v, escape] of HIDES) {
        if (p.test(prop) && v.test(value) && !(escape && escape.test(text))) return `${sels[0].trim()} { ${prop}: ${value} }`;
      }
    }
  }
  return "";
}

// JS with strings, template literals and comments blanked out, so patterns
// only match code. (Regex literals are rare in mods and left as they are.)
function codeOnly(js) {
  let out = "", q = null;
  for (let i = 0; i < js.length; i++) {
    const c = js[i];
    if (q) {
      if (c === "\\") { out += "  "; i++; continue; }
      if (c === q) { q = null; out += c; continue; }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === "/" && js[i + 1] === "/") { const e = js.indexOf("\n", i); i = e < 0 ? js.length : e - 1; continue; }
    if (c === "/" && js[i + 1] === "*") { const e = js.indexOf("*/", i + 2); i = e < 0 ? js.length : e + 1; out += " "; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    out += c;
  }
  return out;
}

// From an opening "{" at `at`, the index just after its matching "}".
function blockEnd(code, at) {
  let depth = 0;
  for (let i = at; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i + 1;
  }
  return code.length;
}

// A loop whose condition is always true, with no break, return, throw or
// await anywhere inside: it can only end by freezing the page.
function endlessLoop(code) {
  const exits = /\b(break|return|throw|await|yield)\b/;
  for (const m of code.matchAll(/\b(while\s*\(\s*(?:true|1|!0|!false)\s*\)|for\s*\(\s*[^;()]*;\s*;\s*[^)]*\))/g)) {
    let i = m.index + m[0].length;
    while (/\s/.test(code[i] || "")) i++;
    const body = code[i] === "{" ? code.slice(i, blockEnd(code, i)) : code.slice(i, code.indexOf(";", i) + 1 || code.length);
    // `do { } while (true)`: the body is the block before it.
    const before = code.slice(0, m.index).trimEnd();
    if (m[0].startsWith("while") && before.endsWith("}")) {
      let depth = 0, j = before.length - 1;
      for (; j >= 0; j--) { if (before[j] === "}") depth++; else if (before[j] === "{" && --depth === 0) break; }
      if (j >= 0 && /\bdo\s*$/.test(before.slice(0, j))) { if (!exits.test(before.slice(j))) return m[0].replace(/\s+/g, " "); continue; }
    }
    if (!exits.test(body)) return m[0].replace(/\s+/g, " ");
  }
  return "";
}

// Requests where reloading or going somewhere else is the point.
const WANTS_NAV = /\b(reload|refresh|redirect|navigat\w*|go(es)? (to|back)|open\w*|links?|url|address|visit|jump to|take me|send me|leave)\b/i;

// One thing about a draft that would break the page:
// { model: what went wrong, for the repair round; user: the plain sentence
// for the bar if the second try is no better }, or null.
export function draftHarm({ css = "", js = "" } = {}, request = "") {
  const hidden = cssHidesPage(css);
  if (hidden) return hideHarm(`Your CSS hides the whole page (\`${hidden}\`).`);
  if (!String(js).trim()) return null;
  const code = codeOnly(String(js));
  const loop = endlessLoop(code);
  if (loop) {
    return { kind: "loop", user: "The change would have frozen this page, so Morse didn't run it. Try other words.",
      model: `Your JS has \`${loop}\` with no break, return or await inside, so it never ends and freezes the page. Never wait or poll in a loop: react to the page with morse.watch(selector, fn), or repeat with morse.every(ms, fn).` };
  }
  const wipe = code.match(/\bdocument\s*\.\s*(?:(?:body|documentElement)\s*\.\s*(?:innerHTML|outerHTML|innerText|textContent)\s*\+?=(?!=)|write(?:ln)?\s*\(|open\s*\(\s*\))/);
  if (wipe) {
    return { kind: "wipe", user: "The change would have replaced this whole page, so Morse didn't run it. Try other words.",
      model: `Your JS replaces the whole page (\`${wipe[0].replace(/\s+/g, "")}\`), which breaks the app. Change only the parts the user asked about, and add new things with morse.el.` };
  }
  const nav = code.match(/\blocation\s*\.\s*(?:reload|assign|replace)\s*\(|(?<![\w$.])(?:(?:window|document|self|top|globalThis)\s*\.\s*)?location(?:\s*\.\s*href)?\s*=(?!=)|\bhistory\s*\.\s*go\s*\(\s*0?\s*\)/);
  if (nav && !WANTS_NAV.test(String(request))) {
    return { kind: "nav", user: "The change would have reloaded or left this page, so Morse didn't run it. Try other words.",
      model: `Your JS reloads or leaves the page (\`${nav[0].replace(/\s+/g, "")}\`), and the user didn't ask for that. Change the page in place instead.` };
  }
  const jsHide = String(js).match(/\bdocument\s*\.\s*(?:body|documentElement)\s*\.\s*style\s*\.\s*(?:display\s*=\s*["'`]none|visibility\s*=\s*["'`]hidden|pointerEvents\s*=\s*["'`]none|opacity\s*=\s*["'`]?0?\.?0*["'`]?\s*[;\n)])/);
  if (jsHide) return hideHarm(`Your JS hides the whole page (\`${jsHide[0].replace(/\s+/g, "").replace(/[;)]$/, "")}\`).`);
  for (const m of String(js).matchAll(/\bmorse\s*\.\s*css\s*\(\s*(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)) {
    const inner = cssHidesPage(m[1].slice(1, -1));
    if (inner) return hideHarm(`Your JS adds CSS that hides the whole page (\`${inner}\`).`);
  }
  return null;
}
function hideHarm(what) {
  return { kind: "hide", user: "The change would have hidden this whole page, so Morse didn't apply it. Try other words.",
    model: `${what} That leaves the page blank or impossible to click. Never hide html, body, :root or *, or make them transparent or unclickable. Hide or change only the parts the user asked about.` };
}

// A short fingerprint of CSS, so a person's "Turn back on" for CSS that
// hides the page holds for that CSS only (runtime/src/64-guard.js).
export function cssKey(css) {
  let h = 0;
  for (const ch of String(css || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

// ---- after it lands: did the change hide most of the page?
// cssHidesPage only knows "the whole page" by name. A class the sidebar and
// the main content share (`div.interior` on nodejs.org/api) blanks the page
// just as well, and only the page itself can tell. pageCollapse runs in the
// page (the hosts send its source), once per draft: what shows at 48 spots
// of the window without the change (Morse's own draft style, `id`, set
// aside) and with it, in one task, so nothing is painted in between.
// -> { before, after }: spots that show a part of the page, not the bare
// page behind it (Morse's own UI doesn't count either way).
export function pageCollapse(css, id = "") {
  const W = innerWidth, H = innerHeight;
  if (!W || !H || !document.body) return null;
  const sample = () => {
    let n = 0;
    for (let i = 1; i <= 8; i++) for (let j = 1; j <= 6; j++) {
      const el = document.elementsFromPoint(W * i / 9, H * j / 7).find(e => !e.closest("[data-morse-ui]"));
      if (el && el !== document.body && el !== document.documentElement) n++;
    }
    return n;
  };
  const mine = id ? [...document.querySelectorAll("style[data-morse-css]")].filter(s => s.getAttribute("data-morse-css") === id) : [];
  const was = mine.map(s => s.disabled);
  const test = document.createElement("style");
  try {
    mine.forEach(s => { s.disabled = true; });
    const before = sample();
    test.textContent = String(css || "");
    (document.head || document.documentElement).append(test);
    return { before, after: sample() };
  } finally {
    test.remove();
    mine.forEach((s, k) => { s.disabled = was[k]; });
  }
}
// Most of what showed is gone: a repair round, like draftHarm's.
export function collapseHarm(c) {
  if (!c || !(c.before >= 8) || !(c.after <= c.before * 0.35)) return null;
  return { kind: "collapse", user: "That would have hidden most of the page, so Morse didn't keep it. Try saying which part you mean.",
    model: `Applied, your CSS hid most of the page: of ${c.before} spots of the window that showed the page before, ${c.after} still do. `
      + "A selector matches a container that holds much more than what was asked for (often a class that the part you meant shares with the main content). "
      + "Use a selector that matches only that part: an id, a more specific class, or its place in the page." };
}
