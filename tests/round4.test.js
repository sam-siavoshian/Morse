// Bug and security hunt, round 4: regressions for what it found. Each test
// failed before its fix.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promises as fs, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => {}); });

// MORSE_HOME is read when daemon/store.js loads, so one home for this file.
process.env.MORSE_HOME = mkdtempSync(path.join(os.tmpdir(), "morse-r4-"));
cleanups.push(() => fs.rm(process.env.MORSE_HOME, { recursive: true, force: true }));

async function serve(handler) {
  const s = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise(r => s.on("listening", r));
  cleanups.push(() => new Promise(r => { s.close(r); s.closeAllConnections(); }));
  return `http://127.0.0.1:${s.address().port}`;
}

// A desktop "app": Chromium on a debug port, with the real connector attached.
// automation: false starts it the way apps start (navigator.webdriver false).
async function desktop({ automation = true, initScript = null } = {}) {
  const port = await freePort();
  let browser, ctx;
  if (automation) {
    browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
    ctx = await browser.newContext();
  } else {
    // Started by hand and reached over CDP, like `morse` reaches an app.
    const { spawn } = await import("node:child_process");
    const proc = spawn(chromium.executablePath(), [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "morse-r4-app-"))}`,
      "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--headless=new", "about:blank"], { stdio: "ignore" });
    cleanups.push(async () => proc.kill());
    for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    ctx = browser.contexts()[0];
  }
  cleanups.push(() => browser.close());
  if (initScript) await ctx.addInitScript(initScript);
  const page = automation ? await ctx.newPage() : ctx.pages()[0] || await ctx.newPage();
  const { Connector } = await import("../daemon/connector.js");
  const connector = new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  connector.run();
  cleanups.push(() => connector.stop());
  return { browser, page, connector };
}

test("a page can't open Morse's shadow root by setting morse:debug in its own storage", { skip }, async () => {
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Site</title><script>
    localStorage.setItem("morse:debug", "1");
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => true }); // only the page's own world
  </script><h1>Hello</h1>`));
  const { page } = await desktop({ automation: false });
  await page.goto(`${origin}/`);
  assert.equal(await page.evaluate(() => navigator.webdriver), true, "the page lies to itself");
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]"), null, { timeout: 15000 });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]"), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const seen = await page.evaluate(() => { const h = document.querySelector("[data-morse-ui]"); return { open: !!h.shadowRoot, status: h.dataset.status || null }; });
  assert.deepEqual(seen, { open: false, status: null });
});

test("a mod file with no created date doesn't break every site's mods (backup, share link, .morse.json)", async () => {
  const { saveMod, modsFor } = await import("../daemon/store.js");
  const { prepareInstall, parseImport } = await import("../core/backup.js");
  const { byCreated } = await import("../core/mod.js");
  await saveMod({ morse: 1, id: "r4-dated", title: "Dated", prompt: "p", css: "a{}", js: "", match: { hosts: ["dated.example"] }, created: "2026-01-01T00:00:00.000Z" });
  // As someone might write one by hand: no dates at all, or a number.
  const { mods } = await parseImport(JSON.stringify([
    { morse: 1, id: "r4-undated", title: "Undated", prompt: "p", css: "b{}", js: "", match: { hosts: ["other.example"] } },
    { morse: 1, id: "r4-numdate", title: "Number", prompt: "p", css: "c{}", js: "", match: { hosts: ["other.example"] }, created: 5, updated: {} },
  ]));
  const now = new Date("2026-10-24T00:00:00.000Z");
  const installed = mods.map(m => prepareInstall(m, { kind: "backup", now }));
  assert.deepEqual(installed.map(m => [m.created, m.updated]), [[now.toISOString(), now.toISOString()], [now.toISOString(), now.toISOString()]]);
  // Even an undated file already on disk (from an older Morse) is listed.
  await saveMod({ ...mods[0], id: "r4-legacy" });
  await fs.writeFile(path.join(process.env.MORSE_HOME, "mods", "r4-null.json"), "null");
  assert.deepEqual((await modsFor({ url: "https://dated.example/", app: null })).map(m => m.id), ["r4-dated"]);
  assert.deepEqual([{ created: 1 }, {}, { created: "2026" }].sort(byCreated).map(m => m.created), [undefined, 1, "2026"]);
});

