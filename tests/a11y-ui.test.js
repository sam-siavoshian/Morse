// Easier to use, end to end in real Chromium: the real runtime on the
// Riverside Library demo site (demo/sites/a11y), which has deliberate
// accessibility problems, with a stand-in host (demo/a11y-host.js) running the
// real engine against the demo model. Every page tool turns on, does its job
// and turns off leaving the page exactly as it was; Read aloud reads sentence
// by sentence (speech is recorded, not spoken); Check this page finds the
// planted problems and fixes them; Describe this picture saves alt text.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openLibrary } from "../demo/a11y-page.js";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { pressOpen } from "./helpers/keys.js";
import { TIMEOUT, waitForReady } from "./helpers/wait.js";

const skip = noBrowser;
let browser;
before(async () => { if (!skip) browser = await launchBrowser(); });
after(() => browser?.close());

async function scenario(fn, opts) {
  const t = await openLibrary(browser, opts);
  try { await fn(t); assert.deepEqual(t.errors, []); }
  finally { await t.ctx.close(); }
}
async function until(fn, ms = TIMEOUT) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { if (Date.now() > end) throw e; }
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + fn);
    await new Promise(r => setTimeout(r, 40));
  }
}
const status = page => page.evaluate(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status));
const mods = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:a11y-host:mods") || "{}")));
const css = (page, sel, prop, pseudo) => page.evaluate(([s, p, ps]) => getComputedStyle(document.querySelector(s), ps || null)[p], [sel, prop, pseudo]);
const box = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
// Everything a page tool could leave behind: the page's markup, Morse's styles
// in <head>, and elements a mod added to <html>.
const snapshot = page => page.evaluate(() => ({
  body: document.body.outerHTML,
  head: [...document.head.children].map(n => n.outerHTML).join("\n"),
  html: [...document.documentElement.children].filter(n => !n.hasAttribute("data-morse-ui")).length,
}));

async function openTools(page) {
  if (await page.locator(".bar").isHidden()) await pressOpen(page);
  await page.locator(".gm-qbtn").click();
  await page.locator(".gm-menu [data-a11y=more]").click(); // the group opens from its one item (docs/dev/simplify.md)
  await page.locator(".gm-menu .a11y-group").waitFor();
}
async function tool(page, k) {
  const before = (await mods(page)).length;
  await openTools(page);
  const on = await page.locator(`.gm-menu [data-a11y="${k}"]`).getAttribute("aria-checked") === "true";
  await page.locator(`.gm-menu [data-a11y="${k}"]`).click();
  await until(async () => (await mods(page)).length === before + (on ? -1 : 1));
  await page.keyboard.press("Escape");
  await until(async () => !(await status(page)).open);
}
const ratio = (page, sel) => page.evaluate(s => {
  const p = c => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const L = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const el = document.querySelector(s);
  let bg = "rgb(255, 255, 255)";
  for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) { bg = c; break; } }
  const a = L(p(getComputedStyle(el).color)), b = L(p(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}, sel);

test("Easier to use: the group opens beside the page tools from its one item, with every tool, Read aloud and Check this page", { skip }, () => scenario(async ({ page }) => {
  await openTools(page);
  const items = await page.locator(".gm-menu .a11y-group button").allInnerTexts();
  assert.deepEqual(items.map(s => s.trim()), ["Higher contrast", "Bigger click targets", "Easier to read font", "Dyslexia-friendly letters", "Underline links",
    "Stop animations", "Focus outline everywhere", "Reading ruler", "Hide distractions", "Read aloud", "Check this page"]);
  // Arrow keys walk the whole menu, both panels.
  const names = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press("ArrowDown"); names.push(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.innerText.trim())); }
  assert.ok(names.includes("Bigger click targets") && names.includes("Bigger text"), names.join("|"));
  // The two panels don't overlap.
  const a = await page.locator(".gm-menu .a11y-group").boundingBox(), m = await page.locator(".gm-menu").boundingBox();
  assert.ok(a.x + a.width <= m.x, JSON.stringify({ a, m }));
}));

