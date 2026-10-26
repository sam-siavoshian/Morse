// The command bar in real Chromium: hotkey recorder, prompt history, Stop
// mid-generation, the voice fallback path and keyboard/a11y behavior. Runs
// the real runtime against demo/bar-playground.html's fake host.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { serveBar } from "./helpers/demo-server.js";
import { OPEN_KEY, holdKeys, pressOpen, releaseKeys } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, settle, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar(); // port 0
  // New headless (channel "chromium") has real audio capture; falls back to the default build.
  browser = await launchBrowser({ channel: "chromium", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
});
after(async () => { await browser?.close(); await srv?.close(); });

// Web Speech needs Google's servers; inside Electron it fails like this. Make
// that deterministic so the fallback path is what runs.
const SPEECH_FAILS = () => {
  globalThis.webkitSpeechRecognition = class extends EventTarget {
    start() { setTimeout(() => { this.onerror?.(Object.assign(new Event("error"), { error: "network" })); const e = new Event("end"); this.onend?.(e); this.dispatchEvent(e); }, 20); }
    stop() {} abort() {}
  };
};

async function open(query = "", init) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(srv.url + query);
  await waitForReady(page);
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, ms = TIMEOUT) => waitForStatus(page, pred, { timeout: ms, what: String(pred) });
  const log = () => page.evaluate(() => window.__fake.log);
  const shadow = fn => page.evaluate(fn);
  return { page, ctx, status, waitFor, log, shadow, errors, close: () => ctx.close() };
}
// Opens a page, runs the test, and always closes the context (a leaked page
// would keep keyboard focus from the next test).
async function scenario(query, init, fn) {
  const t = await open(query, init);
  try { await fn(t); assert.deepEqual(t.errors, []); }
  finally { await t.close(); }
}
const sr = sel => `document.querySelector("[data-morse-ui]").shadowRoot.querySelector(${JSON.stringify(sel)})`;

test("hotkey recorder: refuses critical combos, rebinds, persists, and the old key goes back to the page", { skip }, async () => {
  await scenario("", null, async t => {
    const { page } = t;
    await page.evaluate(() => { window.__pageKeys = []; addEventListener("keydown", e => __pageKeys.push(e.code)); });
    await pressOpen(page);
    await t.waitFor(s => s.open);
    await page.keyboard.press("Control+Comma");
    await t.waitFor(s => s.pane === "settings");
    assert.equal(await page.evaluate(`${sr(".hk[data-hk=open]")} === document.querySelector("[data-morse-ui]").shadowRoot.activeElement`), true, "focus moves into the sheet");
    await page.keyboard.press("Enter"); // arm the recorder
    await page.waitForFunction(`${sr(".hkrow.recording")}`);
    await page.keyboard.press("Control+KeyW");
    assert.match(await page.evaluate(`${sr("#hk-open-msg")}.textContent`), /Ctrl\+W closes the tab/);
    assert.ok(!(await t.log()).some(m => m.type === "settings.set"), "a refused combo is not saved");
    await page.keyboard.press("Alt+Shift+KeyK");
    const s = await t.waitFor(s => s.hotkeys.open === "Alt+Shift+KeyK");
    assert.equal(s.hotkeys.talk, "Alt+Shift+KeyK", "push to talk follows Open until changed");
    assert.deepEqual((await t.log()).filter(m => m.type === "settings.set").at(-1).settings, { hotkeys: { open: "Alt+Shift+KeyK" } });
    await page.keyboard.press("Escape"); // closes the sheet
    await t.waitFor(s => s.pane === "");
    await page.keyboard.press("Escape"); // closes the bar
    await t.waitFor(s => !s.open);
    // The old hotkey now belongs to the page again.
    await page.evaluate(() => (__pageKeys.length = 0));
    await pressOpen(page);
    await page.waitForFunction(() => __pageKeys.includes("Space")); // the page got the key
    await settle(page);
    assert.equal((await t.status()).open, false);
    assert.deepEqual(await page.evaluate(() => __pageKeys), OPEN_KEY.split("+").map(k => k === "Space" ? k : `${k}Left`));
    // IME composition and key repeat never trigger a hotkey.
    await page.evaluate(() => {
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "K", altKey: true, shiftKey: true, isComposing: true, bubbles: true }));
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "K", altKey: true, shiftKey: true, repeat: true, bubbles: true }));
    });
    await settle(page);
    assert.equal((await t.status()).open, false);
    await page.keyboard.press("Alt+Shift+KeyK");
    await t.waitFor(s => s.open);
    // Survives a reload (the host stored it).
    await page.reload();
    await waitForReady(page);
    await t.waitFor(s => s.hotkeys.open === "Alt+Shift+KeyK");
  });
});

