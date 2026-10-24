// Security regressions, run against the real built extension in Chromium.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMod, encodeShare, validateMod, toUserscript } from "../core/mod.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const up = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
const skip = !chromium ? "playwright not installed" : !process.env.DISPLAY ? "extensions need a display (run under Xvfb)" : false;
let ctx, sw;

before(async () => {
  if (skip) return;
  if (!(await up("http://127.0.0.1:8787/share/install.html"))) {
    const { spawn } = await import("node:child_process");
    spawn("node", [path.join(root, "demo/serve.js")], { stdio: "ignore", detached: true }).unref();
    for (let i = 0; i < 30 && !(await up("http://127.0.0.1:8787/share/install.html")); i++) await new Promise(r => setTimeout(r, 100));
  }
  ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "morse-sec-")), {
    headless: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
});
after(() => ctx?.close());
const stored = () => sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}));

test("another website cannot install a mod by posting to the extension", { skip }, async () => {
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8788/demo/sites/attacker/");
  await p.waitForTimeout(1200);
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
  await p.waitForTimeout(500);
  await p.locator("#install").click();
  await p.locator(".card [data-a=install]").waitFor();
  assert.deepEqual(await stored(), [], "nothing saved before confirming");
  await p.locator(".card [data-a=close]").last().click();
  await p.waitForTimeout(300);
  assert.deepEqual(await stored(), [], "cancel installs nothing");
  await p.locator("#install").click();
  await p.locator(".card [data-a=install]").click();
  await p.waitForFunction(() => /Installed/.test(document.body.innerText));
  assert.deepEqual(await stored(), [mod.id]);
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
