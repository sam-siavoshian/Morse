// The Chrome Web Store rules and two UI-safety rules, against the real built
// extension in Chromium (needs a display: npm run test:ui runs it under Xvfb).
//
//   - Without "Allow User Scripts" (Playwright's Chromium has it off), a mod's
//     style shows, its code never runs, and Morse says which mods wait for it
//     (a notice on the page, the bar's note, the toolbar popup).
//   - A page can't draw over Morse's install review: the review is in the
//     browser's top layer, comes back on top when the page puts something of
//     its own there, and Install only works once it has been seen uncovered.
//     The page is demo/sites/hostile/?cover, on the share page's test address
//     so it can ask for an install.
import { home, tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createMod, encodeShare } from "../core/mod.js";
import { chromium, noDisplay } from "./helpers/browser.js";
import { startDemoServer, routeDemoOrigins } from "./helpers/demo-server.js";
import { waitFor, waitForStatus, settle, TIMEOUT } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";

void home;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT = path.join(root, "dist", "extension");
const skip = noDisplay;
const BYTE = "http://127.0.0.1:8788/demo/sites/byte/";
const HOSTILE = "http://127.0.0.1:8787/demo/sites/hostile/?cover";
let ctx, sw, demo, extId;

before(async () => {
  if (skip) return;
  demo = await startDemoServer();
  ctx = await chromium.launchPersistentContext(tempDir("morse-store-"), {
    headless: false, timeout: TIMEOUT * 2, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await routeDemoOrigins(ctx, demo);
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: TIMEOUT });
  extId = new URL(sw.url()).host;
  // No first-run tips in the way.
  await sw.evaluate(() => chrome.storage.local.set({ welcomed: true, "morse.onboarding": { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: false } } }));
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close().catch(() => {}); // the welcome page
});
after(async () => { await ctx?.close(); await demo?.close(); });

const stored = () => sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}));
// A page with the overlay's shadow root open (localStorage morse:debug, set
// before the first load) so the test can look inside.
async function open(url) {
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  await p.goto(url);
  await p.waitForFunction(() => document.documentElement.dataset.morseExtension === "1" && document.querySelector("[data-morse-ui]")?.shadowRoot);
  return p;
}
const noMods = () => sw.evaluate(() => chrome.storage.local.set({ mods: {} }));
const shadowText = p => p.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.textContent);

