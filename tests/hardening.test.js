// Regressions from the third bug hunt: requests that never settle, page
// scripts faking key presses, voice over a result, the hotkey recorder vs God
// mode, a detached runtime that kept the page's keys, the extension command
// eating the Windows hotkey, and copy that promised things Morse doesn't do.
// Runtime cases run the real runtime in Chromium against the fake hosts in
// demo/bar-playground.html and demo/playground.html; extension cases load the
// built extension (they need a display, like tests/security.test.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { serveBar } from "../demo/bar-server.js";
import { bundleRuntime } from "../runtime/bundle.js";
import { defaultHotkeys } from "../core/hotkeys.js";
import { plainError } from "../core/onboarding.js";
// The default Open Morse / push-to-talk combo for this platform.
const MAC = process.platform === "darwin";
const OPEN_KEY = MAC ? "Alt+Space" : "Control+Shift+Space";
const OPEN_MODS = MAC ? ["Alt"] : ["Control", "Shift"];
const OPEN_FLAGS = MAC ? { altKey: true } : { ctrlKey: true, shiftKey: true };

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
const skipExt = skip || (!process.env.DISPLAY && "extensions need a display (run under Xvfb)");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar();
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
  try { browser = await chromium.launch({ channel: "chromium", args }); }
  catch { browser = await chromium.launch({ args }); }
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
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
  const status = () => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
  const waitFor = async (pred, ms = 8000) => {
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

// ---- 1. a closed port settles every request that was waiting on it

function loadHost() {
  const event = () => { const fns = []; return { addListener: f => fns.push(f), fire: (...a) => fns.forEach(f => f(...a)) }; };
  const ports = [];
  const chrome = {
    runtime: {
      connect() {
        const p = { sent: [], dead: false, onMessage: event(), onDisconnect: event(),
          postMessage(m) { if (p.dead) throw new Error("Attempting to use a disconnected port object"); p.sent.push(m); } };
        ports.push(p);
        return p;
      },
      onMessage: { addListener() {} },
    },
  };
  const window = { addEventListener() {} };
  window.top = window;
  const ctx = vm.createContext({ chrome, window, document: { documentElement: { dataset: {} } }, location: { href: "https://a.test/", origin: "https://a.test" } });
  vm.runInContext(readFileSync(path.join(root, "extension/host.js"), "utf8"), ctx);
  return { host: ctx.__morseHost, ports };
}

test("extension host: when the port closes, every request still waiting gets an error reply", () => {
  const { host, ports } = loadHost();
  const got = [];
  host.onMessage(m => got.push({ ...m })); // copied out of the vm realm for deepEqual
  host.send({ id: 1, type: "mods.list" });
  host.send({ id: 2, type: "exec" });
  host.send({ type: "fire-and-forget" }); // no id: nothing to settle
  assert.equal(ports.length, 1);
  ports[0].onMessage.fire({ reply: 1, result: [] });
  ports[0].onDisconnect.fire(); // the service worker was recycled
  assert.deepEqual(got, [{ reply: 1, result: [] }, { reply: 2, error: "Morse restarted. Try again." }]);
  assert.match(plainError(new Error("message port closed")), /^(?!message port closed)/, "the bar shows plain words, not the raw error");

  // The next request reconnects; one sent on a port that died before its
  // onDisconnect ran is retried on a fresh port, and the old port's
  // disconnect doesn't fail it.
  host.send({ id: 3, type: "mods.list" });
  assert.equal(ports.length, 2);
  ports[1].dead = true;
  host.send({ id: 4, type: "mods.list" });
  assert.equal(ports.length, 3);
  assert.equal(ports[2].sent.at(-1).id, 4);
  got.length = 0;
  ports[1].onDisconnect.fire();
  assert.deepEqual(got, [{ reply: 3, error: "Morse restarted. Try again." }]);
  ports[2].onMessage.fire({ reply: 4, result: [] });
  ports[2].onDisconnect.fire();
  assert.deepEqual(got, [{ reply: 3, error: "Morse restarted. Try again." }, { reply: 4, result: [] }]);
});

test("God mode: one edit whose request is lost doesn't stop later edits from applying and saving", { skip }, async () => {
  await scenario({ page: "god", query: "?light&reset", clock: true }, async ({ page }) => {
    // The host never answers the first exec (a reply lost on the way back).
    await page.evaluate(() => {
      const host = globalThis.__morseHost, send = host.send.bind(host);
      window.__execs = 0;
      host.send = m => { if (m.type === "exec" && ++window.__execs === 1) return; return send(m); };
    });
    const saved = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:playground:mods") || "{}")));
    await page.keyboard.press(OPEN_KEY);
    await selectInGodMode(page, "#card h3");
    await page.keyboard.press("Control+e");
    await page.keyboard.press("t");
    await page.keyboard.type("One");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__execs === 1);
    await page.waitForTimeout(600); // the save is queued behind the lost exec
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
    await page.waitForTimeout(450); // longer than a hold
    await page.evaluate(fakeKey("keyup", { code: "Space", key: " ", ...OPEN_FLAGS }));
    await page.evaluate(fakeKey("keydown", { code: "KeyM", key: "M", altKey: true, shiftKey: true }));
    await page.waitForTimeout(100);
    let s = await status();
    assert.equal(s.open, false);
    assert.equal(s.voice, "idle");
    assert.equal(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".panel").hidden), true);
    // Real keys still work, and fake ones still do nothing once the bar is open.
    await page.keyboard.press(OPEN_KEY);
    await waitFor(s => s.open);
    await page.evaluate(fakeKey("keydown", { code: "F1", key: "F1" }));
    await page.evaluate(fakeKey("keydown", { code: "Escape", key: "Escape" }));
    await page.evaluate(fakeKey("keydown", { code: "Comma", key: ",", ctrlKey: true }));
    await page.waitForTimeout(100);
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
    await page.keyboard.press(OPEN_KEY);
    await waitFor(s => s.open);
    await page.keyboard.type("make it airy");
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "result");
    for (const k of OPEN_MODS) await page.keyboard.down(k);
    await page.keyboard.down("Space");
    const listening = await waitFor(s => s.voice === "listening");
    assert.equal(listening.phase, "result");
    assert.match(listening.hint, /Listening/);
    await page.waitForTimeout(1300);
    await page.keyboard.up("Space");
    for (const k of [...OPEN_MODS].reverse()) await page.keyboard.up(k);
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
    await page.keyboard.press(OPEN_KEY);
    await waitFor(s => s.open);
    await page.keyboard.type("make it airy");
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "result");
    for (const k of OPEN_MODS) await page.keyboard.down(k);
    await page.keyboard.down("Space");
    await waitFor(s => s.voice === "listening");
    await page.waitForTimeout(1300);
    await page.keyboard.up("Space");
    for (const k of [...OPEN_MODS].reverse()) await page.keyboard.up(k);
    await page.waitForFunction(() => window.__fake.log.filter(m => m.type === "generate").length === 2);
    await waitFor(s => s.phase === "result");
    assert.ok(!(await log()).some(m => m.type === "mods.save"));
  });
});

