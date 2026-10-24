// The first minutes, end to end, as a new user (onboarding v2,
// docs/dev/onboarding.md): a fresh Chrome profile with the built extension
// (dist/extension) and a fresh MORSE_HOME.
//   - install opens the welcome page, and only that; it asks one question
//   - nothing on the computer: Get Morse Desktop (recommended), or an API key
//   - Morse Desktop opens: the page finds it, "Use …" is one click, Morse
//     Desktop asks "Allow Chrome to use your …?", Deny connects nothing,
//     Allow connects (tests/helpers/fake-desktop.js: the real helper, as
//     Morse Desktop runs it)
//   - the first change on the practice page, step by step, then a page that
//     celebrates it and sends you to a real site: a suggested one opens with
//     Morse ready and the words typed; a demo site's change is saved, comes
//     back after a reload, and can be shared
//   - an Anthropic API key connects too, and one that isn't says so
//   - the terminal still works: `morse setup --pair <code>` connects by itself;
//     a helper with only its own code gets a code box
//   - “Allow User Scripts” shows up only when a change needs it: one switch,
//     with a picture, and Morse brings you back
// And, in the bar playground (fake host): progressive reveal and the first
// saved change's card.
//
//   node scripts/build.js && DISPLAY=:99 node --test tests/first-run.test.js
import { tempDir } from "./helpers/home.js"; // first: a MORSE_HOME of its own, and temp folders removed at exit
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { serveBar } from "../demo/bar-server.js";
import { serveDemo } from "../demo/serve.js";
import { freePort } from "./helpers/net.js";
import { SCALE } from "./helpers/wait.js";
import { createMod } from "../core/mod.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const CLI = path.join(root, "daemon", "cli.js");
const DESKTOP = path.join(root, "tests", "helpers", "fake-desktop.js");
const skip = !chromium && "playwright not installed";
const skipExt = skip || (!process.env.DISPLAY && "extensions need a display (run under Xvfb)") || (!existsSync(EXT) && "run node scripts/build.js first");
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = tempDir("morse-first-run-");
after(() => rmSync(tmp, { recursive: true, force: true }));

async function until(fn, ms = 20000, what = "condition") {
  const end = Date.now() + Math.max(ms, 15000) * SCALE; // a busy machine (several runs at once) is slow, not broken
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for ${typeof what === "function" ? await what() : what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

// `morse` (or the Morse Desktop stand-in), with its Morse helper on `port` (MORSE_HELPER_PORT).
function run(args, env = {}, port, file = CLI) {
  const p = spawn(process.execPath, [file, ...args], { env: { ...process.env, MORSE_HELPER_PORT: String(port), ...env }, stdio: ["pipe", "pipe", "pipe"] });
  p.out = "";
  p.stdout.on("data", d => (p.out += d));
  p.stderr.on("data", d => (p.out += d));
  p.done = new Promise(r => p.on("exit", r));
  return p;
}
const desktop = (home, port) => run([], { MORSE_HOME: home, MORSE_PROVIDER: "demo" }, port, DESKTOP);
const stop = async p => { if (p && p.exitCode == null) { p.kill("SIGTERM"); await Promise.race([p.done, sleep(3000)]); } };

async function install(name) {
  const ctx = await chromium.launchPersistentContext(path.join(tmp, name), {
    headless: false, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  // Each test has its own Morse helper on a port the OS picked, so runs side
  // by side never meet. The extension looks for it there ("morse.helperPort",
  // core/providers.js HELPER_PORT_KEY); the welcome page opened on install
  // before that was set, so it starts again.
  const port = await freePort();
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), port);
  const welcome = await until(() => ctx.pages().find(p => p.url().includes("/welcome.html")), 15000, "the welcome page to open on install");
  await welcome.waitForLoadState();
  await welcome.reload();
  await welcome.waitForLoadState();
  const errors = [];
  welcome.on("pageerror", e => errors.push(e.message));
  if (process.env.DEBUG_FR) welcome.on("console", m => console.log("welcome:", m.text()));
  return { ctx, sw, id, welcome, port, errors };
}
// The practice frame is sandboxed, so its bar can't be put in debug mode and
// its shadow root stays closed. DevTools can still read it (pierce).
async function closedText(frame, cls) {
  const cdp = await frame.page().context().newCDPSession(frame);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const text = n => (n.nodeType === 3 ? n.nodeValue : "") + [...(n.children || []), ...(n.shadowRoots || [])].map(text).join("");
    const find = n => {
      const c = n.attributes?.[n.attributes.indexOf("class") + 1];
      if (n.attributes?.includes("class") && c.split(" ").includes(cls)) return n;
      for (const k of [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]) { const f = find(k); if (f) return f; }
      return null;
    };
    const hit = find(root);
    return hit ? text(hit) : null;
  } finally { await cdp.detach().catch(() => {}); }
}
const screenOf = page => page.evaluate(() => document.getElementById("app").dataset.screen);
const text = (page, sel) => page.locator(sel).first().textContent().catch(() => "");
const stepState = (page, step) => page.evaluate(s => document.querySelector(`#steps [data-step="${s}"]`).className, step);
// A site's bar, in debug mode (its shadow root open).
const siteBar = page => ({
  status: () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status)),
  sr: sel => page.evaluate(s => { const n = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s); return n && !n.hidden && n.getClientRects().length ? n.innerText || n.value : null; }, sel),
  value: () => page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".in").value),
});

