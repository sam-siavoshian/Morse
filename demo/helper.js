// Shared by the screenshot scripts (demo/shoot-*.js):
//
//   startHelper(home)    the Morse helper (`morse serve`) in a scratch
//                        MORSE_HOME, replaying core/demo.js unless
//                        MORSE_PROVIDER names a real model (e.g.
//                        MORSE_PROVIDER=claude-code MORSE_MODEL=haiku)
//   pairExtension(…)     pairs the extension with it through the real popup
//   routeHelper(ctx, h)  points the extension at a helper that isn't on 7457
//   demoSites(ctx?)      the demo sites on free ports, shown to a Playwright
//                        context at their usual addresses (127.0.0.1:8787-8790)
//   OPEN_KEY, pressOpen  the platform's Open Morse key, and a reliable tap of it
//
// Ports: the demo sites never bind 8787-8790 (other runs use them); the
// extension always looks for the helper on 7457, so the helper waits for that
// port to be free. MORSE_HELPER_PORT=<port> runs it elsewhere and routes 7457
// there instead; the reply then arrives in one piece, so shots of a change
// being written may show it finished.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { serveDemo } from "./serve.js";
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

export async function startHelper(home) {
  await fs.mkdir(home, { recursive: true });
  const provider = process.env.MORSE_PROVIDER || "demo";
  const port = Number(process.env.MORSE_HELPER_PORT) || EXTENSION_HELPER_PORT;
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

// The extension only knows 127.0.0.1:7457. A helper elsewhere is reached by
// routing that address in the browser (the service worker's requests too).
export async function routeHelper(ctx, helper) {
  if (helper.port === EXTENSION_HELPER_PORT) return;
  await ctx.route(`http://127.0.0.1:${EXTENSION_HELPER_PORT}/**`, async route => {
    const url = new URL(route.request().url());
    url.port = String(helper.port);
    try { await route.fulfill({ response: await route.fetch({ url: url.href }) }); }
    catch { await route.abort().catch(() => {}); }
  });
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
  await pop.locator("#unpair:not([hidden])").waitFor({ timeout: 30000 });
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
