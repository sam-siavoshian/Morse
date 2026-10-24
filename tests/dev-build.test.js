// For people working on Morse (dogfood): after `npm run build`, a Chrome
// profile that already had Morse kept running the old service worker until the
// extension was reloaded. A test build now notices (extension/dev-host.js):
// the bar says Morse was rebuilt and where to reload it. A store build
// (MORSE_STORE=1) has none of it.
//
// The extension is built into a folder of this test's own, loaded, and then
// built again in the same folder while Chromium runs, as a developer would.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chromium, noDisplay } from "./helpers/browser.js";
import { startDemoServer, routeDemoOrigins } from "./helpers/demo-server.js";
import { waitFor, waitForStatus, TIMEOUT } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BYTE = "http://127.0.0.1:8788/demo/sites/byte/";
const skip = noDisplay;
const build = (out, env = {}) => execFileSync(process.execPath, [path.join(root, "scripts/build.js"), "--out", out], { env: { ...process.env, MORSE_STORE: "", ...env }, stdio: "ignore" });
let ctx, demo, ext;

before(async () => {
  if (skip) return;
  ext = path.join(tempDir("morse-dev-build-"), "extension");
  build(ext);
  demo = await startDemoServer();
  ctx = await chromium.launchPersistentContext(tempDir("morse-dev-profile-"), {
    headless: false, timeout: TIMEOUT * 2, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await routeDemoOrigins(ctx, demo);
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: TIMEOUT });
  await sw.evaluate(() => chrome.storage.local.set({ welcomed: true, "morse.onboarding": { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } } }));
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close().catch(() => {}); // the welcome page
});
after(async () => { await ctx?.close(); await demo?.close(); });

async function openBar() {
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  await p.goto(BYTE);
  await p.waitForFunction(() => document.documentElement.dataset.morseExtension === "1");
  await pressOpen(p);
  await waitForStatus(p, s => s.open && s.ready, { what: "the bar" });
  return p;
}
const toastText = p => p.evaluate(() => { const el = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ctl-toast"); return el && !el.hidden ? el.textContent : ""; });

test("a test build says when it was rebuilt under a running extension", { skip, timeout: 240000 }, async () => {
  const first = readFileSync(path.join(ext, "build-id.txt"), "utf8").trim();
  assert.match(first, /^[a-z0-9]+-[a-z0-9]+$/);
  let p = await openBar();
  await p.waitForTimeout(500);
  assert.equal(await toastText(p), "", "nothing to say while the build is the one running");
  await p.close();

  build(ext); // npm run build, with Chromium still running the old worker
  assert.notEqual(readFileSync(path.join(ext, "build-id.txt"), "utf8").trim(), first);
  p = await openBar();
  await waitFor(async () => /Morse was rebuilt\. Reload it in chrome:\/\/extensions, then reload this page\./.test(await toastText(p)), { what: "the rebuilt note" });
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "dev-rebuilt.png") });
  await p.waitForTimeout(4000);
  assert.match(await toastText(p), /Morse was rebuilt/, "it stays until it is closed");
  await p.locator("[data-morse-ui] .ctl-toast .ctl-x").click();
  assert.equal(await toastText(p), "");
  await p.close();
});

test("a store build has no build id and never checks", () => {
  const dir = tempDir("morse-dev-store-");
  build(dir, { MORSE_STORE: "1" });
  assert.ok(!existsSync(path.join(dir, "build-id.txt")));
  const sw = readFileSync(path.join(dir, "background.js"), "utf8");
  assert.match(sw, /\bvar BUILD_ID = "";/);
});
