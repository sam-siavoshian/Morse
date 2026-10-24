// Ask and find: the reply parser (mod vs answer vs malformed, streaming
// partials), the markdown subset, follow-up turns in the prompt, and the
// engine's answer branch (no JS runs, answers stream as events).
import { test } from "node:test";
import assert from "node:assert/strict";
import { replyKind, parseAnswer, parseReply, renderMarkdown, askTurnsToMessages } from "../core/answer.js";
import { buildMessages, SYSTEM_PROMPT } from "../core/prompt.js";
import { runMorse } from "../core/engine.js";
import { demoResponse } from "../core/demo.js";

const ANSWER = `ANSWER: Export is in the More menu [1].
1. Open the More menu [1].
2. Choose **Export as PDF** [2].
POINT: #more | More menu
POINT: \`#export\` | Export as PDF
STEP: #more | Open the More menu
STEP: #export — Choose Export
`;

test("tells a mod from an answer", () => {
  assert.equal(replyKind(ANSWER), "answer");
  assert.equal(replyKind("TITLE: Big buttons\n```css\nbutton{}\n```"), "mod");
  assert.equal(replyKind("```css\na{}\n```"), "mod");
  // A preamble before the prefix is fine; whichever format starts first wins.
  assert.equal(replyKind("Sure.\nANSWER: It's the play button."), "answer");
  assert.equal(replyKind("TITLE: X\n```js\n// ANSWER: not really\n```"), "mod");
  assert.equal(parseReply("TITLE: X\n```css\na{}\n```").kind, "mod");
});

