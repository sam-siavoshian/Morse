// The host-side (Node) Frida runner.
//
// Attaches to an already-running, user-owned process, loads the agent
// (agent.js) into it, applies the mods, and manages the lifecycle so the
// target is never left in a half-instrumented state and the host app does not
// crash if a script fails.
//
// `frida` is an OPTIONAL dependency, imported dynamically. Morse's daemon/ ships
// with one dependency and must keep working with no native addons; native mods
// are opt-in and the person installs `frida` themselves. Absent frida ⇒ a clean
// diagnostic, never a throw at import time.
//
// It does not spawn, patch, re-sign, or elevate. It attaches to a PID that
// discover.js found and boundaries.authorizeTarget approved, and it refuses to
// attach otherwise.

import { EventEmitter } from "node:events";
import { assess } from "./boundaries.js";
import { buildAgentSource } from "./agent.js";
import { validateModSpec, isApplicable } from "./schema.js";

// Load frida lazily. Returns the module or null.
let _frida = null, _triedFrida = false;
export async function loadFrida() {
  if (_triedFrida) return _frida;
  _triedFrida = true;
  try { _frida = (await import("frida")).default ?? (await import("frida")); }
  catch { _frida = null; }
  return _frida;
}

export function fridaMissingMessage() {
  return "Native mods need Frida, which isn't installed. Add it with `npm install frida` (a native addon, downloaded per-platform). It stays optional: Morse's other features don't use it.";
}

// A live attachment. Events:
//   "mod"      { level, id, message }  — from a mod inside the target
//   "detached" { reason }              — session ended (target exited/crashed, or we detached)
//   "error"    Error                   — runner-level error, never thrown at the host
export class NativeSession extends EventEmitter {
  constructor(context) { super(); this.context = context; this.device = null; this.session = null; this.script = null; this.applied = []; }

  // Attach + load the agent. Returns { ok, diagnostics } — it does not throw on
  // a blocked target; it reports why. Throwing is reserved for genuine bugs.
  async attach(specs) {
    const frida = await loadFrida();
    if (!frida) return { ok: false, reason: "frida-missing", diagnostics: fridaMissingMessage() };

    // The gate + platform probe. We do not attach past a blocking restriction.
    const verdict = assess(this.context);
    if (!verdict.attachable) return { ok: false, reason: "blocked", diagnostics: verdict.text };

    try {
      this.device = await frida.getLocalDevice();
      this.session = await this.device.attach(this.context.pid);
      // If the target dies for its own reasons, surface it — don't let it look
      // like our crash.
      this.session.detached.connect(reason => this.emit("detached", { reason: String(reason) }));
    } catch (e) {
      // The most common real-world failure: the OS refused the attach despite
      // our probe (timing, a protection we couldn't read statically).
      return { ok: false, reason: "attach-failed", diagnostics: `Couldn't attach to PID ${this.context.pid}: ${e.message}. ${verdict.text}` };
    }

    const ready = specs.filter(s => isApplicable(s, this.context));
    try {
      this.script = await this.session.createScript(buildAgentSource(ready));
      this.script.message.connect(m => this.#onMessage(m));
      await this.script.load();
    } catch (e) {
      await this.detach();
      return { ok: false, reason: "script-failed", diagnostics: `Agent failed to load: ${e.message}` };
    }

    try {
      this.applied = await this.script.exports.apply(ready);
    } catch (e) {
      // A failure here is isolated in the agent per-mod; reaching this means the
      // rpc call itself failed. Keep the session, report, don't crash.
      this.emit("error", e);
      this.applied = ready.map(s => ({ id: s.id, status: "errored", error: e.message }));
    }
    return { ok: true, applied: this.applied, diagnostics: verdict.text };
  }

  #onMessage(m) {
    // Frida wraps our send() payloads as { type:"send", payload }. A script
    // error (uncaught in the agent) comes as { type:"error", ... } — report it,
    // never rethrow into the host.
    if (m?.type === "send" && m.payload?.type === "mod") {
      const p = m.payload;
      this.emit("mod", { level: p.level, id: p.id, message: p.message, extra: p.extra });
    } else if (m?.type === "send" && m.payload?.type === "tap") {
      // A tap event from inside the app → the services bus (services/bus.js).
      this.emit("tap", { id: m.payload.id, data: m.payload.data });
    } else if (m?.type === "error") {
      this.emit("error", new Error(`agent: ${m.description || m.stack || "script error"}`));
    }
  }

  // Apply more mods into an already-attached session (the agent installs each
  // and leaves the rest alone). Returns per-mod results, or a single errored
  // row if the rpc call itself fails. Validated+applicable specs only.
  async apply(specs = []) {
    const ready = specs.filter(s => isApplicable(s, this.context));
    if (!ready.length || !this.script) return ready.map(s => ({ id: s.id, status: "errored", error: "no session" }));
    try {
      const res = await this.script.exports.apply(ready);
      for (const r of res) { const i = this.applied.findIndex(a => a.id === r.id); if (i >= 0) this.applied[i] = r; else this.applied.push(r); }
      return res;
    } catch (e) {
      // emit("error") with no listener throws (Node), which would swallow the
      // return below. Only emit when something is listening.
      if (this.listenerCount("error")) this.emit("error", e);
      return ready.map(s => ({ id: s.id, status: "errored", error: e.message }));
    }
  }

  // Revert a single mod in the running target. Returns whether it succeeded, so
  // the caller only marks a mod off once the hook is actually gone.
  async revert(id) {
    try { const r = await this.script?.exports.revert(id); return !r || r.ok !== false; }
    catch (e) { if (this.listenerCount("error")) this.emit("error", e); return false; }
  }

  // Clean detach: revert every hook inside the target, unload the script, then
  // detach the session — in that order, so nothing is left behind. Safe to call
  // more than once and safe if attach never completed.
  async detach() {
    try { if (this.script) await this.script.exports.detach(); } catch (e) { this.emit("error", e); }
    try { if (this.script) await this.script.unload(); } catch {}
    try { if (this.session) await this.session.detach(); } catch {}
    this.script = null; this.session = null;
    this.emit("detached", { reason: "requested" });
  }

  async status() { try { return await this.script?.exports.status(); } catch { return null; } }
}

// Validate specs before anything attaches. Returns { active, invalid } where
// invalid carries each spec's reasons — surfaced, not silently dropped.
export function triage(specs = []) {
  const active = [], invalid = [];
  for (const s of specs) {
    const v = validateModSpec(s);
    if (!v.ok) invalid.push({ id: s?.id, errors: v.errors });
    else if (s.active) active.push(s);
  }
  return { active, invalid };
}
