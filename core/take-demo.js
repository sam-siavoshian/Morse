// Take this, Bring here, for the demo model (core/demo.js): canned but
// working replies, so tests and screenshots run without a model.
//   - Take: a name and a few lines, read from what was taken (core/take.js describeMessages)
//   - Bring: a working palette (it opens with the keys it opened with there,
//     filters as you type, ↑ ↓ and Enter run the page's own buttons and links,
//     Esc closes), styled from the page it lands on: its font, colors and
//     corner radius are read from the page when the code runs. A real model
//     writes code for the page; this is enough to show the flow working.

import { DESCRIBE_SYSTEM } from "./take.js";

const fence = (lang, body) => "```" + lang + "\n" + body.trim() + "\n```";
const reply = (title, css, js) => `TITLE: ${title}\n${fence("css", css)}\n${fence("js", js)}\n`;

function describeDemo(text) {
  const label = (text.match(/^What the person pointed at: (.*?)(?: \(\d+×\d+ px\))?$/m) || [])[1] || "";
  const name = label.replace(/[“”"]/g, "").replace(/\s+(dialog|window|section|panel|box|list|menu)$/i, "").trim() || "Feature";
  const keys = (text.match(/^\d+\. Press ([^\n]+)$/m) || [])[1];
  const field = /<input\b/.test(text);
  return [`ANSWER: ${name[0].toUpperCase()}${name.slice(1)}`,
    `A box over the page that lists things you can do${keys ? `; it opens with ${keys}` : ""}.`,
    field ? "Type to narrow the list, move with ↑ and ↓, and press Enter to run one." : "Click one to run it.",
    "Esc or a click away closes it."].join("\n") + "\n";
}

function bringDemo(text) {
  const name = (text.match(/brought here: “([^”]+)”/) || [])[1] || "Command palette";
  const from = (text.match(/”, taken from ([^.(\n]+)/) || text.match(/” from ([^.\n]+?)\. Nothing was taken/) || [])[1]?.trim() || "another app";
  const keys = (text.match(/^\d+\. Press ((?:Ctrl|Alt|Shift|⌘)\+[^\s\n]+)/m) || [])[1] || "Ctrl+Shift+P";
  const parts = keys.split("+"), key = parts.pop().toLowerCase();
  const want = { ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), meta: parts.includes("⌘") };
  // Short on purpose: the demo model replays it a few characters at a time.
  const css = `
.morse-pal { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%); width: min(560px, 92vw); z-index: 2147483000; padding: 6px; border: 1px solid; box-shadow: 0 12px 32px #0003; }
.morse-pal[hidden] { display: none; }
.morse-pal input { width: 100%; box-sizing: border-box; height: 32px; padding: 0 10px; border: 1px solid; font: inherit; }
.morse-pal ul { list-style: none; margin: 6px 0 0; padding: 0; }
.morse-pal li { padding: 6px 10px; }`;
  const js = `
const W = ${JSON.stringify({ ...want, key })}, NAME = ${JSON.stringify(name)};
const body = getComputedStyle(document.body), own = document.querySelector("button"), os = own ? getComputedStyle(own) : body;
const bg = body.backgroundColor === "rgba(0, 0, 0, 0)" ? "#fff" : body.backgroundColor, r = parseFloat(os.borderRadius) ? os.borderRadius : "4px";
const input = morse.el("input", { "aria-label": NAME }), list = morse.el("ul");
const pal = morse.el("div", { class: "morse-pal", role: "dialog", "aria-label": NAME, hidden: "" }, input, list);
for (const x of [pal, input]) Object.assign(x.style, { background: bg, color: body.color, borderColor: os.borderColor, borderRadius: r, fontFamily: body.fontFamily });
let shown = [], at = 0;
function render() {
  const q = input.value.toLowerCase();
  shown = morse.$$("button, a[href], h1, h2, h3, .nt").filter(e => !pal.contains(e) && e.innerText.trim() && e.innerText.toLowerCase().includes(q)).slice(0, 9);
  list.replaceChildren(...shown.map((e, i) => morse.el("li", { text: e.innerText.split("\\n")[0], style: i === at ? "background:" + os.borderColor : "" })));
}
const open = () => { pal.hidden = false; input.value = ""; at = 0; render(); input.focus(); };
const run = () => { pal.hidden = true; shown[at]?.click(); };
morse.on(document, "keydown", e => {
  if (e.key.toLowerCase() === W.key && e.ctrlKey === W.ctrl && e.shiftKey === W.shift && e.altKey === W.alt) { e.preventDefault(); open(); }
  else if (!pal.hidden && e.key === "Escape") pal.hidden = true;
}, true);
morse.on(input, "input", () => { at = 0; render(); });
morse.on(input, "keydown", e => {
  if (/Arrow(Up|Down)/.test(e.key)) { at = Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))); render(); }
  if (e.key === "Enter") run();
});
document.body.append(pal);
morse.watch(".crumbs .sp, [role=toolbar], header", spot => { if (!document.querySelector(".morse-pal-open")) spot.append(morse.el("button", { class: "morse-pal-open " + (own?.className || ""), title: NAME + " (${keys})", text: NAME, on: { click: open } })); });`;
  return reply(`${name} from ${from}`, css, js);
}

export function takeDemo(messages) {
  if (messages[0]?.role === "system" && messages[0].content === DESCRIBE_SYSTEM) return describeDemo(String(messages[1]?.content || ""));
  const users = messages.filter(m => m.role === "user" && typeof m.content === "string");
  const first = users.find(m => /wants a feature (they took from another app|of another app) brought here/.test(m.content));
  if (first && !/^Current code:/m.test(first.content)) return bringDemo(first.content);
  return null;
}
