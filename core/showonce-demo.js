// Show me once, for the demo model (core/demo.js): a canned but working reply
// for any recorded flow. It reads the steps the prompt carries
// (core/showonce.js recordingPrompt) and writes a mod that replays them with
// the kit: a button ("add a button that does this"), a shortcut ("do this
// when I press Ctrl+Shift+A"), or the steps for every matching item ("do
// this to every unread email"). A real model writes code for the page; this
// one interprets the steps, which is enough for tests and screenshots.

const fence = (lang, body) => "```" + lang + "\n" + body.trim() + "\n```";
const reply = (title, css, js) => `TITLE: ${title}\n${fence("css", css)}\n${fence("js", js)}\n`;

export function readShortcut(text) {
  const m = String(text).match(/((?:(?:ctrl|control|cmd|command|⌘|alt|option|⌥|shift|⇧|meta)\s*\+\s*)+)([a-z0-9]|enter|space)\b/i);
  if (!m) return null;
  const mods = m[1].toLowerCase();
  return {
    ctrl: /ctrl|control/.test(mods), meta: /cmd|command|⌘|meta/.test(mods), alt: /alt|option|⌥/.test(mods), shift: /shift|⇧/.test(mods),
    key: m[2].toLowerCase() === "space" ? " " : m[2].toLowerCase(),
    label: m[0].replace(/\s+/g, ""),
  };
}

// "every unread email" → the item selector narrowed by the attributes the
// words name ([data-unread="true"]), and the words themselves.
function everyItems(request, steps) {
  const m = request.match(/\b(?:every|each|all(?: the| my)?)\s+([^.,;]+)/i);
  const s = steps.find(x => x.item);
  if (!m || !s) return null;
  const words = m[1].trim().toLowerCase();
  let selector = s.item.selector;
  for (const [k, v] of Object.entries(s.item.attrs || {})) {
    const name = k.replace(/^(data|aria)-/, "").replace(/[-_]/g, " ");
    const word = w => w.length > 2 && new RegExp(`\\b${w.replace(/[^\w ]/g, "")}s?\\b`).test(words);
    if (word(name) || (!/^(true|false)$/.test(v) && word(v.toLowerCase()))) selector += `[${k}="${v}"]`;
  }
  return { selector, noun: words.replace(/^(the|my)\s+/, ""), from: steps.indexOf(s) };
}

const J = v => JSON.stringify(v);
// One line of code per step. `item` (every mode) stands for the list item.
function stepCode(s, inItem) {
  const at = inItem && s.item ? (s.item.inside ? `await morse.waitFor(${J(s.item.inside)}, { within: item${s.item.insideText ? `, text: ${J(s.item.insideText)}` : ""} })` : "item")
    : s.do === "key" && s.selector === "body" ? "document.activeElement"
    : `await morse.waitFor(${J(s.selector)}${s.text ? `, { text: ${J(s.text)} }` : ""})`;
  if (s.hidden) return `(${at}).focus(); throw new Error(${J(`type your ${(s.label || "password").toLowerCase()} first`)});`;
  if (s.do === "click") return `(${at}).click(); await morse.sleep(60);`;
  if (s.do === "type") return `morse.type(${at}, ${J(s.value || "")});`;
  if (s.do === "choose") return `morse.choose(${at}, ${s.role === "menu" ? J(s.value || "") : "true"});`;
  if (s.do === "check" || s.do === "uncheck") return `morse.choose(${at}, ${s.do === "check"});`;
  if (s.do === "key") {
    const k = s.key.split("+"), key = k.pop();
    const mods = [["Ctrl", "ctrl"], ["Shift", "shift"], ["Alt", "alt"], ["⌘", "meta"]].filter(([m]) => k.includes(m)).map(([, n]) => `${n}: true`);
    return `morse.key(${at}, ${J(key)}${mods.length ? `, { ${mods.join(", ")} }` : ""}); await morse.sleep(60);`;
  }
  return "";
}