test("prompt history: ↑/↓ in an empty input, per site, persisted", { skip }, async () => {
  await scenario("?ms=1", null, async t => {
    const { page } = t;
    for (const p of ["make it dark", "hide the sidebar"]) {
      await pressOpen(page);
      await t.waitFor(s => s.open && s.phase === "idle");
      await page.keyboard.type(p);
      await page.keyboard.press("Enter");
      await t.waitFor(s => s.phase === "result");
      await page.keyboard.press("Escape"); // keeps the result and closes
      await t.waitFor(s => !s.open);
    }
    await pressOpen(page);
    await t.waitFor(s => s.open);
    const expectInput = (v, msg) => t.waitFor(s => s.input === v, 10000).catch(() => assert.fail(msg || `input should be ${JSON.stringify(v)}`));
    await page.keyboard.press("ArrowUp");
    await expectInput("hide the sidebar");
    await page.keyboard.press("ArrowUp");
    await expectInput("make it dark");
    await page.keyboard.press("ArrowUp");
    await expectInput("make it dark", "stops at the oldest");
    await page.keyboard.press("ArrowDown");
    await expectInput("hide the sidebar");
    await page.keyboard.press("ArrowDown");
    await expectInput("", "past the newest is a fresh prompt");
    // Typed text is never replaced by history.
    await page.keyboard.type("draft");
    await page.keyboard.press("ArrowUp");
    await expectInput("draft");
    const adds = (await t.log()).filter(m => m.type === "history.add");
    assert.deepEqual(adds.map(a => a.text), ["make it dark", "hide the sidebar"]);
    assert.match(adds[0].scope, /^127\.0\.0\.1:\d+$/);
    await page.reload();
    await waitForReady(page); // the bar is up; ↑ waits if history.get is still in flight
    await pressOpen(page);
    await t.waitFor(s => s.open);
    await page.keyboard.press("ArrowUp");
    await expectInput("hide the sidebar", "history survives a reload");
  });
});

test("Esc mid-generation: cancels on the host, removes partial CSS, ends the effect, keeps the prompt", { skip }, async () => {
  await scenario("?ms=150", null, async t => {
    const { page } = t;
    const gap = () => page.evaluate(() => getComputedStyle(document.getElementById("toolbar")).gap);
    const before = await gap();
    await pressOpen(page);
    const tb = await page.locator("#toolbar").boundingBox();
    await page.mouse.click(tb.x + tb.width / 2, tb.y + 4);
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "working" && /Writing/.test(s.hint));
    await page.waitForFunction(() => document.querySelector("style[data-morse-css]")); // CSS applied while streaming
    assert.notEqual(await gap(), before);
    await page.keyboard.press("Escape");
    const s = await t.waitFor(s => s.phase === "idle" && /Stopped/.test(s.hint));
    assert.equal(s.input, "make the toolbar airier");
    assert.equal(s.open, true);
    const gen = (await t.log()).find(m => m.type === "generate");
    assert.deepEqual(await page.evaluate(() => window.__fake.cancelled), [gen.genId]);
    assert.equal(await page.locator("style[data-morse-css]").count(), 0, "partial CSS removed");
    assert.equal(await gap(), before);
    assert.equal(await page.evaluate(`getComputedStyle(${sr(".fx")}).display`), "none", "effect ended");
    assert.equal(await page.evaluate(`${sr(".in")}.disabled`), false);
    // ⌘. / Ctrl+. stops too, and Enter runs it again.
    await page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "working");
    await page.keyboard.press("Control+Period");
    await t.waitFor(s => s.phase === "idle" && /Stopped/.test(s.hint));
    assert.equal((await page.evaluate(() => window.__fake.cancelled)).length, 2);
  });
});

