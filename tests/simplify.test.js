// Fewer choices on the main path (docs/dev/simplify.md): the ⋯ menu, Settings,
// the page tools, the Mods panel and `morse help` show the few things people
// use, and everything else is one "More" away, still reachable by keyboard.
// Runs the real runtime against demo/bar-playground.html's fake host.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { serveBar } from "./helpers/demo-server.js";
import { pressOpen } from "./helpers/keys.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";
import { home } from "./helpers/home.js";

const skip = noBrowser;
const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../daemon/cli.js");
let browser, srv;

before(async () => {
  if (skip) return;
  srv = await serveBar();
  browser = await launchBrowser({ channel: "chromium" });
});
after(async () => { await browser?.close(); await srv?.close(); });

async function scenario(query, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(srv.url + query);
    await waitForReady(page);
    const waitFor = pred => waitForStatus(page, pred, { timeout: TIMEOUT, what: String(pred) });
    await fn({ page, waitFor });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
}
const active = page => page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement);
const activeText = page => page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.textContent.trim());
const visible = (page, sel) => page.locator(sel).evaluateAll(ns => ns.filter(n => n.getClientRects().length).map(n => n.textContent.trim().replace(/\s+/g, " ")));

test("the ⋯ menu has three things; Talk, Mods, Choose with keys and the shortcut list keep their own ways in", { skip }, () => scenario("", async ({ page, waitFor }) => {
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.locator(".bar .more").click();
  const items = await visible(page, ".bmenu [role=menuitem]");
  assert.deepEqual(items.map(s => s.replace(/\s*(Ctrl|⌘).*|\s*F1$/, "")), ["Show me once", "Settings", "Help and examples"]);
  await page.keyboard.press("Escape");
  // Each one that left the menu is still a click or a key away.
  assert.equal(await page.locator(".bar .mic").isVisible(), true, "Talk: the mic button");
  assert.equal(await page.locator(".bar .actions [data-a=mods]").isVisible(), true, "Mods: the button beside ⋯");
  await page.keyboard.press("F1");
  await waitFor(s => s.pane === "help");
  await page.locator(".pane [data-act=keys]").click();
  await waitFor(s => s.pane === "shortcuts");
  assert.match(await page.locator(".pane").innerText(), /Choose with keys/, "Choose with keys is on the shortcut list");
}));

test("Settings: four rows and Your style, then More settings, which opens and closes from the keyboard", { skip }, () => scenario("", async ({ page, waitFor }) => {
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.keyboard.press("Control+Comma");
  await waitFor(s => s.pane === "settings");
  const rows = await visible(page, ".pane .srow .lbl > span");
  assert.deepEqual(rows.map(s => s.replace(/ ·.*/, "")), ["Your style", "Open Morse", "Theme", "Language", "Fix my mods automatically when a site changes"]);
  const more = page.locator(".pane [data-act=more]");
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await page.locator(".pane #m-more-settings:not([hidden])").waitFor();
  assert.equal(await page.locator(".pane [data-act=more]").getAttribute("aria-expanded"), "true");
  assert.equal(await activeText(page), "More settings", "focus stays on the button");
  const all = await visible(page, ".pane .srow .lbl > span");
  for (const r of ["Push to talk", "Mods panel", "Edit tools", "Turn off all mods", "Send after a pause", "Effects", "Bar position", "Welcome message", "Show mods others made"]) assert.ok(all.includes(r), r);
  assert.ok(await page.locator(".pane [data-act=reset-all]").isVisible(), "Reset all settings");
  await page.keyboard.press("Enter");
  await page.locator(".pane #m-more-settings[hidden]").waitFor({ state: "attached" });
}));

test("page tools: nine things; Easier to use opens its group with a click or →, ← goes back", { skip }, () => scenario("", async ({ page, waitFor }) => {
  await pressOpen(page);
  await waitFor(s => s.open);
  await page.locator(".gm-qbtn").click();
  const items = await visible(page, ".gm-menu [role^=menuitem]");
  assert.ok(items.length <= 10, items.join(" | "));
  assert.ok(items.some(s => /^Easier to use/.test(s)), "Easier to use is one item");
  assert.equal(await page.locator(".gm-menu .a11y-group").isHidden(), true, "its group waits");
  const item = page.locator(".gm-menu [data-a11y=more]");
  await item.focus();
  await page.keyboard.press("ArrowRight");
  await page.locator(".gm-menu .a11y-group").waitFor();
  assert.equal(await item.getAttribute("aria-expanded"), "true");
  assert.equal(await activeText(page), "Higher contrast", "focus moves into the group");
  await page.keyboard.press("ArrowLeft");
  await page.locator(".gm-menu .a11y-group").waitFor({ state: "hidden" });
  assert.match(await activeText(page), /^Easier to use/, "and back to its item");
  await page.keyboard.press("Enter");
  await page.locator(".gm-menu .a11y-group").waitFor();
}));

test("Mods panel: Change and Share on each row, the rest under More; Install a mod… takes a link or a file", { skip }, () => scenario("?ms=5&keepmods", async ({ page, waitFor }) => {
  await pressOpen(page);
  await waitFor(s => s.open);
  const b = await page.locator("#toolbar").boundingBox();
  await page.mouse.click(b.x + 30, b.y + 4);
  await page.keyboard.type("make the toolbar airier");
  await page.keyboard.press("Enter");
  await waitFor(s => s.phase === "result");
  await page.keyboard.press("Enter"); // Save
  await waitFor(s => !s.open);
  await pressOpen(page, "Alt+Shift+M");
  await page.locator(".panel article").waitFor();
  assert.deepEqual(await visible(page, ".panel article .btns > button, .panel article .rmore > summary"), ["Change", "Share", "More"]);
  await page.locator(".panel article .rmore summary").click();
  assert.deepEqual(await visible(page, ".panel article .rmore-list button"), ["Copy link", "Show code", "Delete"]);
  // Edit code is inside Show code.
  await page.locator(".panel article [data-c=show]").click();
  await page.locator(".card [data-c=edit]").waitFor();
  await page.keyboard.press("Escape");
  // The panel's own: Install a mod… shows; backup and packs under More.
  assert.deepEqual(await visible(page, ".panel footer > button, .panel footer > details > summary"), ["Install a mod…", "More"]);
  assert.equal(await page.locator(".panel [data-c=import-file]").count(), 0, "no second install button");
  await page.locator(".panel footer [data-a=import]").click();
  assert.equal(await page.locator(".card [data-c=import-file]").isVisible(), true, "a file, from Install a mod…");
}));

test("morse help: the commands people use, and --all for every one", () => {
  const run = args => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, MORSE_HOME: home, NO_COLOR: "1", LANG: "en_US.UTF-8" } });
  const short = run(["help"]);
  assert.equal(short.status, 0);
  const cmds = short.stdout.split("\n").filter(l => /^  morse /.test(l));
  assert.ok(cmds.length <= 10, cmds.join("\n"));
  for (const c of ["launch", "serve", "setup", "install"]) assert.ok(cmds.some(l => l.includes(`morse ${c}`)), c);
  assert.match(short.stdout, /morse help --all/);
  const all = run(["help", "--all"]).stdout;
  for (const c of ["attach", "fuses", "pair", "unpair", "config", "rm", "export", "code", "pack make", "resume"]) assert.ok(all.includes(`morse ${c}`), c);
  const typo = run(["lauch"]);
  assert.equal(typo.status, 1, "an unknown command is an error");
  assert.match(typo.stdout, /no command “lauch”/);
});
