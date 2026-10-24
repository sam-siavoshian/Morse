onEvent(msg => {
  if (msg.type === "toggle") S.open ? closeBar() : openBar();
  if (msg.type === "toggle" && typeof msg.text === "string" && msg.text && S.open && !input.value) { input.value = msg.text.slice(0, 200); input.dispatchEvent(new Event("input")); } // onboarding v2: the welcome page's first site
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
  // boot.js has no words of its own: it hands over message ids ({ id, vars }) for t()
  toast: x => toast(x && typeof x === "object" ? t(x.id, x.vars) : x), key: adoptKey, modsChanged() { if (!panel.hidden) renderPanel(); },
  health: (m, r) => Health.ran(m, r), // repair: the panel marks mods that stopped working (70-panel.js)
  controlReady, // user control: the safe-start / off-switch notice after the first sync (63-control.js)
  healFound: () => Heal.found(), // self-heal: what boot.js found broken, for the dot, the note and Fix it (71-heal.js)
  guardHeard: (id, p) => Guard.heard(id, p), // guard hook: the kit paused a mod (64-guard.js)
  guardStop, // guard hook: boot.js didn't apply a mod, or undid it (64-guard.js)
  guardReady, // guard hook: a mod that froze the page was turned off (64-guard.js)
  styleReady: () => YourStyle.ready(), // your-style hook: fit it to this site once, if turned on (72-style.js)
  waitingAdd: m => Waiting.add(m), // waiting hook: “Allow User Scripts” is off; the style shows, the code never ran (64-waiting.js)
});
B.ready.then(hello => {
  try {
    setPrefs(B.prefs());
    S.models = hello.models || null; // models: the names the Settings sheet shows (56-settings.js)
    if (hello.settings) hostPrefs = true; // the host sent settings with its hello (03-prefs.js)
    Voice.configure(hello.voice);
    PromptHistory.load();
    if (hello.debug) debugStatus(); // the host was started with MORSE_DEBUG=1
  } finally { B.started(); S.ready = true; /* tests: the host answered hello and the mods are on */ }
}).catch(e => console.warn("[morse]", e));

// boot.js applies the mods, so the guards around applyMod run there
// (core/guard.js finds the harm); the reason the model gets for Fix it is
// worded here, as 64-guard.js before() and after() word it.
function guardStop(id, why) {
  const m = S.mods.find(x => x.id === id);
  if (!m) return;
  const error = why === "hid-js"
    ? "Morse paused it because after it ran the whole page was hidden (html or body ended up with display: none or opacity: 0). Never hide html, body, :root or *. Hide or change only the parts the user asked about."
    : `Morse paused it. ${draftHarm(why === "endless" ? { js: m.js } : { css: m.css })?.model || ""}`;
  Guard.heard(id, { why: why === "endless" ? "endless" : "hid", error });
}

// Read-only status for automated screenshots/tests; off unless opted in
// (Playwright with morse:debug, or a desktop host started with MORSE_DEBUG=1,
// which a web page can't set). Mirrored into a DOM attribute so it is readable
// from any JS world.
let statusOn = false;
function debugStatus() {
  if (statusOn) return;
  statusOn = true;
  setInterval(() => {
  hostEl.dataset.status = JSON.stringify({
    ready: !!S.ready, phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length,
    open: S.open, input: input.value, voice: Voice.state(), backend: Voice.backend(), level: Voice.level(), db: Voice.db(), pane: paneKind,
    focus: root.activeElement?.className || root.activeElement?.tagName || "", hotkeys: HOTKEYS,
  });
  }, 40);
}
if (DEBUG) debugStatus();
