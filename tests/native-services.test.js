// The services pipeline (native-dbi/services/*): the bus (caching, dedup,
// rate-limit, change detection, error isolation), provider honesty, the render
// mapping, and end-to-end tap → bus → renderer. All pure — no Frida, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { ServiceBus } from "../native-dbi/services/bus.js";
import { lyricsProvider, lookupProvider, defineProvider } from "../native-dbi/services/providers.js";
import { payloadToView, overlayMessage, cdpMountScript } from "../native-dbi/services/render.js";
import { createServiceRuntime } from "../native-dbi/services/index.js";

const track = (title, artist = "Kiasmos") => ({ type: "track", title, artist });

test("bus: only a changed key does real work; repeats serve cache", async () => {
  let calls = 0;
  const provider = defineProvider({
    name: "lyrics", match: e => e.type === "track", key: e => e.title,
    fetch: async e => { calls++; return { kind: "lyrics", status: "ok", title: e.title, lines: [{ ms: 0, text: "la" }] }; },
  });
  const results = [];
  const bus = new ServiceBus({ providers: [provider] });
  bus.on("result", r => results.push(r.cached));

  await bus.handle(track("Blurred")); // new → fetch
  await bus.handle(track("Blurred")); // same key → no refetch
  await bus.handle(track("Blurred")); // same again
  await bus.handle(track("Looped"));  // changed → fetch
  assert.equal(calls, 2, "one fetch per distinct track");
  assert.deepEqual(results, [false, false], "two results emitted, both from fresh fetches");
});

test("bus: in-flight de-dup — concurrent same-key events share one fetch", async () => {
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  const provider = defineProvider({
    name: "p", match: () => true, key: e => e.title,
    fetch: async () => { calls++; await gate; return { ok: true }; },
  });
  const bus = new ServiceBus({ providers: [provider] });
  // Two different-key events can't dedup; use same key via distinct objects.
  const a = bus.handle({ type: "track", title: "X" });
  bus.lastKey.set("p", "__force__"); // force "changed" so the 2nd isn't debounced
  const b = bus.handle({ type: "track", title: "X" });
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1, "concurrent same-key fetches collapse to one");
});

test("bus: rate limit throttles fetches per provider", async () => {
  let now = 1000, calls = 0;
  const provider = defineProvider({ name: "p", match: () => true, key: e => e.title, fetch: async () => { calls++; return { ok: true }; } });
  const bus = new ServiceBus({ providers: [provider], minIntervalMs: 1000, clock: () => now });
  const throttled = [];
  bus.on("throttled", t => throttled.push(t));
  await bus.handle({ type: "t", title: "a" });  // fetch at t=1000
  await bus.handle({ type: "t", title: "b" });  // t still 1000 → throttled
  assert.equal(calls, 1);
  assert.equal(throttled.length, 1);
  now = 2100;
  await bus.handle({ type: "t", title: "c" });  // enough time passed → fetch
  assert.equal(calls, 2);
});

test("bus: a failing provider is isolated, not fatal", async () => {
  const provider = defineProvider({ name: "p", match: () => true, key: e => e.title, fetch: async () => { throw new Error("boom"); } });
  const bus = new ServiceBus({ providers: [provider] });
  const errors = [];
  bus.on("error", e => errors.push(e.error));
  const r = await bus.handle({ type: "t", title: "a" });
  assert.equal(r, null);
  assert.deepEqual(errors, ["boom"]);
});

test("providers: lyrics never invents — honest no-source and real fetch", async () => {
  const noSource = lyricsProvider();
  const p1 = await noSource.fetch(track("Blurred"), {});
  assert.equal(p1.status, "no-source");
  assert.match(p1.message, /won't invent/i);

  const real = lyricsProvider({ endpoint: "https://lrc.example/get" });
  const request = async url => { assert.match(url, /artist=Kiasmos&title=Blurred/); return { lines: [{ ms: 100, text: "first line" }] }; };
  const p2 = await real.fetch(track("Blurred"), { request });
  assert.equal(p2.status, "ok");
  assert.equal(p2.generated, false);
  assert.equal(p2.synced, true);
  assert.deepEqual(p2.lines, [{ ms: 100, text: "first line" }]);

  const empty = await real.fetch(track("Unknown"), { request: async () => ({ lines: [] }) });
  assert.equal(empty.status, "not-found");
});

test("render: payloadToView keeps provenance; cdp script is textContent-only", () => {
  const ok = payloadToView({ kind: "lyrics", status: "ok", title: "Blurred", artist: "Kiasmos", synced: true, lines: [{ ms: 0, text: "hi" }] });
  assert.equal(ok.title, "Blurred — Kiasmos");
  assert.equal(ok.lines.length, 1);

  const none = payloadToView({ kind: "lyrics", status: "no-source", message: "no source" });
  assert.deepEqual(none.lines, []);
  assert.equal(none.note, "no source");

  const gen = payloadToView({ kind: "info", body: "a guess", generated: true });
  assert.equal(gen.note, "generated", "generated content is flagged");

  const script = cdpMountScript({ kind: "lyrics", status: "ok", title: "T", artist: "A", lines: [{ ms: 0, text: "x" }] });
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.equal(overlayMessage({ kind: "lyrics", status: "ok", title: "T", lines: [] }).channel, "morse-overlay:data");
});

test("render: cdpMountScript can't be broken out of by payload text", () => {
  const script = cdpMountScript({ kind: "info", title: "</script><img src=x onerror=alert(1)>", body: "x" });
  assert.doesNotMatch(script, /<\/script>/i, "a literal </script> from data must be escaped");
});

test("end-to-end: a tap flows through the bus to the renderer", async () => {
  const session = new EventEmitter();
  const rendered = [];
  const provider = lyricsProvider({ endpoint: "https://lrc.example" });
  const request = async () => ({ lines: [{ ms: 0, text: "la la" }] });
  const rt = createServiceRuntime({
    session, providers: [provider], mode: "overlay",
    apply: msg => rendered.push(msg), request, minIntervalMs: 0,
  });

  session.emit("tap", { id: "m1", data: track("Blurred") });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].channel, "morse-overlay:data");
  assert.equal(rendered[0].data.title, "Blurred — Kiasmos");
  assert.equal(rendered[0].data.lines[0].text, "la la");

  rt.stop();
  assert.deepEqual(rendered.at(-1).data, null, "stop() clears the overlay");
});
