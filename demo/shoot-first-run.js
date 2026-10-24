// Screenshots of the first five minutes, as a new user sees them:
//   135-welcome               the welcome page: one command connects a model
//   136-practice-sample       the practice page before any model: suggestions, sample answers
//   137-practice-first-save   the first saved change: a card instead of the toast
//   138-setup-pair            the terminal: `morse setup --pair <code>` (check, helper, paired)
//   139-welcome-connected     the welcome page paired by itself
//   140-welcome-errors        a helper waiting for another code, a wrong code; a key that isn't one
//   141-site-new-bar          a new user's bar on a news site: three changes for this page, no extras yet
//   142-site-pointed          pointing: no Edit tools popping up, the hint says how to get them
//   143-site-first-save       the first saved change on a site (the ads are gone)
//   144-site-revealed         the bar after that: Page tools and the Edit tools are there now
//   145-desktop-launch        `morse launch` says what to press once it's connected
//   146-desktop-first-save    a desktop app: the first saved change
// The real extension (headful, so under Xvfb) and the real Morse helper with
// the demo model, so it comes out the same every time.
//
//   node scripts/build.js && DISPLAY=:99 node demo/shoot-first-run.js [outDir]   (ONLY=web or ONLY=desktop: one half)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.argv[2] || path.join(root, "docs", "screenshots");
const EXT = path.join(root, "dist", "extension");
const CLI = path.join(root, "daemon", "cli.js");
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-first-run-shots-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const saved = name => console.log("  📸", name);
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: path.join(OUT, name), ...opts }); saved(name); };
const procs = [];
process.on("exit", () => procs.forEach(p => { try { p.kill(); } catch {} }));
const plain = s => s.replace(/\x1b\[[\d;]*m/g, "");
async function until(fn, ms = 20000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); }
  throw new Error("timed out waiting for " + what);
}
const portFree = port => new Promise(r => { const s = net.createServer().once("error", () => r(false)).listen(port, "127.0.0.1", () => s.close(() => r(true))); });
// A fresh home, so paths print as ~/.morse
function cli(args, { home, env = {} }) {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, HOME: home, MORSE_HOME: "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
  p.out = "";
  p.stdout.on("data", d => (p.out += d)); p.stderr.on("data", d => (p.out += d));
  procs.push(p);
  return p;
}
async function terminal(log, file, title) {
  const src = path.join(tmp, file + ".log");
  await fs.writeFile(src, log);
  execFileSync(process.execPath, [path.join(root, "demo", "terminal.js"), src, path.join(OUT, file), title], { stdio: "inherit" });
  saved(file);
}

// demo sites on their own ports
const BASE = 22000 + Math.floor(Math.random() * 20000);
procs.push(spawn(process.execPath, [path.join(root, "demo/serve.js")], { env: { ...process.env, MORSE_DEMO_PORT: String(BASE) }, stdio: "ignore" }));
await until(async () => !(await portFree(BASE + 1)), 10000, "demo sites");
const BYTE = `http://127.0.0.1:${BASE + 1}/demo/sites/byte/`, TUNES = `http://127.0.0.1:${BASE + 2}/demo/sites/tunes/`;

