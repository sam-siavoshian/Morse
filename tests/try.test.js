// Try it here (site/try/), the landing page's live demo, in real Chromium on
// a fresh npm run pages build, served the way GitHub Pages serves it:
//
//   - nothing of it loads until the section scrolls into view
//   - the demo app runs in a frame sandboxed with allow-scripts only: it can't
//     reach the page or its storage
//   - a suggested change runs through the real runtime and engine (the demo
//     model's sleep timer, whose first try fails on purpose and is fixed)
//   - Save, then Reload app, and it comes back
//   - a request with no sample answer gets the install note, not a change
//   - Page tools work with the bar's shadow root closed, as on real pages
//   - on a 390px phone: tap to open, tap to point, tap a change, no sideways
//     scroll
//   - no request leaves the site
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsp } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { TIMEOUT, waitFor } from "./helpers/wait.js";

// dist/pages for this test only, served the way GitHub Pages serves it.
async function servePages() {
  const out = mkdtempSync(path.join(os.tmpdir(), "morse-pages-"));
  const { buildPages } = await import("../scripts/build-pages.js");
  await buildPages({ out, refresh: false });
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4" };
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(out, path.normalize(p));
    if (!file.startsWith(out)) return res.writeHead(403).end();
    try { res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(await fsp.readFile(file)); }
    catch { res.writeHead(404).end("not found"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); server.close(); rmSync(out, { recursive: true, force: true }); } };
}

test("Try it here: loads on scroll, makes a suggested change with the real runtime, keeps it after Save and a reload, and points an unknown request to install", { skip: noBrowser, timeout: TIMEOUT * 8 }, async () => {
  const site = await servePages();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (o) {
        const r = attach.call(this, o);
        if (this.hasAttribute("data-morse-ui")) { window.__morseRoot = r; window.__morseRootMode = o.mode; }
        return r;
      };
    });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const requests = [];
    page.on("request", r => requests.push(r.url()));
    await page.goto(`${site.origin}/site/`);
    await page.waitForLoadState("load");
    const status = page.locator("#try .try-status");
    const kind = () => status.getAttribute("data-kind");

    // Nothing of the demo on the first load.
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#try .try-frame").count(), 0, "no demo frame before the section is in view");
    const heavy = u => /\/try\/(try|frame)\.js|runtime\.js|demo\/sites\/|core\/engine\.js/.test(u);
    assert.ok(!requests.some(heavy), `the demo isn't loaded up front: ${requests.filter(heavy).join(", ")}`);
    assert.ok(await page.locator("#try .try-open").count(), "the section itself is there, with its buttons");

    // Scrolling to it loads it: the app, in a frame sandboxed away from the page.
    await page.locator("#try").scrollIntoViewIfNeeded();
    await page.waitForSelector("#try.is-live", { timeout: TIMEOUT });
    const frameEl = page.locator("#try .try-frame");
    assert.equal(await frameEl.getAttribute("sandbox"), "allow-scripts", "scripts only: no same origin, no pop-ups, no top navigation");
    const app = () => page.frames().find(f => f.parentFrame() === page.mainFrame() && !f.isDetached());
    await waitFor(() => app()?.evaluate(() => !!document.querySelector("[data-morse-ui]") && !!window.__morseHost), { what: "the runtime in the demo app" });
    assert.equal(await app().evaluate(() => { try { return parent.document.title; } catch { return "blocked"; } }), "blocked", "the app can't reach the page");
    assert.equal(await app().evaluate(() => { try { return String(localStorage.length); } catch { return "blocked"; } }), "blocked", "nor the site's storage");

    // A suggested change: the real runtime, the demo model's sleep timer (its
    // first try fails on purpose, and Morse fixes it), the button in the player.
    await page.locator('#try [data-try="ask"][data-text="Add a sleep timer"]').click();
    await waitFor(async () => (await kind()) === "done", { what: "the change" });
    assert.equal(await app().locator('[data-testid="player-controls"] .morse-sleep').count(), 1, "the sleep timer is in the player");
    assert.match(await status.innerText(), /Press Save in the bar/);
    assert.match(await status.innerText(), /fixed it/, "the first try's mistake was fixed by the real engine");

    // Save (Enter in the bar, once it shows the result), then Reload app: it comes back.
    const bar = () => app().evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status || "{}"));
    await waitFor(async () => (await bar()).phase === "result", { what: "the result in the bar" });
    await page.keyboard.press("Enter");
    await waitFor(async () => (await kind()) === "saved", { what: "Saved" });
    const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:try:mods:tunes") || "{}")).map(m => m.title));
    assert.deepEqual(saved, ["Sleep timer"]);
    assert.match(await page.locator("#try .try-count").innerText(), /1 saved change/);
    const before = app();
    await page.locator('#try [data-try="reload"]').click();
    await waitFor(async () => app() && app() !== before && (await app().locator(".morse-sleep").count()) === 1, { what: "the sleep timer back after Reload app" });
    await waitFor(async () => (await kind()) === "back", { what: "Reloaded" });

    // A request with no sample answer: a plain note in the bar and here, no change.
    await page.locator('#try [data-try="open"]').click();
    await waitFor(async () => (await bar()).open, { what: "the bar open" });
    await page.keyboard.type("make the logo purple");
    await page.keyboard.press("Enter");
    await waitFor(async () => (await kind()) === "unknown", { what: "the install note" });
    assert.match(await status.innerText(), /sample answers.*Get Morse/s);
    const install = await page.locator("#try").getAttribute("data-install");
    assert.equal(await status.locator(`a[href="${install}"]`).count(), 1, "Get Morse goes where the page says");
    assert.equal(await app().evaluate(() => document.querySelectorAll("style[data-morse-css]").length), 1, "nothing but the saved sleep timer's style on the page");
    assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("morse:try:mods:tunes") || "{}")).length), 1, "and nothing new saved");

    // Page tools need no model: Light mode from the menu, with real clicks.
    // The bar's shadow root is closed here, as on every real page (the init
    // script only lets the test find where its buttons are).
    const frameBox = await frameEl.boundingBox();
    const clickIn = async sel => {
      const r = await app().evaluate(s => { const b = window.__morseRoot?.querySelector(s)?.getBoundingClientRect(); return b && b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; }, sel);
      assert.ok(r, `${sel} is on screen`);
      await page.mouse.click(frameBox.x + r.x, frameBox.y + r.y);
    };
    assert.equal(await app().evaluate(() => window.__morseRootMode), "closed");
    await clickIn(".gm-qbtn");
    await waitFor(() => app().evaluate(() => !window.__morseRoot.querySelector(".gm-menu").hidden), { what: "the Page tools menu" });
    await clickIn('.gm-menu button[data-k="light"]');
    await waitFor(async () => /Saved “Light mode”/.test(await status.innerText()), { what: "Light mode saved" });
    await waitFor(() => app().evaluate(() => /invert/.test(getComputedStyle(document.documentElement).filter)), { what: "the app turned light" });

    // Everything came from this site: no other server was asked for anything.
    const away = requests.filter(u => !u.startsWith(site.origin) && !/^(data|about|blob):/.test(u));
    assert.deepEqual(away, [], "no network calls beyond the site's own files");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    site.close();
  }
});

