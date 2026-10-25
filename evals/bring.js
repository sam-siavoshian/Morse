// Take this, Bring here, for real: each case takes a feature in one real app
// or site and brings it into another, through the built Chrome extension
// paired with the Morse helper (and, for a desktop app, `morse launch`, with
// the same ~/.morse so both see one list), with a real model. Then two checks:
//
//   works       the feature opens and responds there (the case's own check,
//               after real keys and clicks)
//   design fit  what Morse added looks like it belongs: its fonts are the
//               page's fonts, its colors are near colors the page already
//               uses, its corners are corners the page already has
//
//   node scripts/build.js
//   DISPLAY=:99 MORSE_PROVIDER=claude-code node evals/bring.js [--only id] [--cases file]
//     MORSE_MODEL=opus       one model for everything (default: Automatic, sonnet then opus)
//     SHOTS=dir              pictures of each step (<id>-1-source … <id>-6-working)
//     PROXY=http://…         the proxy Chromium uses (default: $HTTPS_PROXY)
//
// Prints one JSON line per case and a summary; writes evals/results/bring-<time>.json.
// cases: evals/bring-cases.json. A case:
//   from  { url, point? } or { app, window, open } : where to take it, and how (point at it, or
//         open it while Morse watches: actions, then Stop)
//   to    { url, open, use, opened, works }: open = actions that show the feature, opened = JS
//         (true once it shows), use = actions that use it, works = JS (true when it worked);
//         B is what the page was before `use` ({ url, scrollY }), T the helpers below
// Actions: { press }, { type }, { wait }, { click: selector }, { clickFresh: selector } (what Morse
// added), { pressOrClick: keys } (the keys; if nothing opens, the button Morse added for it)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startHelper, pairExtension, seasonExtension, seasonHome, pick } from "../demo/helper.js";
import { freePort } from "../tests/helpers/net.js";

const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const cases = JSON.parse(await fs.readFile(arg("--cases") || path.join(root, "evals/bring-cases.json"), "utf8")).filter(c => !arg("--only") || arg("--only").split(",").includes(c.id));
const OUT = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
const T_MODEL = 420000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(`· ${s}`);
if (OUT) await fs.mkdir(OUT, { recursive: true });

// ---- helpers the checks use, in the page (T)
const HELPERS = `(() => {
  const visible = e => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); return cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05; };
  const fresh = () => [...document.querySelectorAll("[data-morse]")].flatMap(e => [e, ...e.querySelectorAll("*")]);
  const lum = c => { const m = String(c).match(/\\d+(\\.\\d+)?/g); if (!m) return 1; const [r, g, b] = m.map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const inverted = () => /invert\\((0\\.[5-9]|1)/.test(getComputedStyle(document.documentElement).filter);
  const pageBg = () => { for (const e of [document.body, document.documentElement]) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)") return c; } return "rgb(255, 255, 255)"; };
  const dark = () => { const at = document.elementFromPoint(innerWidth / 2, innerHeight * 0.7); let n = at, c = ""; while (n && n.nodeType === 1) { c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)") break; n = n.parentElement; } const l = lum(c || pageBg()); return inverted() ? l > 0.6 : l < 0.35; };
  return { visible, fresh, dark, lum };
})()`;

