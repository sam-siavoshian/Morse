// Your style, everywhere, in real Chromium on three demo sites at once (The
// Daily Byte, Tunes and the Riverside Library, each on its own address), with
// the real desktop connector, ~/.morse/style.json and the demo model
// (demo/style-world.js): made once from the bar, it is on every site at boot;
// "not on this site" from the bar, the Mods panel and Settings; the off
// switch, pause and the panel's switch; it persists; calm blocks stop the
// autoplaying video and the moving ticker; self-heal never flags it; and the
// opt-in fit for one site, reviewed in the bar and saved as part of the style.
import { home } from "./helpers/home.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { axeCheck, axeLines } from "../demo/axe.js"; // axe-core on Morse's own UI (tests/a11y-morse.test.js)
import { pressOpen, HOTKEYS } from "./helpers/keys.js";
import { waitFor, waitForStatus, readStatus, settle, TIMEOUT } from "./helpers/wait.js";
import { openStyleWorld } from "../demo/style-world.js";

const skip = noBrowser;
let world;
const pages = new Set();
before(async () => { if (!skip) world = await openStyleWorld({ launch: args => launchBrowser({ args }) }); });
after(() => world?.close());
afterEach(async () => {
  for (const p of pages) await p.close().catch(() => {});
  pages.clear();
  const { Style } = await import("../daemon/style.js");
  await Style.handle({ type: "style.save", reset: true }, { url: "http://byte.test/", app: null });
  for (const f of await fs.readdir(path.join(home, "mods"))) await fs.rm(path.join(home, "mods", f), { force: true });
});

async function open(name, p) { const page = await world.open(name, p); pages.add(page); return page; }
const STYLE_FILE = path.join(home, "style.json");
const stored = async () => (existsSync(STYLE_FILE) ? JSON.parse(await fs.readFile(STYLE_FILE, "utf8")) : null);
const status = (page, pred, what) => waitForStatus(page, pred, { what });
const zoom = page => page.evaluate(() => getComputedStyle(document.body).zoom);
const underline = page => page.evaluate(() => getComputedStyle(document.querySelector("a[href]")).textDecorationLine);
const styled = async page => (await zoom(page)) === "1.21" && (await underline(page)) === "underline";
const plain = async page => (await zoom(page)) === "1" && (await page.locator('style[data-morse-css="morse-style"]').count()) === 0;
const until = (fn, what) => waitFor(fn, { what, timeout: TIMEOUT });
const shadowText = (page, sel) => page.evaluate(s => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(s)?.textContent || "", sel);

async function say(page, words) {
  if (!(await readStatus(page)).open) await pressOpen(page);
  await status(page, s => s.open && s.phase === "idle", "the bar");
  await page.keyboard.type(words);
  await page.keyboard.press("Enter");
}
async function makeStyle(page, words) {
  await say(page, words);
  await status(page, s => s.phase === "style" && s.pane === "ys", "the style to show for review");
  await page.keyboard.press("Enter");
  await status(page, s => !s.open && s.phase === "idle", "the bar to close after Save");
  await until(async () => (await stored())?.words, "style.json");
}
async function openPanel(page) {
  await page.keyboard.press(HOTKEYS.mods);
  await page.locator(".panel .ys-row").waitFor();
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: Your style in the Mods panel");
}

