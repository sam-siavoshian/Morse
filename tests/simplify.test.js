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
import { noBrowser, noDisplay, launchBrowser, chromium } from "./helpers/browser.js";
import { waitForStatus, waitForReady, TIMEOUT } from "./helpers/wait.js";
import { home, tempDir } from "./helpers/home.js";
import { writeFileSync, readdirSync, readFileSync } from "node:fs";

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
  assert.deepEqual(rows.map(s => s.replace(/ ·.*/, "")), ["Your style", "Open Morse", "Theme", "Language", "Fix my mods when a site changes"]);
  const more = page.locator(".pane [data-act=more]");
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await page.locator(".pane #m-more-settings:not([hidden])").waitFor();
  assert.equal(await page.locator(".pane [data-act=more]").getAttribute("aria-expanded"), "true");
  assert.equal(await activeText(page), "More settings", "focus stays on the button");
  const all = await visible(page, ".pane .srow .lbl > span");
  assert.ok(all.length >= rows.length + 9, all.join(" | ")); // the other shortcuts, voice, effects, position, notices
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
  // The panel shows the rows it knows at once, then swaps in the host's list
  // (70-panel.js). A check in that gap sees no buttons, so wait until the
  // swap has settled on Change, Share and More.
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-morse-ui]")?.shadowRoot;
    const got = [...(root?.querySelectorAll(".panel article .btns > button, .panel article .rmore > summary") || [])]
      .filter(n => n.getClientRects().length).map(n => n.dataset.a || n.tagName);
    return got.join() === "refine,share,SUMMARY";
  });
  await page.locator(".panel article .rmore summary").click();
  assert.deepEqual(await page.locator(".panel article .rmore-list button").evaluateAll(ns => ns.filter(n => n.getClientRects().length).map(n => n.dataset.a || n.dataset.c)), ["link", "show", "del"]);
  // Edit code is inside Show code.
  await page.locator(".panel article [data-c=show]").click();
  await page.locator(".card [data-c=edit]").waitFor();
  await page.keyboard.press("Escape");
  // The panel's own: Install a mod… shows; backup and packs under More.
  assert.deepEqual(await page.locator(".panel footer > button, .panel footer > details > summary").evaluateAll(ns => ns.filter(n => n.getClientRects().length).map(n => n.dataset.a || n.tagName)), ["import", "SUMMARY"]);
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
  for (const c of ["launch", "setup", "install"]) assert.ok(cmds.some(l => l.includes(`morse ${c}`)), c);
  assert.match(short.stdout, /morse help --all/);
  const all = run(["help", "--all"]).stdout;
  for (const c of ["attach", "fuses", "config", "rm", "export", "code", "pack make", "resume"]) assert.ok(all.includes(`morse ${c}`), c);
  const typo = run(["lauch"]);
  assert.equal(typo.status, 1, "an unknown command is an error");
  assert.match(typo.stdout, /no command “lauch”/);
  for (const gone of ["serve", "pair", "extension"]) assert.ok(!all.includes(`morse ${gone} `), `${gone}: no Chrome extension any more`);
});

// Checked end to end (docs/dev/simplify.md): VSCodium opened a second time on
// a busy machine took over 1.5 s to answer /json/version, and morse launch
// gave up with “The model took too long to answer”, though no model was asked.
test("morse launch: an app slow to answer on its port is waited for, and one that never answers isn't blamed on the model", async () => {
  const http = await import("node:http");
  const { identify } = await import("../daemon/ports.js");
  const { plainError } = await import("../core/onboarding.js");
  const serve = delay => new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (req.url !== "/json/version") return res.writeHead(404).end();
      setTimeout(() => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ Browser: "Chrome/140", "User-Agent": "Mozilla/5.0 Electron/43.0.0" })), delay);
    }).listen(0, "127.0.0.1", () => resolve(s));
  });
  const slow = await serve(2500);
  try {
    const who = await identify(slow.address().port);
    assert.equal(who.electron, "43.0.0", "a slow answer still counts");
  } finally { slow.closeAllConnections(); slow.close(); }
  const mute = await serve(60_000);
  try {
    const e = await identify(mute.address().port, { tries: [300, 300] }).then(() => null, e => e);
    assert.ok(e, "no answer at all is an error");
    assert.doesNotMatch(plainError(e), /model/i, plainError(e));
    assert.match(plainError(e), /didn't answer/);
  } finally { mute.closeAllConnections(); mute.close(); }
});

// Checked end to end (docs/dev/simplify.md): every command says something
// useful with no config, a broken one, or no model.
const cli = h => args => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, MORSE_HOME: h, NO_COLOR: "1", LANG: "en_US.UTF-8", MORSE_NO_UPDATE_CHECK: "1" } });

test("morse rm, export and code: no id asks which mod; an unknown id says so, and nothing claims it was deleted", () => {
  const run = cli(tempDir("morse-simplify-cli-"));
  for (const cmd of ["rm", "export", "code"]) {
    const r = run([cmd]);
    assert.equal(r.status, 1, `morse ${cmd}`);
    assert.match(r.stderr, /Which mod\?.*morse mods/, `morse ${cmd}: ${r.stderr}`);
    const u = run([cmd, "nosuchid"]);
    assert.equal(u.status, 1, `morse ${cmd} nosuchid`);
    assert.match(u.stderr, /nosuchid/, `morse ${cmd} nosuchid: ${u.stderr}`);
    assert.doesNotMatch(u.stdout + u.stderr, /\{id\}|Something went wrong|Deleted/, `morse ${cmd} nosuchid`);
  }
});

test("a config file Morse can't read: commands say so, and a change keeps a copy of it", () => {
  const h = tempDir("morse-simplify-cfg-");
  const run = cli(h);
  writeFileSync(path.join(h, "config.json"), "{ this is not json");
  const m = run(["model"]);
  assert.equal(m.status, 0);
  assert.match(m.stderr, /can't read .*config\.json/, m.stderr);
  const c = run(["config", "--model-mode", "fast"]);
  assert.equal(c.status, 0, c.stderr);
  const copies = readdirSync(h).filter(f => /^config\.json\.unreadable/.test(f));
  assert.equal(copies.length, 1, readdirSync(h).join(", "));
  assert.equal(readFileSync(path.join(h, copies[0]), "utf8"), "{ this is not json");
  assert.match(c.stderr, /copy/, c.stderr);
  assert.doesNotMatch(run(["model"]).stderr, /can't read/, "fine once it was written again");
});
