// Keep iterating, the pure parts: the refine/fix prompt, version history
// helpers, relative times, and the demo model's refine and fix replies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessages } from "../core/prompt.js";
import { createMod, validateMod, encodeShare, decodeShare, HISTORY_CAP, versionsOf, reviseMod, restoreVersion, stepBack, relativeTime } from "../core/mod.js";
import { demoResponse } from "../core/demo.js";
import { parseModResponse } from "../core/parse.js";
import { runMorse } from "../core/engine.js";

const ctx = { url: "https://app.example.com/", title: "App", outline: "header" };
const base = { prompt: "add a now playing label", css: "#toolbar .morse-now { font-size: 14px; }", js: "morse.watch('#toolbar', b => b.append(morse.el('span')));" };

test("no base: the prompt is unchanged", () => {
  const user = buildMessages({ request: "make it dark", context: ctx })[1].content;
  assert.match(user, /^Request: make it dark$/m);
  assert.doesNotMatch(user, /Current code|Follow-up/);
});

test("refine: the model gets the original request, the current code and the follow-up, and is asked for a full replacement", () => {
  const msgs = buildMessages({ request: "make it smaller", context: ctx, base });
  assert.equal(msgs.length, 2);
  const user = msgs[1].content;
  assert.match(user, /^Original request: add a now playing label$/m);
  assert.ok(user.includes("```css\n#toolbar .morse-now { font-size: 14px; }\n```"));
  assert.ok(user.includes("```js\nmorse.watch('#toolbar', b => b.append(morse.el('span')));\n```"));
  assert.match(user, /^Follow-up: make it smaller$/m);
  assert.match(user, /complete new version/);
  assert.doesNotMatch(user, /^Request:/m, "the follow-up isn't mistaken for a fresh request");
  assert.ok(user.indexOf("Page outline") < user.indexOf("Original request"), "page context comes first");
});

test("fix: the error goes in, and the self-repair retry still works on top", () => {
  const user = buildMessages({ request: base.prompt, context: ctx, base: { ...base, error: "nowPlaying is not defined" } })[1].content;
  assert.match(user, /stopped working/);
  assert.match(user, /^What went wrong: nowPlaying is not defined$/m);
  assert.match(user, /Fix it so it works on the page as it is now/);
  assert.doesNotMatch(user, /Follow-up/);
  const retry = buildMessages({ request: "x", context: ctx, base, previous: { raw: "TITLE: y", error: "boom" } });
  assert.equal(retry.length, 4);
  assert.match(retry[3].content, /boom/);
});

