// Demo replay (internal test fixture): pre-written model replies for a handful
// of requests, so tests and screenshot scripts run without a model. Everything downstream
// is real: the reply is streamed, parsed, injected and run like model output.
// One reply ships a deliberate bug on the first try to exercise self-repair.

import { showOnceDemo } from "./showonce-demo.js"; // show-once hook

const fence = (lang, body) => "```" + lang + "\n" + body.trim() + "\n```";
const reply = (title, css, js) => `TITLE: ${title}\n${fence("css", css || "")}\n${fence("js", js || "")}\n`;

const WORD_COUNT = reply("Live word count", `
form#composer .morse-count { display: flex; gap: 14px; padding: 6px 20px 0; font-size: 12px; color: #9b9b9b; font-variant-numeric: tabular-nums; }
form#composer .morse-count b { color: #10a37f; font-weight: 600; }
`, `
morse.watch("form#composer", form => {
  const box = form.querySelector("textarea");
  const out = morse.el("div", { class: "morse-count" });
  const update = () => {
    const words = (box.value.trim().match(/\\S+/g) || []).length;
    const tokens = Math.ceil(box.value.length / 4);
    out.innerHTML = \`<span><b>\${words}</b> words</span><span>~\${tokens} tokens</span><span>\${Math.max(1, Math.round(words / 3.6))}s to read</span>\`;
  };
  morse.on(box, "input", update);
  update();
  form.append(out);
});
`);

const COPY_MD = reply("Copy chat as Markdown", `
.morse-copy { background: transparent; color: inherit; border: 1px solid #424242; border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer; }
.morse-copy:hover { background: #2f2f2f; }
`, `
morse.watch("header[role=banner] button", share => {
  const btn = morse.el("button", { class: "morse-copy", text: "Copy as Markdown", on: { click() {
    const md = [...document.querySelectorAll(".msg[data-role]")].map(m =>
      (m.dataset.role === "user" ? "**You:** " : "**Parley:** ") + m.innerText.trim()).join("\\n\\n");
    navigator.clipboard?.writeText(md);
    morse.toast("Copied " + md.split(/\\s+/).length + " words as Markdown");
  } } });
  share.before(btn);
});
`);

const SLEEP_BROKEN = reply("Sleep timer", `
.morse-sleep { background: none; border: 0; color: #b3b3b3; font-size: 15px; cursor: pointer; position: relative; }
.morse-sleep.on { color: #1ed760; }
.morse-sleep span { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); font-size: 10px; font-weight: 700; white-space: nowrap; }
`, `
morse.watch('[data-testid="player-controls"] .btns', btns => {
  const btn = morse.el("button", { class: "morse-sleep", title: "Sleep timer", text: "☾" });
  btns.append(btn);
  player.dataset.sleep = "off";
});
`);

const SLEEP = reply("Sleep timer", `
.morse-sleep { background: none; border: 0; color: #b3b3b3; font-size: 16px; cursor: pointer; position: relative; padding: 0 2px; }
.morse-sleep:hover { color: #fff; }
.morse-sleep.on { color: #1ed760; }
.morse-sleep span { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); font: 700 10px/1 ui-sans-serif, system-ui; background: #1ed760; color: #000; padding: 3px 6px; border-radius: 9px; white-space: nowrap; }
`, `
morse.watch('[data-testid="player-controls"] .btns', btns => {
  const steps = [15, 30, 60, 0];
  let left = 0, i = -1;
  const label = morse.el("span");
  const btn = morse.el("button", { class: "morse-sleep", title: "Sleep timer", text: "☾", on: { click() {
    i = (i + 1) % steps.length;
    left = steps[i] * 60;
    render();
    morse.toast(left ? "Pausing in " + steps[i] + " minutes" : "Sleep timer off");
  } } });
  const render = () => {
    btn.classList.toggle("on", left > 0);
    label.textContent = left ? Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") : "";
    if (left) btn.append(label); else label.remove();
  };
  morse.every(1000, () => {
    if (!left) return;
    if (--left === 0) {
      const pp = document.querySelector('[data-testid="play-pause"]');
      if (pp && pp.getAttribute("aria-label") === "Pause") pp.click();
      morse.toast("Sleep timer: paused");
    }
    render();
  });
  btns.append(btn);
});
`);

