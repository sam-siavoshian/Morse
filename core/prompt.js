// The system prompt is deliberately small: local 7B models follow short,
// concrete contracts far better than long ones.

import { askTurnsToMessages } from "./answer.js"; // Ask and find
import { imageMessages } from "./a11y.js"; // Easier to use: Describe this image
import { recordingPrompt } from "./showonce.js"; // show-once hook: steps the user showed
import { englishName } from "./i18n.js"; // Ask answers in the language Morse speaks
import { describeMessages, bringPrompt } from "./take.js"; // take-and-bring hook: Take this, Bring here
import { scanHooks, formatHooks, wantsHooks } from "./hooks.js"; // real handlers and backend calls, not a guessed API

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
- CSS can't select by text. When what decides it is text (a "High" label, an "ERROR" level, a number), use JS: morse.watch(itemSelector, el => el.classList.toggle("x", test(el.querySelector(...).textContent))).
- Apps re-render. In JS, always attach to elements with morse.watch(selector, el => ...), never querySelector once.
- "host >>> inside" selects inside a component's open shadow root or a same-origin frame (nest: "a >>> b >>> c"). Page CSS (the css block) can't reach in there: use morse.css(css, where) and morse.watch.
- Read the notes about the page: they say what kind of page it is and what works there.
- JS runs with a helper object \`morse\`:
  morse.watch(selector, fn)        run fn(el) for every current and future match, once per element; puts back what fn did if the app re-renders it away
  morse.watch(selector, fn, { live: true })   also re-run fn whenever el or its content changes: use it when fn reads the page (counts, labels, reused rows); fn must set and unset
  morse.$$(selector)               an array of the elements matching right now (in click handlers)
  morse.el(tag, props, ...kids)     create an element (props: class, style, text, html, on: {click: fn}, any attribute); you must append it
  morse.css(text, where?)           add more CSS; with where (components or frames), inside each one
  morse.on(target, event, fn)       add a listener
  morse.every(ms, fn)               run fn repeatedly
  morse.byText(selector, text)      first element matching selector whose text contains text
  morse.store.get(key) / set(key, value)   persist small values
  morse.toast(message)              show a short notice
  Everything created through morse is removed automatically when the mod is turned off.
- No new endpoints, no eval, no external scripts. A backend call already listed in this prompt may be called the same way the page calls it. Do not invent an API. Keep it short.
- A new control must call a listed function, module, hook, or endpoint. Do not leave a button that only toggles a class. If none of them does what was asked, morse.toast("This app has no function for that") and do not cover, hide, or replace the working control.
- Never set innerHTML, outerHTML, replaceWith, or replaceChildren on an element the app already rendered (that drops its listeners). Insert beside it with morse.el and call the app's function from click or submit.
- No prompt(), alert() or confirm(): Electron apps throw on prompt() and the others freeze the app. Ask for input with elements you make (morse.el).
- Faked key presses (dispatchEvent of a KeyboardEvent) don't run the app's or the browser's commands (copy, paste, save, shortcuts). Do the work yourself: read the text from the page, navigator.clipboard.writeText(text), click the app's own button.
Design: anything you add must look like it shipped with the app (see "Design system"), unless asked otherwise.
- Reuse the app's own classes and CSS variables: color: var(--x), never a hard-coded color when a variable exists. With no variables, copy the exact values of its components.
- Copy font, size, height, padding, radius, border and hover from the app's component of the same kind (a new button looks like its buttons). Place it where the app would put it, aligned with its neighbors.
- In a row (a toolbar, a header, a list item), center what you add vertically (display: flex; align-items: center) and give it the height of the controls beside it.
- It must work in light and dark mode: variables, inherit and currentColor follow the theme; fixed colors don't.
- Icons come from the app's icon system. No emoji as icons unless the app uses emoji.
- A feature must be complete: an empty state, keyboard access (real <button>s with labels), state worth keeping in morse.store, no console errors, and morse.watch so it survives re-renders.
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

// Keep the hook lines at the start and the "do it with the app" rules at the end
// when a profile slice is longer than the prompt budget.
function clipAppLogic(text) {
  const s = String(text);
  const cap = 4500;
  if (s.length <= cap) return s;
  const mark = s.search(/\nDo it with the app|\nPrefer the app's own objects/);
  if (mark < 0) return s.slice(0, cap);
  const tail = s.slice(mark);
  const head = s.slice(0, Math.max(0, cap - tail.length - 2));
  return `${head}\n…${tail}`;
}

function hookBlock(context, request) {
  if (!context) return "";
  if (typeof context.hooks === "string" && context.hooks.trim()) return context.hooks.trim();
  if (context.hooks && typeof context.hooks === "object") return formatHooks(context.hooks, request);
  if (!wantsHooks(request) || !context.sources) return "";
  return formatHooks(scanHooks(context.sources), request);
}

export function buildMessages({ request, context, previous, snapshot = context?.snapshot, base }) {
  if (context?.a11y?.image) return imageMessages({ request, context }); // Easier to use: Describe this image (core/a11y.js)
  if (context?.take) return describeMessages(context.take, context.lang && context.lang !== "en" ? englishName(context.lang) : ""); // take-and-bring hook: name a taken feature and say what it does (core/take.js)
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
  if (context.notes) parts.push("About this page:\n" + context.notes);
  // Real handlers and endpoints, before the design system, so a feature calls the app instead of inventing a widget. Raw sources never go in the prompt.
  const hooks = hookBlock(context, request);
  if (hooks) parts.push(hooks);
  if (context.design) parts.push("Design system (match it):\n" + context.design); // design: runtime/src/20-context.js designOf
  if (context.layout) parts.push("Page layout (visible blocks, px):\n" + context.layout);
  if (context.outline) parts.push((context.layout ? "Controls and headings:\n" : "Page outline:\n") + context.outline);
  if (context.appLogic) parts.push(clipAppLogic(context.appLogic)); // app profiles: how the app works inside (core/profile.js profileSlice)
  if (snapshot) parts.push(snapshotPrompt(snapshot));
  if (context.ask?.mode === "explain") parts.push("Explain this page: reply with ANSWER, a plain summary in 5 short lines of what this page is for and the main things you can do here, and a POINT line for each of those main actions."); // Ask and find
  if (context.lang && context.lang !== "en") parts.push(`If you reply with ANSWER, write the ANSWER text in ${englishName(context.lang)}.`); // the language Morse speaks to this person (core/i18n.js)
  if (context.recording) parts.push(recordingPrompt(context.recording)); // show-once hook
  if (context.bring && !base) parts.push(bringPrompt(context.bring)); // take-and-bring hook: build a feature from another app here (core/take.js)
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
