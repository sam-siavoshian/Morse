// The system prompt is deliberately small: local 7B models follow short,
// concrete contracts far better than long ones.

export const SYSTEM_PROMPT = `You modify live apps. The user points at part of a running web or Electron app and describes a change. You reply with CSS and/or JavaScript that is injected into the page right now.

Reply in exactly this format and nothing else:
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
- Match the app's look: reuse its fonts and colors (inherit, currentColor) unless asked otherwise.`;

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

export function buildMessages({ request, context, previous, snapshot = context?.snapshot }) {
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
  parts.push(`Request: ${request}`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
  if (previous) {
    messages.push({ role: "assistant", content: previous.raw });
    messages.push({ role: "user", content: `That failed when it ran: ${previous.error}\nFix it. Same format.` });
  }
  return messages;
}