test("parses an answer: text, points and steps, tolerant of separators and backticks", () => {
  const a = parseAnswer(ANSWER, { final: true });
  assert.equal(a.text, "Export is in the More menu [1].\n1. Open the More menu [1].\n2. Choose **Export as PDF** [2].");
  assert.deepEqual(a.points, [{ selector: "#more", label: "More menu" }, { selector: "#export", label: "Export as PDF" }]);
  assert.deepEqual(a.steps, [{ selector: "#more", label: "Open the More menu" }, { selector: "#export", label: "Choose Export" }]);
  assert.equal(a.complete, true);
  // Duplicate points collapse; a POINT inside a code block is just text.
  const b = parseAnswer("ANSWER: x\nPOINT: #a | A\nPOINT: #a | again\n```\nPOINT: #b\n```", { final: true });
  assert.deepEqual(b.points.map(p => p.selector), ["#a"]);
  assert.match(b.text, /POINT: #b/);
});

test("malformed replies: empty is nothing, plain talk is an answer once complete", () => {
  assert.equal(replyKind("", { final: true }), "");
  assert.equal(replyKind("   \n", { final: true }), "");
  assert.equal(parseReply("ANSWER:", { final: true }).text, "");
  // No prefix and no code: the model just answered.
  assert.equal(replyKind("That button pauses the song.", { final: true }), "answer");
  assert.equal(replyKind("That button pauses the song."), ""); // still streaming: undecided
  // A TITLE without code blocks is a broken mod (the engine retries it), not an answer.
  assert.equal(replyKind("TITLE: Something", { final: true }), "mod");
});

test("streaming partials never expose half a POINT line or a dangling prefix", () => {
  const seen = [];
  for (let i = 1; i <= ANSWER.length; i++) {
    const r = parseReply(ANSWER.slice(0, i));
    if (i < 3) assert.equal(r.kind, "", `undecided at ${i}`);
    if (r.kind !== "answer") continue;
    assert.doesNotMatch(r.text, /\n\s*P(O(I(N(T)?)?)?)?$|\n\s*S(T(E(P)?)?)?$/, `dangling prefix at ${i}: ${JSON.stringify(r.text)}`);
    assert.doesNotMatch(r.text, /POINT:|STEP:/);
    for (const p of [...r.points, ...r.steps]) assert.ok(ANSWER.includes(p.selector), `complete selector at ${i}: ${p.selector}`);
    seen.push(r.points.length);
  }
  // Points arrive one complete line at a time, in order.
  assert.deepEqual([...new Set(seen)], [0, 1, 2]);
  assert.equal(parseReply("ANSWER: The ex").text, "The ex"); // text streams word by word
});

test("markdown subset: paragraphs, lists, code, refs; everything escaped", () => {
  const h = renderMarkdown("Hi **there** and *you*.\n\n- one `a<b`\n- two [2]\n\n1. first\n2. second\n\n```\n<script>x</script>\n```\nSee [1] and [7].", { refs: 2 });
  assert.match(h, /^<p>Hi <b>there<\/b> and <i>you<\/i>\.<\/p>/);
  assert.match(h, /<ul><li>one <code>a&lt;b<\/code><\/li><li>two <button class="ask-ref" data-n="2"[^>]*>2<\/button><\/li><\/ul>/);
  assert.match(h, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(h, /<pre><code>&lt;script&gt;x&lt;\/script&gt;<\/code><\/pre>/);
  assert.match(h, /See <button[^>]*data-n="1"[^>]*>1<\/button> and \[7\]\./); // only refs that exist
  assert.doesNotMatch(renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1))'), /<img|href/);
});

test("earlier Q&A on the page becomes chat turns before the new request", () => {
  const turns = [{ q: "where is export?", a: "In the More menu [1].", points: [{ selector: "#more", label: "More menu" }] }];
  const msgs = buildMessages({ request: "and how do I undo that?", context: { url: "u", title: "t", ask: { turns } } });
  assert.deepEqual(msgs.map(m => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(msgs[1].content, "Request: where is export?");
  assert.equal(msgs[2].content, "ANSWER: In the More menu [1].\nPOINT: #more | More menu");
  assert.match(msgs[3].content, /Request: and how do I undo that\?$/);
  assert.equal(askTurnsToMessages(Array(9).fill(turns[0])).length, 8); // at most 4 turns
  // The reply format is in the system prompt; explain mode adds its instruction.
  assert.match(SYSTEM_PROMPT, /ANSWER: </);
  assert.match(SYSTEM_PROMPT, /POINT: <selector>/);
  assert.match(buildMessages({ request: "Explain this page", context: { url: "u", title: "t", ask: { mode: "explain" } } }).at(-1).content, /^Explain this page: reply with ANSWER/m);
  assert.equal(buildMessages({ request: "x", context: { url: "u", title: "t" } }).length, 2); // mods unchanged
});

test("the engine streams an answer as events and never runs JS for it", async () => {
  const events = [];
  let ran = 0;
  const res = await runMorse({
    settings: { provider: "demo" }, request: "where is the export button?",
    context: { url: "http://x/", title: "Morse playground", outline: "" },
    exec: async () => { ran++; return { ok: true }; },
    emit: e => events.push(e),
  });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "answer");
  assert.equal(ran, 0);
  assert.equal(events.filter(e => e.type === "css").length, 0);
  const answers = events.filter(e => e.type === "answer");
  assert.ok(answers.length > 3, "answer streams in pieces");
  const last = answers.at(-1);
  assert.equal(last.complete, true);
  assert.deepEqual(last.steps.map(s => s.selector), ["#more", "#export"]);
  // A change request still goes the mod path.
  const mod = await runMorse({ settings: { provider: "demo" }, request: "make the album covers bigger", context: { url: "http://x/", title: "Tunes", outline: "" }, exec: async () => ({ ok: true }), emit: () => {} });
  assert.equal(mod.kind, undefined);
  assert.match(mod.css, /album-grid/);
});

test("demo answers: follow-ups read earlier turns; questions on outline items name the closed menu", () => {
  const ctx = { url: "http://x/", title: "Some app", outline: 'button#gear  "Preferences"  (menu button, closed)\nbutton.x  "Billing"  (menu item, in closed menu "Preferences")' };
  const r = parseReply(demoResponse(buildMessages({ request: "where is billing?", context: ctx })), { final: true });
  assert.equal(r.kind, "answer");
  assert.match(r.text, /Billing.*Preferences menu/);
  assert.deepEqual(r.steps.map(s => s.selector), ["button#gear", "button.x"]);
  const turns = [{ q: "where is export?", a: "Export is in the More menu." }];
  const f = parseReply(demoResponse(buildMessages({ request: "and how do I undo that?", context: { ...ctx, ask: { turns } } })), { final: true });
  assert.match(f.text, /nothing on the page to undo/);
  // "Can you make…" is a change, not a question.
  assert.match(demoResponse(buildMessages({ request: "can you make the covers bigger?", context: ctx })), /^TITLE:/);
});
