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
    p.onMessage.addListener(m => {
      // The effect check (background.js probe): answered here, in order after
      // the CSS that came before it on this port.
      if (m && m.morseProbe != null) {
        const answer = result => { try { p.postMessage({ morseProbeReply: m.morseProbe, result: result ?? null }); } catch {} };
        try { Promise.resolve(globalThis.__morseProbe ? globalThis.__morseProbe(m.target, m.selectors, m.quick ? { quick: true } : undefined) : null).then(answer, () => answer(null)); }
        catch { answer(null); }
        return;
      }
      if (m && m.reply != null) pending.delete(m.reply);
      emit(m);
    });
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

  chrome.runtime.onMessage.addListener(m => { if (m && m.morseToggle) emit({ type: "toggle", ...(typeof m.text === "string" && m.text ? { text: m.text.slice(0, 200) } : {}) }); }); // onboarding v2: the first site opens with the words typed
  chrome.runtime.onMessage.addListener(m => { if (m && m.morseRetry) emit({ type: "waiting.retry" }); }); // onboarding v2: “Allow User Scripts” just came on (allow.js)

  // The share page (share/install.html) asks to install through us.
  if (document.documentElement) document.documentElement.dataset.morseExtension = "1"; // document_start: the parser may not have made <html> yet
  // Only the official share page may ask, and it only *asks*: the runtime
  // shows Morse's own review (runtime/src/63-control.js, in the closed shadow
  // root the page can't click) and installs only if the person clicks Install.
  // The share page is Morse's share/ folder (SHARE_BASE in core/mod.js), not
  // the whole site: every GitHub Pages project of the same owner is on the
  // same address. The page has to have loaded there, not moved there with
  // history.pushState. Test builds also trust the local copy the tests use
  // (127.0.0.1:8787/share/); store builds (MORSE_STORE=1, npm run store)
  // leave it out.
  const SHARE_PAGES = ["https://sam-siavoshian.github.io/RRAA/share/", "http://127.0.0.1:8787/share/" /* test-only */];
  const onSharePage = () => { const here = location.origin + location.pathname; return SHARE_PAGES.some(p => here.startsWith(p)); };
  const loadedOnSharePage = onSharePage();
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || typeof e.data.morseInstall !== "string") return;
    if (!loadedOnSharePage || !onSharePage()) return;
    emit({ type: "install.request", source: String(e.data.morseInstall).slice(0, 2_000_000) });
  });
})();