async function install(name) {
  const ctx = await chromium.launchPersistentContext(path.join(tmp, name), {
    headless: false, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const welcome = await until(() => ctx.pages().find(p => p.url().includes("/welcome.html")), 15000, "welcome page");
  await welcome.waitForLoadState();
  await welcome.bringToFront();
  return { ctx, sw, id, welcome };
}
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
const done = (page, step) => page.evaluate(s => document.querySelector(`[data-step="${s}"]`).classList.contains("done"), step);
async function allowUserScripts(ctx, id) {
  const p = await ctx.newPage();
  await p.goto(`chrome://extensions/?id=${id}`);
  await p.locator("#allow-user-scripts").click();
  await sleep(300);
  await p.close();
}

const ONLY = process.env.ONLY || ""; // "web" or "desktop": shoot one half

// ---- 135-138: the welcome page, the practice page, the command
if (ONLY !== "desktop") {
  await until(() => portFree(7457), 120000, "the helper's port (no helper running yet)");
  const { ctx, welcome } = await install("profile-a");
  await sleep(1500);
  await shot(welcome, "135-welcome.png");

  const practice = welcome.frames().find(f => f.url().includes("practice.html"));
  await welcome.click("#try");
  await sleep(700);
  await welcome.mouse.move(640, 300);
  await sleep(300);
  await shot(welcome, "136-practice-sample.png");
  // The suggestions are keyboard reachable: Tab, then the second ("Easier to read").
  await welcome.keyboard.press("Tab");
  await welcome.keyboard.press("ArrowRight");
  await welcome.keyboard.press("Enter");
  await until(() => practice.evaluate(() => getComputedStyle(document.querySelector('aside[aria-label="Sponsored"]')).display === "none"), 20000, "the sample change");
  await until(async () => /Save/.test(await closedText(practice, "actions") || ""), 30000, "Save in the practice bar");
  await welcome.keyboard.press("Enter"); // Save
  await sleep(1800);
  await shot(welcome, "137-practice-first-save.png");
  await welcome.keyboard.press("Escape");

  // The command, run the way the page says (the demo model stands in for Claude Code).
  const cmd = await welcome.locator("#setup-cmd").textContent();
  const code = cmd.split(" ").pop();
  await welcome.click("#copy-setup");
  await until(() => portFree(7457), 60000, "the helper's port");
  const home = path.join(tmp, "home-a");
  await fs.mkdir(home, { recursive: true });
  // Real Claude Code when it's installed (Enter takes the recommendation; haiku keeps the check short).
  await fs.mkdir(path.join(home, ".morse"), { recursive: true });
  await fs.writeFile(path.join(home, ".morse", "config.json"), JSON.stringify({ models: { "claude-code": "haiku" } }));
  const setup = cli(["setup", "--pair", code], { home });
  setup.stdin.write("\n");
  await until(() => done(welcome, "model"), 40000, "pairing");
  await sleep(600);
  await welcome.evaluate(() => scrollTo(0, 0));
  await shot(welcome, "139-welcome-connected.png");
  await terminal(`\x1b[2m$\x1b[0m ${cmd}\n${setup.out}`, "138-setup-pair.png", cmd);
  setup.kill();
  await ctx.close();
}

// ---- 140: error states on the welcome page
if (ONLY !== "desktop") {
  const { ctx, welcome } = await install("profile-b");
  await welcome.locator("#alt summary").click();
  await welcome.locator("#key").fill("my-key-123");
  await welcome.locator("#save-key").click();
  await until(() => portFree(7457), 60000, "the helper's port");
  const serve = cli(["serve"], { home: path.join(tmp, "home-b"), env: { MORSE_PROVIDER: "demo" } });
  await until(() => /pair\s+(?:\x1b\[[\d;]*m)*([A-Z0-9]{6})/.test(serve.out), 15000, "morse serve");
  await until(async () => !(await welcome.locator("#pairrow").isHidden()), 15000, "the code box");
  await welcome.locator("#code").pressSequentially("ZZZZZZ");
  await until(async () => /doesn't match/.test(await welcome.locator("#live").textContent()), 8000, "wrong code");
  await sleep(300);
  const box = await welcome.locator("#model").boundingBox();
  await shot(welcome, "140-welcome-errors.png", { clip: { x: box.x - 24, y: box.y - 64, width: box.width + 48, height: box.height + 88 } });
  serve.kill();
  await ctx.close();
}

// ---- 141-144: a new user straight to a site (no practice first)
if (ONLY !== "desktop") {
  const { ctx, id, welcome } = await install("profile-c");
  await allowUserScripts(ctx, id);
  const code = (await welcome.locator("#setup-cmd").textContent()).split(" ").pop();
  await until(() => portFree(7457), 60000, "the helper's port");
  const setup = cli(["setup", "--use", "demo", "--pair", code], { home: path.join(tmp, "home-c") });
  await until(() => done(welcome, "model"), 40000, "pairing");
  const site = await ctx.newPage();
  await site.goto(BYTE);
  await site.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await site.reload();
  await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  await sleep(3200); // the "Morse is ready" toast goes
  const status = () => site.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
  await site.mouse.move(1000, 120);
  await site.keyboard.press(OPEN_KEY);
  await sleep(700);
  await shot(site, "141-site-new-bar.png");
  const p = await site.locator("article p").first().boundingBox();
  await site.mouse.move(p.x + 200, p.y + 8, { steps: 4 });
  await site.mouse.click(p.x + 200, p.y + 8);
  await sleep(500);
  await shot(site, "142-site-pointed.png");
  await site.keyboard.press("Escape");
  await sleep(200);
  await site.keyboard.press("Escape");
  await sleep(300);
  await site.keyboard.press(OPEN_KEY);
  await sleep(500);
  await site.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".sug")].find(b => b.textContent === "Hide the ads").click());
  await until(async () => (await status()).phase === "result", 30000, "the change");
  await site.keyboard.press("Enter");
  await sleep(1800);
  await shot(site, "143-site-first-save.png");
  await site.keyboard.press("Escape");
  await site.keyboard.press(OPEN_KEY);
  await sleep(500);
  const q = await site.evaluate(() => { const r = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".gm-qbtn").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await site.mouse.click(q.x, q.y);
  await sleep(500);
  await shot(site, "144-site-revealed.png");
  setup.kill();
  await ctx.close();
}

// ---- 145-146: a desktop app, `morse launch`, first saved change
if (ONLY !== "web") {
  const home = path.join(tmp, "home-d");
  const chrome = chromium.executablePath();
  const launch = cli(["launch", chrome, "--name", "Tunes", "--", `--user-data-dir=${path.join(tmp, "tunes-profile")}`, "--no-first-run", "--no-sandbox", "--no-proxy-server",
    "--no-default-browser-check", "--force-device-scale-factor=1", "--window-size=1280,800", `--app=${TUNES}`], { home, env: { MORSE_PROVIDER: "demo" } });
  await until(() => /press .*, point at something and say what to change/.test(plain(launch.out)), 60000, "morse launch");
  const port = Number(/port\s+(\d+)/.exec(plain(launch.out))[1]);
  await terminal(`\x1b[2m$\x1b[0m morse launch tunes\n${launch.out.replace(chrome, "/Applications/Tunes.app")}`, "145-desktop-launch.png", "morse launch tunes");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const app = browser.contexts()[0].pages().find(p => p.url().includes("tunes"));
  await app.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await app.reload();
  await sleep(3500);
  const status = () => app.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
  await app.keyboard.press(OPEN_KEY);
  await sleep(500);
  const ctl = await app.locator('[data-testid="player-controls"]').boundingBox();
  await app.mouse.click(ctl.x + ctl.width / 2, ctl.y + 6);
  await sleep(400);
  await app.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".sug")].find(b => b.textContent === "Sleep timer").click());
  await until(async () => (await status())?.phase === "result", 120000, "the sleep timer");
  await app.keyboard.press("Enter");
  await sleep(1800);
  await shot(app, "146-desktop-first-save.png");
  await browser.close().catch(() => {});
  launch.kill("SIGINT");
  await sleep(1000);
  try { execFileSync("pkill", ["-f", path.join(tmp, "tunes-profile")]); } catch {}
}

procs.forEach(p => { try { p.kill(); } catch {} });
await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
process.exit(0);
