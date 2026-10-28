// The native "apply" plumbing (native-dbi/store.js + apply.js): planning a mod
// from a request, applying it through the session, saving, undo (enable/disable),
// remove, and restore. Pure — a fake session and an in-memory store stand in for
// Frida and disk.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore, keyFor } from "../native-dbi/store.js";
import { NativeModService } from "../native-dbi/apply.js";
import { createContext } from "../native-dbi/schema.js";

// In-memory fs for the store.
function memStore() {
  let blob = null;
  const fs = { read: () => { if (blob == null) throw new Error("empty"); return blob; }, write: (_p, c) => { blob = c; }, rename: () => {}, mkdir: () => {} };
  return createStore({ file: "mem", fs });
}

// A fake session that records apply/revert and lets a test force a failure.
// revert() returns whether it succeeded, like the real NativeSession.
function fakeSession({ failIds = [], failRevert = false } = {}) {
  const calls = [];
  return {
    calls,
    async apply(specs) { calls.push(["apply", specs.map(s => s.id)]); return specs.map(s => failIds.includes(s.id) ? { id: s.id, status: "errored", error: "no match" } : { id: s.id, status: "applied" }); },
    async revert(id) { calls.push(["revert", id]); return !failRevert; },
  };
}

const ctx = createContext({ pid: 10, exe: "/apps/Player", format: "elf", arch: "x86_64" });
const directReq = {
  prompt: "mute the startup chime",
  target: { kind: "export", module: "Player", symbol: "play_chime" },
  action: { kind: "replace", retType: "void", argTypes: [], body: "return;" },
};

test("store: saves, lists, upserts and removes per app key", () => {
  const store = memStore();
  const key = keyFor(ctx);
  assert.deepEqual(store.list(key), []);
  store.upsert(key, { id: "a", title: "A" });
  store.upsert(key, { id: "b", title: "B" });
  store.upsert(key, { id: "a", title: "A2" }); // replace by id
  assert.deepEqual(store.list(key).map(s => s.title), ["B", "A2"]);
  store.remove(key, "b");
  assert.deepEqual(store.list(key).map(s => s.id), ["a"]);
  assert.deepEqual(store.list("/other/app"), [], "keyed per app");
});

test("store: a corrupt file throws rather than silently wiping saved mods", () => {
  let blob = "{ not valid json";
  const fs = { read: () => blob, write: (_p, c) => { blob = c; }, rename: () => {}, mkdir: () => {} };
  const store = createStore({ file: "mem", fs });
  assert.throws(() => store.list("k"), /corrupt/);
  // a missing file still reads as empty, not an error
  const missing = createStore({ file: "mem", fs: { read: () => { throw new Error("ENOENT"); }, write: () => {}, rename: () => {}, mkdir: () => {} } });
  assert.deepEqual(missing.list("k"), []);
});

test("apply: a direct request (target+action) applies, reports, and saves", async () => {
  const session = fakeSession();
  const svc = new NativeModService({ session, context: ctx, store: memStore() });
  const r = await svc.generate(directReq);
  assert.equal(r.ok, true);
  assert.equal(r.status, "applied");
  assert.deepEqual(session.calls[0][0], "apply");
  assert.equal(svc.list().length, 1, "saved");
  assert.equal(svc.list()[0].applied, true, "marked live");
});

test("apply: free text with no model is refused honestly (not faked)", async () => {
  const svc = new NativeModService({ session: fakeSession(), context: ctx, store: memStore() });
  const r = await svc.generate({ prompt: "make it faster" });
  assert.equal(r.ok, false);
  assert.match(r.error, /needs a model|connect a model/i);
  assert.equal(svc.list().length, 0, "nothing saved for a request it couldn't plan");
});

test("apply: an injected planner (the model seam) turns words into a mod", async () => {
  const planner = async (req) => req.prompt.includes("chime")
    ? { ok: true, spec: { target: { kind: "export", module: "Player", symbol: "play_chime" }, action: { kind: "replace", retType: "void", argTypes: [], body: "return;" } } }
    : { ok: false, error: "couldn't map that to a function" };
  const svc = new NativeModService({ session: fakeSession(), context: ctx, planner, store: memStore() });
  assert.equal((await svc.generate({ prompt: "silence the chime" })).ok, true);
  assert.equal((await svc.generate({ prompt: "do something vague" })).ok, false);
});

