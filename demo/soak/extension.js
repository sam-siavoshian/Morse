// Soak 1 (and 4): the Chrome extension in Chromium on three demo sites, the
// whole loop of tests/soak loop.js over and over, with the demo model behind
// a real Morse helper. --sw-restart-min=N also kills the service worker every
// N minutes (CDP Target.closeTarget on it), wherever the loop is: pending
// requests must settle and the next iteration must work (scenario 4).
//
//   node scripts/build.js
//   DISPLAY=:99 node demo/soak/extension.js --iterations=600 --minutes=60
//   DISPLAY=:99 node demo/soak/extension.js --iterations=300 --sw-restart-min=3 --out=soak-sw.json
//   DISPLAY=:99 node demo/soak/extension.js --short        (the CI profile: a few minutes)
//
// Extensions only load in headed Chromium: run it under Xvfb.
import { tempDir } from "../../tests/helpers/home.js"; // first: its own MORSE_HOME; temp folders go at exit
import path from "node:path";
import { promises as fs } from "node:fs";
import { chromium } from "../../tests/helpers/browser.js";
import { devToolsPort, freePort } from "../../tests/helpers/net.js";
import { startDemoServer } from "../../tests/helpers/demo-server.js";
import { args, sleep, root, BrowserCDP, PageProbe, Steps, Run, galleryServer } from "./lib.js";
import { SITES, iteration, quiet } from "./loop.js";

