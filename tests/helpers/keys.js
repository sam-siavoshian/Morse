// The default hotkeys, in Playwright's key syntax. Headless Chromium reports
// the host OS, so the runtime picks the default for this platform: ⌥Space on
// macOS, Ctrl+Shift+Space elsewhere (core/hotkeys.js defaultHotkeys).
import { defaultHotkeys } from "../../core/hotkeys.js";

const PLATFORM = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
export const toPlaywright = combo => combo.split("+").map(k => (k === "Ctrl" ? "Control" : k)).join("+");
export const HOTKEYS = Object.fromEntries(Object.entries(defaultHotkeys(PLATFORM)).map(([k, v]) => [k, toPlaywright(v)]));

// Open Morse (and, held down, push to talk).
export const OPEN_KEY = HOTKEYS.open;

// Hold a combo down (push to talk) and let go of it again, last key first.
export async function holdKeys(page, combo = OPEN_KEY) { for (const k of combo.split("+")) await page.keyboard.down(k); }
export async function releaseKeys(page, combo = OPEN_KEY) { for (const k of combo.split("+").reverse()) await page.keyboard.up(k); }