const BIG_COVERS = reply("Bigger rounded covers", `
[data-testid="album-grid"] {
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 24px;
}
[data-testid="album-grid"] > div {
  background: transparent;
  padding: 0;
  transition: transform .2s ease;
}
[data-testid="album-grid"] > div:hover {
  transform: translateY(-4px);
}
[data-testid="album-grid"] > div > div {
  border-radius: 18px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, .55);
  font-size: 18px;
  padding: 16px;
}
[data-testid="album-grid"] > div b {
  font-size: 15px;
  margin-top: 4px;
}
`, "");

const READER = reply("Clean reading mode", `
[data-ad], .ad-slot, aside[aria-label="Sponsored"] {
  display: none !important;
}
.wrap {
  grid-template-columns: 1fr;
  max-width: 720px;
}
body {
  background: #fbf8f1;
  color: #2b2b2b;
}
article h1 {
  font: 700 42px/1.15 Georgia, "Iowan Old Style", serif;
  letter-spacing: -0.5px;
  margin: 40px 0 14px;
}
article .by {
  font-size: 14px;
  color: #8a8172;
  margin-bottom: 28px;
}
article p {
  font: 20px/1.75 Georgia, "Iowan Old Style", serif;
  margin: 0 0 22px;
}
article p:first-of-type::first-letter {
  float: left;
  font-size: 64px;
  line-height: .9;
  padding: 6px 8px 0 0;
  color: #c8102e;
}
`, "");

const FALLBACK = reply("Needs a real model", "", `
morse.toast("The demo replay only knows a few requests. Connect a model for anything else.");
`);

// For the playground (demo/playground.html): a label in its toolbar.
const NOW_PLAYING = reply("Now playing label", `
#toolbar .morse-now { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-size: 14px; background: color-mix(in srgb, currentColor 10%, transparent); }
#toolbar .morse-now b { font-weight: 600; }
`, `
morse.watch("#toolbar", bar => {
  const label = morse.el("span", { class: "morse-now", html: "<b>Now playing</b> Blue in Green" });
  const spacer = bar.querySelector("span[style]");
  spacer ? spacer.before(label) : bar.append(label);
});
`);

const RULES = [
  [/now playing/i, NOW_PLAYING],
  [/word|token count|character count|count/i, WORD_COUNT],
  [/copy|markdown|export/i, COPY_MD],
  [/sleep|timer/i, null],
  [/cover|album|bigger|round/i, BIG_COVERS],
  [/ads?\b|read|clean|clutter/i, READER],
];

// A captured element from another app (God mode): carry its visual styles over
// to whatever the user pointed at, the way a model would when it "rebuilds the
// look natively" (this app's DOM stays, the design changes).
const REBUILD_PROPS = ["background-color", "background-image", "color", "border", "border-radius", "box-shadow", "font-weight", "letter-spacing", "text-transform", "padding", "gap"];
function rebuild(prompt) {
  const json = (prompt.match(/Captured styles \(computed, JSON\):\n(\{.*\})/) || [])[1];
  let styles = {};
  try { styles = JSON.parse(json).root || {}; } catch {}
  const sel = (prompt.match(/Best selector: (.+)$/m) || [])[1] || "body";
  const from = (prompt.match(/captured in another app \(([^,)]+)/) || [])[1] || "another app";
  const decls = REBUILD_PROPS.filter(p => styles[p] && !/^(none|normal|0px|rgba\(0, 0, 0, 0\))$/.test(styles[p]))
    .map(p => `  ${p}: ${styles[p]};`).join("\n");
  return reply(`Rebuilt from ${from}`, `${sel} {\n${decls}\n  transition: background-color .2s ease, color .2s ease;\n}`, "");
}

