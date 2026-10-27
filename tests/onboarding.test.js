// First run and help in real Chromium: the three-step coach (shows once,
// completes, never again), the help pane, notices, errors in plain words and
// the empty Mods panel. The real runtime against demo/bar-playground.html's
// fake host with ?onboarding (a fresh install whose progress persists in the
// page's localStorage, like chrome.storage would).
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { serveBar } from "./helpers/demo-server.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, settle, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar(); // port 0
  browser = await launchBrowser({ channel: "chromium" });
});
after(async () => { await browser?.close(); await srv?.close(); });

const ui = (sel, prop = "textContent") => `(() => { const n = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(${JSON.stringify(sel)}); return n ? (${JSON.stringify(prop)} === "visible" ? !n.hidden && !!n.getClientRects().length : n[${JSON.stringify(prop)}]) : null; })()`;
const click = sel => `document.querySelector("[data-morse-ui]").shadowRoot.querySelector(${JSON.stringify(sel)}).click()`;

// One browser context = one "install": reloads keep the fake host's storage.
async function install(query, state) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  if (state) await ctx.addInitScript(s => { if (!localStorage.getItem("fake:onboarding")) localStorage.setItem("fake:onboarding", s); }, JSON.stringify(state));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, ms = TIMEOUT) => waitForStatus(page, pred, { timeout: ms, what: String(pred) });
  const load = async () => {
    await page.goto(srv.url + query);
    await waitForReady(page); // onboarding.get is answered before hello
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("fake:onboarding") || "null"));
  const open = async () => { await pressOpen(page); await waitFor(s => s.open); await settle(page); };
  await load();
  return { page, ctx, status, waitFor, load, stored, open, errors, q: (sel, prop) => page.evaluate(ui(sel, prop)), click: sel => page.evaluate(click(sel)) };
}
async function scenario(query, state, fn) {
  const t = await install(query, state);
  try { await fn(t); assert.deepEqual(t.errors, []); }
  finally { await t.ctx.close(); }
}
async function pointAt(page, sel) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 3 });
  await page.mouse.click(b.x + b.width / 2, b.y + 4);
}

test("no step bar: the bar opens without one, and the first saved change gets a short card", { skip }, async () => {
  await scenario("?onboarding", null, async t => {
    const { page } = t;
    await t.open();
    assert.equal(await t.q(".ob-coach", "visible"), false, "no step bar, even the first time");
    await pointAt(page, "#toolbar");
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "result");
    assert.equal(await t.q(".ob-coach", "visible"), false);
    await page.keyboard.press("Enter"); // Save
    await t.waitFor(s => !s.open);
    // The first saved change: a short card, not the toast.
    await page.waitForFunction(ui(".ob-win", "visible"));
    assert.equal(await t.q(".toast", "visible"), false);
    const card = await t.q(".ob-win");
    assert.match(card, /Your first mod is saved.*“Airier toolbar” comes back every time you open/s);
    assert.doesNotMatch(card, /Now in your bar|A mod is a change you saved|for help/, "one line, nothing to read through");
    assert.equal((await t.stored()).tips?.saved, true, "the card shows once");
    await page.keyboard.press("Escape");
    await page.waitForFunction(ui(".ob-win", "hidden"));
  });
});

test("a host without onboarding storage never shows the coach", { skip }, async () => {
  await scenario("", null, async t => {
    await t.open();
    assert.equal(await t.q(".ob-coach", "visible"), false);
    assert.equal(await t.q(".ob-note", "visible"), false);
  });
});

test("help pane: from the menu and F1, examples fill the input, links to the shortcuts sheet and back", { skip }, async () => {
  await scenario("?onboarding", { coach: "done" }, async t => {
    const { page } = t;
    await t.open();
    await t.click(".more");
    await page.waitForFunction(ui(".bmenu", "visible"));
    assert.match(await t.q(".bmenu"), /Help and examples\s*F1/);
    await t.click("[data-m=help]");
    await t.waitFor(s => s.pane === "help");
    const text = await t.q(".pane");
    for (const cat of ["Looks", "Layout", "New buttons", "Hiding things", "Reading", "Media", "Writing"]) assert.ok(text.includes(cat), cat);
    assert.match(text, /Use the Edit tools.*No model needed/s);
    assert.match(text, /Hold.*Space.*and say it/s, "uses the real talk hotkey");
    assert.equal(await t.status().then(s => s.focus), "ex", "focus moves to the first example");

    await page.evaluate(`[...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".ex")].find(b => b.dataset.ex === "Add a sleep timer").click()`);
    const s = await t.waitFor(s => s.pane === "");
    assert.equal(s.input, "Add a sleep timer");
    assert.equal(s.focus, "in");

    // F1 toggles it; "Keyboard shortcuts" opens the existing ? sheet, whose "Examples" comes back
    await page.keyboard.press("F1");
    await t.waitFor(s => s.pane === "help");
    await t.click("[data-act=keys]");
    await t.waitFor(s => s.pane === "shortcuts");
    assert.match(await t.q(".pane"), /Keyboard shortcuts/);
    await t.click("[data-act=help]");
    await t.waitFor(s => s.pane === "help");
    await page.keyboard.press("F1");
    await t.waitFor(s => s.pane === "");
  });
});

test("notices: no model has a button and can be dismissed for good", { skip }, async () => {
  await scenario("?onboarding&nomodel", { coach: "done" }, async t => {
    await t.open();
    assert.match(await t.q(".ob-note"), /No model connected yet/);
    await t.click(".ob-note [data-ob=model]");
    await t.page.waitForFunction(() => window.__fake.opened === "model");
    await t.click(".ob-note .ob-close");
    await t.page.waitForFunction(ui(".ob-note", "hidden"));
    assert.equal((await t.stored()).dismissed.model, true);
    // The help pane still offers model setup.
    await t.page.keyboard.press("F1");
    await t.waitFor(s => s.pane === "help");
    assert.match(await t.q(".ob-help footer"), /No model connected.*Connect a model/s);
  });
});

test("errors in plain words, with a button that does something", { skip }, async () => {
  await scenario("?onboarding&fail=" + encodeURIComponent("fetch failed: connect ECONNREFUSED 127.0.0.1:11434"), { coach: "done" }, async t => {
    await t.open();
    await t.page.keyboard.type("make it blue");
    await t.page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "error");
    await t.page.waitForFunction(ui(".hint") + "?.includes('reach the model')");
    assert.equal(await t.q(".hint"), "That didn't work: Morse couldn't reach the model. Make sure it's running, or choose another one in model settings.");
    assert.match(await t.q(".hint", "title"), /ECONNREFUSED/, "the raw error stays in the tooltip");
    assert.match(await t.q(".actions"), /Model settings\s*Try again/);
    await t.click(".actions [data-ob=model]");
    await t.page.waitForFunction(() => window.__fake.opened === "model");
  });
});

test("empty Mods panel says what to do and its buttons do it", { skip }, async () => {
  await scenario("?onboarding", { coach: "done" }, async t => {
    await t.page.keyboard.press("Alt+Shift+KeyM");
    await t.page.waitForFunction(ui(".panel .ob-empty", "visible"));
    assert.match(await t.q(".panel .ob-empty"), /No mods on 127\.0\.0\.1:\d+ yet.*Press.*point at something/s);
    await t.click(".panel [data-ob=help]");
    await t.waitFor(s => s.open && s.pane === "help");
    assert.equal(await t.q(".panel", "hidden"), true);
  });
});