// Design fit: what Morse added (visible), against what the page already uses.
const FIT = `(() => {
  const T = ${HELPERS};
  const ours = T.fresh().filter(e => T.visible(e) && !e.closest("[data-morse-ui]"));
  if (!ours.length) return { ok: false, why: "nothing Morse added is showing" };
  const page = [...document.querySelectorAll("body *")].filter(e => !e.closest("[data-morse],[data-morse-ui]") && T.visible(e)).slice(0, 1500);
  const fam = e => getComputedStyle(e).fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
  const rgb = c => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(",").map(Number); return p.length > 3 && p[3] < 0.05 ? null : p.slice(0, 3); };
  const near = (a, list) => list.some(b => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 48);
  const texty = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || e.matches("input, textarea, button");
  const fonts = new Set(page.filter(texty).map(fam).concat(fam(document.body)));
  const colors = [], radii = new Set([0]);
  for (const e of page) {
    const cs = getComputedStyle(e);
    for (const c of [cs.color, cs.backgroundColor, parseFloat(cs.borderTopWidth) ? cs.borderTopColor : ""]) { const v = rgb(c); if (v) colors.push(v); }
    radii.add(Math.round(parseFloat(cs.borderTopLeftRadius) || 0));
  }
  for (const e of [document.body, document.documentElement]) { const v = rgb(getComputedStyle(e).backgroundColor); if (v) colors.push(v); }
  const f = { yes: 0, n: 0, off: [] }, c = { yes: 0, n: 0, off: [] }, r = { yes: 0, n: 0, off: [] };
  for (const e of ours) {
    const cs = getComputedStyle(e);
    if (texty(e)) { f.n++; if (fonts.has(fam(e))) f.yes++; else f.off.push(fam(e)); }
    for (const [k, v] of [["text", cs.color], ["background", cs.backgroundColor], ["border", parseFloat(cs.borderTopWidth) ? cs.borderTopColor : ""]]) {
      const x = rgb(v); if (!x) continue; if (k === "text" && !texty(e)) continue;
      c.n++; if (near(x, colors)) c.yes++; else c.off.push(k + " " + v);
    }
    const rad = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
    if (rad && rad < 999 && rad < Math.min(e.offsetWidth, e.offsetHeight) / 2) { r.n++; if ([...radii].some(x => Math.abs(x - rad) <= 2)) r.yes++; else r.off.push(rad + "px"); }
  }
  const part = x => (x.n ? x.yes / x.n : 1);
  const score = (part(f) + part(c) + part(r)) / 3;
  return { ok: part(f) >= 0.8 && score >= 0.75, score: +score.toFixed(2), fonts: +part(f).toFixed(2), colors: +part(c).toFixed(2), corners: +part(r).toFixed(2),
    off: [...new Set([...f.off.map(x => "font " + x), ...c.off, ...r.off.map(x => "corner " + x)])].slice(0, 8), pageFonts: [...fonts].slice(0, 6) };
})()`;

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(200); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}
const statusOf = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")).catch(() => null);
async function act(page, a) {
  if (a.wait) return sleep(a.wait);
  if (a.press) return page.keyboard.press(a.press);
  if (a.type) return page.keyboard.type(a.type, { delay: 60 });
  if (a.click) return page.locator(a.click).first().click();
  if (a.clickFresh) {
    const h = await page.evaluateHandle(([H, sel]) => eval(H).fresh().find(e => e.matches(sel) && eval(H).visible(e)), [HELPERS, a.clickFresh]);
    const el = h.asElement();
    if (!el) throw new Error(`nothing Morse added matches ${a.clickFresh}`);
    return el.click();
  }
  if (a.pressOrClick) {
    await page.keyboard.press(a.pressOrClick);
    await sleep(900);
    const opened = await page.evaluate(H => eval(H).fresh().some(e => e.matches("input, [role=dialog], dialog") && eval(H).visible(e)), HELPERS);
    if (opened) return;
    say(`  ${a.pressOrClick} opened nothing; using the button Morse added`);
    const h = await page.evaluateHandle(H => eval(H).fresh().find(e => e.matches("button, [role=button]") && eval(H).visible(e)), HELPERS);
    if (!h.asElement()) throw new Error(`${a.pressOrClick} opened nothing, and Morse added no button`);
    return h.asElement().click();
  }
}

// ---- Chrome with the extension, paired with a helper that runs the real model
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-bring-"));
const HOME = path.join(tmp, "home");
await seasonHome(HOME);
const helper = await startHelper(HOME);
const EXT = path.join(root, "dist", "extension");
const proxy = process.env.PROXY || process.env.HTTPS_PROXY;
const ctx = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
  headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", ...(proxy ? [`--proxy-server=${proxy}`] : [])],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];
await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), helper.port);
await seasonExtension(sw, { gallery: false });
const setup = await ctx.newPage();
await setup.goto(`chrome://extensions/?id=${extId}`);
await setup.locator("#allow-user-scripts").click();
await sleep(500);
for (const p of ctx.pages()) if (p !== setup && /options|welcome/.test(p.url())) await p.close().catch(() => {});
await pairExtension(ctx, extId, helper.code);
await setup.close();
say(`extension ${extId} paired with the Morse helper (${process.env.MORSE_PROVIDER || "demo"} ${process.env.MORSE_MODEL || "Automatic"})`);

async function openWeb(url) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
  await page.reload({ waitUntil: "load", timeout: 90000 }).catch(() => {});
  await until(() => statusOf(page), 30000, "Morse in the page");
  await sleep(2500);
  return page;
}
async function openMorse(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(OPEN_KEY);
    try { return await until(async () => (await statusOf(page))?.open, 4000, "the bar"); } catch {}
  }
  throw new Error("the bar didn't open");
}
let shotN = 0;
const snap = async (page, id, name) => { if (!OUT || !page) return; const f = path.join(OUT, `${id}-${++shotN}-${name}.png`); await page.screenshot({ path: f }).catch(e => say("shot failed: " + e.message)); say(`  shot ${f}`); };
const takenFile = path.join(HOME, "taken.json");
const takenNow = async () => { try { return JSON.parse(await fs.readFile(takenFile, "utf8")); } catch { return []; } };