// Keep iterating (core/prompt.js basePrompt): the demo model edits the code it
// was given. "smaller"/"bigger" scale every px size, "icons" swaps known
// labels for symbols, and a broken mod is fixed by writing it again from its
// original request.
const ICONS = [[/Now playing/g, "♪"], [/Copy as Markdown/g, "⧉"], [/Sleep timer/g, "☾"], [/ words/g, " ✎"]];
function readBase(prompt) {
  const code = prompt.match(/Current code:\n```css\n([\s\S]*?)\n?```\n```js\n([\s\S]*?)\n?```/);
  if (!code) return null;
  const line = re => (prompt.match(re) || [])[1] || "";
  return { original: line(/^Original request: (.*)$/m), css: code[1], js: code[2], followUp: line(/^Follow-up: (.*)$/m), error: line(/^What went wrong: (.*)$/m) };
}
// Self-heal (core/heal.js siteChangedNote): Tunes renamed its album grid in a
// redesign (demo/sites/tunes/?v2). The fix points the same code at the new name
// the note found on the page.
function siteChanged(b, prompt) {
  if (!/site changed its page/.test(prompt) || !/album-grid/.test(b.css + b.js) || !/release-grid/.test(prompt)) return null;
  const swap = s => s.replaceAll("album-grid", "release-grid");
  return reply("Bigger rounded covers", swap(b.css), swap(b.js));
}
function refine(b, prompt = "") {
  if (b.error) {
    const moved = siteChanged(b, prompt); // self-heal hook
    if (moved) return moved;
    const rule = RULES.find(([re]) => re.test(b.original));
    if (rule) return rule[1] || SLEEP;
    return reply("Could not fix", b.css, b.js);
  }
  const ask = b.followUp;
  const scale = /smaller|tighter|less|compact/i.test(ask) ? 0.8 : /bigger|larger|more/i.test(ask) ? 1.25 : 0;
  if (scale) {
    const css = b.css.replace(/(\d+(?:\.\d+)?)px/g, (_, n) => `${Math.max(1, Math.round(n * scale))}px`);
    return reply(scale < 1 ? "Smaller" : "Bigger", css, b.js);
  }
  if (/icon|symbol/i.test(ask)) return reply("Icons", b.css, ICONS.reduce((js, [re, sym]) => js.replace(re, sym), b.js));
  return reply("No change", `/* The demo model can only make it smaller, bigger or use icons. */\n${b.css}`, b.js);
}