test("Try it here on a phone: tap to open, tap a change, and nothing scrolls sideways at 390px", { skip: noBrowser, timeout: TIMEOUT * 6 }, async () => {
  const site = await servePages();
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${site.origin}/site/`);
    await page.locator("#try .try-open").scrollIntoViewIfNeeded();
    await page.waitForSelector("#try.is-live", { timeout: TIMEOUT });
    const app = () => page.frames().find(f => f.parentFrame() === page.mainFrame() && !f.isDetached());
    const bar = () => app().evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]"))?.dataset.status || "{}"));
    await waitFor(async () => (await bar()).ready, { what: "the runtime in the demo app" });

    // The window spans the phone, edge to edge; the page never scrolls sideways.
    const win = await page.locator("#try .try-window").boundingBox();
    assert.ok(win.x <= 0 && win.x + win.width >= 389, `the app is as wide as the phone (${win.x}, ${win.width})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");

    await page.locator("#try .try-open").tap();
    await waitFor(async () => (await bar()).open, { what: "the bar open after a tap" });
    // A tap points (there is no mouse moving over the page first).
    const cover = await app().locator(".q8c").first().boundingBox();
    await page.touchscreen.tap(cover.x + cover.width / 2, cover.y + cover.height / 2);
    await waitFor(async () => /^Describe a change/.test((await bar()).hint), { what: "a cover pointed at with a tap" });
    await page.locator('#try [data-try="ask"][data-text="Make the covers bigger"]').tap();
    await waitFor(async () => (await page.locator("#try .try-status").getAttribute("data-kind")) === "done", { what: "the change" });
    assert.equal(await app().evaluate(() => getComputedStyle(document.querySelector('[data-testid="album-grid"]')).rowGap), "24px", "the covers changed");
    const box = await page.locator("#try .try-window").boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 844, "the whole app is in view while Morse works in it");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "still no sideways scroll");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    site.close();
  }
});
