// Morse's own interface for keyboard-only and screen-reader users (core/a11y.js
// is the other way round: Morse making other apps easier). Real Chromium, the
// real runtime, demo/catalog.html's scriptable fake host (demo/catalog-host.js).
//   - axe-core (demo/axe.js, vendored for tests only) on a few key states;
//     `npm run ui` runs it on every state of the UI catalog
//   - the core flows with the keyboard alone: open, choose with keys,
//     describe, Save, Mods panel, turn a mod off, install from a link with
//     the review, Show me once
//   - what screen readers hear during a generation: a few messages, no code
//   - forced colors (Windows High Contrast), 320px width and 200% zoom
//   - the extension's own pages (welcome, popup, options, practice), with a display
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { bundleRuntime } from "../runtime/bundle.js";
import { axeCheck, axeLines } from "../demo/axe.js";
import { chromium, launchBrowser, noBrowser, noDisplay } from "./helpers/browser.js";
import { HOTKEYS, pressOpen } from "./helpers/keys.js";
import { waitFor, waitForStatus, settle, TIMEOUT } from "./helpers/wait.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skip = noBrowser;
let browser, runtime;
before(async () => {
  if (skip) return;
  runtime = bundleRuntime();
  browser = await launchBrowser();
});
after(() => browser?.close());

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
// demo/catalog.html with the runtime built from runtime/src, served from memory and disk.
async function open({ mods = 0, width = 1100, height = 720, theme = "dark", forced = false, extra = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, forcedColors: forced ? "active" : "none" });
  await ctx.route("http://morse.test/**", async route => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === "/dist/runtime/runtime.js") return route.fulfill({ body: runtime, contentType: TYPES[".js"] });
    try { await route.fulfill({ body: await readFile(path.join(ROOT, path.normalize(p))), contentType: TYPES[path.extname(p)] || "text/plain" }); }
    catch { await route.fulfill({ status: 404, body: "" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://morse.test/demo/catalog.html?theme=${theme}&mods=${mods}${extra}`);
  await page.waitForFunction(() => globalThis.__cat?.calls.includes("mods.list"));
  await waitForStatus(page, s => s.ready, { what: "the runtime to be ready" });
  return { ctx, page, errors };
}
// A share link the catalog host can read (demo/catalog-host.js decodes #m=).
const LINK = `https://morse.sh/install#m=${Buffer.from(JSON.stringify({ title: "Bigger buttons", prompt: "make every button bigger", css: "button { min-height: 40px }" })).toString("base64")}`;
const status = page => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector(":root > [data-morse-ui]")).dataset.status));
const until = (page, pred, what) => waitForStatus(page, pred, { what });
// What has focus inside the overlay: "tag.class[data-…]", for messages and checks.
const focused = page => page.evaluate(() => {
  const a = document.querySelector(":root > [data-morse-ui]").shadowRoot.activeElement;
  if (!a) return "";
  const data = Object.entries(a.dataset).map(([k, v]) => `[${k}=${v}]`).join("");
  return `${a.localName}${a.className && typeof a.className === "string" ? "." + a.className.trim().split(/\s+/).join(".") : ""}${data}`;
});
const visible = (page, sel) => page.locator(`:root > [data-morse-ui] ${sel}`).first().isVisible();
// Presses key until focus is on what matches re (a describe string from focused()).
async function tabTo(page, re, { key = "Tab", max = 30 } = {}) {
  for (let i = 0; i < max; i++) {
    if (re.test(await focused(page))) return;
    await page.keyboard.press(key);
  }
  assert.fail(`${key} never reached ${re} (last: ${await focused(page)})`);
}
async function axeOk(page, state) {
  const found = await axeCheck(page);
  assert.deepEqual(axeLines(found), [], `axe on ${state}`);
}
// The fake model: a little streaming, a CSS change, then a result.
async function model(page, res = { ok: true, title: "Bigger shuffle button", css: "#small { transform: scale(1.4) }", js: "", attempts: 1 }) {
  await page.waitForFunction(() => globalThis.__cat.gen);
  for (const t of ["TITLE: Bigger", " shuffle", "\n```css\n#small {", " transform:", " scale(1.4) }", "\n```"]) await page.evaluate(t => __cat.token(t), t);
  await page.evaluate(css => __cat.css(css), res.css || "");
  await page.evaluate(r => __cat.done(r), res);
}

