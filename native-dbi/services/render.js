// The render layer: show a service payload back inside (or over) the app.
//
// Two honest mechanisms, matching what Morse already does:
//   - Electron apps: a DOM injection over CDP — mount/update a small floating
//     node in the page (the connector's Runtime.evaluate). cdpMountScript()
//     builds that script; it sets textContent, never innerHTML of fetched data.
//   - Native apps: a message to the transparent overlay window
//     (desktop-app/overlay.js) which renders the view. overlayMessage() builds
//     that message.
//
// Deliberately NOT here: hooking a GPU present/draw call (Metal/DirectX/Cocoa)
// to blit into the target's own framebuffer. That composites into another
// process's rendering — fragile, per-GPU-API, and the overlay-injection
// technique Morse avoids. The pinned transparent window gets the same result
// without drawing inside the app. See docs/dev/native-dbi.md.
//
// payloadToView() is the shared, pure mapping both mechanisms use, so a payload
// renders the same whether it lands in an Electron page or the native overlay.

// A payload (providers.js) -> a minimal, safe view model. Keeps provenance:
// generated content is flagged so the UI can label it and never present it as
// fact.
export function payloadToView(payload) {
  if (!payload || typeof payload !== "object") return { kind: "empty", title: "", body: "", note: "" };
  if (payload.kind === "lyrics") {
    const head = [payload.title, payload.artist].filter(Boolean).join(" — ");
    if (payload.status === "ok") {
      return { kind: "lyrics", title: head, lines: payload.lines.map(l => ({ ms: l.ms, text: l.text })),
        synced: !!payload.synced, source: payload.source || "", generated: !!payload.generated, note: "" };
    }
    // no-source / not-found / anything else: show the honest message, no lines.
    return { kind: "lyrics", title: head, lines: [], synced: false, source: payload.source || "",
      generated: false, note: payload.message || "No lyrics." };
  }
  // generic payloads
  return { kind: payload.kind || "info", title: payload.title || "", body: payload.body || payload.message || "",
    source: payload.source || "", generated: !!payload.generated, note: payload.generated ? "generated" : "" };
}

// For the native overlay window: an IPC message the overlay page renders.
export function overlayMessage(payload) {
  return { channel: "morse-overlay:data", data: payloadToView(payload) };
}

// For Electron over CDP: a self-contained script that mounts (once) and updates
// a fixed floating node. Data is embedded as a JSON string and read with
// JSON.parse; text goes in via textContent. Returns the string to
// Runtime.evaluate. ID is fixed so repeated calls update in place.
export function cdpMountScript(payload) {
  const view = payloadToView(payload);
  const json = JSON.stringify(view).replace(/</g, "\\u003c"); // can't break out of the string
  return `(() => {
  const v = JSON.parse(${JSON.stringify(json)});
  const ID = "morse-service-hud";
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div"); el.id = ID;
    el.style.cssText = "position:fixed;z-index:2147483646;right:16px;bottom:16px;max-width:380px;padding:12px 14px;border-radius:12px;background:rgba(17,17,19,.92);color:#ededef;font:13px/1.5 Inter,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45);pointer-events:none";
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = "";
  const h = document.createElement("div"); h.style.cssText = "font-weight:600;margin-bottom:4px"; h.textContent = v.title || "Morse"; el.appendChild(h);
  if (v.note) { const n = document.createElement("div"); n.style.cssText = "opacity:.6"; n.textContent = v.note; el.appendChild(n); }
  for (const line of (v.lines || []).slice(0, 8)) { const p = document.createElement("div"); p.textContent = line.text; el.appendChild(p); }
  if (v.generated) { const g = document.createElement("div"); g.style.cssText = "margin-top:6px;font-size:11px;opacity:.5"; g.textContent = "generated"; el.appendChild(g); }
})();`;
}

// Ties a payload to whichever sink is wired. `apply` is injected: for native,
// (msg)=>win.webContents.send(msg.channel, msg.data); for Electron,
// (script)=>session.evaluate(script). Kept injectable so it's testable.
export function createRenderer({ mode, apply }) {
  if (typeof apply !== "function") throw new TypeError("renderer needs an apply(sink) function");
  return {
    mode,
    render(payload) { return apply(mode === "cdp" ? cdpMountScript(payload) : overlayMessage(payload)); },
    clear() { return apply(mode === "cdp" ? `document.getElementById("morse-service-hud")?.remove();` : { channel: "morse-overlay:data", data: null }); },
  };
}
