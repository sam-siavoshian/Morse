// Bug and security hunt, round 5: self-heal, Show me once and its kit
// helpers, the desktop connector's stop, app discovery, fuses and plain-words
// errors. Each test failed before its fix.
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { promises as fs, writeFileSync } from "node:fs";
import { chromium, noBrowser as skip, launchBrowser } from "./helpers/browser.js";
import { freePort } from "./helpers/net.js";
import { waitFor, waitForReady, readStatus } from "./helpers/wait.js";
import { OPEN_KEY, pressOpen } from "./helpers/keys.js";

import { makeFingerprint, assessFingerprint, pagePathShape, hiddenBy, fixIssue, modCodeHash } from "../core/heal.js";
import { submitIssue, forGallery, SUBMIT_MAX_URL } from "../core/gallery.js";
import { stepsForModel, recordingPrompt, cannotUndo, privateAttr } from "../core/showonce.js";
import { showOnceDemo } from "../core/showonce-demo.js";
import { buildMessages } from "../core/prompt.js";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";
import { plainError, onHiddenError } from "../core/onboarding.js";

void home;
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => {}); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function serve(handler) {
  const s = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise(r => s.on("listening", r));
  cleanups.push(() => new Promise(r => { s.close(r); s.closeAllConnections(); }));
  return `http://127.0.0.1:${s.address().port}`;
}
let sharedBrowser = null;
async function browser() {
  if (sharedBrowser) return sharedBrowser;
  sharedBrowser = await launchBrowser();
  cleanups.push(() => sharedBrowser.close());
  return sharedBrowser;
}

// ======================================================================
// Self-heal: no false alarms

const URL1 = "https://shop.example/admin.php?page=orders";

test("self-heal: a mod that hides something is never flagged when that thing is gone (a cookie banner, a promo)", () => {
  const counts = { ".cookie-banner": 1, "#promo": 1, ".header": 1, ".ad": 3 };
  const hider = { css: ".cookie-banner { display: none !important }\n#promo { visibility: hidden }", js: "" };
  assert.equal(makeFingerprint(hider, counts, { url: URL1, size: 400 }), null, "nothing to compare: gone is what it wants");
  const both = { css: ".cookie-banner { display: none !important }\n.header { color: rgb(200, 0, 0) }", js: "" };
  assert.deepEqual(makeFingerprint(both, counts, { url: URL1, size: 400 }).sels, [[".header", 1]]);
  // Hidden in one rule and shown in another (a narrow screen): still compared.
  assert.deepEqual([...hiddenBy({ css: ".side { display: none }\n@media (min-width: 900px) { .side { display: block } }" })], []);
  // A script that removes what it finds.
  const remover = { css: "", js: 'morse.watch(".ad", el => el.remove());' };
  assert.equal(makeFingerprint(remover, counts, { url: URL1, size: 400 }), null);
});

test("self-heal: a page reached by its query (?page=orders, ?page=settings) is another page; tracking and search words are not", () => {
  assert.notEqual(pagePathShape("https://shop.example/admin.php?page=orders"), pagePathShape("https://shop.example/admin.php?page=settings"));
  assert.equal(pagePathShape("https://shop.example/admin.php?page=Orders&utm_source=mail&q=red+shoes"), "/admin.php?page=orders");
  assert.equal(pagePathShape("https://x.example/watch?v=dQw4w9WgXcQ&t=42"), "/watch", "ids and numbers are not routes");
  assert.equal(pagePathShape("http://127.0.0.1:8789/demo/sites/tunes/?v2"), "/demo/sites/tunes/");
  const fp = makeFingerprint({ css: ".orders-table { font-size: 12px }", js: "" }, { ".orders-table": 1 }, { url: URL1, size: 400 });
  const settingsPage = { path: pagePathShape("https://shop.example/admin.php?page=settings"), size: 380, counts: { ".orders-table": 0 } };
  assert.equal(assessFingerprint(fp, settingsPage).verdict, "skip");
  assert.equal(assessFingerprint(fp, { ...settingsPage, path: pagePathShape(URL1) }).verdict, "broken");
});

test("self-heal: a sign-in page, and a part further down than anyone has scrolled, can't say a mod broke", () => {
  const mod = { css: ".inbox { font-size: 15px }\n.comments { color: red }", js: "" };
  const counts = { ".inbox": 1, ".comments": 1 };
  const fp = makeFingerprint(mod, counts, { url: URL1, size: 500 });
  const gone = { path: pagePathShape(URL1), size: 450, counts: {} };
  assert.equal(assessFingerprint(fp, { ...gone, signin: true }).verdict, "skip", "signed out: the same address shows a sign-in form");
  assert.equal(assessFingerprint(fp, gone).verdict, "broken");
  assert.equal(assessFingerprint(makeFingerprint(mod, counts, { url: URL1, size: 500, signin: true }), { ...gone, signin: true }).verdict, "broken", "made on a page with a password field");
  // Comments far down a long page load when scrolled to.
  const low = makeFingerprint(mod, counts, { url: URL1, size: 500, tops: { ".inbox": 1600, ".comments": 2400 }, fold: 700 });
  assert.equal(low.below, true);
  assert.equal(assessFingerprint(low, { ...gone, scrolled: false }).verdict, "skip");
  assert.equal(assessFingerprint(low, { ...gone, scrolled: true }).verdict, "broken");
  assert.equal(makeFingerprint(mod, counts, { url: URL1, size: 500, tops: { ".inbox": 100, ".comments": 2400 }, fold: 700 }).below, undefined, "part of it is on the first screen");
});

