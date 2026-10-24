// Waiting on real conditions instead of sleeping. Timeouts are generous on
// purpose: a passing test returns as soon as its condition holds, so a long
// timeout only matters when something is actually wrong (or the machine is
// very busy, e.g. several `npm test` runs at once). MORSE_TEST_TIMEOUT_SCALE=2
// doubles every timeout on a slow machine.

export const SCALE = Number(process.env.MORSE_TEST_TIMEOUT_SCALE) || 1;
export const TIMEOUT = 30000 * SCALE;
export const scaled = ms => ms * SCALE;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Polls fn until it returns something truthy (errors count as "not yet") and
// returns that value. `what` (string or function) names the condition in the
// error, with the last value or error seen.
export async function waitFor(fn, { timeout = TIMEOUT, interval = 50, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) {
      const name = typeof what === "function" ? what() : what;
      const seen = last instanceof Error ? last.message : JSON.stringify(last);
      throw new Error(`timed out after ${timeout}ms waiting for ${name}; last: ${seen}`);
    }
    await sleep(interval);
  }
}

// The runtime's debug status (data-status on [data-morse-ui], refreshed every
// 40ms when localStorage morse:debug is set).
export const readStatus = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));

// Waits until the status matches pred; returns it. Throws with the last status.
export async function waitForStatus(page, pred, { timeout = TIMEOUT, what = "status" } = {}) {
  const end = Date.now() + timeout;
  let s;
  for (;;) {
    try { s = await readStatus(page); if (s && pred(s)) return s; } catch {}
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${what}; last status ${JSON.stringify(s)}`);
    await sleep(25);
  }
}

// The runtime booted and its host answered hello (settings, history and mods loaded).
export const waitForReady = (page, opts) => waitForStatus(page, s => s.ready, { what: "the runtime to be ready", ...opts });

// Lets the page finish what it's doing now: pending microtasks, mutation
// observers and the work they schedule for the next frames. Use before
// asserting that something did NOT happen.
export const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));

// A round trip through a page's fake host (the playgrounds' __morseHost,
// which answer in order): every reply the host queued before this one has
// been delivered and handled. Use before asserting a host-side effect did NOT
// happen.
export const hostRoundTrip = page => page.evaluate(() => new Promise(resolve => {
  const id = `roundtrip-${Math.random()}`;
  globalThis.__morseHost.onMessage(m => { if (m && m.reply === id) setTimeout(resolve, 0); });
  globalThis.__morseHost.send({ id, type: "ping" });
}));
