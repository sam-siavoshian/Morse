// Before and after (onboarding v2, docs/dev/onboarding.md): a new person's
// first minutes, timed and counted, with a fresh Chrome profile, a fresh
// MORSE_HOME and the real `claude` CLI. Each run counts what the person does:
// clicks, keystrokes (a paste is Ctrl+V), decisions (a choice they have to
// make), and screens (each new surface they have to read: a page, a terminal,
// a dialog).
//
//   node scripts/build.js && DISPLAY=:99 node demo/measure-onboarding.js [--before <old checkout>] [--json out.json]
//
// --before points at a checkout of the old welcome page (git archive of the
// commit before onboarding v2, built with node scripts/build.js); without it
// only the new flows run. Flows:
//   claude   Chrome + Claude Code, to the first saved change on the practice page
//            before: `morse setup --pair <code>` in a terminal; after: Morse
//            Desktop is open (tests/helpers/fake-desktop.js, the real helper) and
//            asks Allow
//   key      Chrome with an Anthropic API key, to "connected" (no real key here,
//            so no change is made with it)
// Human time is an estimate on top of the measured time (the model, the app):
// keystroke-level model operators, listed in HUMAN below.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { freePort } from "../tests/helpers/net.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ""; };
const BEFORE = arg("--before");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = mkdtempSync(path.join(os.tmpdir(), "morse-measure-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

// Keystroke-level model (Card, Moran and Newell): seconds per operator.
export const HUMAN = { click: 1.1, key: 0.28, decision: 1.35, screen: 3.0, terminal: 2.0, install: 30 };

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); }
  throw new Error("timed out waiting for " + what);
}
function cli(file, args, env) {
  const p = spawn(process.execPath, [file, ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  p.out = "";
  p.stdout.on("data", d => (p.out += d)); p.stderr.on("data", d => (p.out += d));
  return p;
}

function counter(name) {
  const c = { name, clicks: 0, keys: 0, decisions: [], screens: [], steps: [], extra: 0, t0: 0 };
  c.click = async (page, sel, what) => { c.clicks++; c.steps.push(`click: ${what}`); await page.click(sel); };
  c.type = async (page, text, what) => { c.keys += text.length; c.steps.push(`type: ${what}`); await page.keyboard.type(text); };
  c.press = async (page, key, what) => { c.keys += key.split("+").length > 1 ? 2 : 1; c.steps.push(`key: ${what}`); await page.keyboard.press(key); };
  c.decide = what => { c.decisions.push(what); c.steps.push(`decide: ${what}`); };
  c.screen = what => { c.screens.push(what); c.steps.push(`screen: ${what}`); };
  c.offline = (what, { keys = 0, clicks = 0, seconds = 0 } = {}) => { c.keys += keys; c.clicks += clicks; c.extra += seconds; c.steps.push(`outside Chrome: ${what}`); };
  c.result = () => {
    const ms = Date.now() - c.t0;
    const human = c.clicks * HUMAN.click + c.keys * HUMAN.key + c.decisions.length * HUMAN.decision + c.screens.length * HUMAN.screen + c.extra;
    return { flow: c.name, measuredSeconds: +(ms / 1000).toFixed(1), estimatedSeconds: +(ms / 1000 + human).toFixed(1), clicks: c.clicks, keystrokes: c.keys, decisions: c.decisions.length, screens: c.screens.length, steps: c.steps };
  };
  return c;
}

async function install(ext, name) {
  const ctx = await chromium.launchPersistentContext(path.join(tmp, name), {
    headless: false, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const port = await freePort();
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), port);
  const welcome = await until(() => ctx.pages().find(p => p.url().includes("/welcome.html")), 20000, "the welcome page");
  await welcome.reload();
  await welcome.waitForLoadState();
  await sleep(800);
  lastPage = welcome;
  return { ctx, sw, welcome, port };
}
let lastPage = null; // for a picture when a flow fails (--shots <dir>)
const failShot = () => arg("--shots") && lastPage?.screenshot({ path: path.join(arg("--shots"), `measure-failed-${Date.now()}.png`) }).catch(() => {});
const modsSaved = sw => sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}).length > 0);