// ---- take in a desktop app: `morse launch`, driven over its debugging port
async function takeInApp(c) {
  const env = { ...process.env, MORSE_HOME: HOME, MORSE_DEBUG: "1", FORCE_COLOR: "0" };
  const appArgs = ["--no-sandbox", `--user-data-dir=${path.join(tmp, "app-profile")}`, "--disable-workspace-trust"];
  // A debugging port (not the private pipe Morse uses by default), so this script can drive the app too.
  const appPort = await freePort();
  const m = spawn(process.execPath, [path.join(root, "daemon/cli.js"), "launch", c.from.app, "--port", String(appPort), ...(process.env.MORSE_MODEL ? ["--model", process.env.MORSE_MODEL] : []), "--", ...appArgs], { env });
  let out = "";
  m.stdout.on("data", d => { out += d; }); m.stderr.on("data", d => { out += d; });
  try {
    await until(() => /✓ connected to/i.test(out) || m.exitCode != null, 120000, "morse launch to connect");
    if (m.exitCode != null) throw new Error("morse launch ended: " + out.slice(-400));
    const port = appPort;
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await until(() => browser.contexts().flatMap(x => x.pages()).find(p => p.url().includes(c.from.window || "")), 60000, "the app's window");
    await page.setViewportSize?.({ width: 1280, height: 800 }).catch(() => {});
    await until(() => statusOf(page), 90000, "Morse in the app");
    await sleep(4000);
    const before = (await takenNow()).length;
    // Take this, with the keyboard (Morse's own panel is closed to scripts here): Tab to the suggestions, then along them.
    const onTake = async () => /tk-take/.test((await statusOf(page))?.focus || "");
    for (let tries = 0; tries < 4 && !(await onTake()); tries++) {
      if ((await statusOf(page))?.open) { await page.keyboard.press("Escape"); await sleep(400); }
      await page.mouse.click(640, 400);
      await openMorse(page);
      await sleep(800); // the suggestions show once the bar has settled
      await page.keyboard.press("Tab");
      for (let i = 0; i < 12 && !(await onTake()); i++) { await page.keyboard.press("ArrowRight"); await sleep(80); }
    }
    if (!(await onTake())) throw new Error("couldn't reach Take this");
    await page.keyboard.press("Enter");
    await until(async () => !(await statusOf(page))?.open, 5000, "the bar to step aside");
    for (const a of c.from.open || []) await act(page, a);
    await snap(page, c.id, "source");
    await page.keyboard.press(OPEN_KEY); // the Morse shortcut is Stop too
    const item = await until(async () => (await takenNow()).length > before && (await takenNow())[0].about && (await takenNow())[0], T_MODEL, "the model to name what was taken");
    await sleep(1500);
    await snap(page, c.id, "taken");
    return item;
  } finally {
    // Quit the app it opened (a CDP connection's close only disconnects), then Morse.
    const port = appPort;
    if (port) {
      try { await (await (await chromium.connectOverCDP(`http://127.0.0.1:${port}`)).newBrowserCDPSession()).send("Browser.close"); } catch {}
    }
    m.kill();
    spawn(process.execPath, [path.join(root, "daemon/cli.js"), "stop"], { env, stdio: "ignore" });
  }
}

async function takeOnWeb(c) {
  const page = await openWeb(c.from.url);
  try {
    await openMorse(page);
    if (c.from.point) await pick(page, c.from.point);
    await page.locator(".sugs .tk-take").click();
    if (!c.from.point) {
      await until(async () => !(await statusOf(page))?.open, 5000, "the bar to step aside");
      for (const a of c.from.open || []) await act(page, a);
      await snap(page, c.id, "source");
      await page.keyboard.press(OPEN_KEY); // the Morse shortcut is Stop too (a page's open dialog can keep the strip from being clicked)
    }
    await until(async () => /\S/.test(await page.locator(".tk-card .tk-about:not(.busy)").innerText().catch(() => "")), T_MODEL, "the model to name what was taken");
    if (c.from.point) await snap(page, c.id, "source");
    // What was opened may still be in front of the bar (a page's own dialog): close it, as a person would.
    if (await page.evaluate(() => !!document.querySelector("dialog[open]")).catch(() => false)) { await page.keyboard.press("Escape"); await sleep(500); }
    await snap(page, c.id, "taken");
  } finally { await page.close(); }
}

