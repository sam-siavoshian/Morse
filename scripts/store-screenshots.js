// The five Chrome Web Store screenshots (1280x800), taken on real public
// websites with the real built extension and a real model:
//
//   npm run store:screenshots      (DISPLAY=:99 on a machine without a screen)
//     MORSE_PROVIDER=claude-code MORSE_MODEL=sonnet  the model (these are the defaults)
//     ONLY=1,3                                        retake some of them
//     PROXY=http://…                                  the proxy Chromium uses (default: $HTTPS_PROXY)
//
// Chromium loads dist/extension with "Allow User Scripts" on, pairs it with
// `morse serve` (demo/helper.js) and Playwright plays the user: the Open Morse
// key, pointing, typing, Enter. The gallery list comes from this checkout
// (site/mods/index.json, served locally) so the shot doesn't depend on GitHub
// Pages. Every frame is checked to be exactly 1280x800 and written to
// docs/store/screenshots/. docs/store/README.md lists what each one shows and
// its caption.
//
// A real model writes different code each time: look at every picture, and
// retake one with ONLY=n until it reads well.

import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "docs", "store", "screenshots");

// [file, what it shows, caption for the store]
export const STORE_SHOTS = [
  ["1-describe-a-change.png", "pkg.go.dev: the bar while a change is being written; the code examples already dark and the survey banner gone", "Say what to change. You see it change while it is being written."],
  ["2-save-what-you-like.png", "pypi.org: copy buttons added to the code examples, with Save, Undo, Edit code and Share", "Add what a site is missing. Save it, and it is there every time you come back."],
  ["3-your-mods.png", "pypi.org: the Mods panel with three saved mods", "Your saved changes for a site in one place. Turn each one on or off."],
  ["4-mods-others-made.png", "The Tunes demo app: a mod from the gallery, tried before saving", "Try changes other people made. Save the ones you like."],
  ["5-edit-tools.png", "rubygems.org: the Edit tools on the heading, recolored from the palette; no model needed", "Edit tools change the page at once: hide, move, resize, recolor, rename."],
];

