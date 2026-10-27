// God mode: the pure edit compiler (core/edits.js), the clipboard helper and
// the snapshot prompt. The in-page behavior is covered by godmode.test.js.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileEdits, summarizeEdits, describeEdit, zoomFor, EDIT_TITLE } from "../core/edits.js";
import { clipAdd, clipDrop, CLIPBOARD_MAX } from "../core/clipboard.js";
import { buildMessages } from "../core/prompt.js";
import { createMod } from "../core/mod.js";
import { demoResponse } from "../core/demo.js";
import { parseModResponse } from "../core/parse.js";

const rule = (css, sel) => {
  const i = css.indexOf(`${sel} {`);
  return i < 0 ? null : css.slice(i, css.indexOf("}", i) + 1);
};
const compiles = js => assert.doesNotThrow(() => new Function("morse", js), "generated JS must parse");

test("no edits compile to nothing", () => {
  assert.deepEqual(compileEdits([]), { css: "", js: "" });
  assert.deepEqual(compileEdits(), { css: "", js: "" });
});

test("hide, move, resize and style become !important CSS on the selector", () => {
  const { css, js } = compileEdits([
    { op: "hide", sel: "#ad" },
    { op: "move", sel: ".card", x: 12, y: -4.256 },
    { op: "resize", sel: ".card", w: 320, h: 200.4, flex: true },
    { op: "style", sel: "h1", props: { color: "#ff0000", "font-size": "20px" } },
  ]);
  assert.equal(js, "");
  assert.match(css, new RegExp(EDIT_TITLE));
  assert.match(rule(css, "#ad"), /display: none !important;/);
  const card = rule(css, ".card");
  assert.match(card, /transform: translate\(12px, -4\.26px\) !important;/);
  assert.match(card, /width: 320px !important;/);
  assert.match(card, /height: 200\.4px !important;/);
  assert.match(card, /box-sizing: border-box !important;/);
  assert.match(card, /flex: none !important;/);
  assert.match(rule(css, "h1"), /color: #ff0000 !important;[\s\S]*font-size: 20px !important;/);
});

test("later edits to the same property win and a move keeps the original transform", () => {
  const { css } = compileEdits([
    { op: "move", sel: "#a", x: 5, y: 5, base: "rotate(3deg)" },
    { op: "style", sel: "#a", props: { color: "red" } },
    { op: "move", sel: "#a", x: 40, y: 0, base: "rotate(3deg)" },
    { op: "style", sel: "#a", props: { color: "blue" } },
  ]);
  const a = rule(css, "#a");
  assert.equal(a.match(/transform/g).length, 1);
  assert.match(a, /transform: translate\(40px, 0px\) rotate\(3deg\) !important;/);
  assert.match(a, /color: blue !important;/);
  assert.doesNotMatch(a, /red/);
});

test("inline elements move as inline-block (transforms skip inline boxes)", () => {
  assert.match(compileEdits([{ op: "move", sel: "a.x", x: 3, y: 0, inline: true }]).css, /display: inline-block !important;/);
  assert.equal(compileEdits([{ op: "move", sel: "a.x", x: 3, y: 0, inline: true }, { op: "move", sel: "a.x", x: 0, y: 0, inline: true }]).css, "");
});

test("moving back to the start removes the transform", () => {
  assert.equal(compileEdits([{ op: "move", sel: "#a", x: 10, y: 0 }, { op: "move", sel: "#a", x: 0, y: 0 }]).css, "");
});

test("renames compile to watched JS that restores the original text when turned off", () => {
  const { css, js } = compileEdits([
    { op: "text", sel: "#title", i: 0, text: "Mail", was: "Inbox" },
    { op: "text", sel: "#title", i: 0, text: "Messages", was: "Mail" },
  ]);
  assert.equal(css, "");
  compiles(js);
  assert.equal(js.match(/=> rename\(el,/g).length, 1, "same text run renamed twice -> one statement");
  assert.match(js, /each\("#title", null, el => rename\(el, 0, "Messages", "Inbox"\)\);/);
  assert.match(js, /function rename\(/);
  assert.match(js, /MutationObserver/, "re-applies after re-renders");
  assert.match(js, /return \(\) => undo/, "cleanup restores");
});

test("generated JS actually renames, survives re-renders, and undoes (mini DOM)", () => {
  // A tiny fake DOM, enough for each/rename.
  const text = v => ({ nodeType: 3, nodeValue: v });
  const el = { childNodes: [text("  Inbox "), { nodeType: 1 }, text("3")], matches: () => false };
  const observers = [];
  globalThis.MutationObserver = class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.off = true; } };
  const morse = { watch: (sel, fn) => fn(el) };
  const { js } = compileEdits([{ op: "text", sel: "h1", i: 0, text: "Mail", was: "Inbox" }]);
  const cleanup = new Function("morse", js)(morse);
  assert.equal(el.childNodes[0].nodeValue, "  Mail ", "keeps surrounding whitespace");
  el.childNodes[0].nodeValue = "Inbox"; // the app re-renders
  observers.forEach(o => o.fn());
  assert.equal(el.childNodes[0].nodeValue, "Mail");
  cleanup();
  assert.equal(el.childNodes[0].nodeValue, "Inbox");
  assert.ok(observers.every(o => o.off));
  delete globalThis.MutationObserver;
});

test("duplicates, copies' children and shadow-root edits compile to valid JS", () => {
  const { css, js } = compileEdits([
    { op: "duplicate", sel: "#cta", key: "d1" },
    { op: "move", sel: '[data-morse-dup="d1"]', x: 0, y: 48 },
    { op: "text", sel: '[data-morse-dup="d1"] > span:nth-child(1)', i: 0, text: "Copy", was: "Buy" },
    { op: "style", sel: ".label", shadow: ["x-badge"], props: { color: "red" } },
  ]);
  compiles(js);
  assert.match(css, /\[data-morse-dup="d1"\] \{\n {2}transform: translate\(0px, 48px\) !important;/);
  assert.match(js, /each\("#cta", null, el => cloneAfter\(el, "d1"\)\);/);
  assert.match(js, /function cloneAfter\(/);
  assert.match(js, /each\(":host", \["x-badge"\], root => addStyle\(root, ".label \{\\n {2}color: red !important;\\n\}"\)\);/);
  assert.doesNotMatch(css, /\.label/, "shadow-root CSS is injected into the shadow root, not the page");
});

test("page tools: dark/light check the page first; zoom, ads and focus", () => {
  const dark = compileEdits([{ op: "page", kind: "dark" }]);
  compiles(dark.js);
  assert.match(dark.js, /if \(!pageIsDark\(\)\) \{\n {2}morse\.css\(/);
  assert.match(dark.js, /keepAsIs\(true\);/, "already-dark parts keep their colors");
  assert.match(dark.js, /invert\(0\.93\) hue-rotate\(180deg\)/);
  assert.match(dark.js, /:where\(img, video/, "media are re-inverted");
  assert.match(compileEdits([{ op: "page", kind: "light" }]).js, /if \(pageIsDark\(\)\) \{[\s\S]*keepAsIs\(false\);/);

  assert.match(compileEdits([{ op: "page", kind: "zoom", level: 2 }]).css, /body \{\n {2}zoom: 1\.21 !important;/);
  assert.equal(compileEdits([{ op: "page", kind: "zoom", level: 0 }]).css, "");
  assert.equal(zoomFor(-1), 0.909);

  const ads = compileEdits([{ op: "page", kind: "noads" }]);
  compiles(ads.js);
  assert.match(ads.css, /\[data-ad\]/);
  assert.match(ads.js, /hidePopups\(\);/);

  const focus = compileEdits([{ op: "page", kind: "focus", sel: "article" }]);
  compiles(focus.js);
  assert.match(focus.js, /each\("article", null, focusOn\);/);
  assert.match(focus.css, /\[data-morse-focus-hide\] \{ display: none !important; \}/);
});

test("untrusted edits can't break out of their rule or the JS", () => {
  const { css, js } = compileEdits([
    { op: "hide", sel: "a} body { display:none" },
    { op: "hide", sel: "/* x */ a" },
    { op: "style", sel: "#ok", props: { color: "red; } body { display: none", "bad prop": "1", "x\n": "2" } },
    { op: "text", sel: "h1", i: 0, text: '"); alert(1); ("', was: "x" },
    { op: "duplicate", sel: "#a", key: "x\"); alert(1); (\"" },
    { op: "nope", sel: "#a" },
    null,
  ]);
  assert.doesNotMatch(css, /body \{/);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  assert.match(rule(css, "#ok"), /color: red  body  display: none !important;/);
  compiles(js);
  assert.doesNotMatch(js, /cloneAfter\(el/, "bad duplicate key dropped");
  assert.match(js, /rename\(el, 0, "\\"\); alert\(1\); \(\\"", "x"\)/, "text is a JSON string literal");
});

test("summaries read like a changelog", () => {
  assert.equal(summarizeEdits([]), "No edits");
  assert.equal(summarizeEdits([{ op: "hide" }, { op: "hide" }, { op: "move" }]), "Hid 2 · moved 1");
  assert.equal(summarizeEdits([{ op: "text", text: "Mail", was: "Inbox" }]), "Renamed “Inbox” → “Mail”");
  assert.equal(summarizeEdits([{ op: "style", props: { color: "red" } }, { op: "style", props: { "font-size": "2px" } }]), "Recolored 1 · restyled 1");
  assert.equal(describeEdit({ op: "style", props: { "background-color": "red" } }), "background color");
  assert.equal(describeEdit({ op: "page", kind: "dark" }), "dark mode");
});

test("manual mods keep their edit list; snapshot mods record where they came from", () => {
  const manual = createMod({ title: "Direct edits", prompt: "Hid 1", css: "a{}", js: "", url: "https://x.com/", kind: "manual", edits: [{ op: "hide", sel: "a" }], model: "Claude Code · haiku" });
  assert.equal(manual.kind, "manual");
  assert.equal(manual.edits.length, 1);
  assert.equal(manual.model, null, "no model wrote it");
  const plain = createMod({ prompt: "p", url: "https://x.com/" });
  assert.equal("kind" in plain || "edits" in plain || "from" in plain, false);
  const reused = createMod({ prompt: "p", url: "https://x.com/", from: { app: "Tunes", url: "http://t/", title: "Tunes", junk: 1 } });
  assert.deepEqual(reused.from, { app: "Tunes", url: "http://t/", title: "Tunes" });
});

test("the clipboard keeps the newest 20 and rejects junk", () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = clipAdd(list, { id: "c" + i, label: "x" });
  assert.equal(list.length, CLIPBOARD_MAX);
  assert.equal(list[0].id, "c24");
  assert.ok(list[0].created);
  list = clipAdd(list, { id: "c10", label: "again" });
  assert.equal(list[0].label, "again");
  assert.equal(list.filter(i => i.id === "c10").length, 1);
  assert.throws(() => clipAdd(list, { label: "no id" }), /Not a clipboard item/);
  assert.throws(() => clipAdd(list, { id: "big", html: "x".repeat(500_000) }), /too large/);
  list = clipDrop(list, "c24");
  assert.equal(list.some(i => i.id === "c24"), false);
  assert.equal(clipDrop(list, "missing").length, list.length);
  assert.throws(() => clipDrop(list, ""), /Not a clipboard item/);
});

test("a picked snapshot goes into the prompt, and the demo model rebuilds it", () => {
  const snapshot = {
    label: "div · “The Daily Byte”", note: "the red masthead", html: '<div class="tb">The Daily Byte</div>',
    styles: { root: { "background-color": "rgb(200, 16, 46)", color: "rgb(255, 255, 255)", "font-weight": "700", padding: "10px 20px" }, parts: [] },
    hover: ["a.tb:hover { opacity: 0.8; }"],
    from: { app: "The Daily Byte", url: "http://byte.test/", title: "The Daily Byte" },
  };
  const context = { url: "http://chat.test/", title: "Parley", target: { selector: 'header[role="banner"]', html: "<header></header>" } };
  for (const msgs of [buildMessages({ request: "use this", context, snapshot }), buildMessages({ request: "use this", context: { ...context, snapshot } })]) {
    const user = msgs[1].content;
    assert.match(user, /captured in another app \(The Daily Byte, http:\/\/byte\.test\/\)/);
    assert.match(user, /Their note about it: the red masthead/);
    assert.match(user, /Captured styles \(computed, JSON\):\n\{"root"/);
    assert.match(user, /Captured hover rules:\na\.tb:hover/);
    assert.ok(user.indexOf("Captured") < user.indexOf("Request: use this"));
  }
  assert.doesNotMatch(buildMessages({ request: "x", context }).at(1).content, /Captured/);
  const r = parseModResponse(demoResponse(buildMessages({ request: "use this", context, snapshot })));
  assert.equal(r.title, "Rebuilt from The Daily Byte");
  assert.match(r.css, /header\[role="banner"\] \{[\s\S]*background-color: rgb\(200, 16, 46\);[\s\S]*font-weight: 700;/);
});