// Easier to use: Describe this image (core/a11y.js). The demo model can't
// see; it answers from the text sent along with the picture.
function describeDemo(text) {
  if (/visitors|chart/i.test(text)) return "ANSWER: A bar chart of library visitors from January to June. Visits grow every month, from about 1,200 in January to about 3,400 in June.\n";
  if (/garden|reading/i.test(text)) return "ANSWER: Children sitting on cushions in a sunny library corner, listening to a story being read aloud.\n";
  return "ANSWER: A small picture with no text in it.\n";
}
// Check this page's requests to the model ("Give these 2 icon buttons
// accessible names ...: `#a`, `#b`"): names for the selectors it lists.
function fixesDemo(request) {
  const kind = /accessible name/.test(request) ? "name" : /form field/.test(request) ? "label" : /alt text/.test(request) ? "alt" : "";
  if (!kind) return null;
  const sels = [...request.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const [title, attr, word] = { name: ["Name the menu button", "aria-label", "Menu"], label: ["Label the branch list", "aria-label", "Branch"], alt: ["Describe the pictures", "alt", "Picture"] }[kind];
  return reply(title, "", sels.map(s => `morse.watch(${JSON.stringify(s)}, el => el.setAttribute("${attr}", "${word}"));`).join("\n"));
}

export function demoResponse(messages) {
  const pic = messages.find(m => Array.isArray(m.content) && m.content.some(b => b?.type === "image"));
  if (pic) return describeDemo(pic.content.filter(b => b.type === "text").map(b => b.text).join("\n"));
  // The page context is the last user turn that carries a request (earlier
  // Ask turns come before it; a "That failed" retry comes after).
  const users = messages.filter(m => m.role === "user");
  const firstUser = [...users].reverse().find(m => /^(Request: |Current code:)/m.test(m.content))?.content || users[0]?.content || "";
  if (/Captured styles \(computed, JSON\):/.test(firstUser)) return rebuild(firstUser);
  if (/^The user just showed you a task/m.test(firstUser) && !/^Current code:/m.test(firstUser)) return showOnceDemo(firstUser); // show-once hook
  const base = readBase(firstUser); // keep iterating: refine or fix
  if (base) return refine(base, firstUser);
  const request = [...firstUser.matchAll(/^Request: (.*)$/gm)].pop()?.[1] || "";
  const isRetry = /^That failed/.test(messages.at(-1)?.content || "");
  const answer = demoAnswer(request, firstUser, messages); // Ask and find
  if (answer) return answer;
  const fixes = fixesDemo(request); // Easier to use: Check this page
  if (fixes) return fixes;
  for (const [re, resp] of RULES) {
    if (!re.test(request)) continue;
    if (resp === null) return isRetry ? SLEEP : SLEEP_BROKEN;
    return resp;
  }
  return FALLBACK;
}

// ---- Ask and find: canned answers in the ANSWER/POINT/STEP format (see
// core/answer.js) for the demo sites and the test playground. A request
// phrased as a question lands here instead of in the mod rules above; a few
// generic rules (what does this do, why is it greyed out, where is X) read
// the pointed element and the page outline the way a model would.
const ans = (text, points = [], steps = []) => ["ANSWER: " + text.trim(),
  ...points.map(([s, l]) => `POINT: ${s} | ${l}`), ...steps.map(([s, l]) => `STEP: ${s} | ${l}`)].join("\n") + "\n";
const QUESTION = /\?\s*$|^\s*(what|what's|whats|why|where|where's|how|which|who|when|is|are|does|do|find|show me|explain|help|and)\b/i;
const CHANGE = /^\s*(please\s+)?((can|could|would|will) you\s+)?(please\s+)?(make|add|hide|change|remove|turn|put|move|give|show the|use)\b/i;

const EXPLAIN = {
  byte: ans(`This is a news article on **The Daily Byte**.
- The story itself [1]: why most desktop apps are really web pages.
- The top bar [2] takes you to other sections: Tech, Business, Science, Opinion, Video.
- Boxes marked *Advertisement* [3] are ads, not part of the story.
- The box in the corner [4] asks you to sign up for newsletters. You can ignore it.`,
  [["article h1", "The story"], [".tb", "Sections"], ['[data-ad="leaderboard"]', "An ad"], [".pop", "Newsletter sign-up"]]),
  parley: ans(`This is **Parley**, a chat assistant. You type a question and it writes back.
- Your earlier chats are on the left [1]; click one to reopen it.
- The current conversation is in the middle [2].
- Type a new message at the bottom [3] and press Enter to send it.
- Share [4] makes a link to this chat; your account menu [5] has Settings.`,
  [['nav[aria-label="Chat history"]', "Earlier chats"], ['section[aria-label="Conversation"]', "This conversation"], ['textarea[aria-label="Message Parley"]', "Message box"], ["header .h7r button", "Share"], ['summary[aria-label="Account menu"]', "Account menu"]]),
  tunes: ans(`This is **Tunes**, a music player, on its home screen.
- Albums picked for you are in the middle [1]; click one to play it.
- The left side [2] switches between Home, Search, your library and playlists.
- The player at the bottom [3] shows what's playing, with play, skip, shuffle and repeat.
- Volume is at the bottom right [4].`,
  [['[data-testid="album-grid"]', "Albums"], ["nav", "Menu"], ['[data-testid="player-controls"]', "Player"], [".vol", "Volume"]]),
  playground: ans(`This is a small notes app.
- The tabs [1] switch between all your notes and shared ones.
- **Publish** [2] is greyed out until the note has a title.
- The More menu [3] has Export, notification settings and help.`,
  [['[role="tablist"]', "Tabs"], ["#publish", "Publish"], ["#more", "More menu"]]),
};

const SITE_ANSWERS = [
  ["parley", /notif/i, ans(`Notification settings are in **Settings**, behind your account menu.
1. Open the account menu [1] (your initials, top right).
2. Choose **Settings** [2].
3. Pick the **Notifications** tab [3].`,
  [['summary[aria-label="Account menu"]', "Account menu"], ['a[href="#settings"]', "Settings"], ['a[href="#settings-notifications"]', "Notifications tab"]],
  [['summary[aria-label="Account menu"]', "Open the account menu"], ['a[href="#settings"]', "Choose Settings"], ['a[href="#settings-notifications"]', "Pick the Notifications tab"]])],
  ["parley", /setting|password|account/i, ans(`Settings are behind your account menu.
1. Open the account menu [1] (your initials, top right).
2. Choose **Settings** [2].`,
  [['summary[aria-label="Account menu"]', "Account menu"], ['a[href="#settings"]', "Settings"]],
  [['summary[aria-label="Account menu"]', "Open the account menu"], ['a[href="#settings"]', "Choose Settings"]])],
  ["playground", /export|pdf|download/i, ans(`**Export** is in the More menu [1] at the end of the toolbar.
1. Open the More menu [1].
2. Choose **Export as PDF** [2].`,
  [["#more", "More menu"], ["#export", "Export as PDF"]],
  [["#more", "Open the More menu"], ["#export", "Choose Export as PDF"]])],
  ["playground", /notif/i, ans(`Notification settings are in the More menu [1]. Open it and choose **Notification settings** [2].`,
  [["#more", "More menu"], ['#more-menu [data-item="notifications"]', "Notification settings"]],
  [["#more", "Open the More menu"], ['#more-menu [data-item="notifications"]', "Choose Notification settings"]])],
];

// What a pointed-at control does, in plain words.
const CONTROLS = [
  [/^repeat$/i, "This is **Repeat** [1]. Click it once to play the whole list again when it ends, twice to repeat just this song. Click again to turn it off."],
  [/^shuffle$/i, "This is **Shuffle** [1]. When it's on, songs play in a random order instead of the order you see."],
  [/^(pause|play)$/i, "This is **Play/Pause** [1]. It starts or stops the song that's playing now."],
  [/^previous$/i, "This is **Previous** [1]. Click once to restart the song, twice to go back to the one before."],
  [/^next$/i, "This is **Next** [1]. It skips to the next song."],
  [/^share$/i, "This is **Share** [1]. It makes a link to what you're looking at, so you can send it to someone."],
];

function labelOf(html) {
  const aria = html.match(/aria-label="([^"]+)"/);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return aria?.[1] || text || (html.match(/(?:title|placeholder)="([^"]+)"/) || [])[1] || "";
}