test("Easier to use: each page tool turns on, does its job, and turns off leaving the page exactly as it was", { skip }, () => scenario(async ({ page }) => {
  await until(() => page.evaluate(() => !document.querySelector("video").paused));
  const checks = {
    async contrast() {
      assert.ok(await ratio(page, ".meta") >= 7, "meta line");
      assert.ok(await ratio(page, "footer > div") >= 7, "footer");
      assert.ok(await ratio(page, "article p:not(.light)") >= 7, "body text");
      assert.notEqual(await css(page, ".signup input", "borderTopColor"), "rgb(236, 236, 236)");
    },
    async targets() {
      // The mod is listed before its code has resized the page. Wait for it.
      await until(async () => (await box(page, ".announce-close")).w >= 44);
      for (const s of [".announce-close", ".icon-search", 'a[href="account.html"]', ".heart", 'footer a[href*="facebook"]']) {
        const b = await box(page, s);
        assert.ok(b.w >= 44 && b.h >= 44, `${s} ${JSON.stringify(b)}`);
      }
      assert.ok((await box(page, 'a[href="#rules"]')).h < 30, "a link inside a sentence stays as it is");
      assert.equal(await css(page, 'input[type=email]', "minHeight"), "44px");
    },
    async readable() {
      assert.match(await css(page, "article p", "fontFamily"), /system-ui/);
      assert.match(await css(page, "h1", "fontFamily"), /system-ui/);
      assert.ok(parseFloat(await css(page, "article p:not(.meta)", "lineHeight")) >= 15 * 1.6 - 0.5);
      assert.notEqual(await css(page, "article p:not(.meta)", "letterSpacing"), "normal");
      assert.ok(parseFloat(await css(page, "article p", "maxWidth")) > 300, "lines stop at about 70 characters");
      assert.equal(await css(page, "article p:not(.meta)", "textAlign"), "start");
    },
    async underline() {
      assert.match(await css(page, 'a[href="#rules"]', "textDecorationLine"), /underline/);
      assert.match(await css(page, "header nav a", "textDecorationLine"), /underline/);
    },
    async still() {
      assert.equal(await page.evaluate(() => document.querySelector("video").paused), true);
      // A video started from a script is stopped too; one you start yourself plays.
      await page.evaluate(() => document.querySelector("video").play());
      await until(() => page.evaluate(() => document.querySelector("video").paused));
      assert.equal(await css(page, ".live", "animationDuration", "::before"), "0.001s");
      assert.equal(await css(page, ".ticker span", "animationIterationCount"), "1");
      assert.match(await page.evaluate(() => document.querySelector('img[src*="spinner"], img[data-morse-still]').getAttribute("src")), /^data:image\/png/);
    },
    async outline() {
      await page.evaluate(() => document.querySelector(".icon-search").focus({ focusVisible: true }));
      assert.equal(await css(page, ".icon-search", "outlineWidth"), "3px");
      assert.equal(await css(page, ".icon-search", "outlineStyle"), "solid");
      await page.evaluate(() => document.activeElement.blur());
    },
    async ruler() {
      await page.mouse.move(400, 300);
      await page.mouse.move(400, 420, { steps: 3 });
      const r = await page.evaluate(() => [...document.querySelectorAll(".morse-ruler")].map(e => e.getBoundingClientRect()).map(r => ({ top: r.top, bottom: r.bottom })));
      assert.equal(r.length, 2);
      assert.ok(r[0].bottom < 420 && r[0].bottom > 360 && r[1].top > 420 && r[1].top < 480, JSON.stringify(r));
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".morse-ruler")).pointerEvents), "none");
    },
    async calm() {
      for (const s of ["#cookie-notice", ".chat-launcher", ".announce-bar", ".ticker"]) assert.equal(await css(page, s, "display"), "none", s);
      assert.notEqual(await css(page, ".live", "display"), "none", "the pulsing LIVE badge is not a ticker");
      for (const s of ["header", "header nav", "main"]) assert.notEqual(await css(page, s, "display"), "none", s);
    },
  };
  for (const [k, check] of Object.entries(checks)) {
    const was = await snapshot(page);
    await tool(page, k);
    await check();
    await tool(page, k);
    await until(() => page.evaluate(() => !document.querySelector("video").paused)); // what was playing plays again
    assert.deepEqual(await snapshot(page), was, `${k} left something behind`);
  }
  // Dyslexia-friendly letters: the same tool, another font, no justified text.
  const was = await snapshot(page);
  await openTools(page);
  await page.locator('.gm-menu [data-a11y="dyslexia"]').click();
  await until(async () => /OpenDyslexic/.test(await css(page, "article p", "fontFamily")));
  assert.equal(await css(page, "article p", "textAlign"), "start");
  await openTools(page);
  assert.equal(await page.locator('.gm-menu [data-a11y="readable"]').getAttribute("aria-checked"), "true");
  assert.equal(await page.locator('.gm-menu [data-a11y="dyslexia"]').getAttribute("aria-checked"), "true");
  await page.locator('.gm-menu [data-a11y="readable"]').click();
  await until(async () => (await mods(page)).length === 0);
  assert.deepEqual(await snapshot(page), was);
}));

