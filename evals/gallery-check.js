// Checks a gallery mod on its page, the way evals/run.js checks a fresh
// change: open the page, run the mod the way the hosts do (a style tag, and
// the JS through wrapModCode and the helper kit), run the case's checker
// (real clicks and keys through Playwright), then reload the page, run the
// mod again and check again.
//
// Used by evals/gallery.js (generate and verify, real sites and demo apps)
// and tests/gallery-mods.test.js (the demo-app mods, headless, in CI).
//
// A case (evals/gallery-cases.json):
//   { id, site?: "<demo app>", page?: "", url?: "<real page>", waitFor?: "<selector>",
//     viewport?: [w, h], request, target?, label?, before?, check, setup? }
// `before` runs before the mod and its result is B in `check`; `check` is the
// body of an async function that returns true or why it failed; `setup` runs
// after the page settles, before anything else (dismiss a dialog, scroll).

import { readFileSync } from "node:fs";
import { wrapModCode, settleMs } from "../core/kit.js";
import { stubs, helpers } from "./page-helpers.js";
import { SITE_NAMES } from "../demo/serve.js";

export const SETTLE_MS = 2500;

// The cases, with `from: "<eval case id>"` filled in from evals/cases.json
// (its checker, `before`, `page` and `viewport`; the gallery case's own
// fields win).
export function loadCases() {
  const here = new URL("./", import.meta.url);
  const evals = new Map(JSON.parse(readFileSync(new URL("cases.json", here), "utf8")).cases.map(c => [c.id, c]));
  return JSON.parse(readFileSync(new URL("gallery-cases.json", here), "utf8")).cases.map(c => {
    if (!c.from) return c;
    const e = evals.get(c.from);
    if (!e) throw new Error(`${c.id}: no eval case ${c.from}`);
    const { id, request, split, category, target, ...rest } = e;
    return { target, ...rest, ...c };
  });
}
const lines = x => [].concat(x || []).join("\n");

export function pageUrl(c, demoBase) {
  return c.site ? `${demoBase}/demo/sites/${c.site}/${c.page || ""}` : c.url;
}

// A fresh browser context and page for one case, with the eval stubs
// (clipboard and downloads recorded, confirm answered) and real input.
export async function openPage(browser, c, demoBase) {
  const [w, h] = c.viewport || [1280, 800];
  // bypassCSP: the extension's styles and user scripts aren't bound by the
  // page's own rules, so page.evaluate-added ones shouldn't be either.
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true, bypassCSP: true, ignoreHTTPSErrors: false });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", e => page.__errors.push(e.message));
  page.on("dialog", d => d.type() === "prompt" ? d.accept("15").catch(() => {}) : d.accept().catch(() => {}));
  page.on("download", async d => {
    try {
      const p = await d.path();
      const text = p ? readFileSync(p, "utf8") : "";
      await page.evaluate(t => window.__downloads.push({ text: t }), text);
    } catch {}
  });
  await page.addInitScript(stubs);
  await page.exposeFunction("__evalClick", (x, y) => page.mouse.click(x, y));
  await page.exposeFunction("__evalType", t => page.keyboard.type(t, { delay: 5 }));
  await page.exposeFunction("__evalPress", k => page.keyboard.press(k));
  await page.exposeFunction("__evalMove", (x, y) => page.mouse.move(x, y));
  await page.exposeFunction("__evalDrag", async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8);
    await page.mouse.up();
  });
  await load(page, c, () => page.goto(pageUrl(c, demoBase), { waitUntil: c.site ? "load" : "domcontentloaded", timeout: 90000 }));
  return { ctx, page };
}

async function load(page, c, go) {
  await go();
  if (c.waitFor) await page.locator(c.waitFor).first().waitFor({ state: "attached", timeout: 60000 });
  await page.waitForTimeout(c.settle ?? SETTLE_MS);
  if (c.setup) await page.evaluate(`(async () => { ${lines(c.setup)} })()`);
}

export async function reload(page, c) {
  await load(page, c, () => page.reload({ waitUntil: c.site ? "load" : "domcontentloaded", timeout: 90000 }));
}

// Marks what is on the page now as "original", installs T, runs `before`.
export async function prepare(page, c) {
  await page.evaluate(() => { window.__orig = new WeakSet(window.__roots().flatMap(r => [...r.querySelectorAll("*")])); });
  await page.evaluate(helpers);
  await page.evaluate(more);
  await page.evaluate(() => { window.__pseudo0 = T.pseudoTexts(); });
  return c.before ? page.evaluate(`(async () => { ${lines(c.before)} })()`) : null;
}

