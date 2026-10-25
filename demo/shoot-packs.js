// Mod packs screenshots (160-166): the real desktop connector (CDP) on the
// Metricly demo dashboard, in a scratch MORSE_HOME.
//   160 · Make a pack…: choosing mods in the Mods panel
//   161 · Make a pack: name, note, Copy link
//   162 · the share page for a pack link
//   163 · the pack review on a teammate's computer: untick, a clash, notes
//   164 · the end of the review: Check this address for updates
//   165 · the Mods panel: the pack's mods under its name, Update available
//   166 · the update review: new, changed (with what changed), removed
//
//   node demo/shoot-packs.js
//
// The dashboard is served at its usual address (127.0.0.1:8789) and the share
// page at its real one, both straight from this checkout; the team's pack
// file from a local server (an http address on this computer is allowed for
// making a pack; anywhere else it has to be https).

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const DASH = "http://127.0.0.1:8789/demo/sites/dash/";
const HOST = "127.0.0.1:8789";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-packs-"));
process.env.MORSE_HOME = home;
const MODS = path.join(home, "mods");
await fs.mkdir(MODS, { recursive: true });
await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
const ago = s => new Date(Date.now() - s * 1000).toISOString();
const mod = (id, title, prompt, extra) => ({ morse: 1, id, title, prompt, match: { hosts: [HOST], app: null }, css: "", js: "", enabled: true, model: "Claude Code · sonnet", created: ago(5 * 86400), updated: ago(5 * 86400), ...extra });
const writeMod = m => fs.writeFile(path.join(MODS, `${m.id}.json`), JSON.stringify(m, null, 2));
const rm = id => fs.rm(path.join(MODS, `${id}.json`), { force: true });

const sticky = mod("sticky-head", "Sticky table header", "keep the table header in view when I scroll", { css: ".tbl .sc thead th { position: sticky; top: 0; z-index: 1; box-shadow: 0 1px 0 #e5e7eb; }\n" });
const failed = mod("failed-red", "Failed orders stand out", "make failed orders stand out", { css: "tr:has(.st[data-s=\"failed\"]) td { background: #fef2f2; }\ntr:has(.st[data-s=\"failed\"]) td:first-child { box-shadow: inset 3px 0 0 #dc2626; }\n" });
const copyId = mod("copy-order", "Copy order number", "add a button to copy the order number", {
  js: "morse.watch('tbody tr td:first-child', td => {\n  const b = morse.el('button', { class: 'morse-copy', text: 'Copy', on: { click: () => navigator.clipboard.writeText(td.textContent.trim()) } });\n  td.append(' ', b);\n});\nmorse.css('.morse-copy { font: 11px system-ui; padding: 0 6px; border: 1px solid #dfe1e6; border-radius: 4px; background: #fff; cursor: pointer; }');\n",
});
const totals = mod("big-numbers", "Bigger numbers", "make the numbers at the top bigger", { css: ".kc .vl { font-size: 26px; letter-spacing: -0.02em; }\n" });
for (const m of [sticky, failed, copyId, totals]) await writeMod(m);

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const file = p => fs.readFile(path.join(root, path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "")));

// The team's pack, at an address Morse checks for updates.
let served = "";
const packPort = await freePort();
http.createServer((req, res) => res.writeHead(200, { "Content-Type": "application/json", ETag: `"${served.length}"` }).end(served)).listen(packPort, "127.0.0.1");
const ADDRESS = `http://127.0.0.1:${packPort}/orders-team.morse-pack.json`;

const { Connector } = await import("../daemon/connector.js");
const port = await freePort();
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
const serveRepo = prefix => async route => {
  const p = new URL(route.request().url()).pathname.replace(prefix, "/");
  try { route.fulfill({ body: await file(p.endsWith("/") ? p + "index.html" : p), contentType: TYPES[path.extname(p) || ".html"] || "text/plain" }); }
  catch { route.fulfill({ status: 404, body: "" }); }
};
await ctx.route("http://127.0.0.1:8789/**", serveRepo("/"));
await ctx.route("https://sam-siavoshian.github.io/RRAA/**", serveRepo("/RRAA/"));
await ctx.route("https://fonts.googleapis.com/**", route => route.fulfill({ body: "", contentType: "text/css" }));
new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();

const page = await ctx.newPage();
page.on("pageerror", e => console.log("  ! pageerror", e.message));
const ui = sel => page.locator(`[data-morse-ui] ${sel}`);
const blur = () => page.evaluate(() => document.querySelector("[data-morse-ui]")?.shadowRoot.activeElement?.blur());
const shot = async (name, opts = {}) => { await page.mouse.move(640, 855); await sleep(450); await page.screenshot({ path: path.join(OUT, name), ...opts }); console.log("  📸", name); };
async function load(url = DASH) {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
  await sleep(500);
}
async function openPanel() {
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(".panel .list").waitFor();
  await sleep(300);
}
const until = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await sleep(50); } throw new Error("timed out: " + fn); };
const exists = id => fs.access(path.join(MODS, `${id}.json`)).then(() => true, () => false);

// ---- 160: choosing mods for a pack
await load();
await openPanel();
await ui(".panel .pmore summary").click(); // under the panel's More
await ui(".panel [data-pk=make]").click();
for (const id of ["sticky-head", "failed-red", "copy-order"]) await ui(`.panel article[data-id="${id}"] [data-pk=sel]`).check();
await ui(".panel .list").evaluate(l => l.scrollTo({ top: 0 }));
await blur();
await shot("160-pack-choose.png");

