// The overlay window's page script. Two jobs:
//
//   1. Click-through management. The window is created click-through so the
//      native app underneath stays usable; this re-enables mouse events only
//      while the pointer is over the bar, so the bar is clickable but the rest
//      of the overlay isn't in the way.
//
//   2. The mount seam. The full Morse bar (runtime/) is meant to mount into
//      #morse-overlay-root, driven by a host shim that forwards the runtime's
//      requests (generate, run, save) to the native DBI session over IPC. That
//      bundle + shim is the documented next step (see docs/dev/native-dbi.md);
//      until then the token-styled shell in overlay.html stands in so the
//      overlay is visually the Morse bar.
//
// CSP here is script-src 'self', so this is a plain external script with no
// eval and no inline handlers.

(() => {
  const overlay = globalThis.morseOverlay; // from overlay-preload.cjs
  const bar = document.getElementById("morse-overlay-bar");
  if (!bar || !overlay) return;

  // Only the bar is interactive; hovering it lets clicks land, leaving it
  // re-arms pass-through so the app underneath keeps receiving the pointer.
  bar.addEventListener("pointerenter", () => overlay.setInteractive(true));
  bar.addEventListener("pointerleave", () => overlay.setInteractive(false));

  // When the runtime bundle is wired in, it will be mounted here, e.g.:
  //   const host = makeNativeHost(overlay);   // adapts runtime RPC → IPC → session
  //   window.__morseHost = host;              // the binding the bar talks to
  //   import("overlay-runtime.js") ...        // served from bundleRuntime()
  // Kept out until the host-RPC bridge to native mods exists, so nothing here
  // pretends to drive a connection it doesn't have.
})();
