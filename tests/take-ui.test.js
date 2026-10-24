// Take this, Bring here, end to end in real Chromium: the real runtime on two
// demo sites (Codepad, a small code editor with a command palette, and the
// Inkwell notes app) with a stand-in host running the real engine against the
// demo model (core/take-demo.js). The person opens Codepad's palette while
// Morse watches, Stop takes it; in Inkwell, Bring here… puts it back, built
// from Inkwell's own font, colors and corners, and it really works: the same
// keys open it, typing filters it, Enter runs one of Inkwell's own things.
// Also: a typed request that names a taken feature brings it, what is kept
// leaves out email addresses, and the Mods panel lists what was taken.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openSite } from "../demo/show-once-page.js";
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
let browser;
before(async () => { if (!skip) browser = await chromium.launch(); });
after(() => browser?.close());

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { if (Date.now() > end) throw e; }
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + fn);
    await new Promise(r => setTimeout(r, 40));
  }
}
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
const taken = page => page.evaluate(() => JSON.parse(localStorage.getItem("morse:a11y-host:taken") || "[]"));
const mods = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:a11y-host:mods") || "{}")));
const requests = page => page.evaluate(() => window.__fake.requests);
async function openBar(page) {
  await page.keyboard.press(OPEN_KEY);
  await until(async () => (await status(page)).open);
}
async function go(page, site) {
  await page.goto(`http://sites.morse.test/demo/sites/${site}/index.html`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status);
}