test("without “Allow User Scripts” a mod's style shows, its code never runs, and Morse says it waits", { skip }, async () => {
  assert.equal(await sw.evaluate(() => { try { return !!chrome.userScripts?.execute; } catch { return false; } }), false, "this browser has “Allow User Scripts” off");
  const mod = createMod({ title: "Word count", prompt: "count words", url: BYTE, css: "h1 { outline: 3px solid rgb(1, 2, 3) !important; }", js: "document.documentElement.dataset.wordCount = 'ran';" });
  const look = createMod({ title: "Calm colors", prompt: "calm colors", url: BYTE, css: "body { outline: 1px solid rgb(4, 5, 6) !important; }", js: "" });
  await sw.evaluate(mods => chrome.storage.local.set({ mods }), { [mod.id]: mod, [look.id]: look });
  const p = await open(BYTE);
  await p.waitForFunction(() => getComputedStyle(document.querySelector("h1")).outlineColor === "rgb(1, 2, 3)");
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).outlineColor), "rgb(4, 5, 6)");

  // The notice: which mod waits, and how to turn it on.
  await waitFor(async () => /Turn on “Allow User Scripts”/.test(await shadowText(p)), { what: "the notice" });
  const notice = await shadowText(p);
  assert.match(notice, /“Word count” adds features that wait for “Allow User Scripts”\. The new look already shows\./);
  assert.match(notice, /Open Morse's details, turn on “Allow User Scripts”, then come back to this tab\./);
  assert.doesNotMatch(notice, /Calm colors/, "a mod with no code doesn't wait for anything");
  await settle(p);
  assert.equal(await p.evaluate(() => document.documentElement.dataset.wordCount), undefined, "the code never ran, in any world");

  // One click opens Morse's details page in Chrome.
  const opened = ctx.waitForEvent("page", { timeout: TIMEOUT });
  await p.locator("[data-morse-ui] button", { hasText: "Open Morse's details" }).click();
  const details = await opened;
  await waitFor(() => details.url().startsWith("chrome://extensions"), { what: "chrome://extensions" });
  assert.equal(new URL(details.url()).searchParams.get("id"), extId);
  await details.close();

  // The toolbar popup lists it too.
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/popup.html?url=${encodeURIComponent(BYTE)}`);
  await pop.waitForFunction(() => !document.getElementById("warn").hidden && /Word count/.test(document.getElementById("warntext").textContent));
  assert.match(await pop.locator("#warntext").textContent(), /Waiting for “Allow User Scripts”: “Word count”\./);
  assert.deepEqual(await pop.locator("li small.waiting").allTextContents(), ["Waits for “Allow User Scripts”"]);
  assert.match(await pop.locator("#warn").textContent(), /reload this tab/);
  await pop.locator("#warn button", { hasText: "Turn it on" }).waitFor();
  await pop.close();
  await p.close();
  await noMods();
});

// Seen on pypi.org with the setting off: "add a back to top button" became an
// arrow that doesn't scroll, and nothing said why. Now the code never runs at
// all, and the bar says the change needs "Allow User Scripts", with the click
// that opens it. (The playground: the real runtime and engine with the demo
// model, and a host that answers like the extension with the setting off.)
test("a change that needs code says so in the bar, with one click to turn on “Allow User Scripts”", { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    const errors = [];
    p.on("pageerror", e => errors.push(e.message));
    await p.addInitScript(() => localStorage.setItem("morse:debug", "1"));
    await p.goto(`${demo.origin("parley")}/demo/playground.html?model=demo&scriptsoff&light`);
    await waitForStatus(p, s => s.ready, { what: "the runtime ready" });
    await pressOpen(p);
    await waitForStatus(p, s => s.open, { what: "the bar open" });
    await p.keyboard.type("add a back to top button");
    await p.keyboard.press("Enter");
    const s = await waitForStatus(p, s => s.phase === "result", { what: "the result" });
    assert.match(s.hint, /Back to top button.*Needs “Allow User Scripts” to work\. Only its look shows until you turn it on/);
    const sr = sel => p.locator("[data-morse-ui]").locator(sel);
    assert.equal((await sr(".actions [data-ob=userscripts]").textContent()).trim(), "Turn on “Allow User Scripts”");
    assert.equal(await p.locator(".morse-top").count(), 0, "the code didn't run");
    assert.match(await p.evaluate(() => [...document.querySelectorAll("style[data-morse-css]")].map(s => s.textContent).join("")), /\.morse-top/, "its look is on the page");
    await sr(".actions [data-ob=userscripts]").click();
    await waitFor(() => p.evaluate(() => window.__fake.opened === "userscripts"), { what: "Morse's details opened" });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("the practice page loads under its stricter sandbox rules (no eval there either)", { skip }, async () => {
  const p = await ctx.newPage();
  const refused = [];
  p.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) refused.push(m.text()); });
  await p.goto(`chrome-extension://${extId}/welcome.html`);
  const frame = await waitFor(() => p.frames().find(f => f.url().endsWith("/practice.html")), { what: "the practice frame" });
  await frame.waitForFunction(() => !!document.querySelector("[data-morse-ui]") && !!globalThis.__morseHost);
  assert.deepEqual(refused, [], "nothing Morse loads there is refused");
  // Chrome's default sandbox rules allow inline code and eval; Morse's allow only its own files.
  // (The test's own evaluate is exempt from page rules, so it adds a script the way a page would.)
  assert.equal(await frame.evaluate(async () => {
    const blocked = new Promise(r => document.addEventListener("securitypolicyviolation", e => r(e.violatedDirective), { once: true }));
    const s = document.createElement("script");
    s.textContent = "window.__inline = 1";
    document.body.append(s);
    return window.__inline ? "ran" : await Promise.race([blocked, new Promise(r => setTimeout(() => r("no report"), 2000))]);
  }), "script-src-elem", "inline code is refused in the practice page");
  await p.close();
});

// ---- the review on top