// The practice frame is sandboxed: its bar's shadow root stays closed. DevTools can read it.
async function closedText(frame, cls) {
  const cdp = await frame.page().context().newCDPSession(frame);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const kids = n => [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])];
    const text = n => (n.nodeType === 3 ? n.nodeValue : "") + kids(n).map(text).join("");
    const find = n => (n.attributes?.includes("class") && n.attributes[n.attributes.indexOf("class") + 1].split(" ").includes(cls) ? n : kids(n).map(find).find(Boolean) || null);
    const hit = find(root);
    return hit ? text(hit) : null;
  } catch (e) { await failShot(); throw e; } finally { await cdp.detach().catch(() => {}); }
}

// The practice change: open, point at the article, ask, Save (the same in both).
async function practice(c, welcome, sw, openSel) {
  const frame = await until(() => welcome.frames().find(f => f.url().includes("practice.html")), 30000, "the practice frame");
  await c.click(welcome, openSel, "open Morse on the practice page");
  await until(async () => (await closedText(frame, "in")) !== null && /Point|Describe/.test(await closedText(frame, "bar") || ""), 15000, "the practice bar to open");
  let p = null; // where the article is once the page stops scrolling
  await until(async () => { const b = await frame.locator("article p").first().boundingBox(); const same = p && b.y === p.y; p = b; await sleep(250); return same; }, 10000, "the practice area to settle");
  c.clicks++; c.steps.push("click: the article");
  await welcome.mouse.click(p.x + 120, p.y + 6);
  await sleep(800); // a person reads the chip before typing
  await c.type(welcome, "make this easier to read", "the request");
  await c.press(welcome, "Enter", "send it");
  await until(async () => /Save/.test(await closedText(frame, "actions") || ""), 240000, "the change, ready to save");
  await sleep(1000);
  c.decide("keep the change?");
  await c.press(welcome, "Enter", "Save");
  await until(() => modsSaved(sw), 20000, "the saved mod");
}

// ---- before: the welcome page's checklist and `morse setup --pair <code>`
async function beforeClaude() {
  const c = counter("before: Chrome + Claude Code");
  const { ctx, sw, welcome, port } = await install(path.join(BEFORE, "dist", "extension"), "before-claude");
  let helper;
  try {
    c.t0 = Date.now();
    c.screen("welcome page: practice area and a 4-step checklist");
    c.decide("which way to connect: the command, an API key, or later");
    const cmd = (await welcome.locator("#setup-cmd").textContent()).trim();
    await c.click(welcome, "#copy-setup", "Copy the command");
    c.screen("a terminal");
    c.offline("open a terminal", { seconds: HUMAN.terminal });
    c.offline("npm i -g morse-cli, Enter", { keys: "npm i -g morse-cli".length + 1, seconds: HUMAN.install });
    c.offline("paste the command, Enter", { keys: 3 });
    helper = cli(path.join(BEFORE, "daemon", "cli.js"), cmd.split(" ").slice(1), { MORSE_HOME: path.join(tmp, "home-before"), MORSE_HELPER_PORT: String(port) });
    c.decide("which model: Claude Code, Codex or an API key");
    c.offline("Enter (the recommended choice)", { keys: 1 });
    helper.stdin.write("1\n");
    c.decide("Automatic, always fast or always best (asked in a real terminal)");
    c.offline("Enter (Automatic)", { keys: 1 });
    await until(() => /The Morse helper is running/.test(helper.out), 120000, "setup to check Claude Code and start the helper");
    c.screen("back to Chrome");
    await until(() => welcome.evaluate(() => document.querySelector('[data-step="model"]').classList.contains("done")), 30000, "the page to pair");
    c.decide("do the other checklist steps now (Allow User Scripts, pin)?");
    await practice(c, welcome, sw, "#try");
    return c.result();
  } catch (e) { await failShot(); throw e; } finally { helper?.kill(); await ctx.close(); }
}
async function beforeKey() {
  const c = counter("before: Chrome + an API key");
  const { ctx, welcome } = await install(path.join(BEFORE, "dist", "extension"), "before-key");
  try {
    c.t0 = Date.now();
    c.screen("welcome page: practice area and a 4-step checklist");
    c.decide("which way to connect: the command, an API key, or later");
    await c.click(welcome, "#alt summary", "Use an Anthropic API key instead");
    c.offline("copy the key from console.anthropic.com", { seconds: 0 });
    await welcome.locator("#key").fill("sk-ant-api03-measure-only");
    c.keys += 2; c.steps.push("key: paste the key");
    await c.click(welcome, "#save-key", "Save key");
    await until(() => welcome.evaluate(() => document.querySelector('[data-step="model"]').classList.contains("done")), 10000, "connected");
    c.decide("do the other checklist steps now (Allow User Scripts, pin)?");
    return c.result();
  } catch (e) { await failShot(); throw e; } finally { await ctx.close(); }
}

