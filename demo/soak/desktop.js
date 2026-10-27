// Soak 2: the desktop connector attached to a demo "app" (plain Chromium with
// --app, like tests/desktop.test.js) running the same loop as the extension,
// plus what desktop apps do: windows opening and closing, reloads, a renderer
// crash (Page.crash) and `morse stop` / attach cycles. The connector runs in a
// process of its own (daemon-child.js), so its RSS and CDP sessions are its own.
//
//   DISPLAY=:99 node demo/soak/desktop.js --iterations=500 --minutes=60
//   node demo/soak/desktop.js --short          (the CI profile; headless without a display)
import { tempDir } from "../../tests/helpers/home.js"; // first: its own MORSE_HOME; temp folders go at exit
import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "../../tests/helpers/browser.js";
import { startDemoServer } from "../../tests/helpers/demo-server.js";
import { args, sleep, BrowserCDP, PageProbe, Steps, Run, galleryServer, startDaemon, launchApp } from "./lib.js";
import { SITES, iteration, quiet, until } from "./loop.js";

async function waitTarget(raw, url, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const t = (await raw.send("Target.getTargets")).targetInfos.find(x => x.type === "page" && x.url === url);
    if (t) return t;
    if (Date.now() > end) throw new Error(`no window at ${url}`);
    await sleep(100);
  }
}
async function waitIn(raw, sessionId, expression, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await raw.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId, 3000).catch(() => null);
    if (r?.result?.value) return r.result.value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}
const ready = page => page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "{}").ready, null, { timeout: 30000 });

