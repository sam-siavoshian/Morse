import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Connector } from "../daemon/connector.js";

function connector(state) {
  const c = new Connector({ settings: {}, log: () => {} });
  c.windows.set("window", { ready: true, frameId: "frame", frames: new Map([["frame", { world: 42 }]]),
    session: { closed: false, async send(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.equal(params.contextId, 42);
      const ctx = vm.createContext({ state });
      vm.runInContext('globalThis[Symbol.for("morse.boot")] = { live: () => true, S: state }', ctx);
      return { result: { value: vm.runInContext(params.expression, ctx) } };
    } },
  });
  return c;
}

test("connected idle apps do not block updates; open edits, previews and saves do", async () => {
  const state = { open: false, phase: "idle", draft: null };
  const c = connector(state);
  assert.equal(await c.isUpdateBusy(), false);
  state.open = true; assert.equal(await c.isUpdateBusy(), true);
  state.open = false; state.draft = { saved: false }; assert.equal(await c.isUpdateBusy(), true);
  state.draft.saved = true; assert.equal(await c.isUpdateBusy(), false);
  state.draft.saving = true; assert.equal(await c.isUpdateBusy(), true);
  state.draft = null; state.phase = "working"; assert.equal(await c.isUpdateBusy(), true);
  state.phase = "idle"; c.recorder = {}; assert.equal(await c.isUpdateBusy(), true);
});

test("in-flight requests block updates until completion, including failures", async () => {
  const c = connector({ open: false, phase: "idle" });
  let finish;
  c.handleRequest = () => new Promise((_, reject) => { finish = reject; });
  const request = c.dispatch(null, null, {});
  assert.equal(await c.isUpdateBusy(), true);
  finish(new Error("request failed"));
  await assert.rejects(request, /request failed/);
  assert.equal(await c.isUpdateBusy(), false);
});