test("axe-core finds nothing in the key states: bar, choosing with keys, edit tools, menus, settings, result, modals, panel, review, Show me once", { skip, timeout: TIMEOUT * 6 }, async () => {
  const { ctx, page, errors } = await open({ mods: 12, extra: "&clips=1" });
  try {
    await pressOpen(page);
    await until(page, s => s.open && s.focus === "in", "the bar, focused");
    await axeOk(page, "the bar, pointing");
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("ArrowDown");
    await axeOk(page, "choosing with keys");
    await page.keyboard.press("Enter");
    await until(page, s => !!s.hint && /Edit tools/.test(s.hint), "a chosen part, with the edit tools");
    await page.keyboard.press("Control+KeyE");
    await page.keyboard.press("c");
    await page.locator(".gm-pop").waitFor();
    await axeOk(page, "the edit toolbar with Color open");
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await page.locator(".gm-pop .gm-weights").waitFor();
    await axeOk(page, "Text size");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await until(page, s => !s.open, "the bar to close");

    await pressOpen(page);
    await until(page, s => s.open && s.focus === "in", "the bar again");
    await tabTo(page, /\bmore\b/);
    await page.keyboard.press("Enter");
    await page.locator(".bmenu").waitFor();
    await axeOk(page, "the ⋯ menu");
    await page.keyboard.press("Escape");
    await tabTo(page, /gm-qbtn/, { key: "Shift+Tab" });
    await page.keyboard.press("Enter");
    await page.locator(".gm-menu").waitFor();
    await axeOk(page, "Page tools");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Comma");
    await until(page, s => s.pane === "settings", "Settings");
    await axeOk(page, "Settings");
    await page.keyboard.press("Escape");
    await page.keyboard.type("?");
    await until(page, s => s.pane === "shortcuts", "the shortcuts");
    await axeOk(page, "Keyboard shortcuts");
    await page.keyboard.press("Escape");

    await page.keyboard.type("make it airier");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => globalThis.__cat.gen);
    await axeOk(page, "working");
    await model(page);
    await until(page, s => s.phase === "result", "the result");
    await axeOk(page, "the result");
    // Edit code and Share are in the ⋯ menu.
    await tabTo(page, /button\.more/);
    await page.keyboard.press("Enter");
    await tabTo(page, /\[m=code\]/, { key: "ArrowDown" });
    await page.keyboard.press("Enter");
    await page.locator(".card").waitFor();
    await axeOk(page, "Edit code");
    await page.keyboard.press("Escape");
    await tabTo(page, /button\.more/);
    await page.keyboard.press("Enter");
    await tabTo(page, /\[m=share\]/, { key: "ArrowDown" });
    await page.keyboard.press("Enter");
    await page.locator(".card .exports").waitFor();
    await axeOk(page, "Share");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape"); // closing keeps the change
    await until(page, s => !s.open, "the bar to close");
    await page.locator(".toast").waitFor();
    await axeOk(page, "a toast");

    await page.keyboard.press(HOTKEYS.mods);
    await page.locator(".panel").waitFor();
    await axeOk(page, "the Mods panel with 13 mods");
    await page.keyboard.press("Space"); // turn the first one off
    await page.locator(".panel article.off").first().waitFor();
    await tabTo(page, /\[a=import\]/);
    await page.keyboard.press("Enter");
    await page.locator(".card textarea").waitFor();
    await axeOk(page, "Install a mod");
    await page.keyboard.type(LINK);
    await tabTo(page, /\[a=go\]/);
    await page.keyboard.press("Enter");
    await page.locator(".card [data-a=install]").waitFor();
    await axeOk(page, "the install review");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await pressOpen(page);
    await until(page, s => s.open, "the bar");
    await tabTo(page, /\bmore\b/);
    await page.keyboard.press("Enter");
    await page.keyboard.press("End");
    await page.keyboard.type("sh");
    assert.match(await focused(page), /\[m=showonce\]/, "type-ahead finds Show me once");
    await page.keyboard.press("Enter");
    await page.locator(".so-strip").waitFor();
    await axeOk(page, "Show me once, watching");
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("keyboard only: open, choose with keys, describe, Save, Mods panel, turn a mod off, install from a link with the review, Show me once", { skip, timeout: TIMEOUT * 6 }, async () => {
  const { ctx, page, errors } = await open();
  try {
    // Open, and choose the Shuffle button without a mouse.
    await pressOpen(page);
    await until(page, s => s.open && s.focus === "in", "the bar, focused");
    await page.keyboard.press("Alt+ArrowDown");
    const label = () => page.locator(":root > [data-morse-ui] .hl span").textContent();
    await page.locator(".hl").waitFor();
    for (let i = 0; i < 20 && !/Shuffle/.test(await label()); i++) await page.keyboard.press("ArrowDown");
    assert.match(await label(), /Shuffle/, "the frame and its label are on the Shuffle button");
    // ← picks the bigger part around it (the player toolbar), → comes back.
    await page.keyboard.press("ArrowLeft");
    assert.match(await label(), /toolbar/i);
    await page.keyboard.press("ArrowRight");
    assert.match(await label(), /Shuffle/);
    await page.keyboard.press("Enter");
    const chosen = await until(page, s => s.focus === "in" && /Edit tools/.test(s.hint), "the chosen part, back in the input");
    assert.ok(chosen.open);
    assert.match(await page.locator(".chip.target span").textContent(), /Shuffle/);

    // Describe it; Enter on the result saves it.
    await page.keyboard.type("make it bigger");
    await page.keyboard.press("Enter");
    await model(page);
    await until(page, s => s.phase === "result" && s.focus === "in", "the result, focus in the input");
    await page.keyboard.press("Enter");
    await until(page, s => !s.open, "Save to close the bar");
    assert.equal(await page.evaluate(() => __cat.mods.length), 1);
    assert.match(await page.locator(".toast").textContent(), /Saved/);

    // The Mods panel: focus on the first mod; Space turns it off.
    await page.keyboard.press(HOTKEYS.mods);
    await page.locator(".panel").waitFor();
    assert.match(await focused(page), /^article/);
    await page.keyboard.press("Space");
    await waitFor(() => page.evaluate(() => __cat.mods[0].enabled === false), { what: "the mod to be off" });

    // Install from a link: Tab to "Install a mod…", Esc puts focus back on it, then the review.
    await tabTo(page, /\[a=import\]/);
    await page.keyboard.press("Enter");
    await page.locator(".card textarea").waitFor();
    assert.match(await focused(page), /^textarea/, "focus goes into the modal");
    assert.equal(await page.locator(".modal").getAttribute("aria-modal"), "true");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelector(".card").contains(document.querySelector(":root > [data-morse-ui]").shadowRoot.activeElement)), "Tab stays in the modal");
    await page.keyboard.press("Escape");
    await waitFor(async () => /\[a=import\]/.test(await focused(page)), { what: "focus back on Install a mod" });
    await page.keyboard.press("Enter");
    await page.locator(".card textarea").waitFor();
    await page.keyboard.type(LINK);
    await tabTo(page, /\[a=go\]/);
    await page.keyboard.press("Enter");
    await page.locator(".card [data-a=install]").waitFor();
    assert.match(await focused(page), /\[a=close\]/, "the review starts on Cancel, never Install");
    assert.match(await page.locator(".modal").getAttribute("aria-labelledby"), /./);
    await page.locator(".card [data-a=install]:not([disabled])").waitFor(); // Install waits until the review has been seen (80-modals.js)
    await tabTo(page, /\[a=install\]/);
    await page.keyboard.press("Enter");
    // The host stores it before it answers; the toast comes with the answer.
    await waitFor(async () => /Installed “Bigger buttons”/.test(await page.locator(".toast").textContent()), { what: "the Installed toast" });
    assert.ok(await page.evaluate(() => __cat.mods.some(m => m.title === "Bigger buttons")));
    await waitFor(async () => (await focused(page)) !== "", { what: "focus to stay in Morse" });
    await page.keyboard.press("Escape");
    await waitFor(() => page.locator(".panel").isHidden(), { what: "Esc to close the panel" });
    // The close puts focus at the top of the page on the next frame. Tab before
    // that stays on the body, whose text is the whole page.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    // Show me once, from the ⋯ menu with type-ahead; the task itself by keyboard.
    // Focus starts on the page (its first link), and goes back there when watching starts.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Home");
    await pressOpen(page);
    await until(page, s => s.open && s.focus === "in", "the bar");
    await tabTo(page, /\bmore\b/);
    await page.keyboard.press("Enter");
    assert.match(await focused(page), /\[m=showonce\]/, "the menu opens on its first item");
    await page.keyboard.press("End");
    assert.match(await focused(page), /\[m=help\]/);
    await page.keyboard.press("s"); // type-ahead: the next item starting with S (from the end, it wraps)
    assert.match(await focused(page), /\[m=showonce\]/);
    await page.keyboard.press("Home");
    assert.match(await focused(page), /\[m=showonce\]/);
    await page.keyboard.press("Enter");
    await page.locator(".so-strip").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Home", "focus is back on the page");
    await page.keyboard.press("Tab"); // the next link, Search
    await page.keyboard.press("Enter");
    await page.locator(".so-strip .so-steps").waitFor();
    await pressOpen(page); // the Morse shortcut stops watching
    await until(page, s => s.open && s.focus === "in", "the bar with the steps");
    assert.ok(await visible(page, ".so-card"));
    await page.keyboard.type("add a button that does this");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => globalThis.__cat.gen);
    await model(page, { ok: true, title: "Home button", css: "", js: "morse.el('button')", attempts: 1 });
    await until(page, s => s.phase === "result", "the result");
    await page.keyboard.press("Enter");
    await until(page, s => !s.open, "Save");
    assert.ok(await page.evaluate(() => __cat.mods.some(m => m.title === "Home button")));
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("screen readers: a generation says working, first change, done; never the streaming code; toasts are said", { skip }, async () => {
  const { ctx, page, errors } = await open();
  try {
    // Every message any live region speaks, in order.
    await page.evaluate(() => {
      const root = document.querySelector(":root > [data-morse-ui]").shadowRoot;
      globalThis.__said = [];
      new MutationObserver(() => {
        for (const r of root.querySelectorAll("[aria-live=polite], [role=status]")) {
          const t = r.textContent.trim();
          if (t && t !== r.__last && !r.closest("[hidden]")) globalThis.__said.push(t);
          r.__last = t;
        }
      }).observe(root, { childList: true, subtree: true, characterData: true });
    });
    await pressOpen(page);
    await until(page, s => s.open, "the bar");
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => globalThis.__cat.gen);
    await page.evaluate(() => (__said.length = 0));
    for (let i = 0; i < 40; i++) await page.evaluate(i => __cat.token(` gap: ${i}px;`), i);
    await page.evaluate(() => __cat.css("#toolbar { gap: 20px }"));
    for (let i = 0; i < 20; i++) await page.evaluate(i => __cat.token(` padding: ${i}px;`), i);
    await page.evaluate(() => __cat.done({ ok: true, title: "Airier toolbar", css: "#toolbar { gap: 20px }", js: "", attempts: 1 }));
    await until(page, s => s.phase === "result", "the result");
    await settle(page);
    await page.waitForTimeout(300);
    const said = await page.evaluate(() => __said);
    assert.ok(said.length >= 2 && said.length <= 5, `a few messages, not a stream: ${JSON.stringify(said)}`);
    assert.ok(said.some(s => /first change is showing/.test(s)), JSON.stringify(said));
    assert.ok(said.some(s => /^Done: Airier toolbar/.test(s)), JSON.stringify(said));
    assert.ok(!said.some(s => /gap:|padding:|px;/.test(s)), "no code is read out");
    // Save: the toast is said, though the bar (and its region) is gone.
    await page.keyboard.press("Enter");
    await until(page, s => !s.open, "Save");
    await waitFor(() => page.evaluate(() => __said.some(s => /^Saved “Airier toolbar”/.test(s))), { what: "the toast to be said" });
    // An error is said too.
    await pressOpen(page);
    await until(page, s => s.open, "the bar");
    await page.keyboard.type("break it");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => globalThis.__cat.gen);
    await page.evaluate(() => __cat.done({ ok: false, error: "the model is not connected" }));
    await waitFor(() => page.evaluate(() => __said.some(s => /That didn't work/.test(s))), { what: "the error to be said" });
    // Every icon button has a name; the radar and the effect are hidden from screen readers.
    const unnamed = await page.evaluate(() => [...document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelectorAll("button")]
      .filter(b => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby")).map(b => b.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, []);
    assert.equal(await page.evaluate(() => [...document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelectorAll("svg.radar")].every(s => s.getAttribute("aria-hidden") === "true")), true);
    assert.equal(await page.locator(".fx").getAttribute("aria-hidden"), "true");
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("forced colors, 320px and 200% zoom: the focus ring and borders stay, nothing spills off the screen", { skip }, async () => {
  for (const [what, opts] of [["forced colors", { forced: true }], ["320px wide", { width: 320, height: 640 }], ["200% zoom (640px of 1280)", { width: 640, height: 400 }]]) {
    const { ctx, page, errors } = await open({ mods: 12, ...opts });
    try {
      await pressOpen(page);
      await until(page, s => s.open && s.focus === "in", `the bar (${what})`);
      await page.keyboard.press("Shift+Tab"); // the Send button, from the keyboard
      const look = await page.evaluate(() => {
        const root = document.querySelector(":root > [data-morse-ui]").shadowRoot, a = root.activeElement, bar = root.querySelector(".bar");
        const cs = getComputedStyle(a), bs = getComputedStyle(bar), r = bar.getBoundingClientRect();
        return { ring: a.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2, border: bs.borderTopStyle !== "none" && parseFloat(bs.borderTopWidth) >= 1,
          inside: r.left >= 0 && r.right <= innerWidth + 0.5, scroll: document.documentElement.scrollWidth <= innerWidth };
      });
      assert.deepEqual(look, { ring: true, border: true, inside: true, scroll: true }, what);
      await page.keyboard.press("Escape");
      await page.keyboard.press(HOTKEYS.mods);
      await page.locator(".panel").waitFor();
      const panel = await page.evaluate(() => {
        const root = document.querySelector(":root > [data-morse-ui]").shadowRoot, p = root.querySelector(".panel"), a = root.activeElement;
        const r = p.getBoundingClientRect(), cs = getComputedStyle(a);
        // a row's focus: a 2px ring that survives forced colors (an outline, not only a shadow)
        return { inside: r.left >= 0 && r.right <= innerWidth + 0.5, row: a.localName, ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1.5, border: getComputedStyle(p).borderTopStyle !== "none" };
      });
      assert.deepEqual(panel, { inside: true, row: "article", ring: true, border: true }, `${what}: the panel`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

// ---- the extension's own pages (Chromium loads extensions only with a display)
