/* Morse runtime: the part that lives inside the app being customized.
 *
 * It is host-agnostic. Before it loads, the host defines
 * globalThis.__morseHost = { send(msg), onMessage(fn) }:
 *   - the browser extension (content script <-> service worker)
 *   - the desktop connector (CDP binding <-> Node daemon), for Electron apps
 *
 * UI lives in a closed shadow root so the app's CSS can't touch it and ours
 * can't leak out. */

if (globalThis.__morseRuntime) return;
const host = globalThis.__morseHost;
if (!host) return;
globalThis.__morseRuntime = true;
// A host that detaches (`morse stop`) bumps __morseGen; this copy then goes
// quiet (no UI, no hotkeys) and a later attach can start a fresh one.
const GEN = globalThis.__morseGen = (globalThis.__morseGen || 0) + 1;
const live = () => globalThis.__morseGen === GEN;
// Every listener on the page's window goes through this, so a detached copy
// keeps none of the page's keys, clicks or focus. `on` is document for the
// few that listen there.
// soak: a copy that went quiet also lets go of the page: within a second its
// window and document listeners are removed and every MutationObserver it
// made is disconnected, so nothing on the page holds it (and its whole UI)
// any more. Each `morse stop` + attach used to leave one more copy behind,
// still called on every change to the page.
const pageHold = { observers: new Set(), listeners: [] };
const listen = (type, fn, opts, on = globalThis) => {
  const entry = [on, type, null, opts];
  entry[2] = e => {
    if (opts?.once) pageHold.listeners.splice(pageHold.listeners.indexOf(entry) >>> 0, 1);
    if (live()) fn(e);
  };
  pageHold.listeners.push(entry);
  on.addEventListener(type, entry[2], opts);
};
// soak: the runtime's observers, as the page's own but tracked while observing.
const MutationObserver = class extends globalThis.MutationObserver {
  observe(...a) { pageHold.observers.add(this); return super.observe(...a); }
  disconnect() { pageHold.observers.delete(this); return super.disconnect(); }
};
function letGo() {
  for (const o of pageHold.observers) o.disconnect();
  for (const [on, type, h, opts] of pageHold.listeners.splice(0)) on.removeEventListener(type, h, opts);
}

let seq = 0;
const pending = new Map();
const listeners = new Set();
host.onMessage(msg => {
  if (msg.reply != null && pending.has(msg.reply)) {
    const { resolve, reject } = pending.get(msg.reply);
    pending.delete(msg.reply);
    msg.error ? reject(new Error(msg.error)) : resolve(msg.result);
  } else listeners.forEach(fn => fn(msg));
});
const outgoing = []; // hook: fns that may decorate a request before it is sent (God mode capture)
const call = (type, payload = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  host.send(outgoing.reduce((m, f) => f(m) || m, { id, type, ...payload }));
});