// ======================================================================
// Self-heal: Share the fix

test("Share the fix: a long fix is attached, not a link GitHub turns down", () => {
  const base = { morse: 1, id: "g", title: "Fix", prompt: "p", js: "", match: { hosts: ["tunes.example"], app: null }, gallery: { id: "g", version: 1 } };
  // The biggest mod whose new-mod link still fits.
  let lo = 0, hi = 20000;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (submitIssue({ ...base, css: "a".repeat(mid) }).attached) hi = mid - 1; else lo = mid; }
  const mod = { ...base, css: "a".repeat(lo) };
  assert.equal(submitIssue(mod).attached, false);
  const r = fixIssue(mod, {}, submitIssue);
  assert.ok(r.url.length <= SUBMIT_MAX_URL, `link is ${r.url.length} characters`);
  assert.equal(r.attached, true);
  assert.equal(new URL(r.url).searchParams.get("title"), "Gallery fix: “Fix” works again");
  assert.match(new URL(r.url).searchParams.get("body"), /^### What this fixes\n/);
});

test("Share the fix and Submit to the gallery leave out where a part came from and whether it was shared", () => {
  const m = forGallery({ morse: 1, id: "g", title: "t", prompt: "p", css: "", js: "", match: { hosts: ["a.example"] },
    from: { app: null, url: "https://intranet.corp.example/hr/42?token=abc", title: "Salary review" }, fixShared: "x1",
    target: { selector: "#row-42", label: "Dana Whitfield – salary" } });
  assert.equal("from" in m, false);
  assert.equal("target" in m, false, "what was pointed at, in the page's own words");
  assert.equal("fixShared" in m, false);
});

// ======================================================================
// Self-heal in the real runtime, with a stand-in host that keeps mods in
// the page's localStorage (so they survive a reload).

const GRID = n => `<div class="grid">${Array.from({ length: n }, (_, i) => `<div class="card"><b>Album ${i}</b></div>`).join("")}</div>`;
const GRID2 = n => `<div class="rl-grid">${Array.from({ length: n }, (_, i) => `<div class="rl-card"><b>Album ${i}</b></div>`).join("")}</div>`;
const pageOf = body => `<!doctype html><title>Shop</title><body style="margin:0">${body}<footer>${"<p>filler</p>".repeat(30)}</footer></body>`;