test("Hide distractions: a scrolling ticker goes, whatever moves it; other loops and the site's own parts stay", { skip }, () => scenario(async ({ page }) => {
  await page.evaluate(() => {
    const add = html => { const d = document.createElement("div"); d.innerHTML = html; document.querySelector("main").prepend(d.firstElementChild); };
    // a ticker moved by a script animation, a <marquee>, a spinner and a slideshow (tall: not a ticker)
    add(`<div id="js-ticker" style="overflow:hidden;white-space:nowrap;width:640px;height:28px"><span style="display:inline-block">Breaking: the library opens late on Monday</span></div>`);
    add(`<marquee id="mq" style="width:640px;height:24px">Free museum passes with your card</marquee>`);
    add(`<div id="spin" style="width:32px;height:32px;border:3px solid #999;border-top-color:transparent;border-radius:50%"></div>`);
    add(`<div id="slides" style="overflow:hidden;width:640px;height:240px"><div style="width:1920px;height:240px;background:linear-gradient(90deg,#246,#8ab)"></div></div>`);
    const loop = { duration: 8000, iterations: Infinity };
    document.querySelector("#js-ticker span").animate([{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }], loop);
    document.querySelector("#spin").animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], loop);
    document.querySelector("#slides > div").animate([{ transform: "translateX(0)" }, { transform: "translateX(-66%)" }], loop);
  });
  const was = await snapshot(page);
  await tool(page, "calm");
  await until(async () => await css(page, "#js-ticker", "display") === "none");
  for (const s of [".ticker", "#js-ticker", "#mq"]) assert.equal(await css(page, s, "display"), "none", s);
  for (const s of ["#spin", "#slides", "header", "header nav"]) assert.notEqual(await css(page, s, "display"), "none", s);
  await tool(page, "calm");
  assert.deepEqual(await snapshot(page), was, "Hide distractions left something behind");
}));

test("Easier to use: tools are saved for this site and come back after a reload", { skip }, () => scenario(async ({ page }) => {
  await tool(page, "contrast");
  await tool(page, "underline");
  const saved = await mods(page);
  assert.deepEqual(saved.map(m => m.title).sort(), ["Higher contrast", "Underline links"]);
  assert.ok(saved.every(m => m.kind === "quick" && m.match.hosts[0] === "library.morse.test" && m.css.includes("no model involved")));
  await page.reload();
  await waitForReady(page);
  await until(async () => await ratio(page, ".meta") >= 7);
  assert.match(await css(page, 'a[href="#rules"]', "textDecorationLine"), /underline/);
  await openTools(page);
  assert.equal(await page.locator('.gm-menu [data-a11y="contrast"]').getAttribute("aria-checked"), "true");
  assert.equal(await page.locator('.gm-menu [data-a11y="targets"]').getAttribute("aria-checked"), "false");
}));