// ---- 161: name, note, Copy link
await ui(".panel .pk-pickbar [data-pk=next]").click();
const make = ui(".modal .card");
await make.waitFor();
await make.locator("[data-pk=name]").fill("Orders team");
await make.locator("[data-pk=note]").fill("What the orders team uses on Metricly every day. Untick what you don't need.");
await make.locator("[data-pk=link]").click();
await make.locator(".pk-link:not([hidden]) input").waitFor();
const link = await make.locator(".pk-link input").inputValue();
await blur();
await shot("161-pack-make.png");
await make.locator("footer [data-a=close]").click();

// ---- 162: the share page for the pack
const share = await ctx.newPage();
await share.setViewportSize({ width: 1280, height: 1100 });
await share.goto(link);
await share.locator("h1").waitFor();
await sleep(600);
await share.screenshot({ path: path.join(OUT, "162-pack-share-page.png") });
console.log("  📸", "162-pack-share-page.png");
await share.close();

// ---- 163-164: on a teammate's computer, from the team's address
// They have their own "Bigger numbers" (the same id as one in the pack), and
// none of the others. The team's pack adds one for every website.
const pack = JSON.parse(await fs.readFile(path.join(home, "exports", "orders-team.morse-pack.json"), "utf8").catch(() => "null"))
  || { morse: "morse-pack", version: 1, id: "orders-team", name: "Orders team", mods: [] };
const teamPack = {
  morse: "morse-pack", version: 1, id: "orders-team", name: "Orders team", author: "Dana (orders team)",
  note: "What the orders team uses on Metricly every day. Untick what you don't need.",
  mods: [
    { ...sticky, enabled: undefined, created: undefined, updated: undefined, model: undefined },
    { ...failed, enabled: undefined, created: undefined, updated: undefined, model: undefined },
    { ...copyId, enabled: undefined, created: undefined, updated: undefined, model: undefined, js: copyId.js + "morse.on(document, 'keydown', e => { if (e.key === 'c' && e.altKey) document.querySelector('.morse-copy')?.click(); });\n" },
    { ...totals, title: "Bigger numbers", enabled: undefined, created: undefined, updated: undefined, model: undefined },
    mod("quiet-links", "Quieter links", "make links less bright on every site", { match: { hosts: ["*"], app: null }, css: "a { color: inherit; text-decoration-color: #9ca3af; }\n", enabled: undefined, created: undefined, updated: undefined, model: undefined }),
  ].map(m => JSON.parse(JSON.stringify(m))),
};
void pack;
served = JSON.stringify(teamPack, null, 2);
for (const id of ["sticky-head", "failed-red", "copy-order"]) await rm(id);
await writeMod({ ...totals, title: "My bigger numbers", css: ".kc .vl { font-size: 22px; }\n" });
await load();
await openPanel();
await ui(".panel footer [data-a=import]").click();
await ui(".modal [data-k=src]").fill(ADDRESS);
await ui(".modal [data-a=go]").click();
const review = ui(".modal .card.pk-card");
await review.waitFor();
await review.locator('.pk-item[data-pkid="copy-order"] [data-pk=pick]').uncheck();
await review.evaluate(c => { c.scrollTop = 0; });
await sleep(700);
await blur();
await shot("163-pack-review.png");
await review.evaluate(c => { c.scrollTop = c.scrollHeight; });
await review.locator("[data-pk=sub]").check();
await sleep(400);
await blur();
await shot("164-pack-review-updates.png");
await review.locator("[data-pk=install]").click();
await until(() => exists("sticky-head"));

// ---- 165: the panel, a week later: the team changed the pack
teamPack.mods[0] = { ...teamPack.mods[0], css: ".tbl .sc thead th { position: sticky; top: 0; z-index: 1; background: #f9fafb; box-shadow: 0 1px 0 #e5e7eb; }\n.tbl .sc { max-height: 420px; }\n" };
teamPack.mods.splice(1, 1); // "Failed orders stand out" is gone
teamPack.mods.push(mod("pending-amber", "Pending orders in amber", "show pending orders in amber", { css: "tr:has(.st[data-s=\"pending\"]) td { background: #fffbeb; }\n", enabled: undefined, created: undefined, updated: undefined, model: undefined }));
served = JSON.stringify(JSON.parse(JSON.stringify(teamPack)), null, 2);
const subsFile = path.join(home, "packs.json");
const subs = JSON.parse(await fs.readFile(subsFile, "utf8"));
for (const s of Object.values(subs.subs)) s.cache.fetchedAt = Date.now() - 2 * 864e5;
await fs.writeFile(subsFile, JSON.stringify(subs));
await load();
await openPanel();
await ui('.panel .pk-group[data-pack="orders-team"] .pk-upd').waitFor({ timeout: 15000 });
await ui('.panel .pk-group[data-pack="orders-team"]').scrollIntoViewIfNeeded();
await blur();
await shot("165-pack-panel.png");

// ---- 166: the update review
await ui('.panel .pk-group[data-pack="orders-team"] [data-pk=update]').click();
await ui(".modal .card.pk-card").waitFor();
await sleep(700);
await blur();
await shot("166-pack-update.png");

await browser.close();
await fs.rm(home, { recursive: true, force: true });
process.exit(0);
