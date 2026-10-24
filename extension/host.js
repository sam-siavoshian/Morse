// Content-script side of the extension host: bridges the runtime to the
// service worker. Reconnects if Chrome recycles the worker.
(() => {
  if (window.top !== window || globalThis.__morseHost) return;
  const subs = [];
  let port = null;
  const connect = () => {
    port = chrome.runtime.connect({ name: "morse" });
    port.onMessage.addListener(m => subs.forEach(f => f(m)));
    port.onDisconnect.addListener(() => { port = null; });
  };
  globalThis.__morseHost = {
    send(m) { if (!port) connect(); port.postMessage({ ...m, url: m.url || location.href }); },
    onMessage(fn) { subs.push(fn); },
  };

  chrome.runtime.onMessage.addListener(m => { if (m && m.morseToggle) subs.forEach(f => f({ type: "toggle" })); });

  // The share page (share/install.html) asks to install through us.
  document.documentElement.dataset.morseExtension = "1";
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || typeof e.data.morseInstall !== "string") return;
    let id = "install-" + Date.now();
    const off = m => {
      if (m.reply !== id) return;
      window.postMessage({ morseInstalled: m.error ? { error: m.error } : { title: m.result.title } }, "*");
    };
    subs.push(off);
    globalThis.__morseHost.send({ id, type: "mods.import", source: e.data.morseInstall });
  });
})();