test("desktop: pausing from the terminal reaches Morse in the app, and not the app's own scripts", { skip }, async () => {
  const { saveMod } = await import("../daemon/store.js");
  const { loadControl, saveControl } = await import("../daemon/control.js");
  const { setPause } = await import("../core/control.js");
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>App</title><h1>Hello</h1>`));
  await saveMod({ morse: 1, id: "r4-pausable", title: "Red title", prompt: "make the title red", css: "h1 { color: rgb(200, 0, 0) }", js: "", enabled: true,
    match: { hosts: [new URL(origin).host], app: null }, created: "2026-01-01T00:00:00.000Z" });
  const { page } = await desktop({ initScript: () => { window.__morseHostReceive = m => (window.__leaked ||= []).push(m); } });
  await page.goto(`${origin}/`);
  await page.waitForSelector('style[data-morse-css="r4-pausable"]', { state: "attached", timeout: 15000 });
  await page.waitForTimeout(800); // the connector's watcher has read the current state
  await saveControl(setPause(await loadControl(), { all: true })); // `morse pause`
  try {
    await page.waitForSelector('style[data-morse-css="r4-pausable"]', { state: "detached", timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__leaked || null), null, "the page's own __morseHostReceive heard nothing");
  } finally {
    await saveControl(setPause(await loadControl(), { all: false }));
  }
});

// ---- the page context sent to the model

const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
// The real runtime on a page, with a host that records what would go to the model.
async function withRuntime(html, fn) {
  const { bundleRuntime } = await import("../runtime/bundle.js");
  const browser = await chromium.launch();
  cleanups.push(() => browser.close());
  const origin = await serve((q, r) => {
    if (q.url === "/style.css") return r.writeHead(200, { "Content-Type": "text/css" }).end(`#pay { background: url("/bg.png?token=BgSecret9x8y7z&w=1"); } #pay .f { border: 1px solid; }`);
    r.writeHead(200, { "Content-Type": "text/html" }).end(html);
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(`${origin}/`);
  await page.evaluate(() => {
    const subs = [];
    window.__sent = [];
    globalThis.__morseHost = {
      onMessage: f => subs.push(f),
      send(m) {
        window.__sent.push(m);
        const result = m.type === "hello" ? { mode: "playground", label: "test", quiet: true, settings: { welcome: false } }
          : m.type === "mods.list" ? [] : m.type === "generate" ? { ok: false, error: "test" } : null;
        setTimeout(() => subs.forEach(f => f({ reply: m.id, result })), 5);
      },
    };
  });
  await page.addScriptTag({ content: bundleRuntime() });
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]"));
  await page.waitForTimeout(300);
  try { await fn(page); } finally { await page.close(); }
}