test("voice: Web Speech fails, the recording goes to the host's transcribe", { skip }, async () => {
  await scenario("", SPEECH_FAILS, async t => {
    const { page } = t;
    await pressOpen(page);
    await t.waitFor(s => s.open);
    await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
    await t.waitFor(s => s.voice === "listening");
    const partial = await t.waitFor(s => s.input === "make the toolbar"); // live partial transcript
    assert.match(partial.hint, /Listening/);
    await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
    const s = await t.waitFor(s => s.voice === "idle" && s.input === "make the toolbar airier");
    assert.equal(s.backend, "recorder");
    assert.equal(s.phase, "idle", "not auto-submitted by default");
    const tr = (await t.log()).filter(m => m.type === "transcribe");
    assert.ok(tr.length >= 2, "partials and a final");
    assert.match(tr.at(-1).mime, /^audio\/webm/);
    assert.ok(tr.at(-1).size > 100);
    assert.equal(tr.at(-1).partial, false);
  });
});

test("voice: hold the hotkey to talk, release to finish; auto-submit sends it", { skip }, async () => {
  await scenario("?auto&ms=1", SPEECH_FAILS, async t => {
    const { page } = t;
    await holdKeys(page);
    await t.waitFor(s => s.open && s.voice === "listening");
    await page.waitForTimeout(1300); // hold the key for 1.3s: how long the user talks, not a wait for the app
    await releaseKeys(page);
    await t.waitFor(s => s.phase === "result");
    const gen = (await t.log()).find(m => m.type === "generate");
    assert.ok(gen, "submitted");
  });
});

test("voice: explains in one line when it can't work", { skip }, async () => {
  const clickMic = t => t.page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".mic").click());
  await scenario("?voice=0", () => { delete globalThis.webkitSpeechRecognition; delete globalThis.SpeechRecognition; }, async t => {
    await pressOpen(t.page);
    await clickMic(t);
    const s = await t.waitFor(s => /OpenAI key/.test(s.hint));
    assert.equal(s.voice, "idle");
    assert.equal(await t.page.evaluate(`${sr(".mic")}.classList.contains("off")`), true);
  });
  await scenario("", () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")); }, async t => {
    await pressOpen(t.page);
    await clickMic(t);
    const s = await t.waitFor(s => /The microphone is blocked/.test(s.hint));
    assert.equal(s.voice, "idle");
  });
  await scenario("", () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("none", "NotFoundError")); }, async t => {
    await pressOpen(t.page);
    await clickMic(t);
    await t.waitFor(s => /No microphone found/.test(s.hint));
  });
});