export function showOnceDemo(prompt) {
  const json = (prompt.match(/^The same steps as JSON[^\n]*:\n(\[.*\])$/m) || [])[1];
  let steps = [];
  try { steps = JSON.parse(json); } catch {}
  const request = [...prompt.matchAll(/^Request: (.*)$/gm)].pop()?.[1] || "";
  if (!steps.length) return reply("Needs a real model", "", `morse.toast("No steps came with this request.");`);

  const shortcut = readShortcut(request);
  const every = !shortcut && everyItems(request, steps);
  const lastClick = [...steps].reverse().find(s => s.do === "click" && !s.item);
  const verb = lastClick?.label || "Do it";
  const css = `.morse-so-btn { margin: 8px 12px; padding: 6px 14px; border: 1px solid currentColor; border-radius: 999px; background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.morse-so-btn:disabled { opacity: .45; cursor: default; }`;
  const lines = (list, pad = "    ") => list.map(c => pad + c + "\n").join("");
  // A step that can't be taken back (core/showonce.js cannotUndo): ask first, once.
  const sure = steps.find(s => s.confirm);
  const sureWord = sure ? (sure.label || sure.text || sure.key || "Do it") : "";
  const ask = !sure ? "" : every
    ? `if (!(await morse.confirm(${J(sureWord)} + " " + items.length + " " + (items.length === 1 ? ${J(every.noun)} : ${J(every.noun.replace(/([^s])$/, "$1s"))}) + "? This can't be undone.", { yes: ${J(sureWord)} }))) return;\n    `
    : `if (!(await morse.confirm(${J(`This will ${sure.do === "key" ? "press" : "click"} “${sureWord}”, which can't be undone. Go ahead?`)}, { yes: ${J(sureWord)} }))) return;\n    `;
  const body = every
    ? `const items = [...document.querySelectorAll(${J(every.selector)})];
    ${ask}${lines(steps.slice(0, every.from).map(s => stepCode(s, false))).trimStart()}    for (const item of items) {
${lines(steps.slice(every.from).map(s => stepCode(s, true)), "      ")}    }
    morse.toast("Done for " + items.length + " " + (items.length === 1 ? ${J(every.noun)} : ${J(every.noun.replace(/([^s])$/, "$1s"))}));`
    : `${ask}${lines(steps.map(s => stepCode(s, false))).trimStart()}    morse.toast("Done");`;
  const run = `async function run() {
  try {
    ${body}
  } catch (e) { morse.toast("Stopped: " + e.message); }
}`;

  if (shortcut) {
    const k = shortcut;
    return reply(`${verb} with ${k.label}`, "", `${run}
morse.on(document, "keydown", e => {
  if (e.key.toLowerCase() !== ${J(k.key)} || e.ctrlKey !== ${k.ctrl} || e.metaKey !== ${k.meta} || e.altKey !== ${k.alt} || e.shiftKey !== ${k.shift}) return;
  e.preventDefault();
  run();
});`);
  }
  if (every) {
    const label = (verb + " every " + every.noun).replace(/^./, c => c.toUpperCase());
    return reply(label, css, `${run}
const btn = morse.el("button", { class: "morse-so-btn", on: { click: async () => { btn.disabled = true; await run(); count(); } } });
const count = () => { const n = document.querySelectorAll(${J(every.selector)}).length; btn.textContent = ${J(label)} + " (" + n + ")"; btn.disabled = !n; };
morse.watch(${J(every.selector.split(" > ")[0])}, list => { list.before(btn); count(); });
morse.every(500, count);`);
  }
  const at = lastClick || steps[0];
  return reply(`Button: ${verb}`, css, `${run}
morse.watch(${J(at.selector)}, el => {
  if (${J((at.text || "").toLowerCase())} && !el.textContent.toLowerCase().includes(${J((at.text || "").toLowerCase())})) return;
  el.after(morse.el("button", { class: "morse-so-btn", text: "Repeat my steps", on: { click: run } }));
});`);
}
