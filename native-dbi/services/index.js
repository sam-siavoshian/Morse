// The services pipeline, tied together: a native session's taps → the bus →
// the renderer. This is the "add a real feature" path — e.g. a tap on the
// player's state emits {type:'track', title, artist}; the bus fetches synced
// lyrics from a configured source; the renderer shows them over the app.
//
// Everything external is injected (providers, the request function, the render
// sink), so this composes the pieces without binding to Frida, a network, or a
// window — the same modules power an Electron page (CDP) and a native overlay.

import { ServiceBus } from "./bus.js";
import { createRenderer } from "./render.js";

export { ServiceBus } from "./bus.js";
export { lyricsProvider, lookupProvider, defineProvider } from "./providers.js";
export { payloadToView, overlayMessage, cdpMountScript, createRenderer } from "./render.js";

// session   a NativeSession (frida-runner.js); emits "tap" { id, data }.
// providers an array of providers (providers.js).
// mode      "overlay" (native, message to the overlay window) or "cdp" (Electron).
// apply     the render sink: (msg|script) -> void. For overlay,
//           (m)=>win.webContents.send(m.channel, m.data); for cdp,
//           (s)=>cdpSession.evaluate(s).
// request   how providers reach the network: (url, opts) -> parsed response.
// Returns { bus, renderer, stop() }.
export function createServiceRuntime({ session, providers = [], mode = "overlay", apply, request, minIntervalMs = 1500, onResult, onError } = {}) {
  const bus = new ServiceBus({ providers, minIntervalMs });
  const renderer = createRenderer({ mode, apply });

  bus.on("result", ({ payload, cached }) => { try { renderer.render(payload); } catch (e) { onError?.({ error: e?.message }); } onResult?.(payload, cached); });
  bus.on("error", e => onError?.(e));

  const onTap = ev => { bus.handle(ev.data, { request }).catch(e => onError?.({ error: e?.message })); };
  session?.on?.("tap", onTap);

  return {
    bus,
    renderer,
    stop() {
      try { session?.off?.("tap", onTap); } catch {}
      try { renderer.clear(); } catch {}
      bus.clear();
    },
  };
}