test("Read aloud: reads the selection a sentence at a time, marks it, pauses, changes speed and stops", { skip }, () => scenario(async ({ page }) => {
  // Select the second paragraph, then open the page tools.
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelectorAll("article p")[2]); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await openTools(page);
  assert.equal((await page.locator('.gm-menu [data-a11y="read"] span').allInnerTexts()).join(" ").trim(), "Read aloud selection");
  await page.locator('.gm-menu [data-a11y="read"]').click();
  await page.locator(".ra").waitFor();
  assert.equal((await status(page)).open, false, "the bar steps aside");
  const speech = () => page.evaluate(() => ({ current: window.__speech.current, spoken: window.__speech.spoken.map(s => s.text), rate: window.__speech.spoken.at(-1)?.rate }));
  assert.equal((await speech()).current, "Each book you finish earns a stamp in your reading passport.");
  assert.match(await page.locator(".ra-text").innerText(), /Reading aloud\s+Sentence 1 of 5/);
  // The sentence being read is marked on the page, over the paragraph's first line.
  const p = await page.locator("article p").nth(2).boundingBox();
  const mark = await page.locator(".ra-layer i").first().boundingBox();
  assert.ok(Math.abs(mark.y - p.y) < 6 && mark.x <= p.x + 2 && mark.width > 200, JSON.stringify({ mark, p }));
  // Finishing a sentence moves on.
  await page.evaluate(() => window.__speech.finish());
  await until(async () => (await speech()).current === "Ten stamps get you a free book to keep, chosen from our summer shelf.");
  // Pause and play: the same sentence starts again.
  await page.locator(".ra [data-ra=play]").click();
  assert.equal((await speech()).current, null);
  assert.match(await page.locator(".ra-text").innerText(), /Paused/);
  await page.locator(".ra [data-ra=play]").click();
  assert.equal((await speech()).current, "Ten stamps get you a free book to keep, chosen from our summer shelf.");
  // Speed: the sentence restarts at the new rate.
  await page.locator(".ra [data-ra=rate]").click();
  assert.equal((await speech()).rate, 1.25);
  assert.equal(await page.locator(".ra [data-ra=rate]").innerText(), "1.25×");
  // Next and previous.
  await page.locator(".ra [data-ra=next]").click();
  assert.match((await speech()).current, /^Twenty stamps/);
  await page.locator(".ra [data-ra=prev]").click();
  assert.match((await speech()).current, /^Ten stamps/);
  // Esc stops, and nothing keeps talking.
  await page.keyboard.press("Escape");
  await until(async () => (await page.locator(".ra").isHidden()) && (await speech()).current === null);
  assert.equal(await page.locator(".ra-layer i").count(), 0);
}));

test("Read aloud: point at text and use the edit toolbar; with nothing chosen it reads the article", { skip }, () => scenario(async ({ page }) => {
  await page.evaluate(() => document.querySelector(".light").scrollIntoView({ block: "center" }));
  await pressOpen(page);
  const r = await page.locator(".light").boundingBox();
  await page.mouse.move(r.x + 40, r.y + 8);
  await page.mouse.click(r.x + 40, r.y + 8);
  await page.locator(".gm-tb [data-a11y-tb=read]").waitFor();
  assert.equal(await page.locator(".gm-tb [data-a11y-tb=describe]").isHidden(), true, "no picture here");
  await page.locator(".gm-tb [data-a11y-tb=read]").click();
  await until(() => page.evaluate(() => window.__speech.current?.startsWith("Last summer more than four thousand readers")));
  assert.match(await page.locator(".ra-text").innerText(), /Sentence 1 of 2/);
  await page.locator(".ra [data-ra=stop]").click();
  // Nothing selected or pointed at: the article, from its headline.
  await openTools(page);
  await page.locator('.gm-menu [data-a11y="read"]').click();
  await until(() => page.evaluate(() => window.__speech.current === "Summer reading starts June 3"));
  await page.evaluate(() => window.__speech.finish());
  await until(() => page.evaluate(() => /^Posted May 20/.test(window.__speech.current || "")));
}));

const groups = page => page.locator(".au-item").evaluateAll(items => items.map(li => ({
  title: li.querySelector("b").textContent, fix: li.querySelector(".au-act").innerText.replace(/\s+/g, " ").trim(), marks: li.querySelectorAll(".ask-n").length,
})));

