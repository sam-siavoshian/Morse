// The first five minutes, end to end, as a new user: a fresh Chrome profile
// with the built extension (dist/extension) and a fresh MORSE_HOME.
//   - install opens the welcome page, and only that
//   - the practice page works before any model is connected (sample answers)
//   - "Connect a model" is one command: `morse setup --pair <code>` starts the
//     Morse helper (here with the demo model) and the page pairs by itself
//   - a demo site suggests changes for that page; the first one is saved,
//     comes back after a reload, and can be shared
//   - the welcome page's error states say what to do (a helper waiting for
//     another code, a wrong code, a key that isn't one)
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
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { serveBar } from "../demo/bar-server.js";
import { freePort } from "./helpers/net.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const CLI = path.join(root, "daemon", "cli.js");
const skip = !chromium && "playwright not installed";
const skipExt = skip || (!process.env.DISPLAY && "extensions need a display (run under Xvfb)") || (!existsSync(EXT) && "run node scripts/build.js first");
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = tempDir("morse-first-run-");
after(() => rmSync(tmp, { recursive: true, force: true }));

async function until(fn, ms = 20000, what = "condition") {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}
const portFree = port => new Promise(r => { const s = net.createServer().once("error", () => r(false)).listen(port, "127.0.0.1", () => s.close(() => r(true))); });

// `morse`, with its Morse helper on `port` (MORSE_HELPER_PORT).
function run(args, env = {}, port) {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, MORSE_HELPER_PORT: String(port), ...env }, stdio: ["pipe", "pipe", "pipe"] });
  p.out = "";
  p.stdout.on("data", d => (p.out += d));
  p.stderr.on("data", d => (p.out += d));
  p.done = new Promise(r => p.on("exit", r));
  return p;
}
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
  return { ctx, sw, id, welcome, port };
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
const stepDone = (page, step) => page.evaluate(s => document.querySelector(`[data-step="${s}"]`).classList.contains("done"), step);

// The demo sites, each on its own origin like real sites.
let sites = null;
async function demoSites() {
  if (sites) return sites;
  const base = 21000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [path.join(root, "demo/serve.js")], { env: { ...process.env, MORSE_DEMO_PORT: String(base) }, stdio: "ignore" });
  await until(async () => !(await portFree(base + 1)), 10000, "the demo sites");
  sites = { byte: `http://127.0.0.1:${base + 1}/demo/sites/byte/`, stop: () => p.kill() };
  return sites;
}
after(() => sites?.stop());

