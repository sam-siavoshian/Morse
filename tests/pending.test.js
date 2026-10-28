// An unsaved change stays after a reload until Save or Undo. The host keeps one
// per app (or per site); the page that asks is the one that owns it.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { packPending, readPending, dropPending, pendingScope, sanitizePending } from "../core/pending.js";
import { pendingFor, rememberPending, forgetPending } from "../daemon/pending.js";
import { Connector } from "../daemon/connector.js";
import { bundleRuntime } from "../runtime/bundle.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";

const where = { url: "https://news.test/story", app: null };
const other = { url: "https://other.test/", app: null };
const draft = {
  id: "ab12cd34", title: "Now playing", request: "add a label", prompt: "add a label",
  css: "h1 { color: red }", js: "morse.watch('h1', () => {})", history: [{ prompt: "add a label", css: "h1{}", js: "", at: "2026-01-01T00:00:00.000Z" }],
  target: { selector: "#title", label: "Title", html: "<h1>secret</h1>" },
};

test("pack keeps one change per site and drops anything that isn't code", () => {
  assert.equal(packPending({}, where, { id: "ab12cd34", css: "  ", js: "" }), null);
  assert.equal(packPending({}, where, { id: "nope space", css: "a{}", js: "" }), null);
  assert.equal(packPending({}, where, { id: "ab12cd34", css: "a{}".repeat(200_000), js: "" }), null);
  const map = packPending({}, where, draft);
  const got = readPending(map, where);
  assert.equal(got.id, "ab12cd34");
  assert.equal(got.css, draft.css);
  assert.equal(got.history.length, 1);
  assert.equal(got.target.selector, "#title");
  assert.equal(got.target.html, undefined, "the element's markup is not kept");
  assert.equal(readPending(map, other), null);
  assert.equal(pendingScope({ url: "http://127.0.0.1:9/", app: "obsidian" }), pendingScope({ url: "http://127.0.0.1:4000/", app: "obsidian" }));
  const kept = dropPending(map, where, "other-id");
  assert.equal(readPending(kept, where).id, "ab12cd34", "a clear for an older id leaves the new one");
  assert.equal(readPending(dropPending(map, where, "ab12cd34"), where), null);
  assert.equal(sanitizePending({ id: "ab12cd34", css: "a{}", js: "", style: { parent: "morse-style", title: "Fit", prompt: "fit" } }).style.parent, "morse-style");
});

function fakeSession(href) {
  return {
    async send(method, params) {
      if (method === "Runtime.evaluate" && params.expression === "location.href") return { result: { value: href } };
      return { result: { value: { ok: true } } };
    },
  };
}

test("disk: the caller's page owns the change, and a reload reads it back", async () => {
  assert.equal(await rememberPending(where, { id: "bad", css: "", js: "" }), null);
  const saved = await rememberPending(where, draft);
  assert.equal(saved.title, "Now playing");
  assert.equal(await pendingFor(other), null);
  assert.equal((await pendingFor(where)).js, draft.js, "a later read, as after a restart, still has it");
  await rememberPending(where, { ...draft, id: "next0001", title: "Smaller", css: "h1 { font-size: 11px }", js: draft.js });
  await forgetPending(where, "ab12cd34");
  assert.equal((await pendingFor(where)).id, "next0001", "Undo of the previous change does not drop the one showing");
  await forgetPending(where, "next0001");
  assert.equal(await pendingFor(where), null);
  await rememberPending({ url: "http://127.0.0.1:1111/a", app: "obsidian" }, draft);
  assert.equal((await pendingFor({ url: "http://127.0.0.1:2222/b", app: "obsidian" })).id, draft.id);
  assert.equal(await pendingFor({ url: "http://127.0.0.1:2222/b", app: null }), null);

  process.env.MORSE_PROFILE = "off";
  const caller = { world: 3, main: 2, frameId: "F" };
  const c = new Connector({ port: 0, app: null, settings: { provider: "demo" }, log: () => {} });
  const here = fakeSession("https://news.test/story");
  const put = await c.dispatch(here, caller, { type: "pending.put", draft: { ...draft, url: "https://evil.test/" } });
  assert.equal(put.id, draft.id);
  assert.equal((await c.dispatch(here, caller, { type: "pending.get", url: "https://evil.test/" })).css, draft.css);
  assert.equal(await c.dispatch(fakeSession("https://evil.test/"), caller, { type: "pending.get" }), null, "the url in the message is ignored");
  const app = new Connector({ port: 0, app: { id: "notes", name: "Notes" }, settings: { provider: "demo" }, log: () => {} });
  await app.dispatch(fakeSession("http://127.0.0.1:3333/"), caller, { type: "pending.put", draft: { ...draft, id: "appdraft1" } });
  assert.equal((await app.dispatch(fakeSession("http://127.0.0.1:4444/"), caller, { type: "pending.get" })).id, "appdraft1");
});

