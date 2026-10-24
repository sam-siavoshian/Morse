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

// Take over from boot.js. Until now it has applied the mods, followed
// navigations and caught the first hotkey; from here the UI's own handlers
// run, and whatever arrived before it (that hotkey, a host event, a toast)
// is replayed once the hello reply is in.
B.adopt({
  toast, key: adoptKey, modsChanged() { if (!panel.hidden) renderPanel(); },
  health: (m, r) => Health.ran(m, r), // repair: the panel marks mods that stopped working (70-panel.js)
  controlReady, // user control: the safe-start / off-switch notice after the first sync (63-control.js)
});
B.ready.then(hello => {
  try {
    setPrefs(B.prefs());
    Voice.configure(hello.voice);
    PromptHistory.load();
  } finally { B.started(); }
}).catch(e => console.warn("[morse]", e));

// Read-only status for automated screenshots/tests; off unless opted in.
// Mirrored into a DOM attribute so it is readable from any JS world.
if (DEBUG) setInterval(() => {
  hostEl.dataset.status = JSON.stringify({
    phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length,
    open: S.open, input: input.value, voice: Voice.state(), backend: Voice.backend(), level: Voice.level(), db: Voice.db(), pane: paneKind,
    focus: root.activeElement?.className || root.activeElement?.tagName || "", hotkeys: HOTKEYS,
  });
}, 40);
