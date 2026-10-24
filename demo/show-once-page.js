// Opens a demo site (demo/sites/<name>) in Playwright with the real Morse
// runtime and a stand-in host (demo/a11y-host.js: mods in localStorage, mod
// code through the real kit, model requests through the real engine and the
// demo model), for tests/show-once.test.js and demo/shoot-show-once.js.
// Files come straight from the repo through a routed origin; nothing needs to
// be built or served.

import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";

const ROOT = new URL("../", import.meta.url);
export const ORIGIN = "http://sites.morse.test";
const TYPES = { html: "text/html", js: "text/javascript", png: "image/png", svg: "image/svg+xml", css: "text/css" };

export async function openSite(browser, site = "mail", { file = "index.html", viewport = { width: 1280, height: 800 }, colorScheme = "light", shots = false } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 });
  const runtime = bundleRuntime();
  await ctx.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/runtime.js") return route.fulfill({ body: runtime, contentType: "text/javascript" });
    try {
      const body = await readFile(new URL("." + path, ROOT));
      route.fulfill({ body, contentType: TYPES[path.split(".").pop()] || "application/octet-stream" });
    } catch { route.fulfill({ status: 404, body: "" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  if (shots) await page.exposeFunction("__morseShot", async () => "data:image/png;base64," + (await page.screenshot()).toString("base64"));
  await page.addInitScript(() => {
    // Every model request, as the host sends it (tests check what leaves the page).
    if (window !== top) return; // Morse runs in the page, not in its frames
    window.__sent = [];
    document.addEventListener("DOMContentLoaded", () => {
      const host = document.createElement("script");
      host.type = "module";
      host.src = "/demo/a11y-host.js";
      host.onload = () => {
        const send = globalThis.__morseHost.send;
        globalThis.__morseHost.send = m => { window.__sent.push(JSON.parse(JSON.stringify(m))); return send(m); };
        const s = document.createElement("script");
        s.src = "/runtime.js";
        document.documentElement.append(s);
      };
      document.documentElement.append(host);
    });
  });
  await page.goto(`${ORIGIN}/demo/sites/${site}/${file}`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  return { ctx, page, errors };
}