export async function soakExtension(opts = {}) {
  const o = { iterations: 500, minutes: 60, sampleEvery: 10, reloadEvery: 6, swRestartMin: 0, demoMs: 3, out: "", log: true, ...opts };
  const say = (...a) => o.log && console.log(...a);
  const EXT = path.join(root, "dist", "extension");
  await fs.access(path.join(EXT, "manifest.json")).catch(() => { throw new Error("Build the extension first: node scripts/build.js"); });

  const cleanups = [];
  const run = new Run(o.swRestartMin || o.swRestartMid ? "extension + service worker restarts" : "extension", o.out || null);
  const steps = new Steps();
  try {
    process.env.MORSE_PROVIDER = "demo";
    if (o.demoMs != null) process.env.MORSE_DEMO_MS = String(o.demoMs); // the demo model's stream: 14ms a token by default
    const demo = await startDemoServer();
    cleanups.push(() => demo.close());
    const gallery = await galleryServer(demo.sites);
    cleanups.push(() => gallery.close());
    const { createBridge, startPairing } = await import("../../daemon/bridge.js");
    const helperPort = await freePort();
    const bridge = createBridge({ port: helperPort, timeoutMs: 20000 });
    await bridge.listen();
    cleanups.push(() => bridge.close());

    const profile = tempDir("morse-soak-ext-");
    const ctx = await chromium.launchPersistentContext(profile, {
      headless: false, viewport: { width: 1280, height: 860 }, timeout: 60000,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--remote-debugging-port=0"],
    });
    cleanups.push(() => ctx.close());
    await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
    let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const extId = new URL(sw.url()).host;
    const browserCdp = await BrowserCDP.connect(await devToolsPort(profile));
    cleanups.push(() => browserCdp.close());

    // Allow User Scripts (mod code runs only through chrome.userScripts).
    const setup = await ctx.newPage();
    await setup.goto(`chrome://extensions/?id=${extId}`);
    await setup.locator("#allow-user-scripts").click({ timeout: 10000 }).catch(e => say("  (couldn't turn on Allow User Scripts:", e.message, ")"));
    await sleep(500);
    await setup.close();
    for (const p of ctx.pages()) if (/welcome\.html|options\.html/.test(p.url())) await p.close();

    // Pair with the helper; skip the first-run tips; the gallery list for these ports.
    const { code } = await startPairing();
    await sw.evaluate(async ({ code, helperPort, galleryUrl }) => {
      await chrome.storage.local.set({ "morse.helperPort": helperPort });
      const r = await fetch(`http://127.0.0.1:${helperPort}/v1/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const { token } = await r.json();
      await chrome.storage.local.set({
        helper: { token, url: `http://127.0.0.1:${helperPort}` }, model: { backend: "helper" }, welcomed: true,
        "morse.gallery.url": galleryUrl,
        "morse.onboarding": { coach: "done", tips: { saved: true, share: true, editTools: true }, dismissed: { model: true, userScripts: true } },
      });
      await chrome.storage.sync.set({ "morse.settings": { welcome: false } });
    }, { code, helperPort, galleryUrl: gallery.url });

    // One tab per site. Parley's document lives the whole run (only SPA
    // route changes), so anything Morse leaks per action piles up there;
    // the other two reload or load again every few visits.
    const names = String(o.sites || "parley,byte,tunes").split(",");
    const tabs = {};
    for (const n of names) {
      const page = await ctx.newPage();
      await page.goto(`${demo.origin(n)}${SITES[n].path}`);
      await page.locator("[data-morse-ui]").waitFor({ state: "attached", timeout: 30000 });
      tabs[n] = { page, probe: await PageProbe.forPage(page), visits: 0 };
    }
    for (const p of ctx.pages()) if (!Object.values(tabs).some(t => t.page === p)) await p.close().catch(() => {});

    // The service worker: heap and storage, attached only while measuring.
    async function swTarget() {
      const { targetInfos } = await browserCdp.send("Target.getTargets");
      return targetInfos.find(t => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`));
    }
    async function swSample() {
      const t = await swTarget();
      if (!t) return { running: false };
      const { sessionId } = await browserCdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
      try {
        await browserCdp.send("HeapProfiler.collectGarbage", {}, sessionId).catch(() => {});
        const h = await browserCdp.send("Runtime.getHeapUsage", {}, sessionId);
        // born: when this copy of the worker started (a restart shows as a new value)
        const st = await browserCdp.send("Runtime.evaluate", { expression: "Promise.all([chrome.storage.local.getBytesInUse(null), chrome.storage.local.get('mods')]).then(([b, m]) => ({ bytes: b, mods: Object.keys(m.mods || {}).length, born: globalThis.__soakBorn ||= Date.now() }))", awaitPromise: true, returnByValue: true }, sessionId);
        return { running: true, heapMB: +(h.usedSize / 1048576).toFixed(2), storageKB: Math.round((st.result?.value?.bytes || 0) / 1024), mods: st.result?.value?.mods ?? null, born: st.result?.value?.born ?? null };
      } finally { await browserCdp.send("Target.detachFromTarget", { sessionId }).catch(() => {}); }
    }
    let restarts = 0, midRestarts = 0;
    async function restartWorker() {
      const t = await swTarget();
      if (!t) return;
      await browserCdp.send("Target.closeTarget", { targetId: t.targetId }).catch(e => run.error("sw restart", { text: e.message }));
      restarts++;
      say(`  ↻ service worker stopped (${restarts})`);
    }
    let restartTimer = null;
    if (o.swRestartMin) restartTimer = setInterval(restartWorker, o.swRestartMin * 60000);
    cleanups.push(() => clearInterval(restartTimer));

    run.meta = { ...o, sites: names, chromium: ctx.browser()?.version?.() || null };
    const end = Date.now() + o.minutes * 60000;
    let failStreak = 0, maxFailStreak = 0;
    for (let i = 0; i < o.iterations && Date.now() < end; i++) {
      const name = names[i % names.length], tab = tabs[name], site = SITES[name];
      const t0 = performance.now();
      const before = Object.values(steps.fails).reduce((a, b) => a + b, 0);
      await tab.page.bringToFront();
      tab.visits++;
      if (name !== "parley" && tab.visits % o.reloadEvery === 0) {
        await steps.run(tab.visits % (o.reloadEvery * 2) ? "reload" : "full load", async () => {
          if (tab.visits % (o.reloadEvery * 2)) await tab.page.reload();
          else await tab.page.goto(`${demo.origin(name)}${site.path}?visit=${tab.visits}`);
          await tab.page.locator("[data-morse-ui]").waitFor({ state: "attached", timeout: 30000 });
          await tab.page.waitForFunction(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "{}").ready, null, { timeout: 30000 });
        });
      }
      steps.ctx = `${i} ${name}`;
      // --sw-restart-mid=N: every N iterations, stop the worker while the change is being made
      let mid = null;
      if (o.swRestartMid && i % o.swRestartMid === o.swRestartMid - 1) mid = setTimeout(() => { midRestarts++; restartWorker(); }, 1500);
      await iteration(tab.page, site, i, steps);
      clearTimeout(mid);
      const failed = Object.values(steps.fails).reduce((a, b) => a + b, 0) - before;
      failStreak = failed ? failStreak + 1 : 0;
      maxFailStreak = Math.max(maxFailStreak, failStreak);
      run.iter(i, performance.now() - t0, { site: name, failed });
      for (const [n, t] of Object.entries(tabs)) for (const e of t.probe.takeErrors()) run.error(n, e);
      if (i % o.sampleEvery === 0 || i === o.iterations - 1) {
        const s = { restarts };
        for (const [n, t] of Object.entries(tabs)) {
          await quiet(t.page);
          s[n] = await t.probe.sample({ detached: n === names[0] }).catch(e => ({ error: e.message }));
        }
        s.sw = await swSample().catch(e => ({ error: e.message }));
        run.sample(i, s);
        await run.save(steps); // so far: a run cut short still leaves its numbers
        const p = s[names[0]];
        say(`#${i} ${Math.round((Date.now() - run.started) / 1000)}s  ${names[0]} heap ${p.heapMB}MB nodes ${p.nodes} listeners ${p.listeners} win/doc ${p.winListeners}/${p.docListeners} mo/detached ${JSON.stringify(Object.fromEntries(Object.entries(p.worlds || {}).map(([k, v]) => [k, `${v.mo}/${v.detached}`])))} · sw ${s.sw.heapMB}MB ${s.sw.storageKB}KB · fails ${JSON.stringify(steps.fails)}`);
      }
    }
    if (o.retainers) await (await import("./retainers.js")).printRetainers(tabs[names[0]].probe); // --retainers: who holds the detached elements
    run.meta.maxFailStreak = maxFailStreak;
    run.meta.restarts = restarts;
    run.meta.midRestarts = midRestarts;
    // After the last restart, one more round must still work (nothing wedged).
    if (o.swRestartMin || o.swRestartMid) {
      await restartWorker();
      await sleep(500);
      const n = names.at(-1), tab = tabs[n];
      await tab.page.bringToFront();
      const ok = new Steps();
      await iteration(tab.page, SITES[n], 0, ok, { gallery: false });
      run.meta.afterRestart = { fails: ok.fails, errors: ok.lastErrors };
    }
    return await run.save(steps);
  } finally {
    for (const f of cleanups.reverse()) await Promise.resolve().then(f).catch(() => {});
    delete process.env.MORSE_PROVIDER;
    delete process.env.MORSE_DEMO_MS;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = args({ iterations: 600, minutes: 75, sampleEvery: 10, reloadEvery: 6, swRestartMin: 0, demoMs: 3, out: "" },
    { iterations: 24, minutes: 3, sampleEvery: 4, reloadEvery: 2 });
  const r = await soakExtension(o);
  console.log(`done: ${r.iterations.length} iterations, ${r.errors.length} errors, fails ${JSON.stringify(r.fails)}`);
  if (r.lastErrors?.length) console.log(r.lastErrors.slice(-10).join("\n"));
  process.exit(0);
}
