// A frozen page (desktop): mod code that never returns (`while (true) {}`)
// can't be stopped from inside the page, because nothing else on that thread
// runs until it ends. The connector stops it from outside, over CDP:
//
//   - while a mod's code is in the document (from its first exec until the
//     next navigation), ping the page once a second with Runtime.evaluate
//   - no answer for HANG_MS: Runtime.terminateExecution, which interrupts
//     the running script from the browser side
//   - then ask the kit which mod's code was running (morse.__hung(), which
//     also stops that mod); if the kit can't tell, the mod whose code was
//     being run (an exec still waiting) is the one
//   - the connector turns a saved mod off with why (mod.paused), and reloads
//     the page so it starts clean; a change still being made just fails its
//     run with FROZE_ERROR, and the model gets its second try
//
// Nothing is armed on pages where no mod code ran, so a page that is busy on
// its own is never interrupted by Morse.
//
// The extension can't do this: only a debugger can interrupt a page's script,
// and Morse doesn't ask for that permission. There, a mod whose code doesn't
// finish within HANG_MS of starting is turned off the same way (the page
// stays stuck until Chrome's "Page unresponsive" dialog or a reload), and
// safe start holds back a mod after which the page keeps dying.

import { HANG_MS, FROZE_ERROR } from "../core/guard.js";
export { HANG_MS, FROZE_ERROR };

const race = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]).catch(() => null);

export class HangGuard {
  // onFroze(id | null, { running }) is called once the script was stopped;
  // `running` means the stopped code was an exec still waiting for its result.
  constructor(session, { onFroze, hangMs = HANG_MS, every = 1000 } = {}) {
    Object.assign(this, { s: session, onFroze, hangMs });
    this.armed = false;
    this.ctx = null;            // the main-world context mods ran in
    this.running = new Map();   // mod id -> execs in flight
    this.stopped = new Set();   // mod ids whose exec was stopped
    this.last = new Map();      // mod id -> the code last run under it
    this.timer = setInterval(() => this.tick(), every);
    this.timer.unref?.();
    session.on("close", () => this.stop());
    session.on("Runtime.executionContextsCleared", () => this.reset());
  }
  stop() { clearInterval(this.timer); this.armed = false; }
  reset() { this.armed = false; this.ctx = null; }

  // An exec of a mod's code starts; returns the function that ends it.
  exec(id, ctx, js = "") {
    this.armed = true;
    this.ctx = ctx;
    this.last.set(id, js);
    this.stopped.delete(id);
    this.running.set(id, (this.running.get(id) || 0) + 1);
    return () => { const n = this.running.get(id) - 1; n > 0 ? this.running.set(id, n) : this.running.delete(id); };
  }
  // The code last run under this id (a saved mod's, or a draft's).
  code(id) { return this.last.get(id); }
  // Was this exec stopped because the page froze? (Asked once.)
  froze(id) { return this.stopped.delete(id); }

  tick() {
    if (!this.armed || this.s.closed || this.handling) return;
    if (this.pinging) {
      if (Date.now() - this.pingAt >= this.hangMs) this.rescue();
      return;
    }
    this.pinging = true;
    this.pingAt = Date.now();
    this.s.send("Runtime.evaluate", { expression: "0", returnByValue: true }).catch(() => {}).finally(() => { this.pinging = false; });
  }

  async rescue() {
    this.handling = true;
    try {
      await race(this.s.send("Runtime.terminateExecution"), 2000);
      const r = this.ctx == null ? null
        : await race(this.s.send("Runtime.evaluate", { expression: "globalThis.morse?.__hung?.() ?? null", contextId: this.ctx, returnByValue: true }), 2000);
      const waiting = [...this.running.keys()].at(-1) || null;
      const id = r?.result?.value || waiting;
      const running = !!id && this.running.has(id);
      if (running) this.stopped.add(id);
      await this.onFroze?.(id, { running });
    } catch {} finally {
      this.handling = false;
      this.pinging = false;
    }
  }
}
