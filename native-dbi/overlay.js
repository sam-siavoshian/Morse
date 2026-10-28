// The overlay engine: keep a Morse-owned window pinned over a native app's
// window, so the same web bar can float above an app Morse can't render into.
//
// Why an overlay and not injection: the bar is a web UI (runtime/), and a
// native process has no DOM to render it in (Frida's injected JS is a bare
// engine). Rendering HTML inside the target would mean injecting a whole
// browser engine — invasive and fragile, and off-limits for this project. A
// transparent, always-on-top window that Morse owns, pinned over the target,
// renders the *exact same* runtime and stays non-invasive. The DBI session
// (native-dbi/frida-runner.js) is the data/action channel underneath; this
// module is only about *where the window goes*.

import { windowBounds } from "./window-bounds.js";
//
// This file is pure orchestration: it talks to a `host` (the thing that can
// actually show/move/hide a window — the Electron host in desktop-app/overlay.js
// in the product, a fake in tests) and a `bounds` source (window-bounds.js, or
// a fake). No Electron, no platform calls here, so the follow/diff/hide logic
// is unit-testable.

// Where the overlay sits, given the target window's bounds.
//   mode "full"  cover the whole window (for a picker/dimmer that spans it)
//   mode "bar"   a strip near the top, centred, like the in-page bar (default)
// `margin` insets the bar from the window edge; `barHeight`/`barWidth` size it;
// `maxWidth` keeps it readable over a very wide window. Pure.
export function computeRegion(bounds, { mode = "bar", margin = 16, barHeight = 56, maxWidth = 720 } = {}) {
  if (!bounds) return null;
  const { x, y, width, height } = bounds;
  if (!(width > 0 && height > 0)) return null;
  if (mode === "full") return { x, y, width, height };
  const w = Math.min(maxWidth, Math.max(240, width - margin * 2));
  return {
    x: Math.round(x + (width - w) / 2),
    y: Math.round(y + margin),
    width: Math.round(w),
    height: Math.round(barHeight),
  };
}

export function sameRegion(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Drives a host to track a window. `host` is { show(region), move(region),
// hide(), destroy() }. `bounds()` returns the target's current bounds or null.
// It polls, computes the region, and only calls the host when the region
// actually changes; a null bounds (minimised/closed/off-space) hides the
// overlay without destroying it, so it reappears when the window returns.
export class OverlayController {
  constructor({ host, bounds, pollMs = 250, regionOptions = {}, onGone = null } = {}) {
    if (!host || typeof host.show !== "function") throw new TypeError("overlay host is required");
    if (typeof bounds !== "function") throw new TypeError("bounds must be a function");
    this.host = host;
    this.bounds = bounds;
    this.pollMs = pollMs;
    this.regionOptions = regionOptions;
    this.onGone = onGone;
    this.timer = null;
    this.visible = false;
    this.region = null;
    this.goneSince = null;
    this.stopped = false;
  }

  // One tracking step. Exposed so tests can drive it deterministically instead
  // of waiting on the timer.
  tick() {
    if (this.stopped) return;
    const region = computeRegion(this.bounds(), this.regionOptions);
    if (!region) {
      if (this.visible) { this.host.hide(); this.visible = false; }
      this.goneSince ??= Date.now();
      if (this.onGone) this.onGone(this.goneSince);
      return;
    }
    this.goneSince = null;
    if (!this.visible) { this.host.show(region); this.visible = true; this.region = region; return; }
    if (!sameRegion(region, this.region)) { this.host.move(region); this.region = region; }
  }

  start() {
    if (this.timer || this.stopped) return this;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
    return this;
  }

  // Stop tracking and tear the overlay down. Idempotent.
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.host.destroy(); } catch {}
    this.visible = false;
  }
}

// Wire a controller to the real window-bounds source for a PID. `host` is the
// platform host (Electron in the product). Returns the started controller;
// call .stop() to tear down. `boundsFor` is injectable for tests; the default
// uses window-bounds.js (synchronous, so the poll stays simple).
export function trackWindow({ pid, host, platform = process.platform, pollMs = 250, regionOptions = {}, boundsFor, onGone = null }) {
  const read = boundsFor || (() => windowBounds(pid, { platform }));
  const controller = new OverlayController({ host, bounds: () => { try { return read(); } catch { return null; } }, pollMs, regionOptions, onGone });
  return controller.start();
}
