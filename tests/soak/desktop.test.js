// `npm run test:soak`: a short desktop soak (demo/soak/desktop.js --short):
// the loop in a demo app with windows opening and closing, a renderer crash
// and stop / attach cycles. Nothing may wedge or grow without bound.
import "../helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { noBrowser } from "../helpers/browser.js";
import { soakDesktop } from "../../demo/soak/desktop.js";
import { verdict } from "../../demo/soak/report.js";
import { KEEP_CLIPS } from "../../daemon/record.js";
import { pick } from "../../demo/soak/lib.js";

test("desktop soak: the loop, popups, a crash and stop/attach cycles stay level", { skip: noBrowser, timeout: 600000 }, async () => {
  const r = await soakDesktop({ iterations: 7, minutes: 6, sampleEvery: 2, popupEvery: 3, crashEvery: 3, reloadEvery: 4, cycleEvery: 2, log: false });
  const v = verdict(r);
  const last = r.samples.at(-1), first = r.samples[0];
  assert.ok(r.meta.cycles >= 2 && r.meta.crashes >= 1, `cycles ${r.meta.cycles}, crashes ${r.meta.crashes}`);
  assert.equal(v.wedged, false, `failing iterations in a row: ${r.meta.maxFailStreak}\n${r.lastErrors.join("\n")}`);
  // one runtime per window after every stop + attach: its observers don't pile up
  assert.ok(pick(last, "main.worlds.runtime.mo") - pick(first, "main.worlds.runtime.mo") <= 6, `runtime observers ${pick(first, "main.worlds.runtime.mo")} -> ${pick(last, "main.worlds.runtime.mo")}`);
  assert.ok(pick(last, "main.winListeners") - pick(first, "main.winListeners") <= 2, "window listeners");
  // ... and no old overlay is kept (its elements would be detached, held by JS
  // or by the document; node and listener counts are per renderer, shared
  // with the other windows, so they're too noisy to check here)
  for (const k of ["main.main.detached", "main.worlds.runtime.detached"]) assert.ok(pick(last, k) - pick(first, k) <= 30, `${k}: ${pick(first, k)} -> ${pick(last, k)}`);
  // the daemon: a session per window, nothing stuck, clips capped
  assert.ok(last.daemon.cdpOpen <= last.daemon.windows + 1, `CDP sessions ${last.daemon.cdpOpen} for ${last.daemon.windows} windows`);
  assert.ok(last.daemon.hangLast <= 64 * last.daemon.windows, `hang guard code ${last.daemon.hangLast}`);
  assert.ok(last.daemon.clips.files <= KEEP_CLIPS * 3, `clip files ${last.daemon.clips.files}`);
  const uncaught = r.errors.filter(e => e.kind === "exception" && e.world === "runtime");
  assert.deepEqual(uncaught, [], "no uncaught errors in Morse's world");
});
