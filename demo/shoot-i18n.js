// Morse in other languages (160-171): the bar, a result, the Mods panel and
// Settings, on the bar playground (demo/bar-playground.html, fake host), with
// the browser set to each language. Persian lays everything out right to left.
//   160-163 · Spanish   164-167 · Japanese   168-171 · Persian
//
//   node demo/shoot-i18n.js                 the three above, into docs/screenshots
//   SHOTS=/tmp/x node demo/shoot-i18n.js de:0   any language, numbered from 0

import path from "node:path";
import { createRequire } from "node:module";
import { serveBar } from "./bar-server.js";
import { defaultHotkeys } from "../core/hotkeys.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PLATFORM = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
const pw = combo => combo.split("+").map(k => (k === "Ctrl" ? "Control" : k.replace(/^Key|^Digit/, ""))).join("+");
const KEYS = Object.fromEntries(Object.entries(defaultHotkeys(PLATFORM)).map(([k, v]) => [k, pw(v)]));
const NAMES = { es: "es", ja: "ja", fa: "fa", de: "de", fr: "fr", "pt-BR": "pt", "zh-CN": "zh", ar: "ar" };
const jobs = (process.argv.slice(2).length ? process.argv.slice(2) : ["es:160", "ja:164", "fa:168"]).map(a => { const [lang, n] = a.split(":"); return { lang, n: Number(n) }; });

const srv = await serveBar();
const browser = await chromium.launch();
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(80); }
  throw new Error("timed out waiting for " + fn);
}
async function tap(page, combo) {
  const keys = combo.split("+"), main = keys.pop();
  for (const k of keys) await page.keyboard.down(k);
  await Promise.all([page.keyboard.down(main), page.keyboard.up(main)]);
  for (const k of keys.reverse()) await page.keyboard.up(k);
}
const blur = page => page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());

try {
  for (const { lang, n } of jobs) {
    // "Same as my computer": the browser's language picks Morse's.
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 }, locale: lang, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(srv.url + "?ms=8&keepmods");
    await until(() => page.evaluate(() => !!document.querySelector("[data-morse-ui]")?.dataset.status));
    const name = (i, what) => path.join(OUT, `${n + i}-${NAMES[lang] || lang}-${what}.png`);
    const shot = async (i, what) => { await sleep(500); await page.screenshot({ path: name(i, what) }); console.log("  📸", path.basename(name(i, what))); };

    // the bar, pointing at the player controls
    await tap(page, KEYS.open);
    await until(async () => (await status(page)).open);
    await page.mouse.move(300, 60);
    await page.mouse.click(300, 60);
    await page.locator(".chip.target:not([hidden])").waitFor();
    await page.mouse.move(1000, 400);
    await shot(0, "bar");

    // a result: Save, Undo, Edit code, Share
    await page.keyboard.type("make the toolbar airier", { delay: 4 });
    await page.keyboard.press("Enter");
    await until(async () => (await status(page)).phase === "result");
    await blur(page);
    await page.mouse.move(1000, 400);
    await shot(1, "result");

    // the Mods panel, after Save
    await page.locator(".actions [data-a=keep]").click();
    await until(async () => !(await status(page)).open);
    await sleep(3500); // the toast fades
    await tap(page, KEYS.open);
    await until(async () => (await status(page)).open);
    await page.locator(".actions [data-a=mods]").click();
    await page.locator(".panel article").first().waitFor();
    await blur(page);
    await shot(2, "mods-panel");
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".panel").hidden = true; });

    // Settings, scrolled to Language
    await tap(page, KEYS.open);
    await until(async () => (await status(page)).open);
    await page.keyboard.press(PLATFORM === "mac" ? "Meta+Comma" : "Control+Comma");
    await page.locator(".pane .sheet").waitFor();
    await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".srow.lang")?.scrollIntoView({ block: "center" }));
    await blur(page);
    await shot(3, "settings");
    if (errors.length) console.warn(`  ${lang}: page errors`, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
