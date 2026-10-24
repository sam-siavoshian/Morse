// Show me once, the parts that don't need the bar: steps in plain words,
// how steps fold together, what goes to the model, the demo model's reply,
// and (in a real Chromium page) selector choice, list items, hidden fields
// and the kit helpers that replay steps. The bar end to end is in
// tests/show-once-ui.test.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { addStep, stepWords, stepsForModel, recordingPrompt, SO_MAX_STEPS } from "../core/showonce.js";
import { showOnceDemo, readShortcut } from "../core/showonce-demo.js";
import { buildMessages } from "../core/prompt.js";
import { demoResponse } from "../core/demo.js";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";

// ---- plain words

test("each kind of step reads as plain words; hidden values never show", () => {
  assert.equal(stepWords({ do: "click", label: "Archive", role: "button" }), "Click “Archive”");
  assert.equal(stepWords({ do: "click", role: "button" }), "Click the button");
  assert.equal(stepWords({ do: "type", label: "Search mail", value: "invoice" }), "Type “invoice” in “Search mail”");
  assert.equal(stepWords({ do: "type", label: "Search mail", value: "" }), "Clear “Search mail”");
  assert.equal(stepWords({ do: "type", label: "Password", hidden: true, value: "hunter2" }), "Type (hidden) in “Password”");
  assert.equal(stepWords({ do: "choose", label: "Shipping", role: "menu", value: "Express" }), "Choose “Express” in “Shipping”");
  assert.equal(stepWords({ do: "choose", label: "Express", role: "option", value: "Express" }), "Choose “Express”");
  assert.equal(stepWords({ do: "check", label: "Gift wrap" }), "Turn on “Gift wrap”");
  assert.equal(stepWords({ do: "uncheck", label: "Gift wrap" }), "Turn off “Gift wrap”");
  assert.equal(stepWords({ do: "key", key: "Enter", selector: "input", label: "Search mail", role: "search field" }), "Press Enter in “Search mail”");
  assert.equal(stepWords({ do: "key", key: "Ctrl+Shift+A", selector: "body" }), "Press Ctrl+Shift+A");
  // A long typed value is shortened on screen, not in the step.
  assert.match(stepWords({ do: "type", label: "Note", value: "x".repeat(80) }), /^Type “x{27}…” in “Note”$/);
});

// ---- folding steps together

test("typing in one field is one step; a double click is one click; on then off cancels out", () => {
  const steps = [], els = [];
  const field = {}, box = {}, btn = {};
  addStep(steps, { do: "type", selector: "#q", value: "i" }, els, field, 1000);
  addStep(steps, { do: "type", selector: "#q", value: "in" }, els, field, 1050);
  addStep(steps, { do: "type", selector: "#q", value: "invoice" }, els, field, 1100);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].value, "invoice");
  addStep(steps, { do: "key", selector: "#q", key: "Enter" }, els, field, 1200);
  addStep(steps, { do: "click", selector: "button", text: "Archive" }, els, btn, 2000);
  addStep(steps, { do: "click", selector: "button", text: "Archive" }, els, btn, 2200); // double click
  assert.deepEqual(steps.map(s => s.do), ["type", "key", "click"]);
  addStep(steps, { do: "click", selector: "button", text: "Archive" }, els, btn, 3000); // later: a second, real click
  assert.equal(steps.length, 4);
  addStep(steps, { do: "check", selector: "#gift" }, els, box, 4000);
  addStep(steps, { do: "uncheck", selector: "#gift" }, els, box, 4100);
  assert.equal(steps.length, 4, "turning a box on and off again leaves no step");
  assert.equal(els.length, steps.length);
  // Typing again in the same field after something else is a new step.
  addStep(steps, { do: "type", selector: "#q", value: "x" }, els, field, 5000);
  assert.equal(steps.length, 5);
});

test("a recording stops growing at the step limit", () => {
  const steps = [];
  for (let i = 0; i < SO_MAX_STEPS + 10; i++) addStep(steps, { do: "click", selector: `#b${i}` }, null, null, i * 1000);
  assert.equal(steps.length, SO_MAX_STEPS);
});

// ---- what goes to the model

