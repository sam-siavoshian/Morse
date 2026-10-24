// Host for the welcome page's practice area. practice.html is a sandboxed
// page (manifest "sandbox") with no chrome.* APIs. Everything goes through
// the welcome page (welcome.js), which relays requests to the service worker
// exactly as host.js does for websites. Mod code never runs here: the
// practice area shows how a change looks (its CSS) only.
(() => {
  if (globalThis.__morseHost) return;
  const subs = [];
  globalThis.__morseHost = {
    send(m) { parent.postMessage({ morsePractice: { ...m, url: m.url || location.href } }, "*"); },
    onMessage(fn) { subs.push(fn); },
  };
  addEventListener("message", e => {
    if (e.source !== parent || !e.data) return;
    const d = e.data;
    if (d.morseMsg) subs.forEach(f => f(d.morseMsg));
  });
})();
