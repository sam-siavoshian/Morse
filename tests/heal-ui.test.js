// Self-heal, end to end in real Chromium: the Tunes demo site, the real
// desktop connector (CDP) as the host and the demo model. The site's
// markup changes (demo/sites/tunes/?v2 renames the album grid and its
// classes): a saved mod is flagged as stopped working after the page settles,
// with a dot on the Morse mark and a note in the Mods panel; Fix it sends it
// to the model with what used to match, the fix shows for review, Save keeps
// it and History keeps the old version. With "Fix my mods automatically" on,
// a gallery mod is fixed in the background, with Undo and Share the fix.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";

const ROOT = new URL("../", import.meta.url);
let home, bin, browser, page, server, port, tunes;
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const ui = sel => page.locator(`[data-morse-ui] ${sel}`);
const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
async function waitFor(pred, ms = 15000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) { s = await status(); if (s && pred(s)) return s; await page.waitForTimeout(30); }
  throw new Error("timed out; last status " + JSON.stringify(s));
}
const modsDir = () => path.join(home, "mods");
const readMod = async id => JSON.parse(await fs.readFile(path.join(modsDir(), `${id}.json`), "utf8"));
const allMods = async () => Promise.all((await fs.readdir(modsDir())).filter(f => f.endsWith(".json")).map(f => fs.readFile(path.join(modsDir(), f), "utf8").then(JSON.parse)));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await page.waitForTimeout(50); }
  throw new Error("timed out waiting for " + fn);
}
// Safe start (core/control.js) holds back a mod when pages keep closing within
// 6 seconds of it running: each page here stays up longer than that.
let loadedAt = 0;
async function load(query = "") {
  const wait = loadedAt + 6500 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.goto(tunes + query);
  loadedAt = Date.now();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
}
// The first album card's width: about 150px as the site draws it, about 210px with the mod.
const cardWidth = () => page.evaluate(() => Math.round(document.querySelector(".q8c, .rl-card").getBoundingClientRect().width));
const healDot = () => page.evaluate(() => {
  const host = document.querySelector("[data-morse-ui]");
  return !!host?.shadowRoot?.querySelector(".bar[data-heal]");
});