test("first run in Chrome: welcome only, try it with no model, connect in one command, first saved change on a site, reload, share", { skip: skipExt, timeout: 240000 }, async () => {
  const { ctx, sw, id, welcome, port } = await install("profile-flow");
  let helper = null;
  try {
    // Install opens the welcome page, not the settings page too.
    await sleep(800);
    assert.deepEqual(ctx.pages().map(p => p.url()).filter(u => u.startsWith("chrome-extension://")), [`chrome-extension://${id}/welcome.html`]);

    // ---- the practice page, before any model is connected
    await until(() => welcome.frames().find(f => f.url().includes("practice.html")), 30000, "the practice frame");
    const practice = welcome.frames().find(f => f.url().includes("practice.html"));
    assert.match(await welcome.locator("#practice-note").textContent(), /sample answers/);
    await welcome.click("#try");
    await sleep(600);
    const p = await practice.locator("article p").first().boundingBox();
    await welcome.mouse.click(p.x + 120, p.y + 6);
    await sleep(200);
    await welcome.keyboard.type("make this easier to read");
    await welcome.keyboard.press("Enter");
    // The sample answer runs: the sponsored box goes, the article gets a reading font.
    await until(() => practice.evaluate(() => getComputedStyle(document.querySelector('aside[aria-label="Sponsored"]')).display === "none"), 20000, "the sample change on the practice page");
    await until(async () => /Save/.test(await closedText(practice, "actions") || ""), 20000, "Save in the practice bar");
    await welcome.keyboard.press("Enter"); // Save
    await until(() => sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}).length === 1), 10000, "the practice mod to be saved");
    await until(async () => /Your first mod is saved/.test(await closedText(practice, "ob-win") || ""), 8000, "the first-save card");
    await until(() => stepDone(welcome, "first"), 8000, "“Make your first change” to tick");
    assert.equal(await stepDone(welcome, "model"), false);

    // ---- connect a model: the welcome page's one command
    const cmd = await welcome.locator("#setup-cmd").textContent();
    const m = /^morse setup --pair ([A-HJ-NP-Z2-9]{6})$/.exec(cmd);
    assert.ok(m, `one command with a pairing code: ${cmd}`);
    assert.match(await welcome.locator("#live").textContent(), /Waiting for you to run the command/);
    const home = path.join(tmp, "home-flow");
    helper = run(["setup", "--use", "demo", "--pair", m[1]], { MORSE_HOME: home }, port);
    await until(() => /The Morse helper is running\. Go back to Chrome/.test(helper.out), 30000, () => "setup to start the helper: " + helper.out);
    await until(() => stepDone(welcome, "model"), 20000, "the welcome page to pair by itself");
    assert.match(await welcome.locator("#model-label").textContent(), /^Using /);
    assert.match(helper.out, /✓ Paired with Morse in Chrome/);
    assert.doesNotMatch(await welcome.locator("#practice-note").textContent(), /sample answers/);

    // The settings page no longer says this page can't be changed.
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    await sleep(800);
    assert.equal(await opts.locator(".ps").count(), 0, "no page notice on the settings page");
    await opts.close();

    // ---- a real-looking site: suggestions for this page, the first one works
    const { byte } = await demoSites();
    const site = await ctx.newPage();
    await site.goto(byte);
    await site.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await site.reload();
    await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
    const status = () => site.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
    const sr = sel => site.evaluate(s => { const n = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s); return n && !n.hidden && n.getClientRects().length ? n.innerText : null; }, sel);
    await site.keyboard.press(OPEN_KEY);
    await until(async () => (await status()).open, 5000, "the bar");
    const chips = await until(() => sr(".sugs"), 5000, "suggestions");
    assert.match(chips, /Hide the ads/, "this page has ads, so hiding them is offered");
    assert.match(chips, /Easier to read/, "and it's a long read");
    await site.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".sug")].find(b => b.textContent === "Hide the ads").click());
    await until(async () => (await status()).phase === "result", 30000, "the change");
    assert.equal(await site.evaluate(() => getComputedStyle(document.querySelector('[data-ad="leaderboard"]')).display), "none");
    await site.keyboard.press("Enter"); // Save
    await until(async () => !(await status()).open, 5000, "the bar to close on Save");
    await site.reload();
    await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
    await until(async () => (await status()).mods === 1, 8000, "the mod back after a reload");
    await until(() => site.evaluate(() => getComputedStyle(document.querySelector('[data-ad="leaderboard"]')).display === "none"), 8000, "the ads hidden again");

    // ---- share it from the Mods panel
    await site.keyboard.press("Alt+Shift+KeyM");
    await until(() => sr(".panel"), 5000, "the Mods panel");
    await site.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".panel button")].find(b => b.textContent.trim() === "Share").click());
    const link = await until(() => site.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".modal .link input")?.value), 8000, "the share link");
    assert.match(link, /^https:\/\/.*#m=/);
  } finally {
    await stop(helper);
    await ctx.close();
  }
});

test("welcome page errors say what to do: another code waiting, a wrong code, a key that isn't one", { skip: skipExt, timeout: 120000 }, async () => {
  const { ctx, welcome, port } = await install("profile-errors");
  let helper = null;
  try {
    // A key that isn't an Anthropic key.
    await welcome.locator("#alt summary").click();
    await welcome.locator("#key").fill("hello");
    await welcome.locator("#save-key").click();
    await until(async () => /doesn't look like an Anthropic API key\. It starts with sk-ant-/.test(await welcome.locator("#keynote").textContent()), 5000, "the key note");
    await welcome.locator("#key").fill("");

    // A helper started with `morse serve` waits for its own code, not ours.
    helper = run(["serve"], { MORSE_HOME: path.join(tmp, "home-errors"), MORSE_PROVIDER: "demo" }, port);
    const code = (await until(() => /pair\s+(?:\x1b\[[\d;]*m)*([A-Z0-9]{6})/.exec(helper.out), 15000, () => "morse serve's code: " + helper.out))[1];
    await until(async () => !(await welcome.locator("#pairrow").isHidden()), 15000, "the code box");
    assert.match(await welcome.locator("#live").textContent(), /waiting for a different code\. Type the code it shows/);
    // A wrong code, then the right one (typing six characters connects).
    await welcome.locator("#code").fill("");
    await welcome.locator("#code").pressSequentially(code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ");
    await until(async () => /That code doesn't match\. Check the code the Morse helper shows and try again\./.test(await welcome.locator("#live").textContent()), 8000, "the wrong-code note");
    await welcome.locator("#code").fill("");
    await welcome.locator("#code").pressSequentially(code.toLowerCase());
    await until(() => stepDone(welcome, "model"), 10000, "connected with the helper's own code");
  } finally {
    await stop(helper);
    await ctx.close();
  }
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