test("keyboard and a11y: dialog, live status, Tab stays in the bar, focus comes back, cheat sheet", { skip }, async () => {
  await scenario("", null, async t => {
    const { page } = t;
    await page.focus("#pagefield");
    await pressOpen(page);
    await t.waitFor(s => s.open);
    assert.equal(await page.evaluate(`${sr(".bar")}.getAttribute("role")`), "dialog");
    assert.ok(await page.evaluate(`${sr(".bar")}.getAttribute("aria-label")`));
    assert.equal(await page.evaluate(`${sr(".sr")}.getAttribute("aria-live")`), "polite");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 3 ? "Tab" : "Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-morse-ui")), true, `Tab #${i} left the bar`);
    }
    // Tab from the empty input lands on the first suggestion; arrows move between them.
    await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".in").focus());
    await page.keyboard.press("Tab");
    await t.waitFor(s => s.focus === "sug");
    await page.keyboard.press("ArrowRight");
    // The page's own suggestions (58-suggest.js): the second chip, whatever this page offers.
    const second = await page.evaluate(`[...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".sug")][1].textContent`);
    assert.ok(second);
    assert.equal(await page.evaluate(`document.querySelector("[data-morse-ui]").shadowRoot.activeElement.textContent`), second);
    await page.keyboard.press("Escape");
    await t.waitFor(s => s.focus === "in"); // Esc from a chip goes back to the input
    await page.keyboard.type("?");
    await t.waitFor(s => s.pane === "shortcuts" && s.input === "");
    const sheet = await page.evaluate(`${sr(".pane")}.textContent`);
    assert.match(sheet, /Open or close Morse/);
    assert.match(sheet, /(?:Ctrl.*Alt.*Space)|(?:⌃⌥Space)/);
    await page.keyboard.type("x"); // typing closes it and types
    await t.waitFor(s => s.pane === "" && s.input === "x");
    // Shift+Enter is a newline; the input grows.
    const h0 = await page.evaluate(`${sr(".in")}.offsetHeight`);
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second line");
    await t.waitFor(s => s.input === "x\nsecond line");
    assert.ok((await page.evaluate(`${sr(".in")}.offsetHeight`)) > h0);
    assert.equal((await t.status()).phase, "idle", "Shift+Enter did not submit");
    await page.keyboard.press("Escape");
    await t.waitFor(s => !s.open);
    assert.equal(await page.evaluate(() => document.activeElement.id), "pagefield", "focus returned to the page");
    // Closed: Escape and typing belong to the page.
    await page.evaluate(() => { window.__k = []; addEventListener("keydown", e => __k.push(e.key)); });
    await page.keyboard.type("ab");
    await page.keyboard.press("Escape");
    assert.deepEqual(await page.evaluate(() => __k), ["a", "b", "Escape"]);
    assert.equal(await page.inputValue("#pagefield"), "ab");
  });
});

test("effects setting: off shows no animation over the page, subtle keeps a still outline", { skip }, async () => {
  for (const effects of ["off", "subtle"]) {
    const init = `localStorage.setItem("fake:settings", JSON.stringify({ effects: "${effects}" }))`;
    await scenario("?ms=150", init, async t => { // slow enough to still be working when we look
      const { page } = t;
      await pressOpen(page);
      const tb = await page.locator("#toolbar").boundingBox();
      await page.mouse.click(tb.x + tb.width / 2, tb.y + 4);
      await page.keyboard.type("make the toolbar airier");
      await page.keyboard.press("Enter");
      await t.waitFor(s => s.phase === "working");
      await page.waitForFunction(() => document.querySelector("style[data-morse-css]")); // streaming: the effect would be up by now
      await settle(page);
      assert.equal(await page.evaluate(`getComputedStyle(${sr(".fx")}).display`), "none", `${effects}: no radar field`);
      assert.equal(await page.evaluate(`${sr(".sel")}.classList.contains("busy")`), effects === "subtle");
      await t.waitFor(s => s.phase === "result");
    });
  }
});

test("Model setting: Automatic, Always fast, Always best, saved; the footer names the model that answered", { skip }, async () => {
  await scenario("?models&ms=40", null, async t => {
    const { page } = t;
    const seg = v => `.seg[data-k="modelMode"] [data-v="${v}"]`;
    const openSettings = async () => {
      await pressOpen(page);
      await t.waitFor(s => s.open);
      await page.keyboard.press("Control+Comma");
      await t.waitFor(s => s.pane === "settings");
      // The model is under More settings (docs/dev/simplify.md).
      if (await page.locator("[data-act=more]").getAttribute("aria-expanded") === "false") await page.locator("[data-act=more]").click();
    };
    await openSettings();
    assert.equal(await page.locator(seg("auto")).getAttribute("aria-checked"), "true", "Automatic unless chosen");
    assert.match(await page.locator('.seg[data-k="modelMode"]').locator("xpath=../..").innerText(), /Small changes use sonnet/);
    await page.locator(seg("best")).click();
    await page.waitForFunction(() => window.__fake.log.some(m => m.type === "settings.set" && m.settings?.modelMode === "best"));
    await page.locator(seg("best") + '[aria-checked="true"]').waitFor();
    assert.match(await page.locator('.seg[data-k="modelMode"]').locator("xpath=../..").innerText(), /Every change uses opus/);
    await page.reload();
    await waitForReady(page);
    await openSettings();
    assert.equal(await page.locator(seg("best")).getAttribute("aria-checked"), "true", "kept after a reload");
    await page.keyboard.press("Escape");
    await t.waitFor(s => s.pane === "");
    // The fast model's draft failed and the strong one took over: the bar says so, then names it.
    await page.keyboard.type("make the toolbar airier");
    // A pause in typing tells the host the words so far (it warms the model they start on).
    await page.waitForFunction(() => window.__fake.log.some(m => m.type === "warm" && m.request === "make the toolbar airier"));
    await page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "working" && /Asking a stronger model/.test(s.hint));
    await t.waitFor(s => s.phase === "result");
    await page.keyboard.press("Escape");
    await t.waitFor(s => !s.open);
    await pressOpen(page);
    await t.waitFor(s => s.open && s.phase === "idle");
    assert.equal(await page.locator(".model").innerText(), "Claude Code · opus");
  });
});

