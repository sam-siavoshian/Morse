// Screenshots of the landing page's Try it here (site/try/) for docs/site/:
// the sleep timer being written in the demo app (the radar over the player)
// and the result, at 1440×900 and 390×844, and the note for a request it has
// no sample answer for.
//
//   npm run build && node demo/shoot-try.js     (SHOTS=dir to write elsewhere)
//
// Try it here loads the runtime from dist/runtime/runtime.js, which
// npm run build writes. The site is served from this checkout.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { demoSites } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "site"));
await fs.mkdir(OUT, { recursive: true });
await fs.access(path.join(root, "dist", "extension", "runtime.js")).catch(() => { throw new Error("Run npm run build first: Try it here needs dist/runtime/runtime.js"); });
const sites = await demoSites();
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const shot = async (p, name) => {
  await p.screenshot({ path: path.join(OUT, name) });
  console.log("  📸", name);
};
const kindIs = (p, kind) => p.waitForFunction(k => document.querySelector("#try .try-status").dataset.kind === k, kind, { timeout: 60000 });

for (const size of ["desktop", "mobile"]) {
  const touch = size === "mobile";
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  await sites.route(ctx);
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  ! pageerror", e.message));
  await p.goto(sites.url("parley", "/site/"));
  await p.evaluate(() => document.querySelector("#try .try-window").scrollIntoView({ block: "center" }));
  await p.waitForSelector("#try.is-live");
  await sleep(1500);
  await p.locator('#try [data-try="ask"][data-text="Add a sleep timer"]').click();
  await kindIs(p, "working");
  await sleep(1300);
  await shot(p, `try-${size}-working.png`);
  await kindIs(p, "done");
  await sleep(1500);
  await shot(p, `try-${size}-result.png`);
  if (size === "desktop") {
    await p.keyboard.press("Escape"); // keeps the sleep timer, like Save
    await sleep(500);
    await p.locator('#try [data-try="open"]').click();
    await sleep(600);
    await p.keyboard.type("make the logo purple");
    await p.keyboard.press("Enter");
    await kindIs(p, "unknown");
    await sleep(800);
    await shot(p, "try-desktop-unknown.png");
  }
  await ctx.close();
}

await browser.close();
await sites.close();
