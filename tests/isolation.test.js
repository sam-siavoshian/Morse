// Desktop: the runtime and its host binding live in an isolated world, so the
// app's own scripts can't use Morse's host API; mods still run in the page's
// main world. Host reads and writes are scoped to the page that asked.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { TIMEOUT, settle, waitForReady } from "./helpers/wait.js";
import { freePort } from "./helpers/net.js";

const skip = noBrowser;

let home, browser, page, site, origin, store, Connector, connector;
const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
const probe = () => page.evaluate(() => JSON.parse(document.documentElement.dataset.probe || "null"));
async function until(get, ms = TIMEOUT) {
  const end = Date.now() + ms;
  for (;;) { const v = await get(); if (v || Date.now() > end) return v; await new Promise(r => setTimeout(r, 40)); }
}

// A mod the page would like installed on every site.
const WIDE = { morse: 1, id: "everywhere", title: "Everywhere", prompt: "p", css: "", js: "document.title = 'owned'", enabled: true,
  match: { hosts: ["*"], app: null }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" };

// The app's own script: looks for Morse's host API from the page's main world,
// early and late, and uses it if it finds it.
const APP = `<!doctype html><title>App</title><body><main id="main">Main</main><script>
window.appSecret = "s3cret";
const seen = {};
const WIDE = ${JSON.stringify(WIDE)};
const look = () => {
  for (const k of ["__morseHostSend", "__morseHost", "__morseHostReceive", "__morseRuntime"]) if (globalThis[k] !== undefined) seen[k] = typeof globalThis[k];
  try { if (typeof __morseHostSend === "function") { __morseHostSend(JSON.stringify({ id: 1, type: "history.add", text: "from the page" })); seen.called = true; } } catch (e) { seen.error = String(e); }
  try { if (typeof __morseHostSend === "function") { __morseHostSend(JSON.stringify({ id: 3, type: "mods.save", mod: WIDE })); seen.called = true; } } catch (e) { seen.error = String(e); }
  try { if (globalThis.__morseHost) { __morseHost.send({ id: 2, type: "mods.delete", modId: "keepme" }); seen.called = true; } } catch (e) { seen.error = String(e); }
  document.documentElement.dataset.probe = JSON.stringify({ seen, n: (window.__n = (window.__n || 0) + 1) });
};
look(); setInterval(look, 50);
</script>`;

before(async () => {
  if (skip) return;
  home = tempDir("morse-iso-");
  process.env.MORSE_HOME = home;
  site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(APP)).listen(0, "127.0.0.1");
  await new Promise(r => site.on("listening", r));
  origin = `http://127.0.0.1:${site.address().port}`;

  store = await import("../daemon/store.js");
  const { createMod } = await import("../core/mod.js");
  // A mod for this site that needs the page's own JS objects, one for another site.
  await store.saveMod({ ...createMod({ prompt: "mark it", js: "document.body.dataset.seen = String(window.appSecret);", url: `${origin}/` }), id: "keepme" });
  await store.saveMod({ ...createMod({ prompt: "elsewhere", js: "document.body.dataset.other = '1';", url: "https://other.test/" }), id: "other" });
  await store.addHistory("other.test", "a prompt typed on another site");

  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`];
  browser = await launchBrowser({ channel: "chromium", args });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  page = await ctx.newPage();
  await page.goto(`${origin}/`);
  ({ Connector } = await import("../daemon/connector.js"));
  connector = new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  connector.run();
  await waitForReady(page);
});
after(async () => {
  await connector?.stop().catch(() => {});
  await browser?.close();
  site?.close();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

async function assertIsolated() {
  // Several probes after the runtime is up.
  const start = (await probe())?.n || 0;
  const p = await until(async () => { const v = await probe(); return v && v.n > start + 5 && v; });
  assert.deepEqual(p.seen, {}, "the page saw nothing of Morse's host API");
  assert.ok(!(await store.listMods()).some(m => m.id === "everywhere"), "the page saved no mod");
}

test("the page's own scripts can't see or call the host API", { skip }, async () => {
  await assertIsolated();
  // ...while the runtime works: it said hello and listed this site's mods.
  await until(async () => (await status())?.mods === 1);
  assert.equal((await status()).mods, 1, "only this site's mod is listed");
});

test("mods still run in the page's main world", { skip }, async () => {
  await until(() => page.evaluate(() => document.body.dataset.seen));
  assert.equal(await page.evaluate(() => document.body.dataset.seen), "s3cret", "the mod read a page global");
  assert.equal(await page.evaluate(() => document.body.dataset.other), undefined, "another site's mod didn't run");
});

test("after a navigation the runtime is back, still isolated", { skip }, async () => {
  await page.reload();
  await waitForReady(page);
  await assertIsolated();
  await until(() => page.evaluate(() => document.body.dataset.seen));
  assert.equal(await page.evaluate(() => document.body.dataset.seen), "s3cret");
  assert.equal(await page.locator("[data-morse-ui]").count(), 1, "one runtime, not two");
});

test("a binding with the same name in the main world reaches nothing", { skip }, async () => {
  // Another debugger client exposes __morseHostSend to the page's main world.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Runtime.addBinding", { name: "__morseHostSend" });
  await page.evaluate(() => {
    __morseHostSend(JSON.stringify({ id: 7, type: "history.add", text: "forged" }));
    __morseHostSend(JSON.stringify({ id: 8, type: "mods.delete", modId: "keepme" }));
    __morseHostSend(JSON.stringify({ id: 9, type: "settings.set", settings: { hotkeys: { open: "Alt+KeyQ" } } }));
  }).catch(() => {});
  await page.evaluate(w => __morseHostSend(JSON.stringify({ id: 10, type: "mods.save", mod: w })), WIDE);
  await new Promise(r => setTimeout(r, 500)); // an observation window: nothing should arrive anywhere
  const hist = JSON.parse(await fs.readFile(path.join(home, "history.json"), "utf8"));
  assert.ok(!JSON.stringify(hist).includes("forged"));
  assert.ok((await store.listMods()).some(m => m.id === "keepme"));
  assert.ok(!(await store.listMods()).some(m => m.id === "everywhere"), "nothing saved");
  assert.notEqual((await store.loadPrefs()).hotkeys.open, "Alt+KeyQ");
  await cdp.detach();
});

test("reattaching reuses the runtime that's already in the page", { skip }, async () => {
  const before = await page.evaluate(() => document.querySelector("[data-morse-ui]").dataset.status);
  assert.ok(before);
  // A second connector (a restarted daemon) on the same app.
  const again = new Connector({ port: connector.port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  const t = (await (await fetch(`http://127.0.0.1:${connector.port}/json/list`)).json()).find(x => x.type === "page" && x.url.startsWith(origin));
  await again.attach(t); // includes booting in Morse's world
  await settle(page);
  assert.equal(await page.locator("[data-morse-ui]").count(), 1, "no second overlay");
  for (const s of again.pages.values()) s?.close();
});