const STEPS = [
  { do: "click", selector: '[role="listbox"] div.r9', text: "Leo Martins", label: "Leo Martins", role: "option", at: 1,
    item: { selector: "div.lst > div.r9", count: 10, index: 3, label: "Leo Martins", attrs: { "data-i": "3", "data-unread": "true" } } },
  { do: "click", selector: 'section[aria-label="Reading pane"] button', text: "Archive", label: "Archive", role: "button", at: 2 },
  { do: "type", selector: 'input[name="pw"]', label: "Password", role: "field", hidden: true, value: "hunter2", at: 3 },
];

test("the model gets the steps in order, with selectors, labels and list items, and never a hidden value", () => {
  const out = stepsForModel(STEPS);
  assert.deepEqual(out.map(s => s.n), [1, 2, 3]);
  assert.equal(out[0].item.selector, "div.lst > div.r9");
  assert.equal(out[1].text, "Archive");
  assert.equal(out[2].hidden, true);
  assert.equal("value" in out[2], false);
  assert.equal(out.some(s => "at" in s), false, "no bookkeeping");
  const p = recordingPrompt({ steps: STEPS });
  assert.match(p, /^1\. Click “Leo Martins” \(item 4 of 10 matching `div\.lst > div\.r9`; it had data-i="3" data-unread="true"\)$/m);
  assert.match(p, /^2\. Click “Archive”$/m);
  assert.match(p, /^3\. Type \(hidden\) in “Password”$/m);
  assert.doesNotMatch(p, /hunter2/);
  assert.match(p, /morse\.waitFor/);
  assert.equal(recordingPrompt({ steps: [] }), "");
  // It goes in the user turn, before the request.
  const msgs = buildMessages({ request: "do this to every unread email", context: { url: "http://x/", title: "Inbox", recording: { steps: stepsForModel(STEPS) } } });
  const user = msgs.at(-1).content;
  assert.ok(user.indexOf("The user just showed you a task") < user.indexOf("Request: do this to every unread email"));
  assert.doesNotMatch(user, /hunter2/);
  // Without a recording, nothing about steps.
  assert.doesNotMatch(buildMessages({ request: "x", context: { url: "u", title: "t" } }).at(-1).content, /showed you a task/);
});

// ---- the demo model

const promptFor = request => buildMessages({ request, context: { url: "http://x/", title: "Inbox - Postbox", recording: { steps: stepsForModel(STEPS.slice(0, 2)) } } });

test("demo model: a recorded flow becomes a button, a shortcut, or the steps for every matching item", () => {
  // "do this to every…" reads like a question to the Ask rules; the steps win.
  const every = demoResponse(promptFor("do this to every unread email"));
  assert.match(every, /^TITLE: Archive every unread email$/m);
  assert.match(every, /document\.querySelectorAll\("div\.lst > div\.r9\[data-unread=\\"true\\"\]"\)/);
  assert.doesNotMatch(every, /data-i=/, "only the attributes the words name narrow the list");
  assert.match(every, /morse\.waitFor\("section\[aria-label=\\"Reading pane\\"\] button", \{ text: "Archive" \}\)/);
  const key = demoResponse(promptFor("do this when I press Ctrl+Shift+A"));
  assert.match(key, /^TITLE: Archive with Ctrl\+Shift\+A$/m);
  assert.match(key, /e\.ctrlKey !== true .* e\.shiftKey !== true/);
  const button = demoResponse(promptFor("add a button that does this"));
  assert.match(button, /Repeat my steps/);
  // Every reply parses as code.
  for (const r of [every, key, button]) new Function("morse", `return (async () => {${r.split("```js\n")[1].split("```")[0]}})`);
  assert.deepEqual(readShortcut("when I press ctrl + shift + a"), { ctrl: true, meta: false, alt: false, shift: true, key: "a", label: "ctrl+shift+a" });
  assert.equal(readShortcut("add a button"), null);
  assert.match(showOnceDemo("Request: x"), /No steps came/);
});

// ---- in a real page: selectors, items, hidden fields, the kit

