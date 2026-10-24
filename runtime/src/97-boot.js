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

(async () => {
  try {
    const hello = await call("hello", { url: location.href });
    S.label = hello.label; S.mode = hello.mode; S.app = hello.app || null; S.appName = hello.appName || hello.app || null;
    // Hosts from before settings existed don't send them; ask (or use local ones).
    if (hello.settings) setPrefs(hello.settings); else await loadPrefs();
    Voice.configure(hello.voice);
    PromptHistory.load();
    await syncMods();
    if (!hello.quiet && PREFS.welcome) toast(`Morse is ready. Press ${HOTKEY} to change this page.`);
  } catch (e) { console.warn("[morse] host unavailable", e); }
  // single-page apps change URL without reloading
  setInterval(() => { if (live() && location.href !== S.url) { S.url = location.href; syncMods().catch(() => {}); } }, 1000);
})();

// Read-only status for automated screenshots/tests; off unless opted in.
// Mirrored into a DOM attribute so it is readable from any JS world.
if (DEBUG) setInterval(() => {
  hostEl.dataset.status = JSON.stringify({
    phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length,
    open: S.open, input: input.value, voice: Voice.state(), backend: Voice.backend(), level: Voice.level(), db: Voice.db(), pane: paneKind,
    focus: root.activeElement?.className || root.activeElement?.tagName || "", hotkeys: HOTKEYS,
  });
}, 40);