before(async () => {
  if (skip) return;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-heal-"));
  process.env.MORSE_HOME = home;
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
  // "Share the fix…" opens a browser (xdg-open / open): a stand-in records the address instead.
  bin = await fs.mkdtemp(path.join(os.tmpdir(), "morse-heal-bin-"));
  for (const name of ["xdg-open", "open"]) await fs.writeFile(path.join(bin, name), `#!/bin/sh\nprintf '%s' "$1" > "${bin}/opened.txt"\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${process.env.PATH}`;

  port = await freePort();
  server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(await fs.readFile(new URL("." + (p.endsWith("/") ? p + "index.html" : p), ROOT))); }
    catch { res.writeHead(404).end("not found"); }
  }).listen(port, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  tunes = `http://127.0.0.1:${port}/demo/sites/tunes/`;

  const cdp = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${cdp}`] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  page = await ctx.newPage();
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto(tunes);
  const { Connector } = await import("../daemon/connector.js");
  new Connector({ port: cdp, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} }).run();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
});
after(async () => {
  await browser?.close();
  server?.close();
  for (const d of [home, bin]) if (d) await fs.rm(d, { recursive: true, force: true });
});

test("the site changes: the mod is flagged quietly, Fix it brings it back, History keeps the old version", { skip, timeout: 120000 }, async () => {
  // Make a mod and save it: it remembers what it changed.
  assert.ok(await cardWidth() < 180);
  await page.keyboard.press(OPEN_KEY);
  await waitFor(s => s.open);
  await page.keyboard.type("make the album covers bigger");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result");
  await page.keyboard.press("Enter"); // Save
  await waitFor(s => !s.open);
  const id = (await allMods())[0].id;
  const fp = await until(async () => (await readMod(id)).fp);
  assert.deepEqual(fp.sels.map(x => x[0]), ['[data-testid="album-grid"]', '[data-testid="album-grid"] > div', '[data-testid="album-grid"] > div > div', '[data-testid="album-grid"] > div b']);
  assert.deepEqual(fp.sels.map(x => x[1]), [2, 12, 12, 12]);
  assert.equal(fp.path, "/demo/sites/tunes/");

  // The same page again: nothing to report.
  await load();
  await until(async () => (await cardWidth()) > 200); // the mod works
  await page.waitForTimeout(4000);
  assert.equal(await healDot(), false, "no dot while it works");

  // The site is redesigned: the grid and its classes have new names.
  await load("?v2");
  assert.ok(await cardWidth() < 180, "the mod does nothing now");
  assert.equal(await healDot(), false, "nothing is decided before the page settles");
  await until(healDot, 20000);
  assert.equal(await ui(".bar").isHidden(), true, "nothing pops up over the page");
  assert.equal(await ui(".toast").isHidden(), true);
  assert.equal(await ui(".ctl-toast").count() ? await ui(".ctl-toast").isHidden() : true, true);

  await page.keyboard.press("Alt+Shift+KeyM");
  const note = ui(`.panel article[data-id="${id}"] .health`);
  await note.waitFor();
  assert.equal((await note.locator("p").textContent()).trim(), "Stopped working after this site changed. It can't find the part of the page it changes.");
  assert.equal(await ui(".panel[data-heal]").count(), 1, "the dot on the panel's mark");

  // Fix it: the model gets what used to match and what the page has now.
  await note.locator("[data-a=fix]").click();
  await waitFor(s => s.open && s.phase === "result" && /version 2/.test(s.hint), 20000);
  assert.ok(await cardWidth() > 200, "the fix finds the renamed grid");
  assert.match(await ui(".actions").textContent(), /Save.*Undo/, "shown for review like any refine");
  await page.keyboard.press("Enter"); // Save
  await waitFor(s => !s.open);
  const mod = await readMod(id);
  assert.equal(mod.refined, "Fixed it so it works again");
  assert.equal(mod.history.length, 1, "the old version stays in History");
  assert.match(mod.history[0].css, /album-grid/);
  assert.match(mod.css, /release-grid/);
  assert.doesNotMatch(mod.css, /album-grid/);
  await until(async () => (await readMod(id)).fp?.sels?.[0]?.[0] === '[data-testid="release-grid"]');
  assert.equal(await healDot(), false, "fixed: the dot is gone");
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(`.panel article[data-id="${id}"]`).waitFor();
  await until(async () => (await ui(`.panel article[data-id="${id}"] .health`).count()) === 0); // and so is the note (once the panel has re-rendered)
  await ui(".panel [data-a=history]").click();
  assert.match(await ui(".panel .versions").textContent(), /Fixed it so it works again.*showing now.*make the album covers bigger/);
  await page.keyboard.press("Escape");

  // A reload of the new page: it works and stays quiet.
  await load("?v2");
  await until(async () => (await cardWidth()) > 200);
  await page.waitForTimeout(4500);
  assert.equal(await healDot(), false);
  await fs.rm(path.join(modsDir(), `${id}.json`));
});

test("auto-fix (off by default) fixes a gallery mod in the background, with Undo and Share the fix", { skip, timeout: 120000 }, async () => {
  const gallery = JSON.parse(await fs.readFile(new URL("site/mods/tunes-big-covers.morse.json", ROOT), "utf8"));
  const now = new Date().toISOString();
  await fs.writeFile(path.join(modsDir(), "tunes-big-covers.json"), JSON.stringify({
    ...gallery, match: { hosts: [`127.0.0.1:${port}`], app: null }, enabled: true, imported: true, importedFrom: "gallery",
    gallery: { id: "tunes-big-covers", version: 1 }, created: now, updated: now }));

  // Installed mods learn what they change the first time they work.
  await load();
  await until(async () => (await cardWidth()) > 200);
  const fp = await until(async () => (await readMod("tunes-big-covers")).fp, 20000);
  assert.equal(fp.sels[0][0], '[data-testid="album-grid"]');

  // Turn on "Fix my mods automatically when a site changes".
  await page.keyboard.press(OPEN_KEY);
  await waitFor(s => s.open);
  await page.keyboard.press("Control+Comma");
  const sw = ui('.sheet input[data-k="autoFix"]');
  await sw.waitFor({ state: "attached" });
  assert.equal(await sw.isChecked(), false, "off by default");
  assert.equal((await ui('.sheet .srow:has(input[data-k="autoFix"]) .lbl span').textContent()), "Fix my mods automatically when a site changes");
  await ui('.sheet .srow:has(input[data-k="autoFix"]) .sw span').click();
  await until(async () => JSON.parse(await fs.readFile(path.join(home, "settings.json"), "utf8")).autoFix === true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await load("?v2");
  const toast = ui(".ctl-toast");
  await toast.waitFor({ state: "visible", timeout: 30000 });
  assert.match(await toast.textContent(), /Fixed “Bigger rounded covers” after this site changed\./);
  assert.ok(await cardWidth() > 200, "fixed in the background");
  let mod = await readMod("tunes-big-covers");
  assert.equal(mod.refined, "Fixed after this site changed");
  assert.equal(mod.history.length, 1);
  assert.match(mod.history[0].css, /album-grid/);
  assert.match(mod.css, /release-grid/);
  assert.equal(await healDot(), false);

  // Undo: back to the version from before the fix, and the note is back.
  await toast.locator("button", { hasText: "Undo" }).click();
  await until(async () => (await readMod("tunes-big-covers")).history?.length === 0);
  mod = await readMod("tunes-big-covers");
  assert.match(mod.css, /album-grid/);
  await until(async () => (await cardWidth()) < 180);
  await until(healDot);

  // Fix it by hand, then share the fix with the gallery from the panel.
  await page.keyboard.press("Alt+Shift+KeyM");
  const row = ui('.panel article[data-id="tunes-big-covers"]');
  await row.locator(".health [data-a=fix]").click();
  await waitFor(s => s.open && s.phase === "result" && /version 2/.test(s.hint), 20000);
  await page.keyboard.press("Enter");
  await waitFor(s => !s.open);
  await toast.waitFor({ state: "visible" });
  assert.match(await toast.textContent(), /Saved the fix for “Bigger rounded covers”\. Others who use it may need it too\./);
  await page.keyboard.press("Alt+Shift+KeyM");
  const share = row.locator("[data-a=heal-share]");
  await share.waitFor();
  assert.match(await row.locator(".heal-fixed p").textContent(), /Fixed after this site changed\. Others who use it may need this fix too\./);
  await share.click();
  const opened = await until(() => fs.readFile(path.join(bin, "opened.txt"), "utf8"));
  const u = new URL(opened);
  assert.equal(u.origin + u.pathname, "https://github.com/sam-siavoshian/RRAA/issues/new");
  assert.equal(u.searchParams.get("title"), "Gallery fix: “Bigger rounded covers” works again");
  assert.match(u.searchParams.get("body"), /the gallery mod `tunes-big-covers` \(version 1\) stopped working/);
  assert.match(u.searchParams.get("body"), /release-grid/);
  await until(async () => (await readMod("tunes-big-covers")).fixShared);
  await until(async () => (await row.locator("[data-a=heal-share]").count()) === 0);
});