// The demo sites, each on its own origin like real sites.
let sites = null;
async function demoSites() {
  if (sites) return sites;
  // Every site on a port the OS picked (a random fixed range could be taken).
  const demo = await serveDemo();
  sites = { byte: `${demo.origin("byte")}/demo/sites/byte/`, stop: () => demo.close() };
  return sites;
}
after(() => sites?.stop());

// The first practice change: open the bar, point at the article, ask, Save.
async function firstChange(welcome) {
  await until(() => welcome.frames().find(f => f.url().includes("practice.html")), 30000, "the practice frame");
  const practice = welcome.frames().find(f => f.url().includes("practice.html"));
  await until(async () => /\bnow\b/.test(await stepState(welcome, "open")), 5000, "step 1 to be the one to do");
  await welcome.click("#open-bar");
  await until(async () => /\bdone\b/.test(await stepState(welcome, "open")), 8000, "step 1 to tick when the bar opens");
  // Where the article is once the page stops moving (it scrolls the practice area into view).
  let p = null;
  await until(async () => { const b = await practice.locator("article p").first().boundingBox(); const same = p && b.y === p.y; p = b; await sleep(200); return same; }, 5000, "the practice area to settle");
  await welcome.mouse.click(p.x + 120, p.y + 6);
  await sleep(800); // a person reads the chip before typing
  await welcome.keyboard.type("make this easier to read");
  await welcome.keyboard.press("Enter");
  await until(() => practice.evaluate(() => getComputedStyle(document.querySelector('aside[aria-label="Sponsored"]')).display === "none"), 30000, async () => { if (process.env.DEBUG_FR) await welcome.screenshot({ path: "/tmp/claude-0/-home-user-RRAA/620edd22-f6ab-5165-85ae-755c15063f2c/scratchpad/fail.png" }); return "the change on the practice page"; });
  assert.match(await stepState(welcome, "ask"), /\bdone\b/, "step 2 ticked");
  await until(async () => /Save/.test(await closedText(practice, "actions") || ""), 20000, "Save in the practice bar");
  await welcome.keyboard.press("Enter"); // Save
  return practice;
}

const ARTICLE = `<!doctype html><html><head><title>Lighthouse</title></head><body><main><h1>Lighthouse</h1>
  <p>A lighthouse is a tower, building, or other type of physical structure designed to emit light from a system of lamps and lenses.</p>
  <p>It serves as a beacon for navigational aid, for maritime pilots at sea or on inland waterways.</p></main></body></html>`;