// ---- bring it into a website
async function bringOnWeb(c, name, result) {
  const shot = n => snap(page, c.id, n);
  const page = await openWeb(c.to.url);
  try {
    await shot("before");
    await openMorse(page);
    if (c.to.point) await pick(page, c.to.point);
    await page.locator(".sugs .tk-bring").click();
    await page.locator(".tk-pick .tk-it", { hasText: name }).first().click();
    result.request = (await statusOf(page)).input;
    const t0 = Date.now();
    await page.keyboard.press("Enter");
    const res = await until(async () => { const s = await statusOf(page); return ["result", "error"].includes(s?.phase) && s; }, T_MODEL, "a result");
    result.ms = Date.now() - t0;
    result.model = res.hint;
    if (res.phase === "error") throw new Error("the change failed: " + res.hint);
    await sleep(1200);
    await shot("result");
    await page.keyboard.press("Enter"); // Save
    await until(async () => (await statusOf(page))?.mods > 0, 20000, "the mod to be saved");
    await page.keyboard.press("Escape");
    await sleep(800);
    result.mod = await sw.evaluate(async () => { const m = Object.values((await chrome.storage.local.get("mods")).mods || {}).sort((a, b) => String(b.created).localeCompare(String(a.created)))[0]; return m && { title: m.title, from: m.from, css: m.css, js: m.js }; });
    await page.evaluate(() => scrollTo(0, 0));
    for (const a of c.to.open || []) await act(page, a);
    result.opened = !!(await page.evaluate(([H, js]) => { const T = eval(H); return eval(js); }, [HELPERS, c.to.opened]).catch(e => (say("opened check threw: " + e.message), false)));
    result.fit = await page.evaluate(FIT);
    await shot("working");
    const B = await page.evaluate(() => ({ url: location.href, scrollY }));
    for (const a of c.to.use || []) await act(page, a);
    if (!c.to.open?.length) await page.evaluate(() => scrollTo(0, 0)); // a switch: the same view as before, for the picture
    // Choosing something may go to another page: that is it working (the checks count a new address as working).
    result.works = !!(await page.evaluate(([H, js, B]) => { const T = eval(H); return eval(js); }, [HELPERS, c.to.works, B])
      .catch(e => (/destroyed|navigat/i.test(e.message) && /B\.url/.test(c.to.works) && page.url() !== B.url ? (result.navigated = page.url(), true) : (say("works check threw: " + e.message), false))));
    if (result.navigated) await page.waitForLoadState("load").catch(() => {});
    await shot("used");
    result.code = await page.evaluate(() => [...document.querySelectorAll("style[data-morse-css]")].map(s => s.textContent.length));
  } finally { await page.close(); }
}

const results = [];
for (const c of cases) {
  const result = { id: c.id, what: c.what };
  const t0 = Date.now();
  try {
    let name;
    if (c.from.app) {
      const item = await takeInApp(c);
      name = item.name;
      result.taken = { name: item.name, about: item.about, from: item.from, steps: item.steps.length };
    } else {
      await takeOnWeb(c);
      const item = (await takenNow())[0];
      name = item.name;
      result.taken = { name: item.name, about: item.about, from: item.from, steps: item.steps.length };
    }
    say(`${c.id}: took “${name}” (${result.taken.from.app}): ${String(result.taken.about).split("\n")[0]}`);
    await bringOnWeb(c, name, result);
    result.ok = result.opened && result.works && result.fit?.ok;
  } catch (e) {
    result.ok = false;
    result.error = e.message.split("\n")[0];
  }
  result.totalMs = Date.now() - t0;
  say(`${c.id}: ${result.ok ? "PASS" : "FAIL"} · opened ${result.opened} · works ${result.works} · fit ${JSON.stringify(result.fit)}${result.error ? " · " + result.error : ""}`);
  console.log(JSON.stringify(result));
  results.push(result);
}
const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} cases passed (works and design fit)`);
await fs.mkdir(path.join(root, "evals/results"), { recursive: true });
await fs.writeFile(path.join(root, "evals/results", `bring-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ model: `${process.env.MORSE_PROVIDER || "demo"} ${process.env.MORSE_MODEL || "Automatic"}`, results }, null, 2));
await ctx.close();
helper.stop();
await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
process.exit(0);
