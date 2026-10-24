// Security regressions, run against the real built extension in Chromium.
// Needs a display (npm run test:ui runs it under Xvfb). The demo sites run on
// free ports; the browser still sees them at 127.0.0.1:8787/8788, the share
// origin the extension trusts (tests/helpers/demo-server.js).
import { home, tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createMod, encodeShare, validateMod, toUserscript } from "../core/mod.js";
import { HELPER_URL, helperUrlFor } from "../core/providers.js";
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

test("the popup shows the Open Morse hotkey as configured", { skip }, async () => {
  const id = new URL(sw.url()).host;
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/popup.html?url=https://example.com/`);
  await p.waitForFunction(() => document.getElementById("key").textContent);
  assert.equal(await p.locator("#key").textContent(), process.platform === "darwin" ? "⌥Space" : "Ctrl+Shift+Space");
  await sw.evaluate(() => chrome.storage.sync.set({ "morse.settings": { hotkeys: { open: "Alt+KeyJ" } } }));
  await p.reload();
  await p.waitForFunction(() => document.getElementById("key").textContent);
  assert.equal(await p.locator("#key").textContent(), process.platform === "darwin" ? "⌥J" : "Alt+J");
  await sw.evaluate(() => chrome.storage.sync.remove("morse.settings"));
  await p.close();
});

// The helper's address can be moved for tests ("morse.helperPort",
// core/providers.js HELPER_PORT_KEY). Only the extension's own worker and
// pages may set it: a web page, or a content script it tricks, could
// otherwise send prompts and voice to a server of its choosing.
test("a web page or a content script cannot move the Morse helper", { skip }, async () => {
  const KEY = "morse.helperPort", MINE = 45678, THEIRS = 4242;
  const id = new URL(sw.url()).host;
  const port = () => sw.evaluate(k => chrome.storage.local.get(k).then(r => r[k] ?? null), KEY);
  await sw.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [KEY, MINE]);
  const p = await ctx.newPage();
  try {
    await p.goto("http://127.0.0.1:8788/demo/sites/byte/");
    await p.waitForFunction(() => document.documentElement.dataset.morseExtension === "1");

    // The page itself: no way to message the extension, and the content
    // script ignores whatever it posts.
    assert.equal(await p.evaluate(() => typeof globalThis.chrome?.runtime?.sendMessage), "undefined", "Morse isn't externally connectable");
    await p.evaluate(([k, v]) => {
      for (const m of [{ type: "settings.set", patch: { [k]: v } }, { type: "popup.save", [k]: v, helperPort: v }, { [k]: v }, { morseHost: { type: "onboarding.set", patch: { [k]: v } } }]) postMessage(m, "*");
    }, [KEY, THEIRS]);

    // Morse's content script (its isolated world, through DevTools).
    const cdp = await ctx.newCDPSession(p);
    const worlds = [];
    cdp.on("Runtime.executionContextCreated", ({ context: c }) => { if (c.auxData?.type === "isolated" && c.origin?.includes(id)) worlds.push(c.id); });
    await cdp.send("Runtime.enable");
    const world = await waitFor(() => worlds[0], { what: "Morse's content script world" });
    const inContentScript = async expression => {
      const r = await cdp.send("Runtime.evaluate", { expression, contextId: world, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const tried = await inContentScript(`(async () => {
      const K = ${JSON.stringify(KEY)}, V = ${THEIRS}, out = {};
      // Straight into storage: storage.local is for the worker and Morse's pages only.
      try { await chrome.storage.local.set({ [K]: V }); out.set = "written"; } catch (e) { out.set = "refused"; }
      try { await chrome.storage.local.remove(K); out.remove = "removed"; } catch (e) { out.remove = "refused"; }
      // Every message a content script can send, carrying the key.
      const ask = m => new Promise(r => { chrome.runtime.sendMessage(m, x => { void chrome.runtime.lastError; r(x ?? null); }); setTimeout(() => r(null), 1500); });
      out.popup = await ask({ type: "popup.save", backend: "helper", [K]: V, helperPort: V });
      out.pair = await ask({ type: "popup.pair", code: "ABCDEF", [K]: V });
      out.onboarding = await ask({ type: "onboarding.set", patch: { [K]: V } });
      const port = chrome.runtime.connect({ name: "morse" });
      const replies = new Map();
      port.onMessage.addListener(m => { if (m && m.reply != null) replies.set(m.reply, m); });
      const sends = [
        { type: "settings.set", patch: { [K]: V, helperPort: V } },
        { type: "onboarding.set", patch: { [K]: V } },
        { type: "history.add", text: K },
        { type: "clipboard.put", item: { [K]: V } },
        { type: "popup.save", [K]: V },
        { type: "popup.pair", code: "ABCDEF" },
        { type: "storage.set", key: K, value: V },
      ];
      sends.forEach((m, i) => port.postMessage({ ...m, id: "hp" + i }));
      const end = Date.now() + 5000;
      while (replies.size < sends.length && Date.now() < end) await new Promise(r => setTimeout(r, 50));
      port.disconnect();
      out.replies = replies.size;
      return out;
    })()`);
    assert.equal(tried.set, "refused", "a content script can't write storage.local");
    assert.equal(tried.remove, "refused", "nor clear the setting");
    for (const k of ["popup", "pair", "onboarding"]) assert.equal(tried[k], null, `${k}: extension-page messages aren't answered for a content script`);
    assert.equal(tried.replies, 7, "the worker answered every port message (and changed nothing)");
    await settle(p);
    assert.equal(await port(), MINE, "the helper is where the extension put it");
    await cdp.detach().catch(() => {});
  } finally {
    await p.close();
    await sw.evaluate(k => chrome.storage.local.remove(k), KEY);
  }
});

test("the helper's port override is a port of 127.0.0.1, 1024-65535, or nothing", () => {
  assert.equal(HELPER_URL, "http://127.0.0.1:7457");
  assert.equal(helperUrlFor(45678), "http://127.0.0.1:45678");
  for (const bad of [null, undefined, 80, 1023, 65536, 4.5, "45678", "45678@evil.example", { port: 45678 }, NaN])
    assert.equal(helperUrlFor(bad), HELPER_URL, String(bad));
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