test("first run: one question, Morse Desktop found, one click and Allow, the first change guided and celebrated, then a real site", { skip: skipExt, timeout: 300000 }, async () => {
  const { ctx, sw, id, welcome, port, errors } = await install("profile-flow");
  let desk = null;
  try {
    // Install opens the welcome page, not the settings page too.
    await sleep(800);
    assert.deepEqual(ctx.pages().map(p => p.url()).filter(u => u.startsWith("chrome-extension://")), [`chrome-extension://${id}/welcome.html`]);

    // ---- one question
    assert.equal(await screenOf(welcome), "choose");
    assert.equal(await text(welcome, "#choose-h"), "What do you want to change?");
    assert.deepEqual(await welcome.locator("[data-want] b").allTextContents(), ["Websites", "Desktop apps", "Both"]);
    await welcome.click("[data-want=web]");
    assert.equal(await screenOf(welcome), "connect");

    // ---- nothing on this computer yet: Morse Desktop (recommended) or an API key
    await until(() => welcome.locator("[data-view=desktop]").isVisible(), 10000, "Get Morse Desktop");
    assert.match(await text(welcome, "[data-view=desktop]"), /Recommended.*Get Morse Desktop/s);
    assert.equal(await welcome.locator("#get-desktop").getAttribute("href"), "https://github.com/sam-siavoshian/RRAA/releases/latest");
    assert.ok(await welcome.locator("#key").isVisible(), "the API key next to it, for websites");

    // ---- Morse Desktop opens: the page finds it, one click, Allow
    desk = desktop(path.join(tmp, "home-flow"), port);
    await until(() => /READY/.test(desk.out), 15000, () => "Morse Desktop's helper: " + desk.out);
    await until(() => welcome.locator("#use").isVisible(), 15000, "the one button");
    assert.equal(await text(welcome, "[data-view=ask] .head b"), "Found Morse Desktop on this computer");
    assert.match(await text(welcome, "#use"), /^Use /);
    await welcome.click("#use");
    await until(() => /ASK /.test(desk.out), 10000, "Morse Desktop to ask");
    const words = JSON.parse(/ASK (.*)/.exec(desk.out)[1]);
    assert.match(words.message, /^Allow Chrome to use your .+\?$/);
    assert.deepEqual([words.allow, words.deny], ["Allow", "Deny"]);
    assert.match(await text(welcome, "#connect .live"), /Morse Desktop is asking\. Click Allow there\./);
    // Deny connects nothing.
    desk.stdin.write("deny\n");
    await until(async () => /You chose Deny, so Chrome isn't connected/.test(await text(welcome, "#connect .live")), 10000, async () => "the Deny note: " + await welcome.locator("#connect").innerHTML() + desk.out);
    assert.equal(await sw.evaluate(async () => !!(await chrome.storage.local.get("helper")).helper), false);
    // Ask again; Allow connects, and the page moves on by itself.
    await sleep(500);
    await welcome.click("#use");
    await until(() => (desk.out.match(/ASK /g) || []).length === 2, 10000, "the second question");
    desk.stdin.write("allow\n");
    await until(async () => (await screenOf(welcome)) === "try", 15000, "the first change, after connecting");
    assert.equal(await sw.evaluate(async () => !!(await chrome.storage.local.get("helper")).helper?.token), true);
    assert.match(desk.out, /✓ Paired with Morse in Chrome/);
    assert.match(await text(welcome, "#practice-note"), /^This page uses /);

    // ---- the first change, step by step, then the win
    await firstChange(welcome);
    await until(() => sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}).length === 1), 10000, "the practice mod to be saved");
    await until(async () => (await screenOf(welcome)) === "win", 10000, "the win");
    assert.equal(await text(welcome, "#win-h"), "Your first mod is saved.");
    assert.match(await text(welcome, "#s-win .lede"), /A mod is a change you saved\. Morse brings it back every time you open that site or app\./);
    assert.deepEqual(await welcome.locator("[data-site] b").allTextContents(), ["Wikipedia", "Hacker News", "YouTube", "BBC News"]);
    assert.equal(await welcome.locator("#apps-h").count(), 0, "websites only: no desktop apps here");
    assert.doesNotMatch(await welcome.locator("body").innerText(), /Allow User Scripts/, "never asked for on the welcome page");

    // ---- a suggested site opens with Morse ready and the words typed
    await ctx.route(/^https:\/\/en\.wikipedia\.org\//, r => r.fulfill({ contentType: "text/html", body: ARTICLE }));
    await ctx.addInitScript(() => { try { localStorage.setItem("morse:debug", "1"); } catch {} });
    let opened = ctx.waitForEvent("page");
    await welcome.click("[data-site=wiki]");
    const wiki = await opened;
    await wiki.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 20000 * SCALE });
    await until(async () => (await siteBar(wiki).status()).open, 10000, "the bar, open by itself");
    await until(async () => (await siteBar(wiki).value()) === "make this easier to read", 5000, "the words, typed in");
    await wiki.close();

    // ---- or any address: a demo site, its first change saved, back after a reload, shared
    const { byte } = await demoSites();
    opened = ctx.waitForEvent("page");
    await welcome.locator("#site").fill(byte);
    await welcome.locator("#go-site button").click();
    const site = await opened;
    const b = siteBar(site);
    await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 20000 * SCALE });
    await until(async () => (await b.status()).open, 10000, "the bar, open by itself");
    const chips = await until(() => b.sr(".sugs"), 5000, "suggestions");
    assert.match(chips, /Hide the ads/, "this page has ads, so hiding them is offered");
    await site.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".sug")].find(x => x.textContent === "Hide the ads").click());
    await until(async () => (await b.status()).phase === "result", 30000, "the change");
    assert.equal(await site.evaluate(() => getComputedStyle(document.querySelector('[data-ad="leaderboard"]')).display), "none");
    await site.keyboard.press("Enter"); // Save
    await until(async () => !(await b.status()).open, 5000, "the bar to close on Save");
    await site.reload();
    await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
    await until(async () => (await b.status()).mods === 1, 8000, "the mod back after a reload");
    await site.keyboard.press("Alt+Shift+KeyM");
    await until(() => b.sr(".panel"), 5000, "the Mods panel");
    await site.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".panel button")].find(x => x.textContent.trim() === "Share").click());
    const link = await until(() => site.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".modal .link input")?.value), 8000, "the share link");
    assert.match(link, /^https:\/\/.*#m=/);
    assert.deepEqual(errors, []);
  } finally {
    await stop(desk);
    await ctx.close();
  }
});