test("apply: a mod the app rejects reports the failure and isn't saved", async () => {
  const session = fakeSession({ failIds: [] });
  // Force the applied spec's id into failIds by intercepting: use a planner that returns a known id? Simpler: make session fail everything.
  const failing = { async apply(specs) { return specs.map(s => ({ id: s.id, status: "errored", error: "signature not found" })); }, async revert() {} };
  const svc = new NativeModService({ session: failing, context: ctx, store: memStore() });
  const r = await svc.generate(directReq);
  assert.equal(r.ok, false);
  assert.match(r.error, /signature not found/);
  assert.equal(svc.list().length, 0, "a failed apply saves nothing");
});

test("undo: setEnabled(false) reverts the hook; (true) re-applies; remove forgets it", async () => {
  const session = fakeSession();
  const svc = new NativeModService({ session, context: ctx, store: memStore() });
  const { id } = await svc.generate(directReq);

  const off = await svc.setEnabled(id, false);
  assert.equal(off.status, "idle");
  assert.ok(session.calls.some(c => c[0] === "revert" && c[1] === id), "reverted in the target");
  assert.equal(svc.list()[0].applied, false);

  const on = await svc.setEnabled(id, true);
  assert.equal(on.ok, true);
  assert.equal(svc.list()[0].applied, true, "re-applied");

  await svc.remove(id);
  assert.equal(svc.list().length, 0, "removed from the store");
});

test("undo: a failed revert leaves the mod on (UI must not lie about state)", async () => {
  const session = fakeSession({ failRevert: true });
  const svc = new NativeModService({ session, context: ctx, store: memStore() });
  const { id } = await svc.generate(directReq);
  const off = await svc.setEnabled(id, false);
  assert.equal(off.ok, false, "revert failed → not reported as off");
  assert.equal(svc.list()[0].applied, true, "still live");
  const rm = await svc.remove(id);
  assert.equal(rm.ok, false, "revert failed → not removed");
  assert.equal(svc.list().length, 1, "still saved");
});

test("apply: a store-write failure reports applied-but-unsaved, keeps the hook", async () => {
  const session = fakeSession();
  const throwingStore = { list: () => [], upsert: () => { throw new Error("disk full"); }, remove: () => {} };
  const svc = new NativeModService({ session, context: ctx, store: throwingStore });
  const r = await svc.applySpec({ morseNative: 1, id: "x", title: "t", target: directReq.target, action: directReq.action }, { save: true });
  assert.equal(r.ok, true, "the hook is live, so it's not a failure");
  assert.equal(r.saved, false);
  assert.match(r.warning, /not saved/);
});

test("restore: re-applies saved, enabled mods on a fresh attach (skips disabled)", async () => {
  const store = memStore();
  const key = keyFor(ctx);
  store.saveAll(key, [
    { morseNative: 1, id: "on1", title: "on", target: { kind: "export", module: "Player", symbol: "a" }, action: { kind: "observe", onEnter: "log(1)" }, status: "applied" },
    { morseNative: 1, id: "off1", title: "off", target: { kind: "export", module: "Player", symbol: "b" }, action: { kind: "observe", onEnter: "log(1)" }, status: "idle" },
  ]);
  const session = fakeSession();
  const svc = new NativeModService({ session, context: ctx, store });
  const out = await svc.restore();
  assert.equal(out.length, 1, "only the enabled one re-applies");
  assert.deepEqual(session.calls[0], ["apply", ["on1"]]);
});

test("handle: dispatches the bar's host messages", async () => {
  const svc = new NativeModService({ session: fakeSession(), context: ctx, store: memStore() });
  const gen = await svc.handle({ type: "generate", request: directReq });
  assert.equal(gen.ok, true);
  const list = await svc.handle({ type: "mods.list" });
  assert.equal(list.length, 1);
  const unknown = await svc.handle({ type: "nonsense" });
  assert.equal(unknown.ok, false);
});