test("made once from the bar, shown for review, then on every site at boot with no model and no bar", { skip }, async () => {
  const byte = await open("byte");
  assert.equal(await zoom(byte), "1");
  await say(byte, "bigger text and underline links everywhere");
  await status(byte, s => s.phase === "style" && s.pane === "ys", "the review");
  // Shown live before it's saved, with what it does in plain words.
  await until(() => styled(byte), "the style on the page while it's reviewed");
  assert.deepEqual(await byte.locator(".ys-sheet .ys-tags span").allInnerTexts(), ["Text 121%", "Underlined links"]);
  assert.match(await shadowText(byte, ".actions"), /Save.*Undo/);
  assert.equal(await stored(), null, "nothing saved yet");
  await byte.keyboard.press("Enter");
  await status(byte, s => !s.open, "the bar to close");
  // Browsers open with Morse the way apps do, so a style reaches both.
  await until(async () => /Saved your style\. It follows you to every site and app\./.test(await shadowText(byte, ".toast")), "the Saved toast");
  const s = await until(stored, "style.json");
  assert.deepEqual([s.blocks.size, s.blocks.underline, s.words], [2, true, "bigger text and underline links everywhere"]);

  // Other sites have it from the first paint of Morse, without opening anything.
  for (const name of ["tunes", "library"]) {
    const page = await open(name);
    await until(() => styled(page), `the style on ${name}`);
    const first = await page.evaluate(() => document.querySelector("style[data-morse-css]")?.dataset.morseCss);
    assert.equal(first, "morse-style", "the style comes before the site's own mods");
    assert.deepEqual(page.errors, []);
  }
  // Undo leaves the saved style as it was.
  await say(byte, "softer colors everywhere");
  await status(byte, s => s.phase === "style" && s.pane === "ys", "the second review");
  await until(async () => /saturate/.test(await byte.evaluate(() => getComputedStyle(document.documentElement).filter)), "softer colors shown");
  await byte.locator('.actions [data-a="ys-undo"]').click();
  await until(async () => (await byte.evaluate(() => getComputedStyle(document.documentElement).filter)) === "none", "softer colors gone");
  assert.ok(await styled(byte), "the saved style stays");
  assert.equal((await stored()).blocks.soft, false);
  assert.deepEqual(byte.errors, []);
});

test("exceptions: “not on this site” from the bar, the Mods panel and Settings; “except” in the words", { skip }, async () => {
  const byte = await open("byte");
  await makeStyle(byte, "bigger text and underline links on every site except library");
  const tunes = await open("tunes");
  await until(() => styled(tunes), "the style on Tunes");
  const library = await open("library");
  await until(() => plain(library), "the Library left out by the words");
  assert.deepEqual((await stored()).except, ["library"]);

  // The bar.
  await say(tunes, "not on this site");
  await until(() => plain(tunes), "the style off on Tunes");
  await until(async () => /Your style is off on tunes\.test/.test(await shadowText(tunes, ".ctl-toast")), "the toast on Tunes");
  assert.deepEqual((await stored()).except, ["library", "tunes.test"]);
  assert.ok(await styled(byte), "still on The Daily Byte");

  // The Mods panel: it says so, and brings it back.
  await openPanel(tunes);
  assert.match(await tunes.locator(".ys-row").innerText(), /Off on tunes\.test/);
  await tunes.locator('.ys-row [data-y="use-here"]').click();
  await until(() => styled(tunes), "the style back on Tunes");
  assert.deepEqual((await stored()).except, ["library"]);
  await tunes.locator('.ys-row [data-y="not-here"]').click();
  await until(() => plain(tunes), "off again from the panel");

  // Settings lists them; × brings a site back.
  await tunes.locator('.ys-row [data-y="change"]').click();
  await tunes.locator(".pane [data-ys-sec]").waitFor();
  assert.deepEqual(await tunes.locator(".ys-chip").allInnerTexts().then(a => a.map(t => t.replace("×", "").trim())), ["library", "tunes.test"]);
  await tunes.locator('[data-ys="rm:library"]').click();
  await until(() => styled(library), "the Library gets the style when it comes off the list");
  await tunes.locator('[data-ys="add-except"]').fill("byte.test");
  await tunes.locator('[data-ys="add-except"]').press("Enter");
  await until(() => plain(byte), "The Daily Byte left out from Settings");
  assert.deepEqual((await stored()).except, ["tunes.test", "byte.test"]);
  for (const p of [byte, tunes, library]) assert.deepEqual(p.errors, []);
});

