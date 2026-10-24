// Demo replay (internal test fixture): pre-written model replies for a handful
// of requests, so tests and screenshot scripts run without a model. Everything downstream
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
morse.toast("The demo replay only knows a few requests. Connect a model for anything else.");
`);

const RULES = [
  [/word|token count|character count|count/i, WORD_COUNT],
  [/copy|markdown|export/i, COPY_MD],
  [/sleep|timer/i, null],
  [/cover|album|bigger|round/i, BIG_COVERS],
  [/ads?\b|read|clean|clutter/i, READER],
];

export function demoResponse(messages) {
  const firstUser = messages.find(m => m.role === "user")?.content || "";
  const request = (firstUser.match(/Request: (.*)$/m) || [])[1] || "";
  const isRetry = messages.length > 2;
  for (const [re, resp] of RULES) {
    if (!re.test(request)) continue;
    if (resp === null) return isRetry ? SLEEP : SLEEP_BROKEN;
    return resp;
  }
  return FALLBACK;
}
