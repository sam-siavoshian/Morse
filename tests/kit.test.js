// Runs the mod helper kit in a real (headless) Chromium.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { settle } from "./helpers/wait.js";

const skip = noBrowser;
let browser, page;

before(async () => {
  if (skip) return;
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.setContent(`<header><button>Share</button></header><ul id="l"><li>a</li></ul>`);
  await page.evaluate(KIT_SOURCE);
});
after(() => browser?.close());

const run = (id, js) => page.evaluate(wrapModCode(id, js));

test("watch does not match elements the mod inserted", { skip }, async () => {
  const r = await run("m1", `morse.watch("header button", b => b.before(morse.el("button", { text: "Copy" })));`);
  assert.deepEqual(r, { ok: true });
  await settle(page); // watch rescans on the frame after a mutation; it must not match its own button
  assert.equal(await page.locator("header button").count(), 2);
});

test("watch picks up elements added later", { skip }, async () => {
  await run("m2", `morse.watch("#l li", li => li.append(morse.el("b", { text: "!" })));`);
  await page.evaluate(() => { const li = document.createElement("li"); li.textContent = "b"; document.getElementById("l").append(li); });
  await page.waitForFunction(() => document.querySelectorAll("#l li b").length === 2);
  await settle(page);
  assert.equal(await page.locator("#l li b").count(), 2);
});

test("turning a mod off removes everything it created", { skip }, async () => {
  await page.evaluate(() => morse.__off("m1"));
  await page.evaluate(() => morse.__off("m2"));
  assert.equal(await page.locator("header button").count(), 1);
  assert.equal(await page.locator("#l li b").count(), 0);
});

test("a throwing mod reports the error and leaves nothing behind", { skip }, async () => {
  const r = await run("m3", `morse.css("body{color:red}"); nope();`);
  assert.equal(r.ok, false);
  assert.match(r.error, /nope is not defined/);
  assert.equal(await page.locator("style[data-morse=m3]").count(), 0);
});

test("errors inside callbacks are collected for the repair loop", { skip }, async () => {
  await run("m4", `morse.watch("header", h => h.missing.thing);`);
  const errs = await page.evaluate(() => morse.__errors("m4"));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /Cannot read properties of undefined/);
});

test("__stats reports how many elements each watch matches, now and ever", { skip }, async () => {
  assert.equal(await page.evaluate(() => morse.__stats("nope")), null, "not running: null");
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<ol id="s"><li>a</li></ol>`));
  await run("s1", `morse.watch("#s li", li => {}); morse.watch("#player-bar", () => {});`);
  let s = await page.evaluate(() => morse.__stats("s1"));
  assert.deepEqual(s.watches, [{ selector: "#s li", now: 1, total: 1 }, { selector: "#player-bar", now: 0, total: 0 }]);
  assert.equal(s.errors, 0);
  await page.evaluate(() => { const li = document.createElement("li"); document.getElementById("s").append(li); });
  await page.waitForFunction(() => morse.__stats("s1").watches[0].total === 2); // `now` is counted on demand; `total` once the watch ran
  s = await page.evaluate(() => morse.__stats("s1"));
  assert.deepEqual(s.watches[0], { selector: "#s li", now: 2, total: 2 });
  await page.evaluate(() => document.querySelectorAll("#s li").forEach(li => li.remove()));
  await page.waitForFunction(() => morse.__stats("s1").watches[0].now === 0);
  s = await page.evaluate(() => morse.__stats("s1"));
  assert.deepEqual(s.watches[0], { selector: "#s li", now: 0, total: 2 }, "total remembers what it found");
  await run("s2", `morse.watch("header", h => h.missing.thing);`);
  s = await page.evaluate(() => morse.__stats("s2"));
  assert.equal(s.errors, 1);
  assert.match(s.error, /Cannot read properties of undefined/);
  await page.evaluate(() => { morse.__off("s1"); morse.__off("s2"); });
  assert.equal(await page.evaluate(() => morse.__stats("s1")), null);
});

// ---- re-renders, shadow roots, frames, recycled rows

test("watch puts back what a re-render wiped: added elements, classes, styles, text", { skip }, async () => {
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<div id="app"><h1 class="t">Board</h1><ul><li class="c">A</li><li class="c">B</li></ul></div>`));
  await run("r1", `morse.watch("#app h1", h => { h.append(morse.el("b", { class: "n", text: " 2 left" })); h.classList.add("hot"); h.style.color = "red"; });
    morse.watch("#app li", li => { if (li.textContent === "B") li.textContent = "Bee"; });`);
  await page.evaluate(() => { const h = document.querySelector("#app h1"); h.innerHTML = "Board"; h.className = "t"; h.removeAttribute("style"); });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => { const h = document.querySelector("#app h1"); return [h.querySelectorAll("b.n").length, h.className, h.style.color]; }), [1, "t hot", "red"]);
  await page.evaluate(() => { document.querySelectorAll("#app li")[1].textContent = "B"; }); // the app renders its text again
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#app li")[1].textContent), "Bee");
  await page.evaluate(() => { document.querySelector("#app ul").innerHTML = `<li class="c">A</li><li class="c">B</li>`; }); // new elements
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#app li")[1].textContent), "Bee");
  await page.evaluate(() => morse.__off("r1"));
  assert.equal(await page.evaluate(() => document.querySelectorAll("#app b.n").length), 0);
});