test("the effect check: a clock ticking on the page is not a change; a real one is", { skip }, async () => {
  await scenario("", null, async t => {
    const { page } = t;
    await pressOpen(page);
    await t.waitFor(s => s.open);
    await page.evaluate(() => {
      const c = Object.assign(document.createElement("time"), { textContent: "0:00" });
      document.body.append(c);
      let n = 0;
      window.__tick = setInterval(() => { c.textContent = `0:${String(++n).padStart(2, "0")}`; c.style.paddingLeft = `${n % 3}px`; }, 50);
    });
    const before = await page.evaluate(() => globalThis.__morseProbe(null, [], { learn: true }));
    await page.waitForTimeout(400);
    const still = await page.evaluate(() => globalThis.__morseProbe(null, []));
    assert.equal(still.fp, before.fp, "only the clock moved: the same look");
    await page.evaluate(() => { document.querySelector("h1, p, div").style.display = "none"; });
    const changed = await page.evaluate(() => globalThis.__morseProbe(null, []));
    assert.notEqual(changed.fp, before.fp, "something hidden is a change");
    await page.evaluate(() => clearInterval(window.__tick));
  });
});

test("polish: a field a change added low in its bar is measured as off the middle; a centered one isn't", { skip }, async () => {
  await scenario("", null, async t => {
    const { page } = t;
    await pressOpen(page);
    await t.waitFor(s => s.open);
    const measure = () => page.evaluate(async () => { const a = await globalThis.__morseShotArea(null, "m-test"); await globalThis.__morseShotArea(null, null, true); return a.misaligned; });
    await page.evaluate(() => {
      const bar = Object.assign(document.createElement("div"), { style: "display:flex;height:56px;align-items:flex-end;gap:8px;background:#eee" });
      bar.innerHTML = '<button>Home</button><input data-morse="m-test" placeholder="Filter" style="height:28px;box-sizing:border-box">';
      document.body.prepend(bar);
      window.__row = bar;
    });
    const off = await measure();
    assert.equal(off.length, 1);
    assert.match(off[0], /14px below the middle of its row \(the row is 56px tall, it is 28px\)/);
    await page.evaluate(() => { window.__row.style.alignItems = "center"; });
    assert.deepEqual(await measure(), []);
  });
});

