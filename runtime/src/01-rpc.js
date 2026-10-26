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
const { MutationObserver: PageObserver, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, getComputedStyle } = B.pristine;
// soak: the UI's observers, tracked while they observe, so a copy that went
// quiet (`morse stop`) disconnects them once its overlay is taken off the page
// (letGo, from 10-dom.js; the boot lets go of its own listeners when the next
// one starts). Some watch the whole page
// (the re-render notes in 20-context.js), and each kept a whole old UI alive:
// on the desktop, runtime observers went 25 -> 101 over three stop + attach.
const uiObservers = new Set();
const MutationObserver = class extends PageObserver {
  observe(...a) { uiObservers.add(this); return super.observe(...a); }
  disconnect() { uiObservers.delete(this); return super.disconnect(); }
};
function letGo() {
  for (const o of uiObservers) o.disconnect();
  try { clearPageTop(); } catch {} // the body's focus listener, or this copy stays (12-focus.js)
  // The document keeps some of the old UI's elements in tables of its own (the
  // bar through its aria-owns, the settings pane), and through one element
  // its whole tree: take every element apart, so each holds only itself.
  try { bar.removeAttribute("aria-owns"); for (const el of [...root.querySelectorAll("*")].reverse()) el.remove(); root.replaceChildren(); hostEl.remove(); } catch {}
}
