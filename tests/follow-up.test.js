// A follow-up edits the change that is still on the bar. Send while Save and
// Undo are showing revises that result (same id, the model sees the original
// ask and the code). Send with nothing pending starts a new one. A follow-up
// that comes back empty does not throw the first change away.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
let browser;

before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

async function playground() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const runtime = bundleRuntime();
  await ctx.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/dist/runtime/runtime.js") return route.fulfill({ body: runtime, contentType: "text/javascript" });
    try {
      const body = await readFile(new URL("." + path, ROOT));
      route.fulfill({ body, contentType: path.endsWith(".html") ? "text/html" : "text/javascript" });
    } catch { route.fulfill({ status: 404, body: "" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${ORIGIN}/demo/playground.html?light&model=demo`);
  await waitForReady(page);
  await page.evaluate(() => {
    window.__gens = [];
    const host = globalThis.__morseHost, send = host.send.bind(host);
    host.send = m => {
      if (m.type !== "generate") return send(m);
      window.__gens.push({
        id: m.genId, request: m.request,
        base: m.base ? { prompt: m.base.prompt, title: m.base.title || "", refined: m.base.refined || "", css: m.base.css || "", js: m.base.js || "" } : null,
      });
      // A follow-up the model answers with nothing: the bar must keep the change.
      if (m.request === "wipe the code") {
        setTimeout(() => globalThis.__fakeEmit({ reply: m.id, result: { ok: true, title: "Gone", css: "", js: "" } }), 20);
        return;
      }
      // A follow-up that renames the change (a real title, not a one-word tweak).
      if (m.request === "call it compact") {
        setTimeout(() => globalThis.__fakeEmit({ reply: m.id, result: {
          ok: true, title: "Compact now playing", css: "#toolbar .morse-now { font-size: 11px; }", js: m.base?.js || "", attempts: 1,
        } }), 20);
        return;
      }
      return send(m);
    };
  });
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, ms = TIMEOUT) => waitForStatus(page, pred, { timeout: ms, what: String(pred) });
  const gens = () => page.evaluate(() => window.__gens);
  const saved = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")));
  const sendBtn = () => page.locator("[data-morse-ui] .go");
  return { ctx, page, errors, status, waitFor, gens, saved, sendBtn };
}

const labels = page => page.locator("#toolbar .morse-now");
const fontSize = page => labels(page).evaluate(e => getComputedStyle(e).fontSize);

test("a pending result: Send revises it; with nothing pending, Send starts a new one", { skip }, async () => {
  const { ctx, page, errors, waitFor, gens, saved, sendBtn } = await playground();
  await pressOpen(page);
  await waitFor(s => s.open && s.phase === "idle");
  await page.keyboard.type("add a now playing label to the toolbar");
  await sendBtn().click();
  let s = await waitFor(s => s.phase === "result");
  assert.match(s.hint, /Now playing label/);
  assert.equal(s.mods, 0, "a result is not saved until Save");
  assert.equal(await labels(page).count(), 1);
  assert.equal(await fontSize(page), "14px");
  let g = await gens();
  assert.equal(g.length, 1);
  assert.equal(g[0].base, null, "the first Send is a new request");
  const id = g[0].id;

  await page.keyboard.type("make it smaller");
  await sendBtn().click();
  s = await waitFor(s => s.phase === "result" && /version 2/.test(s.hint));
  assert.match(s.hint, /make it smaller/, "the same row shows the follow-up");
  assert.match(s.hint, /Now playing label/, "a one-word tweak keeps the name");
  assert.equal(s.input, "", "the follow-up is taken");
  assert.equal(s.mods, 0, "a follow-up does not save");
  assert.equal(await labels(page).count(), 1, "still the one change, not a second mod");
  assert.equal(await fontSize(page), "11px", "the follow-up was applied to it");
  g = await gens();
  assert.equal(g.length, 2);
  assert.equal(g[1].id, id, "same id");
  assert.equal(g[1].request, "make it smaller");
  assert.equal(g[1].base.prompt, "add a now playing label to the toolbar");
  assert.match(g[1].base.css, /font-size: 14px/);
  assert.match(g[1].base.js, /morse-now/);
  assert.deepEqual(await saved(), [], "nothing was written");

  await page.keyboard.type("It does not work");
  await sendBtn().click();
  s = await waitFor(s => s.phase === "result" && /version 3/.test(s.hint));
  assert.match(s.hint, /It does not work/);
  assert.equal(await labels(page).count(), 1);
  g = await gens();
  assert.equal(g.length, 3);
  assert.equal(g[2].id, id);
  assert.equal(g[2].base.prompt, "add a now playing label to the toolbar");
  assert.equal(g[2].base.refined, "make it smaller", "the model sees the follow-up already applied");
  assert.match(g[2].base.js, /morse-now/);
  assert.equal(s.mods, 0);

  // Save keeps this result. Undo, on a fresh one, takes it back.
  await page.locator("[data-morse-ui] .actions [data-a=keep]").click();
  await waitFor(s => !s.open);
  const mods = await saved();
  assert.equal(mods.length, 1);
  assert.equal(mods[0].id, id);
  assert.equal(mods[0].prompt, "add a now playing label to the toolbar");
  assert.equal(mods[0].refined, "It does not work");
  assert.equal(await labels(page).count(), 1);

  await pressOpen(page);
  await waitFor(s => s.open && s.phase === "idle");
  await page.keyboard.type("hide the sidebar");
  await sendBtn().click();
  s = await waitFor(s => s.phase === "result");
  g = await gens();
  assert.equal(g.length, 4);
  assert.notEqual(g[3].id, id, "nothing pending: a new request");
  assert.equal(g[3].base, null);
  assert.equal(g[3].request, "hide the sidebar");
  await page.locator("[data-morse-ui] .actions [data-a=undo]").click();
  await waitFor(s => !s.open);
  assert.equal((await saved()).length, 1, "Undo drops the new one and leaves the saved change");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a follow-up with no code keeps the change; a new name updates the same row", { skip }, async () => {
  const { ctx, page, errors, waitFor, gens, saved, sendBtn } = await playground();
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.keyboard.type("add a now playing label to the toolbar");
  await sendBtn().click();
  await waitFor(s => s.phase === "result");
  const id = (await gens())[0].id;
  assert.equal(await fontSize(page), "14px");

  await page.keyboard.type("wipe the code");
  await sendBtn().click();
  let s = await waitFor(s => s.phase === "result" && /didn't work|Something went wrong/.test(s.hint));
  assert.equal(s.input, "wipe the code", "the follow-up stays so it can be tried again");
  assert.equal(await labels(page).count(), 1, "the change is still on the page");
  assert.equal(await fontSize(page), "14px", "its code was not cleared");
  assert.equal((await gens()).at(-1).id, id);
  assert.equal(s.mods, 0);
  assert.deepEqual(await saved(), []);

  await page.keyboard.press("Control+A");
  await page.keyboard.type("call it compact");
  await sendBtn().click();
  s = await waitFor(s => s.phase === "result" && /Compact now playing/.test(s.hint));
  assert.match(s.hint, /version 2/);
  assert.match(s.hint, /call it compact/);
  assert.equal((await gens()).at(-1).id, id, "the rename is the same mod");
  assert.equal(await labels(page).count(), 1);
  assert.equal(await fontSize(page), "11px");
  assert.equal(s.mods, 0, "renaming does not save");
  assert.deepEqual(errors, []);
  await ctx.close();
});
