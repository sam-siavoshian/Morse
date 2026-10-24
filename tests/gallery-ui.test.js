// Mods for this site, end to end in real Chromium: the Tunes demo site, the
// real desktop connector (CDP) as the host, and the repo's own gallery list
// served locally (site/mods/index.json, with the demo port swapped for this
// run's). The chip in the empty bar, Try it then Undo (nothing left
// behind), Try it then Save, Install through the install review, Update
// available after the gallery moves on, and the update review.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { axeCheck, axeLines } from "../demo/axe.js";
import { pressOpen } from "./helpers/keys.js";
import { TIMEOUT, settle, waitForReady } from "./helpers/wait.js";
import { freePort } from "./helpers/net.js";

const skip = noBrowser;

const ROOT = new URL("../", import.meta.url);
let home, browser, page, server, port, connector, running, indexHits = 0;
const ui = sel => page.locator(`[data-morse-ui] ${sel}`);
const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
async function waitFor(pred, ms = TIMEOUT) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) { s = await status(); if (s && pred(s)) return s; await page.waitForTimeout(30); }
  throw new Error("timed out; last status " + JSON.stringify(s));
}
const modFile = id => path.join(home, "mods", `${id}.json`);
const readMod = async id => JSON.parse(await fs.readFile(modFile(id), "utf8"));
const exists = p => fs.access(p).then(() => true, () => false);
async function until(fn, ms = TIMEOUT) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await page.waitForTimeout(40); }
  throw new Error("timed out waiting for " + fn);
}