// ---- 4. the recorder gets every key, even with something selected for God mode

test("hotkey recorder: God mode doesn't take the keys being recorded", { skip }, async () => {
  await scenario({ page: "god", query: "?light&reset" }, async ({ page, waitFor }) => {
    await page.keyboard.press(OPEN_KEY);
    await selectInGodMode(page, "#card h3");
    await page.keyboard.press("Control+Comma");
    await waitFor(s => s.pane === "settings");
    await page.locator(".hk[data-hk=mods]").click();
    await page.locator(".hkrow.recording").waitFor();
    await page.keyboard.press("Control+KeyE"); // God mode's "focus the edit tools"
    const s = await waitFor(s => s.hotkeys.mods === "Ctrl+KeyE");
    assert.equal(s.pane, "settings");
  });
});

// ---- 5. "none" is not a connected model

test("desktop onboarding: provider \"none\" is not a connected model", async () => {
  process.env.MORSE_HOME = mkdtempSync(path.join(tmpdir(), "morse-hard-"));
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
    await page.keyboard.press(OPEN_KEY);
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

test("the extension command's keys differ from every platform's Open Morse and Talk hotkeys", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  const keys = manifest.commands["toggle-morse"].suggested_key;
  for (const platform of ["mac", "win", "linux"]) {
    const cmd = keys[platform] || keys.default;
    const d = defaultHotkeys(platform);
    // Chrome handles a command's keys before the page, so the bar would never
    // see them: a tap would only toggle and holding to talk could never work.
    assert.notEqual(cmd, d.open, `${platform}: the command would take the Open Morse keys`);
    assert.notEqual(cmd, d.talk, `${platform}: the command would take the Talk keys`);
  }
});

// ---- 8, 9. the edit tools hotkey

test("edit tools hotkey: leaves a running change's status alone; help shows the real key", { skip }, async () => {
  await scenario({ query: "?ms=150" }, async ({ page, waitFor, ui }) => {
    await page.keyboard.press(OPEN_KEY);
    await waitFor(s => s.open);
    await page.keyboard.press("F1");
    await waitFor(s => s.pane === "help");
    const help = await ui(".ob-can");
    assert.match(help, /Use the edit toolsPoint at something, then press AltShiftG/);
    await page.keyboard.press("F1");
    await page.keyboard.type("make it airy");
    await page.keyboard.press("Enter");
    await waitFor(s => s.phase === "working");
    await page.keyboard.press("Alt+Shift+KeyG");
    await page.waitForTimeout(200);
    const s = await waitFor(s => s.phase === "working");
    assert.doesNotMatch(s.hint, /Point at something/);
  });
});

// ---- 10. copy that matches what Morse does

test("copy: no demo fallback promised, no OpenAI key field promised", () => {
  const runtime = bundleRuntime();
  for (const [name, s] of [["runtime", runtime], ["popup-states.js", readFileSync(path.join(root, "extension/popup-states.js"), "utf8")]]) {
    assert.doesNotMatch(s, /demo that only knows/, `${name} still promises a demo`);
  }
  assert.match(runtime, /No model connected yet\. Connect one so Morse can make changes\./);
  const barHost = readFileSync(path.join(root, "extension/bar-host.js"), "utf8");
  const hint = /hint: "(Voice[^"]*)"/.exec(barHost)?.[1];
  assert.ok(hint, "the voice hint");
  assert.doesNotMatch(hint, /popup|model settings/i, "no UI stores an OpenAI key for voice");
  const welcome = readFileSync(path.join(root, "extension/welcome.html"), "utf8");
  assert.doesNotMatch(welcome, /OpenAI API key in model settings|built-in demo model/);
  assert.doesNotMatch(readFileSync(path.join(root, "extension/popup.js"), "utf8"), /"Alt\+Space"/, "the popup reads the real shortcut");
});

