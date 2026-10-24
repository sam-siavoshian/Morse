// Host for the welcome page's practice area. practice.html is a sandboxed
// page (manifest "sandbox"), so mod code can run in it, which extension pages
// don't allow; in exchange it has no chrome.* APIs. Everything goes through
// the welcome page (welcome.js), which relays requests to the service worker
// exactly as host.js does for websites, and sends mod code back here to run.
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
    if (typeof d.morseEval === "string") {
      let result;
      try { result = (0, eval)(d.morseEval); } catch (err) { result = { ok: false, error: String((err && err.message) || err) }; }
      try { structuredClone(result); } catch { result = null; }
      parent.postMessage({ morseEvalReply: d.id, result }, "*");
    }
  });
})();
