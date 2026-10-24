// Ask and find: the second reply format. The model either writes a mod
// (TITLE + ```css/```js, see parse.js) or answers a question about the page:
//
//   ANSWER: Export lives in the File menu. Open it [1], then pick Export [2].
//   POINT: #file-menu | File menu
//   STEP: #file-menu | Open the File menu
//   STEP: [data-action="export"] | Click Export
//
// POINT lines mark things to look at; STEP lines are clicks on this page, in
// order (they drive "Show me"). Everything here works on partial text, so the
// answer can be shown while the model is still writing it. Dependency free:
// the runtime inlines this file (runtime/bundle.js) for the markdown renderer.

const ANSWER_RE = /^[ \t>*_#]*ANSWER\s*:[ \t]*/im;
const TITLE_RE = /^\s*TITLE\s*:/im;
const LINE_RE = /^[ \t>*_-]*(POINT|STEP)\s*:[ \t]*(.*)$/i;

// "answer", "mod", or "" while a streaming reply could still be either.
export function replyKind(text, { final = false } = {}) {
  const t = String(text || "");
  const a = t.search(ANSWER_RE), m = firstOf(t.search(TITLE_RE), t.indexOf("```"));
  if (a >= 0 && (m < 0 || a < m)) return "answer";
  if (m >= 0) return "mod";
  // Undecided while streaming. Once the reply is complete, a model that
  // skipped both prefixes and just talked was answering.
  if (!final) return "";
  return t.trim() ? "answer" : "";
}
const firstOf = (a, b) => (a < 0 ? b : b < 0 ? a : Math.min(a, b));

// { text, points: [{selector, label}], steps: [{selector, label}], complete }
// Partial input never yields half a POINT line, or a dangling "POI" in text.
export function parseAnswer(raw, { final = false } = {}) {
  let t = String(raw || "");
  const at = t.search(ANSWER_RE);
  if (at >= 0) t = t.slice(at).replace(ANSWER_RE, "");
  const lines = t.split("\n");
  // The last line is still being written: hold it back if it could become a
  // POINT/STEP line (or is one), so markers only use complete selectors.
  let tail = "";
  if (!final && !/\n$/.test(t)) {
    const last = lines.pop() || "";
    const head = last.replace(/^[ \t>*_-]+/, "").toUpperCase();
    if (LINE_RE.test(last) || (head && ("POINT:".startsWith(head) || "STEP:".startsWith(head)))) tail = "";
    else tail = last;
  }
  const text = [], points = [], steps = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && line.match(LINE_RE);
    if (!m) { text.push(line); continue; }
    const item = splitItem(m[2]);
    if (!item.selector) continue;
    (m[1].toUpperCase() === "STEP" ? steps : points).push(item);
  }
  if (tail) text.push(tail);
  return {
    text: text.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "").trim(),
    points: dedupe(points).slice(0, 9),
    steps: steps.slice(0, 9),
    complete: !!final,
  };
}

// "<selector> | <label>"; tolerant of backticks, quotes and " — " separators.
function splitItem(s) {
  let [sel, ...rest] = String(s).split(/\s+\|\s*|\s+[—–]\s+/);
  let label = rest.join(" ").trim();
  sel = (sel || "").trim().replace(/^`+|`+$/g, "").trim();
  if (/^(["']).*\1$/.test(sel) && !/[\[\]=]/.test(sel.slice(1, -1))) sel = sel.slice(1, -1);
  label = label.replace(/^["'`]+|["'`]+$/g, "").trim();
  return { selector: sel.slice(0, 300), label: label.slice(0, 80) };
}
function dedupe(list) {
  const seen = new Set();
  return list.filter(p => !seen.has(p.selector) && seen.add(p.selector));
}

// One entry point for the engine: { kind: "answer", ...parseAnswer } for an
// answer, { kind: "mod" } otherwise (the caller parses mods with parse.js).
export function parseReply(raw, { final = false } = {}) {
  const kind = replyKind(raw, { final });
  if (kind !== "answer") return { kind };
  return { kind, ...parseAnswer(raw, { final }) };
}

// Earlier questions on this page become real chat turns, so follow-ups
// ("and how do I undo that?") work. Kept short: small models, small contexts.
export function askTurnsToMessages(turns = []) {
  const out = [];
  for (const t of turns.slice(-4)) {
    if (!t || !t.q || !t.a) continue;
    out.push({ role: "user", content: `Request: ${String(t.q).slice(0, 300)}` });
    const marks = (t.points || []).slice(0, 6).map(p => `POINT: ${p.selector}${p.label ? ` | ${p.label}` : ""}`);
    out.push({ role: "assistant", content: [`ANSWER: ${String(t.a).slice(0, 700)}`, ...marks].join("\n") });
  }
  return out;
}

// A small, safe markdown subset for answers: paragraphs, - / 1. lists, ```code```,
// `inline code`, **bold**, *italic*, and [n] references to markers (when
// refs > 0). Everything is escaped first; no links, no raw HTML.
export function renderMarkdown(md, { refs = 0 } = {}) {
  const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inline = s => {
    const codes = [];
    let h = escHtml(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>");
    if (refs) h = h.replace(/\[(\d)\]/g, (m, n) => (+n >= 1 && +n <= refs ? `<button class="ask-ref" data-n="${n}" aria-label="Show ${n} on the page">${n}</button>` : m));
    return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  };
  const out = [];
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  let para = [], list = null, code = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) { out.push(`<pre><code>${escHtml(code.join("\n"))}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
    flushList();
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) { flushPara(); out.push(`<p><b>${inline(h[1])}</b></p>`); continue; }
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${escHtml(code.join("\n"))}</code></pre>`);
  flushPara();
  flushList();
  return out.join("");
}
