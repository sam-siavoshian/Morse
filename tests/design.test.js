// New UI should look like it shipped with the app:
//   - the design context (runtime/src/20-context.js designOf, marked
//     "// design"): theme variables near the target, fonts and scale, the
//     app's own components with their classes and look, its icons, light/dark
//   - the prompt's Design rules and the "Design system" part of the request
//   - the polish round (core/polish.js) with a fake model and fake pictures
//   - the "Polish changes" setting (core/prefs.js)
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMessages, SYSTEM_PROMPT } from "../core/prompt.js";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { wantsPolish, polishMessages, POLISH_ASK } from "../core/polish.js";
import { DEFAULT_PREFS, normalizePrefs, mergePrefs } from "../core/prefs.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import EN from "../core/locales/en.js";

const skip = noBrowser;
const SRC = readFileSync(new URL("../runtime/src/20-context.js", import.meta.url), "utf8");
let browser, page;

// An app shaped like Obsidian: theme classes switch a palette of variables,
// a status bar of items, lucide icons, a button and a list row nearby. Plus
// noise the design context should leave out, and things it must redact.
const APP = `<!doctype html><title>Notes</title>
<style>
  body.theme-dark { --background-primary: #1e1e1e; --text-normal: #dadada; --text-muted: #b3b3b3; --interactive-accent: #7f6df2;
    --status-bar-background: #262626; --status-bar-text-color: #b3b3b3; --radius-s: 4px; --button-radius: 5px; --font-interface: "Inter", sans-serif;
    --size-4-2: 8px; --tw-ring-shadow: 0 0 #0000; --icon-play-content: "\\ea01"; --owner-contact: "ada@example.org"; }
  body.theme-light { --background-primary: #ffffff; --text-normal: #222222; }
  body { margin: 0; background: var(--background-primary); color: var(--text-normal); font: 14px var(--font-interface); }
  .status-bar { position: fixed; bottom: 0; right: 0; display: flex; gap: 4px; padding: 2px 8px; background: var(--status-bar-background); color: var(--status-bar-text-color); }
  .status-bar-item { padding: 3px 4px; border-radius: var(--radius-s); font-size: 12px; }
  .status-bar-item:hover { background: var(--background-modifier-hover, #333); }
  button.mod-cta { background: var(--interactive-accent); color: #fff; border: 0; border-radius: var(--button-radius); padding: 4px 12px; height: 30px; }
  .tree-item-self { padding: 4px 8px; border-radius: 6px; color: var(--text-muted); }
  svg.svg-icon { width: 16px; height: 16px; stroke: currentColor; fill: none; }
</style>
<body class="theme-dark">
  <aside style="width:260px"><div class="tree-item-self nav-file-title">Groceries</div><div class="tree-item-self nav-file-title">Welcome</div>
    <button class="mod-cta"><svg class="svg-icon lucide-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New note</button></aside>
  <main><h1>Welcome</h1><p>Some text to read. Written by ada@example.org.</p></main>
  <div class="status-bar"><div class="status-bar-item">0 backlinks</div><div class="status-bar-item">348 words</div></div>
</body>`;
const PLAIN = `<!doctype html><title>Plain</title><body style="background:#fff;color:#111;font:16px Georgia"><nav><a href="/">Home</a> <button>Go</button></nav><p>Hello</p></body>`;

before(async () => {
  if (skip) return;
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route("http://app.test/**", r => r.fulfill({ contentType: "text/html", body: r.request().url().includes("plain") ? PLAIN : APP }));
});
after(() => browser?.close());

const contextFor = async (url, sel) => {
  await page.goto(url);
  return page.evaluate(`(() => {
    const S = { app: null, target: ${JSON.stringify(sel)} ? document.querySelector(${JSON.stringify(sel || "x")}) : null };
    const getLanguage = () => "en", __en = ${JSON.stringify(EN)};
    const t = (id, v = {}) => String(__en[id] ?? id).replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m);
    ${SRC}
    return context();
  })()`);
};