test("popup: shows the Open Morse shortcut from settings", { skip: skipExt }, async () => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "morse-hard-")), {
    headless: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const id = new URL(sw.url()).host;
    const p = await ctx.newPage();
    const key = async () => {
      await p.goto(`chrome-extension://${id}/popup.html?url=${encodeURIComponent("http://127.0.0.1:8788/")}`);
      await p.waitForFunction(() => document.getElementById("label")?.textContent);
      return p.evaluate(() => { const k = document.getElementById("key"); return k.hidden ? null : k.textContent; });
    };
    assert.equal(await key(), MAC ? "⌥Space" : "Ctrl+Shift+Space");
    await sw.evaluate(() => chrome.storage.sync.set({ "morse.settings": { hotkeys: { open: "Alt+Shift+KeyK" } } }));
    assert.equal(await key(), "Alt+Shift+K");
    await sw.evaluate(() => chrome.storage.sync.set({ "morse.settings": { hotkeys: { open: "none" } } }));
    assert.equal(await key(), null);
  } finally { await ctx.close(); }
});

// ---- 11. only a model-made change counts as the first save

test("first-run coach: page tools saving on their own don't finish it or show the first-save tip", { skip }, async () => {
  await scenario({ query: "?onboarding&light" }, async ({ page, waitFor }) => {
    await page.keyboard.press(OPEN_KEY);
    await waitFor(s => s.open);
    await page.locator(".gm-qbtn").click();
    await page.locator(".gm-menu button[data-k=dark]").click();
    await page.waitForFunction(() => window.__fake.log.some(m => m.type === "mods.save"));
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("fake:onboarding") || "{}"));
    assert.notEqual(stored.coach, "done");
    assert.ok(!stored.tips?.saved);
  });
});

// ---- 12. the build ships no file with imports it can't resolve

test("build: no raw copies of files that are only bundled into background.js", { skip: !existsSync(EXT) && "run node scripts/build.js first" }, () => {
  for (const f of ["bar-host.js", "onboarding-host.js"]) assert.equal(existsSync(path.join(EXT, f)), false, `${f} was copied raw`);
  for (const f of readdirSync(EXT).filter(f => f.endsWith(".js"))) {
    assert.doesNotMatch(readFileSync(path.join(EXT, f), "utf8"), /from\s+["']\.\.\/core\//, `${f} imports ../core, which isn't in the build`);
  }
});