let browser, page;
const FIXTURE = `
<header><button id="save">Save</button><button id="css-1x2y3a">Hashed id</button><button data-testid="send">Send</button></header>
<nav aria-label="Folders"><a href="#in">Inbox</a><a href="#sent">Sent</a></nav>
<section aria-label="Reading pane"><div class="acts"><button>Reply</button><button>Archive</button><button>Delete</button></div></section>
<div class="sc-9f8e7d"><button class="xk29dk1">Icon</button></div>
<form aria-label="Checkout">
  <label>Email <input name="email" type="email"></label>
  <label>Password <input type="password" name="pw"></label>
  <input autocomplete="cc-number" placeholder="Card number">
  <input name="cvv" placeholder="123">
  <label>Shipping <select name="ship"><option>Standard</option><option>Express</option></select></label>
  <label><input type="checkbox" name="gift"> Gift wrap</label>
  <textarea aria-label="Note"></textarea>
</form>
<ul id="inbox" role="listbox">
  <li class="row" role="option" data-unread="true"><span class="from">Maya Chen</span><span class="subj">Q3 review</span><button>Star</button></li>
  <li class="row" role="option" data-unread="false"><span class="from">GitHub</span><span class="subj">CI failed</span><button>Star</button></li>
  <li class="row" role="option" data-unread="true"><span class="from">Leo Martins</span><span class="subj">Climbing</span><button>Star</button></li>
</ul>
<div class="grid"><div><b>A</b></div><div><b>A</b></div></div>
<div class="tools"><button><svg></svg><span>Bold</span></button><button><svg></svg><span>Italic</span></button><button><svg></svg><span>Code</span></button></div>`;

