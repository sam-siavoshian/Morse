// Security regressions, run against the real built extension in Chromium.
// Needs a display (npm run test:ui runs it under Xvfb). The demo sites run on
// free ports; the browser still sees them at 127.0.0.1:8787/8788, the share
// origin the extension trusts (tests/helpers/demo-server.js).
import { home, tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createMod, encodeShare, validateMod, toUserscript } from "../core/mod.js";
import { chromium, noDisplay } from "./helpers/browser.js";
import { startDemoServer, routeDemoOrigins } from "./helpers/demo-server.js";
import { waitFor, settle, TIMEOUT } from "./helpers/wait.js";

void home;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const skip = noDisplay;
let ctx, sw, demo;

before(async () => {
  if (skip) return;
  demo = await startDemoServer();
  ctx = await chromium.launchPersistentContext(tempDir("morse-sec-"), {
    headless: false, timeout: TIMEOUT * 2, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await routeDemoOrigins(ctx, demo);
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: TIMEOUT });
});
after(async () => { await ctx?.close(); await demo?.close(); });
const stored = () => sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}));

test("another website cannot install a mod by posting to the extension", { skip }, async () => {
  const p = await ctx.newPage();
  await p.addInitScript(() => addEventListener("message", e => { if (e.data?.morseInstall) window.__posted = true; }));
  await p.goto("http://127.0.0.1:8788/demo/sites/attacker/");
  // The page posts its install message a moment after load; the content
  // script's listener runs in the same dispatch.
  await p.waitForFunction(() => window.__posted && document.documentElement.dataset.morseExtension === "1");
  await settle(p);
  assert.deepEqual(await stored(), []);
  await p.close();
});

test("the share page only asks; nothing installs until the user clicks Install", { skip }, async () => {
  const mod = createMod({ title: "Safe", prompt: "make it calm", css: "h1{letter-spacing:1px}", js: "", url: "http://127.0.0.1:8788/" });
  const link = (await encodeShare(mod)).replace(/^https:\/\/[^/]+\/RRAA/, "http://127.0.0.1:8787");
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8787/share/install.html");
  await p.evaluate(() => localStorage.setItem("morse:debug", "1")); // open shadow root so the test can click
  await p.goto("about:blank"); // a fresh document, so the share page renders this link
  await p.goto(link);
  await p.waitForFunction(() => document.documentElement.dataset.morseExtension === "1");
  await p.locator("#install").click();
  await p.locator(".card [data-a=install]").waitFor();
  assert.deepEqual(await stored(), [], "nothing saved before confirming");
  await p.locator(".card [data-a=close]").last().click();
  await p.locator(".card [data-a=install]").waitFor({ state: "hidden" });
  assert.deepEqual(await stored(), [], "cancel installs nothing");
  await p.locator("#install").click();
  await p.locator(".card [data-a=install]").click();
  await p.waitForFunction(() => /Installed/.test(document.body.innerText));
  assert.deepEqual(await waitFor(async () => { const ids = await stored(); return ids.length && ids; }, { what: "the mod in storage" }), [mod.id]);
  await p.close();
});

test("mods with unsafe ids are rejected", () => {
  const bad = { ...createMod({ title: "t", prompt: "p", url: "https://a.com/" }), id: 'x"><img src=x onerror=alert(1)>' };
  assert.throws(() => validateMod(bad), /invalid id/);
});

test("a title cannot add lines to the userscript header", () => {
  const m = createMod({ title: "Nice\n// @match *://*/*\n// @grant GM_xmlhttpRequest", prompt: "p\r\nq", url: "https://a.com/" });
  const header = toUserscript(m).split("// ==/UserScript==")[0];
  // Userscript managers read one key per line that starts with "// @".
  const keys = header.split("\n").filter(l => /^\/\/ @/.test(l)).map(l => l.split(/\s+/)[1]);
  assert.equal(keys.filter(k => k === "@match").length, 1);
  assert.deepEqual(keys.filter(k => k === "@grant"), ["@grant"]);
  assert.match(header, /@grant\s+none/);
});
