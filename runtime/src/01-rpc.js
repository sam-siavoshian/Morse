/* Morse runtime: the part that lives inside the app being customized.
 *
 * It is host-agnostic. Before it loads, the host defines
 * globalThis.__morseHost = { send(msg), onMessage(fn) }:
 *   - the browser extension (content script <-> service worker)
 *   - the desktop connector (CDP binding <-> Node daemon), for Electron apps
 *
 * runtime/boot.js is always on the page first: it applies mods, follows
 * navigations and owns the hotkeys. This half (the overlay, bar, panel,
 * effect, God mode) is loaded on first use and picks up the boot's host
 * connection, state and mods through the handoff object below.
 *
 * UI lives in a closed shadow root so the app's CSS can't touch it and ours
 * can't leak out. */

const B = globalThis[Symbol.for("morse.boot")];
if (!B || !B.live() || globalThis.__morseRuntime) return;
const { host, call, listeners, outgoing } = B;
// A host that detaches (`morse stop`) bumps __morseGen; boot.js and this copy
// then go quiet (no UI, no hotkeys) and a later attach can start fresh ones.
const live = B.live;
// Every listener on the page's window goes through this, so a detached copy
// keeps none of the page's keys, clicks or focus.
const listen = (type, fn, opts) => addEventListener(type, e => { if (live()) fn(e); }, opts);

// The page may have replaced these globals since boot captured them; bare
// calls in the UI (window listeners, new MutationObserver, timers)
// resolve to the originals here. Window listeners also survive document.open().
const addEventListener = (type, fn, opts) => B.on(window, type, fn, opts);
const removeEventListener = (type, fn, opts) => B.off(window, type, fn, opts);
const { MutationObserver, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, getComputedStyle } = B.pristine;
