// The Frida agent: this source is loaded *inside the target process* by
// frida-runner.js (session.createScript). It runs in Frida's JS runtime with
// the Frida API (Module, Interceptor, Memory, NativeCallback, rpc) in scope —
// not in Node. It is a string/template to Node; don't import it.
//
// Its whole job is to install the mods the runner sends, one at a time, with
// each hook wrapped so a failure is isolated: a mod that throws is reverted and
// reported, and the host process keeps running. Nothing is persisted; detach()
// reverts everything and leaves the process as it was found.
//
// Kept as an exported template literal so frida-runner.js stays pure Node and
// this stays readable here. `MODS_PLACEHOLDER` is replaced with the JSON array
// of validated, active ModSpecs at load time.

export const AGENT_SOURCE = String.raw`
"use strict";

// Every hook we install, so detach can revert exactly what we touched.
// id -> { listener?, target, reverted }
const installed = new Map();

function report(level, modId, message, extra) {
  send({ type: "mod", level: level, id: modId, message: message, extra: extra || null });
}

// Resolve a ModSpec's target to a NativePointer, or throw with a reason.
function resolveTarget(t) {
  const mod = Process.findModuleByName(t.module) || (function () {
    // allow a basename match: "Player" for ".../Player" or "Player.dll"
    const all = Process.enumerateModules();
    return all.find(function (m) { return m.name === t.module; })
        || all.find(function (m) { return m.name.indexOf(t.module) === 0; });
  })();
  if (!mod) throw new Error("module not loaded: " + t.module);

  if (t.kind === "export") {
    const p = Module.findExportByName(mod.name, t.symbol) || Module.findExportByName(null, t.symbol);
    if (!p) throw new Error("export not found: " + t.symbol);
    return p;
  }
  if (t.kind === "offset") {
    const off = (typeof t.offset === "string") ? parseInt(t.offset, 16) : t.offset;
    if (!(off >= 0)) throw new Error("bad offset");
    return mod.base.add(off);
  }
  if (t.kind === "signature") {
    // Search the module's readable, executable ranges for the pattern. Require
    // exactly one hit, matching sigscan.resolveOffset's "ambiguous ⇒ refuse".
    const ranges = mod.enumerateRanges("r-x");
    const hits = [];
    for (let i = 0; i < ranges.length && hits.length < 2; i++) {
      const r = ranges[i];
      try {
        const found = Memory.scanSync(r.base, r.size, t.pattern);
        for (let j = 0; j < found.length && hits.length < 2; j++) hits.push(found[j].address);
      } catch (e) { /* unreadable range; skip */ }
    }
    if (hits.length === 0) throw new Error("signature not found in " + mod.name);
    if (hits.length > 1) throw new Error("signature is ambiguous in " + mod.name);
    return hits[0];
  }
  throw new Error("unknown target kind: " + t.kind);
}

// Install one mod. Any throw is the caller's to catch, revert, and report.
function installOne(spec) {
  const addr = resolveTarget(spec.target);
  const a = spec.action;

  if (a.kind === "observe") {
    // Read-only: an Interceptor.attach whose callbacks only observe. The bodies
    // are mod-authored JS; they run with { args/retval, log, emit } in scope.
    // emit(obj) sends a minimal JSON event out to the daemon (services/bus.js) —
    // the tap. The heavy work (lookups, keys, caching) happens there, not here.
    const onEnter = a.onEnter ? new Function("args", "log", "emit", a.onEnter) : null;
    const onLeave = a.onLeave ? new Function("retval", "log", "emit", a.onLeave) : null;
    const log = function (m) { report("info", spec.id, String(m)); };
    const emit = function (obj) { try { send({ type: "tap", id: spec.id, data: obj }); } catch (e) { report("error", spec.id, "emit: " + e.message); } };
    const listener = Interceptor.attach(addr, {
      onEnter: function (args) { if (onEnter) { try { onEnter(args, log, emit); } catch (e) { report("error", spec.id, "onEnter: " + e.message); } } },
      onLeave: function (retval) { if (onLeave) { try { onLeave(retval, log, emit); } catch (e) { report("error", spec.id, "onLeave: " + e.message); } } },
    });
    installed.set(spec.id, { listener: listener, target: addr, reverted: false });
    return;
  }

  if (a.kind === "replace") {
    // Behaviour change: swap the function for a NativeCallback. The body is
    // mod-authored JS returning the replacement value; it gets the original
    // (an orig(...) NativeFunction) so a replacement can still call through.
    const argTypes = a.argTypes || [];
    const orig = new NativeFunction(addr, a.retType, argTypes);
    const make = new Function("orig", "log", "args", a.body); // returns the ret value
    const log = function (m) { report("info", spec.id, String(m)); };
    const cb = new NativeCallback(function () {
      const args = Array.prototype.slice.call(arguments);
      try { return make(orig, log, args); }
      catch (e) { report("error", spec.id, "replacement threw: " + e.message); return orig.apply(null, args); }
    }, a.retType, argTypes);
    Interceptor.replace(addr, cb);
    installed.set(spec.id, { target: addr, replaced: true, keepAlive: cb, orig: orig, reverted: false });
    return;
  }

  throw new Error("unknown action kind: " + a.kind);
}

function revertOne(id) {
  const rec = installed.get(id);
  if (!rec || rec.reverted) return;
  try {
    if (rec.listener) rec.listener.detach();
    if (rec.replaced) Interceptor.revert(rec.target);
  } catch (e) { report("error", id, "revert: " + e.message); }
  rec.reverted = true;
  installed.delete(id);
}

// Apply a batch. Each mod is independent: one failing neither stops the others
// nor leaves a half-installed hook behind.
function applyAll(specs) {
  Interceptor.flush();
  const results = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    try {
      installOne(spec);
      results.push({ id: spec.id, status: "applied" });
      report("applied", spec.id, "ok");
    } catch (e) {
      revertOne(spec.id); // undo anything partial for this mod
      results.push({ id: spec.id, status: "errored", error: e.message });
      report("error", spec.id, e.message);
    }
  }
  Interceptor.flush();
  return results;
}

function detachAll() {
  const ids = Array.from(installed.keys());
  for (let i = 0; i < ids.length; i++) revertOne(ids[i]);
  Interceptor.flush();
  return { reverted: ids.length };
}

// The runner calls these over Frida's rpc bridge.
rpc.exports = {
  apply: function (specs) { return applyAll(specs || MODS_PLACEHOLDER); },
  revert: function (id) { revertOne(id); return { id: id }; },
  detach: function () { return detachAll(); },
  status: function () {
    return Array.from(installed.entries()).map(function (e) { return { id: e[0], reverted: e[1].reverted }; });
  },
};

// If the script is unloaded out from under us (process exiting, runner gone),
// leave the target clean.
Script.bindWeak(installed, function () { try { detachAll(); } catch (e) {} });
`;

// Produce the final agent source with the mod batch inlined (so `apply()` with
// no argument still works, and the mods travel with the script).
export function buildAgentSource(specs = []) {
  return AGENT_SOURCE.replace("MODS_PLACEHOLDER", JSON.stringify(specs));
}