test("Check this page: finds every planted problem, marks each place once, and lists them in plain words", { skip }, () => scenario(async ({ page }) => {
  await openTools(page);
  await page.locator('.gm-menu [data-a11y="check"]').click();
  await page.locator(".au-list").waitFor();
  assert.deepEqual(await groups(page), [
    { title: "7 buttons and links have no name", fix: "Fix it 6 now · 1 by the model", marks: 7 },
    { title: "3 pictures have no description", fix: "Fix it 1 now · describe 2", marks: 3 },
    { title: "3 form fields have no label", fix: "Fix it 2 now · 1 by the model", marks: 3 },
    { title: "3 pieces of text are hard to read", fix: "Fix it 3 now", marks: 3 },
    { title: "7 things are too small to click", fix: "Fix it 7 now", marks: 7 },
    { title: "1 video or sound plays by itself", fix: "Fix it 1 now", marks: 1 },
  ]);
  assert.match(await page.locator(".au-sum").innerText(), /6 kinds of problem · 17 places/);
  // One badge per place on the page, even where two problems meet.
  assert.equal(await page.locator(".mk-badge").count(), 17);
  // The badge for the search button sits on it.
  const label = await page.locator(".au-marks .ask-n").nth(1).getAttribute("aria-label");
  assert.match(label, /^2: button \(maybe “Search”\)/);
  await page.locator(".au-marks .ask-n").nth(1).click();
  await until(() => page.locator(".mk-ring.ping").count());
  assert.match((await status(page)).hint, /Checked · 17 places to fix/);
  // Nothing was changed by looking.
  assert.deepEqual(await mods(page), []);
}));

test("Check this page: Fix it saves what Morse can work out and asks the model, precisely, for the rest", { skip }, () => scenario(async ({ page }) => {
  const check = async () => { await openTools(page); await page.locator('.gm-menu [data-a11y="check"]').click(); await page.locator(".au").waitFor(); };
  const fix = title => page.locator(".au-item", { hasText: title }).locator(".au-fix").click();
  await check();
  // Contrast, size and autoplay: all done at once, no model.
  await fix("hard to read");
  await until(async () => !(await page.locator(".au-item", { hasText: "hard to read" }).count()));
  for (const s of [".meta", ".light", "footer > div"]) assert.ok(await ratio(page, s) >= 4.5, s);
  await fix("too small to click");
  await until(async () => !(await page.locator(".au-item", { hasText: "too small" }).count()));
  for (const s of [".announce-close", ".icon-search", ".heart"]) { const b = await box(page, s); assert.ok(b.w >= 44 && b.h >= 44, s); }
  await fix("plays by itself");
  await until(() => page.evaluate(() => document.querySelector("video").paused && !document.querySelector("video").hasAttribute("autoplay")));
  // Pictures: the decorative one is marked as decoration, the others are described one at a time.
  await fix("no description");
  await until(() => page.evaluate(() => document.querySelector(".more img").getAttribute("alt") === ""));
  await page.locator(".ds .ds-text:not(.busy)").waitFor();
  assert.match(await page.locator(".ds-text").innerText(), /bar chart of library visitors/);
  await page.locator(".ds [data-ds=close]").click();
  // Names: six from tooltips, icons, symbols and link addresses; one for the model.
  await check();
  const n = (await page.evaluate(() => window.__fake.requests.length));
  await fix("no name");
  await until(async () => (await page.evaluate(() => window.__fake.requests.length)) > n);
  const named = await page.evaluate(() => [".announce-close", ".icon-search", 'a[href="account.html"]', ".heart", 'a[href*="facebook"]', 'a[href*="instagram"]', "#m7"]
    .map(s => document.querySelector(s).getAttribute("aria-label")));
  assert.deepEqual(named, ["Close", "Search", "Account", "Like", "Facebook", "Instagram", null]);
  const req = await page.evaluate(() => window.__fake.requests.at(-1).request);
  assert.equal(req, "Give this icon button or link an accessible name (aria-label) that says what it does, based on its icon, tooltip and what's around it: `#m7`. Change nothing else.");
  await until(async () => (await status(page)).phase === "result");
  assert.equal(await page.evaluate(() => document.querySelector("#m7").getAttribute("aria-label")), "Menu"); // the demo model's answer
  await page.keyboard.press("Escape"); // keeps the model's change, like any change
  await page.locator(".bar").waitFor({ state: "hidden" });
  // Labels: the placeholder and the text beside it; the list goes to the model.
  await check();
  await fix("no label");
  await until(() => page.evaluate(() => window.__fake.requests.at(-1).request.includes("form field")));
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".signup input")].map(i => i.getAttribute("aria-label"))), ["Email address", "Your name"]);
  assert.match(await page.evaluate(() => window.__fake.requests.at(-1).request), /^Give this form field a label that screen readers can read \(aria-label\), based on the text and layout around it: `body > div.page > aside > form.box.signup > select`\. Change nothing else\.$/);
  await until(async () => (await status(page)).phase === "result");
  assert.equal(await page.evaluate(() => document.querySelector(".signup select").getAttribute("aria-label")), "Branch");
  await page.keyboard.press("Escape");
  await page.locator(".bar").waitFor({ state: "hidden" });
  // Every fix lives in one mod, and turning it off in Mods undoes all of them.
  const fixes = (await mods(page)).find(m => m.title === "Accessibility fixes");
  assert.equal(fixes.edits[0].fixes.length, 3 + 7 + 1 + 1 + 6 + 2);
  await page.keyboard.press("Alt+Shift+KeyM");
  await page.locator(".panel article", { hasText: "Accessibility fixes" }).locator(".sw").click();
  await until(() => page.evaluate(() => document.querySelector(".icon-search").getAttribute("aria-label") === null));
  assert.ok(await ratio(page, ".meta") < 3);
  assert.equal(await page.evaluate(() => document.querySelector("video").hasAttribute("autoplay")), true);
  assert.equal(await page.evaluate(() => document.querySelector(".more img").hasAttribute("alt")), false);
}));