// The dashed selection box is Morse's overlay (.sel / the edit frame), not the
// page's own focus ring. It has to leave when the choice is over.
test("selection outline is gone after the chip is dismissed, the run ends, or the bar closes", { skip }, async () => {
  const boxes = page => page.evaluate(() => {
    const root = document.querySelector("[data-morse-ui]").shadowRoot;
    const shown = el => {
      for (let n = el; n; n = n.parentElement) {
        if (n.hidden) return false;
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden") return false;
      }
      return !!el;
    };
    return {
      sel: shown(root.querySelector(".sel")),
      hl: shown(root.querySelector(".hl")),
      frame: shown(root.querySelector(".gm-frame")),
      marks: document.querySelectorAll(".morse-selected, .morse-hover").length,
    };
  });
  const stamp = page => page.evaluate(() => {
    const el = document.querySelector(".morse-selected") || document.querySelector("#toolbar");
    el.classList.add("morse-selected", "morse-hover");
    document.querySelector("#toolbar").classList.add("morse-selected", "morse-hover");
  });

  await scenario("?ms=40", null, async t => {
    const { page } = t;
    await pressOpen(page);
    await t.waitFor(s => s.open);
    const tb = await page.locator("#toolbar").boundingBox();
    const at = (x, y) => ({ x: tb.x + x, y: tb.y + y });
    await page.mouse.move(at(24, tb.height / 2).x, at(24, tb.height / 2).y);
    await page.waitForFunction(() => {
      const hl = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".hl");
      return hl && !hl.hidden && getComputedStyle(hl).display !== "none";
    });
    await page.mouse.click(at(24, tb.height / 2).x, at(24, tb.height / 2).y);
    await page.waitForFunction(() => {
      const root = document.querySelector("[data-morse-ui]").shadowRoot;
      const frame = root.querySelector(".gm-frame");
      const sel = root.querySelector(".sel");
      const vis = el => {
        for (let n = el; n; n = n.parentElement) {
          if (!n || n.hidden) return false;
          const s = getComputedStyle(n);
          if (s.display === "none" || s.visibility === "hidden") return false;
        }
        return !!el;
      };
      return vis(frame) || vis(sel);
    });
    await stamp(page);
    assert.ok((await boxes(page)).marks >= 1);
    await page.locator("[data-morse-ui]").evaluate(h => h.shadowRoot.querySelector(".chip.target .x").click());
    await settle(page);
    let b = await boxes(page);
    assert.equal(b.sel, false, "dismissed chip: dashed box");
    assert.equal(b.frame, false, "dismissed chip: edit frame");
    assert.equal(b.marks, 0, "dismissed chip: host marks");

    await page.mouse.move(at(70, tb.height / 2).x, at(70, tb.height / 2).y);
    await page.waitForFunction(() => {
      const hl = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".hl");
      return hl && !hl.hidden && getComputedStyle(hl).display !== "none";
    });
    await page.mouse.click(at(70, tb.height / 2).x, at(70, tb.height / 2).y);
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "working");
    await stamp(page);
    await t.waitFor(s => s.phase === "result");
    await settle(page);
    await page.evaluate(() => { document.body.style.minHeight = "4000px"; window.scrollTo(0, 500); });
    await settle(page);
    b = await boxes(page);
    assert.equal(b.sel, false, "after the run");
    assert.equal(b.hl, false, "hover box after the run");
    assert.equal(b.frame, false, "edit frame after the run");
    assert.equal(b.marks, 0, "host marks after the run");
    await page.keyboard.press("Escape");
    await t.waitFor(s => !s.open);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.mouse.move(40, 40);
    await settle(page);
    b = await boxes(page);
    assert.equal(b.sel, false, "after the bar closes");
    assert.equal(b.hl, false, "hover box after the bar closes");
    assert.equal(b.frame, false, "edit frame after the bar closes");
    assert.equal(b.marks, 0, "host marks after the bar closes");
  });

  await scenario("?ms=150", null, async t => {
    const { page } = t;
    await pressOpen(page);
    await t.waitFor(s => s.open);
    const tb = await page.locator("#toolbar").boundingBox();
    await page.mouse.click(tb.x + tb.width / 2, tb.y + 4);
    await page.keyboard.type("make the toolbar airier");
    await page.keyboard.press("Enter");
    await t.waitFor(s => s.phase === "working");
    await stamp(page);
    await page.keyboard.press("Escape");
    const s = await t.waitFor(s => s.phase === "idle" && /Stopped/.test(s.hint));
    assert.equal(s.open, true, "a stop leaves the bar open");
    await settle(page);
    await page.evaluate(() => { document.body.style.minHeight = "4000px"; window.scrollTo(0, 400); });
    await settle(page);
    const b = await boxes(page);
    assert.equal(b.sel, false, "after cancel");
    assert.equal(b.frame, false, "edit frame after cancel");
    assert.equal(b.marks, 0, "host marks after cancel");
  });
});
