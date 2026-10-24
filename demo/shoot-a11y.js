// Easier to use screenshots (100-103): the real runtime on the Riverside
// Library demo site (demo/sites/a11y), with the stand-in host from
// demo/a11y-host.js (real engine, demo model) and the browser's speech
// recorded instead of spoken (demo/a11y-page.js). Playwright plays the user.
//
//   node demo/shoot-a11y.js            (SHOTS=dir to write elsewhere)

import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { openLibrary } from "./a11y-page.js";
import { pressOpen } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
await fs.mkdir(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: path.join(OUT, name), ...opts }); console.log("  shot", name); };
const quiet = page => page.locator(".toast").waitFor({ state: "hidden", timeout: 6000 });
async function tools(page) {
  if (await page.locator(".bar").isHidden()) await pressOpen(page); // the default Open Morse key (core/hotkeys.js)
  await page.locator(".gm-qbtn").click();
  await page.locator(".gm-menu .a11y-group").waitFor();
}
async function turnOn(page, ...kinds) {
  for (const k of kinds) {
    await tools(page);
    await page.locator(`.gm-menu [data-a11y="${k}"]`).click();
    await sleep(250);
  }
  await page.keyboard.press("Escape"); // the menu is closed already: this closes the bar
  await page.locator(".bar").waitFor({ state: "hidden" });
}

// 100. The page tools menu with its "Easier to use" group, three tools on.
{
  const { page, ctx } = await openLibrary(browser);
  await turnOn(page, "readable", "contrast", "underline");
  await tools(page);
  await page.locator('.gm-menu [data-a11y="targets"]').hover();
  await quiet(page);
  await sleep(300);
  await shot(page, "100-easier-to-use.png");
  await ctx.close();
}

// 101. Read aloud: a selected paragraph, its second sentence marked while it's read.
{
  const { page, ctx } = await openLibrary(browser);
  await turnOn(page, "calm"); // no cookie bar or chat bubble in the way
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelectorAll("article p")[2]);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await tools(page);
  await page.locator('.gm-menu [data-a11y="read"]').click();
  await page.locator(".ra").waitFor();
  await page.evaluate(() => { getSelection().removeAllRanges(); window.__speech.finish(); });
  await sleep(200);
  await page.locator(".ra [data-ra=rate]").click(); // 1.25×
  await page.mouse.move(1100, 300);
  await quiet(page);
  await shot(page, "101-read-aloud.png");
  await ctx.close();
}

// 102. Check this page: the list in the bar, a marker on each place.
{
  const { page, ctx } = await openLibrary(browser, { viewport: { width: 1280, height: 860 } });
  await tools(page);
  await page.locator('.gm-menu [data-a11y="check"]').click();
  await page.locator(".au-list").waitFor();
  await page.locator(".au-item").first().locator(".au-fix").hover();
  await sleep(600);
  await shot(page, "102-check-page.png");
  await ctx.close();
}

// 103. Before and after Higher contrast: the same two parts of the page side by side.
{
  const { page, ctx } = await openLibrary(browser, { viewport: { width: 1000, height: 1000 } });
  await page.evaluate(() => document.querySelector(".cookie-bar").remove()); // only the article's own text
  const clips = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect(), art = r("article");
    const clip = (top, bottom, pad = 14) => ({ x: art.left - 16, y: top - pad, width: art.width + 32, height: bottom - top + pad + 14 });
    return [clip(r("article h1").top, r("article p:nth-of-type(2)").bottom), clip(r("figure figcaption").top, r(".light").bottom, 6)];
  });
  const grab = () => Promise.all(clips.map(clip => page.screenshot({ clip })));
  const before = await grab();
  await turnOn(page, "contrast");
  await quiet(page);
  const after = await grab();
  const tokens = await fs.readFile(path.join(root, "design", "tokens.css"), "utf8");
  const img = b => `<img src="data:image/png;base64,${b.toString("base64")}">`;
  const card = await browser.newPage({ viewport: { width: 1360, height: 400 }, deviceScaleFactor: 1, colorScheme: "light" });
  await card.setContent(`<!doctype html><html data-theme="light"><head><style>${tokens}
    body { margin: 0; background: var(--m-bg); font: 400 var(--m-text-md)/1.4 var(--m-font); color: var(--m-text); }
    .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding: 32px 36px 36px; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 8px; }
    figcaption { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
    figcaption b { font-weight: 600; font-size: var(--m-text-lg); }
    figcaption small { color: var(--m-text-3); font: 11px/1 var(--m-mono); letter-spacing: .04em; text-transform: uppercase; }
    img { display: block; width: 100%; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); }
    i { align-self: center; color: var(--m-text-3); font: 11px/1 var(--m-mono); letter-spacing: .3em; font-style: normal; }
  </style></head><body><div class="wrap">
    <figure><figcaption><b>Before</b><small>light gray text, as low as 2.2 to 1</small></figcaption>${img(before[0])}<i>···</i>${img(before[1])}</figure>
    <figure><figcaption><b>Higher contrast</b><small>every line at least 7 to 1 · no model</small></figcaption>${img(after[0])}<i>···</i>${img(after[1])}</figure>
  </div></body></html>`);
  await sleep(200);
  await shot(card, "103-before-after-contrast.png", { fullPage: true });
  await ctx.close();
}

await browser.close();
