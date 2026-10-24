// Opens the Riverside Library demo site (demo/sites/a11y) in Playwright with
// the real Morse runtime and the stand-in host (demo/a11y-host.js), for
// tests/a11y-ui.test.js and demo/shoot-a11y.js. Files come straight from the
// repo through a routed origin, so nothing needs to be built or served.
//
// The browser's speech is replaced by a recorder (window.__speech) that says
// nothing and finishes a sentence only when told to (__speech.finish()), so
// Read aloud can be checked step by step on machines with no voices.

import { readFile } from "node:fs/promises";
import { bundleRuntime } from "../runtime/bundle.js";

const ROOT = new URL("../", import.meta.url);
export const ORIGIN = "http://library.morse.test";
const TYPES = { html: "text/html", js: "text/javascript", png: "image/png", gif: "image/gif", webm: "video/webm", svg: "image/svg+xml", css: "text/css" };

export function fakeSpeech() {
  const spoken = [];
  let current = null;
  const synth = {
    speaking: false, paused: false, pending: false,
    getVoices: () => [],
    speak(u) { current = u; spoken.push({ text: u.text, rate: u.rate }); this.speaking = true; setTimeout(() => u.onstart?.({}), 0); },
    cancel() { const u = current; current = null; this.speaking = false; if (u) setTimeout(() => u.onerror?.({ error: "interrupted" }), 0); },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.__speech = {
    spoken,
    get current() { return current?.text || null; },
    finish() { const u = current; current = null; synth.speaking = false; u?.onend?.({}); },
  };
}

export async function openLibrary(browser, { viewport = { width: 1280, height: 800 }, speech = true, reset = true, colorScheme = "light", shots = false } = {}) {
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
  if (speech) await page.addInitScript(fakeSpeech);
  if (reset) await page.addInitScript(() => { if (!sessionStorage.getItem("kept")) { Object.keys(localStorage).filter(k => k.startsWith("morse:")).forEach(k => localStorage.removeItem(k)); sessionStorage.setItem("kept", "1"); } });
  if (shots) await page.exposeFunction("__morseShot", async () => "data:image/png;base64," + (await page.screenshot()).toString("base64"));
  await page.addInitScript(() => {
    // The host before the runtime, as the extension does it.
    document.addEventListener("DOMContentLoaded", () => {
      const host = document.createElement("script");
      host.type = "module";
      host.src = "/demo/a11y-host.js";
      host.onload = () => { const s = document.createElement("script"); s.src = "/runtime.js"; document.documentElement.append(s); };
      document.documentElement.append(host);
    });
  });
  await page.goto(`${ORIGIN}/demo/sites/a11y/index.html`);
  // ready: the host answered hello and the mods are on (tests may press keys right away)
  await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "{}").ready, null, { timeout: 60000 });
  return { ctx, page, errors };
}
