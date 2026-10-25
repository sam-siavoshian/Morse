// Shared by the screenshot scripts (demo/shoot-*.js):
//
//   startHelper(home)    the Morse helper (`morse serve`) in a scratch
//                        MORSE_HOME, replaying core/demo.js unless
//                        MORSE_PROVIDER names a real model (e.g.
//                        MORSE_PROVIDER=claude-code MORSE_MODEL=sonnet)
//   pairExtension(…)     pairs the extension with it through the real popup
//   routeHelper(ctx, h)  points the extension at that helper's port
//   demoSites(ctx?)      the demo sites on free ports, shown to a Playwright
//                        context at their usual addresses (127.0.0.1:8787-8790)
//   OPEN_KEY, pressOpen  the platform's Open Morse key, and a reliable tap of it
//
// Ports: nothing binds a fixed port, so runs side by side never meet. The
// demo sites run on free ports and show at 8787-8790; the helper runs on
// MORSE_HELPER_PORT or a free port, and the extension is told where it is
// (chrome.storage.local "morse.helperPort", core/providers.js HELPER_PORT_KEY).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { serveDemo } from "./serve.js";
import { freePort } from "../tests/helpers/net.js";
import { HELPER_PORT_KEY } from "../core/providers.js";
import { pressOpen } from "../tests/helpers/keys.js";
export { OPEN_KEY, HOTKEYS, pressOpen } from "../tests/helpers/keys.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const EXTENSION_HELPER_PORT = 7457; // core/providers.js HELPER_PORT
export const DEMO_PORTS = { parley: 8787, byte: 8788, tunes: 8789, a11y: 8790 };

export const portFree = port => new Promise(r => { const s = net.createServer().once("error", () => r(false)).listen(port, "127.0.0.1", () => s.close(() => r(true))); });
export async function waitForPort(port, ms = 180000) {
  const end = Date.now() + ms;
  let said = false;
  while (Date.now() < end) {
    if (await portFree(port)) return;
    if (!said) { console.log(`  · waiting for port ${port} (another run is using it)`); said = true; }
    await sleep(500);
  }
  throw new Error(`port ${port} stayed busy`);
}

// Opens the bar and waits until it says it is open (the page has to be in
// debug mode, for the status). On a busy machine the first tap can land
// before Morse is listening, so it taps again rather than typing into nothing.
export async function openBar(page, ms = 30000) {
  const isOpen = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")?.open).catch(() => false);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isOpen()) return;
    await pressOpen(page);
    for (let i = 0; i < 20 && Date.now() < end; i++) { if (await isOpen()) return; await sleep(100); }
  }
  throw new Error("the bar didn't open");
}

// When the bar is in front of the point, rest the pointer on an empty part of
// it, as a person would: while pointing, the bar then steps aside
// (runtime/src/50-bar.js).
export const barCovers = (page, x, y) => page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.matches?.("[data-morse-ui]"), [x, y]).catch(() => false);
export async function clearBar(page, x, y) {
  for (let i = 0; i < 3 && await barCovers(page, x, y); i++) {
    const spot = await page.evaluate(() => {
      const r = document.querySelector("[data-morse-ui]")?.shadowRoot?.querySelector(".bar textarea.in")?.getBoundingClientRect();
      return r && { x: r.x + r.width * 0.7, y: r.y + r.height / 2 };
    });
    if (!spot) return;
    await page.mouse.move(spot.x, spot.y, { steps: 4 });
    await sleep(900);
  }
}

// Points at a part of the page and clicks it, the way a person does: hover,
// a moment, click. On a busy machine Morse can miss a quick click, so it
// clicks again until the bar shows something was picked. It never clicks
// while the bar is in front of the spot (that would press the bar instead).
export async function pick(page, sel, fx = 0.5, fy = 0.5) {
  const r = await page.locator(sel).first().boundingBox();
  const x = r.x + r.width * fx, y = r.y + r.height * fy;
  const hint = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")?.hint || "").catch(() => "");
  for (let i = 0; i < 5; i++) {
    await clearBar(page, x, y);
    // Come from just beside it: the bar sits on the other half of the
    // screen from what the pointer is over.
    await page.mouse.move(x - 40, y - 20);
    await page.mouse.move(x, y, { steps: 6 });
    await sleep(600);
    if (await barCovers(page, x, y)) continue;
    await page.mouse.click(x, y);
    await sleep(250);
    for (let j = 0; j < 80; j++) { if (!/^Point at anything/.test(await hint())) return r; await sleep(100); }
  }
  throw new Error(`couldn't point at ${sel}`);
}