test("Take this in one app, Bring here in another: the palette works there, in that app's own look", { skip }, async () => {
  const { ctx, page, errors } = await openSite(browser, "codepad", { shots: true });
  try {
    // ---- Take: nothing pointed at, so Morse watches while the palette opens
    await openBar(page);
    assert.equal((await page.locator(".sugs .tk-take").innerText()).trim(), "Take this");
    await page.locator(".sugs .tk-take").click();
    await page.locator(".so-strip").waitFor();
    assert.match(await page.locator(".so-strip").innerText(), /Take this[\s\S]*Open the feature you want to take/);
    await page.keyboard.press("Control+Shift+P");
    await page.locator(".quick-input-widget input").waitFor();
    await page.keyboard.type("zoom");
    assert.equal(await page.locator(".quick-input-list li").count(), 2, "the palette filters as it does without Morse");
    // Stop leaves the page's focus alone, so the palette is still open to take.
    await page.locator(".so-strip [data-so=stop]").click();
    await until(async () => (await taken(page)).length === 1 && (await taken(page))[0].about);
    const [item] = await taken(page);
    assert.equal(item.name, "Command palette", "the model named it");
    assert.equal(item.from.app, "Codepad");
    assert.match(item.about, /opens with Ctrl\+Shift\+P/);
    assert.deepEqual(item.steps.map(s => s.do), ["key", "type"]);
    assert.equal(item.steps[0].key, "Ctrl+Shift+P");
    assert.match(item.html, /quick-input-widget/);
    assert.match(item.thumb || "", /^data:image\/jpeg;base64,/, "a small picture");
    // The bar shows what was taken and what to do next.
    await until(async () => (await status(page)).open);
    await until(async () => /Command palette/.test(await page.locator(".tk-card").innerText()));
    assert.match(await page.locator(".tk-card").innerText(), /Taken[\s\S]*Command palette[\s\S]*Taken from Codepad/i);
    await until(async () => /Bring here…/.test((await status(page)).hint));
    await page.locator(".tk-card [data-tk=done]").click();
    assert.equal(await page.locator(".tk-card").isHidden(), true);
    // The describe request carried no picture and no Morse UI.
    const ask = (await requests(page)).find(r => r.context.take);
    assert.ok(ask && !JSON.stringify(ask).includes("base64"), "the picture stays on this computer");

    // ---- Bring: in Inkwell, pick it from Bring here…
    await go(page, "notes");
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    await openBar(page);
    await page.locator(".sugs .tk-bring").click();
    await page.locator(".tk-pick .tk-it").first().waitFor();
    assert.match(await page.locator(".tk-pick").innerText(), /Command palette[\s\S]*Taken from Codepad/);
    await page.locator(".tk-pick .tk-it").first().click();
    await until(async () => (await status(page)).input === "Add “Command palette” from Codepad here");
    assert.match(await page.locator(".tk-card.bring").innerText(), /Bringing[\s\S]*Command palette/i);
    await page.keyboard.press("Enter");
    await until(async () => (await status(page)).phase === "result", 30000);
    const req = (await requests(page)).at(-1);
    assert.equal(req.context.bring.name, "Command palette");
    assert.equal(req.context.bring.steps[0].key, "Ctrl+Shift+P");
    assert.equal(req.context.bring.thumb, undefined, "no picture goes to the model");

    // It works: the same keys open it, typing filters, Enter runs Inkwell's own thing.
    await page.keyboard.press("Escape");
    await until(async () => !(await status(page)).open);
    const pal = page.locator(".morse-pal");
    await page.locator(".morse-pal-open").waitFor();
    await page.keyboard.press("Control+Shift+P");
    await pal.waitFor({ state: "visible" });
    await page.keyboard.type("Reading");
    assert.deepEqual(await pal.locator("li").allInnerTexts(), ["Reading list"]);
    // In Inkwell's look, not Codepad's: its font, its white page, its 4px corners.
    const look = await pal.evaluate(el => ({ font: getComputedStyle(el).fontFamily, bg: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius }));
    assert.deepEqual(look, { font, bg: "rgb(255, 255, 255)", radius: "4px" });
    await page.keyboard.press("Enter");
    await until(async () => (await page.locator(".doc h1").innerText()) === "Reading list");
    assert.equal(await pal.isHidden(), true);
    // Esc closes it.
    await page.keyboard.press("Control+Shift+P");
    await pal.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await pal.waitFor({ state: "hidden" });

    // Closing the bar kept the result: a normal mod that remembers where it came from.
    const [mod] = await mods(page);
    assert.equal(mod.title, "Command palette from Codepad");
    assert.deepEqual({ app: mod.from.app, taken: mod.from.taken }, { app: "Codepad", taken: item.id });
    await openBar(page);
    await page.locator(".actions [data-a=mods]").click();
    await page.locator(".panel .tk-site").waitFor();
    assert.match(await page.locator(".panel").innerText(), /Taken from Codepad[\s\S]*Taken from other apps[\s\S]*Command palette/);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/take-panel.png` });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("a typed request that names a taken feature brings it; one for a well-known feature asks the model to build it", { skip }, async () => {
  const { ctx, page } = await openSite(browser, "tasks");
  try {
    const item = { id: "palette1", name: "Command palette", label: "“Command palette” dialog", about: "Opens with Ctrl+Shift+P.", from: { app: "Codepad", host: "sites.morse.test" },
      html: "<div role=\"dialog\"><input></div>", steps: [{ n: 1, do: "key", selector: "body", key: "Ctrl+Shift+P" }], created: new Date().toISOString() };
    await page.evaluate(i => localStorage.setItem("morse:a11y-host:taken", JSON.stringify([i])), item);
    await openBar(page);
    await page.keyboard.type("add the command palette from Codepad here");
    await page.keyboard.press("Enter");
    await until(async () => (await status(page)).phase === "result", 30000);
    assert.equal((await requests(page)).at(-1).context.bring.name, "Command palette");
    assert.ok(await page.locator(".morse-pal-open").count(), "built here");
    await page.locator(".actions [data-a=undo]").click();
    await until(async () => !(await status(page)).open);
    await openBar(page);
    const n = (await requests(page)).length;
    await page.keyboard.type("add Linear's keyboard shortcuts list here");
    await page.keyboard.press("Enter");
    await until(async () => (await requests(page)).length > n, 30000);
    assert.deepEqual((await requests(page)).at(-1).context.bring, { known: true, app: "Linear", what: "keyboard shortcuts list" });
  } finally { await ctx.close(); }
});

test("pointing and taking keeps no email address, and the Mods panel can delete what was taken", { skip }, async () => {
  const { ctx, page } = await openSite(browser, "mail");
  try {
    await openBar(page);
    const row = page.locator(".r9", { hasText: "Leo Martins" });
    await row.hover();
    await row.click();
    await until(async () => /pointed at/.test(await page.locator(".sugs .tk-take").getAttribute("title")));
    await page.locator(".sugs .tk-take").click();
    await until(async () => (await taken(page)).length === 1);
    const json = JSON.stringify(await taken(page));
    assert.doesNotMatch(json, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "no email address is kept");
    await until(async () => (await page.locator(".tk-card").count()) && /Taken/i.test(await page.locator(".tk-card").innerText()));
    // Show how it opens: the same strip, then the steps join what was taken.
    await page.locator(".tk-card [data-tk=how]").click();
    await page.locator(".so-strip").waitFor();
    assert.match(await page.locator(".so-strip").innerText(), /Show how it opens/);
    await page.locator(".r9", { hasText: "Maya" }).first().click();
    await page.locator(".so-strip [data-so=stop]").click();
    await until(async () => (await taken(page))[0]?.steps.length === 1);
    await until(async () => (await status(page)).open);
    assert.equal(await page.locator(".tk-card [data-tk=how]").count(), 0, "it knows how it opens now");
    await page.keyboard.press("Escape");
    await openBar(page);
    await page.locator(".actions [data-a=mods]").click();
    await page.locator(".panel .tk-site [data-tk=del]").click();
    await until(async () => (await taken(page)).length === 0);
    await until(async () => (await page.locator(".panel .tk-site").count()) === 0, 5000);
  } finally { await ctx.close(); }
});
