// "Use Morse in Chrome", the Morse app's one button for Chrome.
//
// When Morse is in the Chrome Web Store (site/config.js LINKS.chrome is a
// store address), the button opens Morse's page there. Until then it adds the
// extension that comes with the app, the simplest way Chrome allows: a copy
// in a folder that stays put (service.js extensionFolder), Chrome opened on
// its extensions page, the folder shown, and one picture in the window of
// where to click (Developer mode, then Load unpacked).
//
// No Electron here, so tests run it as is. chromeCommand() says how to start
// Chrome on its extensions page: a program and an argument list, never a
// shell string. When Chrome is already open, it opens the page in a new tab.

import { existsSync } from "node:fs";
import path from "node:path";

export const EXTENSIONS_PAGE = "chrome://extensions";

// A Chrome Web Store address (the listing), not the site's own steps.
export const isStoreUrl = u => /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//.test(String(u || ""));

// Where Chrome (or Chromium) is, in the order to try.
export function chromeCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === "darwin") {
    const apps = ["/Applications", path.posix.join(env.HOME || "", "Applications")];
    return apps.flatMap(d => [
      path.posix.join(d, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      path.posix.join(d, "Chromium.app", "Contents", "MacOS", "Chromium"),
    ]);
  }
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean);
    return roots.map(r => path.win32.join(r, "Google", "Chrome", "Application", "chrome.exe"));
  }
  const dirs = String(env.PATH || "").split(":").filter(Boolean);
  for (const d of ["/usr/bin", "/usr/local/bin", "/snap/bin", "/opt/google/chrome"]) if (!dirs.includes(d)) dirs.push(d);
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"].flatMap(n => dirs.map(d => path.posix.join(d, n)));
}

// { file, args } to open Chrome's extensions page, or null when there's no
// Chrome here. MORSE_CHROME names the program to use instead (tests).
export function chromeCommand({ platform = process.platform, env = process.env, has = existsSync } = {}) {
  if (env.MORSE_CHROME) return { file: env.MORSE_CHROME, args: [EXTENSIONS_PAGE] };
  const file = chromeCandidates({ platform, env }).find(f => { try { return has(f); } catch { return false; } });
  return file ? { file, args: [EXTENSIONS_PAGE] } : null;
}