test("reviseMod keeps the version it replaces; the original request stays the mod's prompt", () => {
  const m0 = createMod({ prompt: "add a label", css: "a{}", js: "1;", url: "https://x.test/" });
  assert.deepEqual(versionsOf(m0), [], "old mods without history have none");
  const m1 = reviseMod(m0, { prompt: "make it smaller", css: "b{}", js: "2;" }, "2026-01-01T00:00:00.000Z");
  assert.equal(m1.prompt, "add a label");
  assert.equal(m1.refined, "make it smaller");
  assert.equal(m1.css, "b{}");
  assert.equal(m1.updated, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(m1.history, [{ prompt: "add a label", css: "a{}", js: "1;", at: m0.updated }]);
  assert.equal(m0.history, undefined, "the input is not changed");
  const m2 = reviseMod(m1, { prompt: "use icons", css: "c{}", js: "3;" });
  assert.deepEqual(m2.history.map(v => v.prompt), ["add a label", "make it smaller"]);
  assert.doesNotThrow(() => validateMod(m2));
});

test("history is capped at 20, dropping the oldest", () => {
  let m = createMod({ prompt: "v0", css: "", js: "", url: "https://x.test/" });
  for (let i = 1; i <= 25; i++) m = reviseMod(m, { prompt: `v${i}`, css: `/*${i}*/`, js: "" });
  assert.equal(HISTORY_CAP, 20);
  assert.equal(m.history.length, 20);
  assert.equal(m.history[0].prompt, "v5");
  assert.equal(m.history.at(-1).prompt, "v24");
  assert.equal(m.refined, "v25");
});

test("restoreVersion brings one back and keeps the current; stepBack drops the current", () => {
  let m = createMod({ prompt: "a", css: "1", js: "", url: "https://x.test/" });
  m = reviseMod(m, { prompt: "b", css: "2", js: "" });
  m = reviseMod(m, { prompt: "c", css: "3", js: "" });
  const r = restoreVersion(m, 0);
  assert.equal(r.css, "1");
  assert.equal(r.refined, undefined, "back to the original request");
  assert.deepEqual(r.history.map(v => v.css), ["1", "2", "3"]);
  assert.equal(restoreVersion(m, 9), m, "no such version: unchanged");
  const back = stepBack(m);
  assert.equal(back.css, "2");
  assert.equal(back.refined, "b");
  assert.deepEqual(back.history.map(v => v.css), ["1"]);
  assert.equal(stepBack(stepBack(back)), null, "nothing before the first version");
});

test("versionsOf drops malformed entries; createMod carries a draft's versions; share links leave history out", async () => {
  assert.deepEqual(versionsOf({ history: [null, { css: 1 }, { prompt: "p", css: "", js: "", at: 5 }] }), [{ prompt: "p", css: "", js: "", at: null }]);
  assert.deepEqual(versionsOf({ history: "nope" }), []);
  const m = createMod({ prompt: "a", css: "x{}", js: "", url: "https://x.test/", history: [{ prompt: "a", css: "", js: "", at: null }], refined: "smaller" });
  assert.equal(m.history.length, 1);
  assert.equal(m.refined, "smaller");
  const back = await decodeShare(await encodeShare(m));
  assert.equal(back.history, undefined);
  assert.equal(back.refined, "smaller");
});

test("relative times in plain words", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const ago = s => new Date(now - s * 1000).toISOString();
  assert.equal(relativeTime(ago(10), now), "just now");
  assert.equal(relativeTime(ago(5 * 60), now), "5 min ago");
  assert.equal(relativeTime(ago(3600), now), "1 hour ago");
  assert.equal(relativeTime(ago(3 * 3600), now), "3 hours ago");
  assert.equal(relativeTime(ago(26 * 3600), now), "yesterday");
  assert.equal(relativeTime(ago(4 * 86400), now), "4 days ago");
  assert.equal(relativeTime("2026-03-02T12:00:00Z", now), "Mar 2");
  assert.equal(relativeTime("2025-03-02T12:00:00Z", now), "Mar 2, 2025");
  assert.equal(relativeTime(null, now), "");
});

test("demo model: refines the code it is given, and fixes a broken mod from its request", () => {
  const ask = (request, b) => parseModResponse(demoResponse(buildMessages({ request, context: ctx, base: b })));
  assert.match(ask("make it smaller", base).css, /font-size: 11px/);
  assert.match(ask("make it bigger", base).css, /font-size: 18px/);
  const icons = ask("use icons instead", { ...base, js: `morse.el("b", { text: "Now playing" })` });
  assert.match(icons.js, /♪/);
  const fixed = ask("add a now playing label to the toolbar", { prompt: "add a now playing label to the toolbar", css: "", js: "morse.watch('#player-bar', () => {})", error: "nothing matched" });
  assert.match(fixed.js, /morse\.watch\("#toolbar"/);
});

test("runMorse sends the base through to the model", async () => {
  const res = await runMorse({ settings: { provider: "demo" }, request: "make it smaller", context: ctx, base, exec: async () => ({ ok: true }), emit: () => {} });
  assert.equal(res.ok, true);
  assert.match(res.css, /font-size: 11px/);
  assert.equal(res.js.trim(), base.js);
});
