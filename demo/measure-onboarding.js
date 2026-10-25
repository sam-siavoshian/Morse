// Before and after (the one-app change, docs/dev/onboarding.md): a new
// person's first minutes, timed and counted, with fresh profiles, a fresh
// MORSE_HOME and the real `claude` CLI. Each run counts what the person does:
// clicks, keystrokes (a paste is Ctrl+V), decisions (a choice they have to
// make), and screens (each new surface they have to read: a page, a terminal,
// a dialog).
//
//   node scripts/build.js && DISPLAY=:99 node demo/measure-onboarding.js [--before <old checkout>] [--json out.json] [--only chrome|desktop]
//
// --before points at a checkout of the welcome page before the change (git
// archive of main before it, built with node scripts/build.js); without it
// only the new flows run. Flows:
//   before-chrome  onboarding v2: the question, Use Claude Code, Allow in Morse
//                  Desktop, then the first change on the practice page
//   after-chrome   the Morse app is open: the page asks by itself, one Allow,
//                  then the same first change
//   after-desktop  the Morse app for real (Electron) with Tunes: its first
//                  screen, Open with Morse, then a change in Tunes, saved
// Adding the extension to Chrome (Developer mode, Load unpacked) and
// downloading are Chrome's and the computer's own steps: counted on paper in
// docs/dev/onboarding.md, not here.
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

// ---- Chrome, with the Morse app open (tests/helpers/fake-desktop.js: the real
// helper, as the Morse app runs it), to the first saved change on the practice page.
// The Morse app is open; nothing set up yet: a fresh Morse folder.
async function withApp(name, ext, fn) {
  const port = await freePort();
  const desk = cli(path.join(root, "tests", "helpers", "fake-desktop.js"), [], { MORSE_HOME: path.join(tmp, `home-${name}`), MORSE_HELPER_PORT: String(port) });
  await until(() => /READY/.test(desk.out), 20000, "the Morse app's helper");
  const { ctx, sw, welcome } = await install(ext, name);
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), port);
  try { return await fn({ ctx, sw, welcome, desk }); } catch (e) { await failShot(); throw e; } finally { desk.kill(); await ctx.close(); }
}
const screenIs = (welcome, s) => welcome.evaluate(() => document.getElementById("app").dataset.screen).then(x => x === s);

// before: onboarding v2 (main before the one-app change): one question, then
// "Use Claude Code", then Allow in Morse Desktop.
async function beforeChrome() {
  const c = counter("before: Chrome, Morse Desktop open (onboarding v2)");
  return withApp("before-chrome", path.join(BEFORE, "dist", "extension"), async ({ sw, welcome, desk }) => {
    await welcome.reload();
    await sleep(800);
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
    await until(() => screenIs(welcome, "try"), 20000, "the first change");
    c.screen("try: three steps and the practice page");
    await practice(c, welcome, sw, "#open-bar");
    await until(() => screenIs(welcome, "win"), 10000, "the win");
    return c.result();
  });
}
// after: the welcome page finds the Morse app and asks by itself: one Allow.
async function afterChrome() {
  const c = counter("after: Chrome, the Morse app open");
  return withApp("after-chrome", path.join(root, "dist", "extension"), async ({ sw, welcome, desk }) => {
    c.t0 = Date.now();
    await welcome.reload();
    c.screen("connect: Found the Morse app, it is asking");
    await until(() => /ASK /.test(desk.out), 20000, "the Morse app to ask (by itself)");
    c.screen("the Morse app: Allow Chrome to use your Claude Code?");
    c.decide("Allow or Deny");
    c.clicks++; c.steps.push("click: Allow (in the Morse app)");
    desk.stdin.write("allow\n");
    await until(() => screenIs(welcome, "try"), 20000, "the first change");
    c.screen("try: three steps and the practice page");
    await practice(c, welcome, sw, "#open-bar");
    await until(() => screenIs(welcome, "win"), 10000, "the win");
    return c.result();
  });
}

