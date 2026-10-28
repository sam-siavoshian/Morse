// The native "apply" plumbing: turn a bar request into an applied, saved,
// revertible native mod, and report back.
//
//   bar submit → plan (a ModSpec) → apply via the session → save → report
//
// What this module owns: planning's wiring, applying through the live session,
// tracking what's active, persisting with store.js, and undo. What it does NOT
// own: writing the hook from plain English — "hide the sidebar" → which
// function, what to change. That's the model's job, injected as `planner`; it's
// the genuinely hard, not-yet-solved part, so it's a seam, not a pretend
// feature. A request that already carries a target+action (a direct mod, or one
// a model produced) is applied as-is with no planner needed.

import { createModSpec, validateModSpec } from "./schema.js";
import { createStore, keyFor } from "./store.js";

export class NativeModService {
  // session  a NativeSession (frida-runner.js) — apply(specs)/revert(id).
  // context  the TargetContext (which app), for match + the store key.
  // planner  async (request, context) -> { ok, spec } | { ok, error }. The model
  //          seam. Omit it and free-text requests get an honest refusal.
  // store    createStore() by default; injectable for tests.
  constructor({ session, context, planner = null, store = createStore(), onEvent = null } = {}) {
    this.session = session;
    this.context = context || {};
    this.planner = typeof planner === "function" ? planner : null;
    this.store = store;
    this.key = keyFor(context);
    this.onEvent = onEvent;
    this.active = new Map(); // id -> spec currently installed in the target
  }

  // A bar request → a ModSpec. request: { prompt, title?, target?, action? }.
  async plan(request) {
    const match = { exe: this.context.exe || null, format: this.context.format || null };
    // Direct: the request already says what to hook and do (manual, or model-made).
    if (request && request.target && request.action) {
      const spec = createModSpec({ title: request.title || request.prompt, target: request.target, action: request.action, match, active: true });
      const v = validateModSpec(spec);
      return v.ok ? { ok: true, spec } : { ok: false, error: v.errors.join("; ") };
    }
    // Otherwise the model has to write the hook.
    if (this.planner) {
      let out;
      try { out = await this.planner(request, this.context); } catch (e) { return { ok: false, error: `planner failed: ${e?.message || e}` }; }
      if (!out || !out.ok) return { ok: false, error: out?.error || "couldn't work out a change for that" };
      const spec = createModSpec({ title: request?.prompt, ...out.spec, match: { ...match, ...(out.spec?.match || {}) }, active: true });
      const v = validateModSpec(spec);
      return v.ok ? { ok: true, spec } : { ok: false, error: v.errors.join("; ") };
    }
    return { ok: false, error: "To change a native app from a sentence, Morse needs a model to write the hook (which function, what to change). None is connected here — give the function or a signature, or connect a model." };
  }

  // The whole submit path: plan → apply → save. Returns { ok, id, status, spec } | { ok, error }.
  async generate(request) {
    const p = await this.plan(request);
    if (!p.ok) { this.onEvent?.("error", { message: p.error }); return { ok: false, error: p.error }; }
    return this.applySpec(p.spec, { save: true });
  }

  // Apply one ModSpec in the running target and (optionally) remember it.
  async applySpec(spec, { save = false } = {}) {
    // A re-save of an already-live id (the bar's "mods.save" on a mod that's
    // on) must not stack a second hook. Revert the live one first so only the
    // replacement stays tracked — the agent reverts-then-installs too, but
    // making it explicit here keeps the invariant independent of the backend.
    if (this.active.has(spec.id)) { await this.session.revert(spec.id); this.active.delete(spec.id); }
    const results = await this.session.apply([spec]);
    const res = Array.isArray(results) ? results[0] : results;
    if (!res || res.status !== "applied") {
      const error = res?.error || "the app wouldn't take that change";
      this.onEvent?.("error", { id: spec.id, message: error });
      return { ok: false, id: spec.id, error };
    }
    this.active.set(spec.id, spec);
    if (save) {
      try { this.store.upsert(this.key, { ...spec, status: "applied" }); }
      catch (e) {
        // The hook is live and working; a store-write hiccup shouldn't revert
        // it. Report applied-but-unsaved so a retry doesn't double-install.
        this.onEvent?.("error", { id: spec.id, message: `applied but couldn't save: ${e.message}` });
        return { ok: true, id: spec.id, status: "applied", saved: false, spec, warning: `applied but not saved: ${e.message}` };
      }
    }
    this.onEvent?.("applied", { id: spec.id, title: spec.title });
    return { ok: true, id: spec.id, status: "applied", saved: save || undefined, spec };
  }

  // Saved mods for this app, each flagged with whether it's live right now.
  list() { return this.store.list(this.key).map(s => ({ ...s, applied: this.active.has(s.id) })); }

  // Turn a saved mod on (re-apply) or off (revert the hook) — this is Undo.
  async setEnabled(id, on) {
    const saved = this.store.list(this.key).find(s => s.id === id);
    if (!saved) return { ok: false, error: "no such mod" };
    if (on && !this.active.has(id)) return this.applySpec({ ...saved, active: true }, { save: true });
    if (!on && this.active.has(id)) {
      // Only mark it off once the hook is actually gone — a failed revert must
      // not leave the UI saying "off" while the hook runs.
      const reverted = await this.session.revert(id);
      if (!reverted) return { ok: false, id, error: "couldn't revert the hook; left on" };
      this.active.delete(id);
      this.store.upsert(this.key, { ...saved, status: "idle" });
      this.onEvent?.("reverted", { id });
      return { ok: true, id, status: "idle" };
    }
    return { ok: true, id, status: on ? "applied" : "idle" };
  }

  // Forget a mod entirely (revert if live, then drop from the store).
  async remove(id) {
    if (this.active.has(id)) {
      const reverted = await this.session.revert(id);
      if (!reverted) return { ok: false, id, error: "couldn't revert the hook; not removed" };
      this.active.delete(id);
    }
    this.store.remove(this.key, id);
    this.onEvent?.("removed", { id });
    return { ok: true, id, removed: true };
  }

  // Re-apply the app's saved, enabled mods — call on a fresh attach.
  async restore() {
    const out = [];
    for (const s of this.store.list(this.key)) if (s.status !== "idle") out.push(await this.applySpec({ ...s, active: true }));
    return out;
  }

  // Dispatch a bar host message (the overlay forwards these). Keeps the overlay
  // handler a one-liner.
  async handle(msg) {
    switch (msg?.type) {
      case "generate": return this.generate(msg.request || { prompt: msg.text });
      case "mods.list": return this.list();
      case "mods.save": { const s = msg.draft || msg.mod; return s?.id ? this.applySpec({ ...s, active: true }, { save: true }) : { ok: false, error: "nothing to save" }; }
      case "mods.setEnabled": return this.setEnabled(msg.id, !!msg.enabled);
      case "mods.remove": return this.remove(msg.id);
      default: return { ok: false, error: `native service: unknown request ${msg?.type}` };
    }
  }
}
