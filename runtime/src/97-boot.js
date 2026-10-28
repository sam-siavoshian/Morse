onEvent(msg => {
  if (msg.type === "toggle") S.open ? closeBar() : openBar();
  if (msg.type === "open") S.open ? input.focus() : openBar(); // the website's Try it here: its Open Morse button never closes the bar
  if (msg.type === "toggle" && typeof msg.text === "string" && msg.text && S.open && !input.value) { input.value = msg.text.slice(0, 200); input.dispatchEvent(new Event("input")); } // onboarding v2: the welcome page's first site
  if (msg.type === "panel") openPanel();
  if (msg.type === "mods.changed") syncMods();
  if (msg.type === "settings.changed" && msg.settings) {
    if (typeof msg.fastModel === "string") S.fastModel = msg.fastModel;
    setPrefs(msg.settings);
  }
  if (msg.type === "request" && typeof msg.text === "string") hostRequest(msg.text.trim().slice(0, 2000), msg.at);
});

// A request from the host, sent as if it were typed in the bar (the website's
// Try it here section, site/try.js, has buttons for a few). `at` points at
// that part of the page first. While a change waits for Save or Undo, it waits
// too (the host says so).
function hostRequest(text, at) {
  if (!text || S.phase === "working") return;
  if (S.open && S.phase === "result" && S.draft && !S.draft.saved) return;
  openBar();
  let el = null;
  try { el = typeof at === "string" && at ? document.querySelector(at) : null; } catch {}
  if (el) setTarget(el);
  setInput(text);
  send(text);
}

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
  toast: x => toast(x && typeof x === "object" ? t(x.id, x.vars) : x), key: adoptKey,
  modsChanged() { Health.prune(new Set(S.mods.map(m => m.id))); if (!panel.hidden) renderPanel(); }, // soak: prune
  health: (m, r) => Health.ran(m, r), // repair: the panel marks mods that stopped working (70-panel.js)
  controlReady, // user control: the safe-start / off-switch notice after the first sync (63-control.js)
  healFound: () => Heal.found(), // self-heal: what boot.js found broken, for the dot, the note and Fix it (71-heal.js)
  guardHeard: (id, p) => Guard.heard(id, p), // guard hook: the kit paused a mod (64-guard.js)
  guardStop, // guard hook: boot.js didn't apply a mod, or undid it (64-guard.js)
  guardReady, // guard hook: a mod that froze the page was turned off (64-guard.js)
  styleReady: () => YourStyle.ready(), // your-style hook: fit it to this site once, if turned on (72-style.js)
});
const uiStarted = () => { B.started(); S.ready = true; /* tests: the host answered hello and the mods are on */ };
B.ready.then(hello => {
  try {
    S.models = hello.models || null; // models: the names the Settings sheet shows (56-settings.js)
    S.fastModel = typeof hello.fastModel === "string" ? hello.fastModel : "";
    setModelChoices(hello.modelChoices || null); // models: the bar's selector (51-model.js), before prefs so the saved choice paints with it
    setPrefs(B.prefs());
    if (hello.settings) hostPrefs = true; // the host sent settings with its hello (03-prefs.js)
    Voice.configure(hello.voice);
    PromptHistory.load();
    if (hello.debug) debugStatus(); // the host was started with MORSE_DEBUG=1
  } finally {
    // Open now. A language still on its way swaps the words when it arrives
    // (04-i18n.js). Waiting here used to hold the hotkey for up to 1.5s.
    uiStarted();
  }
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
// from any JS world. Written every 40 ms, and at once when something
// dispatches "morse:status" on the document (the listener runs inside that
// dispatch, whichever world dispatched it): tests/helpers/wait.js readStatus
// does, so a test never reads the state from before its last key or click.
let statusOn = false;
function debugStatus() {
  if (statusOn) return;
  statusOn = true;
  const write = () => {
    hostEl.dataset.status = JSON.stringify({
      ready: !!S.ready, phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length,
      open: S.open, input: input.value, voice: Voice.state(), backend: Voice.backend(), level: Voice.level(), db: Voice.db(), pane: paneKind,
      focus: root.activeElement?.className || root.activeElement?.tagName || "", hotkeys: HOTKEYS,
    });
  };
  const timer = setInterval(() => {
    if (!live()) { clearInterval(timer); B.off(document, "morse:status", write); return; } // soak: a copy that went quiet (morse stop) stops, and can be let go
    write();
  }, 40);
  B.on(document, "morse:status", write);
}
if (DEBUG) debugStatus();