// ---- the Morse app, for real (Electron), to the first saved change in a
// desktop app (Tunes, demo/electron-app): the first-run screen, Open with
// Morse, then the bar in Tunes with real keys (over Tunes' debugging port,
// MORSE_PIPE=0, so this script can type into it) and the real model.
async function afterDesktop() {
  const c = counter("after: the Morse app, to a saved change in a desktop app");
  const { createRequire: cr } = await import("node:module");
  const { _electron } = cr(import.meta.url)("playwright");
  const { electronExe, tunesApp } = await import("../tests/helpers/tunes.js");
  const { listProcesses } = await import("../daemon/apps.js");
  const { exe } = await tunesApp();
  const home = path.join(tmp, "home-desktop");
  const profile = path.join(tmp, "tunes-profile");
  const ROOTFLAG = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
  const { mkdirSync, writeFileSync: wf } = await import("node:fs");
  mkdirSync(home, { recursive: true });
  wf(path.join(home, "desktop.json"), JSON.stringify({ apps: [exe], appArgs: { tunes: [`--user-data-dir=${profile}`, ...ROOTFLAG] } }));
  const app = await _electron.launch({
    executablePath: electronExe, args: [path.join(root, "desktop-app"), ...ROOTFLAG], timeout: 60000,
    env: { ...process.env, MORSE_HOME: home, MORSE_DESKTOP_SCAN: "0", MORSE_HELPER_PORT: String(await freePort()), ELECTRON_RUN_AS_NODE: "", MORSE_PIPE: "0", MORSE_DEBUG: "1" },
  });
  try {
    c.t0 = Date.now();
    const w = await app.firstWindow();
    await w.waitForSelector("html[data-ready]", { timeout: 30000 });
    c.screen("the Morse app: Morse will use Claude Code, your apps, Use Morse in Chrome too");
    // It checks the model by itself; a person reads the screen meanwhile.
    await w.waitForFunction(() => /answered|didn't answer/.test(document.querySelector("#first-model")?.textContent || ""), null, { timeout: 120000 });
    c.model = (await w.locator("#first-model").innerText()).trim(); // "Morse will use Claude Code. It answered in …"
    c.decide("which app to open");
    await c.click(w, 'li[data-first-app="tunes"] button', "Open with Morse (Tunes)");
    const session = path.join(home, "sessions", "tunes.json");
    const port = await until(async () => { const s = JSON.parse((await import("node:fs")).readFileSync(session, "utf8")); return s.state === "attached" && s.windows?.length && s.port; }, 90000, "Tunes, connected");
    c.screen("Tunes, with Morse");
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith("app://tunes/"));
    await until(() => page.evaluate(() => !!document.querySelector("[data-morse-ui]")?.dataset.status), 30000, "Morse in Tunes");
    const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
    await c.press(page, process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space", "open Morse");
    await until(async () => (await status()).open, 10000, "the bar in Tunes");
    const h = await page.locator("h1, h2").first().boundingBox();
    c.clicks++; c.steps.push("click: the heading");
    await page.mouse.click(h.x + Math.min(40, h.width / 2), h.y + h.height / 2);
    await sleep(800);
    await c.type(page, "make this bigger", "the request");
    await c.press(page, "Enter", "send it");
    await until(async () => (await status()).phase === "result", 240000, "the change, ready to save");
    c.decide("keep the change?");
    await c.press(page, "Enter", "Save");
    await until(async () => !(await status()).open, 20000, "saved");
    await until(() => (async () => (await (await import("node:fs/promises")).readdir(path.join(home, "mods")).catch(() => [])).length > 0)(), 10000, "the mod on disk");
    const r = { ...c.result(), model: c.model, mod: (await (await import("node:fs/promises")).readdir(path.join(home, "mods"))).length };
    await browser.close().catch(() => {});
    return r;
  } catch (e) { throw e; } finally {
    const pid = app.process().pid;
    await Promise.race([app.close().catch(() => {}), sleep(10000)]);
    try { process.kill(pid, "SIGKILL"); } catch {}
    for (const p of listProcesses()) if (p.cmd.includes(tmp)) try { process.kill(p.pid, "SIGKILL"); } catch {}
  }
}

const results = [];
const only = arg("--only");
for (const [name, fn, needsBefore] of [["before-chrome", beforeChrome, true], ["after-chrome", afterChrome], ["after-desktop", afterDesktop]]) {
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