export function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.MORSE_PROVIDER ||= "claude-code";
  process.env.MORSE_MODEL ||= "sonnet";
  const { startHelper, pairExtension, routeHelper, seasonExtension, openBar, pick, demoSites } = await import("../demo/helper.js");
  const { chromium } = createRequire(import.meta.url)("playwright");
  const EXT = path.join(root, "dist", "extension");
  const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const say = s => console.log(`· ${s}`);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-store-"));
  await fs.mkdir(OUT, { recursive: true });

  // The gallery list and mod files from this checkout.
  const list = http.createServer(async (req, res) => {
    const p = path.join(root, "site", "mods", path.basename(new URL(req.url, "http://x").pathname));
    try { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }).end(await fs.readFile(p)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => list.listen(0, "127.0.0.1", r));
  const LIST_URL = `http://127.0.0.1:${list.address().port}/index.json`;

  const helper = await startHelper(path.join(tmp, "helper-home"));
  const proxy = process.env.PROXY || process.env.HTTPS_PROXY;
  const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
    headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", ...(proxy ? [`--proxy-server=${proxy}`] : [])],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const setup = await ctx.newPage();
  await setup.goto(`chrome://extensions/?id=${id}`);
  await setup.locator("#allow-user-scripts").click();
  await sleep(500);
  await setup.close();
  for (const p of ctx.pages()) if (/\/(welcome|options)\.html/.test(p.url())) await p.close();
  await seasonExtension(sw);
  await sw.evaluate(u => chrome.storage.local.set({ "morse.gallery.url": u }), LIST_URL);
  await routeHelper(ctx, helper);
  await pairExtension(ctx, id, helper.code);
  say(`extension ${id} paired with ${process.env.MORSE_PROVIDER} · ${process.env.MORSE_MODEL}`);

  const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")).catch(() => null);
  async function until(fn, ms, what) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
    throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
  }
  async function open(url, tidy) {
    const page = await ctx.newPage();
    page.on("pageerror", e => console.log("  ! pageerror", e.message.split("\n")[0]));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await until(() => status(page), 30000, "Morse in the page");
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    await sleep(2500);
    // The site's own cookie and survey banners, closed the way a visitor would.
    if (tidy) await page.evaluate(tidy).catch(() => {});
    await sleep(300);
    return page;
  }
  const ui = (page, sel) => page.locator(`[data-morse-ui] ${sel}`);
  async function shot(page, n) {
    const [file] = STORE_SHOTS[n - 1];
    const buf = await page.screenshot();
    const { width, height } = pngSize(buf);
    if (width !== 1280 || height !== 800) throw new Error(`${file} is ${width}x${height}; the store wants 1280x800.`);
    await fs.writeFile(path.join(OUT, file), buf);
    say(`docs/store/screenshots/${file}`);
  }
  async function describe(page, text, point) {
    await openBar(page);
    await sleep(300);
    if (point) await pick(page, point.sel, point.fx ?? 0.5, point.fy ?? 0.5);
    else await page.mouse.move(160, 120, { steps: 4 }); // a small part of the page near the top: the bar stays at the bottom
    await until(async () => (await status(page))?.focus === "in", 10000, "the bar's text box");
    await page.keyboard.insertText(text);
    await until(async () => (await status(page))?.input === text, 10000, "the request in the bar");
    await page.keyboard.press("Enter");
  }
  const result = async page => {
    let said = Date.now();
    try {
      return await until(async () => {
        const s = await status(page);
        if (process.env.DEBUG && Date.now() - said > 5000) { said = Date.now(); say(`  waiting: ${JSON.stringify({ phase: s?.phase, hint: s?.hint, open: s?.open, ticker: s?.ticker?.slice(-60) })}`); }
        if (s?.phase === "idle" && /^Answered/.test(s.hint)) return { ...s, phase: "error", hint: "the model answered instead of making a change" };
        return ["result", "error"].includes(s?.phase) && s;
      }, 180000, "a result");
    } catch (e) {
      await page.screenshot({ path: path.join(tmp, "stuck.png") }).catch(() => {});
      say(`stuck; picture in ${path.join(tmp, "stuck.png")}`);
      throw e;
    }
  };
  const want = n => !ONLY || ONLY.has(n);

  // ---- 1. pkg.go.dev: the change shows while it is written
  if (want(1)) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const page = await open("https://pkg.go.dev/net/http", () => {
        document.querySelector(".js-surveyBannerClose")?.click();
        [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Okay")?.click();
      });
      await page.evaluate(() => scrollTo(0, 300));
      await sleep(500);
      await describe(page, "put the code examples on a dark background with bigger text, and hide the survey banner");
      // The moment the new style is on the page while the model is still writing.
      const caught = await until(async () => {
        const s = await status(page);
        if (s?.phase === "result" || s?.phase === "error") return "late";
        const live = await page.evaluate(() => [...document.querySelectorAll("style[data-morse-css]")].reduce((n, st) => n + (st.sheet?.cssRules?.length || 0), 0)).catch(() => 0);
        return live >= 2 && s?.ticker?.length > 40 ? "now" : null;
      }, 300000, "the change to start showing");
      if (caught === "now") { await sleep(250); if (process.env.DEBUG) say(JSON.stringify(await status(page))); await shot(page, 1); await result(page); await page.close(); break; }
      say(`attempt ${attempt}: the change was done before the picture; again`);
      await page.close();
    }
  }

  // ---- 2 and 3. pypi.org: a new feature, saved; then the Mods panel
  if (want(2) || want(3)) {
    const URL_PYPI = "https://pypi.org/project/requests/";
    const page = await open(URL_PYPI);
    // Two mods made earlier on this site, the same way.
    for (const ask of ["hide the security notice banner at the top", "make the pip install command bigger"]) {
      await describe(page, ask);
      const r = await result(page);
      if (r.phase === "error") throw new Error(`pypi "${ask}": ${r.hint}`);
      await page.keyboard.press("Enter"); // Save
      await until(async () => (await status(page))?.phase === "idle", 15000, "the save");
      await page.keyboard.press("Escape");
      await sleep(400);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await describe(page, "add a copy button to the top right corner of every code example", { sel: ".project-description pre", fx: 0.5, fy: 0.3 });
    const r = await result(page);
    if (r.phase === "error") throw new Error(`pypi copy buttons: ${r.hint}`);
    await sleep(800);
    await page.mouse.move(1100, 560);
    await sleep(300);
    if (want(2)) await shot(page, 2);
    await page.keyboard.press("Enter"); // Save
    await sleep(800);
    await page.keyboard.press("Escape");
    await sleep(300);
    if (want(3)) {
      await page.keyboard.press("Alt+Shift+KeyM");
      await ui(page, ".panel article").first().waitFor({ timeout: 15000 });
      await sleep(600);
      await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());
      await page.mouse.move(400, 500);
      await sleep(400);
      await shot(page, 3);
    }
    await page.close();
  }

  // ---- 4. The Tunes demo app: a mod from the gallery, tried before saving.
  // (The gallery's mods for real sites are for sites that need an account,
  // or that the machine taking these pictures may not reach.)
  if (want(4)) {
    const sites = await demoSites();
    await sites.route(ctx);
    // One mod of your own on this app, made a few days ago.
    const made = new Date(Date.now() - 3 * 86400e3).toISOString();
    await sw.evaluate(async m => chrome.storage.local.set({ mods: { ...(await chrome.storage.local.get("mods")).mods, [m.id]: m } }), {
      morse: 1, id: "quiet-sidebar", title: "Quieter sidebar", prompt: "make the sidebar quieter so the albums stand out",
      match: { hosts: ["127.0.0.1:8789"], app: null }, target: { selector: "nav", label: "Sidebar" },
      css: "nav { background: #0b0b0b !important; }\nnav a:not(.on) { color: #7d7d7d !important; }\n", js: "",
      enabled: true, model: "Claude Code · sonnet", created: made, updated: made,
    });
    const page = await open(sites.url("tunes"));
    await page.keyboard.press("Alt+Shift+KeyM");
    await ui(page, ".panel .gl-site").first().waitFor({ timeout: 30000 });
    if (!(await ui(page, ".panel .gl-site .gl-item").count())) await ui(page, ".panel .gl-site .gl-show").first().click();
    await ui(page, '.gl-item[data-glid="tunes-big-covers"] [data-gl=try]').click();
    await ui(page, ".modal .card [data-a=install]").click(); // Try it, after the same review as Install…
    await ui(page, ".gl-item.trying").waitFor();
    await sleep(1200);
    await page.evaluate(() => {
      const sr = document.querySelector("[data-morse-ui]").shadowRoot;
      sr.activeElement?.blur();
      sr.querySelector(".panel .gl-site")?.scrollIntoView({ block: "start" });
    });
    await page.mouse.move(500, 790);
    await sleep(400);
    await shot(page, 4);
    await page.close();
    await sites.close();
  }

  // ---- 5. rubygems.org: the Edit tools
  if (want(5)) {
    const page = await open("https://rubygems.org/gems/rails");
    await openBar(page);
    await sleep(300);
    await pick(page, "h1:has-text(\"rails\")", 0.5, 0.5);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+KeyE" : "Control+KeyE");
    await sleep(400);
    // A new color from the palette (C).
    await page.keyboard.press("c");
    await sleep(300);
    await page.locator(".gm-sw button[data-c='#ef4444']").click();
    await sleep(200);
    await page.locator(".gm-sw button[data-c='#ef4444']").hover();
    await sleep(700);
    await shot(page, 5);
    await page.close();
  }

  await ctx.close();
  helper.stop();
  list.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}
