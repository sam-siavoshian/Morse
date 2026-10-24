// The docs' pictures of Morse's features, taken on real public websites with
// a real model (Claude Code, sonnet unless MORSE_MODEL says otherwise; never
// haiku), so no picture shows a demo app. Chromium is driven like a person
// (Playwright: the shortcut, pointing, typing, Enter) and Morse is the real
// runtime, attached over the debugging port by the desktop connector, the
// way `morse attach` connects to a Chromium browser. Its settings, mods and
// first-run state live in a scratch MORSE_HOME, not in ~/.morse.
//
//   DISPLAY=:99 node demo/shoot-real.js [outDir]     (default docs/screenshots)
//     ONLY=nodejs,tools    only some scenes: nodejs, tools, docker, explain, rubygems, gitlab
//     PROXY=http://…       the proxy Chromium uses (default: $HTTPS_PROXY)
//
// A real model writes different code each time: look at every picture, and
// retake a scene with ONLY=… until it reads well. Each scene prints what was
// asked, the title the model gave it and how long it took, for the captions.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createRequire } from "node:module";
import { openBar, pick, seasonHome } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.argv[2] || process.env.SHOTS || path.join("docs", "screenshots"));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const MODEL = process.env.MORSE_MODEL || "sonnet";
if (/haiku/i.test(MODEL)) throw new Error("These pictures are taken with a strong model: sonnet or opus.");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(`· ${s}`);

const home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-real-shots-"));
process.env.MORSE_HOME = home;
await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
await seasonHome(home);
const { Connector } = await import("../daemon/connector.js");

