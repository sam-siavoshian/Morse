// Soak 3: mods at scale. 50 saved mods on one site (CSS, and JS built on
// morse.watch the way generated mods are: badges, click handlers, an
// observer per element, styles inside matched parts, timers) while the page
// streams content (the Parley chat, a new message every few hundred ms), with
// the desktop connector as the host. Every so often a person opens the bar
// and the Mods panel; each sample records the page and the daemon.
//
//   node demo/soak/mods.js --minutes=30
//   node demo/soak/mods.js --short           (the CI profile)
import { tempDir } from "../../tests/helpers/home.js"; // first: its own MORSE_HOME; temp folders go at exit
import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "../../tests/helpers/browser.js";
import { startDemoServer } from "../../tests/helpers/demo-server.js";
import { pressOpen } from "../../tests/helpers/keys.js";
import { args, sleep, PageProbe, Steps, Run, STREAM, startDaemon, launchApp } from "./lib.js";
import { SITES, quiet, until } from "./loop.js";

// The kinds of code a model writes for a chat app, one per mod (k = 0..49).
export function soakMod(k, host) {
  const kind = k % 5, cls = `soak-${k}`;
  const js = [
    // a badge on every message
    `morse.watch(".msg", el => { el.append(morse.el("span", { class: "${cls}", text: " ·${k}" })); });`,
    // a click handler on every message
    `morse.watch(".msg p", el => { morse.on(el, "click", () => el.classList.toggle("${cls}-on")); });`,
    // an observer per message, until its text is complete
    `morse.watch(".msg p", el => { const mo = new MutationObserver(() => { if (el.textContent.length > 40) { el.dataset.s${k} = "1"; mo.disconnect(); } }); mo.observe(el, { childList: true, characterData: true, subtree: true }); });`,
    // a class on every new message, and a count kept up to date
    `let n = 0; morse.watch(".msg", el => { n++; el.classList.add("${cls}"); }); morse.every(2000, () => { document.documentElement.dataset.soak${k} = String(n); });`,
    // styles inside each message's own part
    `morse.css(".x${k} { outline: 0 }", ".msg"); morse.watch("main header", el => el.classList.add("${cls}"));`,
  ][kind];
  return { morse: 1, id: `soak-mod-${k}`, title: `Soak ${k}`, prompt: `soak mod ${k}`, enabled: true,
    css: `.msg .${cls} { opacity: .${(k % 9) + 1}; } .${cls}-on { outline: 1px dotted #888 }`, js,
    match: { hosts: [host], app: null }, created: new Date(Date.UTC(2026, 0, 1, 0, k)).toISOString() };
}

