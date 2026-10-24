// Morse in the person's language, in real Chromium on the bar playground
// (demo/bar-playground.html, fake host): the browser's language picks it,
// Settings → Language switches it without a reload (the bar and the Mods
// panel repaint), and Persian lays the bar and panel out right to left
// while key caps stay left to right.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { serveBar } from "./helpers/demo-server.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";
import { CATALOGS } from "../core/i18n.js";

const skip = noBrowser;
let browser, srv;
before(async () => {
  if (skip) return;
  srv = await serveBar();
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await srv?.close(); });

const text = html => html.replace(/<[^>]+>/g, "");
const msg = (lang, id) => CATALOGS[lang][id];

async function open(locale) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(srv.url + "?ms=8&keepmods");
  await waitForReady(page);
  const waitFor = (pred, what) => waitForStatus(page, pred, { timeout: TIMEOUT, what: what || String(pred) });
  // What the bar and panel show, read inside the shadow root.
  const ui = () => page.evaluate(() => {
    const host = document.querySelector("[data-morse-ui]"), root = host.shadowRoot;
    const input = root.querySelector(".in"), panel = root.querySelector(".panel");
    const box = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
    const kbd = root.querySelector(".hint kbd");
    return {
      dir: host.getAttribute("dir"), lang: host.getAttribute("lang"),
      placeholder: input?.placeholder, inputDir: input && getComputedStyle(input).direction,
      hint: root.querySelector(".hint")?.textContent || "",
      kbdDir: kbd && getComputedStyle(kbd).direction,
      panel: box && { left: box.left, right: box.right, text: panel.innerText },
      vw: innerWidth,
    };
  });
  return { page, ctx, ui, waitFor, errors, close: () => ctx.close() };
}

// Settings → Language, the way a person picks it.
async function chooseLanguage(t, code) {
  const { page } = t;
  if (!(await page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).open))) {
    await pressOpen(page);
    await t.waitFor(s => s.open, "bar open");
  }
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  const select = page.locator(".pane select[data-k=language]");
  await select.waitFor();
  await select.selectOption(code);
  await page.waitForFunction(lang => document.querySelector("[data-morse-ui]").getAttribute("lang") === lang, code === "" ? "en" : code);
  await page.keyboard.press("Escape"); // closes Settings, back to the bar
}

async function openPanel(t) {
  const { page } = t;
  if (!(await page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).open))) {
    await pressOpen(page);
    await t.waitFor(s => s.open, "bar open");
  }
  await page.locator(".actions [data-a=mods]").click();
  await page.locator(".panel footer [data-a=import]").waitFor();
}

test("the browser's language picks Morse's: Spanish bar and panel from a Spanish browser", { skip }, async () => {
  const t = await open("es-MX");
  try {
    await pressOpen(t.page);
    await t.waitFor(s => s.open, "bar open");
    const u = await t.ui();
    assert.equal(u.lang, "es");
    assert.equal(u.dir, "ltr");
    assert.equal(u.placeholder, msg("es", "bar.placeholder"));
    assert.ok(u.hint.includes(text(msg("es", "bar.hint.pointing")).split("·")[0].trim()), u.hint);
    await openPanel(t);
    const p = (await t.ui()).panel;
    assert.ok(p.text.includes(msg("es", "panel.install")), p.text);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("Settings → Language switches the bar and the Mods panel; Persian lays them out right to left", { skip }, async () => {
  const t = await open("en-US");
  try {
    await pressOpen(t.page);
    await t.waitFor(s => s.open, "bar open");
    const en = await t.ui();
    assert.equal(en.lang, "en");
    assert.equal(en.placeholder, msg("en", "bar.placeholder"));
    assert.equal(en.inputDir, "ltr");

    // Spanish: the bar repaints without a reload
    await chooseLanguage(t, "es");
    const es = await t.ui();
    assert.equal(es.placeholder, msg("es", "bar.placeholder"));
    assert.ok(!es.hint.includes("Point"), es.hint);

    // the Mods panel, in Spanish too
    await openPanel(t);
    const panelEs = (await t.ui()).panel;
    assert.ok(panelEs.text.includes(msg("es", "panel.install")), panelEs.text);
    assert.ok(panelEs.right > panelEs.left && panelEs.left > en.vw / 2, `panel on the right in Spanish: ${JSON.stringify(panelEs)}`);
    await t.page.keyboard.press("Escape");

    // Persian: right to left
    await chooseLanguage(t, "fa");
    await openPanel(t);
    const fa = await t.ui();
    assert.equal(fa.dir, "rtl");
    assert.equal(fa.placeholder, msg("fa", "bar.placeholder"));
    assert.equal(fa.inputDir, "rtl", "the bar's input runs right to left");
    assert.ok(fa.panel.text.includes(msg("fa", "panel.install")), fa.panel.text);
    assert.ok(fa.panel.left < fa.vw / 2 && fa.panel.right < fa.vw, `panel on the left in Persian: ${JSON.stringify(fa.panel)}`);
    if (fa.kbdDir) assert.equal(fa.kbdDir, "ltr", "key caps stay left to right");
    await t.page.keyboard.press("Escape");

    // and back to the computer's language
    await chooseLanguage(t, "");
    const back = await t.ui();
    assert.equal(back.dir, "ltr");
    assert.equal(back.placeholder, msg("en", "bar.placeholder"));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