before(async () => {
  if (skip) return;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(FIXTURE);
  // core/showonce.js as a plain script: its exports become window.SO.
  const src = readFileSync(new URL("../core/showonce.js", import.meta.url), "utf8");
  const names = [...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map(m => m[1]);
  await page.addScriptTag({ content: `(() => {${src.replace(/^export\s+/gm, "")}\nwindow.SO = { ${names.join(", ")} };})();` });
  await page.evaluate(KIT_SOURCE);
});
after(() => browser?.close());

// Finds what a { selector, text } names, the way morse.waitFor does.
const RESOLVE = `(scope, { selector, text }) => [...scope.querySelectorAll(selector)].find(e => text == null || e.textContent.toLowerCase().replace(/\\s+/g, " ").includes(text.toLowerCase()))`;
const pick = sel => page.evaluate(s => SO.pickSelector(document.querySelector(s)), sel);

test("selectors: ids, test ids, names and labels first; never hashed names", { skip }, async () => {
  assert.deepEqual(await pick("#save"), { selector: "#save", text: null });
  assert.deepEqual(await pick('[data-testid="send"]'), { selector: 'button[data-testid="send"]', text: null });
  assert.deepEqual(await pick('[name="email"]'), { selector: 'input[name="email"]', text: null });
  assert.deepEqual(await pick("textarea"), { selector: 'textarea[aria-label="Note"]', text: null });
  // A hashed id is skipped for its text.
  assert.deepEqual(await pick('[id="css-1x2y3a"]'), { selector: "header button", text: "Hashed id" });
  // A hashed class never shows up.
  const icon = await pick(".xk29dk1");
  assert.doesNotMatch(icon.selector, /xk29dk1|sc-9f8e7d/);
});

test("selectors: a button with no attributes is found by its words, inside a named part of the page", { skip }, async () => {
  const archive = await page.evaluate(() => SO.pickSelector([...document.querySelectorAll(".acts button")][1]));
  assert.deepEqual(archive, { selector: 'section[aria-label="Reading pane"] button', text: "Archive" });
  // Two things with the same words: their position decides.
  const second = await page.evaluate(() => SO.pickSelector(document.querySelectorAll(".grid > div")[1]));
  assert.equal(second.text, null);
  assert.match(second.selector, /nth-of-type\(2\)/);
});

test("selectors: every element in the page is found again by the selector chosen for it", { skip }, async () => {
  const misses = await page.evaluate(new Function(`return (() => {
    const resolve = ${RESOLVE};
    const out = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest("svg") && el.localName !== "svg") continue;
      const p = SO.pickSelector(el);
      if (resolve(document, p) !== el) out.push(el.outerHTML.slice(0, 60) + " -> " + JSON.stringify(p));
    }
    return out;
  })()`));
  assert.deepEqual(misses, []);
});

test("list items: a click in an inbox row names the row, its kind, its place and its state", { skip }, async () => {
  const step = await page.evaluate(() => SO.stepFrom(SO.actionTarget(document.querySelector("#inbox li:nth-child(3) .subj")), "click"));
  assert.equal(step.do, "click");
  assert.equal(step.role, "option");
  assert.equal(step.label, "Leo Martins");
  assert.deepEqual(step.item, { selector: "#inbox > li.row", count: 3, index: 2, label: "Leo Martins", attrs: { "data-unread": "true" } });
  // A button inside a row: the row is the item, and the button is found inside it.
  const star = await page.evaluate(() => SO.stepFrom(document.querySelector("#inbox li:nth-child(2) button"), "click"));
  assert.equal(star.item.index, 1);
  assert.equal(star.item.inside, "button");
  // A row of buttons is a toolbar, not a list.
  const bold = await page.evaluate(() => SO.stepFrom(SO.actionTarget(document.querySelector(".tools span")), "click"));
  assert.equal(bold.item, undefined);
  assert.equal(bold.label, "Bold");
  assert.equal(await page.evaluate(() => SO.actionTarget(document.querySelector(".tools span")).localName), "button");
});

test("hidden fields: passwords, card numbers and security codes", { skip }, async () => {
  const secret = await page.evaluate(() => [...document.querySelectorAll("form input, form select, form textarea")].map(e => [e.name || e.placeholder || e.localName, SO.isSecretField(e)]));
  assert.deepEqual(Object.fromEntries(secret), { email: false, pw: true, "Card number": true, cvv: true, ship: false, gift: false, textarea: false });
  // What a click on each is: fields are recorded by what is typed or chosen, not the click.
  const controls = await page.evaluate(() => [...document.querySelectorAll("form label, form input, form select, form textarea")].every(e => SO.isFormControl(e)));
  assert.equal(controls, true);
  assert.equal(await page.evaluate(() => SO.isFormControl(document.querySelector("#save"))), false);
  const labels = await page.evaluate(() => ["[name=email]", "[name=pw]", "[name=ship]", "[name=gift]", "[autocomplete=cc-number]"].map(s => SO.soLabelOf(document.querySelector(s))));
  assert.deepEqual(labels, ["Email", "Password", "Shipping", "Gift wrap", "Card number"]);
});

test("kit: waitFor waits for an element to appear, by words; type, choose and key act like a person", { skip }, async () => {
  const r = await page.evaluate(wrapModCode("so1", `
    window.__so = {};
    morse.after(150, () => document.body.insertAdjacentHTML("beforeend", '<div id="late"><button>Later</button><button>Done later</button></div>'));
    (async () => {
      const t0 = Date.now();
      const b = await morse.waitFor("#late button", { text: "done later" });
      __so.found = b.textContent; __so.waited = Date.now() - t0 >= 100;
      try { await morse.waitFor("#nothing", { timeout: 200 }); } catch (e) { __so.missing = e.message; }
      const email = document.querySelector("[name=email]");
      email.addEventListener("input", () => (__so.input = email.value));
      morse.type(email, "sam@example.com");
      morse.choose(document.querySelector("[name=ship]"), "express");
      morse.choose(document.querySelector("[name=gift]"), true);
      document.addEventListener("keydown", e => (__so.key = (e.ctrlKey ? "Ctrl+" : "") + e.key), { once: true });
      morse.key(document.body, "k", { ctrl: true });
    })();`));
  assert.deepEqual(r, { ok: true });
  await page.waitForFunction(() => window.__so.key, null, { timeout: 3000 });
  const got = await page.evaluate(() => ({ ...window.__so, ship: document.querySelector("[name=ship]").value, gift: document.querySelector("[name=gift]").checked }));
  assert.deepEqual(got, { found: "Done later", waited: true, missing: "Couldn't find #nothing on the page", input: "sam@example.com", key: "Ctrl+k", ship: "Express", gift: true });
});

test("kit: an async handler's error is collected, and a mod turned off stops waiting", { skip }, async () => {
  await page.evaluate(wrapModCode("so2", `morse.on(document, "so-test", async () => { await morse.sleep(10); throw new Error("boom"); });`));
  await page.evaluate(() => document.dispatchEvent(new Event("so-test")));
  await page.waitForFunction(() => morse.__errors("so2").length === 1, null, { timeout: 2000 });
  assert.match((await page.evaluate(() => morse.__errors("so2")))[0], /boom/);
  await page.evaluate(wrapModCode("so3", `morse.waitFor("#never").then(() => (window.__late = 1), () => (window.__late = 2));`));
  await page.evaluate(() => morse.__off("so3"));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__late), undefined);
});
