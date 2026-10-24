// Finds and relaunches desktop apps with a debugging port so Morph can attach.
// Relaunching (not patching the app bundle) keeps code signatures and ASAR
// integrity intact and survives app updates.

import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const P = process.platform;
const LOCAL = process.env.LOCALAPPDATA || "";

// id -> candidate executables per platform. macOS paths are .app bundles.
export const KNOWN_APPS = {
  spotify: { name: "Spotify", mac: ["/Applications/Spotify.app"], win: [`${process.env.APPDATA}\\Spotify\\Spotify.exe`], linux: ["spotify", "/snap/bin/spotify"] },
  discord: { name: "Discord", mac: ["/Applications/Discord.app"], win: [`${LOCAL}\\Discord\\Update.exe`], linux: ["discord", "/usr/bin/discord"] },
  slack: { name: "Slack", mac: ["/Applications/Slack.app"], win: [`${LOCAL}\\slack\\slack.exe`], linux: ["slack", "/snap/bin/slack"] },
  vscode: { name: "VS Code", mac: ["/Applications/Visual Studio Code.app"], win: [`${LOCAL}\\Programs\\Microsoft VS Code\\Code.exe`], linux: ["code", "/usr/share/code/code"] },
  notion: { name: "Notion", mac: ["/Applications/Notion.app"], win: [`${LOCAL}\\Programs\\Notion\\Notion.exe`], linux: [] },
  obsidian: { name: "Obsidian", mac: ["/Applications/Obsidian.app"], win: [`${LOCAL}\\Obsidian\\Obsidian.exe`], linux: ["obsidian"] },
  chatgpt: { name: "ChatGPT", mac: ["/Applications/ChatGPT.app"], win: [], linux: [] },
  claude: { name: "Claude", mac: ["/Applications/Claude.app"], win: [`${LOCAL}\\AnthropicClaude\\claude.exe`], linux: [] },
  figma: { name: "Figma", mac: ["/Applications/Figma.app"], win: [`${LOCAL}\\Figma\\Figma.exe`], linux: [] },
  chrome: { name: "Chrome", browser: true, mac: ["/Applications/Google Chrome.app"], win: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"], linux: ["google-chrome", "chromium", "chromium-browser"] },
};

function which(cmd) {
  try { return execFileSync(P === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }).split("\n")[0].trim() || null; }
  catch { return null; }
}

export function resolveApp(idOrPath) {
  const known = KNOWN_APPS[idOrPath.toLowerCase()];
  if (!known) {
    if (!existsSync(idOrPath)) throw new Error(`Unknown app "${idOrPath}". Use one of: ${Object.keys(KNOWN_APPS).join(", ")}, or a path.`);
    return { id: path.basename(idOrPath).replace(/\.(app|exe)$/i, "").toLowerCase(), name: path.basename(idOrPath), path: idOrPath };
  }
  const list = known[P === "darwin" ? "mac" : P === "win32" ? "win" : "linux"] || [];
  for (const c of list) {
    const p = c.includes("/") || c.includes("\\") ? (existsSync(c) ? c : null) : which(c);
    if (p) return { id: idOrPath.toLowerCase(), name: known.name, path: p, browser: !!known.browser };
  }
  throw new Error(`${known.name} isn't installed in the usual place. Pass its path instead: morph launch /path/to/${known.name}`);
}

export function executableFor(appPath) {
  if (P === "darwin" && appPath.endsWith(".app")) {
    const name = path.basename(appPath, ".app");
    return path.join(appPath, "Contents", "MacOS", name);
  }
  return appPath;
}

export function quitApp(app) {
  try {
    if (P === "darwin") execFileSync("osascript", ["-e", `quit app "${app.name}"`]);
    else if (P === "win32") execFileSync("taskkill", ["/IM", path.basename(app.path), "/F"]);
    else execFileSync("pkill", ["-f", app.path]);
  } catch {}
}

export function launchApp(app, port, extraArgs = []) {
  const args = [`--remote-debugging-port=${port}`, "--remote-allow-origins=http://127.0.0.1", ...extraArgs];
  if (app.browser) args.push(`--user-data-dir=${path.join(os.homedir(), ".morph", "browser-profile")}`, "--no-first-run");
  // Discord on Windows starts through its updater.
  const argv = P === "win32" && /Update\.exe$/i.test(app.path) ? ["--processStart", "Discord.exe", "--process-start-args", args.join(" ")] : args;
  const child = spawn(executableFor(app.path), argv, { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}
