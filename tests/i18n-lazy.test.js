// Language catalogs load on demand; the runtime carries English only.
// Desktop integration checks German on first paint and switching to Persian.
import { home } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { LANGUAGES, CATALOGS, loadLanguage } from "../core/i18n.js";
import { readWords } from "../core/languages.js";
import { bundleBoot, bundleUI } from "../runtime/bundle.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { freePort, listen } from "./helpers/net.js";
import { waitFor, waitForStatus, waitForReady, settle } from "./helpers/wait.js";
import { pressOpen } from "./helpers/keys.js";

const EN = CATALOGS.en;
const WORDS = Object.fromEntries(await Promise.all(LANGUAGES.filter(l => l.code !== "en").map(async l => [l.code, await readWords(l.code)])));
await Promise.all(LANGUAGES.map(l => loadLanguage(l.code)));

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
