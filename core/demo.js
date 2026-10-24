// Demo mode: pre-written model replies for a handful of requests, so Morse can
// be tried (and screenshotted) without a local model. Everything downstream
// is real: the reply is streamed, parsed, injected and run like model output.
// One reply ships a deliberate bug on the first try to exercise self-repair.

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
morse.toast("Demo mode only knows a few requests. Run Ollama (ollama pull qwen2.5-coder:7b) for anything else.");
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
function refine(b) {
  if (b.error) {
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

export function demoResponse(messages) {
  const firstUser = messages.find(m => m.role === "user")?.content || "";
  if (/Captured styles \(computed, JSON\):/.test(firstUser)) return rebuild(firstUser);
  const base = readBase(firstUser);
  if (base) return refine(base);
  const request = (firstUser.match(/Request: (.*)$/m) || [])[1] || "";
  const isRetry = messages.length > 2;
  for (const [re, resp] of RULES) {
    if (!re.test(request)) continue;
    if (resp === null) return isRetry ? SLEEP : SLEEP_BROKEN;
    return resp;
  }
  return FALLBACK;
}