test("a mod's own clicks are its new state, not something to put back", { skip }, async () => {
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<section id="p"><h2>Panel</h2><p>Body</p></section>`));
  await run("r2", `morse.watch("#p", p => {
    p.classList.add("open");
    const b = morse.el("button", { class: "tg", text: "toggle", on: { click() { p.classList.toggle("open"); } } });
    const x = morse.el("button", { class: "x", text: "dismiss", on: { click() { b.remove(); x.remove(); } } });
    p.append(b, x);
  });`);
  await page.click("#p .tg");
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector("#p").classList.contains("open")), false, "the toggle stays off");
  await page.click("#p .x");
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#p button").length), 0, "dismissed stays dismissed");
  await page.evaluate(() => morse.__off("r2"));
});

test("live watches follow rows a virtualized list reuses", { skip }, async () => {
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<div id="v"><div class="row"><span class="lv">INFO</span></div><div class="row"><span class="lv">ERROR</span></div></div>`));
  await run("r3", `morse.watch("#v .row", r => { r.classList.toggle("bad", r.querySelector(".lv").textContent === "ERROR"); r.append(morse.el("i", { text: "!" })); }, { live: true });`);
  const state = () => page.evaluate(() => [...document.querySelectorAll("#v .row")].map(r => `${r.className}:${r.querySelectorAll("i").length}`));
  assert.deepEqual(await state(), ["row:1", "row bad:1"]);
  await page.evaluate(() => { const [a, b] = document.querySelectorAll("#v .lv"); a.textContent = "ERROR"; b.textContent = "DEBUG"; }); // scrolled: rows show other lines
  await settle(page);
  assert.deepEqual(await state(), ["row bad:1", "row:1"], "re-run on the new content, old work undone");
  await page.evaluate(() => morse.__off("r3"));
});

test("'host >>> inside' reaches into open shadow roots and frames; css(text, where) styles inside", { skip }, async () => {
  await page.evaluate(() => {
    class XCard extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
      render() { this.shadowRoot.innerHTML = `<style>.t{color:rgb(0, 0, 0)}</style><button class="t">Go</button>`; }
    }
    customElements.define("x-card", XCard);
    document.body.insertAdjacentHTML("beforeend", `<x-card></x-card><x-card></x-card><iframe id="fr" srcdoc="<p>hi</p>"></iframe>`);
  });
  await page.waitForFunction(() => document.getElementById("fr").contentDocument?.querySelector("p"));
  await run("r4", `morse.css(".t { color: rgb(255, 0, 0) }", "x-card");
    morse.css("p { color: rgb(0, 128, 0) }", "#fr");
    morse.watch("x-card >>> .t", b => b.setAttribute("data-seen", "1"));`);
  const look = () => page.evaluate(() => ({
    colors: [...document.querySelectorAll("x-card")].map(x => getComputedStyle(x.shadowRoot.querySelector(".t")).color),
    seen: [...document.querySelectorAll("x-card")].map(x => x.shadowRoot.querySelector(".t").getAttribute("data-seen")),
    frame: getComputedStyle(document.getElementById("fr").contentDocument.querySelector("p")).color,
  }));
  assert.deepEqual(await look(), { colors: ["rgb(255, 0, 0)", "rgb(255, 0, 0)"], seen: ["1", "1"], frame: "rgb(0, 128, 0)" });
  assert.deepEqual(await run("r5", `if (morse.$$("x-card >>> .t").length !== 2 || morse.$("#fr >>> p")?.textContent !== "hi") throw new Error("deep query");`), { ok: true });
  await page.evaluate(() => document.querySelectorAll("x-card").forEach(x => x.render())); // the component re-renders its shadow root
  await settle(page);
  assert.deepEqual((await look()).colors, ["rgb(255, 0, 0)", "rgb(255, 0, 0)"]);
  assert.deepEqual((await look()).seen, ["1", "1"]);
  await page.evaluate(() => morse.__off("r4"));
  assert.deepEqual((await look()).colors, ["rgb(0, 0, 0)", "rgb(0, 0, 0)"], "off removes the CSS inside too");
  // Rules written "host >>> inside" in plain morse.css go inside each host.
  await run("r6", `morse.css("body { --x: 1 } x-card >>> .t, #fr >>> p { color: rgb(0, 0, 255) }");`);
  assert.deepEqual(await look(), { colors: ["rgb(0, 0, 255)", "rgb(0, 0, 255)"], seen: ["1", "1"], frame: "rgb(0, 0, 255)" });
  await page.evaluate(() => morse.__off("r6"));
});