async function healPage({ html, mods, settings = {}, gen = { ok: false, error: "test" }, genDelay = 50, openError = null, settingsError = null }) {
  const state = { html };
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(state.html));
  const host = new URL(origin).host;
  const ctx = await (await browser()).newContext({ viewport: { width: 1000, height: 700 } });
  cleanups.push(() => ctx.close());
  await ctx.addInitScript(({ mods, settings, gen, genDelay, openError, settingsError }) => {
    if (window !== top) return;
    localStorage.setItem("morse:debug", "1");
    if (!localStorage.getItem("r5:mods")) localStorage.setItem("r5:mods", JSON.stringify(mods));
    const list = () => JSON.parse(localStorage.getItem("r5:mods"));
    const log = m => localStorage.setItem("r5:log", JSON.stringify([...JSON.parse(localStorage.getItem("r5:log") || "[]"), m]));
    const subs = [];
    window.__emit = m => subs.forEach(f => f(m));
    globalThis.__morseHost = {
      onMessage: f => subs.push(f),
      send(m) {
        log({ type: m.type, mod: m.mod || null, url: m.url || null, target: m.context?.target?.label ?? null, at: Date.now() });
        const reply = (result, delay = 5, error) => setTimeout(() => window.__emit({ reply: m.id, result, error }), delay);
        switch (m.type) {
          case "hello": return reply({ mode: "playground", label: "test", quiet: true, settings: { welcome: false, ...settings } });
          case "settings.get": return settingsError ? reply(null, 5, settingsError) : reply({ welcome: false, ...settings });
          case "mods.list": return reply(list());
          case "mods.save": { const l = list().filter(x => x.id !== m.mod.id); l.push(m.mod); localStorage.setItem("r5:mods", JSON.stringify(l)); return reply(m.mod); }
          case "exec": return reply({ ok: true });
          case "generate": return reply(gen, genDelay);
          case "open": return openError ? reply(null, 5, openError) : reply(true);
          default: return reply(null);
        }
      },
    };
  }, { mods: mods(host), settings, gen, genDelay, openError, settingsError });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on("console", m => consoleLines.push(m.text()));
  const { bundleRuntime } = await import("../runtime/bundle.js");
  const runtime = bundleRuntime();
  const visit = async () => {
    await page.goto(origin + "/");
    await page.addScriptTag({ content: runtime });
    await waitForReady(page);
  };
  return {
    page, state, origin, host, visit, consoleLines,
    log: () => page.evaluate(() => JSON.parse(localStorage.getItem("r5:log") || "[]")),
    stored: () => page.evaluate(() => JSON.parse(localStorage.getItem("r5:mods"))),
    dot: () => page.evaluate(() => !!document.querySelector("[data-morse-ui]")?.shadowRoot?.querySelector(".bar[data-heal]")),
  };
}
const gridMod = (host, over = {}) => ({ morse: 1, id: "r5-grid", title: "Wide grid", prompt: "space out the albums", css: ".grid { gap: 19px }\n.grid .card { padding: 3px }", js: "",
  enabled: true, match: { hosts: [host], app: null }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", ...over });
const generates = log => log.filter(m => m.type === "generate").length;

test("auto-fix: a version that is itself an automatic fix is never fixed automatically again (a site that flips between two designs)", { skip, timeout: 90000 }, async () => {
  const t = await healPage({
    html: pageOf(GRID(12)), settings: { autoFix: true },
    mods: host => [gridMod(host, { refined: "Fixed after this site changed", history: [{ prompt: "space out the albums", css: ".old-grid { gap: 19px }", js: "", at: "2026-01-01T00:00:00.000Z" }] })],
  });
  await t.visit();
  await waitFor(async () => (await t.stored())[0].fp, { what: "the fingerprint" });
  t.state.html = pageOf(GRID2(12)); // the site's other design
  await t.visit();
  await waitFor(t.dot, { what: "the stopped-working dot" });
  await sleep(1500);
  assert.equal(generates(await t.log()), 0, "the page went to the model on its own");
});

test("auto-fix: a try that didn't fix it isn't made again on the next visit, even when the page clears its storage", { skip, timeout: 90000 }, async () => {
  const t = await healPage({ html: pageOf(GRID(12)), settings: { autoFix: true }, mods: host => [gridMod(host)], gen: { ok: false, error: "The model's answer had no change in it." } });
  await t.visit();
  await waitFor(async () => (await t.stored())[0].fp, { what: "the fingerprint" });
  t.state.html = pageOf(GRID2(12));
  await t.visit();
  await waitFor(async () => generates(await t.log()) === 1, { what: "the automatic fix" });
  await sleep(800);
  await t.page.evaluate(() => sessionStorage.clear());
  await t.visit();
  await waitFor(t.dot, { what: "the note again" });
  await sleep(1500);
  assert.equal(generates(await t.log()), 1);
});

test("auto-fix: deleting the mod while the model works on it doesn't bring it back", { skip, timeout: 90000 }, async () => {
  const t = await healPage({ html: pageOf(GRID(12)), settings: { autoFix: true }, mods: host => [gridMod(host)],
    gen: { ok: true, title: "Wide grid", css: ".rl-grid { gap: 19px }", js: "" }, genDelay: 2500 });
  await t.visit();
  await waitFor(async () => (await t.stored())[0].fp, { what: "the fingerprint" });
  t.state.html = pageOf(GRID2(12));
  await t.visit();
  await waitFor(async () => generates(await t.log()) === 1, { what: "the automatic fix to start" });
  await t.page.evaluate(() => { localStorage.setItem("r5:mods", "[]"); window.__emit({ type: "mods.changed" }); }); // deleted (in another window)
  await sleep(4000);
  assert.deepEqual(await t.stored(), [], "the deleted mod came back");
  assert.equal(await t.page.locator("style[data-morse-css]").count(), 0);
});

test("auto-fix: the page's own storage can't turn it on when the host doesn't answer for a moment", { skip, timeout: 90000 }, async () => {
  const t = await healPage({ html: pageOf(GRID(12)), mods: host => [gridMod(host)], settings: { autoFix: false, hotkeys: { mods: "Alt+Shift+KeyJ" } },
    settingsError: "Could not establish connection. Receiving end does not exist." });
  await t.visit();
  await waitFor(async () => (await t.stored())[0].fp, { what: "the fingerprint" });
  t.state.html = pageOf(GRID2(12));
  await t.visit();
  await waitFor(t.dot, { what: "the stopped-working note" });
  // The page writes Morse's settings into its own storage; a focus asks the host, which fails once.
  await t.page.evaluate(() => { localStorage.setItem("morse:settings", JSON.stringify({ autoFix: true })); dispatchEvent(new Event("focus")); });
  await sleep(300);
  assert.deepEqual((await readStatus(t.page)).hotkeys.mods, "Alt+Shift+KeyJ", "the host's settings stay");
  await t.page.evaluate(() => history.pushState(null, "", "/#later")); // a single-page app moves on: another check
  await sleep(9000);
  assert.equal(generates(await t.log()), 0, "the page went to the model");
});

test("self-heal: a part far down a long page that loads when scrolled to is not 'stopped working' before anyone scrolls", { skip, timeout: 90000 }, async () => {
  const comments = '<section class="comments"><p>First!</p><p>Nice</p><p>Thanks</p></section>';
  const long = c => pageOf(`<h1>Post</h1><div style="height:1800px">${"<p>text</p>".repeat(40)}</div>${c}`);
  const t = await healPage({ html: long(comments), mods: host => [gridMod(host, { id: "r5-comments", title: "Red comments", prompt: "make the comments red", css: ".comments { color: rgb(200, 0, 0) }" })] });
  await t.visit();
  const fp = await waitFor(async () => (await t.stored())[0].fp, { what: "the fingerprint" });
  assert.equal(fp.below, true);
  // Next visit the comments wait for a scroll before they load.
  t.state.html = long(`<script>addEventListener("scroll", () => { if (!document.querySelector(".comments")) document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(comments)}); });</script>`);
  await t.visit();
  await sleep(9000); // settle, confirm, settle
  assert.equal(await t.dot(), false, "flagged as stopped working");
});

test("Share the fix: the issue names the gallery mod's own sites, never this page's address; developers see the raw error in the console", { skip, timeout: 60000 }, async () => {
  const t = await healPage({
    html: pageOf(GRID(6)), openError: "TypeError: opener.focus is not a function",
    mods: () => [gridMod("x", { id: "slack-quiet", title: "Quiet sidebar", match: { hosts: ["*.slack.com"], app: null }, gallery: { id: "slack-quiet", version: 2 }, imported: true,
      refined: "Fixed after this site changed", history: [{ prompt: "p", css: ".a{}", js: "", at: null }],
      from: { app: null, url: "https://acme-corp.slack.com/archives/C42?token=SeCrEt", title: "Acme payroll" } })],
  });
  await t.visit();
  await t.page.keyboard.press("Alt+Shift+KeyM");
  const share = t.page.locator('[data-morse-ui] .panel article[data-id="slack-quiet"] [data-a=heal-share]');
  await share.click();
  const open = await waitFor(async () => (await t.log()).find(m => m.type === "open"), { what: "GitHub to open" });
  const u = new URL(open.url);
  const body = u.searchParams.get("body");
  assert.match(body, /### Which site or app\n\*\.slack\.com\n/);
  for (const s of [t.host, "acme-corp", "SeCrEt", "payroll"]) assert.ok(!body.includes(s) && !u.searchParams.get("title").includes(s), `"${s}" is in the issue`);
  // The toast says it plainly; the console keeps what happened.
  await waitFor(() => t.consoleLines.some(l => l.includes("[morse] details:") && l.includes("opener.focus is not a function")), { what: "the details in the console" });
});

// ======================================================================
// Show me once: what is recorded, and asking before what can't be undone

test("Show me once: hidden attributes (emails, tokens) never reach the model's steps", () => {
  assert.equal(privateAttr("data-email", "a"), true);
  assert.equal(privateAttr("aria-label", "Message ann@corp.example"), true);
  assert.equal(privateAttr("data-x", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0"), true);
  assert.equal(privateAttr("data-unread", "true"), false);
  const steps = stepsForModel([{ do: "click", selector: "li", label: "Ann", item: { selector: "ul > li", count: 3, index: 0, label: "Ann", attrs: { "data-unread": "true", "data-email": "ann@corp.example", "data-session-id": "s3ss10n" } } }]);
  assert.deepEqual(steps[0].item.attrs, { "data-unread": "true" });
});

test("Show me once: steps that delete, buy or send are marked, and the model is told to ask first", () => {
  const steps = [
    { do: "click", selector: "div.r9", label: "Leo Martins", item: { selector: "div.lst > div.r9", count: 4, index: 0, label: "Leo Martins", attrs: {} } },
    { do: "click", selector: "button", text: "Delete", label: "Delete", role: "button" },
  ];
  assert.deepEqual(steps.map(cannotUndo), [false, true]);
  for (const label of ["Buy now", "Place order", "Send", "Pay $20", "Remove from cart", "Submit"]) assert.equal(cannotUndo({ do: "click", label }), true, label);
  for (const label of ["Archive", "Open", "Mark as read", "Star", "Cancel"]) assert.equal(cannotUndo({ do: "click", label }), false, label);
  assert.equal(cannotUndo({ do: "key", key: "Delete", selector: "body" }), true);
  const out = stepsForModel(steps);
  assert.equal(out[1].confirm, true);
  assert.equal("confirm" in out[0], false);
  const p = recordingPrompt({ steps });
  assert.match(p, /^2\. Click “Delete” \[confirm: can't be undone\]$/m);
  assert.match(p, /morse\.confirm/);
  // The demo model asks before it deletes, once, with the count.
  const reply = showOnceDemo(buildMessages({ request: "Do these steps to every unread email", context: { url: "http://x/", title: "Inbox", recording: { steps: out } } }).at(-1).content);
  assert.equal((reply.match(/morse\.confirm\(/g) || []).length, 1);
});

test("Show me once: code that deletes without asking is sent back, and never kept", async () => {
  const steps = stepsForModel([{ do: "click", selector: "button", text: "Delete", label: "Delete", role: "button" }]);
  const replies = [
    "TITLE: Delete\n```js\nmorse.watch('.tb', t => t.append(morse.el('button', { text: 'Delete it', on: { click: async () => (await morse.waitFor('button', { text: 'Delete' })).click() } })));\n```",
    "TITLE: Delete\n```js\nmorse.watch('.tb', t => t.append(morse.el('button', { text: 'Delete it', on: { click: async () => { if (!(await morse.confirm('Delete this email?'))) return; (await morse.waitFor('button', { text: 'Delete' })).click(); } } })));\n```",
  ];
  const prompts = [];
  registerProvider("r5-sure", async (s, m, { onToken }) => { prompts.push(m.at(-1).content); const r = replies[Math.min(prompts.length - 1, replies.length - 1)]; onToken(r); return r; });
  const res = await runMorse({ settings: { provider: "r5-sure" }, request: "add a button that does this", context: { url: "x", title: "x", recording: { steps } }, emit: () => {}, exec: async () => ({ ok: true }) });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.match(prompts[1], /can't be undone, and the code never asks first/);
  // A model that never asks: nothing is kept.
  prompts.length = 0; replies.splice(1);
  const never = await runMorse({ settings: { provider: "r5-sure" }, request: "add a button that does this", context: { url: "x", title: "x", recording: { steps } }, emit: () => {}, exec: async () => ({ ok: true }) });
  assert.equal(never.ok, false);
  assert.match(plainError(never.error), /without asking you first/);
});

// ---- Show me once in the real runtime, on the Postbox demo site

async function mail() {
  const { openSite } = await import("../demo/show-once-page.js");
  const t = await openSite(await browser(), "mail");
  cleanups.push(() => t.ctx.close());
  return t;
}
const statusOf = page => readStatus(page);
async function startRecording(page) {
  await pressOpen(page);
  await page.locator(".sugs .so-sug").click();
  await page.locator(".so-strip").waitFor();
  await waitFor(async () => !(await statusOf(page)).open);
}
async function stopAndAsk(page, request) {
  await page.locator(".so-strip [data-so=stop]").click();
  await waitFor(async () => (await statusOf(page)).open);
  await page.keyboard.type(request);
  await page.keyboard.press("Enter");
  await waitFor(async () => (await statusOf(page)).phase === "result");
  return (await page.evaluate(() => window.__sent)).find(m => m.type === "generate");
}

test("Show me once: typing in a rich editor keeps only what was typed, not the text that was already there", { skip, timeout: 60000 }, async () => {
  const { page } = await mail();
  await page.evaluate(() => document.querySelector(".rd").insertAdjacentHTML("afterbegin",
    `<div id="ed" contenteditable="true" aria-label="Note" style="min-height:40px">Dear Sam, my account number is 12345678</div>`));
  await startRecording(page);
  await page.locator("#ed").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Thanks");
  const gen = await stopAndAsk(page, "add a button that does this");
  const steps = gen.context.recording.steps;
  assert.deepEqual(steps.map(s => [s.do, s.value]), [["type", " Thanks"]]);
  assert.doesNotMatch(JSON.stringify(gen), /12345678/);
});

test("Show me once: an email or token in a part's attributes stays out of the steps", { skip, timeout: 60000 }, async () => {
  const { page } = await mail();
  await page.evaluate(() => document.querySelector(".rd").insertAdjacentHTML("afterbegin", `<ul id="ppl">${["ann", "bob", "cy"].map(n =>
    `<li data-email="${n}@corp.example" data-session="AbC123xyzSessionTokenQ9" title="${n}@corp.example"><span>${n}</span> <button aria-label="Chat with ${n}@corp.example">✉</button></li>`).join("")}</ul>`));
  await startRecording(page);
  await page.locator("#ppl li:nth-child(2) button").click();
  const gen = await stopAndAsk(page, "add a button that does this");
  const [s] = gen.context.recording.steps;
  // (Its name, “Chat with bob@…”, is in the steps the person saw and can remove; what they never see isn't.)
  const hidden = JSON.stringify({ selector: s.selector, item: s.item?.selector, attrs: s.item?.attrs, inside: s.item?.inside });
  assert.doesNotMatch(hidden, /corp\.example|AbC123/);
  assert.doesNotMatch(JSON.stringify(gen.context.recording), /AbC123/);
});

test("Show me once: a button made from steps that delete asks first, in plain words; a page script can't answer for you", { skip, timeout: 90000 }, async () => {
  const { page } = await mail();
  const unread = () => page.locator('.r9[data-unread="true"]').count();
  await startRecording(page);
  await page.locator(".r9", { hasText: "Leo Martins" }).click();
  await page.locator(".rd .acts button", { hasText: "Delete" }).click();
  assert.equal(await unread(), 3);
  await page.locator(".so-strip [data-so=stop]").click();
  await waitFor(async () => (await statusOf(page)).open);
  await page.keyboard.type("Do these steps to every unread email");
  await page.keyboard.press("Enter");
  await waitFor(async () => (await statusOf(page)).phase === "result");
  const btn = page.locator(".morse-so-btn");
  await waitFor(async () => /\(3\)/.test(await btn.innerText()));
  await btn.click();
  const dialog = page.locator('[role=alertdialog][data-morse-ui]');
  await dialog.waitFor({ state: "attached" });
  assert.match(await dialog.locator("p").innerText(), /^Delete 3 unread emails\? This can't be undone\.$/);
  await page.evaluate(() => document.querySelector("[role=alertdialog]").shadowRoot.querySelector(".y").click()); // the page's own script
  await sleep(500);
  assert.equal(await unread(), 3, "a script answered yes");
  await dialog.locator("button", { hasText: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  await sleep(500);
  assert.equal(await unread(), 3, "Cancel deleted them");
  await btn.click();
  await dialog.locator("button.y").click();
  await waitFor(async () => (await unread()) === 0, { what: "the unread emails to be deleted" });
});

// ---- the kit helpers that replay steps

async function kitPage(html) {
  const ctx = await (await browser()).newContext();
  cleanups.push(() => ctx.close());
  const page = await ctx.newPage();
  await page.setContent(html);
  await page.evaluate(KIT_SOURCE);
  return page;
}

test("kit: waitFor with words picks the part that says exactly that first (Archive, not Unarchive)", { skip }, async () => {
  const page = await kitPage(`<div id="t"><button>Unarchive</button><button>Archive</button></div>`);
  await page.evaluate(wrapModCode("k1", `morse.waitFor("#t button", { text: "Archive" }).then(b => (window.__got = b.textContent));`));
  await page.waitForFunction(() => window.__got);
  assert.equal(await page.evaluate(() => window.__got), "Archive");
});

test("kit: choose never clicks a button, and Enter only submits a form when a real Enter would", { skip }, async () => {
  const page = await kitPage(`
    <form id="a" onsubmit="event.preventDefault(); window.__sub = (window.__sub || []).concat('a')"><input id="a1"><input id="a2"><button id="buy" type="submit">Buy now</button></form>
    <form id="b" onsubmit="event.preventDefault(); window.__sub = (window.__sub || []).concat('b')"><input id="b1"><input id="b2"></form>
    <form id="c" onsubmit="event.preventDefault(); window.__sub = (window.__sub || []).concat('c')"><input id="c1"><button disabled>Send</button></form>
    <form id="d" onsubmit="event.preventDefault(); window.__sub = (window.__sub || []).concat('d')"><input id="d1"></form>
    <div role="checkbox" aria-checked="false" id="rc" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')">Gift</div>`);
  const r = await page.evaluate(wrapModCode("k2", `
    try { morse.choose(document.getElementById("buy"), true); window.__chose = "clicked"; } catch (e) { window.__chose = e.message; }
    morse.choose(document.getElementById("rc"), true);
    morse.choose(document.getElementById("rc"), true);
    for (const id of ["b1", "c1", "d1"]) morse.key(document.getElementById(id), "Enter");`));
  assert.deepEqual(r, { ok: true });
  const got = await page.evaluate(() => ({ chose: window.__chose, sub: window.__sub || [], rc: document.getElementById("rc").getAttribute("aria-checked") }));
  assert.match(got.chose, /^morse\.choose works on a menu, a checkbox or an option/);
  assert.deepEqual(got.sub, ["d"], "two fields and no button, or a turned-off button: Enter submits nothing");
  assert.equal(got.rc, "true");
});

test("kit: confirm resolves only on the person's own click; No, Esc and turning the mod off are no", { skip }, async () => {
  const page = await kitPage(`<p>page</p>`);
  const ask = id => page.evaluate(wrapModCode(id, `window.__ans = undefined; morse.confirm("Delete 3 emails?", { yes: "Delete" }).then(v => (window.__ans = v));`));
  const dialog = page.locator("[role=alertdialog]");
  await ask("k3");
  assert.equal(await dialog.locator("p").innerText(), "Delete 3 emails?");
  await page.evaluate(() => document.querySelector("[role=alertdialog]").shadowRoot.querySelector(".y").click());
  await sleep(100);
  assert.equal(await page.evaluate(() => window.__ans), undefined);
  await dialog.locator("button", { hasText: "Delete" }).click();
  await page.waitForFunction(() => window.__ans === true);
  await ask("k4");
  await dialog.waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ans === false);
  await ask("k5");
  await dialog.waitFor({ state: "attached" });
  await page.evaluate(() => morse.__off("k5"));
  await page.waitForFunction(() => window.__ans === false);
  assert.equal(await dialog.count(), 0);
});

// ======================================================================
// Desktop: `morse stop` while a window is still being attached

test("desktop: morse stop while a window is still connecting leaves no Morse on the page and says nothing went wrong", { skip, timeout: 60000 }, async () => {
  const { CDPSession } = await import("../daemon/cdp.js");
  const { Connector } = await import("../daemon/connector.js");
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>App</title><h1>App</h1>"));
  const port = await freePort();
  const b = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  cleanups.push(() => b.close());
  const page = await (await b.newContext()).newPage();
  await page.goto(origin + "/");
  // Hold the attach right where it is about to start the runtime, until
  // stop() has cleaned the page up; let stop() take a moment before it
  // removes the host binding (as on a busy machine).
  const send = CDPSession.prototype.send;
  let release, probed = false;
  const gate = new Promise(r => (release = r));
  CDPSession.prototype.send = function (method, params) {
    if (method === "Runtime.evaluate" && String(params?.expression || "").startsWith("[!!globalThis.__morseHost")) {
      probed = true;
      return send.call(this, method, params).then(async v => { await gate; return v; });
    }
    if (method === "Runtime.removeBinding") return (async () => { release(); await sleep(600); return send.call(this, method, params); })();
    return send.call(this, method, params);
  };
  cleanups.push(async () => { CDPSession.prototype.send = send; });
  const logs = [];
  const connector = new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: m => logs.push(m) });
  connector.run();
  await waitFor(() => probed, { what: "the attach to reach the runtime" });
  await connector.stop();
  CDPSession.prototype.send = send;
  await sleep(800);
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-morse-ui]").length), 0, "Morse's bar is on the page after stop");
  assert.deepEqual(logs.filter(l => /Couldn't connect|connected to/.test(l)), []);
});

// ======================================================================
// Real apps: app.asar and fuses from files that are broken or huge

test("apps: an app.asar whose header claims to be gigabytes is not read (or allocated)", async () => {
  const apps = await import("../daemon/apps.js");
  const dir = tempDir("morse-r5-asar-");
  await fs.mkdir(path.join(dir, "resources"), { recursive: true });
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0); head.writeUInt32LE(0xfffffff8, 4); head.writeUInt32LE(0xfffffff4, 8); head.writeUInt32LE(0xfffffff0, 12);
  writeFileSync(path.join(dir, "resources", "app.asar"), head);
  const ctx = apps.hostContext({ platform: "linux" });
  const asked = [];
  const spy = { ...ctx, readRange: (p, s, n) => { asked.push(n); return n > 1 << 20 ? Buffer.alloc(0) : ctx.readRange(p, s, n); } };
  assert.deepEqual(apps.appPackage(spy, dir), { name: null, version: null });
  assert.ok(asked.every(n => n <= apps.ASAR_HEADER_MAX), `asked for ${asked.join(", ")} bytes`);
});

test("fuses: a wire cut short reports only what it has; a file past 2 GB is read in pieces, not refused", { timeout: 120000 }, async () => {
  const { readFuseWire, inspectFuses } = await import("../daemon/fuses.js");
  const SENT = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
  const cut = readFuseWire(Buffer.concat([Buffer.from("xx"), SENT, Buffer.from([1, 9]), Buffer.from("10")]));
  assert.deepEqual(cut.fuses, { RunAsNode: "enabled", EnableCookieEncryption: "disabled" });
  assert.equal(readFuseWire(Buffer.concat([SENT])), null);
  // A sparse file just over 2 GiB with a wire near its end.
  const file = path.join(tempDir("morse-r5-fuses-"), "Big App");
  const fh = await fs.open(file, "w");
  const size = 2 ** 31 + 4096;
  await fh.truncate(size);
  await fh.write(Buffer.concat([SENT, Buffer.from([1, 2]), Buffer.from("01")]), 0, SENT.length + 4, size - 1000);
  await fh.close();
  const info = await inspectFuses(file);
  assert.equal(info.electron, true);
  assert.deepEqual(info.fuses, { RunAsNode: "disabled", EnableCookieEncryption: "enabled" });
});

// ======================================================================
// Plain words, and still diagnosable

test("morse launch: why an app quit is shown as written, not as “Something went wrong”; the system's words stay in the details", async () => {
  const { waitForLaunch } = await import("../daemon/apps.js");
  const app = { id: "tunes", name: "Tunes", engine: "electron", exe: "/opt/Tunes/tunes" };
  const never = async () => { throw new Error("no port"); };
  const died = await waitForLaunch({ exited: { code: 1, signal: null } }, app, 1, { grace: 0, timeoutMs: 3000, wait: never }).catch(e => e);
  assert.equal(plainError(died), died.message);
  assert.match(plainError(died), /^Tunes quit right after it started \(exit code 1\)/);
  const failed = await waitForLaunch({ failed: Object.assign(new Error("spawn /opt/Tunes/tunes EPERM"), { code: "EPERM" }) }, app, 1, { grace: 0, timeoutMs: 3000, wait: never }).catch(e => e);
  assert.equal(plainError(failed), "Morse couldn't start Tunes: it isn't allowed to run (not executable).");
  assert.equal(failed.details, "spawn /opt/Tunes/tunes EPERM");
  // Long app names make long messages: still Morse's own words.
  const { resolveApp } = await import("../daemon/apps.js");
  const teams = n => ({ id: `teams-${n}`, name: `Microsoft Teams (work or school) ${n}`, aliases: [], exe: "/x" });
  const which = (() => { try { resolveApp("Microsoft Teams (work or school)", { apps: [teams(1), teams(2), teams(3), teams(4)] }); } catch (e) { return e; } })();
  assert.ok(which.message.length > 200);
  assert.equal(plainError(which), which.message);
  // Whatever plainError hides from people reaches developers.
  const seen = [];
  onHiddenError(raw => seen.push(raw));
  try {
    assert.equal(plainError(new Error("TypeError: Cannot read properties of null (reading 'x')")), "The change the model wrote didn't work on this page. Try again, or describe it differently.");
    assert.equal(plainError("Paste a share link first."), "Paste a share link first.");
    assert.deepEqual(seen, ["TypeError: Cannot read properties of null (reading 'x')"]);
  } finally { onHiddenError(null); }
});

// ======================================================================
// From real-site testing: a class the sidebar shares with the docs, and a
// part named by a number

// nodejs.org/api: the sidebar and the docs are both div.interior.
const NODE_DOCS = `<!doctype html><title>Node.js docs</title><style>
  body { margin: 0; font: 16px/1.5 sans-serif } #column2 { position: fixed; left: 0; top: 0; bottom: 0; width: 230px; background: #333; color: #fff; overflow: auto }
  #column1 { margin-left: 230px; padding: 20px }</style>
  <div id="content"><div id="column2" class="interior"><ul>${Array.from({ length: 30 }, (_, i) => `<li><a href="#m${i}">Module ${i}</a></li>`).join("")}</ul></div>
  <div id="column1" class="interior"><h1>File system</h1>${Array.from({ length: 30 }, (_, i) => `<p id="m${i}">The node:fs module enables interacting with the file system in a way modeled on standard POSIX functions. Paragraph ${i}.</p>`).join("")}</div></div>`;

test("guard: CSS that hides a class the sidebar shares with the docs is caught after it lands; hiding just the sidebar is fine", { skip }, async () => {
  const { pageCollapse, collapseHarm } = await import("../core/guard.js");
  const ctx = await (await browser()).newContext({ viewport: { width: 1200, height: 800 } });
  cleanups.push(() => ctx.close());
  const page = await ctx.newPage();
  await page.setContent(NODE_DOCS);
  const check = (css, id = "") => page.evaluate(([src, css, id]) => (0, eval)(`(${src})`)(css, id), [pageCollapse.toString(), css, id]);
  const all = await check("div.interior { display: none !important; }");
  assert.ok(collapseHarm(all), JSON.stringify(all));
  assert.match(collapseHarm(all).user, /^That would have hidden most of the page/);
  assert.equal(collapseHarm(await check("#column2 { display: none !important } #column1 { margin-left: 0 }")), null);
  assert.equal(collapseHarm(await check("#column1 p { color: #444 }")), null);
  // The draft's own style, streamed in already, is set aside for "before" (and put back).
  await page.evaluate(() => document.head.insertAdjacentHTML("beforeend", `<style data-morse-css="d1">div.interior { display: none !important; }</style>`));
  assert.ok(collapseHarm(await check("div.interior { display: none !important; }", "d1")));
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("column1")).display), "none", "the streamed style is back");
});

test("guard: a change that hides most of the page gets the repair round; one that keeps doing it is never kept", async () => {
  const replies = ["TITLE: Hide sidebar\n```css\ndiv.interior { display: none !important; }\n```", "TITLE: Hide sidebar\n```css\n#column2 { display: none !important; }\n```"];
  const prompts = [];
  registerProvider("r5-collapse", async (s, m, { onToken }) => { prompts.push(m.at(-1).content); const r = replies[Math.min(prompts.length - 1, replies.length - 1)]; onToken(r); return r; });
  const collapse = async css => (/interior/.test(css) ? { before: 40, after: 2 } : { before: 40, after: 31 });
  const res = await runMorse({ settings: { provider: "r5-collapse" }, request: "hide the left sidebar", context: { url: "x", title: "x" }, emit: () => {}, exec: async () => ({ ok: true }), collapse });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.match(prompts[1], /your CSS hid most of the page/);
  assert.match(res.css, /#column2/);
  prompts.length = 0; replies.splice(1);
  const never = await runMorse({ settings: { provider: "r5-collapse" }, request: "hide the left sidebar", context: { url: "x", title: "x" }, emit: () => {}, exec: async () => ({ ok: true }), collapse });
  assert.equal(never.ok, false);
  assert.equal(never.css, "");
  assert.equal(plainError(never.error), "That would have hidden most of the page, so Morse didn't keep it. Try saying which part you mean.");
});

test("desktop: “hide the left sidebar” on a page whose sidebar shares the docs' class doesn't blank the page", { skip, timeout: 120000 }, async () => {
  const replies = ["TITLE: Hide sidebar\n```css\ndiv.interior { display: none !important; }\n```",
    "TITLE: Hide sidebar\n```css\n#column2 { display: none !important; }\n#column1 { margin-left: 0 !important; }\n```"];
  const prompts = [];
  registerProvider("r5-node", async (s, m, { onToken }) => { prompts.push(m.at(-1).content); const r = replies[Math.min(prompts.length - 1, replies.length - 1)]; onToken(r); return r; });
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(NODE_DOCS));
  const port = await freePort();
  const b = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  cleanups.push(() => b.close());
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  const page = await ctx.newPage();
  await page.goto(origin + "/");
  const { Connector } = await import("../daemon/connector.js");
  const connector = new Connector({ port, app: null, settings: { provider: "r5-node", model: "x" }, log: () => {} });
  connector.run();
  cleanups.push(() => connector.stop());
  await waitForReady(page);
  await pressOpen(page);
  await waitFor(async () => (await readStatus(page)).open);
  await page.keyboard.type("hide the left sidebar");
  await page.keyboard.press("Enter");
  await waitFor(async () => (await readStatus(page)).phase === "result", { what: "the result" });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /hid most of the page/);
  assert.equal(await page.evaluate(() => [getComputedStyle(document.getElementById("column1")).display, getComputedStyle(document.getElementById("column2")).display].join()), "block,none");
});

test("a part whose first words are a number is named by its own name, not “0”", { skip, timeout: 60000 }, async () => {
  const t = await healPage({
    html: `<!doctype html><title>Code</title><body style="margin:0">
      <div id="workbench.parts.statusbar" class="part statusbar" role="status" style="position:fixed;top:0;left:0;right:0;height:40px;background:#007acc;color:#fff;display:flex;gap:12px;padding:0 8px;align-items:center"><span>0</span><span>⚠ 0</span><span>Ln 1</span></div>
      <main style="padding-top:60px">${"<p>code</p>".repeat(20)}</main></body>`,
    mods: () => [],
  });
  await t.visit();
  await pressOpen(t.page);
  await waitFor(async () => (await readStatus(t.page)).open);
  await t.page.mouse.move(900, 20);
  await t.page.mouse.click(900, 20);
  await t.page.keyboard.type("make it purple");
  await t.page.keyboard.press("Enter");
  const gen = await waitFor(async () => (await t.log()).find(m => m.type === "generate"), { what: "the request" });
  assert.equal(gen.target, "Statusbar");
});

void OPEN_KEY; void modCodeHash;
