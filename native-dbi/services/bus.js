// The service bus: the "local daemon" half of real native features.
//
// A tap inside the app (an observe mod that calls emit({...}), see agent.js)
// sends a minimal JSON event out over Frida's channel — song changed, document
// opened, whatever. The bus receives those events and turns them into results
// by calling real external services (a lyrics source, a local Whisper, an LLM),
// OUTSIDE the target process. All the heavy, stateful, key-holding work —
// caching, rate limiting, de-duplicating, formatting — lives here, never in the
// hooked app's memory. Results go to a renderer (render.js) to show in the app.
//
// Pure and dependency-free: providers, the clock, and the event source are all
// injected, so caching/rate-limit/dedup are unit-testable without Frida, a
// network, or a target.

import { EventEmitter } from "node:events";

// A Provider is { name, match(event)->bool, key(event)->string,
//   fetch(event, ctx)->payload, ttlMs? }. `fetch` does the real I/O (it gets an
//   injected `request` in ctx so it never hardcodes transport); it returns a
//   payload object, or throws. Providers that report facts must fetch them from
//   a real source — see providers.js; the bus never invents data.
export class ServiceBus extends EventEmitter {
  constructor({ providers = [], clock = Date.now, minIntervalMs = 0, cacheMax = 200 } = {}) {
    super();
    this.providers = providers;
    this.clock = clock;
    this.minIntervalMs = minIntervalMs; // floor between real fetches per provider
    this.cacheMax = cacheMax;
    this.cache = new Map();   // "provider\u0000key" -> { payload, at }
    this.inflight = new Map(); // "provider\u0000key" -> Promise
    this.lastFetchAt = new Map(); // provider.name -> timestamp
    this.lastKey = new Map();  // provider.name -> last key handled (change detection)
  }

  providerFor(event) { return this.providers.find(p => { try { return p.match(event); } catch { return false; } }) || null; }

  // Feed one tap event. Returns the result payload (from cache or a fresh
  // fetch), or null when nothing handles it / it's a duplicate that's been
  // debounced. Emits "result" { event, payload, provider } and "error".
  async handle(event, { request } = {}) {
    const provider = this.providerFor(event);
    if (!provider) return null;

    let key;
    try { key = String(provider.key(event)); } catch { return null; }
    const cacheKey = `${provider.name}\u0000${key}`;

    // Change detection: taps fire often (a progress timestamp every second);
    // only the first event of a new key does real work.
    const changed = this.lastKey.get(provider.name) !== key;
    this.lastKey.set(provider.name, key);

    // Fresh cache hit → serve it (even on an unchanged repeat, cheaply).
    const cached = this.cache.get(cacheKey);
    if (cached && !this.#expired(cached, provider)) {
      if (changed) this.emit("result", { event, payload: cached.payload, provider: provider.name, cached: true });
      return cached.payload;
    }
    if (!changed) return null; // same key, nothing cached yet but already being handled

    // In-flight de-dup: one fetch per key at a time.
    if (this.inflight.has(cacheKey)) return this.inflight.get(cacheKey);

    // Rate limit per provider.
    const now = this.clock();
    const last = this.lastFetchAt.get(provider.name) || 0;
    if (this.minIntervalMs && now - last < this.minIntervalMs) {
      this.emit("throttled", { event, provider: provider.name, waitMs: this.minIntervalMs - (now - last) });
      return null;
    }

    const promise = (async () => {
      this.lastFetchAt.set(provider.name, this.clock());
      try {
        const payload = await provider.fetch(event, { request, key });
        this.#store(cacheKey, payload);
        this.emit("result", { event, payload, provider: provider.name, cached: false });
        return payload;
      } catch (err) {
        // One provider failing never takes down the bus or the app.
        this.emit("error", { event, provider: provider.name, error: err?.message || String(err) });
        return null;
      } finally {
        this.inflight.delete(cacheKey);
      }
    })();
    this.inflight.set(cacheKey, promise);
    return promise;
  }

  #expired(entry, provider) {
    const ttl = provider.ttlMs;
    return ttl != null && this.clock() - entry.at > ttl;
  }

  #store(cacheKey, payload) {
    this.cache.set(cacheKey, { payload, at: this.clock() });
    // Simple LRU-ish cap: drop oldest insertions.
    while (this.cache.size > this.cacheMax) this.cache.delete(this.cache.keys().next().value);
  }

  clear() { this.cache.clear(); this.inflight.clear(); this.lastKey.clear(); this.lastFetchAt.clear(); }
}