export async function soakMods(opts = {}) {
  const o = { minutes: 30, mods: 50, sampleSec: 60, actEverySec: 20, every: 300, keep: 40, demoMs: 3, out: "", log: true, ...opts };
  const say = (...a) => o.log && console.log(...a);
  const cleanups = [];
  const run = new Run("mods at scale", o.out || null);
  const steps = new Steps();
  try {
    const home = process.env.MORSE_HOME;
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false }));
    await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true, editTools: true }, dismissed: { model: true, userScripts: true } }));
    const demo = await startDemoServer();
    cleanups.push(() => demo.close());
    const { saveMod } = await import("../../daemon/store.js");
    const host = new URL(demo.origin("parley")).host;
    for (let k = 0; k < o.mods; k++) await saveMod(soakMod(k, host));

    const url = `${demo.origin("parley")}${SITES.parley.path}`;
    const app = await launchApp({ chromium, url, profile: tempDir("morse-soak-mods-") });
    cleanups.push(() => app.close());
    const daemon = await startDaemon();
    cleanups.push(() => daemon.close());
    await app.ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
    const page = app.ctx.pages()[0] || await app.ctx.waitForEvent("page");
    await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await daemon.start({ port: app.port, demoMs: o.demoMs });
    await page.reload();
    await page.waitForFunction(n => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "{}").mods >= n, o.mods, { timeout: 60000 });
    const probe = await PageProbe.forPage(page);
    await page.evaluate(STREAM({ every: o.every, keep: o.keep }));
    run.meta = { ...o };

    // How busy the page is: messages streamed, and how late a 50ms timer fires.
    const pulse = () => page.evaluate(() => new Promise(r => {
      const t0 = performance.now();
      setTimeout(() => r({ lagMs: Math.round(performance.now() - t0 - 50), msgs: document.querySelectorAll(".msg").length, streamed: Number(document.querySelector(".msg:last-child p")?.textContent.match(/#(\d+)/)?.[1] || 0) }), 50);
    }));
    const kitStats = () => page.evaluate(n => {
      // the kit lives in the page's world here (desktop): every mod's own numbers
      let errors = 0, running = 0, paused = 0;
      const why = {};
      for (let k = 0; k < n; k++) {
        const s = globalThis.morse?.__stats?.(`soak-mod-${k}`);
        if (!s) continue;
        if (s.paused) { paused++; why[s.paused.why] = (why[s.paused.why] || 0) + 1; } else running++;
        errors += s.errors || 0;
      }
      return { running, paused, why, errors, badges: document.querySelectorAll("[data-morse]").length };
    }, o.mods);

    const t0 = Date.now(), end = t0 + o.minutes * 60000;
    let i = 0, nextSample = 0, reloads = 0;
    while (Date.now() < end) {
      const it = performance.now();
      steps.ctx = String(i);
      // what a person does now and then: the bar, the Mods panel with 50 rows
      await steps.run("open + close bar", async () => {
        await pressOpen(page);
        await until(page, s => s.open, "the bar");
        await page.keyboard.press("Escape");
        await until(page, s => !s.open, "the bar to close");
      });
      if (i % 3 === 0) await steps.run("mods panel (50)", async () => {
        await pressOpen(page);
        await until(page, s => s.open, "the bar");
        await page.locator("[data-morse-ui] .actions [data-a=mods]").click();
        await page.locator("[data-morse-ui] .panel .list article[data-id]").nth(o.mods - 1).waitFor({ state: "attached", timeout: 15000 });
        await page.locator("[data-morse-ui] .panel header [data-a=close]").click();
      });
      await quiet(page);
      // The page reloaded (the hang guard reloads a page a mod froze): stream again, and count it.
      if (await page.evaluate(() => !window.__soakStream).catch(() => false)) {
        reloads++;
        run.error("page", { kind: "reload", world: "page", text: "the page reloaded (a mod froze it?)" });
        await page.waitForFunction(() => document.querySelector("section.t4l > div"), null, { timeout: 30000 }).catch(() => {});
        await page.evaluate(STREAM({ every: o.every, keep: o.keep })).catch(() => {});
      }
      const p = await pulse().catch(e => ({ error: e.message }));
      run.iter(i, performance.now() - it, p);
      for (const e of probe.takeErrors()) run.error("page", e);
      if (Date.now() >= nextSample) {
        nextSample = Date.now() + o.sampleSec * 1000;
        const s = { reloads, page: await probe.sample().catch(e => ({ error: e.message })), kit: await kitStats().catch(e => ({ error: e.message })), pulse: p };
        const d = await daemon.stats().catch(e => ({ error: e.message }));
        s.daemon = d.stats || { error: d.error };
        run.sample(i, s);
        await run.save(steps); // so far: a run cut short still leaves its numbers
        say(`${Math.round((Date.now() - t0) / 1000)}s #${i} heap ${s.page.heapMB}MB nodes ${s.page.nodes} listeners ${s.page.listeners} mo ${JSON.stringify(Object.fromEntries(Object.entries(s.page.worlds || {}).map(([k, v]) => [k, `${v.mo}/${v.detached}`])))} kit ${JSON.stringify(s.kit)} lag ${p.lagMs}ms streamed ${p.streamed} · daemon rss ${s.daemon.rssMB}MB heap ${s.daemon.heapMB}MB`);
      }
      i++;
      await sleep(o.actEverySec * 1000);
    }
    run.meta.reloads = reloads;
    run.meta.daemonLogs = (await daemon.stats().catch(() => ({}))).lastLogs;
    return await run.save(steps);
  } finally {
    for (const f of cleanups.reverse()) await Promise.resolve().then(f).catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = args({ minutes: 30, mods: 50, sampleSec: 60, actEverySec: 20, every: 300, keep: 40, demoMs: 3, out: "" }, { minutes: 2.5, sampleSec: 15, actEverySec: 5 });
  const r = await soakMods(o);
  console.log(`done: ${r.iterations.length} rounds, ${r.errors.length} errors, fails ${JSON.stringify(r.fails)}`);
  if (r.lastErrors?.length) console.log(r.lastErrors.slice(-10).join("\n"));
  process.exit(0);
}
