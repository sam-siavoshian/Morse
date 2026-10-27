// Regressions from the third bug hunt: requests that never settle, page
// scripts faking key presses, voice over a result, the hotkey recorder vs God
// mode, a detached runtime that kept the page's keys, and copy that promised
// things Morse doesn't do. Runtime cases run the real runtime in Chromium
// against the fake hosts in demo/bar-playground.html and demo/playground.html.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { serveBar } from "../demo/bar-server.js";
import { bundleRuntime } from "../runtime/bundle.js";
import { defaultHotkeys } from "../core/hotkeys.js";
import { plainError } from "../core/onboarding.js";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { holdKeys, pressOpen, releaseKeys } from "./helpers/keys.js";
import { TIMEOUT, hostRoundTrip, settle, waitForReady } from "./helpers/wait.js";
import { tempDir } from "./helpers/home.js";
// The default Open Morse / push-to-talk combo for this platform.
const MAC = process.platform === "darwin";
const OPEN_FLAGS = MAC ? { altKey: true } : { ctrlKey: true, shiftKey: true };

const skip = noBrowser;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar();
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
  browser = await launchBrowser({ channel: "chromium", args });
});
after(async () => { await browser?.close(); await srv?.close(); });

// Web Speech needs Google's servers; make it fail so the recorder path runs (as in bar.test.js).
const SPEECH_FAILS = () => {
  globalThis.webkitSpeechRecognition = class extends EventTarget {
    start() { setTimeout(() => { this.onerror?.(Object.assign(new Event("error"), { error: "network" })); const e = new Event("end"); this.onend?.(e); this.dispatchEvent(e); }, 20); }
    stop() {} abort() {}
  };
};

// page: "bar" (demo/bar-playground.html) or "god" (demo/playground.html, God mode's fake host).
async function scenario({ page: which = "bar", query = "", init, clock = false }, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const url = which === "god" ? srv.url.replace("bar-playground.html", "playground.html") : srv.url;
  await page.goto(url + query);
  await waitForReady(page);
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = async (pred, ms = TIMEOUT) => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) { s = await status(); if (pred(s)) return s; await page.waitForTimeout(25); }
    throw new Error("timed out; last status " + JSON.stringify(s));
  };
  const log = () => page.evaluate(() => window.__fake.log || []);
  const ui = sel => page.evaluate(s => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s)?.textContent ?? null, sel);
  try { await fn({ page, status, waitFor, log, ui }); assert.deepEqual(errors, []); }
  finally { await ctx.close(); }
}
const fakeKey = (type, init) => `dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, ${JSON.stringify({ bubbles: true, cancelable: true, ...init })}))`;
async function selectInGodMode(page, sel) {
  const r = await page.locator(sel).first().boundingBox();
  await page.mouse.move(r.x + 12, r.y + 8);
  await page.mouse.click(r.x + 12, r.y + 8);
  await page.locator(".gm-tb").waitFor({ state: "visible" });
}

test("God mode: one edit whose request is lost doesn't stop later edits from applying and saving", { skip }, async () => {
  await scenario({ page: "god", query: "?light&reset", clock: true }, async ({ page }) => {
    // The host never answers the first exec (a reply lost on the way back).
    await page.evaluate(() => {
      const host = globalThis.__morseHost, send = host.send.bind(host);
      window.__execs = 0;
      host.send = m => { if (m.type === "exec" && ++window.__execs === 1) return; return send(m); };
    });
    const saved = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")));
    await pressOpen(page);
    await selectInGodMode(page, "#card h3");
    await page.keyboard.press("Control+e");
    await page.keyboard.press("t");
    await page.keyboard.type("One");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__execs === 1);
    await page.waitForTimeout(600); // an observation window (the page clock is faked, so no frames to settle on): the save is queued behind the lost exec
    assert.deepEqual(await saved(), []);
    await page.clock.fastForward(16000); // each step gets 15s at most
    await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")).length === 1);
    assert.deepEqual((await saved())[0].edits.map(e => e.op), ["text"]);
    // The next edit runs the code again, so the lost one isn't lost for good.
    await selectInGodMode(page, "#toolbar button >> nth=1");
    await page.keyboard.press("Control+e");
    await page.keyboard.press("h");
    await page.waitForFunction(() => window.__execs >= 2);
  });
});

// ---- 2. page scripts can't press Morse's keys

