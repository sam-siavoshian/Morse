// Mods for this site screenshots (110-112): the real desktop connector (CDP)
// on the Tunes demo site, reading this checkout's gallery list
// (site/mods/index.json) from a local server, in a scratch MORSE_HOME.
//   110 · For this site: the mods others made, in the Mods panel
//   111 · Try it: running without being saved, with Keep and Remove
//   112 · Update: what changed in the gallery's newer version
//
//   node demo/shoot-gallery.js
//
// The page is served at its usual address (127.0.0.1:8789, where the demo
// mods in the list apply) straight from this checkout, so it doesn't matter
// what else is listening on the demo ports.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const TUNES = "http://127.0.0.1:8789/demo/sites/tunes/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-gallery-"));
process.env.MORSE_HOME = home;
await fs.mkdir(path.join(home, "mods"), { recursive: true });
await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false }));
await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
const MODS = path.join(home, "mods");
const writeMod = m => fs.writeFile(path.join(MODS, `${m.id}.json`), JSON.stringify(m, null, 2));
const ago = s => new Date(Date.now() - s * 1000).toISOString();

// One mod of your own, made a few days ago.
await writeMod({ morse: 1, id: "quiet-sidebar", title: "Quieter sidebar", prompt: "make the sidebar quieter so the albums stand out",
  match: { hosts: ["127.0.0.1:8789"], app: null }, target: { selector: "nav", label: "Sidebar" },
  css: "nav { background: #0b0b0b !important; }\nnav a:not(.on) { color: #7d7d7d !important; }\n", js: "", enabled: true, model: "demo", created: ago(3 * 86400), updated: ago(3 * 86400) });

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const file = p => fs.readFile(path.join(root, path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "")));
const listPort = await freePort();
http.createServer(async (req, res) => {
  try { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=600" }).end(await file(new URL(req.url, "http://x").pathname)); }
  catch { res.writeHead(404).end(); }
}).listen(listPort, "127.0.0.1");
process.env.MORSE_GALLERY_URL = `http://127.0.0.1:${listPort}/site/mods/index.json`;

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
const shot = async name => { await page.mouse.move(640, 790); await sleep(350); await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };
async function load() {
  await page.goto(TUNES);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
  await sleep(500);
}

// ---- 110: the chip in the empty bar leads to For this site
await load();
await page.keyboard.press("Alt+Space");
await ui(".sugs .gl-sug").waitFor({ timeout: 15000 });
await page.keyboard.press("Tab");
await page.keyboard.press("End");
await sleep(150);
await page.keyboard.press("Enter");
await ui(".panel .gl-site.open .gl-item").first().waitFor();
await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());
await shot("110-for-this-site.png");

// ---- 111: Try it
await ui('.gl-item[data-glid="tunes-sleep-timer"] [data-gl=try]').click();
await page.locator(".morse-sleep").waitFor();
await page.locator(".morse-sleep").click();
await page.locator(".morse-sleep span").waitFor();
await sleep(2200); // the timer ticks
await shot("111-try-it.png");
await ui(".gl-trial [data-gl=remove]").click();
await page.locator(".morse-sleep").waitFor({ state: "detached" });

// ---- 112: version 1 installed last week, the gallery has version 2
await ui('.gl-item[data-glid="tunes-sleep-timer"] [data-gl=install]').click();
await ui(".modal [data-a=install]").click();
const saved = path.join(MODS, "tunes-sleep-timer.json");
for (let i = 0; i < 100; i++) { try { await fs.access(saved); break; } catch { await sleep(50); } }
const v2 = JSON.parse(await fs.readFile(saved, "utf8"));
const v1js = v2.js.replace("const steps = [15, 30, 60, 0];", "const steps = [30, 60];")
  .replace(/\n  const render[\s\S]*?\n  };\n/, "\n  const render = () => btn.classList.toggle(\"on\", left > 0);\n");
await writeMod({ ...v2, js: v1js, version: 1, gallery: { id: "tunes-sleep-timer", version: 1 }, created: ago(6 * 86400), updated: ago(6 * 86400) });
await load();
await page.keyboard.press("Alt+Shift+KeyM");
await ui('.panel article[data-id="tunes-sleep-timer"] .gl-upd').waitFor();
await ui('.panel article[data-id="tunes-sleep-timer"] [data-gl=update]').click();
await ui(".modal .gl-what").waitFor();
await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());
await shot("112-update.png");

await browser.close();
await fs.rm(home, { recursive: true, force: true });
process.exit(0);
