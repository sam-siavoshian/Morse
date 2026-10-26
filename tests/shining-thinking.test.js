// The status word "Thinking" shines only while a reply is generating.
// Reduced motion keeps that word in the normal bar color, with no infinite sweep.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { serveBar } from "./helpers/demo-server.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";

const skip = noBrowser;
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar();
  browser = await launchBrowser({ channel: "chromium" });
});
after(async () => { await browser?.close(); await srv?.close(); });

async function open(query, { reducedMotion = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(srv.url + query);
  await waitForReady(page);
  const status = () => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
  const waitFor = (pred, ms = TIMEOUT) => waitForStatus(page, pred, { timeout: ms, what: String(pred) });
  const shine = () => page.evaluate(() => {
    const host = document.querySelector("[data-morse-ui]");
    const root = host.shadowRoot;
    const hint = root.querySelector(".hint");
    const cs = getComputedStyle(hint);
    const frames = [];
    for (const sheet of root.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === "m-shine") {
          for (const k of rule.cssRules) frames.push(`${k.keyText} ${k.style.backgroundPosition}`);
        }
      }
    }
    return {
      theme: host.dataset.theme,
      text: hint.textContent,
      on: hint.classList.contains("shine"),
      owners: [...root.querySelectorAll(".shine")].map(el => el.className),
      name: cs.animationName,
      duration: cs.animationDuration,
      timing: cs.animationTimingFunction,
      count: cs.animationIterationCount,
      image: cs.backgroundImage,
      size: cs.backgroundSize,
      clip: cs.backgroundClip,
      color: cs.color,
      fill: cs.webkitTextFillColor,
      statusColor: getComputedStyle(root.querySelector(".status")).color,
      promptColor: getComputedStyle(root.querySelector(".in")).color,
      tickerColor: getComputedStyle(root.querySelector(".ticker")).color,
      frames: frames.join(" | "),
    };
  });
  return { page, status, waitFor, shine, errors, close: () => ctx.close() };
}

const clear = "rgba(0, 0, 0, 0)";
const dump = s => JSON.stringify(s);

async function ask(t) {
  await pressOpen(t.page);
  await t.waitFor(s => s.open && s.phase === "idle");
  const idle = await t.shine();
  assert.equal(idle.on, false, `idle hint shines ${dump(idle)}`);
  assert.deepEqual(idle.owners, [], "shine class before a reply");
  await t.page.keyboard.type("make the toolbar airier");
  await t.page.keyboard.press("Enter");
  return t.waitFor(s => s.phase === "working" && s.hint === "Thinking");
}

test("the Thinking label shines only while generating, and reduced motion does not sweep it", { skip }, async () => {
  const dark = await open("?think=3000&ms=20");
  try {
    await ask(dark);
    const thinking = await dark.shine();
    assert.equal(thinking.theme, "dark", dump(thinking));
    assert.equal(thinking.on, true, "Thinking has the shine class");
    assert.deepEqual(thinking.owners, ["hint shine"], "only the status label shines");
    assert.equal(thinking.name, "m-shine", dump(thinking));
    assert.equal(thinking.duration, "2s");
    assert.equal(thinking.timing, "linear");
    assert.equal(thinking.count, "infinite");
    assert.equal(thinking.size, "200% 100%");
    assert.equal(thinking.clip, "text");
    assert.equal(thinking.color, clear);
    assert.equal(thinking.fill, clear);
    assert.match(thinking.image, /110deg/);
    assert.match(thinking.image, /rgb\(64,\s*64,\s*64\)/, "dark bar: dim gray");
    assert.match(thinking.image, /rgb\(255,\s*255,\s*255\)/, "dark bar: the peak");
    assert.match(thinking.frames, /200%/);
    assert.match(thinking.frames, /-200%/);
    assert.notEqual(thinking.promptColor, clear, "the prompt does not shine");
    assert.notEqual(thinking.tickerColor, clear, "the ticker does not shine");
    await dark.waitFor(s => s.phase === "working" && /Writing/.test(s.hint));
    const writing = await dark.shine();
    assert.equal(writing.on, false, `still generating, but not Thinking: ${dump(writing)}`);
    assert.deepEqual(writing.owners, []);
    await dark.waitFor(s => s.phase === "result");
    const done = await dark.shine();
    assert.equal(done.on, false, "generation ended");
    assert.deepEqual(done.owners, []);
    assert.notEqual(done.color, clear, "the label is normal text again");
    assert.deepEqual(dark.errors, []);
  } finally { await dark.close(); }

  const light = await open("?light&think=3000&ms=20");
  try {
    await ask(light);
    const thinking = await light.shine();
    assert.equal(thinking.theme, "light", dump(thinking));
    assert.equal(thinking.on, true);
    assert.deepEqual(thinking.owners, ["hint shine"]);
    assert.equal(thinking.count, "infinite");
    assert.equal(thinking.clip, "text");
    assert.match(thinking.image, /110deg/);
    assert.match(thinking.image, /rgb\(17,\s*17,\s*19\)/, "light bar: the dark end is the text token");
    assert.match(thinking.image, /rgb\(106,\s*106,\s*114\)/, "light bar: the light end stays readable");
    assert.doesNotMatch(thinking.image, /rgb\(255,\s*255,\s*255\)/, "a white peak would vanish on a light bar");
    await light.waitFor(s => s.phase === "result");
    assert.equal((await light.shine()).on, false);
    assert.deepEqual(light.errors, []);
  } finally { await light.close(); }

  const calm = await open("?think=3000&ms=20", { reducedMotion: true });
  try {
    await ask(calm);
    const thinking = await calm.shine();
    assert.equal(thinking.on, true, "the label is still the thinking status");
    assert.deepEqual(thinking.owners, ["hint shine"]);
    assert.equal(thinking.name, "none", `no sweep ${dump(thinking)}`);
    assert.notEqual(thinking.count, "infinite");
    assert.notEqual(thinking.color, clear, "readable");
    assert.equal(thinking.color, thinking.statusColor, "the normal bar color");
    assert.notEqual(thinking.fill, clear, "the fill does not hide the word");
    await calm.waitFor(s => s.phase === "result");
    const done = await calm.shine();
    assert.equal(done.on, false, "generation ended");
    assert.deepEqual(done.owners, []);
    assert.deepEqual(calm.errors, []);
  } finally { await calm.close(); }
});
