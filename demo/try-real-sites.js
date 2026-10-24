// Morse on real, public websites through the built extension, the way a
// person uses it: Chromium with dist/extension loaded, paired with
// `morse serve` (a real model through it), then on each site the Open Morse
// hotkey, point, describe, Enter, Save, reload: is the change still there?
//
//   node scripts/build.js
//   DISPLAY=:99 MORSE_PROVIDER=claude-code MORSE_MODEL=sonnet node demo/try-real-sites.js [sites.json]
//     SHOTS=/tmp/shots FIRST=1     where pictures go (none unless SHOTS is set), and their first number
//     NO_USER_SCRIPTS=1            leave Chrome's "Allow User Scripts" off
//     PROXY=http://127.0.0.1:3128  the proxy Chromium should use (default: $HTTPS_PROXY)
//
// sites.json: [{ name, url, ask, point?, check, setup? }], where check is JS
// run in the page: false before the change, true after it and after a reload.
// Prints one JSON line per site.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { startHelper, pairExtension } from "./helper.js";

const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const OUT = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
let n = Number(process.env.FIRST || 1);
const T = 300000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(`· ${s}`);
const sites = JSON.parse(await fs.readFile(process.argv[2] || path.join(root, "demo/real-sites.json"), "utf8"));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-sites-"));
if (OUT) await fs.mkdir(OUT, { recursive: true });

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
if (!process.env.NO_USER_SCRIPTS) await setup.locator("#allow-user-scripts").click();
await sleep(500);
for (const p of ctx.pages()) if (p.url().includes("/options.html")) await p.close();
await pairExtension(ctx, id, helper.code);
say(`extension ${id} paired · Allow User Scripts ${process.env.NO_USER_SCRIPTS ? "off" : "on"}`);

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

for (const site of sites) {
  const result = { site: site.name, url: site.url, ask: site.ask };
  const page = await ctx.newPage();
  const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"));
  const shot = async name => { if (OUT) { const f = path.join(OUT, `${n++}-${site.name}-${name}.png`); await page.screenshot({ path: f }); console.log(`  shot ${f}`); } };
  const check = () => page.evaluate(site.check).catch(e => (say("check threw: " + e.message), false));
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await until(status, 30000, "Morse in the page");
    if (site.setup) await page.evaluate(site.setup);
    await sleep(2500);
    result.before = await check();
    // Open, point, describe.
    await page.keyboard.press(OPEN_KEY);
    await until(async () => (await status())?.open, 8000, "the bar");
    if (site.point) {
      await page.locator(site.point).first().evaluate(e => e.scrollIntoView({ block: "center" }));
      await sleep(400);
      const b = await page.locator(site.point).first().boundingBox();
      await page.mouse.move(b.x + b.width / 2 - 20, b.y + Math.min(b.height / 2, 200), { steps: 5 });
      await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 200), { steps: 3 });
      await sleep(300);
      await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 200));
      await sleep(300);
    }
    await page.keyboard.type(site.ask, { delay: 10 });
    await shot("ask");
    const t0 = Date.now();
    await page.keyboard.press("Enter");
    const res = await until(async () => { const s = await status(); return ["result", "error"].includes(s?.phase) && s; }, T, "a result");
    result.ms = Date.now() - t0;
    result.hint = res.hint;
    if (res.phase === "error") { await shot("error"); throw new Error("the change failed: " + res.hint); }
    await sleep(800);
    result.applied = await check();
    // What the model wrote, and whether the page let the CSS in (a blocked <style> has no rules).
    result.css = await page.evaluate(() => [...document.querySelectorAll("style[data-morse-css]")].map(s => ({ text: s.textContent.slice(0, 600), rules: s.sheet?.cssRules?.length ?? null })));
    await shot("result");
    say(`${site.name}: ${res.hint} in ${(result.ms / 1000).toFixed(1)}s · check ${result.before} → ${result.applied}`);
    // Save, then reload.
    await page.keyboard.press("Enter");
    await until(async () => (await status())?.mods > 0, 15000, "the mod to be saved");
    await page.keyboard.press("Escape");
    await sleep(500);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await until(status, 30000, "Morse after the reload");
    result.persisted = !!(await until(check, 30000, "the change after the reload").catch(() => false));
    await sleep(1500);
    await shot("after-reload");
    say(`${site.name}: after a reload the change is ${result.persisted ? "still there" : "GONE"}`);
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = e.message.split("\n")[0];
    say(`${site.name}: ${result.error}`);
  }
  console.log(JSON.stringify(result));
  await page.close();
}
await ctx.close();
helper.stop();
process.exit(0);
