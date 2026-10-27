// Captured things in the bar: use one here in one click, pick and clear it,
// remove it. Real runtime, demo/catalog.html's fake host (?clips=1).
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bundleRuntime } from "../runtime/bundle.js";
import { pressOpen } from "./helpers/keys.js";
import { launchBrowser, noBrowser } from "./helpers/browser.js";
import { readStatus, waitForStatus, TIMEOUT } from "./helpers/wait.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skip = noBrowser;
let browser, runtime;

before(async () => {
  if (skip) return;
  runtime = bundleRuntime();
  try { browser = await launchBrowser(); }
  catch { browser = await launchBrowser({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] }); }
});
after(() => browser?.close());

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 }, colorScheme: "dark" });
  await ctx.route("http://morse.test/**", async route => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p === "/dist/runtime/runtime.js") return route.fulfill({ body: runtime, contentType: "text/javascript" });
    try { await route.fulfill({ body: await readFile(path.join(ROOT, path.normalize(p))), contentType: p.endsWith(".html") ? "text/html" : "text/javascript" }); }
    catch { await route.fulfill({ status: 404, body: "" }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://morse.test/demo/catalog.html?theme=dark&clips=1");
  await page.waitForFunction(() => globalThis.__cat?.calls.includes("mods.list"));
  await waitForStatus(page, s => s.ready, { what: "the runtime to be ready" });
  return { ctx, page, errors };
}

const q = (page, sel) => page.locator(`:root > [data-morse-ui] ${sel}`);

test("a capture can be pasted, picked, cleared, and removed", { skip, timeout: TIMEOUT }, async () => {
  const { ctx, page, errors } = await open();
  try {
    await pressOpen(page);
    await waitForStatus(page, s => s.open, { what: "the bar to open" });
    await q(page, ".gm-use").waitFor({ state: "visible" });

    const chip = id => q(page, `.gm-chip[data-id=${id}]`);
    assert.equal(await chip("c1").count(), 1);
    assert.equal(await chip("c2").count(), 1);
    assert.equal(await chip("c3").count(), 1);
    assert.equal(await q(page, "textarea.in").getAttribute("placeholder"), "What do you want to hack?");
    const order = await page.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".gm-clips, .sugs")].map(n => n.className.split(" ")[0]));
    assert.deepEqual(order, ["gm-clips", "sugs"], "the capture sits above Try");
    assert.equal(await q(page, ".sugs").isVisible(), true, "suggestions stay while nothing is picked");
    assert.equal(await q(page, ".gm-chip .x").count(), 3);
    assert.match(await chip("c1").locator(".x").getAttribute("aria-label"), /Daily Byte/);

    // Pick, then clear by clicking again. The hint and the field say what to do.
    await chip("c2").locator(".gm-chip-main").click();
    let s = await waitForStatus(page, s => /Use it here/.test(s.hint), { what: "the hint to name Use it here" });
    assert.equal(await chip("c2").locator(".gm-chip-main").getAttribute("aria-pressed"), "true");
    assert.equal(await chip("c1").locator(".gm-chip-main").getAttribute("aria-pressed"), "false");
    assert.equal(await q(page, "textarea.in").getAttribute("placeholder"), "Say where it goes");
    assert.equal(await q(page, ".sugs").isHidden(), true, "Try steps aside once a capture is picked");
    assert.equal(await q(page, ".go").getAttribute("aria-label"), "Use it here");
    assert.match(s.hint, /say where it goes/i);

    await chip("c2").locator(".gm-chip-main").click();
    await waitForStatus(page, s => !/Use it here/.test(s.hint), { what: "the pointing hint to come back" });
    assert.equal(await chip("c2").locator(".gm-chip-main").getAttribute("aria-pressed"), "false");
    assert.equal(await q(page, "textarea.in").getAttribute("placeholder"), "What do you want to hack?");
    assert.equal(await q(page, ".sugs").isVisible(), true);
    assert.equal(await q(page, ".go").getAttribute("aria-label"), "Send");

    // Backspace clears a pick when the line is empty.
    await chip("c2").locator(".gm-chip-main").click();
    await waitForStatus(page, s => /Use it here/.test(s.hint), { what: "the capture hint again" });
    await page.keyboard.press("Backspace");
    await waitForStatus(page, s => !/Use it here/.test(s.hint), { what: "Backspace to clear the pick" });
    assert.equal(await chip("c2").locator(".gm-chip-main").getAttribute("aria-pressed"), "false");

    // Remove drops it from the bar and from the saved list.
    await chip("c3").locator(".x").click();
    await q(page, `.gm-chip[data-id=c3]`).waitFor({ state: "detached" });
    const left = await page.evaluate(() => globalThis.__cat.clips.map(c => c.id));
    assert.deepEqual(left, ["c1", "c2"]);

    // Use it here pastes the newest capture when none is picked. Saying where it goes wins when you type.
    await q(page, ".gm-use").click();
    await page.waitForFunction(() => globalThis.__cat.gen?.request === "Use this here");
    const snap = await page.evaluate(() => globalThis.__cat.gen.context.snapshot);
    assert.match(snap.label, /Daily Byte/);
    assert.equal(snap.from.app, "The Daily Byte");
    await page.evaluate(() => globalThis.__cat.done({ ok: true, title: "Brought the masthead", css: ".x { color: red }", js: "" }));
    await waitForStatus(page, s => s.phase === "result", { what: "the paste to finish" });

    // A picked capture, with words, is the one that goes out.
    await page.keyboard.press("Escape");
    await waitForStatus(page, s => !s.open, { what: "the bar to close" });
    await pressOpen(page);
    await waitForStatus(page, s => s.open && s.phase === "idle", { what: "the bar to open idle" });
    await q(page, ".gm-use").waitFor({ state: "visible" });
    await chip("c2").locator(".gm-chip-main").click();
    await page.keyboard.type("in the header");
    s = await readStatus(page);
    assert.equal(s.input, "in the header");
    assert.equal(await q(page, ".go").getAttribute("aria-label"), "Send", "typed words keep Send");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => globalThis.__cat.gen?.request === "in the header");
    const again = await page.evaluate(() => globalThis.__cat.gen.context.snapshot.label);
    assert.match(again, /Subscribe/);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
