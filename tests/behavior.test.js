// A request that asks for behavior has to come back with behavior. A restyle
// still may be only CSS. The demo model can do the like/dislike feed, and a
// follow-up revises that same change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksHard, wantsBehavior } from "../core/route.js";
import { needsLogic } from "../core/profile.js";
import { implementsBehavior, cosmeticBehavior, COSMETIC_ERROR } from "../core/hooks.js";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { demoResponse } from "../core/demo.js";
import { buildMessages } from "../core/prompt.js";
import { parseModResponse } from "../core/parse.js";

const ASK = "Add a feature that lets me like or dislike a post, and it should affect the recommendation and show me more of that type of post";
const PLAIN = "Let me like or dislike a post so recommendations show more of that type";
const ctx = { url: "https://feed.test/", title: "Feed" };

test("behavior asks are planned as behavior, and visual asks stay visual", () => {
  assert.equal(wantsBehavior(ASK), true);
  assert.equal(wantsBehavior(PLAIN), true);
  assert.equal(needsLogic(PLAIN), true, "a recommendation ask gets the app profile without the word feature");
  assert.equal(looksHard(ASK, {}).hard, true);
  for (const r of ["make the title bigger", "make the covers bigger", "make it look like a card", "add a now playing label", "hide this ribbon", "make the status bar taller", "Don't undo the user's style"]) {
    assert.equal(wantsBehavior(r), false, r);
  }
  assert.equal(wantsBehavior("add undo"), true);
  assert.equal(needsLogic("make the status bar taller"), false);
  assert.equal(needsLogic("hide this ribbon"), false);
  assert.equal(looksHard("make the album covers bigger", { notes: "" }).hard, false);
});

test("a look-only draft is not behavior; a ranker that remembers a choice is", () => {
  assert.equal(implementsBehavior(""), false);
  assert.equal(implementsBehavior(".title { font-size: 20px }"), false);
  assert.equal(implementsBehavior('morse.el("button", { on: { click() { btn.classList.toggle("on"); } } });'), false);
  assert.equal(implementsBehavior('morse.store.set("morse-taste", { music: 1 }); items.sort((a, b) => 0);'), true);
  assert.equal(cosmeticBehavior({ css: "h1 { font-size: 40px }", js: "" }, "make the title bigger"), null);
  const missed = cosmeticBehavior({ css: ".morse-like { color: red }", js: "" }, ASK);
  assert.equal(missed.user, COSMETIC_ERROR);
  assert.match(missed.model, /CSS alone is not enough/);
});

test("the demo model ranks the feed, and a follow-up hides what was disliked", () => {
  const first = parseModResponse(demoResponse(buildMessages({ request: ASK, context: ctx })));
  assert.equal(first.title, "Like or dislike to tune feed");
  assert.match(first.js, /morse\.store/);
  assert.match(first.js, /\.sort\(/);
  assert.match(first.js, /Like/);
  assert.match(first.js, /Dislike/);
  assert.equal(cosmeticBehavior(first, ASK), null);

  const again = "show me more of that type of post";
  assert.match(demoResponse(buildMessages({ request: again, context: ctx })), /^TITLE: Like or dislike to tune feed/);

  const second = parseModResponse(demoResponse(buildMessages({
    request: "hide posts I dislike",
    context: ctx,
    base: { prompt: ASK, title: first.title, css: first.css, js: first.js },
  })));
  assert.match(second.js, /morse-down/);
  assert.match(second.js, /morse\.store/);
  assert.match(second.js, /Like/);
  assert.match(second.css, /\.morse-down/);
});

test("a behavior ask is sent back when the draft only restyles, then kept when it does the work", async () => {
  const good = demoResponse(buildMessages({ request: ASK, context: ctx }));
  const cssOnly = "TITLE: Pretty buttons\n```css\n.morse-like { color: red; }\n```\n```js\n```\n";
  const prompts = [];
  registerProvider("cosmetic-feed", async (s, messages, { onToken }) => {
    prompts.push(messages.at(-1).content);
    const r = prompts.length === 1 ? cssOnly : good;
    onToken(r);
    return r;
  });
  const res = await runMorse({
    settings: { provider: "cosmetic-feed" },
    request: ASK,
    context: ctx,
    emit: () => {},
    exec: async () => ({ ok: true }),
  });
  assert.equal(res.ok, true);
  assert.match(prompts[1], /CSS alone is not enough/);
  assert.match(res.js, /morse\.store/);

  registerProvider("cosmetic-feed-stuck", async (s, messages, { onToken }) => { onToken(cssOnly); return cssOnly; });
  const stuck = await runMorse({
    settings: { provider: "cosmetic-feed-stuck" },
    request: PLAIN,
    context: ctx,
    emit: () => {},
    exec: async () => ({ ok: true }),
  });
  assert.equal(stuck.ok, false);
  assert.equal(stuck.cosmetic, true);
  assert.equal(stuck.error, COSMETIC_ERROR);
  assert.equal(stuck.css, "");
  assert.equal(stuck.js, "");
});

test("a visual edit is still accepted as CSS", async () => {
  const css = "TITLE: Bigger title\n```css\nh1 { font-size: 40px; }\n```\n```js\n```\n";
  registerProvider("visual-only", async (s, messages, { onToken }) => { onToken(css); return css; });
  const res = await runMorse({
    settings: { provider: "visual-only" },
    request: "make the title bigger",
    context: ctx,
    emit: () => {},
    exec: async () => ({ ok: true }),
  });
  assert.equal(res.ok, true);
  assert.match(res.css, /40px/);
  assert.equal(res.js.trim(), "");
});
