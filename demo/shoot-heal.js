// Self-heal screenshots (113-117): the real desktop connector (CDP) on the
// Tunes demo site and the demo model, in a scratch MORSE_HOME. The site is
// redesigned (demo/sites/tunes/?v2 renames the album grid and its classes)
// under a mod installed from the gallery.
//   113 · Stopped working after this site changed, with Fix it, and the dot on the Morse mark
//   114 · Fix it: the fixed version shown for review, with Save and Undo
//   115 · Saved: share the fix with the gallery
//   116 · Settings: Fix my mods automatically when a site changes
//   117 · Fixed in the background, with Undo
//
//   node demo/shoot-heal.js
//
// The page is served at its usual address (127.0.0.1:8789, where the gallery
// mod applies) straight from this checkout.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createRequire } from "node:module";
import { openBar } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const TUNES = "http://127.0.0.1:8789/demo/sites/tunes/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-heal-"));
process.env.MORSE_HOME = home;
const MODS = path.join(home, "mods");
await fs.mkdir(MODS, { recursive: true });
const settings = s => fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false, ...s }));
await settings({});
await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
const writeMod = m => fs.writeFile(path.join(MODS, `${m.id}.json`), JSON.stringify(m, null, 2));
const readMod = async id => JSON.parse(await fs.readFile(path.join(MODS, `${id}.json`), "utf8"));
const ago = s => new Date(Date.now() - s * 1000).toISOString();

// One mod of your own, and "Bigger rounded covers" from the gallery, installed last week.
await writeMod({ morse: 1, id: "quiet-sidebar", title: "Quieter sidebar", prompt: "make the sidebar quieter so the albums stand out",
  match: { hosts: ["127.0.0.1:8789"], app: null }, target: { selector: "nav", label: "Sidebar" },
  css: "nav { background: #0b0b0b !important; }\nnav a:not(.on) { color: #7d7d7d !important; }\n", js: "", enabled: true, model: "Claude Code · sonnet", created: ago(9 * 86400), updated: ago(9 * 86400) });
const gallery = JSON.parse(await fs.readFile(path.join(root, "site/mods/tunes-big-covers.morse.json"), "utf8"));
const covers = { ...gallery, enabled: true, imported: true, importedFrom: "gallery", gallery: { id: "tunes-big-covers", version: 1 }, created: ago(6 * 86400), updated: ago(6 * 86400) };
await writeMod(covers);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const file = p => fs.readFile(path.join(root, path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "")));
const { Connector } = await import("../daemon/connector.js");
const port = await new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
await ctx.route("http://127.0.0.1:8789/**", async route => {
  const p = new URL(route.request().url()).pathname;
  try { route.fulfill({ body: await file(p.endsWith("/") ? p + "index.html" : p), contentType: TYPES[path.extname(p) || ".html"] || "text/plain" }); }
  catch { route.fulfill({ status: 404, body: "" }); }
});
new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();

const page = await ctx.newPage();
page.on("pageerror", e => console.log("  ! pageerror", e.message));
const ui = sel => page.locator(`[data-morse-ui] ${sel}`);
const shadow = fn => page.evaluate(fn);
const shot = async name => { await page.mouse.move(640, page.viewportSize().height - 10); await sleep(350); await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(80); }
  throw new Error("timed out waiting for " + fn);
}
// Safe start holds back a mod when pages keep closing within seconds: stay longer.
let loadedAt = 0;
async function load(query = "") {
  const wait = loadedAt + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  await page.goto(TUNES + query);
  loadedAt = Date.now();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
}
const dot = () => shadow(() => !!document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".bar[data-heal]"));
const blur = () => shadow(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());

// The mod works on the site as it was: it learns what it changes.
await load();
const fp = await until(async () => (await readMod("tunes-big-covers")).fp);

// ---- 113: the site is redesigned; the mod is flagged, quietly
await load("?v2");
await until(dot);
await page.keyboard.press("Alt+Shift+KeyM");
await ui('.panel article[data-id="tunes-big-covers"] .health').waitFor();
await sleep(300);
await blur();
await shot("113-stopped-working.png");

// ---- 114: Fix it, shown for review
await ui('.panel article[data-id="tunes-big-covers"] .health [data-a=fix]').click();
await until(async () => /version 2/.test(JSON.parse(await shadow(() => document.querySelector("[data-morse-ui]").dataset.status)).hint));
await shot("114-fix-it.png");

// ---- 115: saved; offer to share the fix with the gallery
await page.keyboard.press("Enter");
await ui(".ctl-toast").waitFor({ state: "visible" });
await shot("115-share-fix.png");

// ---- 116: the setting
await ui(".ctl-toast .ctl-x").click();
await sleep(300);
await page.setViewportSize({ width: 1280, height: 1000 }); // tall enough for the whole of Settings, nothing scrolled half out of view
await openBar(page);
await sleep(300);
await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma"); // Settings
await ui('.sheet input[data-k="autoFix"]').waitFor({ state: "attached" });
await ui('.sheet .srow:has(input[data-k="autoFix"]) .sw span').click();
await until(async () => JSON.parse(await fs.readFile(path.join(home, "settings.json"), "utf8")).autoFix === true);
await shadow(() => {
  const r = document.querySelector("[data-morse-ui]").shadowRoot;
  r.querySelector(".sheet").scrollTop = 0;
  r.activeElement?.blur();
});
await shot("116-auto-fix-setting.png");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1280, height: 800 });

// ---- 117: the same redesign with auto-fix on: fixed in the background
await writeMod({ ...covers, fp });
await load("?v2");
await ui(".ctl-toast").waitFor({ state: "visible", timeout: 30000 });
await until(async () => /Fixed “/.test(await ui(".ctl-toast").textContent()));
await shot("117-fixed-automatically.png");

await browser.close();
await fs.rm(home, { recursive: true, force: true });
process.exit(0);