test("the off switch and pause hold it back on the page; the panel's switch turns it off everywhere", { skip }, async () => {
  const byte = await open("byte");
  await makeStyle(byte, "bigger text and underline links everywhere");
  const tunes = await open("tunes");
  await until(() => styled(tunes), "the style on Tunes");

  await byte.keyboard.press(HOTKEYS.off);
  await until(() => plain(byte), "the off switch takes it off");
  await until(async () => /Turned off 1 mod on this page/.test(await shadowText(byte, ".ctl-toast")), "the off switch toast");
  assert.ok(await styled(tunes), "only this tab");
  await byte.reload();
  await world.ready(byte);
  await settle(byte);
  assert.ok(await plain(byte), "still off after a reload, like every mod");
  await byte.keyboard.press(HOTKEYS.off);
  await until(() => styled(byte), "back on");

  // Pause Morse on this site.
  await openPanel(byte);
  await byte.locator('[data-c="pause-site"]').evaluate(el => el.click());
  await until(() => plain(byte), "paused here");
  assert.match(await byte.locator(".ys-row").innerText(), /Not running on this page/);
  await byte.locator('[data-c="pause-site"]').evaluate(el => el.click());
  await until(() => styled(byte), "resumed");

  // The panel's switch: off everywhere, other tabs follow.
  await byte.locator('.ys-row [data-y="on"]').evaluate(el => el.click());
  await until(() => plain(byte), "off here");
  await until(() => plain(tunes), "off in the other tab too");
  assert.equal((await stored()).enabled, false);
  assert.match(await byte.locator(".ys-row").innerText(), /Off everywhere/);
  const library = await open("library");
  await settle(library);
  assert.ok(await plain(library), "a new page doesn't get it");
  await byte.locator('.ys-row [data-y="on"]').evaluate(el => el.click());
  await until(() => styled(tunes), "on again everywhere");
  for (const p of [byte, tunes, library]) assert.deepEqual(p.errors, []);
});