export async function soakDesktop(opts = {}) {
  const o = { iterations: 500, minutes: 60, sampleEvery: 10, popupEvery: 4, crashEvery: 8, reloadEvery: 6, cycleEvery: 25, demoMs: 3, out: "", log: true, ...opts };
  const say = (...a) => o.log && console.log(...a);
  const cleanups = [];
  const run = new Run("desktop", o.out || null);
  const steps = new Steps();
  try {
    const home = process.env.MORSE_HOME;
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false }));
    await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true, editTools: true }, dismissed: { model: true } }));
    const demo = await startDemoServer();
    cleanups.push(() => demo.close());
    const gallery = await galleryServer(demo.sites);
    cleanups.push(() => gallery.close());
    process.env.MORSE_GALLERY_URL = gallery.url; // the daemon child inherits it

    const app = await launchApp({ chromium, url: `${demo.origin("tunes")}${SITES.tunes.path}`, profile: tempDir("morse-soak-app-") });
    cleanups.push(() => app.close());
    const daemon = await startDaemon();
    cleanups.push(() => daemon.close());
    await app.ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
    const main = app.ctx.pages()[0] || await app.ctx.waitForEvent("page");
    await main.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await daemon.start({ port: app.port, demoMs: o.demoMs });
    await main.reload();
    await ready(main);
    // A second window: reloaded, navigated and crashed now and then.
    const second = await app.ctx.newPage();
    await second.goto(`${demo.origin("byte")}${SITES.byte.path}`);
    await ready(second);
    const raw = await BrowserCDP.connect(app.port); // for the crash: Playwright can't drive a crashed page again
    cleanups.push(() => raw.close());
    const wins = { main: { page: main, site: SITES.tunes, probe: await PageProbe.forPage(main) }, second: { page: second, site: SITES.byte, probe: await PageProbe.forPage(second) } };

    run.meta = { ...o };
    const end = Date.now() + o.minutes * 60000;
    let failStreak = 0, maxFailStreak = 0, cycles = 0, crashes = 0, popups = 0;
    for (let i = 0; i < o.iterations && Date.now() < end; i++) {
      const t0 = performance.now();
      const before = Object.values(steps.fails).reduce((a, b) => a + b, 0);
      const which = i % 2 ? "second" : "main", w = wins[which];
      steps.ctx = `${i} ${which}`;
      if (which === "second" && i % o.crashEvery === 1) {
        // A window of its own crashes (sad page): the connector must notice and
        // drop its session, and the runtime must be back after a reload.
        await steps.run("renderer crash", async () => {
          // Another site (localhost, not 127.0.0.1), opened with noopener: a
          // renderer process of its own, so only this window dies.
          const url = `${demo.origin("parley").replace("127.0.0.1", "localhost")}${SITES.parley.path}?crash=${i}`;
          await Promise.all([app.ctx.waitForEvent("page"), main.evaluate(u => { window.open(u, "_blank", "noopener,popup,width=900,height=700"); }, url)]);
          const target = await waitTarget(raw, url);
          const crashedBefore = (await daemon.stats()).stats.logs.crashes;
          let s = (await raw.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
          await waitIn(raw, s, "!!document.querySelector('[data-morse-ui]')", "the runtime in the new window");
          raw.send("Page.crash", {}, s).catch(() => {}); // never answers: the renderer is gone
          const end = Date.now() + 15000;
          while ((await daemon.stats()).stats.logs.crashes === crashedBefore) { if (Date.now() > end) throw new Error("the connector didn't notice the crash"); await sleep(200); }
          await raw.send("Target.detachFromTarget", { sessionId: s }).catch(() => {});
          s = (await raw.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
          await raw.send("Page.reload", {}, s);
          await waitIn(raw, s, "!!document.querySelector('[data-morse-ui]')", "the runtime after the crash");
          await raw.send("Target.closeTarget", { targetId: target.targetId });
          crashes++;
        });
      } else if (which === "second" && i % o.reloadEvery === 3) {
        await steps.run("reload", async () => {
          if (i % (o.reloadEvery * 2) === 3) await second.reload();
          else await second.goto(`${demo.origin("byte")}${SITES.byte.path}?visit=${i}`);
          await ready(second);
        });
      }
      await w.page.bringToFront().catch(() => {});
      await iteration(w.page, w.site, i, steps);
      if (i % o.popupEvery === 0) {
        await steps.run("window open + close", async () => {
          const [popup] = await Promise.all([app.ctx.waitForEvent("page"), main.evaluate(u => { window.open(u, "_blank", "popup,width=900,height=700"); }, `${demo.origin("parley")}${SITES.parley.path}?popup=${i}`)]);
          await popup.waitForLoadState();
          await popup.evaluate(() => localStorage.setItem("morse:debug", "1"));
          await ready(popup);
          await popup.keyboard.press("Escape");
          await popup.close();
          popups++;
        });
      }
      if (i && i % o.cycleEvery === 0) {
        await steps.run("stop + attach", async () => {
          await daemon.stop();
          await until(main, () => true, "", 1).catch(() => {});
          await daemon.start({ port: app.port, demoMs: o.demoMs });
          await ready(main);
          await ready(second);
          cycles++;
        });
      }
      const failed = Object.values(steps.fails).reduce((a, b) => a + b, 0) - before;
      failStreak = failed ? failStreak + 1 : 0;
      maxFailStreak = Math.max(maxFailStreak, failStreak);
      run.iter(i, performance.now() - t0, { win: which, failed });
      for (const [n, x] of Object.entries(wins)) for (const e of x.probe.takeErrors()) run.error(n, e);
      if (i % o.sampleEvery === 0 || i === o.iterations - 1) {
        const s = { cycles, crashes, popups };
        for (const [n, x] of Object.entries(wins)) { await quiet(x.page); s[n] = await x.probe.sample({ detached: n === "main" }).catch(e => ({ error: e.message })); }
        const d = await daemon.stats().catch(e => ({ error: e.message }));
        s.daemon = d.stats || { error: d.error };
        run.sample(i, s);
        await run.save(steps); // so far: a run cut short still leaves its numbers
        say(`#${i} ${Math.round((Date.now() - run.started) / 1000)}s  main heap ${s.main.heapMB}MB nodes ${s.main.nodes} listeners ${s.main.listeners} win/doc ${s.main.winListeners}/${s.main.docListeners} mo ${JSON.stringify(Object.fromEntries(Object.entries(s.main.worlds || {}).map(([k, v]) => [k, v.mo])))} · daemon ${JSON.stringify(s.daemon)} · fails ${JSON.stringify(steps.fails)}`);
      }
    }
    if (o.retainers) await (await import("./retainers.js")).printRetainers(wins.main.probe); // --retainers: who holds the detached elements
    run.meta.maxFailStreak = maxFailStreak;
    Object.assign(run.meta, { cycles, crashes, popups });
    return await run.save(steps);
  } finally {
    for (const f of cleanups.reverse()) await Promise.resolve().then(f).catch(() => {});
    delete process.env.MORSE_GALLERY_URL;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = args({ iterations: 500, minutes: 75, sampleEvery: 10, popupEvery: 4, crashEvery: 8, reloadEvery: 6, cycleEvery: 25, demoMs: 3, out: "" },
    { iterations: 26, minutes: 3, sampleEvery: 4, cycleEvery: 12 });
  const r = await soakDesktop(o);
  console.log(`done: ${r.iterations.length} iterations, ${r.errors.length} errors, fails ${JSON.stringify(r.fails)}`);
  if (r.lastErrors?.length) console.log(r.lastErrors.slice(-10).join("\n"));
  process.exit(0);
}