// More for T, for the gallery's checkers.
function more() {
  // Wholly inside the viewport, and the top thing at its middle (not covered).
  T.inView = el => {
    if (!T.visible(el)) return false;
    const r = T.rect(el);
    if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) return false;
    const at = document.elementFromPoint(Math.min(innerWidth - 1, r.left + Math.min(r.width / 2, 20)), r.top + r.height / 2);
    return !!at && (el.contains(at) || at.contains(el));
  };
  // A dark mode that looks right: most of the window is dark, and the text
  // that matches `sel` (the first 200 visible in the first screens) is easy
  // to read on it. -> true or why not.
  T.darkPage = (sel, { min = 4.5, share = 0.92 } = {}) => {
    let dark = 0, n = 0;
    for (let x = 0.05; x < 1; x += 0.15) for (let y = 0.05; y < 1; y += 0.15) {
      const e = document.elementFromPoint(innerWidth * x, innerHeight * y);
      if (!e || /^(IMG|SVG|VIDEO|CANVAS|PICTURE)$/i.test(e.tagName)) continue;
      n++;
      if (T.lum(T.bg(e)) < 0.08) dark++;
    }
    if (!n || dark / n < 0.8) return `only ${dark} of ${n} points on the screen are dark`;
    const els = T.$$(sel).filter(e => T.visible(e) && e.textContent.trim() && T.rect(e).top < innerHeight * 2.5).slice(0, 200);
    if (els.length < 5) return `only ${els.length} pieces of text to check`;
    const bad = els.filter(e => T.contrast(e) < min);
    return bad.length <= els.length * (1 - share) || `${bad.length} of ${els.length} are hard to read, e.g. ${bad.slice(0, 3).map(e => `${e.tagName.toLowerCase()} “${e.textContent.trim().slice(0, 24)}” ${T.contrast(e).toFixed(1)}`).join(", ")}`;
  };
}

// The mod on the page, as the hosts run it. -> errors from its code ([] when fine).
export async function applyMod(page, mod, id = mod.id) {
  if (mod.css?.trim()) {
    await page.evaluate(([id, css]) => {
      let s = document.head.querySelector(`style[data-morse-css="${id}"]`);
      if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
      s.textContent = css;
    }, [id, mod.css]);
  }
  if (!mod.js?.trim()) return [];
  let r;
  try { r = await page.evaluate(wrapModCode(id, mod.js)); }
  catch (e) { return [String(e.message || e).split("\n")[0]]; }
  if (!r?.ok) return [r?.error || "the code didn't run"];
  await page.waitForTimeout(settleMs(r));
  return page.evaluate(id => morse.__errors(id), id);
}

export async function runCheck(page, c, B, ms = 20000) {
  const verdict = await Promise.race([
    page.evaluate(`(async () => { const B = ${JSON.stringify(B)}; ${lines(c.check)} })()`),
    new Promise(r => setTimeout(() => r("checker timed out"), ms)),
  ]).catch(e => "checker threw: " + String(e.message || e).split("\n")[0]);
  return verdict === true ? true : String(verdict);
}

// The whole check for a saved mod: without it the checker fails, with it the
// checker passes, and after a reload (the mod run again, as on every page
// load) it passes again. -> { pass, before, first, reload, errors }
export async function verifyMod(browser, c, mod, demoBase, { shots } = {}) {
  const { ctx, page } = await openPage(browser, c, demoBase);
  const out = { id: c.id };
  try {
    let B = await prepare(page, c);
    if (shots?.before) { await shots.before(page); await page.evaluate(() => scrollTo(0, 0)); } // checkers start at the top
    out.before = c.noBaseline ? "skipped" : await runCheck(page, c, B, 8000);
    // The baseline must fail, or the checker proves nothing. A checker can
    // click or type, so start again from a fresh page.
    if (out.before === true) { out.pass = false; out.why = "the checker passes without the mod"; return out; }
    await reload(page, c);
    B = await prepare(page, c);
    out.errors = await applyMod(page, mod);
    await page.waitForTimeout(300);
    if (shots?.after) { await shots.after(page); await page.evaluate(() => scrollTo(0, 0)); }
    out.first = await runCheck(page, c, B);
    await reload(page, c);
    B = await prepare(page, c);
    const again = await applyMod(page, mod);
    out.errors.push(...again);
    await page.waitForTimeout(300);
    out.reload = await runCheck(page, c, B);
    out.pass = out.first === true && out.reload === true && !out.errors.length;
    if (!out.pass) out.why = out.errors[0] || (out.first !== true ? out.first : "after a reload: " + out.reload);
  } catch (e) {
    out.pass = false;
    out.why = "error: " + String(e.message || e).split("\n")[0];
  } finally {
    if (page.__errors.length) out.pageErrors = page.__errors.slice(0, 3);
    await ctx.close();
  }
  return out;
}

// Where each demo app runs with `node demo/serve.js` (demo/serve.js
// SITE_NAMES, from 8787): a demo mod matches exactly that address.
export const DEMO_PORTS = Object.fromEntries(SITE_NAMES.map((site, i) => [site, 8787 + i]));
export const hostFor = c => (c.site ? `127.0.0.1:${DEMO_PORTS[c.site]}` : new URL(c.url).host);