test("the page context sent to the model leaves out typed values, hidden fields, secrets in attributes, emails and signed URLs", { skip }, async () => {
  const SECRETS = ["HiddenCsrf123abcXYZ", "typed@example.com", "Hunter2Secret", "4111 1111 1111 1111", "4111111111111111", "owner@example.com", "other@example.com",
    "s3ss10nV4lu3", "SeCrEt123TokenValue456", "AbCdEf123456GhIjKl789", "draft secret message", "BgSecret9x8y7z", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0", "LiveTypedPassword"];
  await withRuntime(`<!doctype html><title>Pay</title><link rel="stylesheet" href="/style.css">
    <form id="pay" style="padding:20px;width:600px">
      <input type="hidden" name="csrf_token" value="HiddenCsrf123abcXYZ">
      <input class="f" name="email" value="typed@example.com">
      <input class="f" type="password" name="pw" value="Hunter2Secret">
      <input class="f" autocomplete="cc-number" value="4111 1111 1111 1111">
      <input class="f" id="live" type="password">
      <div class="row" style="height:60px" data-email="owner@example.com" data-session-id="s3ss10nV4lu3">Row one</div>
      <div class="row" style="height:60px" data-email="other@example.com" data-jwt="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0">Row two</div>
      <a href="/reset?token=SeCrEt123TokenValue456&amp;lang=en">Reset</a>
      <img alt="logo" width="40" height="40" src="/a.png?sig=AbCdEf123456GhIjKl789&amp;w=10">
      <textarea>draft secret message</textarea>
      <button type="submit" name="go" value="pay-now">Pay</button>
    </form>`, async page => {
    await page.locator("#live").fill("LiveTypedPassword");
    await page.keyboard.press(OPEN_KEY);
    await page.waitForTimeout(200);
    const r = await page.locator("#pay").boundingBox();
    await page.mouse.move(r.x + 5, r.y + 5);
    await page.mouse.click(r.x + 5, r.y + 5);
    await page.keyboard.type("make the fields bigger");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__sent.some(m => m.type === "generate"));
    const ctx = await page.evaluate(() => window.__sent.find(m => m.type === "generate").context);
    const all = JSON.stringify(ctx);
    assert.ok(ctx.target?.html.includes("<form"), "the form is the target");
    if (process.env.R4_DUMP) console.log(JSON.stringify(ctx, null, 1));
    for (const s of SECRETS) assert.ok(!all.includes(s), `"${s}" must not reach the model`);
    // What the model needs is still there.
    assert.match(ctx.target.html, /name="email"/);
    assert.match(ctx.target.html, /value="pay-now"/, "a button's value is its label");
    assert.match(ctx.target.html, /lang=en/);
    assert.match(ctx.target.facts, /#pay \{ background: url\("\/bg\.png\?…"\); \}/, "the CSS rule, without its signature");
  });
});

// ---- the extension, driven from Morse's own content-script world over CDP
// (what the runtime itself can send; the page's world can't reach it)

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "dist", "extension");
const skipExt = skip || (!process.env.DISPLAY && "extensions need a display (run under Xvfb)");
let extCtx = null;
async function extension() {
  if (extCtx) return extCtx;
  const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "morse-r4-ext-")), {
    headless: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  cleanups.push(() => ctx.close());
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  return (extCtx = { ctx, sw });
}
// Sends a request (or several at once) as Morse's runtime would, from the
// page's content-script world.
async function asMorse(page, msg) {
  const cdp = await page.context().newCDPSession(page);
  const worlds = [];
  cdp.on("Runtime.executionContextCreated", e => worlds.push(e.context));
  await cdp.send("Runtime.enable");
  const deadline = Date.now() + 5000;
  let world;
  while (!(world = worlds.find(c => c.auxData?.type === "isolated" && c.name === "Morse" && c.auxData?.isDefault === false)) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  assert.ok(world, "Morse's content-script world");
  const r = await cdp.send("Runtime.evaluate", {
    contextId: world.id, awaitPromise: true, returnByValue: true,
    expression: `Promise.all(${JSON.stringify([msg].flat())}.map(msg => new Promise(res => { const id = 900000 + Math.floor(Math.random() * 99999);
      __morseHost.onMessage(m => { if (m.reply === id) res({ error: m.error || null, result: m.result ?? null }); });
      __morseHost.send({ id, ...msg }); })))`,
  });
  await cdp.detach();
  return Array.isArray(msg) ? r.result.value : r.result.value[0];
}

test("extension: Describe's screenshot is never of another tab", { skip: skipExt }, async () => {
  const { ctx } = await extension();
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>${q.url}</title><body style="background:${q.url === "/secret" ? "#d00" : "#0a0"}"><h1>${q.url}</h1>`));
  const mine = await ctx.newPage();
  await mine.goto(`${origin}/mine`);
  await mine.waitForFunction(() => document.querySelector("[data-morse-ui]"));
  await mine.bringToFront();
  const shot = await asMorse(mine, { type: "capture" });
  assert.match(String(shot.result), /^data:image\/png;base64,/, "the tab's own screenshot works while it is showing");
  const other = await ctx.newPage();
  await other.goto(`${origin}/secret`);
  await other.bringToFront();
  await other.waitForTimeout(300);
  const r = await asMorse(mine, { type: "capture" });
  assert.equal(r.result, null, "no picture of the tab in front");
  assert.match(String(r.error), /tab/i);
  await other.close();
  await mine.close();
});

test("extension: an install and saves at the same moment don't drop each other", { skip: skipExt }, async () => {
  const { ctx, sw } = await extension();
  const origin = await serve((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Race</title><h1>Race</h1>`));
  const page = await ctx.newPage();
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]"));
  const mod = id => ({ morse: 1, id, title: id, prompt: id, css: "h1{}", js: "", match: { hosts: [new URL(origin).host], app: null }, created: "2026-01-01T00:00:00.000Z" });
  const msgs = [];
  for (let i = 0; i < 6; i++) {
    msgs.push({ type: "control.install", url: `${origin}/`, mods: [mod(`r4-inst-${i}`)], kind: "mod" });
    msgs.push({ type: "mods.save", draft: { id: `r4-save-${i}`, title: "s", prompt: "s", css: "h1{}", js: "" } });
  }
  const replies = await asMorse(page, msgs);
  assert.deepEqual(replies.filter(r => r.error), []);
  const ids = await sw.evaluate(async () => Object.keys((await chrome.storage.local.get("mods")).mods || {}).filter(k => k.startsWith("r4-")).sort());
  assert.deepEqual(ids, [...Array(6).keys()].flatMap(i => [`r4-inst-${i}`, `r4-save-${i}`]).sort());
  await page.close();
});

// ---- Mods for this site: a hostile or broken gallery

const GIDX = "https://g.example/site/mods/index.json";
const gmod = (over = {}) => ({ morse: 1, id: "sleep", title: "Sleep timer", prompt: "add a sleep timer", match: { hosts: ["tunes.example"], app: null }, css: ".a{}", js: "", version: 1, ...over });
const gentry = (over = {}) => ({ file: "sleep.morse.json", title: "Sleep timer", prompt: "add a sleep timer", match: { hosts: ["tunes.example"], app: null }, version: 1, ...over });
function galleryNet(files) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    const f = typeof files[url] === "function" ? files[url]() : files[url];
    if (!f) return new Response("not found", { status: 404 });
    if (f instanceof Response) return f;
    return new Response(JSON.stringify(f.body), { status: 200, headers: f.headers || {} });
  };
  return { fetch, calls };
}
function gstore() {
  const data = {};
  return { data, get: async k => structuredClone(data[k]), set: async (k, v) => { data[k] = structuredClone(v); } };
}

test("gallery: a huge list or mod file is cut off while reading, not read whole", async () => {
  const { createGallery } = await import("../core/gallery-host.js");
  let pulled = 0;
  const huge = () => new Response(new ReadableStream({
    pull(c) { if (pulled >= 64 * 1024 * 1024) return c.close(); pulled += 1024 * 1024; c.enqueue(new Uint8Array(1024 * 1024).fill(32)); },
  }), { status: 200 });
  const g = createGallery({ store: gstore(), fetch: galleryNet({ [GIDX]: huge }).fetch, configured: async () => GIDX });
  const r = await g.list({ url: "https://tunes.example/", app: null });
  assert.deepEqual(r.items, []);
  assert.equal(r.offline, true);
  assert.ok(pulled <= 4 * 1024 * 1024, `stopped early (read ${pulled} bytes)`);

  // Announced as too big: not read at all.
  pulled = 0;
  const net = galleryNet({ [GIDX]: { body: [gentry()] }, "https://g.example/site/mods/sleep.morse.json": () => { const r = huge(); r.headers.set("content-length", String(64 * 1024 * 1024)); return r; } });
  const r2 = await createGallery({ store: gstore(), fetch: net.fetch, configured: async () => GIDX }).list({ url: "https://tunes.example/", app: null });
  assert.deepEqual(r2.items, []);
  assert.ok(pulled <= 2 * 1024 * 1024, `mod file not read (read ${pulled} bytes)`);
});

test("gallery: a list can't pin itself in the cache with a huge max-age", async () => {
  const { needsFetch, afterResponse, DAY } = await import("../core/gallery.js");
  const t = 1_800_000_000_000;
  const cache = afterResponse(null, { status: 200, body: JSON.stringify([gentry()]), cacheControl: "max-age=9999999999" }, t);
  assert.equal(needsFetch(cache, t + 3 * DAY), false, "a long max-age is still honoured for a while");
  assert.equal(needsFetch(cache, t + 8 * DAY), true, "but the list is checked again within a week");
});

test("gallery: the cached mod file follows the list (narrower match, a withdrawn version)", async () => {
  const { createGallery } = await import("../core/gallery-host.js");
  let now = 1_800_000_000_000;
  const files = {
    [GIDX]: { body: [gentry({ match: { hosts: ["tunes.example", "old.tunes.example"], app: null }, version: 2 })] },
    "https://g.example/site/mods/sleep.morse.json": { body: gmod({ version: 2, js: "/* v2, bad */" }) },
  };
  const net = galleryNet(files), store = gstore();
  const g = createGallery({ store, fetch: net.fetch, now: () => now, configured: async () => GIDX });
  let r = await g.list({ url: "https://tunes.example/", app: null });
  assert.equal(r.items[0].mod.js, "/* v2, bad */");
  // The gallery withdraws version 2 (back to 1) and stops listing old.tunes.example.
  files[GIDX] = { body: [gentry({ version: 1 })] };
  files["https://g.example/site/mods/sleep.morse.json"] = { body: gmod({ version: 1, js: "/* v1 */" }) };
  now += 2 * 864e5;
  r = await g.list({ url: "https://tunes.example/", app: null, force: true });
  assert.equal(r.items[0].mod.js, "/* v1 */", "not the withdrawn version from the cache");
  assert.deepEqual(r.items[0].mod.match.hosts, ["tunes.example"]);
  assert.deepEqual(r.items[0].match.hosts, ["tunes.example"]);
});

test("gallery: entries for every .com (or .co.uk) site are dropped like ones for every site", async () => {
  const { parseIndex } = await import("../core/gallery.js");
  const list = [
    gentry({ file: "a.morse.json", match: { hosts: ["*.com"] } }),
    gentry({ file: "b.morse.json", match: { hosts: ["*.co.uk"] } }),
    gentry({ file: "c.morse.json", match: { hosts: ["tunes.example", "*.org."] } }),
    gentry({ file: "d.morse.json", match: { hosts: ["*.com:443"] } }),
    gentry({ file: "e.morse.json", match: { hosts: ["*.tunes.example"] } }),
    gentry({ file: "f.morse.json", match: { hosts: ["*.github.io"] } }),
  ];
  assert.deepEqual(parseIndex(list).entries.map(e => e.id), ["e", "f"]);
});

test("gallery: the cache of mod files stays bounded", async () => {
  const { createGallery } = await import("../core/gallery-host.js");
  const files = {}, store = gstore();
  for (let i = 0; i < 260; i++) files[`https://g${i}.example/mods/m${i}.morse.json`] = { body: gmod({ id: `m${i}`, match: { hosts: [`s${i}.example`] } }) };
  for (let i = 0; i < 260; i++) {
    const idx = `https://g${i}.example/mods/index.json`;
    files[idx] = { body: [gentry({ file: `m${i}.morse.json`, match: { hosts: [`s${i}.example`] } })] };
    const g = createGallery({ store, fetch: galleryNet(files).fetch, configured: async () => idx, now: () => 1_800_000_000_000 + i });
    assert.equal((await g.list({ url: `https://s${i}.example/`, app: null })).items.length, 1);
  }
  assert.ok(Object.keys(store.data.mods).length <= 200, `${Object.keys(store.data.mods).length} files kept`);
  assert.ok(store.data.mods["https://g259.example/mods/m259.morse.json"], "the newest is kept");
});
