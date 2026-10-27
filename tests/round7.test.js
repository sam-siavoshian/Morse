// Bug and security hunt, round 7: the boot/UI split, pointing and choosing
// with keys, MORSE_TRACE and the connector's log. Each test failed before its fix.
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium, noBrowser as skip, launchBrowser } from "./helpers/browser.js";
import { freePort } from "./helpers/net.js";
import { waitFor } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";
import { bundleBoot, bundleUI } from "../runtime/bundle.js";

void home;
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => {}); });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BOOT = bundleBoot(), UI = bundleUI();

let shared = null;
async function browser() {
  if (!shared) { shared = await launchBrowser(); cleanups.push(() => shared.close()); }
  return shared;
}

// The boot alone on a page, with a stand-in host in the page that logs every
// request. Its "ui.load" adds the UI the way the hosts do (on first use).
// debug: the UI comes at once, with an open shadow root (webdriver is on).
async function bootPage({ mods = [], exec = { ok: true }, debug = false } = {}) {
  const s = http.createServer((q, r) => {
    if (q.url === "/ui.js") return r.writeHead(200, { "Content-Type": "text/javascript" }).end(UI);
    r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Shop</title><body style="margin:0">
      <button id="a" style="margin:40px">Add to cart</button><button id="b" style="margin:40px">Delete account</button></body>`);
  }).listen(0, "127.0.0.1");
  await new Promise(r => s.on("listening", r));
  cleanups.push(() => new Promise(r => { s.close(r); s.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${s.address().port}`;
  const ctx = await (await browser()).newContext({ viewport: { width: 900, height: 600 } });
  cleanups.push(() => ctx.close());
  await ctx.addInitScript(({ mods, exec, debug }) => {
    if (window !== top) return;
    if (debug) localStorage.setItem("morse:debug", "1");
    const log = window.__log = [];
    const subs = [];
    const emit = m => subs.forEach(f => f(m));
    globalThis.__morseHost = {
      onMessage: f => subs.push(f),
      send(m) {
        log.push(m.type);
        const reply = result => setTimeout(() => emit({ reply: m.id, result }), 2);
        switch (m.type) {
          case "hello": return reply({ mode: "desktop", label: "test", quiet: true, settings: { welcome: false } });
          case "settings.get": return reply({ welcome: false });
          case "mods.list": return reply(mods);
          case "exec": return reply(exec);
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
  }, { mods, exec, debug });
  const page = await ctx.newPage();
  await page.goto(`${origin}/`);
  await page.addScriptTag({ content: BOOT });
  const count = type => page.evaluate(t => window.__log.filter(x => x === t).length, type);
  return { page, count };
}
// The stand-in host doesn't match mods to pages: it hands this one to every page.
const CODE_MOD = ({ morse: 1, id: "r7-code", title: "Cart badge", prompt: "badge", css: "#a { outline: 1px solid red }", js: "morse.watch('#a', el => {})",
  enabled: true, match: { hosts: ["shop.example"], app: null }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" });

// ======================================================================
// Pointing: only the person's own mouse
// ======================================================================

test("pointing: a page's synthetic mousemove and click can't choose what Morse changes; the person's own click still does", { skip, timeout: 60000 }, async () => {
  const { page } = await bootPage({ debug: true });
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.shadowRoot);
  await page.waitForFunction(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status || "{}").ready);
  await pressOpen(page);
  await page.waitForFunction(() => JSON.parse((document.dispatchEvent(new Event("morse:status")), document.querySelector("[data-morse-ui]")).dataset.status || "{}").open);
  const chosen = () => page.evaluate(() => { const c = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".chip.target"); return c.hidden ? null : c.textContent; });

  // The page points at "Delete account" for the person, and clicks it.
  await page.evaluate(() => {
    const b = document.getElementById("b"), r = b.getBoundingClientRect();
    const at = { clientX: r.left + 5, clientY: r.top + 5, bubbles: true, composed: true };
    b.dispatchEvent(new PointerEvent("pointerover", at));
    window.dispatchEvent(new MouseEvent("mousemove", at));
    b.dispatchEvent(new MouseEvent("click", at));
  });
  await page.waitForTimeout(300);
  assert.equal(await chosen(), null, "nothing chosen by the page's events");

  // The person points and clicks.
  const box = await page.locator("#a").boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.click(box.x + 5, box.y + 5);
  await waitFor(chosen, { what: "the person's choice" });
  assert.match(await chosen(), /Add to cart/);
});

// ======================================================================
// The boot and the UI: a page can't keep Morse busy
// ======================================================================

test("morse:paused: a page firing it over and over gets one check a second, not one per event (boot, and once the UI is here)", { skip, timeout: 60000 }, async () => {
  for (const ui of [false, true]) {
    const { page, count } = await bootPage({ mods: [CODE_MOD], debug: ui });
    await waitFor(async () => (await count("exec")) >= 1, { what: "the mod to run" });
    if (ui) await page.waitForFunction(() => document.querySelector("[data-morse-ui]"));
    await page.waitForTimeout(300);
    const before = await count("stats");
    // 40 events, 35 ms apart (each one past the old 30 ms debounce): 1.4 s.
    await page.evaluate(() => new Promise(r => {
      let n = 0;
      const t = setInterval(() => { document.dispatchEvent(new CustomEvent("morse:paused", { detail: JSON.stringify({ id: "r7-code" }) })); if (++n === 40) { clearInterval(t); setTimeout(r, 1200); } }, 35);
    }));
    const asked = await count("stats") - before;
    assert.ok(asked >= 1, "a pause the page reports is still checked");
    assert.ok(asked <= 4, `${ui ? "the UI" : "the boot"} asked the host ${asked} times for 40 events`);
  }
});

test("no UI listener on the page's document or window skips the boot's on() (a detached UI would keep it, and keep running it)", () => {
  const dir = path.join(ROOT, "runtime/src");
  for (const f of readdirSync(dir).filter(n => n.endsWith(".js"))) {
    const bare = readFileSync(path.join(dir, f), "utf8").split("\n").filter(l => /\b(document|window|globalThis|self)\.addEventListener\(/.test(l));
    assert.deepEqual(bare, [], `${f} listens on the page's document or window without B.on / listen()`);
  }
});

// ======================================================================
// Desktop: morse stop, then attach again, in the same document
// ======================================================================

test("desktop: stopping and attaching again in one document doesn't keep every earlier UI (and its listeners) in memory", { skip, timeout: 120000 }, async () => {
  const s = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Cycles</title><p>hello</p>")).listen(0, "127.0.0.1");
  await new Promise(r => s.on("listening", r));
  cleanups.push(() => new Promise(r => { s.close(r); s.closeAllConnections(); }));
  const port = await freePort();
  const b = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  cleanups.push(() => b.close());
  const page = await (await b.newContext()).newPage();
  await page.goto(`http://127.0.0.1:${s.address().port}/`);
  const cdp = await page.context().newCDPSession(page);
  const worlds = [];
  cdp.on("Runtime.executionContextCreated", e => { if (e.context.name === "morse") worlds.push(e.context.id); });
  await cdp.send("Runtime.enable");
  // Shadow roots made in Morse's world: one per UI that is still in memory.
  const roots = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const proto = await cdp.send("Runtime.evaluate", { expression: "ShadowRoot.prototype", contextId: worlds.at(-1), objectGroup: "r7" });
    const found = await cdp.send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: "r7" });
    const n = await cdp.send("Runtime.callFunctionOn", { objectId: found.objects.objectId, functionDeclaration: "function () { return this.length; }", returnByValue: true });
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "r7" });
    return n.result.value;
  };
  const { Connector } = await import("../daemon/connector.js");
  const CYCLES = 5;
  for (let i = 0; i < CYCLES; i++) {
    const c = new Connector({ port, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
    c.run();
    await waitFor(async () => {
      if (await page.evaluate(() => !!document.querySelector("[data-morse-ui]"))) return true;
      await pressOpen(page).catch(() => {});
      await page.waitForTimeout(200);
      return false;
    }, { what: `the bar, attach ${i + 1}` });
    await c.stop();
    await waitFor(() => page.evaluate(() => !document.querySelector("[data-morse-ui]")), { what: "morse stop to clean up" });
  }
  await page.waitForTimeout(4000); // short timers the last UIs set (a hint, a toast) run out
  const left = await roots();
  assert.ok(left <= 2, `${left} UIs still in memory after ${CYCLES} stops`); // the last one, until another attach lets it go
});

// ======================================================================
// MORSE_TRACE and the connector's log: text, never terminal escapes
// ======================================================================

const EVIL = "Inbox \x1b]52;c;cm0gLXJmIH4=\x07\x1b[2J\x1b[1A\r\u009b2Jdone\u2028fake line";
const escapes = s => /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]/.test(s);

test("MORSE_TRACE: escape sequences in a line (a mod's name, an error, a title) never reach the terminal or file; false and off mean off; the file it makes is the owner's", () => {
  const dir = tempDir("morse-r7-trace-");
  const run = (env, code) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  const code = `import { trace } from ${JSON.stringify(path.join(ROOT, "daemon/trace.js"))}; trace("save", ${JSON.stringify(`Saved "${EVIL}"`)});`;

  const file = path.join(dir, "trace.log");
  run({ MORSE_TRACE: file }, code);
  const text = readFileSync(file, "utf8");
  assert.match(text, /save\s+Saved "Inbox/);
  assert.equal(escapes(text.replace(/\n$/, "")), false, JSON.stringify(text));
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o077, 0, "only its owner can read the trace (it holds their requests)");

  const err = run({ MORSE_TRACE: "1" }, code).stderr;
  assert.match(err, /Saved "Inbox/);
  assert.equal(escapes(err.replace(/\n$/, "")), false, JSON.stringify(err));

  for (const v of ["false", "off", "no", "0", ""]) {
    const r = run({ MORSE_TRACE: v }, code);
    assert.equal(r.stderr, "", `MORSE_TRACE=${v} prints nothing`);
  }
  assert.deepEqual(readdirSync(dir).sort(), ["trace.log"], "no file named after the setting");
});

test("desktop: the connector's log shows a mod's name (or a window's title) as text, never escape sequences", { timeout: 30000 }, async () => {
  const { saveMod } = await import("../daemon/store.js");
  const { Connector } = await import("../daemon/connector.js");
  const mod = { morse: 1, id: "r7-froze", title: EVIL, prompt: "p", css: "", js: "for(;;){}", enabled: true,
    match: { hosts: ["*"], app: null }, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" };
  await saveMod(mod);
  const lines = [];
  const c = new Connector({ port: 1, app: null, settings: { provider: "demo" }, log: l => lines.push(l) });
  const s = { hang: { code: () => mod.js }, send: async () => ({}) };
  await c.froze(s, { type: "page", title: `Chat ${EVIL}`, url: "http://chat.example/" }, mod.id);
  clearTimeout(c.modsTimer);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /froze/);
  assert.equal(escapes(lines[0]), false, JSON.stringify(lines[0]));
  assert.ok(existsSync(path.join(process.env.MORSE_HOME, "mods")));
});
