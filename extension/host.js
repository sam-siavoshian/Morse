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

  // The share page (share/install.html) asks to install through us. Any page
  // can post this message, so nothing is installed from here: the runtime
  // shows Morse's own review (in its closed shadow root, which the page can't
  // click) and installs only when the person presses Install there.
  document.documentElement.dataset.morseExtension = "1";
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || typeof e.data.morseInstall !== "string") return;
    subs.forEach(f => f({ type: "install.request", source: e.data.morseInstall.slice(0, 2_000_000) }));
  });
})();