test("it persists: reloads, new tabs and a new connection to the browser read style.json", { skip }, async () => {
  const tunes = await open("tunes");
  await makeStyle(tunes, "Georgia font and more space between lines everywhere");
  const font = page => page.evaluate(() => getComputedStyle(document.querySelector("h1, h2, p")).fontFamily);
  await until(async () => /^"?Georgia/.test(await font(tunes)), "Georgia on Tunes");
  await tunes.reload();
  await world.ready(tunes);
  await until(async () => /^"?Georgia/.test(await font(tunes)), "Georgia after a reload");
  const byte = await open("byte");
  await until(async () => /^"?Georgia/.test(await font(byte)) && (await byte.evaluate(() => getComputedStyle(document.querySelector("p")).lineHeight)) !== "normal", "Georgia and spacing on a new tab");
  // Icons and code keep their own font.
  const code = await byte.evaluate(() => { const c = document.createElement("code"); c.textContent = "x"; document.body.append(c); return getComputedStyle(c).fontFamily; });
  assert.doesNotMatch(code, /Georgia/);
  const s = await stored();
  assert.equal(s.blocks.font, "Georgia");
  assert.equal(s.blocks.spacing, "roomy");
  // The Morse helper stops (everything Morse added comes off the page) and connects again.
  await world.reconnect();
  await until(async () => !/Georgia/.test(await font(byte)), "the style gone while Morse is stopped");
  await byte.reload();
  await world.ready(byte);
  await until(async () => /^"?Georgia/.test(await font(byte)), "Georgia again from style.json");
});

test("calmer, on the library: the autoplaying video waits, the ticker stops, colors soften, and self-heal leaves it alone", { skip }, async () => {
  const byte = await open("byte");
  await makeStyle(byte, "everything calmer everywhere: no autoplay, fewer animations, softer colors");
  const library = await open("library");
  await until(() => library.evaluate(() => document.querySelector("video").paused), "the video paused");
  assert.equal(await library.evaluate(() => getComputedStyle(document.querySelector(".ticker span")).animationDuration), "0.001s");
  assert.match(await library.evaluate(() => getComputedStyle(document.documentElement).filter), /saturate\(0\.72\)/);
  // A play you start stays.
  await library.locator("video").click();
  await library.evaluate(() => document.querySelector("video").play());
  await settle(library);
  assert.equal(await library.evaluate(() => document.querySelector("video").paused), false, "the play you started keeps playing");
  // Self-heal runs after the page settles: the style is never fingerprinted or flagged.
  await library.waitForTimeout(6000); // longer than self-heal's quiet time plus its second look
  const s = await stored();
  assert.equal(s.fp, undefined);
  assert.equal(await library.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".bar")?.hasAttribute("data-heal")), false);
  await openPanel(library);
  assert.equal(await library.locator(".ys-row .health").count(), 0);
  assert.equal(await library.locator(".panel .list article").count(), 0, "it isn't listed as a mod as well");
  assert.deepEqual(library.errors, []);
});

test("fit to each site (opt-in): the first visit asks the model once, shows the fix for review, and saves it as part of the style", { skip }, async () => {
  const byte = await open("byte");
  await makeStyle(byte, "bigger text everywhere");
  // Off by default: a new site gets no model call.
  const mail = await open("mail");
  await until(async () => (await zoom(mail)) === "1.21", "the style on Postbox");
  await mail.waitForTimeout(3500);
  assert.equal((await world.ready(mail)).open, false, "nothing opens without the setting");
  await mail.close();
  // Turn it on in Settings.
  await pressOpen(byte);
  await status(byte, s => s.open, "the bar");
  await byte.keyboard.press("Control+Comma");
  await byte.locator(".sheet [data-act=more]").click();
  await byte.locator('details[data-group="style"] > summary').click();
  await byte.locator(".pane [data-ys-sec]").waitFor();
  await byte.locator('[data-ys="adapt"]').evaluate(el => el.click());
  await until(async () => (await stored()).adapt === true, "the setting saved");
  await byte.keyboard.press("Escape");
  await byte.keyboard.press("Escape");
  // First visit to Tunes: the bar opens on its own with the fix, for review.
  const tunes = await open("tunes");
  const s = await status(tunes, s => s.open && s.phase === "result", "the fit shown for review");
  assert.match(s.hint, /Buttons keep their words on one line.*Your style/);
  assert.match(await shadowText(tunes, ".actions"), /Save.*Undo/);
  await tunes.keyboard.press("Enter");
  await status(tunes, s => !s.open, "saved");
  const mods = await until(async () => { const f = await fs.readdir(path.join(home, "mods")); return f.length && f; }, "the fit saved as a mod");
  const fit = JSON.parse(await fs.readFile(path.join(home, "mods", mods[0]), "utf8"));
  assert.equal(fit.parent, "morse-style");
  assert.equal(fit.title, "Your style for tunes.test");
  assert.deepEqual(fit.match.hosts, ["tunes.test"]);
  assert.ok((await stored()).tried["tunes.test"], "once per site");
  await openPanel(tunes);
  assert.match(await tunes.locator(".ys-row").innerText(), /fitted to this site/);
  // A second visit doesn't ask again; leaving the site out takes the fit off too.
  const again = await open("tunes", "/?again");
  await again.waitForTimeout(3500);
  assert.equal((await world.ready(again)).open, false);
  assert.equal(await again.locator(`style[data-morse-css="${fit.id}"]`).count(), 1);
  await say(again, "not on this site");
  await until(async () => (await again.locator(`style[data-morse-css="${fit.id}"]`).count()) === 0 && (await zoom(again)) === "1", "the style and its fit off here");
  for (const p of [byte, tunes, again]) assert.deepEqual(p.errors, []);
});
