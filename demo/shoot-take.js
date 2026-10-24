// Take this, Bring here screenshots (docs/bring-a-feature.md): the real
// runtime on two demo apps with the stand-in host and the demo model
// (demo/show-once-page.js, core/take-demo.js), Playwright playing the person.
//   bring-01 · Take this, in the empty bar of Codepad (a small code editor)
//   bring-02 · watching: the palette is open, the strip says what to do
//   bring-03 · taken: the name and what it does, written by the model
//   bring-04 · in Inkwell (a notes app): Bring here… lists what was taken
//   bring-05 · Bringing: the request is ready in the bar
//   bring-06 · brought: the palette, in Inkwell's own font, colors and corners
//   bring-07 · the Mods panel: the mod says where it came from, and what was taken
// The pictures from real apps (VSCodium, pkg.go.dev, nodejs.org, pypi.org…) come
// from demo/bring-real.js with a real model.
//
//   DISPLAY=:99 node demo/shoot-take.js

import path from "node:path";
import { createRequire } from "node:module";
import { openSite } from "./show-once-page.js";
import { pressOpen } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
async function until(fn, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return; } catch {} await sleep(50); }
  throw new Error("timed out: " + fn);
}

const browser = await chromium.launch();
const { page, ctx } = await openSite(browser, "codepad", { shots: true });
const shot = async (name, settle = 400) => { await sleep(settle); await page.screenshot({ path: path.join(OUT, name) }); console.log("  shot", name); };
const go = async site => {
  await page.goto(`http://sites.morse.test/demo/sites/${site}/index.html`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
};

// ---- Take, in Codepad
await page.mouse.move(700, 500);
await pressOpen(page);
await page.locator(".sugs .tk-take").waitFor();
await page.locator(".sugs .tk-take").hover();
await shot("bring-01-take-this.png");
await page.locator(".sugs .tk-take").click();
await page.locator(".so-strip").waitFor();
await page.keyboard.press("Control+Shift+P");
await page.locator(".quick-input-widget input").waitFor();
await page.keyboard.type("zo");
await shot("bring-02-watching.png");
await page.locator(".so-strip [data-so=stop]").click();
await until(async () => /opens with/.test(await page.locator(".tk-card").innerText()));
await page.mouse.move(1200, 120);
await shot("bring-03-taken.png");
await page.locator(".tk-card [data-tk=done]").click();
await page.keyboard.press("Escape");

// ---- Bring, in Inkwell
await go("notes");
await page.mouse.move(700, 500);
await pressOpen(page);
await page.locator(".sugs .tk-bring").click();
await page.locator(".tk-pick .tk-it").first().waitFor();
await shot("bring-04-bring-here.png");
await page.locator(".tk-pick .tk-it").first().click();
await shot("bring-05-bringing.png");
await page.keyboard.press("Enter");
await until(async () => (await status(page)).phase === "result");
await page.keyboard.press("Escape");
await until(async () => !(await status(page)).open);
await page.keyboard.press("Control+Shift+P");
await page.locator(".morse-pal").waitFor({ state: "visible" });
await page.keyboard.type("rea");
await shot("bring-06-brought.png");
await page.keyboard.press("Escape");
await pressOpen(page);
await page.locator(".actions [data-a=mods]").click();
await page.locator(".panel .tk-site").waitFor();
await shot("bring-07-mods-panel.png");

await ctx.close();
await browser.close();