export async function startHelper(home) {
  await fs.mkdir(home, { recursive: true });
  const provider = process.env.MORSE_PROVIDER || "demo";
  const port = Number(process.env.MORSE_HELPER_PORT) || await freePort();
  if (process.env.MORSE_MODEL) {
    await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ models: { [provider]: process.env.MORSE_MODEL } }));
  }
  for (let attempt = 1; ; attempt++) {
    await waitForPort(port);
    const child = spawn(process.execPath, [path.join(root, "daemon/cli.js"), "serve"], { env: { ...process.env, MORSE_HOME: home, MORSE_PROVIDER: provider, MORSE_HELPER_PORT: String(port) } });
    let out = "";
    try {
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`morse serve didn't start:\n${out}`)), 30000);
        child.stdout.on("data", d => {
          out += d;
          const m = /pair\s+(?:\x1b\[[\d;]*m)*([A-Z0-9]{6})/.exec(out);
          if (m) { clearTimeout(timer); resolve(m[1]); }
        });
        child.stderr.on("data", d => { out += d; });
        child.on("exit", c => { clearTimeout(timer); reject(new Error(`morse serve exited (${c}):\n${out}`)); });
      });
      child.stdout.on("data", d => process.stdout.write(String(d).replace(/^(?=.)/gm, "  helper ")));
      process.on("exit", () => child.kill()); // even if the script crashes
      return { code, port, stop: () => child.kill() };
    } catch (e) {
      child.kill();
      if (attempt >= 3) throw e;
      console.log(`  · morse serve didn't start (${e.message.split("\n")[0]}); trying again`);
    }
  }
}

// Tells the extension in this browser where the helper is (its service
// worker reads "morse.helperPort"; pages and content scripts can't set it).
export async function routeHelper(ctx, helper) {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  await sw.evaluate(([k, p]) => chrome.storage.local.set({ [k]: p }), [HELPER_PORT_KEY, helper.port]);
}

// Someone who has used Morse before: the first-run coach is done, the tools
// are revealed, and no "Morse is ready" toast. For the desktop connector the
// same state goes in MORSE_HOME/onboarding.json.
export const SEASONED = { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } };
// prefs: bar settings to start with (extension/bar-host.js "morse.settings"),
// e.g. { gallery: false } to leave out "Mods for this site".
export const seasonExtension = (sw, prefs = null) => sw.evaluate(async ([o, p]) => {
  await chrome.storage.local.set({ "morse.onboarding": o, welcomed: true });
  if (p) await chrome.storage.sync.set({ "morse.settings": p }).catch(() => chrome.storage.local.set({ "morse.settings": p }));
}, [SEASONED, prefs]);
export async function seasonHome(home) {
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify(SEASONED));
}

// Types the pairing code into the extension's popup, like a user would.
export async function pairExtension(ctx, id, code) {
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.locator("#code").fill(code);
  await pop.locator("#pair").click();
  await pop.locator("#unpair:not([hidden])").waitFor({ state: "attached", timeout: 30000 }); // the Model box folds once it works (popup.js)
  await pop.close();
}

// The demo sites (demo/serve.js) on free ports. route(ctx) shows them to a
// Playwright context at their usual addresses, so mods, share links and the
// pictures say 127.0.0.1:8787-8790 whatever ports they really use.
export async function demoSites() {
  const demo = await serveDemo({ base: 0 });
  const url = (site, p = `/demo/sites/${site}/`) => `http://127.0.0.1:${DEMO_PORTS[site]}${p}`;
  return {
    ...demo,
    url,                                                        // the usual address (for routed contexts)
    real: (site, p = `/demo/sites/${site}/`) => `${demo.origin(site)}${p}`, // the real one (for apps Playwright doesn't drive)
    async route(ctx) {
      for (const [site, port] of Object.entries(DEMO_PORTS)) {
        await ctx.route(`http://127.0.0.1:${port}/**`, async route => {
          const u = new URL(route.request().url());
          u.port = String(demo.sites[site]);
          try { await route.fulfill({ response: await route.fetch({ url: u.href }) }); }
          catch { await route.abort().catch(() => {}); }
        });
      }
    },
  };
}
