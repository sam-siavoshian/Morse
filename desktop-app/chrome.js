// "Add to Chrome" in Morse Desktop, until the Chrome Web Store listing exists:
// Chrome opens on chrome://extensions, where the person turns on Developer
// mode and drags in the extension folder (or picks it with Load unpacked).
// A web page can't open chrome:// addresses, but Chrome takes one from its
// command line, so Morse starts Chrome with it.
//
// No Electron here: main.js calls openChromeExtensions(), tests pass fakes.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const EXTENSIONS_PAGE = "chrome://extensions";

// The ways to start Chrome on each system, in order: [file, args].
export function chromeCommands({ platform = process.platform, env = process.env, has = existsSync } = {}) {
  const url = EXTENSIONS_PAGE;
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