before(async () => {
  if (skip) return;
  home = tempDir("morse-gallery-");
  process.env.MORSE_HOME = home;
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false }));
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));

  // The repo, served like demo/serve.js does; the demo mods' host is this run's port.
  port = await freePort();
  const swap = s => s.replaceAll("127.0.0.1:8789", `127.0.0.1:${port}`);
  server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    try {
      let body = await fs.readFile(new URL("." + (p.endsWith("/") ? p + "index.html" : p), ROOT));
      if (p.startsWith("/site/mods/")) {
        if (p.endsWith("index.json")) indexHits++;
        body = swap(body.toString());
      }
      res.writeHead(200, { "Content-Type": p.endsWith(".json") ? "application/json" : "text/html; charset=utf-8", "Cache-Control": "max-age=600" }).end(body);
    } catch { res.writeHead(404).end("not found"); }
  }).listen(port, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  process.env.MORSE_GALLERY_URL = `http://127.0.0.1:${port}/site/mods/index.json`;

  const cdp = await freePort();
  browser = await launchBrowser({ args: [`--remote-debugging-port=${cdp}`] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  page = await ctx.newPage();
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto(`http://127.0.0.1:${port}/demo/sites/tunes/`);
  const { Connector } = await import("../daemon/connector.js");
  connector = new Connector({ port: cdp, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  running = connector.run();
  await waitForReady(page);
});
after(async () => {
  await connector?.stop().catch(() => {});
  await running;
  await browser?.close();
  server?.close();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

test("the empty bar suggests the mods others made for this site; nothing is fetched before Morse opens", { skip }, async () => {
  await settle(page); // the runtime is ready (hello, mods): anything it fetches at load has been asked for
  assert.equal(indexHits, 0, "opening the page alone doesn't ask the gallery");
  await pressOpen(page);
  await waitFor(s => s.open);
  const chip = ui(".sugs .gl-sug");
  await chip.waitFor();
  assert.equal(await chip.textContent(), `2 mods for 127.0.0.1:${port}`);
  assert.equal(indexHits, 1, "the host fetched the list once");
  // The gallery is cached by the host: a second look doesn't fetch again.
  const cache = JSON.parse(await fs.readFile(path.join(home, "gallery.json"), "utf8"));
  assert.equal(Object.keys(cache.index)[0], process.env.MORSE_GALLERY_URL);
  assert.ok(cache.index[process.env.MORSE_GALLERY_URL].entries.length >= 16);

  // While pointing, the bar moves away from the mouse; the keyboard reaches the
  // chips: Tab to the suggestions, End to the last one, Enter.
  await page.keyboard.press("Tab");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.className), "sug gl-sug");
  await page.keyboard.press("Enter");
  await waitFor(s => !s.open);
  await ui(".panel .gl-site.open").waitFor();
  const items = ui(".panel .gl-item");
  assert.equal(await items.count(), 2);
  assert.match(await items.nth(0).textContent(), /Sleep timer.*“add a sleep timer that pauses the music after 15, 30 or 60 minutes”.*Adds buttons to the page.*by Morse team · version 2/s);
  assert.match(await items.nth(1).textContent(), /Bigger rounded covers.*Changes how the page looks.*by Morse team/s);
  assert.equal(indexHits, 1);
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: Mods for this site in the panel");
});

test("Try it runs the mod without saving it, and Undo takes it all away", { skip }, async () => {
  await ui('.gl-item[data-glid="tunes-sleep-timer"] [data-gl=try]').click();
  // The same review as Install…, and nothing on the page before Try it.
  const card = ui(".modal .card");
  await card.waitFor();
  assert.match(await card.locator("header").textContent(), /Try “Sleep timer”\?.*Nothing runs until you press Try it/s);
  assert.match(await card.textContent(), /What it does.*Adds buttons to the page/s);
  assert.match(await card.textContent(), new RegExp(`For 127\\.0\\.0\\.1:${port}`));
  assert.equal(await card.locator(".ctl-code pre").count(), 2, "Show code is there");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".morse-sleep").count(), 0, "nothing runs before Try it");
  assert.equal(await page.locator('style[data-morse-css="tunes-sleep-timer"]').count(), 0);
  await card.locator("[data-a=install]").click();
  await page.locator(".morse-sleep").waitFor();
  assert.equal(await page.locator('style[data-morse-css="tunes-sleep-timer"]').count(), 1);
  await ui(".gl-trial").waitFor();
  assert.match(await ui(".gl-trial").textContent(), /Trying “Sleep timer”.*Nothing is saved yet/);
  assert.match(await ui('.gl-item[data-glid="tunes-sleep-timer"]').textContent(), /On this page now/);
  // The same two words as any unsaved change: Save and Undo (docs/WRITING.md).
  assert.deepEqual(await ui(".gl-trial button").allTextContents(), ["Undo", "Save"]);
  assert.deepEqual(await ui('.gl-item[data-glid="tunes-sleep-timer"] .gl-btns button').allTextContents(), ["Save", "Undo"]);
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: trying a mod");
  assert.equal(await exists(modFile("tunes-sleep-timer")), false, "trying saves nothing");
  // The trial's button works like the real thing.
  await page.locator(".morse-sleep").click();
  await page.locator(".morse-sleep.on span").waitFor();

  await ui('.gl-item[data-glid="tunes-sleep-timer"] [data-gl=remove]').click();
  await page.locator(".morse-sleep").waitFor({ state: "detached" });
  assert.equal(await page.locator('style[data-morse-css="tunes-sleep-timer"]').count(), 0);
  await ui(".gl-trial").waitFor({ state: "hidden" });
  assert.equal(await exists(modFile("tunes-sleep-timer")), false);
  await ui('.gl-item[data-glid="tunes-sleep-timer"] [data-gl=try]').waitFor(); // back to Try it once the panel redraws
});

test("Save keeps a tried mod, with where it came from", { skip }, async () => {
  const grid = page.locator('[data-testid="album-grid"]').first();
  assert.equal(await grid.evaluate(e => getComputedStyle(e).columnGap), "18px");
  await ui('.gl-item[data-glid="tunes-big-covers"] [data-gl=try]').click();
  await ui(".modal .card [data-a=install]").click(); // Try it, in the review
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="album-grid"]')).columnGap === "24px");
  // Save from the strip at the top (the panel can be closed meanwhile).
  await ui(".gl-trial [data-gl=keep]").click();
  await until(() => exists(modFile("tunes-big-covers")));
  const mod = await readMod("tunes-big-covers");
  assert.deepEqual(mod.gallery, { id: "tunes-big-covers", version: 1 });
  assert.equal(mod.enabled, true);
  assert.equal(mod.imported, true);
  assert.deepEqual(mod.match.hosts, [`127.0.0.1:${port}`]);
  await ui('.panel article[data-id="tunes-big-covers"]').waitFor();
  assert.match(await ui('.panel article[data-id="tunes-big-covers"]').textContent(), /Installed from the Morse gallery by Morse team/);
  assert.equal(await ui('.gl-item[data-glid="tunes-big-covers"]').count(), 0, "installed mods leave For this site");
  assert.match(await ui(".gl-head").textContent(), new RegExp(`1 mod for 127\\.0\\.0\\.1:${port}`));
  assert.equal(await grid.evaluate(e => getComputedStyle(e).columnGap), "24px", "still applied, now as a saved mod");
});

test("Install… goes through the install review, and nothing installs until you press Install", { skip }, async () => {
  await ui('.gl-item[data-glid="tunes-sleep-timer"] [data-gl=install]').click();
  const card = ui(".modal .card");
  await card.waitFor();
  assert.match(await card.locator("header").textContent(), /Install “Sleep timer”\?.*Nothing is installed until you press Install/s);
  assert.match(await card.textContent(), /What it does.*Adds buttons to the page/s);
  assert.match(await card.textContent(), /made by Morse team/);
  assert.equal(await card.locator(".ctl-code pre").count(), 2, "the code is there before installing");
  assert.equal(await exists(modFile("tunes-sleep-timer")), false);
  await card.locator("[data-a=install]").click();
  await until(() => exists(modFile("tunes-sleep-timer")));
  const mod = await readMod("tunes-sleep-timer");
  assert.deepEqual(mod.gallery, { id: "tunes-sleep-timer", version: 2 });
  await page.locator(".morse-sleep").waitFor();
  await ui('.panel article[data-id="tunes-sleep-timer"]').waitFor();
  assert.match(await ui('.panel article[data-id="tunes-sleep-timer"]').textContent(), /Installed from the Morse gallery by Morse team/);
  assert.equal(await ui(".gl-site").count(), 0, "every mod for this site is installed");
});