// The page outline (runtime/src/20-context.js): `selector  "label"  (note)`.
function outlineLines(prompt) {
  const block = (prompt.match(/Page outline:\n([\s\S]*?)(\n\n|$)/) || [])[1] || "";
  return block.split("\n").map(l => l.match(/^(.+?)(?:  "(.*?)")?(?:  \((.*)\))?$/)).filter(Boolean)
    .map(m => ({ selector: m[1], label: m[2] || "", note: m[3] || "" }));
}
const STOP = new Set("where is are the a an do i can how to find my me show what this that of in on for change set see get button".split(" "));
function findInOutline(request, prompt) {
  const words = request.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  if (!words.length) return null;
  let best = null, top = 0;
  for (const line of outlineLines(prompt)) {
    const hay = line.label.toLowerCase();
    const score = words.filter(w => hay.includes(w.replace(/s$/, ""))).length + (/button|link|tab|menu/.test(line.note) ? 0.1 : 0);
    if (score > top) { best = line; top = score; }
  }
  return top >= 1 ? best : null;
}

function followUp(earlier) {
  if (/export/i.test(earlier)) return ans(`Exporting only saves a copy, so there's nothing on the page to undo. If you don't need the file, delete it from your Downloads folder.`);
  if (/notification/i.test(earlier)) return ans(`Go back to the same place: account menu, **Settings**, **Notifications** tab, and switch the option back. Changes there take effect right away.`);
  if (/repeat/i.test(earlier)) return ans(`Click **Repeat** [1] until it looks like the other buttons again. That means repeat is off.`, [['[aria-label="Repeat"]', "Repeat"]]);
  return ans(`Do the same steps again and switch it back. If you tell me what you changed, I can point at the exact spot.`);
}

