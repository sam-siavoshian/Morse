// Playwright for tests: the globally installed copy (no npm dependency), the
// skip reasons, and launching Chromium with a startup timeout that survives a
// busy machine.
import { createRequire } from "node:module";
import { TIMEOUT } from "./wait.js";

export let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}

export const noBrowser = !chromium && "playwright not installed";

// channel "chromium" is the new headless mode (real audio capture, closer to a
// real browser); older Playwright builds fall back to the default.
export async function launchBrowser({ args = [], channel = null, ...opts } = {}) {
  const base = { args, timeout: TIMEOUT * 2, ...opts };
  if (channel) { try { return await chromium.launch({ ...base, channel }); } catch {} }
  return chromium.launch(base);
}