test("synthetic key events from the page don't open the bar, talk, or act inside it", { skip }, async () => {
  await scenario({ init: SPEECH_FAILS }, async ({ page, status, waitFor }) => {
    await page.evaluate(fakeKey("keydown", { code: "Space", key: " ", ...OPEN_FLAGS }));
    await page.waitForTimeout(450); // longer than a hold: a duration being tested, not a wait for the app
    await page.evaluate(fakeKey("keyup", { code: "Space", key: " ", ...OPEN_FLAGS }));
    await page.evaluate(fakeKey("keydown", { code: "KeyM", key: "M", altKey: true, shiftKey: true }));
    await settle(page);
    let s = await status();
    assert.equal(s.open, false);
    assert.equal(s.voice, "idle");
    assert.equal(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".panel").hidden), true);
    // Real keys still work, and fake ones still do nothing once the bar is open.
    await pressOpen(page);
    await waitFor(s => s.open);
    await page.evaluate(fakeKey("keydown", { code: "F1", key: "F1" }));
    await page.evaluate(fakeKey("keydown", { code: "Escape", key: "Escape" }));
    await page.evaluate(fakeKey("keydown", { code: "Comma", key: ",", ctrlKey: true }));
    await settle(page);
    s = await status();
    assert.equal(s.open, true);
    assert.equal(s.pane, "");
    await page.keyboard.press("F1");
    await waitFor(s => s.pane === "help");
  });
});

// ---- 3. voice over a result refines it

test("voice over a result: holding the hotkey dictates a refinement instead of saving and closing", { skip }, async () => {
  await scenario({ query: "?ms=1", init: SPEECH_FAILS }, async ({ page, waitFor, log }) => {
    await pressOpen(page);
    await waitFor(s => s.open);
    await page.keyboard.type("make it airy");
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "result");
    await holdKeys(page);
    const listening = await waitFor(s => s.voice === "listening");
    assert.equal(listening.phase, "result");
    assert.match(listening.hint, /Listening/);
    await page.waitForTimeout(1300); // talk for 1.3s
    await releaseKeys(page);
    const s = await waitFor(s => s.voice === "idle" && s.input === "make the toolbar airier");
    assert.equal(s.open, true, "the bar stays open");
    assert.equal(s.phase, "result");
    assert.match(s.hint, /Airier toolbar/, "the result's status line comes back");
    assert.ok(!(await log()).some(m => m.type === "mods.save"), "nothing was saved");
    // Enter refines with what was said.
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "result" && s.input === "");
    assert.equal((await log()).filter(m => m.type === "generate").length, 2);
  });
  // With "Send after a pause" on, releasing refines straight away.
  await scenario({ query: "?auto&ms=1", init: SPEECH_FAILS }, async ({ page, waitFor, log }) => {
    await pressOpen(page);
    await waitFor(s => s.open);
    await page.keyboard.type("make it airy");
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "result");
    await holdKeys(page);
    await waitFor(s => s.voice === "listening");
    await page.waitForTimeout(1300); // talk for 1.3s
    await releaseKeys(page);
    await page.waitForFunction(() => window.__fake.log.filter(m => m.type === "generate").length === 2);
    await waitFor(s => s.phase === "result");
    assert.ok(!(await log()).some(m => m.type === "mods.save"));
  });
});

// ---- 4. the recorder gets every key, even with something selected for God mode

test("hotkey recorder: God mode doesn't take the keys being recorded", { skip }, async () => {
  await scenario({ page: "god", query: "?light&reset" }, async ({ page, waitFor }) => {
    await pressOpen(page);
    await selectInGodMode(page, "#card h3");
    await page.keyboard.press("Control+Comma");
    await waitFor(s => s.pane === "settings");
    await page.locator("[data-act=more]").click(); // the Mods panel's shortcut is under More settings (docs/dev/simplify.md)
    await page.locator('details:has([data-hk="mods"]) > summary').click();
    await page.locator(".hk[data-hk=mods]").click();
    await page.locator(".hkrow.recording").waitFor();
    await page.keyboard.press("Control+KeyE"); // God mode's "focus the edit tools"
    const s = await waitFor(s => s.hotkeys.mods === "Ctrl+KeyE");
    assert.equal(s.pane, "settings");
  });
});

// ---- 5. "none" is not a connected model

