// Only English is built into Morse's bundles; another language's words are
// loaded when it is chosen (core/i18n.js loadLanguage): from the extension's
// package (locales/<code>.json), or from core/locales/ on the computer for
// the desktop connector and the CLI. Checked here:
//   - the built bundles (ui.js, runtime.js, boot.js, background.js) carry no
//     other language's words, and the package has each language as data
//   - loadLanguage: English until the words are here, never a message id,
//     and a failed read is tried again later
//   - in real Chromium, the bar opens at once (it may flash English) and
//     ends in German; Persian is right to left after Settings → Language,
//     and the popup follows; the desktop connector does the same over CDP
import { home, tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { LANGUAGES, CATALOGS, loadLanguage } from "../core/i18n.js";
import { readWords } from "../core/languages.js";
import { bundleBoot, bundleUI } from "../runtime/bundle.js";
import { chromium, noBrowser, noDisplay, launchBrowser } from "./helpers/browser.js";
import { startDemoServer, routeDemoOrigins } from "./helpers/demo-server.js";
import { freePort, listen } from "./helpers/net.js";
import { waitFor, waitForStatus, waitForReady, settle, TIMEOUT } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST = path.join(root, "dist", "extension");
const built = existsSync(path.join(DIST, "manifest.json"));
const EN = CATALOGS.en;
const WORDS = Object.fromEntries(await Promise.all(LANGUAGES.filter(l => l.code !== "en").map(async l => [l.code, await readWords(l.code)])));
await Promise.all(LANGUAGES.map(l => loadLanguage(l.code)));
const text = html => html.replace(/<[^>]+>/g, "");

// Translations that can only come from that language's catalog: different
// from English, and long enough not to turn up by chance. The boot keeps one
// note in every language on purpose (runtime/bundle.js AUTO_FIX_NOTES).
function translatedOnly(code) {
  const out = [];
  for (const [id, v] of Object.entries(WORDS[code])) {
    if (id === "heal.autoNote") continue;
    for (const s of typeof v === "object" ? Object.values(v) : [v]) {
      const e = EN[id];
      if (typeof s === "string" && s.length >= 14 && !(typeof e === "object" ? Object.values(e) : [e]).includes(s)) out.push(s);
    }
  }
  return out;
}
// esbuild writes non-ASCII as \uXXXX: read them back before looking.
const unescape = src => src.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, a, b) => String.fromCodePoint(parseInt(a || b, 16)));
const otherLanguageIn = src => {
  const found = [];
  for (const code of Object.keys(WORDS)) for (const s of translatedOnly(code)) if (src.includes(s) || src.includes(JSON.stringify(s).slice(1, -1))) { found.push(`${code}: ${s}`); break; }
  return found;
};

test("the runtime carries English only (runtime/bundle.js)", () => {
  const ui = bundleUI(), boot = bundleBoot();
  assert.ok(ui.includes(JSON.stringify(EN["bar.placeholder"]).slice(1, -1)), "the English words are in the UI");
  assert.deepEqual(otherLanguageIn(ui), [], "no other language in the UI");
  assert.deepEqual(otherLanguageIn(boot), [], "no other language in the boot");
  for (const code of Object.keys(WORDS)) assert.ok(boot.includes(JSON.stringify(WORDS[code]["heal.autoNote"]).slice(1, -1)), `the boot still knows the ${code} auto-fix note`);
});

test("the built extension carries English only, and each other language as data", { skip: !built && "no dist/extension (npm run build)" }, () => {
  for (const f of ["ui.js", "runtime.js", "boot.js", "background.js"]) {
    const src = unescape(readFileSync(path.join(DIST, f), "utf8"));
    assert.deepEqual(otherLanguageIn(src), [], `${f} has no other language's words`);
  }
  assert.ok(unescape(readFileSync(path.join(DIST, "background.js"), "utf8")).includes(EN["bg.otherSite"]), "the worker has English");
  for (const code of Object.keys(WORDS)) {
    const file = path.join(DIST, "locales", `${code}.json`);
    assert.ok(existsSync(file), `locales/${code}.json is in the package`);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), WORDS[code], `locales/${code}.json is core/locales/${code}.js`);
  }
  assert.ok(!existsSync(path.join(DIST, "locales", "en.json")), "English is built in");
  assert.ok(!existsSync(path.join(DIST, "core", "locales", "de.js")), "the pages don't carry the catalogs as modules");
  const manifest = JSON.parse(readFileSync(path.join(DIST, "manifest.json"), "utf8"));
  assert.equal(manifest.web_accessible_resources, undefined, "no page can load the words");
});

