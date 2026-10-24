// The system prompt is deliberately small: local 7B models follow short,
// concrete contracts far better than long ones.

import { askTurnsToMessages } from "./answer.js"; // Ask and find

// ---- Ask and find: questions get an answer instead of a mod (core/answer.js
// parses it; the runtime side is runtime/src/61-ask.js).
const ASK_FORMAT = `
If the user asks a question instead (what something does, why it is greyed out, where to find something, how to do something), change nothing. Reply in exactly this format:
ANSWER: <plain, friendly answer in at most 5 short lines; "- " for lists; refer to marked things as [1], [2]>
POINT: <selector> | <short label>
STEP: <selector> | <what to click>
- One POINT line per thing on the page worth looking at (at most 5). Use selectors from the element HTML or the page outline.
- STEP lines only when the answer is clicks on this page, in order. Never claim you clicked anything.
- If the thing is inside a closed menu, say which menu to open, and point at that menu's button first.
- If the page doesn't show it, say so plainly. No jargon.`;

export const SYSTEM_PROMPT = `You modify live apps. The user points at part of a running web or Electron app and describes a change. You reply with CSS and/or JavaScript that is injected into the page right now.

For a change, reply in exactly this format and nothing else:
TITLE: <3-6 word name for the change>
\`\`\`css
<CSS, or leave empty>
\`\`\`
\`\`\`js
<JavaScript, or leave empty>
\`\`\`

Rules:
- Prefer CSS when CSS alone can do it. Put CSS first; it is applied while you write.
- Use only selectors that match the HTML, layout and CSS rules you are given. Never assume elements that aren't shown (an image may be a div with a background, not an <img>).
- Never use hashed class names like "css-1x2y3" or "_a8f3k". Target ids, data-* attributes, aria-*, roles, tag structure, or text.
- Pointing is approximate. "These", "them" or a kind of thing ("the ads", "unread emails") means every similar element on the page. A request about items (rows, cards, messages) changes the whole item, not just the part pointed at.
- To resize, change what actually sets the size (see the CSS rules: a fixed width, or the grid/flex container's columns). Your CSS must beat the existing rules: match their specificity or use !important.
- Make a clearly visible change, even for vague requests.
- Apps re-render. In JS, always attach to elements with morse.watch(selector, el => ...), never querySelector once.
- JS runs with a helper object \`morse\`:
  morse.watch(selector, fn)        run fn(el) for every current and future match, once per element
  morse.el(tag, props, ...kids)     create an element (props: class, style, text, html, on: {click: fn}, any attribute); you must append it
  morse.css(text)                   add more CSS
  morse.on(target, event, fn)       add a listener
  morse.every(ms, fn)               run fn repeatedly
  morse.byText(selector, text)      first element matching selector whose text contains text
  morse.store.get(key) / set(key, value)   persist small values
  morse.toast(message)              show a short notice
  Everything created through morse is removed automatically when the mod is turned off.
- No network requests, no eval, no external scripts. Keep it short.
- Match the app's look: reuse its fonts and colors (inherit, currentColor) unless asked otherwise.
${ASK_FORMAT}`;

// A snapshot captured in another app (God mode's Capture): the model rebuilds
// that look and behavior natively here instead of copying foreign markup.
export function snapshotPrompt(snapshot) {
  const from = snapshot.from || {};
  const where = [from.app || from.title, from.url].filter(Boolean).join(", ");
  const lines = [`The user brought an element captured in another app${where ? ` (${where})` : ""}: ${snapshot.label || "element"}.`];
  if (snapshot.note) lines.push(`Their note about it: ${snapshot.note}`);
  lines.push("Rebuild its look (and behavior, if it has any) natively in this app: keep this app's own DOM, text and data, and apply the captured design to what the user pointed at (or the page, if they didn't point). Don't paste the captured HTML in.");
  if (snapshot.html) lines.push("Captured HTML:\n" + String(snapshot.html).slice(0, 2500));
  if (snapshot.styles) lines.push("Captured styles (computed, JSON):\n" + JSON.stringify(snapshot.styles).slice(0, 3000));
  if (snapshot.hover?.length) lines.push("Captured hover rules:\n" + snapshot.hover.join("\n").slice(0, 1200));
  return lines.join("\n\n");
}

// Keep iterating: `base` is the change as it is now ({ prompt, css, js }, plus
// `error` when a saved mod stopped working). The model rewrites it whole, so
// the reply replaces the mod in the same format.
export function basePrompt(base, request) {
  const fence = (lang, code) => "```" + lang + "\n" + String(code || "").trim().slice(0, 6000) + "\n```";
  const lines = [
    base.error
      ? "This change was made earlier and saved. It has stopped working on the page as it is now."
      : "You already made a change here. The user wants to adjust it.",
    `Original request: ${base.prompt || "(none)"}`,
    "Current code:\n" + fence("css", base.css) + "\n" + fence("js", base.js),
  ];
  if (base.error) {
    lines.push(`What went wrong: ${base.error}`);
    lines.push(`Fix it so it works on the page as it is now and still does what was asked.${request && request !== base.prompt ? ` The user adds: ${request}` : ""}`);
  } else {
    lines.push(`Follow-up: ${request}`);
  }
  lines.push("Reply with the complete new version: all of its CSS and JS, not only what changed, in the same format. Keep the parts the user didn't ask to change.");
  return lines.join("\n\n");
}

export function buildMessages({ request, context, previous, snapshot = context?.snapshot, base }) {
  const parts = [];
  parts.push(`App: ${context.app || "web"}  URL: ${context.url}`);
  parts.push(`Page title: ${context.title}`);
  if (context.theme) parts.push(`Theme: background ${context.theme.bg}, text ${context.theme.fg}, font ${context.theme.font}`);
  if (context.target) {
    parts.push(`The user pointed at this element. Best selector: ${context.target.selector}`);
    if (context.target.path) parts.push(`Ancestors: ${context.target.path}`);
    parts.push("Element HTML:\n" + context.target.html);
    if (context.target.facts) parts.push(context.target.facts);
  } else {
    parts.push("The user did not point at anything; the change is page-wide.");
  }
  if (context.layout) parts.push("Page layout (visible blocks, px):\n" + context.layout);
  if (context.outline) parts.push((context.layout ? "Controls and headings:\n" : "Page outline:\n") + context.outline);
  if (snapshot) parts.push(snapshotPrompt(snapshot));
  if (context.ask?.mode === "explain") parts.push("Explain this page: reply with ANSWER, a plain summary in 5 short lines of what this page is for and the main things you can do here, and a POINT line for each of those main actions."); // Ask and find
  if (base) parts.push(basePrompt(base, request)); // keep iterating: refine or fix this code
  else parts.push(`Request: ${request}`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...askTurnsToMessages(context.ask?.turns), // Ask and find: earlier Q&A on this page
    { role: "user", content: parts.join("\n\n") },
  ];
  if (previous) {
    messages.push({ role: "assistant", content: previous.raw });
    messages.push({ role: "user", content: `That failed when it ran: ${previous.error}\nFix it. Same format.` });
  }
  return messages;
}
