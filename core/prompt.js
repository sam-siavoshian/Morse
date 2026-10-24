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
- Never use hashed class names like "css-1x2y3" or "_a8f3k". Target ids, data-* attributes, aria-*, roles, tag structure, or text.
- Apps re-render. In JS, always attach to elements with morph.watch(selector, el => ...), never querySelector once.
- JS runs with a helper object \`morph\`:
  morph.watch(selector, fn)        run fn(el) for every current and future match, once per element
  morph.el(tag, props, ...kids)     create an element (props: class, style, text, html, on: {click: fn}, any attribute)
  morph.css(text)                   add more CSS
  morph.on(target, event, fn)       add a listener
  morph.every(ms, fn)               run fn repeatedly
  morph.byText(selector, text)      first element matching selector whose text contains text
  morph.store.get(key) / set(key, value)   persist small values
  morph.toast(message)              show a short notice
  Everything created through morph is removed automatically when the mod is turned off.
- No network requests, no eval, no external scripts. Keep it short.
- Match the app's look: reuse its fonts and colors (inherit, currentColor) unless asked otherwise.`;

export function buildMessages({ request, context, previous }) {
  const parts = [];
  parts.push(`App: ${context.app || "web"}  URL: ${context.url}`);
  parts.push(`Page title: ${context.title}`);
  if (context.theme) parts.push(`Theme: background ${context.theme.bg}, text ${context.theme.fg}, font ${context.theme.font}`);
  if (context.target) {
    parts.push(`The user pointed at this element. Best selector: ${context.target.selector}`);
    if (context.target.path) parts.push(`Ancestors: ${context.target.path}`);
    parts.push("Element HTML:\n" + context.target.html);
  } else {
    parts.push("The user did not point at anything; the change is page-wide.");
  }
  if (context.outline) parts.push("Page outline:\n" + context.outline);
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
