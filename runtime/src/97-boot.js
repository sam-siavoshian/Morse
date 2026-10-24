onEvent(msg => {
  if (msg.type === "toggle") S.open ? closeBar() : openBar();
  if (msg.type === "panel") openPanel();
  if (msg.type === "mods.changed") syncMods();
  if (msg.type === "settings.changed" && msg.settings) setPrefs(msg.settings);
});

// Effect intensity (Settings → Effects). Full is the radar field over the
// target; subtle keeps a still outline and the pulsing mark (the default under
// prefers-reduced-motion); off leaves only the status text.
{
  const full = { start: Effect.start, token: Effect.token, finish: Effect.finish };
  let lite = false;
  Effect.start = el => {
    const level = effectLevel();
    lite = level !== "full";
    if (!lite) return full.start(el);
    if (level === "subtle") {
      logo.classList.add("live");
      if (el?.isConnected) { boxTo(el, selBox); selBox.classList.add("busy"); }
    }
  };
  Effect.token = t => { if (!lite) full.token(t); };
  Effect.finish = ok => {
    if (!lite) return full.finish(ok);
    logo.classList.remove("live");
    selBox.classList.remove("busy");
    selBox.hidden = true;
    lite = false;
    return Promise.resolve();
  };
}

// soak: the host can go away while the page starts (Chrome stops and restarts
// the extension's worker; its requests then fail with "Morse restarted"). Ask
// again a few times instead of staying without mods until the next reload.
async function askAgain(fn, tries = 4) {
  for (let n = 1; ; n++) {
    try { return await fn(); }
    catch (e) { if (n >= tries || !live()) throw e; await new Promise(r => setTimeout(r, 400 * n)); }
  }
}

(async () => {
  try {
    const hello = await askAgain(() => call("hello", { url: location.href }));
    S.label = hello.label; S.mode = hello.mode; S.app = hello.app || null; S.appName = hello.appName || hello.app || null;
    // Hosts from before settings existed don't send them; ask (or use local ones).
    if (hello.settings) { setPrefs(hello.settings); hostPrefs = true; } else await loadPrefs();
    Voice.configure(hello.voice);
    PromptHistory.load();
    await controlBoot(); await askAgain(syncMods); controlReady(); // user control: pause, safe start (63-control.js)
    guardReady(); // guard hook: a mod that froze the page was turned off (64-guard.js)
    Heal.soon(); // self-heal hook: after idle, did a saved mod stop working? (71-heal.js)
    YourStyle.ready(); // your-style hook: fit it to this site once, if turned on (72-style.js)
    if (hello.debug) debugStatus(); // the host was started with MORSE_DEBUG=1
    S.ready = true; // tests: the host answered hello and the mods are on
    if (!hello.quiet && PREFS.welcome) toast(`Morse is ready. Press ${HOTKEY} to change this page.`);
  } catch (e) { console.warn("[morse] host unavailable", e); }
  // single-page apps change URL without reloading
  const urlTimer = setInterval(() => {
    if (!live()) { clearInterval(urlTimer); letGo(); return; } // soak: gone quiet (01-rpc.js)
    if (location.href !== S.url) { S.url = location.href; syncMods().catch(() => {}); Heal.soon(); /* self-heal hook */ }
  }, 1000);
})();

// Read-only status for automated screenshots/tests; off unless opted in
// (Playwright with morse:debug, or a desktop host started with MORSE_DEBUG=1,
// which a web page can't set). Mirrored into a DOM attribute so it is readable
// from any JS world.
let statusOn = false;
function debugStatus() {
  if (statusOn) return;
  statusOn = true;
  const statusTimer = setInterval(() => {
  if (!live()) return clearInterval(statusTimer); // soak
  hostEl.dataset.status = JSON.stringify({
    ready: !!S.ready, phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length,
    open: S.open, input: input.value, voice: Voice.state(), backend: Voice.backend(), level: Voice.level(), db: Voice.db(), pane: paneKind,
    focus: root.activeElement?.className || root.activeElement?.tagName || "", hotkeys: HOTKEYS,
  });
  }, 40);
}
if (DEBUG) debugStatus();
