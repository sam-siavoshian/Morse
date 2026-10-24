// The last check before uploading: the store zip, unpacked the way Chrome
// unpacks it, in a fresh Chromium profile, the way a new user meets it.
//
//   npm run store && DISPLAY=:99 node scripts/store-smoke.js [zip]
//
//   1. the welcome page opens by itself on install
//   2. the practice area makes and saves a sample change
//   3. `morse setup --use demo --pair <code>` (the command the welcome page
//      shows) connects the Morse helper with the demo model, and the page
//      says so by itself
//   4. "Allow User Scripts" on, then one change on a demo site (The Daily
//      Byte), saved, and still there after a reload
// Everything the service worker logs (over the DevTools protocol, attached
// from its first second) and every error on the extension's pages is
// collected; any error or warning fails the run.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { demoSites, pressOpen } from "../demo/helper.js";
import { freePort } from "../tests/helpers/net.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(`· ${s}`);
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); }
  throw new Error(`timed out waiting for ${what}`);
}

// The zip's files, from its central directory (stored or deflated).
export function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), note = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    files.push({ name, data: method === 8 ? inflateRawSync(body) : Buffer.from(body) });
    at += 46 + nameLen + extra + note;
  }
  return files;
}

// A tiny DevTools protocol client on the browser's own socket: attaches to the
// extension's service worker and collects what it logs.
async function watchWorker(port, extId, log) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const attached = new Set(), workers = new Set();
  ws.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m.error); waiting.delete(m.id); return; }
    if (m.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = m.params;
      if (targetInfo.type === "service_worker" && targetInfo.url.startsWith(`chrome-extension://${extId}/`)) {
        // Attached twice (auto-attach and the list below): keep one.
        if (workers.has(targetInfo.targetId)) { await send("Target.detachFromTarget", { sessionId }); return; }
        workers.add(targetInfo.targetId);
        attached.add(sessionId);
        await send("Runtime.enable", {}, sessionId);
        await send("Log.enable", {}, sessionId);
      }
      await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    }
    if (!attached.has(m.sessionId)) return;
    if (m.method === "Runtime.consoleAPICalled") log.push({ level: m.params.type, text: m.params.args.map(a => a.value ?? a.description ?? "").join(" ") });
    if (m.method === "Runtime.exceptionThrown") log.push({ level: "exception", text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
    if (m.method === "Log.entryAdded") log.push({ level: m.params.entry.level, text: m.params.entry.text });
  };
  await send("Target.setDiscoverTargets", { discover: true });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "service_worker" }] });
  const { targetInfos } = await send("Target.getTargets");
  for (const t of targetInfos) if (t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`)) await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  return { close: () => ws.close(), attached };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const zip = path.resolve(process.argv[2] || path.join(root, "dist", `morse-extension-${version}-store.zip`));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-store-smoke-"));
  const ext = path.join(tmp, "extension");
  for (const f of unzip(await fs.readFile(zip))) {
    await fs.mkdir(path.dirname(path.join(ext, f.name)), { recursive: true });
    await fs.writeFile(path.join(ext, f.name), f.data);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(ext, "manifest.json"), "utf8"));
  say(`unpacked ${path.relative(root, zip)}: ${manifest.name} ${manifest.version}`);

  const procs = [];
  process.on("exit", () => procs.forEach(p => { try { p.kill(); } catch {} }));
  const sites = await demoSites();
  const cdpPort = await freePort();
  const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
    headless: false, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox", `--remote-debugging-port=${cdpPort}`],
  });
  await sites.route(ctx);
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const swLog = [];
  const watcher = await watchWorker(cdpPort, id, swLog);
  const pageErrors = [];
  const watchPage = p => {
    p.on("pageerror", e => { if (p.url().startsWith("chrome-extension://")) pageErrors.push(`${p.url()}: ${e.message}`); });
    p.on("console", m => { if (["error", "warning"].includes(m.type()) && p.url().startsWith("chrome-extension://")) pageErrors.push(`${p.url()}: console.${m.type()} ${m.text()}`); });
  };
  ctx.on("page", watchPage);
  ctx.pages().forEach(watchPage);
  const helperPort = await freePort();
  await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), helperPort);
  // Proof the watcher hears the worker: one line of our own.
  await sw.evaluate(() => console.info("store-smoke: listening"));
  await until(() => swLog.some(l => l.text === "store-smoke: listening"), 10000, "the service worker's console");

  // 1. The welcome page
  const welcome = await until(() => ctx.pages().find(p => p.url().includes("/welcome.html")), 60000, "the welcome page");
  await welcome.waitForLoadState();
  await welcome.bringToFront();
  say("welcome page opened on install");

  // 2. The practice area: a suggestion, the sample change, Save
  const practice = await until(() => welcome.frames().find(f => f.url().includes("practice.html")), 20000, "the practice area");
  const sampleShown = () => practice.evaluate(() => getComputedStyle(document.querySelector('aside[aria-label="Sponsored"]')).display === "none");
  await welcome.click("#try");
  // The suggestions are keyboard reachable: Tab, then the second ("Easier to
  // read"). On a busy machine the first keys can land before the bar is ready.
  for (let i = 0; ; i++) {
    await sleep(1500);
    await welcome.keyboard.press("Tab");
    await welcome.keyboard.press("ArrowRight");
    await welcome.keyboard.press("Enter");
    try { await until(sampleShown, 30000, "the sample change in the practice area"); break; } catch (e) { if (i === 2) throw e; await welcome.keyboard.press("Escape"); await welcome.click("#try"); }
  }
  await sleep(1500);
  await welcome.keyboard.press("Enter"); // Save
  await sleep(1200);
  await welcome.keyboard.press("Escape");
  say("practice area: sample change made and saved");

  // 3. Connect a model with the command the page shows
  const cmd = (await welcome.locator("#setup-cmd").textContent()).trim();
  const code = cmd.split(" ").pop();
  const home = path.join(tmp, "home");
  await fs.mkdir(home, { recursive: true });
  const setup = spawn(process.execPath, [path.join(root, "daemon", "cli.js"), "setup", "--use", "demo", "--pair", code],
    { env: { ...process.env, HOME: home, MORSE_HOME: "", MORSE_HELPER_PORT: String(helperPort) }, stdio: ["pipe", "pipe", "pipe"] });
  procs.push(setup);
  let setupOut = "";
  setup.stdout.on("data", d => (setupOut += d)); setup.stderr.on("data", d => (setupOut += d));
  try {
    await until(() => welcome.evaluate(() => document.querySelector('[data-step="model"]').classList.contains("done")), 60000, "the welcome page to show the model connected");
  } catch (e) { console.log(setupOut); throw e; }
  say(`model connected by "${cmd.replace(code, "<code>")}"`);

  // 4. "Allow User Scripts", then one change on a site, saved, and back after a reload
  const ext2 = await ctx.newPage();
  await ext2.goto(`chrome://extensions/?id=${id}`);
  await ext2.locator("#allow-user-scripts").click();
  await sleep(400);
  await ext2.close();
  const site = await ctx.newPage();
  await site.goto(sites.url("byte"));
  await site.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await site.reload();
  await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 30000 });
  const status = () => site.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
  await sleep(3000);
  await until(async () => { if ((await status()).open) return true; await pressOpen(site); await sleep(400); return (await status()).open; }, 30000, "the bar");
  await site.mouse.move(640, 300);
  await until(async () => (await status()).focus === "in", 10000, "the bar's text box");
  await site.keyboard.insertText("hide the ads and make the article easier to read");
  await site.keyboard.press("Enter");
  const res = await until(async () => { const s = await status(); return ["result", "error"].includes(s.phase) && s; }, 120000, "the change");
  if (res.phase !== "result") throw new Error(`the change failed: ${res.hint}`);
  await site.keyboard.press("Enter"); // Save
  await until(async () => (await status()).mods > 0, 15000, "the saved mod");
  await site.keyboard.press("Escape");
  await site.reload();
  await site.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 30000 });
  const back = await until(() => site.evaluate(() => [...document.querySelectorAll('[data-ad]')].every(e => getComputedStyle(e).display === "none")), 20000, "the change after a reload").catch(() => false);
  say(`one change on The Daily Byte: "${res.hint}", saved${back ? ", still there after a reload" : ", but NOT back after a reload"}`);

  await sleep(2000);
  const swCount = watcher.attached.size;
  watcher.close();
  await ctx.close();
  setup.kill();
  await sites.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});

  const bad = swLog.filter(l => ["error", "exception", "warning", "assert"].includes(l.level));
  say(`service worker console (${swCount} session${swCount === 1 ? "" : "s"} watched): ${swLog.length} messages, ${bad.length} errors or warnings`);
  for (const l of swLog) console.log(`    [${l.level}] ${l.text.split("\n")[0]}`);
  for (const e of pageErrors) console.log(`    [page] ${e.split("\n")[0]}`);
  if (!swCount) { console.error("Couldn't watch the service worker."); process.exit(1); }
  if (bad.length || pageErrors.length || !back) { console.error("Not clean."); process.exit(1); }
  say("clean: no errors or warnings from the extension");
  process.exit(0);
}
