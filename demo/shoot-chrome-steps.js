// The one picture the Morse app shows for "Use Morse in Chrome" while Morse
// isn't in the Chrome Web Store (desktop-app/ui/chrome-steps.png): Chrome's
// real extensions page, with Developer mode on, the two places to click
// marked 1 (Developer mode, top right) and 2 (Load unpacked, top left).
//
//   node scripts/build.js && DISPLAY=:99 node demo/shoot-chrome-steps.js
//
// A fresh Chrome profile with the built extension, so the page looks the way
// it does for a person who has a few extensions. The marks are drawn on top of
// the screenshot in a page of their own, then that is captured.

import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const OUT = path.join(root, "desktop-app", "ui", "chrome-steps.png");
const tmp = mkdtempSync(path.join(os.tmpdir(), "morse-chrome-steps-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const W = 760, H = 560; // narrow, so the two places sit close together and read at the size the window shows them
const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  headless: false, viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--lang=en-US"],
});
try {
  const page = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  await page.goto("chrome://extensions");
  await sleep(800);
  // Developer mode on: Load unpacked shows at the top left.
  await page.locator("#devMode").click();
  await page.locator("#loadUnpacked").waitFor({ state: "visible" });
  await sleep(1500); // the row of buttons slides in
  // 1: the switch and its label; 2: the button.
  const toggle = await page.locator("#devMode").boundingBox();
  const label = await page.getByText("Developer mode", { exact: true }).boundingBox().catch(() => null);
  const load = await page.locator("#loadUnpacked").boundingBox();
  if (!toggle || !load) throw new Error("couldn't find Developer mode or Load unpacked on chrome://extensions");
  const dev = label ? { x: Math.min(label.x, toggle.x), y: Math.min(label.y, toggle.y), width: Math.max(label.x + label.width, toggle.x + toggle.width) - Math.min(label.x, toggle.x), height: Math.max(label.y + label.height, toggle.y + toggle.height) - Math.min(label.y, toggle.y) } : toggle;
  // Down to just under the buttons (not the notes below them).
  const bottom = Math.ceil(load.y + load.height + 18);
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: bottom } });

  // The marks: a ring around each, its number on the ring's top left corner.
  // A white strip on top leaves room for the first number.
  const TOP = 16, marks = [{ n: 1, b: dev }, { n: 2, b: load }];
  const view = await ctx.newPage();
  await view.setViewportSize({ width: W, height: bottom + TOP });
  await view.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font:600 17px/1 system-ui,sans-serif">
    <div style="position:relative;width:${W}px;height:${bottom + TOP}px">
    <img style="position:absolute;left:0;top:${TOP}px" src="data:image/png;base64,${shot.toString("base64")}">
    ${marks.map(({ n, b }) => {
      const pad = 7, x = b.x - pad, y = b.y - pad + TOP, w = b.width + pad * 2, h = b.height + pad * 2;
      return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:3px solid #e8590c;border-radius:12px;box-sizing:border-box"></div>
        <div style="position:absolute;left:${x - 13}px;top:${y - 13}px;width:28px;height:28px;border-radius:14px;background:#e8590c;color:#fff;display:grid;place-items:center;box-shadow:0 0 0 2px #fff">${n}</div>`;
    }).join("")}
    </div></body></html>`);
  await sleep(200);
  await view.screenshot({ path: OUT });
  console.log(`made ${path.relative(root, OUT)} (${readFileSync(OUT).length} bytes)`);
} finally { await ctx.close(); }
