// `npm run test:soak`: 50 saved mods on a page that keeps streaming
// (demo/soak/mods.js, short). The page's nodes, observers and the elements
// JS holds stay level as messages come and go.
import "../helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { noBrowser } from "../helpers/browser.js";
import { soakMods } from "../../demo/soak/mods.js";
import { pick } from "../../demo/soak/lib.js";

test("50 mods on a streaming chat: nothing piles up", { skip: noBrowser, timeout: 600000 }, async () => {
  const r = await soakMods({ minutes: 2, sampleSec: 15, actEverySec: 5, log: false });
  const s = r.samples.filter(x => x.kit?.running >= 45);
  assert.ok(s.length >= 4, `samples with the mods running: ${s.length}`);
  const first = s[1], last = s.at(-1); // the first once the stream has filled the page
  for (const [key, tol] of [["page.nodes", 300], ["page.main.mo", 40], ["page.main.detached", 60], ["page.listeners", 40], ["page.worlds.runtime.detached", 40]]) {
    assert.ok(pick(last, key) - pick(first, key) <= tol, `${key}: ${pick(first, key)} -> ${pick(last, key)}`);
  }
  // On a very busy machine the guard may pause a mod as slow (its time is wall
  // time); nothing may be paused for looping or adding too much.
  assert.deepEqual(Object.keys(last.kit.why || {}).filter(w => w !== "slow"), [], `paused: ${JSON.stringify(last.kit.why)}`);
  assert.ok(Math.max(...s.map(x => pick(x, "pulse.streamed") || 0)) > 20, "the chat kept streaming");
  assert.equal(r.meta.reloads, 0, "the page never had to reload");
});
