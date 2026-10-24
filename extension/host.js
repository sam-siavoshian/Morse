// Content-script side of the extension host: bridges the runtime to the
// service worker. Reconnects if Chrome recycles the worker.
(() => {
  if (window.top !== window || globalThis.__morseHost) return;
  const subs = [];
  const emit = m => subs.forEach(f => f(m));
  let port = null;
  // Requests the worker hasn't answered yet. If it goes away (Chrome recycles
  // idle service workers, the extension reloads), they would never be answered:
  // fail them so the runtime's calls settle instead of hanging.
  const pending = new Map(); // request id -> the port it went out on
  const fail = id => { pending.delete(id); emit({ reply: id, error: "Morse restarted. Try again." }); };
  const connect = () => {
    const p = chrome.runtime.connect({ name: "morse" });
    p.onMessage.addListener(m => { if (m && m.reply != null) pending.delete(m.reply); emit(m); });
    p.onDisconnect.addListener(() => {
      if (port === p) port = null;
      for (const [id, via] of [...pending]) if (via === p) fail(id);
    });
    port = p;
  };
  const post = msg => {
    if (!port) connect();
    if (msg.id != null) pending.set(msg.id, port);
    port.postMessage(msg);
  };
  globalThis.__morseHost = {
    send(m) {
      const msg = { ...m, url: m.url || location.href };
      try { post(msg); }
      catch {
        // The port died before onDisconnect told us: reconnect once.
        port = null;
        try { post(msg); } catch { if (msg.id != null) fail(msg.id); }
      }
    },
    onMessage(fn) { subs.push(fn); },
  };

  chrome.runtime.onMessage.addListener(m => { if (m && m.morseToggle) emit({ type: "toggle" }); });

  // The share page (share/install.html) asks to install through us.
  document.documentElement.dataset.morseExtension = "1";
  // Only the official share page may ask, and it only *asks*: the runtime
  // shows the mod and installs it only if the user clicks Install.
  const SHARE_ORIGINS = ["https://sam-siavoshian.github.io", "http://127.0.0.1:8787"];
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || typeof e.data.morseInstall !== "string") return;
    if (!SHARE_ORIGINS.includes(location.origin)) return;
    emit({ type: "install.request", source: e.data.morseInstall });
  });
})();
