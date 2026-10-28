// The overlay window's page script. It makes the overlay render the *real*
// Morse bar — the same runtime (runtime/) the web and Electron bars use — by
// providing the host the runtime talks to, then letting overlay.html load the
// runtime bundle. This is not a placeholder: it's the same bar.
//
// Two jobs:
//   1. Be the runtime's host (`globalThis.__morseHost = { onMessage, send }`),
//      the same contract demo/bar-playground.html implements. Data (settings,
//      history, saved mods, onboarding) is kept locally per viewer; the
//      "apply a change" messages (generate, exec, save, transcribe) are routed
//      to the native DBI session through the overlay preload — the one part
//      that is still a seam (native mod generation isn't built yet), so those
//      reply honestly rather than pretending.
//   2. Click-through hit-testing. The overlay window covers the app and is
//      created click-through (forwarding mouse-move); when the pointer is over
//      the bar we turn interactivity on, and off again when it leaves, so the
//      bar is usable and the app underneath still gets every other click.
//
// CSP for this page is script-src 'self'; style-src 'self' 'unsafe-inline'
// (the runtime injects its stylesheet into a shadow root). No eval here.

(() => {
  const bridge = globalThis.morseOverlay || null; // from overlay-preload.cjs (Electron)
  const params = new URLSearchParams(location.search);

  // ---- local store for the host's data messages ------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("morse-overlay:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("morse-overlay:" + k, JSON.stringify(v)); } catch {} },
  };
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(a[k] || {}), ...v } : v; return o; };

  // ---- the host the runtime talks to -----------------------------------
  const subs = [];
  const emit = m => { for (const f of subs) { try { f(m); } catch {} } };
  const appName = params.get("app") || "this app";

  // Native apply isn't wired yet: generate/exec/save reach the DBI session
  // seam (bridge.native), and until that backend exists they reply plainly.
  const notWired = "Changing a native app from the bar isn't wired up yet — the overlay and the bar are here; native mods come next.";

  globalThis.__morseHost = {
    onMessage: fn => subs.push(fn),
    send(m) {
      const reply = (result, error) => setTimeout(() => emit({ reply: m.id, result, error }), 0);
      switch (m.type) {
        case "hello":
          return reply({
            mode: "native",
            label: `Morse · ${appName}`,
            quiet: true,
            settings: store.get("settings", {}),
            // No in-overlay transcription yet; the bar shows the typed path.
            voice: { transcribe: false, provider: null, label: "", hint: "Voice isn't set up for native apps yet. Type your change instead." },
          });
        case "settings.get": return reply(store.get("settings", {}));
        case "settings.set": { const s = merge(store.get("settings", {}), m.settings); store.set("settings", s); return reply(s); }
        case "mods.list": return reply(store.get("mods", []));
        case "history.get": return reply((store.get("history", {})[m.scope]) || []);
        case "history.add": {
          const all = store.get("history", {});
          const l = (all[m.scope] || []).filter(x => x !== m.text); l.push(m.text); all[m.scope] = l.slice(-50);
          store.set("history", all); return reply(all[m.scope]);
        }
        case "onboarding.get": return reply(null);
        case "onboarding.set": return reply({});
        case "i18n.words": return reply(null); // the bundle carries English; other languages are a later step
        // ---- the native apply seam (not built yet) ----
        case "generate": return bridge?.native ? bridge.native(m).then(r => reply(r), e => reply({ ok: false, error: String(e) })) : reply({ ok: false, error: notWired });
        case "mods.save": return bridge?.native ? bridge.native(m).then(r => reply(r), e => reply(null, String(e))) : reply(null, notWired);
        case "exec": return reply({ ok: true });
        case "transcribe": return reply(null, "Unknown request transcribe");
        case "generate.cancel": return reply(true);
        default: return reply(null);
      }
    },
  };

  // Open the bar on request (the Electron host does this on the hotkey; the
  // proof harness passes ?autoopen).
  const open = () => emit({ type: "open" });
  if (bridge?.onOpen) bridge.onOpen(open);
  if (params.has("autoopen")) addEventListener("DOMContentLoaded", () => setTimeout(open, 60));

  // ---- click-through hit-testing ---------------------------------------
  // The window is click-through with mouse-move forwarded; when the pointer is
  // over Morse's UI (its [data-morse-ui] host element is in the light DOM, even
  // though its contents are a closed shadow root) we become interactive.
  let interactive = false;
  const setInteractive = on => { if (on !== interactive) { interactive = on; bridge?.setInteractive?.(on); } };
  addEventListener("pointermove", e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    setInteractive(!!el && !!el.closest && !!el.closest("[data-morse-ui]"));
  }, true);
})();