// ---- scoping, without a browser: the caller's URL comes from its own document.

function fakeSession(href) {
  return {
    sent: [],
    async send(method, params) {
      this.sent.push({ method, params });
      if (method === "Runtime.evaluate" && params.expression === "location.href") return { result: { value: href } };
      return { result: { value: { ok: true } } };
    },
  };
}

test("mods.list and history answer for the caller's page, not the message", { skip }, async () => {
  const c = new Connector({ port: 0, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  const s = fakeSession(`${origin}/page`);
  const caller = { world: 11, main: 10, frameId: "F" };
  const list = await c.dispatch(s, caller, { type: "mods.list", url: "https://other.test/" });
  assert.deepEqual(list.map(m => m.id), ["keepme"]);
  assert.deepEqual(await c.dispatch(s, caller, { type: "history.get", scope: "other.test", url: "https://other.test/" }), []);
  await c.dispatch(s, caller, { type: "history.add", scope: "other.test", text: "mine" });
  assert.deepEqual(await store.loadHistory("other.test"), ["a prompt typed on another site"]);
  assert.ok((await store.loadHistory(new URL(origin).host)).includes("mine"));
});

test("a page can't delete or overwrite another site's mod", { skip }, async () => {
  const c = new Connector({ port: 0, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  const s = fakeSession(`${origin}/`);
  const caller = { world: 11, main: 10, frameId: "F" };
  await assert.rejects(c.dispatch(s, caller, { type: "mods.delete", modId: "other" }), /another app or site/);
  const other = (await store.listMods()).find(m => m.id === "other");
  await assert.rejects(c.dispatch(s, caller, { type: "mods.save", mod: { ...other, js: "alert(1)" } }), /another app or site/);
  await assert.rejects(c.dispatch(s, caller, { type: "mods.save", draft: { id: "other", prompt: "p", css: "", js: "", url: "https://other.test/" } }), /another app or site/);
  assert.equal((await store.listMods()).find(m => m.id === "other").js, other.js);
  // A new draft is filed under the caller's page, whatever URL it names.
  const saved = await c.dispatch(s, caller, { type: "mods.save", draft: { prompt: "p", css: "", js: "", url: "https://other.test/" } });
  assert.deepEqual(saved.match.hosts, [new URL(origin).host]);
  await c.dispatch(s, caller, { type: "mods.delete", modId: saved.id });
});

test("even from Morse's world, mods.save can't widen where a mod runs", { skip }, async () => {
  const c = new Connector({ port: 0, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  const s = fakeSession(`${origin}/`);
  const caller = { world: 11, main: 10, frameId: "F" };
  const host = new URL(origin).host;
  await assert.rejects(c.dispatch(s, caller, { type: "mods.save", mod: WIDE }), /another app or site/);
  await assert.rejects(c.dispatch(s, caller, { type: "mods.save", mod: { ...WIDE, match: { hosts: [host, "other.test"], app: null } } }), /another app or site/);
  const keep = (await store.listMods()).find(m => m.id === "keepme");
  await assert.rejects(c.dispatch(s, caller, { type: "mods.save", mod: { ...keep, match: { hosts: ["*"], app: null } } }), /another app or site/);
  assert.ok(!(await store.listMods()).some(m => m.id === "everywhere"));
  // Saving this site's mod as it is (a toggle, an edit) works.
  await c.dispatch(s, caller, { type: "mods.save", mod: { ...keep, enabled: false } });
  await c.dispatch(s, caller, { type: "mods.save", mod: { ...keep, enabled: true } });
  // An installed (confirmed) mod that runs everywhere can still be toggled; its match doesn't change.
  await store.saveMod({ ...WIDE, id: "installed", imported: true });
  await c.dispatch(s, caller, { type: "mods.save", mod: { ...WIDE, id: "installed", imported: true, enabled: false } });
  assert.equal((await store.listMods()).find(m => m.id === "installed").enabled, false);
  await store.deleteMod("installed");
  // A desktop app: no wider than this app and this host.
  const d = new Connector({ port: 0, app: { id: "notes", name: "Notes" }, settings: { provider: "demo", model: "demo" }, log: () => {} });
  await assert.rejects(d.dispatch(s, caller, { type: "mods.save", mod: { ...WIDE, id: "notes1", match: { hosts: ["*"], app: "notes" } } }), /another app or site/);
  const ok = await d.dispatch(s, caller, { type: "mods.save", mod: { ...WIDE, id: "notes2", match: { hosts: [host], app: "notes" } } });
  assert.equal(ok.id, "notes2");
  await store.deleteMod("notes2");
});

test("mod code goes to the main world, replies to Morse's world", { skip }, async () => {
  const c = new Connector({ port: 0, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  const s = fakeSession(`${origin}/`);
  s.send = async function (method, params) { this.sent.push({ method, params }); return { result: { value: params.expression?.startsWith("morse.__errors") ? [] : { ok: true } } }; };
  await c.handle(s, { world: 11, main: 10, frameId: "F" }, { id: 3, type: "exec", modId: "m1", js: "1" });
  const evals = s.sent.filter(x => x.method === "Runtime.evaluate");
  assert.ok(evals.filter(e => /__morseHostReceive/.test(e.params.expression)).every(e => e.params.contextId === 11));
  assert.ok(evals.filter(e => !/__morseHostReceive/.test(e.params.expression)).every(e => e.params.contextId === 10));
  assert.equal(evals.filter(e => /__morseHostReceive/.test(e.params.expression)).length, 1);
});
