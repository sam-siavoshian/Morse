// "Use Morse in Chrome", the Morse app's one button for Chrome.
//
// When Morse is in the Chrome Web Store (site/config.js LINKS.chrome is a
// store address, isStoreUrl), the button opens Morse's page there. Until
// then it adds the extension that comes with the app, the simplest way Chrome
// allows: a copy in a folder that stays put (service.js extensionFolder), the
// folder shown, Chrome opened on chrome://extensions, and one picture in the
// window of where to click (Developer mode, then Load unpacked).
// A web page can't open chrome:// addresses, but Chrome takes one from its
// command line, so Morse starts Chrome with it.
//
// No Electron here: main.js calls openChromeExtensions(), tests pass fakes.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const EXTENSIONS_PAGE = "chrome://extensions";

// A Chrome Web Store address (the listing), not the site's own steps.
export const isStoreUrl = u => /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//.test(String(u || ""));

// The ways to start Chrome on each system, in order: [file, args].
// MORSE_CHROME names the program to use instead (tests and screenshots).
export function chromeCommands({ platform = process.platform, env = process.env, has = existsSync } = {}) {
  const url = EXTENSIONS_PAGE;
  if (env.MORSE_CHROME) return [[env.MORSE_CHROME, [url]]];
  if (platform === "darwin") return ["Google Chrome", "Chromium"].map(app => ["open", ["-a", app, url]]);
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean);
    return roots.map(r => path.win32.join(r, "Google", "Chrome", "Application", "chrome.exe")).filter(f => has(f)).map(f => [f, [url]]);
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map(bin => [bin, [url]]);
}

// Starts one command. `open` says whether it found the app (its exit code);
// Chrome itself keeps running, so starting is enough.
function start(file, args) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(file, args, { detached: file !== "open", stdio: "ignore", windowsHide: true }); } catch { return resolve(false); }
    child.on("error", () => resolve(false));
    if (file === "open") child.on("exit", code => resolve(code === 0));
    else child.on("spawn", () => { child.unref(); resolve(true); });
  });
}

// true when Chrome opened on its extensions page.
export async function openChromeExtensions({ platform, env, has, run = start } = {}) {
  for (const [file, args] of chromeCommands({ platform, env, has })) if (await run(file, args)) return true;
  return false;
}