test("loadLanguage: English until the words are here, never an id; a failed read is tried again", async () => {
  const i18n = await import(`../core/i18n.js?fresh=${Date.now()}`); // a copy with only English
  assert.deepEqual(Object.keys(i18n.CATALOGS), ["en"]);
  assert.equal(i18n.setLanguage("de"), "en", "a language whose words aren't here shows English");
  assert.equal(i18n.t("bar.placeholder"), EN["bar.placeholder"]);
  assert.equal(i18n.t("bar.placeholder", {}, "fa"), EN["bar.placeholder"], "asking for it by name shows English too");
  assert.equal(await i18n.loadLanguage("de-AT"), "en", "no loader: English");
  let reads = 0, fail = true;
  i18n.setLanguageLoader(async code => { reads++; if (fail) throw new Error("offline"); return WORDS[code]; });
  assert.equal(await i18n.loadLanguage("de"), "en", "a failed read: English");
  fail = false;
  const [a, b] = await Promise.all([i18n.loadLanguage("de"), i18n.loadLanguage("de-CH")]);
  assert.deepEqual([a, b, reads], ["de", "de", 2], "tried again, once for both");
  assert.equal(i18n.setLanguage("de"), "de");
  assert.equal(i18n.t("bar.placeholder"), WORDS.de["bar.placeholder"]);
  assert.equal(await i18n.loadLanguage("de"), "de");
  assert.equal(reads, 2, "read once");
  assert.equal(await i18n.loadLanguage("ko"), "en", "a language Morse doesn't have");
  i18n.setLanguageLoader(() => ["not", "words"]);
  assert.equal(await i18n.loadLanguage("fa"), "en", "something that isn't a catalog is refused");
  assert.equal(await readWords("../package"), null, "only Morse's own languages are read");
});

// ---- in Chromium: what the bar shows, read inside its (debug-open) shadow root
const ui = page => page.evaluate(() => {
  const host = document.querySelector("[data-morse-ui]"), r = host.shadowRoot;
  const panel = r.querySelector(".panel");
  return { lang: host.getAttribute("lang"), dir: host.getAttribute("dir"), placeholder: r.querySelector(".in")?.placeholder, hint: r.querySelector(".hint")?.textContent || "", panel: panel && !panel.hidden ? panel.innerText : "" };
});
// Every placeholder the bar showed while it was open, from the first frame
// (the status read fresh each frame: tests/helpers/wait.js readStatus).
const watchBar = () => {
  globalThis.__shown = [];
  const look = () => {
    document.dispatchEvent(new Event("morse:status"));
    const host = document.querySelector("[data-morse-ui]");
    const s = host?.dataset.status && JSON.parse(host.dataset.status);
    const p = host?.shadowRoot?.querySelector(".in")?.placeholder;
    if (s?.open && p && globalThis.__shown.at(-1) !== p) globalThis.__shown.push(p);
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};
async function openBar(page) {
  await pressOpen(page);
  await waitForStatus(page, s => s.open, { what: "the bar open" });
}
// Settings → Language, the way a person picks it.
async function chooseLanguage(page, code) {
  await page.keyboard.press("Control+Comma");
  const select = page.locator(".pane select[data-k=language]");
  await select.waitFor();
  await select.selectOption(code);
  await page.waitForFunction(lang => document.querySelector("[data-morse-ui]").getAttribute("lang") === lang, code);
  await page.keyboard.press("Escape");
}
async function seesPersian(page) {
  await page.waitForFunction(() => document.querySelector("[data-morse-ui]").getAttribute("dir") === "rtl");
  const fa = await ui(page);
  assert.equal(fa.placeholder, WORDS.fa["bar.placeholder"]);
  assert.equal(fa.dir, "rtl", "Persian runs right to left");
  const dir = await page.evaluate(() => getComputedStyle(document.querySelector("[data-morse-ui]").shadowRoot.querySelector(".in")).direction);
  assert.equal(dir, "rtl", "the bar's input too");
}

let ctx, sw, demo, extId;
before(async () => {
  if (noDisplay || !built) return;
  demo = await startDemoServer();
  ctx = await chromium.launchPersistentContext(tempDir("morse-i18n-ext-"), {
    headless: false, timeout: TIMEOUT * 2, viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  await routeDemoOrigins(ctx, demo);
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: TIMEOUT });
  extId = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ welcomed: true, "morse.onboarding": { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } } }));
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close().catch(() => {}); // the welcome page
});
after(async () => { await ctx?.close(); await demo?.close(); });