function explainGeneric(prompt) {
  const lines = outlineLines(prompt);
  const title = (prompt.match(/^Page title: (.*)$/m) || [])[1] || "this page";
  const heads = lines.filter(l => /(^|\s)h[12]\b/.test(l.selector) && l.label).slice(0, 2);
  const acts = lines.filter(l => /button|link|tab|menu/.test(l.note) && l.label).slice(0, 3);
  const pts = [...heads, ...acts];
  return ans(`This is **${title}**.\n${pts.map((p, i) => `- ${p.label} [${i + 1}]`).join("\n")}`, pts.map(p => [p.selector, p.label]));
}

function demoAnswer(request, prompt, messages) {
  const explain = /^Explain this page:/m.test(prompt) || /\bexplain (this|the) (page|screen|app)\b/i.test(request);
  if (!explain && (!QUESTION.test(request) || CHANGE.test(request))) return null;
  const title = (prompt.match(/^Page title: (.*)$/m) || [])[1] || "";
  const site = /Parley/.test(title) ? "parley" : /Tunes/.test(title) ? "tunes" : /Daily Byte/.test(title) ? "byte" : /playground/i.test(title) ? "playground" : "";
  if (explain) return EXPLAIN[site] || explainGeneric(prompt);
  const earlier = messages.filter(m => m.role === "assistant" && /^ANSWER:/.test(m.content)).map(m => m.content).join("\n");
  if (earlier && /^\s*(and|then|ok|okay|so|but)\b|\bundo\b/i.test(request)) return followUp(earlier);
  for (const [s, re, reply] of SITE_ANSWERS) if (s === site && re.test(request)) return reply;

  const sel = (prompt.match(/Best selector: (.+)$/m) || [])[1];
  const html = (prompt.match(/Element HTML:\n(.*)/) || [])[1] || "";
  if (sel && /grey|gray|disabled|can'?t (click|press|use)|not work/i.test(request)) {
    const label = labelOf(html), why = (html.match(/title="([^"]+)"/) || [])[1];
    return /\sdisabled[\s=>]/.test(html)
      ? ans(`**${label}** [1] is turned off right now${why ? `: “${why}”` : ", because something it needs isn't filled in yet"}. Once that's done it lights up and you can click it.`, [[sel, label]])
      : ans(`**${label}** [1] isn't turned off; it just uses a lighter color. You can click it.`, [[sel, label]]);
  }
  if (sel && /what|this|do\b/i.test(request)) {
    const label = labelOf(html);
    const known = CONTROLS.find(([re]) => re.test(label));
    return ans(known ? known[1] : `This is **${label || "this part of the page"}** [1]. Try hovering it: most apps show a short tip that says what it does.`, [[sel, label || "This"]]);
  }
  const hit = findInOutline(request, prompt);
  if (hit) {
    const menu = (hit.note.match(/in closed menu "([^"]+)"/) || [])[1];
    const opener = menu && outlineLines(prompt).find(l => l.label === menu && /menu button/.test(l.note));
    if (opener) return ans(`**${hit.label}** is in the ${menu} menu [1]. Open it, then choose **${hit.label}** [2].`,
      [[opener.selector, menu], [hit.selector, hit.label]], [[opener.selector, `Open the ${menu} menu`], [hit.selector, `Choose ${hit.label}`]]);
    return ans(`Here it is: **${hit.label}** [1].`, [[hit.selector, hit.label]]);
  }
  return ans(`Demo mode only knows a few questions about the demo sites. With a local model (\`ollama pull qwen2.5-coder:7b\`) you can ask anything about this page.`);
}