test("Update available when the gallery has a newer version; Update… shows what changed first", { skip }, async () => {
  // As if version 1 had been installed last week.
  const v2 = await readMod("tunes-sleep-timer");
  const v1 = { ...v2, version: 1, gallery: { id: "tunes-sleep-timer", version: 1 },
    js: v2.js.replace("const steps = [15, 30, 60, 0];", "const steps = [30, 60];").replace(/\n  const render[\s\S]*?\n  };\n/, "\n  const render = () => btn.classList.toggle(\"on\", left > 0);\n") };
  assert.notEqual(v1.js, v2.js);
  await fs.writeFile(modFile("tunes-sleep-timer"), JSON.stringify(v1, null, 2));
  await page.reload();
  await waitForReady(page);
  await page.locator(".morse-sleep").waitFor();
  await page.keyboard.press("Alt+Shift+KeyM");
  const row = ui('.panel article[data-id="tunes-sleep-timer"]');
  await row.locator(".gl-upd").waitFor();
  assert.match(await row.locator(".gl-upd").textContent(), /Update available\. Version 2: Shows the time left on the button/);
  assert.equal(await ui('.panel article[data-id="tunes-big-covers"] .gl-upd').count(), 0, "the other one is up to date");

  await row.locator("[data-gl=update]").click();
  const card = ui(".modal .card");
  await card.waitFor();
  assert.match(await card.locator("header").textContent(), /Update “Sleep timer”\?.*Version 1 to version 2/s);
  assert.match(await card.locator(".gl-what").textContent(), /What changed.*Shows the time left on the button.*Style: no change · Script: \d+ lines? added, \d+ lines? removed/s);
  assert.ok(await card.locator(".gl-diff .add").count() > 0);
  assert.ok(await card.locator(".gl-diff .del").count() > 0);
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: the update review");
  assert.equal((await readMod("tunes-sleep-timer")).gallery.version, 1, "nothing changes before Update");

  await card.locator("[data-gl=apply]").click();
  await until(async () => (await readMod("tunes-sleep-timer")).gallery.version === 2);
  const mod = await readMod("tunes-sleep-timer");
  assert.equal(mod.js, v2.js);
  assert.equal(mod.history.length, 1, "the old version stays in History");
  assert.equal(mod.history[0].js, v1.js);
  await row.locator(".gl-upd").waitFor({ state: "detached" });
  // The new code is what runs now: 15 minutes first, with the time on the button.
  await page.locator(".morse-sleep").click();
  await page.locator(".morse-sleep span").waitFor();
  assert.match(await page.locator(".morse-sleep span").textContent(), /^1[45]:\d\d$/);
});

test("Submit to the gallery is in the Share dialog for your own mods only", { skip }, async () => {
  await page.keyboard.press("Escape").catch(() => {});
  // A mod made here (not from the gallery).
  await fs.writeFile(modFile("mine1"), JSON.stringify({ morse: 1, id: "mine1", title: "Quiet nav", prompt: "make the sidebar quieter",
    match: { hosts: [`127.0.0.1:${port}`], app: null }, target: null, css: "nav { opacity: .8 }", js: "", enabled: true, created: new Date().toISOString(), updated: new Date().toISOString() }));
  await page.reload();
  await waitForReady(page);
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui('.panel article[data-id="mine1"] [data-a=share]').click();
  await ui(".modal .card [data-gl=submit]").waitFor();
  assert.equal(await ui(".modal .card [data-gl=submit]").textContent(), "Submit to the gallery…");
  await ui(".modal .card [data-a=close]").first().click();
  await ui('.panel article[data-id="tunes-sleep-timer"] [data-a=share]').click();
  await ui(".modal .card .exports").waitFor();
  assert.equal(await ui(".modal .card [data-gl=submit]").count(), 0, "a gallery mod is already in the gallery");
});

test("Show mods others made, turned off, hides the section and the chip", { skip }, async () => {
  await ui(".modal .card [data-a=close]").first().click();
  await fs.rm(modFile("tunes-big-covers"));
  await page.reload();
  await waitForReady(page);
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(".panel .gl-site").waitFor();
  await ui(".panel .gl-head").click();
  await ui(".panel [data-gl=off]").click();
  await ui(".panel .gl-site").waitFor({ state: "detached" });
  await until(async () => JSON.parse(await fs.readFile(path.join(home, "settings.json"), "utf8")).gallery === false);
  const hits = indexHits;
  await page.reload();
  await waitForReady(page);
  await pressOpen(page);
  await waitFor(s => s.open);
  await ui(".sugs .sug").first().waitFor();
  assert.equal(await ui(".sugs .gl-sug").count(), 0);
  assert.equal(indexHits, hits);
});
