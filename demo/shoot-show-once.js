// Show me once screenshots (118-123): the real runtime on the Postbox demo
// site with the stand-in host and the demo model (demo/show-once-page.js),
// Playwright playing the user.
//   118 · the ways in: the chip under the input, and the ⋯ menu
//   119 · recording: the strip lists each step as the user does it
//   120 · after Stop: the steps in the bar, waiting for what to do with them
//   121 · the result: a button that archives every unread email, live
//   122 · it worked: every unread email archived
//   123 · a sign-in: the password is recorded as "(hidden)"
//
//   DISPLAY=:99 node demo/shoot-show-once.js

import path from "node:path";
import { createRequire } from "node:module";
import { openSite } from "./show-once-page.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return; } catch {} await sleep(50); }
  throw new Error("timed out: " + fn);
}

const browser = await chromium.launch();
let { page, ctx } = await openSite(browser, "mail");
const shot = async (name, settle = 350) => { await sleep(settle); await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };

// ---- 118: the chip in the empty bar, and the ⋯ menu
await page.mouse.move(900, 600);
await page.keyboard.press(OPEN_KEY);
await page.locator(".sugs .so-sug").waitFor();
await page.locator(".bar .more").focus();
await page.keyboard.press("Enter");
await page.locator(".bmenu [data-m=showonce]").waitFor();
await shot("118-show-once-start.png");

// ---- 119: recording; the user opens Leo's email and archives it
await page.keyboard.press("Enter"); // the first menu item: Show me once
await page.locator(".so-strip").waitFor();
await page.locator(".r9", { hasText: "Leo Martins" }).click();
await page.locator(".rd .acts button", { hasText: "Archive" }).click();
await page.mouse.move(1000, 500);
await shot("119-show-once-recording.png");

// ---- 120: Stop; the steps wait in the bar
await page.locator(".so-strip [data-so=stop]").click();
await until(async () => (await status(page)).open);
await page.locator(".so-card .so-eyebrow").hover(); // on the bar, so nothing on the page is outlined for pointing
await shot("120-show-once-steps.png");
await page.locator(".sugs .sug", { hasText: "Do it to every" }).click();
await page.keyboard.type("unread email", { delay: 20 });

// ---- 121: the result, live: a button that does it for every unread email
await page.keyboard.press("Enter");
await until(async () => (await status(page)).phase === "result");
await page.locator(".morse-so-btn").waitFor();
await until(async () => /\(3\)/.test(await page.locator(".morse-so-btn").innerText()));
await page.mouse.move(1000, 500);
await shot("121-show-once-result.png", 600);

// ---- 122: Save, then use it: every unread email archived
await page.locator(".actions [data-a=keep]").click();
await until(async () => !(await status(page)).open);
await sleep(3000); // let the "Saved" note go
await page.locator(".morse-so-btn").click();
await until(() => page.evaluate(() => !document.querySelector('.r9[data-unread="true"]')));
await page.mouse.move(1000, 500);
await shot("122-show-once-done.png", 250);
await ctx.close();

// ---- 123: a sign-in, recorded: the password is never kept
({ page, ctx } = await openSite(browser, "mail", { file: "signin.html" }));
await page.keyboard.press(OPEN_KEY);
await page.locator(".sugs .so-sug").click();
await page.locator(".so-strip").waitFor();
await page.locator("[name=email]").click();
await page.keyboard.type("sam@rivera.me", { delay: 10 });
await page.locator("[name=password]").click();
await page.keyboard.type("correct horse battery", { delay: 10 });
await page.locator("text=Keep me signed in").click();
await page.locator("button", { hasText: "Sign in" }).click();
await page.mouse.move(200, 200);
await shot("123-show-once-hidden.png");
await ctx.close();

await browser.close();
