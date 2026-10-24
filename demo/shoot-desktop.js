// Drives the desktop connector end to end and screenshots each feature.
// Real path: `morse launch` relaunches a Chromium app window with a debugging
// port, attaches over CDP, injects the runtime. Playwright only plays the
// user (keyboard + mouse) and takes screenshots.
//
//   DISPLAY=:99 MORSE_HOME=/tmp/mh node demo/shoot-desktop.js

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "docs", "screenshots");
const HOME = process.env.MORSE_HOME;
const CHROME = process.env.CHROME || chromium.executablePath();
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
await fs.mkdir(OUT, { recursive: true });

const log = [];
const morse = spawn("node", [path.join(root, "daemon/cli.js"), "launch", CHROME, "--name", "Tunes", "--port", String(PORT), "--",
  "--app=http://127.0.0.1:8789/demo/sites/tunes/", `--user-data-dir=${path.join(HOME, "app-profile")}`,
  "--no-first-run", "--window-size=1280,800", "--window-position=0,0", "--no-sandbox", "--force-device-scale-factor=1"],
  { env: { ...process.env, FORCE_COLOR: "1" } });
morse.stdout.on("data", d => { log.push(String(d)); process.stdout.write(d); });
morse.stderr.on("data", d => process.stderr.write(d));

await sleep(2500);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const page = browser.contexts()[0].pages().find(p => p.url().includes("tunes"));
await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
await page.reload();
await sleep(1500);
const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"));
const shot = async name => { await page.screenshot({ path: path.join(OUT, name) }); console.log("  📸", name); };
async function waitFor(pred, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await status(); if (s && pred(s)) return s; await sleep(40); }
  throw new Error("timeout waiting; last status " + JSON.stringify(await status()));
}

// 1. Ready
await shot("01-desktop-ready.png");

// 2. Hotkey + point
await page.keyboard.press("Alt+Space");
await sleep(300);
const controls = page.locator('[data-testid="player-controls"] .btns');
const box = await controls.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
await sleep(250);
await shot("02-point-at-anything.png");

// 3. Describe it
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(200);
await page.keyboard.type("add a sleep timer that pauses the music after a while", { delay: 18 });
await sleep(200);
await shot("03-say-what-you-want.png");

// 4. Working effect while tokens stream
await page.keyboard.press("Enter");
await waitFor(s => s.ticker.length > 40);
await sleep(500);
await shot("04-the-magic-moment.png");

// 5. First attempt throws; it shows the model the error and fixes itself
await waitFor(s => /fixing/i.test(s.hint));
await sleep(500);
await shot("05-fixes-its-own-bugs.png");

// 6. Result
await waitFor(s => s.phase === "result", 20000);
await sleep(400);
await shot("06-done.png");

// 7. Share: Keep + share card (before/after, cropped to the change) + exports
const clipDir = id => path.join(HOME, "clips");
await sleep(4500); // let ffmpeg finish the clip so the Clip button shows
await page.locator(".actions [data-a=share]").click();
await sleep(1200);
await shot("07-share.png");
for (const a of ["png", "json", "user", "clip"]) {
  const b = page.locator(`.exports [data-a=${a}]`);
  if (await b.count()) { await b.click(); await sleep(400); }
}
await page.keyboard.press("Escape");
await sleep(300);

// 8. Use the new feature
const moon = page.locator(".morse-sleep");
await moon.click();
await sleep(600);
await shot("08-the-new-feature-works.png");

// 9. Page-wide CSS change, applied live while the model is still writing
await page.mouse.move(640, 200);
await page.keyboard.press("Alt+Space");
await sleep(200);
await page.keyboard.type("make the album covers bigger with rounder corners", { delay: 14 });
await page.keyboard.press("Enter");
await waitFor(s => s.ticker.length > 50);
await sleep(1500);
await shot("09-css-applies-while-it-writes.png");
await waitFor(s => s.phase === "result");
await sleep(300);
await page.keyboard.press("Enter"); // Keep
await sleep(700);
await shot("10-covers-done.png");

// 10. Mods panel
await page.keyboard.press("Alt+Shift+KeyM");
await sleep(500);
await shot("11-mods-panel.png");

// 11. Code view / edit
await page.locator(".panel article").first().locator("[data-a=code]").click();
await sleep(400);
await shot("12-edit-the-code.png");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

// 12. Quit the app entirely and relaunch: mods come back on their own
await browser.close();
const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
await (await cdp.newBrowserCDPSession()).send("Browser.close").catch(() => {});
morse.kill();
await sleep(1500);
const morse2 = spawn("node", [path.join(root, "daemon/cli.js"), "launch", CHROME, "--name", "Tunes", "--port", String(PORT), "--",
  "--app=http://127.0.0.1:8789/demo/sites/tunes/", `--user-data-dir=${path.join(HOME, "app-profile")}`,
  "--no-first-run", "--window-size=1280,800", "--window-position=0,0", "--no-sandbox", "--force-device-scale-factor=1"]);
morse2.stdout.on("data", d => process.stdout.write(d));
await sleep(3500);
const b2 = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const p2 = b2.contexts()[0].pages().find(p => p.url().includes("tunes"));
await sleep(1200);
await p2.screenshot({ path: path.join(OUT, "13-still-there-after-restart.png") });
console.log("  📸 13-still-there-after-restart.png");
await (await b2.newBrowserCDPSession()).send("Browser.close").catch(() => {});
morse2.kill();
await fs.writeFile(path.join(HOME, "desktop-log.txt"), log.join(""));
process.exit(0);