test("extension: German from the bar's first paint, Persian right to left from Settings, the popup follows", { skip: noDisplay || (!built && "no dist/extension (npm run build)") }, async () => {
  const fetched = [];
  ctx.on("request", r => { if (!/^(chrome-extension:|data:|blob:|https?:\/\/(127\.0\.0\.1|localhost)[:/])/.test(r.url())) fetched.push(r.url()); });
  await sw.evaluate(() => chrome.storage.sync.set({ "morse.settings": { language: "de" } }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  await page.addInitScript(watchBar);
  await page.goto("http://127.0.0.1:8788/demo/sites/byte/");
  await waitForReady(page);
  await openBar(page);
  const de = await ui(page);
  assert.equal(de.lang, "de");
  assert.equal(de.dir, "ltr");
  assert.equal(de.placeholder, WORDS.de["bar.placeholder"]);
  assert.ok(de.hint.includes(text(WORDS.de["bar.hint.pointing"]).split("·")[0].trim()), de.hint);
  await settle(page); // frames ran with the bar open, so the watcher has seen it
  {
    const shown = await page.evaluate(() => globalThis.__shown);
    assert.equal(shown.at(-1), WORDS.de["bar.placeholder"], "the bar ends in German");
    assert.ok(shown.every(p => p === WORDS.de["bar.placeholder"] || p === EN["bar.placeholder"]), `only English or German: ${JSON.stringify(shown)}`);
  }

  await chooseLanguage(page, "fa");
  await seesPersian(page);
  await page.locator(".actions [data-a=mods]").click();
  await page.locator(".panel footer [data-a=import]").waitFor();
  assert.ok((await ui(page)).panel.includes(WORDS.fa["panel.install"]), "the Mods panel in Persian");

  // The popup reads the same setting, and its words from the package.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForFunction(() => document.documentElement.lang === "fa");
  assert.equal(await popup.evaluate(() => document.documentElement.dir), "rtl");
  const shown = await popup.evaluate(() => [...document.querySelectorAll("[data-i18n]")].map(e => [e.dataset.i18n, e.textContent]));
  // (popup.js fills some of them in later with words of its own, in Persian too)
  const fixed = Object.fromEntries(shown);
  for (const id of ["popup.go", "popup.mods", "popup.model"]) assert.equal(fixed[id], WORDS.fa[id], `${id} in Persian`);
  assert.ok(!shown.some(([id, s]) => s === EN[id] && EN[id] !== WORDS.fa[id] || s === id), `nothing English or an id: ${JSON.stringify(shown)}`);
  await popup.close();
  assert.deepEqual(fetched, [], "the words come from the package, nowhere else");
  assert.deepEqual(errors, []);
  await page.close();
  await sw.evaluate(() => chrome.storage.sync.remove("morse.settings"));
});

test("desktop: the connector sends the chosen language's words from core/locales", { skip: noBrowser }, async () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ language: "de" }));
  const site = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>App</title><body><main>Main</main></body>`));
  const sitePort = await listen(site);
  const port = await freePort();
  const browser = await launchBrowser({ args: [`--remote-debugging-port=${port}`] });
  let conn, running;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
    await page.addInitScript(() => localStorage.setItem("morse:debug", "1"));
    await page.addInitScript(watchBar);
    await page.goto(`http://127.0.0.1:${sitePort}/`);
    const { Connector } = await import("../daemon/connector.js");
    conn = new Connector({ port, app: { id: "testapp", name: "Test App" }, settings: { provider: "demo", model: "demo" }, log: () => {} });
    running = conn.run();
    await waitForReady(page);
    await openBar(page);
    const de = await ui(page);
    assert.equal(de.lang, "de");
    assert.equal(de.placeholder, WORDS.de["bar.placeholder"]);
    await settle(page); // frames ran with the bar open, so the watcher has seen it
    {
      const shown = await page.evaluate(() => globalThis.__shown);
      assert.equal(shown.at(-1), WORDS.de["bar.placeholder"], "the bar ends in German");
      assert.ok(shown.every(p => p === WORDS.de["bar.placeholder"] || p === EN["bar.placeholder"]), `only English or German: ${JSON.stringify(shown)}`);
    }
    await chooseLanguage(page, "fa");
    await seesPersian(page);
    await waitFor(() => JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")).language === "fa", { what: "settings.json to say fa" });
  } finally {
    await conn?.stop().catch(() => {});
    await running;
    await browser.close();
    site.close();
  }
});
