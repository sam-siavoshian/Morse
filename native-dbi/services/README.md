# `native-dbi/services/` — real features & external data

The pipeline that lets a native mod do something *real* — fetch synced lyrics,
transcribe with a local Whisper, look something up — instead of faking it. It's
the honest answer to the Spotify-lyrics ask the bar rightly refused: no service
in the app means no fake "Generate" button; a configured real source means a
real feature.

```
  inside the app            the daemon (here)             back into the app
  ┌───────────────┐  tap   ┌──────────────┐  result  ┌──────────────────────┐
  │ observe mod   │ ─────► │  ServiceBus  │ ───────► │ renderer             │
  │ emit({...})   │  JSON  │  providers,  │          │  Electron: CDP DOM    │
  │ (agent.js)    │  over  │  cache,      │          │  native: overlay msg  │
  └───────────────┘  IPC   │  rate-limit  │          └──────────────────────┘
                           └──────────────┘
```

## The three parts

1. **The tap** (`agent.js`). An `observe` mod hooks the app's state/playback
   function and calls `emit({...})` — a minimal JSON event out over Frida's
   channel. No network, keys, or heavy logic run inside the target; the tap just
   reports what changed.
2. **The bus** (`bus.js`). The daemon receives taps and turns them into results
   with real **providers** (`providers.js`): caching, per-provider rate limits,
   in-flight de-duplication, and change detection (a progress tick every second
   doesn't re-fetch — only a new song does). A failing provider is isolated.
3. **The render** (`render.js`). A result is shown back: **Electron** via a CDP
   DOM injection (`cdpMountScript`, textContent only — never `innerHTML` of
   fetched data), **native** via a message to the transparent overlay window
   (`overlayMessage`). `payloadToView` is the shared mapping, so a payload looks
   the same either way.

## Integrity

Baked in, not optional: a provider that reports **facts** fetches them from a
real source the user configured and returns an honest empty state when there's
none — it does **not** invent them (`lyricsProvider` never generates lyrics). A
provider that **generates** marks its payload `generated: true` so the render
layer labels it and never passes it off as ground truth.

## Not here, on purpose

The render layer does **not** hook a GPU present/draw call (Metal/DirectX/Cocoa)
to blit into the target's own framebuffer. That draws inside another process's
rendering — fragile, per-GPU-API, and the overlay-injection technique Morse
avoids. The pinned transparent window achieves the same result without it.

## Try it

```bash
cc -O1 -o native-dbi/example/ticketd native-dbi/example/ticketd.c && strip native-dbi/example/ticketd
node native-dbi/example/live-feature.mjs   # needs `npm install frida`
```

A tap on the running binary emits each purchase; the bus routes it to a
provider; the renderer prints the tier — tap → daemon → render, live. Covered
by `tests/native-services.test.js` (bus, providers, render, end-to-end; pure,
no Frida needed).
