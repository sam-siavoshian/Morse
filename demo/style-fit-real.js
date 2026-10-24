// Your style, fitted to one site by a real model: Claude Code with sonnet
// through the claude-code provider (the Morse helper's harness), on Tunes,
// where the generic "bigger text" (zoom 121%) pushes the player bar below the
// bottom of the window. Fit to each site is on; the first visit asks the
// model, the fix shows for review, and Save keeps it as part of the style.
//
//   node demo/style-fit-real.js            screenshots 158-159, and a report on stdout
//   MORSE_PROVIDER=demo node demo/style-fit-real.js    the same with the demo model
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "screenshots"));
const provider = process.env.MORSE_PROVIDER || "claude-code";
const model = process.env.MORSE_MODEL || (provider === "claude-code" ? "sonnet" : "demo");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-style-real-"));
process.env.MORSE_HOME = home;

const { openStyleWorld } = await import("./style-world.js");
const { Style } = await import("../daemon/style.js");
const world = await openStyleWorld({ launch: args => chromium.launch({ args }), settings: { provider, model }, viewport: { width: 1280, height: 800 },
  log: l => console.log("  helper:", l.trim()) });
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(150); }
  throw new Error("timed out waiting for " + fn);
}
// Where the player bar is: its bottom edge against the window's.
const player = page => page.evaluate(() => {
  const el = document.querySelector('[data-testid="player-controls"]') || document.querySelector("footer");
  const r = el?.getBoundingClientRect();
  return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.bottom <= innerHeight + 1 && r.top >= 0, windowHeight: innerHeight } : null;
});

const report = { provider, model, site: "tunes.test" };
await Style.handle({ type: "style.save", add: "bigger text and underline links everywhere" }, { url: "http://byte.test/", app: null });

// Before: the generic style alone (fitting off).
const before = await world.open("tunes");
await until(async () => (await before.evaluate(() => getComputedStyle(document.body).zoom)) === "1.21", 20000);
report.before = await player(before);
await before.close();

// Fit to each site on; a first visit.
await Style.handle({ type: "style.save", patch: { adapt: true } }, { url: "http://byte.test/", app: null });
const page = await world.open("tunes", "/?visit");
const t0 = Date.now();
await until(async () => (await status(page)).phase === "working", 30000);
const s = await until(async () => { const x = await status(page); return (x.phase === "result" || x.phase === "error" || (!x.open && x.phase === "idle")) && x; }, 300000);
report.seconds = Math.round((Date.now() - t0) / 100) / 10;
report.phase = s.phase;
report.hint = s.hint;
const draft = await page.evaluate(() => [...document.querySelectorAll("style[data-morse-css]")].map(n => ({ id: n.dataset.morseCss, css: n.textContent })));
report.css = draft.filter(d => d.id !== "morse-style").map(d => d.css).join("\n");
report.during = await player(page);
if (s.phase === "result") {
  await page.mouse.move(1270, 790);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, "158-style-fit-haiku-review.png") });
  console.log("  📸 158-style-fit-haiku-review.png");
  await page.keyboard.press("Enter");
  await until(async () => !(await status(page)).open, 20000);
  const files = await fs.readdir(path.join(home, "mods"));
  const fit = files.length ? JSON.parse(await fs.readFile(path.join(home, "mods", files[0]), "utf8")) : null;
  report.saved = fit && { title: fit.title, parent: fit.parent, hosts: fit.match.hosts, model: fit.model, js: fit.js.trim().length > 0 };
  // A new visit: the style and its fit come back at boot, with no model call.
  const again = await world.open("tunes", "/?again");
  await sleep(2500);
  report.after = await player(again);
  report.afterOpen = (await status(again)).open;
  await again.keyboard.press("Alt+Shift+KeyM");
  await again.locator(".panel .ys-row").waitFor();
  await again.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.blur());
  await again.mouse.move(400, 790);
  await sleep(400);
  await again.screenshot({ path: path.join(OUT, "159-style-fit-haiku-saved.png") });
  console.log("  📸 159-style-fit-haiku-saved.png");
}
console.log(JSON.stringify(report, null, 2));
await world.close();
await fs.rm(home, { recursive: true, force: true });
process.exit(0);