const skip = noBrowser;
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
let browser;

before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

test("a reload keeps the unsaved change until Save or Undo", { skip }, async () => {
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
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, what) => waitForStatus(page, pred, { timeout: TIMEOUT, what: what || String(pred) });
  const labels = () => page.locator("#toolbar .morse-now");
  const fontSize = () => labels().evaluate(e => getComputedStyle(e).fontSize);
  const saved = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")));

  await page.goto(`${ORIGIN}/demo/playground.html?light&model=demo`);
  await waitForReady(page);
  await pressOpen(page);
  await waitFor(s => s.open && s.phase === "idle");
  await page.keyboard.type("add a now playing label to the toolbar");
  await page.locator("[data-morse-ui] .go").click();
  let s = await waitFor(s => s.phase === "result");
  assert.match(s.hint, /Now playing/);
  assert.equal(s.mods, 0);
  assert.equal(await labels().count(), 1);
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem("morse:playground:pending") || "{}");
    return Object.values(p).some(d => /Now playing/.test(d.title || ""));
  });

  await page.reload();
  s = await waitFor(s => s.ready && s.open && s.phase === "result", "the change back after a reload");
  assert.match(s.hint, /Now playing/);
  assert.equal(s.mods, 0, "a reload does not save it");
  assert.equal(await labels().count(), 1, "the change is on the page again");
  assert.equal(await fontSize(), "14px");
  assert.match(await page.locator("[data-morse-ui] .actions [data-a=keep]").innerText(), /Save/);
  assert.match(await page.locator("[data-morse-ui] .actions [data-a=undo]").innerText(), /Undo/);
  const placeholder = await page.locator("[data-morse-ui] .in").getAttribute("placeholder");
  assert.match(placeholder, /change/i, "the bar is still on this change, ready for a follow-up");

  await page.keyboard.type("make it smaller");
  await page.locator("[data-morse-ui] .go").click();
  s = await waitFor(s => s.phase === "result" && /version 2/.test(s.hint));
  assert.equal(await labels().count(), 1);
  assert.equal(await fontSize(), "11px");
  assert.equal(s.mods, 0);
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem("morse:playground:pending") || "{}");
    return Object.values(p).some(d => /11px/.test(d.css || ""));
  });

  await page.reload();
  s = await waitFor(s => s.ready && s.open && s.phase === "result" && /version 2/.test(s.hint), "the follow-up survives a reload");
  assert.equal(await fontSize(), "11px");
  assert.equal(await labels().count(), 1);
  assert.equal(s.mods, 0);

  await page.locator("[data-morse-ui] .actions [data-a=undo]").click();
  await waitFor(s => !s.open && s.phase === "idle");
  assert.equal(await labels().count(), 0);
  await page.waitForFunction(() => !Object.keys(JSON.parse(localStorage.getItem("morse:playground:pending") || "{}")).length);
  await page.reload();
  s = await waitFor(s => s.ready && !s.open && s.phase === "idle", "Undo stays undone after a reload");
  assert.equal(await labels().count(), 0);
  assert.equal((await saved()).length, 0);

  await pressOpen(page);
  await waitFor(s => s.open && s.phase === "idle");
  await page.keyboard.type("add a now playing label to the toolbar");
  await page.locator("[data-morse-ui] .go").click();
  await waitFor(s => s.phase === "result");
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("morse:playground:pending") || "{}")).length === 1);
  await page.locator("[data-morse-ui] .actions [data-a=keep]").click();
  await waitFor(s => !s.open);
  assert.equal((await saved()).length, 1);
  await page.reload();
  s = await waitFor(s => s.ready && s.mods === 1 && !s.open, "Save stays saved, and the bar does not ask again");
  assert.equal(s.phase, "idle");
  assert.equal(await labels().count(), 1, "the saved mod is on the page");
  await page.waitForFunction(() => !Object.values(JSON.parse(localStorage.getItem("morse:playground:pending") || "{}")).some(d => d && (d.css || d.js)));
  assert.deepEqual(errors, []);
  await ctx.close();
});
