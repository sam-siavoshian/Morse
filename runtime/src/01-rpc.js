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