test("design: the app's variables, fonts, components, icons and mode reach the model", { skip }, async () => {
  const ctx = await contextFor("http://app.test/", ".status-bar");
  const d = ctx.design;
  assert.match(d, /Mode: dark \(background #1e1e1e; \.theme-dark\)/);
  assert.match(d, /The app has light and dark themes/);
  // Variables near the target (named after where it is, or read by its rules) and the core palette.
  for (const v of ["--status-bar-background: #262626", "--status-bar-text-color: #b3b3b3", "--interactive-accent: #7f6df2", "--text-normal: #dadada", "--radius-s: 4px"]) assert.ok(d.includes(v), `missing ${v}`);
  // Noise stays out.
  assert.ok(!d.includes("--tw-ring-shadow"), "Tailwind plumbing");
  assert.ok(!d.includes("--icon-play-content"), "icon font code points");
  // The items already in the status bar, with their classes and variables as written.
  assert.match(d, /item here: <div class="status-bar-item">.*radius var\(--radius-s\) = 4px/);
  assert.match(d, /hover background var\(--background-modifier-hover, #333\)/);
  assert.match(d, /button: <button class="mod-cta">.*background var\(--interactive-accent\) = #7f6df2.*radius var\(--button-radius\) = 5px/);
  assert.match(d, /list row: <div class="tree-item-self nav-file-title">/);
  assert.match(d, /Fonts: Inter, sans-serif/);
  assert.match(d, /Icons: lucide SVG icons .*lucide-plus/);
  assert.match(d, /don't use emoji as icons/);
  // redact: the design context passes through the same gate as the rest.
  assert.ok(!JSON.stringify(ctx).includes("ada@example.org"), "an email in a variable or text");
});

test("design: an app without variables says so, and the prompt carries the design part", { skip }, async () => {
  const ctx = await contextFor("http://app.test/plain", null);
  assert.match(ctx.design, /Mode: light \(background #ffffff\)\. No dark theme found\./);
  assert.match(ctx.design, /CSS variables: none\. The app sets colors directly/);
  assert.match(ctx.design, /Fonts: Georgia/);
  const [sys, user] = buildMessages({ request: "add a button", context: ctx });
  assert.match(user.content, /Design system \(match it\):\nMode: light/);
  assert.equal(sys.content, SYSTEM_PROMPT);
});

test("the prompt's design rules: variables over fixed colors, the app's classes, both modes, icons, complete features", () => {
  assert.match(SYSTEM_PROMPT, /Reuse the app's own classes and CSS variables: color: var\(--x\), never a hard-coded color when a variable exists/);
  assert.match(SYSTEM_PROMPT, /Copy font, size, height, padding, radius, border and hover from the app's component of the same kind/);
  assert.match(SYSTEM_PROMPT, /light and dark mode/);
  assert.match(SYSTEM_PROMPT, /No emoji as icons unless the app uses emoji/);
  assert.match(SYSTEM_PROMPT, /an empty state, keyboard access .*morse\.store.*no console errors.*morse\.watch/);
  // No design context (an older runtime): nothing is added.
  const [, user] = buildMessages({ request: "x", context: { url: "u", title: "t" } });
  assert.ok(!/Design system/.test(user.content));
});

// ---- polish (core/polish.js) with a fake model and fake pictures
const DRAFT = "TITLE: Timer\n```css\n.pomo { color: red; }\n```\n```js\nmorse.watch('.status-bar', bar => bar.append(morse.el('div', { class: 'pomo', text: '25:00' })));\n```";
const POLISHED = "FIX: The red text is foreign; use the status bar's color.\nFIX: Match the items' padding.\nTITLE: Timer\n```css\n.pomo { color: var(--status-bar-text-color); padding: 3px 4px; }\n```\n```js\nmorse.watch('.status-bar', bar => bar.append(morse.el('div', { class: 'pomo status-bar-item', text: '25:00' })));\n```";
const PIC = { mediaType: "image/jpeg", data: Buffer.from("fake jpeg bytes").toString("base64") };

function fakeModel(replies) {
  const calls = [];
  // "demo" is a provider that may receive pictures (core/providers.js SEES_IMAGES).
  registerProvider("demo", async (s, messages, { onToken } = {}) => {
    calls.push(messages);
    const r = replies.shift() ?? "OK";
    onToken?.(r);
    return r;
  });
  return calls;
}
const host = () => {
  const h = { css: "", runs: [], shots: 0, events: [] };
  h.exec = async js => { h.runs.push(js); return /THROW/.test(js) ? { ok: false, error: "boom" } : { ok: true }; };
  h.emit = e => { h.events.push(e); if (e.type === "css") h.css = e.css; };
  h.review = async () => { h.shots++; return PIC; };
  return h;
};

test("polish: the model sees a picture of the change and its fixed version replaces the draft", async () => {
  const calls = fakeModel([DRAFT, POLISHED]);
  const h = host();
  const res = await runMorse({ settings: { provider: "demo" }, request: "add a pomodoro timer to the status bar", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: true });
  assert.equal(res.ok, true);
  assert.equal(h.shots, 1);
  assert.equal(calls.length, 2);
  // The second call: the same request, the draft as written, then the picture and the question.
  const last = calls[1].at(-1);
  assert.equal(calls[1].at(-2).role, "assistant");
  assert.equal(calls[1].at(-2).content, DRAFT);
  assert.deepEqual(last.content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: PIC.data } });
  assert.equal(last.content[1].text, POLISH_ASK);
  // The polished version is on the page and is what gets saved.
  assert.match(res.css, /var\(--status-bar-text-color\)/);
  assert.match(res.js, /status-bar-item/);
  assert.equal(h.css, res.css);
  assert.equal(h.runs.at(-1), res.js);
  assert.equal(res.polish.verdict, "fixed");
  assert.deepEqual(res.polish.fixes, ["The red text is foreign; use the status bar's color.", "Match the items' padding."]);
  assert.ok(res.polish.ms >= 0 && res.timing.polish >= 0);
  assert.ok(h.events.some(e => e.type === "phase" && e.phase === "polishing"), "the bar says it's checking the look");
});

test("polish: OK keeps the draft; a fix that fails to run puts the draft back", async () => {
  fakeModel([DRAFT, "OK"]);
  let h = host();
  let res = await runMorse({ settings: { provider: "demo" }, request: "add a pomodoro timer", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: true });
  assert.equal(res.polish.verdict, "ok");
  assert.match(res.css, /color: red/);
  assert.equal(h.runs.length, 1);

  fakeModel([DRAFT, POLISHED.replace("bar.append(", "THROW; bar.append(")]);
  h = host();
  res = await runMorse({ settings: { provider: "demo" }, request: "add a pomodoro timer", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: true });
  assert.equal(res.ok, true);
  assert.equal(res.polish.verdict, "kept");
  assert.match(res.css, /color: red/, "the draft that worked");
  assert.match(h.css, /color: red/, "its CSS is back on the page");
  assert.equal(h.runs.at(-1), res.js, "and its JS runs again");

  // A new version that drops what the change does isn't a polish.
  fakeModel([DRAFT, "TITLE: Timer\n```css\n.pomo { color: inherit }\n```"]);
  h = host();
  res = await runMorse({ settings: { provider: "demo" }, request: "add a pomodoro timer", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: true });
  assert.equal(res.polish.verdict, "kept");
  assert.match(res.js, /morse\.el/);
});

test("polish: off, a tiny CSS tweak, no picture, or a fix of a saved mod: no extra round", async () => {
  let calls = fakeModel([DRAFT]);
  let h = host();
  let res = await runMorse({ settings: { provider: "demo" }, request: "add a timer", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: false });
  assert.equal(h.shots, 0); assert.equal(calls.length, 1); assert.equal(res.polish, undefined);

  calls = fakeModel(["TITLE: Hide\n```css\n.ad { display: none !important }\n```"]);
  h = host();
  res = await runMorse({ settings: { provider: "demo" }, request: "hide the ads", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: true });
  assert.equal(h.shots, 0, "a small CSS tweak skips the look"); assert.equal(calls.length, 1);

  calls = fakeModel([DRAFT]);
  h = host();
  res = await runMorse({ settings: { provider: "demo" }, request: "add a timer", context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: async () => null, polish: true });
  assert.equal(res.polish.verdict, "noshot"); assert.equal(calls.length, 1);

  calls = fakeModel([DRAFT]);
  h = host();
  res = await runMorse({ settings: { provider: "demo" }, request: "add a timer", base: { prompt: "add a timer", css: "", js: "x", error: "stopped working" }, context: { url: "u", title: "t" }, emit: h.emit, exec: h.exec, review: h.review, polish: true });
  assert.equal(h.shots, 0, "fixing a saved mod keeps it as it was meant to look"); assert.equal(calls.length, 1);
});

test("polish: which changes are worth a look", () => {
  assert.equal(wantsPolish({ css: "", js: "morse.watch('.bar', b => b.append(morse.el('button', { text: 'Go' })))" }, "add a go button"), true);
  assert.equal(wantsPolish({ css: ".list li { padding: 2px 6px; height: 20px; line-height: 20px; font-size: 12px }", js: "" }, "restyle the list to be more compact"), true);
  assert.equal(wantsPolish({ css: ".ad, .promo { display: none !important }", js: "" }, "hide the ads"), false);
  assert.equal(wantsPolish({ css: "h1 { font-size: 40px }", js: "" }, "make the title bigger"), false);
  assert.equal(wantsPolish({ css: "body::after { content: 'Draft'; position: fixed }", js: "" }, "add a draft label"), true);
  // The messages for the look: request and page as before, then the draft and the picture.
  const m = polishMessages({ request: "add x", context: { url: "u", title: "t" }, raw: "R", shot: PIC });
  assert.equal(m[0].role, "system");
  assert.equal(m.at(-2).content, "R");
  assert.equal(m.at(-1).content[0].source.media_type, "image/jpeg");
});

test("the Polish changes setting: on by default, can be turned off, survives a reset of others", () => {
  assert.equal(DEFAULT_PREFS.polish, true);
  assert.equal(normalizePrefs({}).polish, true);
  assert.equal(normalizePrefs({ polish: false }).polish, false);
  assert.equal(normalizePrefs({ polish: "no" }).polish, true, "only false turns it off");
  assert.equal(mergePrefs({ polish: false }, { theme: "dark" }).polish, false);
  assert.equal(mergePrefs({ polish: false }, { polish: true }).polish, true);
});