const port = await new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const proxy = process.env.PROXY || process.env.HTTPS_PROXY;
const browser = await chromium.launch({ headless: false, args: [`--remote-debugging-port=${port}`, "--no-sandbox", ...(proxy ? [`--proxy-server=${proxy}`] : [])] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
new Connector({ port, app: null, settings: { provider: "claude-code", model: MODEL }, log: () => {} }).run();
await fs.mkdir(OUT, { recursive: true });

const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")).catch(() => null);
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(120); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}
const ui = (page, sel) => page.locator(`[data-morse-ui] ${sel}`);
const shot = async (page, name) => { await sleep(250); await page.screenshot({ path: path.join(OUT, name) }); say(`📸 ${name}`); };
async function open(url, tidy) {
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  ! pageerror", e.message.split("\n")[0]));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await until(() => status(page), 45000, "Morse in the page");
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  if (tidy) await page.evaluate(tidy).catch(() => {});
  await sleep(300);
  return page;
}
async function describe(page, text, point) {
  await openBar(page);
  await sleep(300);
  if (point) await pick(page, point.sel, point.fx ?? 0.5, point.fy ?? 0.5);
  else await page.mouse.move(160, 120, { steps: 4 });
  await until(async () => (await status(page))?.focus === "in", 10000, "the bar's text box");
  await page.keyboard.type(text, { delay: 8 });
  await until(async () => (await status(page))?.input === text, 10000, "the request in the bar");
}
async function result(page) {
  const s = await until(async () => {
    const s = await status(page);
    if (s?.phase === "idle" && /^Answered/.test(s.hint)) return { ...s, phase: "error", hint: "the model answered instead of making a change" };
    return ["result", "error"].includes(s?.phase) && s;
  }, 240000, "a result");
  if (s.phase === "error") throw new Error(s.hint);
  return s;
}
const answered = page => until(async () => { const s = await status(page); return s?.phase === "idle" && /Answered/.test(s.hint) && s; }, 240000, "an answer");
const want = name => !ONLY || ONLY.has(name);
const timed = async (ask, fn) => { const t0 = Date.now(); const r = await fn(); say(`“${ask}” → ${r?.hint || ""} in ${((Date.now() - t0) / 1000).toFixed(1)} s (Claude Code · ${MODEL})`); return r; };

try {
  // ---- nodejs.org: point, the change while it is written, the result, a
  // follow-up, then the Mods panel, its versions, its code and Share.
  if (want("nodejs")) {
    const page = await open("https://nodejs.org/api/path.html");
    const ask = "make this page look like a printed book: cream paper, a serif font for the text, and the code examples in dark boxes";
    await describe(page, ask);
    await shot(page, "300-real-point.png");
    const t0 = Date.now();
    await page.keyboard.press("Enter");
    // The moment the style is on the page while the model is still writing.
    const caught = await until(async () => {
      const s = await status(page);
      if (s?.phase === "result" || s?.phase === "error") return "late";
      const live = await page.evaluate(() => [...document.querySelectorAll("style[data-morse-css]")].reduce((n, st) => n + (st.sheet?.cssRules?.length || 0), 0)).catch(() => 0);
      return live >= 2 && s?.ticker?.length > 40 ? "now" : null;
    }, 240000, "the change to start showing");
    if (caught === "now") await shot(page, "301-real-working.png");
    else say("the change was done before the picture: 301 not taken");
    const r = await result(page);
    say(`“${ask}” → ${r.hint} in ${((Date.now() - t0) / 1000).toFixed(1)} s (Claude Code · ${MODEL})`);
    await page.mouse.move(900, 300);
    await shot(page, "302-real-result.png");
    // A follow-up under the result.
    const more = "now make the headings dark red";
    await page.keyboard.type(more, { delay: 8 });
    await sleep(300);
    await shot(page, "303-real-refine.png");
    await timed(more, async () => { await page.keyboard.press("Enter"); return until(async () => { const s = await status(page); return s?.phase === "result" && /version 2/.test(s.hint) && s; }, 240000, "version 2"); });
    await page.keyboard.press("Enter"); // Save
    await sleep(800);
    await page.keyboard.press("Escape");
    await sleep(400);
    // The Mods panel, with the mod's versions.
    await page.keyboard.press("Alt+Shift+KeyM");
    await ui(page, ".panel article").first().waitFor({ timeout: 15000 });
    await sleep(500);
    await page.mouse.move(900, 400);
    await shot(page, "304-real-mods-panel.png");
    await ui(page, ".panel [data-a=history]").first().click();
    await sleep(300);
    await ui(page, ".panel .versions button").first().hover();
    await sleep(400);
    await shot(page, "305-real-history.png");
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.keyboard.press("Alt+Shift+KeyM");
    await ui(page, ".panel article").first().waitFor({ timeout: 15000 });
    await ui(page, ".panel [data-a=code]").first().click();
    await ui(page, ".modal").first().waitFor({ timeout: 10000 });
    await sleep(600);
    await shot(page, "306-real-edit-code.png");
    await page.keyboard.press("Escape");
    await sleep(400);
    if (!(await ui(page, ".panel").count())) await page.keyboard.press("Alt+Shift+KeyM");
    await ui(page, ".panel [data-a=share]").first().click();
    await ui(page, ".modal").first().waitFor({ timeout: 15000 });
    await sleep(1500);
    await shot(page, "307-real-share.png");
    await page.close();
  }

  // ---- Page tools: dark mode on hub.docker.com; Easier to use and Check
  // this page on pkg.go.dev. No model. (Dark mode on pkg.go.dev was paused by
  // Morse's slowness guard in October 2026, so it is shown on Docker Hub.)
  if (want("tools")) {
    const page = await open("https://hub.docker.com/_/nginx");
    await openBar(page);
    await sleep(300);
    await ui(page, ".gm-qbtn").click();
    await sleep(200);
    await ui(page, ".gm-menu button[data-k=dark]").click();
    await sleep(1200);
    await ui(page, ".gm-qbtn").click();
    await sleep(300);
    await ui(page, ".gm-menu button[data-k=dark]").hover();
    await sleep(500);
    await shot(page, "308-real-dark-mode.png");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.close();
    const tidy = () => { document.querySelector(".js-surveyBannerClose")?.click(); [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Okay")?.click(); };
    const p2 = await open("https://pkg.go.dev/net/http", tidy);
    const tools = async () => {
      if (!(await status(p2))?.open) await openBar(p2);
      await ui(p2, ".gm-qbtn").click();
      await ui(p2, ".gm-menu .a11y-group").waitFor();
    };
    for (const k of ["readable", "contrast", "underline"]) {
      await tools();
      await ui(p2, `.gm-menu [data-a11y="${k}"]`).click();
      await sleep(400);
    }
    await tools();
    await ui(p2, '.gm-menu [data-a11y="targets"]').hover();
    await sleep(2500);
    await shot(p2, "309-real-easier-to-use.png");
    await ui(p2, '.gm-menu [data-a11y="check"]').click();
    await ui(p2, ".au-list").waitFor({ timeout: 30000 });
    await ui(p2, ".au-item").first().locator(".au-fix").hover().catch(() => {});
    await sleep(800);
    await shot(p2, "310-real-check-page.png");
    await p2.close();
  }

  // ---- hub.docker.com: ask what something does, find a setting, explain the page.
  if (want("docker")) {
    const page = await open("https://hub.docker.com/_/nginx");
    const q1 = "what does this tab show?";
    await describe(page, q1, { sel: 'a[href*="tags"], [role=tab]:has-text("Tags")', fx: 0.5, fy: 0.5 });
    await timed(q1, async () => { await page.keyboard.press("Enter"); return answered(page); });
    await page.mouse.move(1100, 650);
    await sleep(1000);
    await shot(page, "311-real-ask.png");
    await page.keyboard.press("Escape");
    await page.close();
    const p2 = await open("https://hub.docker.com/_/nginx");
    const q2 = "where can I see which versions of this image there are?";
    await describe(p2, q2);
    await timed(q2, async () => { await p2.keyboard.press("Enter"); return answered(p2); });
    await sleep(1000);
    await shot(p2, "312-real-find.png");
    await p2.keyboard.press("Escape");
    await p2.close();
  }
  if (want("explain")) {
    const p3 = await open("https://hub.docker.com/_/nginx");
    await openBar(p3);
    await sleep(300);
    await p3.mouse.move(1000, 120);
    await ui(p3, ".gm-qbtn").click();
    await sleep(200);
    await timed("Explain this page", async () => { await ui(p3, ".gm-menu [data-ask=explain]").click(); return answered(p3); });
    await p3.mouse.move(1180, 90);
    await sleep(1000);
    await shot(p3, "313-real-explain.png");
    await p3.close();
  }

  // ---- rubygems.org: the Edit tools, no model.
  if (want("rubygems")) {
    const page = await open("https://rubygems.org/gems/rails");
    const edit = () => page.keyboard.press(process.platform === "darwin" ? "Meta+KeyE" : "Control+KeyE");
    await openBar(page);
    await sleep(300);
    await pick(page, 'h1:has-text("rails")', 0.5, 0.5);
    await edit();
    await sleep(500);
    await ui(page, ".gm-tb button[data-t=move]").hover();
    await sleep(500);
    await shot(page, "314-real-edit-tools.png");
    await page.keyboard.press("t");
    await sleep(300);
    await page.keyboard.press("Control+KeyA");
    await page.keyboard.type("Ruby on Rails", { delay: 20 });
    await sleep(500);
    await shot(page, "315-real-rename.png");
    await page.keyboard.press("Enter");
    await sleep(400);
    await page.keyboard.press("c");
    await sleep(300);
    await ui(page, ".gm-sw button[data-c='#ef4444']").click();
    await sleep(200);
    await ui(page, ".gm-sw button[data-c='#ef4444']").hover();
    await sleep(600);
    await shot(page, "316-real-recolor.png");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.close();
  }

  // ---- gitlab.com: Settings, the shortcuts, Stop, the off switch, no change kept.
  if (want("gitlab")) {
    const page = await open("https://gitlab.com/gitlab-org/gitlab");
    await openBar(page);
    await sleep(300);
    await page.keyboard.press("Control+Comma");
    await page.mouse.move(640, 500);
    await sleep(600);
    await shot(page, "317-real-settings.png");
    await page.keyboard.press("Escape");
    await sleep(300);
    await openBar(page);
    await page.keyboard.type("?");
    await sleep(600);
    await shot(page, "318-real-shortcuts.png");
    await page.keyboard.press("Escape");
    await sleep(300);
    // Stop while the model is writing: nothing is changed, the words stay.
    const ask = "make the file list look like a terminal: green text on black, monospace everywhere in it";
    await describe(page, ask, { sel: "main", fx: 0.5, fy: 0.6 });
    await page.keyboard.press("Enter");
    await until(async () => (await status(page))?.ticker?.length > 20, 120000, "the model to start writing");
    await sleep(800);
    await page.keyboard.press("Escape");
    await until(async () => { const s = await status(page); return s?.phase === "idle" && /Stopped/.test(s.hint); }, 20000, "Stopped");
    await sleep(400);
    await shot(page, "319-real-cancelled.png");
    await page.close();
  }
} finally {
  await browser.close().catch(() => {});
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
