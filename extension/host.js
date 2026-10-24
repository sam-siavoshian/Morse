// Content-script side of the extension host: bridges the runtime to the
// service worker. Reconnects if Chrome recycles the worker.
(() => {
  if (window.top !== window || globalThis.__morseHost) return;
  const subs = [];
  let port = null;
  // Each port keeps the ids of requests sent on it and not answered yet. If
  // it closes (the service worker was recycled, the extension reloaded), each
  // gets an error reply so nothing in the runtime waits forever.
  const connect = () => {
    const p = chrome.runtime.connect({ name: "morse" });
    const inflight = new Set();
    port = { p, inflight };
    p.onMessage.addListener(m => {
      if (m && m.reply != null) inflight.delete(m.reply);
      subs.forEach(f => f(m));
    });
    p.onDisconnect.addListener(() => {
      if (port?.p === p) port = null;
      const lost = [...inflight];
      inflight.clear();
      for (const id of lost) subs.forEach(f => f({ reply: id, error: "message port closed" }));
    });
  };
  globalThis.__morseHost = {
    send(m) {
      const msg = { ...m, url: m.url || location.href };
      if (!port) connect();
      // A port can be dead before its onDisconnect has run: retry once on a fresh one.
      try { port.p.postMessage(msg); } catch { connect(); port.p.postMessage(msg); }
      if (m.id != null) port.inflight.add(m.id);
    },
    onMessage(fn) { subs.push(fn); },
  };

  chrome.runtime.onMessage.addListener(m => { if (m && m.morseToggle) subs.forEach(f => f({ type: "toggle" })); });

  // The share page (share/install.html) asks to install through us.
  document.documentElement.dataset.morseExtension = "1";
  // Only the official share page may ask, and it only *asks*: the runtime
  // shows the mod and installs it only if the user clicks Install.
  const SHARE_ORIGINS = ["https://sam-siavoshian.github.io", "http://127.0.0.1:8787"];
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || typeof e.data.morseInstall !== "string") return;
    if (!SHARE_ORIGINS.includes(location.origin)) return;
    subs.forEach(f => f({ type: "install.request", source: e.data.morseInstall }));
  });
})();
