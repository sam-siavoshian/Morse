// Keys typed in Morse's bar must not trigger the page's own single-key
// shortcuts, which apps register as capture-phase listeners and skip for
// editable targets.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { serveBar } from "../demo/bar-server.js";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { pressOpen } from "./helpers/keys.js";
import { settle, waitForReady } from "./helpers/wait.js";

const skip = noBrowser;
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar();
  browser = await launchBrowser({ channel: "chromium" });
});
after(async () => { await browser?.close(); await srv?.close(); });

// The usual ways apps decide "the user is typing, not using a shortcut".
const APP_SHORTCUTS = () => {
  window.__shortcuts = [];
  const seen = new WeakSet();
  const typing = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.("input,textarea,select,[contenteditable]"));
  for (const target of [window, document]) {
    target.addEventListener("keydown", e => {
      if (seen.has(e) || typing(e.target) || typing(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
      seen.add(e);
      if (/^[a-z/?]$/i.test(e.key)) window.__shortcuts.push(e.key); // GitHub/Gmail-style: j, k, /, ?, g
    }, true);
  }
};

const WHITE_SPACE = () => [".bar", ".bar .hint", ".panel", ".modal", ".toast"].map(s => getComputedStyle(document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s)).whiteSpace);

test("typing in the bar doesn't fire the page's capture-phase shortcuts", { skip }, async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(APP_SHORTCUTS);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(srv.url);
    await waitForReady(page);
    const host = () => page.evaluate(() => { const h = document.querySelector("[data-morse-ui]"); return { ce: h.getAttribute("contenteditable"), ice: h.isContentEditable, children: h.childNodes.length }; });

    // Closed: the page's shortcuts are the page's.
    await page.keyboard.press("j");
    assert.deepEqual(await page.evaluate(() => __shortcuts), ["j"]);
    assert.equal((await host()).ce, null);
    const closedWhiteSpace = await page.evaluate(WHITE_SPACE);

    await pressOpen(page);
    await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).focus === "in");
    await page.evaluate(() => (__shortcuts.length = 0));
    await page.keyboard.type("jk/gx");
    await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).input === "jk/gx"); // the bar got every key
    assert.deepEqual(await page.evaluate(() => __shortcuts), [], "the page ran none of its shortcuts");
    const h = await host();
    assert.equal(h.ice, true);
    assert.equal(h.children, 0, "nothing was typed into the host itself");
    // An editing host forces white-space: pre-wrap; Morse's own UI must not inherit it
    // (the layout would shift between mousedown and click).
    assert.deepEqual(await page.evaluate(WHITE_SPACE), closedWhiteSpace);

    // Moving focus between Morse's own controls keeps it that way.
    await page.keyboard.press("Tab");
    await settle(page);
    await page.keyboard.press("j");
    assert.deepEqual(await page.evaluate(() => __shortcuts), []);

    // Closed again: the host is a plain element and the page's keys work.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).open);
    await settle(page);
    assert.equal((await host()).ce, null);
    await page.keyboard.press("k");
    assert.deepEqual(await page.evaluate(() => __shortcuts), ["k"]);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
