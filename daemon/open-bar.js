// When "Open the bar" can reach Morse, and what the desktop apps row may say.
//
// The connector's state turns "attached" as soon as the app answers on its
// debugging port. Morse's own world in a window comes later: Brave can answer
// while its first page is still one Morse doesn't run in. The apps row used
// "attached" as Connected and offered Open the bar, which then failed with
// "isn't running yet". Those two have to agree.
//
// This file is also served to the Morse Desktop window (desktop-app/main.js),
// so it stays free of Node APIs.

// The isolated-world id Open the bar can call, or null. `ready` is set just
// before boot, so it is not enough on its own; `ready && world` is false
// (not null) in that gap and must not count as a world.
export function barWorld(w) {
  if (!w?.ready) return null;
  const world = w.frames?.get?.(w.frameId)?.world;
  return world == null ? null : world;
}

// true: Morse is in a window. false: this connector's windows were checked
// and it isn't. null: there is no window list to check (trust the session).
export function morseRunning(connector) {
  const windows = connector?.windows;
  if (!windows || typeof windows.values !== "function") return null;
  for (const w of windows.values()) if (barWorld(w) != null) return true;
  return false;
}

// The apps-list state. Connected only once Morse is running in the app.
// Until then the row stays "connecting", and Disconnect stays (canStop):
// the app is already ours, it just has no Morse world yet.
export function presentApp(sessionState, connector) {
  if (sessionState === "connected" && morseRunning(connector) === false) return { state: "connecting", canStop: true };
  return { state: sessionState, canStop: false };
}

// What a click on Open the bar means for the row. notReady means Morse is
// not in the app, so a Connected row was ahead of itself: step it back to
// connecting and keep the banner. Any other result leaves the row as it is.
export function afterOpenBar(state, code) {
  if (code === "notReady" && state === "connected") return { state: "connecting", canStop: true, code: "notReady" };
  return { state, canStop: false, code: code || null };
}

// On a later refresh. The "isn't running yet" banner stays only while the
// row still says the app is coming up. Once the row is Connected, that
// banner is stale. A missing app, or any other state, drops it too. Other
// failures are not this code, so they are left to the caller.
export function noticeStillShown(state, code) {
  if (code !== "notReady") return code || null;
  if (state === "connecting" || state === "opening") return "notReady";
  return null;
}
