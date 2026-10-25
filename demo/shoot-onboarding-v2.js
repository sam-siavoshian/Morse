// Screenshots of the welcome page in Chrome (docs/getting-started.md), on a
// desktop window (1280×860) and a phone-width one (390×844):
//   190/191  download        no Morse app on this computer: Download Morse
//   194/195  asking          the Morse app is open: it asks you to Allow, nothing to click here
//   198/199  try             the first change, three steps
//   200/201  try-change      the change on the practice page, ready to save
//   202/203  win             the first mod is saved; a real site next
//   204      allow-window    “Allow User Scripts”, only when a change needs it
//   205      first-site      a suggested site opens with Morse ready and the words typed
//   206      popup-app       the toolbar popup: no Morse app yet, Download Morse
// The real extension (headful, so under Xvfb), the Morse app's helper
// (tests/helpers/fake-desktop.js: the real helper, as the Morse app runs it)
// and the real `claude` CLI, with a fresh Morse folder each time.
//
//   node scripts/build.js && DISPLAY=:99 node demo/shoot-onboarding-v2.js [outDir]   (ONLY=desktop or ONLY=phone)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { serveDemo } from "./serve.js";
import { freePort } from "../tests/helpers/net.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.argv[2] || path.join("docs", "screenshots"));
const EXT = path.join(root, "dist", "extension");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-onboarding-shots-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
process.on("exit", () => procs.forEach(p => { try { p.kill(); } catch {} }));
async function until(fn, ms = 30000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); }
  throw new Error("timed out waiting for " + what);
}
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: path.join(OUT, name), ...opts }); console.log("  saved", name); };
const screenOf = page => page.evaluate(() => document.getElementById("app").dataset.screen);
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
  } finally { await cdp.detach().catch(() => {}); }
}
const demo = await serveDemo();
const WIKI = `${demo.origin("wiki")}/demo/sites/wiki/`;

async function run({ width, height, scale, n, suffix, full }) {
  const port = await freePort();
  const ctx = await chromium.launchPersistentContext(path.join(tmp, `profile${suffix}`), {
    headless: false, viewport: { width, height }, deviceScaleFactor: scale,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), port);
  const welcome = await until(() => ctx.pages().find(p => p.url().includes("/welcome.html")), 30000, "the welcome page");
  await welcome.reload();
  await welcome.bringToFront();
  await welcome.addStyleTag({ content: "html { scrollbar-width: none; }" }).catch(() => {}); // the picture is the page, not Chrome's scrollbar
  await welcome.mouse.move(width - 2, height - 2);
  const name = (i, what) => `${n + i * 2}-start-${what}${suffix}.png`;
  const opts = { fullPage: full };

  // No Morse app yet: one button, Download Morse.
  await until(() => welcome.locator("#download").isVisible(), 15000, "Download Morse");
  await sleep(600);
  await shot(welcome, name(0, "download"), opts);
  if (!suffix) {
    // The toolbar popup says the same.
    const pop = await ctx.newPage();
    await pop.setViewportSize({ width: 348, height: 600 });
    await pop.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?url=${encodeURIComponent(WIKI)}`);
    await sleep(1000);
    await pop.locator("#model").scrollIntoViewIfNeeded();
    await shot(pop, "206-popup-app.png");
    await pop.close();
    await welcome.bringToFront();
  }

  // The Morse app opens, with Claude Code found on this computer: the page asks by itself.
  const desk = spawn(process.execPath, [path.join(root, "tests", "helpers", "fake-desktop.js")], { env: { ...process.env, MORSE_HOME: path.join(tmp, `home${suffix}`), MORSE_HELPER_PORT: String(port), MORSE_PROVIDER: "" }, stdio: ["pipe", "pipe", "inherit"] });
  procs.push(desk);
  desk.out = ""; desk.stdout.on("data", d => (desk.out += d));
  await until(() => /ASK /.test(desk.out), 30000, "the Morse app to ask");
  await sleep(2500); // signed in? (checked in the background)
  await shot(welcome, name(2, "asking"), opts);
  desk.stdin.write("allow\n");
  await until(async () => (await screenOf(welcome)) === "try", 20000, "the first change");
  const frame = await until(() => welcome.frames().find(f => f.url().includes("practice.html")), 30000, "the practice frame");
  await sleep(1500);
  await shot(welcome, name(4, "try"), opts);

  // The first change, with Claude Code.
  await welcome.click("#open-bar");
  await until(async () => /Point|Describe/.test(await closedText(frame, "bar") || ""), 15000, "the practice bar");
  let p = null;
  await until(async () => { const b = await frame.locator("article p").first().boundingBox(); const same = p && b.y === p.y; p = b; await sleep(250); return same; }, 8000, "the practice area to settle");
  await welcome.mouse.click(p.x + Math.min(120, p.width / 2), p.y + 6);
  await sleep(800);
  await welcome.keyboard.type("make this easier to read");
  await welcome.keyboard.press("Enter");
  await until(async () => /Save/.test(await closedText(frame, "actions") || ""), 240000, "the change, ready to save");
  await sleep(2500);
  await shot(welcome, name(5, "try-change"), opts);
  await welcome.keyboard.press("Enter"); // Save
  await until(async () => (await screenOf(welcome)) === "win", 20000, "the win");
  await sleep(900);
  await shot(welcome, name(6, "win"), opts);

  if (!suffix) {
    // “Allow User Scripts”: the small window, as Chrome shows it beside Morse's details.
    const allow = await ctx.newPage();
    await allow.setViewportSize({ width: 360, height: 440 });
    await allow.goto(`chrome-extension://${new URL(sw.url()).host}/allow.html`);
    await sleep(800);
    await shot(allow, "204-start-allow-window.png");
    await allow.close();
    // A suggested site, with Morse ready and the words typed.
    const html = (await (await fetch(WIKI)).text()).replace("<head>", `<head><base href="${WIKI}">`);
    await ctx.route(/^https:\/\/en\.wikipedia\.org\//, r => r.fulfill({ contentType: "text/html", body: html }));
    const opened = ctx.waitForEvent("page");
    await welcome.click("[data-site=wiki]");
    const site = await opened;
    await site.waitForLoadState();
    await sleep(3500);
    await shot(site, "205-start-first-site.png");
  }
  desk.kill();
  await ctx.close();
}

const ONLY = process.env.ONLY || "";
if (ONLY !== "phone") await run({ width: 1280, height: 860, scale: 1, n: 190, suffix: "", full: false });
if (ONLY !== "desktop") await run({ width: 390, height: 844, scale: 2, n: 191, suffix: "-phone", full: true });
await demo.close();
await fs.rm(tmp, { recursive: true, force: true });
process.exit(0);