test("Describe this picture: point at it, read the description, save it as alt text", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  const r = await page.locator('img[src="chart.png"]').boundingBox();
  await page.mouse.move(r.x + 200, r.y + 150);
  await page.mouse.click(r.x + 200, r.y + 150);
  await page.locator(".gm-tb [data-a11y-tb=describe]").waitFor();
  await page.locator(".gm-tb [data-a11y-tb=describe]").click();
  await page.locator(".ds [data-ds=save]").waitFor();
  const text = await page.locator(".ds-text").innerText();
  assert.equal(text, "A bar chart of library visitors from January to June. Visits grow every month, from about 1,200 in January to about 3,400 in June.");
  assert.match(await page.locator(".ds-foot small").innerText(), /no alt text now/);
  // The model got the picture itself, and nothing that would make it write code.
  const sent = await page.evaluate(() => { const c = window.__fake.requests.at(-1).context; return { type: c.a11y.image.mediaType, size: c.a11y.image.data.length, near: c.a11y.image.near, keys: Object.keys(c).sort() }; });
  assert.equal(sent.type, "image/jpeg");
  assert.ok(sent.size > 20000, sent.size);
  assert.equal(sent.near, "Visitors by month at Riverside Library this year.");
  assert.deepEqual(sent.keys, ["a11y", "app", "title", "url"]);
  await page.locator(".ds [data-ds=save]").click();
  await until(() => page.evaluate(t => document.querySelector('img[src="chart.png"]').alt === t, text));
  await page.locator(".ds").waitFor({ state: "hidden" }); // the card closes once the save is answered
  assert.deepEqual((await mods(page)).map(m => [m.title, m.edits[0].fixes.length]), [["Accessibility fixes", 1]]);
  // Still there after a reload.
  await page.reload();
  await waitForReady(page);
  await until(() => page.evaluate(t => document.querySelector('img[src="chart.png"]').alt === t, text));
}));

test("Describe this picture: a video frame comes from a screenshot cropped to it", { skip }, () => scenario(async ({ page }) => {
  await pressOpen(page);
  const r = await page.locator("video").boundingBox();
  await page.mouse.move(r.x + 60, r.y + 40);
  await page.mouse.click(r.x + 60, r.y + 40);
  await page.locator(".gm-tb [data-a11y-tb=describe]").click();
  await page.locator(".ds [data-ds=save]").waitFor();
  const size = await page.evaluate(async () => {
    const im = new Image();
    im.src = "data:image/jpeg;base64," + window.__fake.requests.at(-1).context.a11y.image.data;
    await im.decode();
    return { w: im.naturalWidth, h: im.naturalHeight };
  });
  const v = await page.locator("video").boundingBox();
  assert.ok(Math.abs(size.w - v.width) <= 2 && Math.abs(size.h - v.height) <= 2, JSON.stringify({ size, v }));
  // Not an <img>: saved as its name.
  await page.locator(".ds [data-ds=save]").click();
  await until(() => page.evaluate(() => !!document.querySelector("video").getAttribute("aria-label")));
}, { shots: true }));