test("without Morse Desktop: an Anthropic API key connects in one step; one that isn't says so", { skip: skipExt, timeout: 120000 }, async () => {
  const { ctx, welcome, errors } = await install("profile-key");
  try {
    await welcome.click("[data-want=web]");
    await until(() => welcome.locator("#key").isVisible(), 10000, "the API key field");
    await welcome.locator("#key").fill("hello");
    await welcome.locator("#save-key").click();
    await until(async () => /doesn't look like an Anthropic API key\. It starts with sk-ant-/.test(await text(welcome, "#keynote")), 5000, "the key note");
    await welcome.locator("#key").fill("sk-ant-api03-test-key");
    await welcome.locator("#key").press("Enter");
    await until(async () => /Connected/.test(await text(welcome, "#connect")), 8000, "connected");
    await until(async () => (await screenOf(welcome)) === "try", 8000, "on to the first change");
    assert.match(await text(welcome, "#practice-note"), /^This page uses /);
    // Desktop apps people see the API key only on request: Morse Desktop first.
    await welcome.click("[data-go=choose]");
    await welcome.click("[data-want=apps]");
    assert.equal(await screenOf(welcome), "try", "already connected: straight to the first change");
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("the terminal still works: morse setup --pair <code> connects by itself; a helper with its own code gets a code box", { skip: skipExt, timeout: 180000 }, async () => {
  const { ctx, welcome, port, errors } = await install("profile-terminal");
  let helper = null;
  try {
    await welcome.click("[data-want=both]");
    await until(() => welcome.locator("[data-view=desktop]").isVisible(), 10000, "Get Morse Desktop");
    assert.equal(await welcome.locator("#key").isVisible(), false, "for desktop apps, the API key waits behind a link");
    await welcome.locator("#term summary").click();
    const cmd = await text(welcome, "#setup-cmd");
    const m = /^morse setup --pair ([A-HJ-NP-Z2-9]{6})$/.exec(cmd);
    assert.ok(m, `one command with a pairing code: ${cmd}`);
    helper = run(["setup", "--use", "demo", "--pair", m[1]], { MORSE_HOME: path.join(tmp, "home-terminal") }, port);
    await until(() => /The Morse helper is running\. Go back to Chrome/.test(helper.out), 30000, () => "setup to start the helper: " + helper.out);
    await until(async () => (await screenOf(welcome)) === "try", 20000, "the page to connect by itself");
    assert.match(helper.out, /✓ Paired with Morse in Chrome/);
    await stop(helper);

    // A helper started with `morse serve` (no terminal to ask in) waits for its own code.
    await welcome.evaluate(() => chrome.runtime.sendMessage({ type: "popup.unpair" }));
    await welcome.click("[data-go=connect]");
    helper = run(["serve"], { MORSE_HOME: path.join(tmp, "home-serve"), MORSE_PROVIDER: "demo" }, port);
    const code = (await until(() => /pair\s+(?:\x1b\[[\d;]*m)*([A-Z0-9]{6})/.exec(helper.out), 15000, () => "morse serve's code: " + helper.out))[1];
    await until(() => welcome.locator("#code").isVisible(), 15000, "the code box");
    assert.match(await text(welcome, "[data-view=code]"), /Found the Morse helper on this computer.*Type the code it shows/s);
    await welcome.locator("#code").pressSequentially(code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ");
    await until(async () => /That code doesn't match\. Check the code the Morse helper shows and try again\./.test(await text(welcome, "#connect .live")), 8000, "the wrong-code note");
    await welcome.locator("#code").fill("");
    await welcome.locator("#code").pressSequentially(code.toLowerCase());
    await until(async () => (await screenOf(welcome)) === "try", 15000, "connected with the helper's own code");
    assert.deepEqual(errors, []);
  } finally {
    await stop(helper);
    await ctx.close();
  }
});

test("“Allow User Scripts” only when a change needs it: one switch, a picture of it, and back to the tab", { skip: skipExt, timeout: 180000 }, async () => {
  const { ctx, sw, id, welcome } = await install("profile-scripts");
  try {
    assert.equal(await sw.evaluate(() => { try { return !!chrome.userScripts?.execute; } catch { return false; } }), false, "this browser has “Allow User Scripts” off");
    // Not on the welcome page, at any step.
    for (const want of ["web"]) {
      await welcome.click(`[data-want=${want}]`);
      await sleep(600);
      assert.doesNotMatch(await welcome.locator("body").innerText(), /Allow User Scripts/);
    }
    await welcome.click("#skip");
    await sleep(600);
    assert.doesNotMatch(await welcome.locator("body").innerText(), /Allow User Scripts/);

    // Not on a site with nothing waiting for it: not in the bar, not in the popup.
    const { byte } = await demoSites();
    const site = await ctx.newPage();
    if (process.env.DEBUG_FR) site.on("console", m => console.log("site:", m.text()));
    await site.goto(byte);
    await site.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await site.reload();
    await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
    await site.keyboard.press(OPEN_KEY);
    await until(async () => (await siteBar(site).status()).open, 5000, "the bar");
    await sleep(500);
    assert.doesNotMatch(await site.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".bar")?.innerText || ""), /Allow User Scripts/);
    await site.keyboard.press("Escape");
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${id}/popup.html?url=${encodeURIComponent(byte)}`);
    await sleep(800);
    assert.equal(await pop.locator("#warn").isHidden(), true, "the popup says nothing about it");
    await pop.close();

    // A mod that adds a feature: now it comes up, with one button.
    const mod = createMod({ title: "Word count", prompt: "count words", url: byte, css: "h1 { outline: 3px solid rgb(1, 2, 3) !important; }", js: "document.documentElement.dataset.wordCount = 'ran';" });
    await sw.evaluate(mods => chrome.storage.local.set({ mods }), { [mod.id]: mod });
    await site.reload();
    await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
    await site.waitForFunction(() => getComputedStyle(document.querySelector("h1")).outlineColor === "rgb(1, 2, 3)");
    const button = site.locator("[data-morse-ui] button", { hasText: "Open Morse's details" });
    await button.waitFor({ timeout: 10000 * SCALE });
    const pages = [];
    ctx.on("page", p => pages.push(p));
    await button.click();
    const details = await until(() => pages.find(p => p.url().startsWith("chrome://extensions")), 10000, "Morse's details in Chrome");
    const guide = await until(() => pages.find(p => p.url().includes("/allow.html")), 10000, "the window with the picture");
    assert.equal(new URL(details.url()).searchParams.get("id"), id);
    await guide.waitForLoadState();
    assert.equal(await text(guide, "h1"), "Turn on one switch");
    assert.ok(await guide.evaluate(() => document.querySelector("img").naturalWidth > 0), "the picture of the switch loads");
    // One click on the switch: both close, and the mod's feature runs on the tab.
    await details.locator("#allow-user-scripts").click();
    await until(() => guide.isClosed() && details.isClosed(), 15000, "the window and the details tab to close");
    assert.equal(await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url), byte, "back on the tab the change was on");
    await until(() => site.evaluate(() => document.documentElement.dataset.wordCount === "ran"), 15000, "the waiting mod to run");
  } finally { await ctx.close(); }
});

// ---- progressive reveal and the first saved change, in the bar playground
let browser, bar;
before(async () => {
  if (skip) return;
  bar = await serveBar();
  try { browser = await chromium.launch({ channel: "chromium" }); } catch { browser = await chromium.launch(); }
});
after(async () => { await browser?.close(); await bar?.close(); });

async function playground(state, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  if (state) await ctx.addInitScript(s => { if (!localStorage.getItem("fake:onboarding")) localStorage.setItem("fake:onboarding", s); }, JSON.stringify(state));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(bar.url + "?onboarding");
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  await page.waitForTimeout(150);
  const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
  const seen = sel => page.evaluate(s => { const n = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s); return !!n && !n.hidden && n.getClientRects().length > 0; }, sel);
  const text = sel => page.evaluate(s => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s)?.innerText || "", sel);
  const open = async () => { await page.keyboard.press(OPEN_KEY); await until(async () => (await status()).open, 5000, "the bar"); await page.waitForTimeout(80); };
  const point = async sel => { const b = await page.locator(sel).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 3 }); await page.mouse.click(b.x + b.width / 2, b.y + 4); await page.waitForTimeout(120); };
  try { await fn({ page, status, seen, text, open, point }); assert.deepEqual(errors, []); }
  finally { await ctx.close(); }
}

test("progressive reveal: a new user's bar keeps to the basics until the first saved change", { skip, timeout: 60000 }, async () => {
  await playground(null, async ({ page, status, seen, text, open, point }) => {
    await open();
    assert.equal(await seen(".gm-qbtn"), false, "no Page tools button yet");
    assert.equal(await seen(".so-sug"), false, "no Show me once yet");
    assert.equal(await seen(".in"), true);
    assert.equal(await seen(".mic"), true, "talking is part of the basics");
    assert.equal(await seen(".sugs"), true, "suggestions for this page");
    await point("#toolbar");
    assert.equal(await seen(".gm"), false, "the Edit tools don't pop up on what you point at");
    assert.match(await text(".hint"), /for Edit tools/, "the hint says how to get them");
    // Their shortcut shows them.
    await page.keyboard.press("Control+KeyE");
    await until(() => seen(".gm"), 3000, "the Edit tools after Ctrl+E");
    await until(async () => (await status()).focus === "gm-tb", 3000, "focus on the Edit tools");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await until(async () => !(await status()).open, 3000, "the bar to close");

    // The first change the model makes and you save: everything shows up, once.
    await open();
    await point("#toolbar");
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await until(async () => (await status()).phase === "result", 10000, "the result");
    await page.keyboard.press("Enter"); // Save
    await until(() => seen(".ob-win"), 6000, "the first-save card");
    const card = await text(".ob-win");
    assert.match(card, /Your first mod is saved/);
    assert.match(card, /A mod is a change you saved\. Morse brings “Airier toolbar” back every time you open/);
    assert.match(card, /Now in your bar.*Page tools.*Edit tools.*Ask/is);
    assert.equal(await seen(".toast"), false, "the card takes the toast's place");
    // Share it opens the share card for that mod.
    await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector("[data-win=share]").click());
    await until(() => text(".modal"), 5000, "the share card");
    assert.match(await text(".modal"), /Share “Airier toolbar”/);
    await page.keyboard.press("Escape");
    await until(async () => !(await seen(".modal")), 3000, "the share card to close");

    await open();
    assert.equal(await seen(".gm-qbtn"), true, "Page tools now");
    await point("#toolbar");
    await until(() => seen(".gm"), 3000, "the Edit tools on what you point at");
    await page.keyboard.press("Escape");

    // Only the first time.
    await page.reload();
    await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
    await open();
    await point("#toolbar");
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await until(async () => (await status()).phase === "result", 10000, "the result");
    await page.keyboard.press("Enter");
    await until(() => seen(".toast"), 5000, "the usual toast");
    assert.equal(await seen(".ob-win"), false, "no card the second time");
  });
});

test("progressive reveal: people who already saved a mod, hid the tips or opened Help see everything", { skip, timeout: 60000 }, async () => {
  await playground({ coach: "done", tips: { saved: true } }, async ({ seen, open, point }) => {
    await open();
    assert.equal(await seen(".gm-qbtn"), true);
    await point("#toolbar");
    await until(() => seen(".gm"), 3000, "the Edit tools");
  });
  await playground(null, async ({ page, seen, open, status }) => {
    await open();
    assert.equal(await seen(".gm-qbtn"), false);
    await page.keyboard.press("F1");
    await until(async () => (await status()).pane === "help", 3000, "help");
    await page.keyboard.press("F1");
    assert.equal(await seen(".gm-qbtn"), true, "Help shows everything");
  });
  await playground(null, async ({ page, seen, open }) => {
    await open();
    await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ob-hide").click());
    await until(() => seen(".gm-qbtn"), 3000, "Page tools after Hide tips");
  });
});
