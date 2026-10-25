// Try it here, inside the demo app's frame (site/try/try.js builds the frame and
// is Morse's host). The frame is sandboxed with allow-scripts only: it has no
// access to the website, its storage or its cookies, and nothing in it can
// reach the network on Morse's behalf.
//
// This file is the only glue: it gives the real runtime (loaded next, from
// dist/runtime/runtime.js) the host it expects, and passes every request
// to the page over postMessage. The one job done here is running mod code,
// so code the demo model wrote only ever runs inside this frame.
(() => {
  const subs = [];
  const up = msg => parent.postMessage({ morseTry: 1, ...msg }, "*");
  const run = (op, id, code) => {
    if (op === "off") { globalThis.morse?.__off?.(id); return true; }
    if (op === "stats") return globalThis.morse?.__stats?.(id) ?? null;
    let r;
    try { r = (0, eval)(code); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    const errs = r && r.ok && globalThis.morse?.__errors ? globalThis.morse.__errors(id) : [];
    return errs.length ? { ok: false, error: String(errs[0]) } : r;
  };
  addEventListener("message", e => {
    const d = e.data;
    if (e.source !== parent || !d || d.morseTry !== 1) return;
    if (d.event) for (const fn of subs) { try { fn(d.event); } catch {} }
    if (d.op) up({ done: d.seq, result: run(d.op, d.id, d.code) });
  });
  window.__morseHost = {
    onMessage: fn => subs.push(fn),
    send: m => up({ host: m }),
  };
  up({ ready: true });
})();
