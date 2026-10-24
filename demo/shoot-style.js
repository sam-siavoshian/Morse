// Your style screenshots (150-157): the real desktop connector on three demo
// sites (demo/style-world.js) with the demo model, in a scratch MORSE_HOME.
//   150 · the bar: "…everywhere", shown live for review with Save and Undo
//   151 · another site, at boot: the style is there without opening anything
//   152 · the Mods panel: Your style at the top, above this site's own mods
//   153 · Settings: Your style, block by block, and the sites it skips
//   154 · "not on this site": off here, with Undo
//   155 · calmer and red/green on the library: the video waits, the ticker stops
//   156 · fit to this site (opt-in): the model's fix shown for review
//   157 · the Mods panel after the fit: "fitted to this site"
//
//   node demo/shoot-style.js

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-style-"));
process.env.MORSE_HOME = home;

const { openStyleWorld } = await import("./style-world.js");
const world = await openStyleWorld({ launch: args => chromium.launch({ args }), viewport: { width: 1280, height: 800 } });
const ago = s => new Date(Date.now() - s * 1000).toISOString();
await fs.writeFile(path.join(home, "mods", "quiet-sidebar.json"), JSON.stringify({ morse: 1, id: "quiet-sidebar", title: "Quieter sidebar", prompt: "make the sidebar quieter so the albums stand out",
  match: { hosts: ["tunes.test"], app: null }, target: { selector: "nav", label: "Sidebar" },
  css: "nav { background: #0b0b0b !important; }\nnav a:not(.on) { color: #7d7d7d !important; }\n", js: "", enabled: true, model: "Claude Code · haiku", created: ago(9 * 86400), updated: ago(9 * 86400) }, null, 2));

const OPEN = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(80); }
  throw new Error("timed out waiting for " + fn);
}
const blur = page => page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());
async function shot(page, name) {
  await page.mouse.move(1270, 790);
  await sleep(450);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("  📸", name);
}
async function openBar(page) {
  const keys = OPEN.split("+"), main = keys.pop();
  for (const k of keys) await page.keyboard.down(k);
  await Promise.all([page.keyboard.down(main), page.keyboard.up(main)]);
  for (const k of keys.reverse()) await page.keyboard.up(k);
  await until(async () => (await status(page)).open);
}

// ---- 150: the bar
const byte = await world.open("byte");
await openBar(byte);
await byte.keyboard.type("Georgia font, bigger text and underline links everywhere except figma", { delay: 4 });
await byte.keyboard.press("Enter");
await until(async () => { const s = await status(byte); return s.phase === "style" && s.pane === "ys"; });
await shot(byte, "150-style-bar.png");
await byte.keyboard.press("Enter");
await until(async () => !(await status(byte)).open);

// ---- 151, 152: Tunes at boot, then its Mods panel
const tunes = await world.open("tunes");
await until(() => tunes.evaluate(() => getComputedStyle(document.body).zoom === "1.21"));
await shot(tunes, "151-style-at-boot.png");
await tunes.keyboard.press("Alt+Shift+KeyM");
await tunes.locator(".panel .ys-row").waitFor();
await blur(tunes);
await shot(tunes, "152-style-mods-panel.png");

// ---- 153: Settings
await tunes.locator('.ys-row [data-y="change"]').click();
await tunes.locator(".pane [data-ys-sec]").waitFor();
await sleep(300);
await blur(tunes);
await tunes.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".pane").scrollTop = 0);
await shot(tunes, "153-style-settings.png");
await tunes.keyboard.press("Escape");
await tunes.keyboard.press("Escape");

// ---- 154: not on this site
await openBar(tunes);
await tunes.keyboard.type("not on this site", { delay: 4 });
await tunes.keyboard.press("Enter");
await tunes.locator(".ctl-toast").waitFor({ state: "visible" });
await until(() => tunes.evaluate(() => getComputedStyle(document.body).zoom === "1"));
await shot(tunes, "154-style-not-here.png");

// ---- 155: calmer, and red and green apart, on the library
await openBar(byte);
await byte.keyboard.type("everything calmer everywhere: no autoplay, fewer animations, softer colors. I'm colorblind, make red and green easy to tell apart", { delay: 2 });
await byte.keyboard.press("Enter");
await until(async () => (await status(byte)).phase === "style");
await byte.keyboard.press("Enter");
await until(async () => !(await status(byte)).open);
const library = await world.open("library");
await until(() => library.evaluate(() => document.querySelector("video")?.paused));
await library.keyboard.press("Alt+Shift+KeyM");
await library.locator(".panel .ys-row").waitFor();
await blur(library);
await shot(library, "155-style-calmer.png");
await library.keyboard.press("Escape");

// ---- 156, 157: fit to this site, on a site not visited yet
const { Style } = await import("../daemon/style.js");
await Style.handle({ type: "style.save", patch: { adapt: true } }, { url: "http://mail.test/", app: null });
const mail = await world.open("mail");
await until(async () => { const s = await status(mail); return s.open && s.phase === "result"; }, 60000);
await shot(mail, "156-style-fit-review.png");
await mail.keyboard.press("Enter");
await until(async () => !(await status(mail)).open);
await sleep(3400); // the Saved toast goes
await mail.keyboard.press("Alt+Shift+KeyM");
await mail.locator(".panel .ys-row").waitFor();
await blur(mail);
await shot(mail, "157-style-fitted.png");

await world.close();
await fs.rm(home, { recursive: true, force: true });
process.exit(0);