// ---- after: one question, then one button that Morse Desktop asks to Allow
async function afterClaude() {
  const c = counter("after: Chrome + Claude Code (Morse Desktop)");
  const port = await freePort();
  // Morse Desktop is open (it runs the helper); nothing set up yet: a fresh Morse folder.
  const desk = cli(path.join(root, "tests", "helpers", "fake-desktop.js"), [], { MORSE_HOME: path.join(tmp, "home-after"), MORSE_HELPER_PORT: String(port) });
  await until(() => /READY/.test(desk.out), 20000, "Morse Desktop's helper");
  const { ctx, sw, welcome } = await install(path.join(root, "dist", "extension"), "after-claude");
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), port);
  await welcome.reload();
  await sleep(800);
  try {
    c.t0 = Date.now();
    c.screen("welcome: one question");
    c.decide("websites, desktop apps or both");
    await c.click(welcome, "[data-want=web]", "Websites");
    c.screen("connect: Morse Desktop found, with Claude Code");
    await until(() => welcome.locator("#use").isVisible(), 20000, "the one button");
    await c.click(welcome, "#use", (await welcome.locator("#use").textContent()).trim());
    await until(() => /ASK /.test(desk.out), 20000, "Morse Desktop to ask");
    c.screen("Morse Desktop: Allow Chrome to use your Claude Code?");
    c.decide("Allow or Deny");
    c.clicks++; c.steps.push("click: Allow (in Morse Desktop)");
    desk.stdin.write("allow\n");
    await until(async () => (await welcome.evaluate(() => document.getElementById("app").dataset.screen)) === "try", 20000, "the first change");
    c.screen("try: three steps and the practice page");
    await practice(c, welcome, sw, "#open-bar");
    await until(async () => (await welcome.evaluate(() => document.getElementById("app").dataset.screen)) === "win", 10000, "the win");
    return c.result();
  } catch (e) { await failShot(); throw e; } finally { desk.kill(); await ctx.close(); }
}
async function afterKey() {
  const c = counter("after: Chrome + an API key");
  const { ctx, welcome } = await install(path.join(root, "dist", "extension"), "after-key");
  try {
    c.t0 = Date.now();
    c.screen("welcome: one question");
    c.decide("websites, desktop apps or both");
    await c.click(welcome, "[data-want=web]", "Websites");
    c.screen("connect: Get Morse Desktop, or an API key");
    c.decide("Morse Desktop or an API key");
    await welcome.locator("#key").fill("sk-ant-api03-measure-only");
    c.keys += 2; c.steps.push("key: paste the key");
    await c.press(welcome, "Enter", "connect");
    await until(async () => (await welcome.evaluate(() => document.getElementById("app").dataset.screen)) === "try", 10000, "connected");
    return c.result();
  } catch (e) { await failShot(); throw e; } finally { await ctx.close(); }
}

const results = [];
const only = arg("--only");
for (const [name, fn, needsBefore] of [["before-key", beforeKey, true], ["after-key", afterKey], ["before-claude", beforeClaude, true], ["after-claude", afterClaude]]) {
  if ((needsBefore && !BEFORE) || (only && !name.includes(only))) continue;
  try { const r = await fn(); results.push(r); console.log(JSON.stringify(r)); }
  catch (e) {
    console.error(name, "failed:", e.message);
    results.push({ flow: name, error: e.message });
  }
}
const out = arg("--json");
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), human: HUMAN, results }, null, 2));
console.table(results.map(({ steps, ...r }) => r));
process.exit(0);