test("desktop onboarding: provider \"none\" is not a connected model", async () => {
  process.env.MORSE_HOME = tempDir("morse-hard-");
  const { handleOnboarding, modelConnected } = await import("../daemon/onboarding.js");
  const status = async settings => (await handleOnboarding({ type: "onboarding.get" }, { settings })).status.model.connected;
  assert.equal(await status({ provider: "none" }), false);
  assert.equal(await status({ provider: "demo" }), false);
  assert.equal(await status(undefined), false);
  assert.equal(await status({ provider: "claude-code" }), true);
  assert.equal(modelConnected({ provider: "anthropic" }), true);
});

// ---- 6. a detached runtime keeps none of the page's events

test("after the host detaches, the old runtime leaves the page's clicks and keys alone", { skip }, async () => {
  await scenario({}, async ({ page, waitFor }) => {
    await page.evaluate(() => {
      window.__got = [];
      document.addEventListener("click", e => __got.push("click:" + (e.target.id || e.target.localName)));
      document.addEventListener("keydown", e => __got.push(e.key));
    });
    await pressOpen(page);
    await waitFor(s => s.open); // pointing: it was taking every click
    await page.evaluate(() => { globalThis.__morseGen++; __got.length = 0; }); // what `morse stop` does
    await page.locator("#pagefield").click();
    for (const k of ["a", "F1", "Escape"]) await page.keyboard.press(k);
    assert.deepEqual(await page.evaluate(() => __got), ["click:pagefield", "a", "F1", "Escape"]);
    assert.equal(await page.locator("#pagefield").inputValue(), "a");
  });
});

test("every window listener in the runtime goes through listen(), which checks live()", () => {
  const src = readdirSync(path.join(root, "runtime/src")).filter(f => f.endsWith(".js"))
    .map(f => [f, readFileSync(path.join(root, "runtime/src", f), "utf8")]);
  for (const [f, s] of src) {
    const bare = s.split("\n").filter(l => /(^|[^.\w])addEventListener\(/.test(l) && !/^const listen =/.test(l));
    assert.deepEqual(bare, [], `${f} adds a window listener without listen()`);
  }
  // Every window key handler also ignores keys the page made up.
  for (const [f, s] of src) {
    for (const m of s.matchAll(/listen\("key(down|up)", e => \{\n(.*)\n/g)) {
      assert.match(m[2], /!e\.isTrusted/, `${f}: a ${m[1]} handler doesn't check isTrusted`);
    }
  }
});

// ---- 7. the extension command never takes the keys of a default hotkey

// ---- 8, 9. the edit tools hotkey

test("edit tools hotkey: leaves a running change's status alone; help shows the real key", { skip }, async () => {
  await scenario({ query: "?ms=150" }, async ({ page, waitFor, ui }) => {
    await pressOpen(page);
    await waitFor(s => s.open);
    await page.keyboard.press("F1");
    await waitFor(s => s.pane === "help");
    const help = await ui(".ob-can");
    assert.match(help, /Use the Edit toolsPoint at something, then press AltShiftG/);
    await page.keyboard.press("F1");
    await page.keyboard.type("make it airy");
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "working");
    await page.keyboard.press("Alt+Shift+KeyG");
    await settle(page);
    const s = await waitFor(s => s.phase === "working");
    assert.doesNotMatch(s.hint, /Point at something/);
  });
});

// ---- 10. copy that matches what Morse does

test("copy: no demo fallback promised", () => {
  const runtime = bundleRuntime();
  assert.doesNotMatch(runtime, /demo that only knows/, "the runtime still promises a demo");
  assert.match(runtime, /No model connected yet\. Connect one so Morse can make changes\./);
});

// ---- 11. only a model-made change counts as the first save

test("first-run coach: page tools saving on their own don't finish it or show the first-save tip", { skip }, async () => {
  await scenario({ query: "?onboarding&light" }, async ({ page, waitFor }) => {
    await pressOpen(page);
    await waitFor(s => s.open);
    // A new user's bar keeps Page tools back until the first save; Help shows everything (first run).
    await page.keyboard.press("F1");
    await waitFor(s => s.pane === "help");
    await page.keyboard.press("F1");
    await waitFor(s => s.pane === "");
    await page.locator(".more").click();
  await page.locator('[data-m="tools"]').click();
    await page.locator(".gm-menu button[data-k=dark]").click();
    await page.waitForFunction(() => window.__fake.log.some(m => m.type === "mods.save"));
    await hostRoundTrip(page); // the save's reply, and whatever the coach does with it, are done
    await settle(page);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("fake:onboarding") || "{}"));
    assert.notEqual(stored.coach, "done");
    assert.ok(!stored.tips?.saved);
  });
});

// ---- 12. the build ships no file with imports it can't resolve
