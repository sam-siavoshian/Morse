// The default hotkeys, in Playwright's key syntax. Headless Chromium reports
// the host OS. Open Morse is Ctrl+Alt+Space on every platform
// (core/hotkeys.js defaultHotkeys): ⌃⌥Space on a Mac.
import { defaultHotkeys } from "../../core/hotkeys.js";

const PLATFORM = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
export const toPlaywright = combo => combo.split("+").map(k => (k === "Ctrl" ? "Control" : k)).join("+");
export const HOTKEYS = Object.fromEntries(Object.entries(defaultHotkeys(PLATFORM)).map(([k, v]) => [k, toPlaywright(v)]));

// Open Morse (and, held down, push to talk).
export const OPEN_KEY = HOTKEYS.open;

// A tap of Open Morse. The same combo held for more than 280ms is push to
// talk (runtime/src/95-keys.js), and keyboard.press() waits for the page to
// handle the keydown before it sends the keyup: on a busy machine that gap
// can pass 280ms, and the "tap" starts listening instead. Here the key's down
// and up go out back to back, so the gap is only the page's own input queue.
export async function pressOpen(page, combo = OPEN_KEY) {
  const keys = combo.split("+"), main = keys.pop();
  for (const k of keys) await page.keyboard.down(k);
  await Promise.all([page.keyboard.down(main), page.keyboard.up(main)]);
  for (const k of keys.reverse()) await page.keyboard.up(k);
}

// Hold a combo down (push to talk) and let go of it again, last key first.
export async function holdKeys(page, combo = OPEN_KEY) { for (const k of combo.split("+")) await page.keyboard.down(k); }
export async function releaseKeys(page, combo = OPEN_KEY) { for (const k of combo.split("+").reverse()) await page.keyboard.up(k); }
