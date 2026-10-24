// In-flight generations, so `generate.cancel { genId }` can abort the model
// call. Shared by the desktop connector and the extension service worker.

export const CANCELLED = Object.freeze({ ok: false, cancelled: true, error: "Stopped" });

export class Generations {
  #live = new Map();

  // run(signal) -> result. A cancelled run resolves to CANCELLED, never throws.
  async run(genId, run) {
    const ac = new AbortController();
    this.#live.set(genId, ac);
    try {
      const res = await run(ac.signal);
      return ac.signal.aborted ? { ...CANCELLED } : res;
    } catch (e) {
      if (ac.signal.aborted) return { ...CANCELLED };
      throw e;
    } finally {
      if (this.#live.get(genId) === ac) this.#live.delete(genId);
    }
  }

  cancel(genId) {
    const ac = this.#live.get(genId);
    ac?.abort();
    return !!ac;
  }

  get size() { return this.#live.size; }
}
