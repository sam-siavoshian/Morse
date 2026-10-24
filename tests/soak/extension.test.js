// `npm run test:soak`: the extension loop on three demo sites, with the
// service worker stopped mid-loop (demo/soak/extension.js, short). Needs a
// display (extensions only load headed): run under Xvfb.
import "../helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { noDisplay } from "../helpers/browser.js";
import { soakExtension } from "../../demo/soak/extension.js";
import { verdict } from "../../demo/soak/report.js";
import { pick } from "../../demo/soak/lib.js";

test("extension soak: the loop with service worker restarts settles and stays level", { skip: noDisplay, timeout: 600000 }, async () => {
  const r = await soakExtension({ iterations: 9, minutes: 3, sampleEvery: 3, reloadEvery: 2, swRestartMin: 0.75, log: false });
  const v = verdict(r);
  const first = r.samples[0], last = r.samples.at(-1);
  assert.equal(v.wedged, false, `failing iterations in a row: ${r.meta.maxFailStreak}\n${r.lastErrors.join("\n")}`);
  assert.deepEqual(r.meta.afterRestart.fails, {}, `after the last restart: ${r.meta.afterRestart.errors.join("\n")}`);
  assert.ok(pick(last, "parley.winListeners") - pick(first, "parley.winListeners") <= 2, "window listeners on the long-lived tab");
  assert.ok(pick(last, "parley.worlds.runtime.mo") - pick(first, "parley.worlds.runtime.mo") <= 8, "runtime observers on the long-lived tab");
  const fails = Object.values(r.fails).reduce((a, b) => a + b, 0), runs = Object.values(r.steps).reduce((a, b) => a + b.n, 0);
  assert.ok(fails / runs < 0.2, `${fails} of ${runs} steps failed:\n${r.lastErrors.join("\n")}`);
});