const cover = (p, how, opts = {}) => p.evaluate(([how, opts]) => { window.cover(how, opts); }, [how, opts]);
const uncover = p => p.evaluate(() => window.uncover());
const INSTALL = "[data-morse-ui] .modal [data-a=install]";
// What is drawn at the middle of Install: Morse's button, or the page's green
// cover. Hit testing can't tell (the page is inert under the modal review, so
// elementFromPoint skips its covers), so this reads the pixels of a screenshot.
let pixels;
async function topAtInstall(p) {
  const box = await p.locator(INSTALL).boundingBox();
  if (!box) return "no review";
  const png = await p.screenshot({ clip: { x: Math.round(box.x + box.width / 2) - 2, y: Math.round(box.y + box.height / 2) - 2, width: 4, height: 4 } });
  pixels ||= await ctx.newPage();
  const [r, g, b] = await pixels.evaluate(async src => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    return [...x.getImageData(1, 1, 1, 1).data];
  }, `data:image/png;base64,${png.toString("base64")}`);
  return g > 150 && r < 90 && b < 90 ? "cover" : "morse"; // the cover is rgba(0, 200, 0, .92)
}
const installEnabled = p => p.evaluate(() => !document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".modal [data-a=install]")?.disabled);
async function askToInstall(p, mod) {
  await p.evaluate(l => window.ask(l), await encodeShare(mod));
  await p.locator(INSTALL).waitFor();
}

test("a page can't draw over the install review, and Install waits until the review has been seen", { skip }, async () => {
  const mod = createMod({ title: "Prize", prompt: "make headings red", url: "http://127.0.0.1:8787/", css: "h1{color:red}", js: "" });
  await noMods(); // whatever an earlier test left
  const p = await open(HOSTILE);
  await p.waitForFunction(() => typeof window.cover === "function");
  await askToInstall(p, mod);
  assert.equal(await p.evaluate(() => document.querySelector("[data-morse-ui]").matches(":popover-open")), true, "the overlay is in the top layer");
  assert.equal(await p.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".modal").matches(":modal")), true, "the review is a modal dialog");

  // The highest z-index the page has can't reach the top layer.
  await cover(p, "z");
  assert.equal(await topAtInstall(p), "morse", "z-index cover");
  await uncover(p);

  // The page's own top layer: a popover, a popover in a closed shadow root, a
  // modal dialog. Each time, the review comes back on top and Install waits again.
  for (const how of ["popover", "shadow", "dialog"]) {
    await waitFor(() => installEnabled(p), { what: `Install on before the ${how} cover` });
    await cover(p, how);
    await waitFor(async () => (await topAtInstall(p)) === "morse", { what: `the review back on top of a ${how}` });
    await uncover(p);
  }
  // Install was off right after a cover went up.
  await waitFor(() => installEnabled(p), { what: "Install on" });
  assert.equal(await p.evaluate(async () => {
    window.cover("popover");
    await new Promise(r => setTimeout(r, 80));
    return document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".modal [data-a=install]").disabled;
  }), true, "Install waits again after the page covers the review");
  await uncover(p);

  // A see-through cover that lets the click fall through to Install: the
  // click lands while Install waits, so nothing is installed.
  await waitFor(() => installEnabled(p), { what: "Install on" });
  const box = await p.locator(INSTALL).boundingBox();
  await cover(p, "popover", { through: true });
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(p);
  assert.deepEqual(await stored(), [], "a click through a cover installs nothing");
  await uncover(p);

  // A page that keeps covering it gets the review closed; nothing installed.
  await cover(p, "popover", { again: true });
  await waitFor(() => p.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".modal").hidden), { what: "the review closed" });
  assert.match(await shadowText(p), /kept covering Morse's review/);
  await uncover(p);
  assert.deepEqual(await stored(), []);

  // Uncovered, a real click on Install works.
  await askToInstall(p, mod);
  await waitFor(() => installEnabled(p), { what: "Install on" });
  const b = await p.locator(INSTALL).boundingBox();
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  assert.deepEqual(await waitFor(async () => { const ids = await stored(); return ids.length && ids; }, { what: "the mod in storage" }), [mod.id]);
  await p.close();
  await noMods();
});
