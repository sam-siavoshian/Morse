// Content-script side of the extension host: bridges the runtime to the
// service worker. Reconnects if Chrome recycles the worker.
(() => {
  if (window.top !== window || globalThis.__morphHost) return;
  const subs = [];
  let port = null;
  const connect = () => {
    port = chrome.runtime.connect({ name: "morph" });
    port.onMessage.addListener(m => subs.forEach(f => f(m)));
    port.onDisconnect.addListener(() => { port = null; });
  };
  globalThis.__morphHost = {
    send(m) { if (!port) connect(); port.postMessage({ ...m, url: m.url || location.href }); },
    onMessage(fn) { subs.push(fn); },
  };

  chrome.runtime.onMessage.addListener(m => { if (m && m.morphToggle) subs.forEach(f => f({ type: "toggle" })); });

  // The share page (share/install.html) asks to install through us.
  document.documentElement.dataset.morphExtension = "1";
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || typeof e.data.morphInstall !== "string") return;
    let id = "install-" + Date.now();
    const off = m => {
      if (m.reply !== id) return;
      window.postMessage({ morphInstalled: m.error ? { error: m.error } : { title: m.result.title } }, "*");
    };
    subs.push(off);
    globalThis.__morphHost.send({ id, type: "mods.import", source: e.data.morphInstall });
  });
})();
