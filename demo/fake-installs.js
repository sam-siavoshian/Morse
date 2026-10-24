// Fake install trees for macOS, Windows and Linux, written under a scratch
// directory. Discovery (daemon/apps.js) reads them through hostContext({ root }),
// so tests and the `morse apps` screenshot run the real code on any machine.

import { promises as fs } from "node:fs";
import path from "node:path";

const plist = o => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(o).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`).join("\n")}
\t<key>CFBundleURLTypes</key>
\t<array><dict><key>CFBundleURLName</key><string>nested-should-be-ignored</string></dict></array>
</dict>
</plist>`;

// name, bundle id, executable, version, engine, electron version, folder
const MAC = [
  ["Slack", "com.tinyspeck.slackmacgap", "Slack", "4.41.105", "electron", "32.2.6"],
  ["Visual Studio Code", "com.microsoft.VSCode", "Electron", "1.95.3", "electron", "32.2.1", null, "Code"],
  ["Spotify", "com.spotify.client", "Spotify", "1.2.52.442", "cef"],
  ["Discord", "com.hnc.Discord", "Discord", "0.0.326", "electron", "33.1.0"],
  ["Notion", "notion.id", "Notion", "4.3.0", "electron", "32.1.0"],
  ["ChatGPT", "com.openai.chat", "ChatGPT", "1.2025.014", "native"],
  ["Claude", "com.anthropic.claudefordesktop", "Claude", "0.9.3", "electron", "33.3.1"],
  ["Safari", "com.apple.Safari", "Safari", "18.2", "native"],
  ["Google Chrome", "com.google.Chrome", "Google Chrome", "131.0.6778.86", "chrome"],
  ["Beeper", "com.automattic.beeper.desktop", "Beeper", "4.0.5", "electron", "31.4.0"],
  ["Obsidian", "md.obsidian", "Obsidian", "1.7.7", "electron", "32.2.5", "home"],
];

async function put(root, p, content = "") {
  const f = path.join(root, p);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, content);
}
async function link(root, from, to) {
  const f = path.join(root, from);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.symlink(to, f);
}

export async function buildMac(root, home = "/Users/sam") {
  for (const [name, id, exe, version, engine, electron, where, display] of MAC) {
    const b = `${where === "home" ? home : ""}/Applications/${name}.app/Contents`;
    await put(root, `${b}/Info.plist`, plist({ CFBundleName: display || name, CFBundleIdentifier: id, CFBundleExecutable: exe, CFBundleShortVersionString: version }));
    await put(root, `${b}/MacOS/${exe}`, "\xCF\xFA\xED\xFE");
    const fw = `${b}/Frameworks`;
    if (engine === "electron") await put(root, `${fw}/Electron Framework.framework/Resources/Info.plist`, plist({ CFBundleVersion: electron }));
    if (engine === "cef") await put(root, `${fw}/Chromium Embedded Framework.framework/Chromium Embedded Framework`, "");
    if (engine === "chrome") await put(root, `${fw}/Google Chrome Framework.framework/Versions/Current`, "");
    if (engine === "native") await put(root, `${fw}/Sparkle.framework/Sparkle`, "");
  }
  await fs.mkdir(path.join(root, "Applications/Utilities"), { recursive: true });
  return { platform: "darwin", home, root, env: { PATH: "/usr/bin:/bin" } };
}

export async function buildWindows(root, home = "C:\\Users\\sam") {
  const L = "/C/Users/sam/AppData/Local", R = "/C/Users/sam/AppData/Roaming";
  // Squirrel installs: a stub at the top, the real app in app-<version>\
  await put(root, `${L}/Discord/Update.exe`, "MZ");
  for (const v of ["1.0.9163", "1.0.9170"]) { await put(root, `${L}/Discord/app-${v}/Discord.exe`, "MZ"); await put(root, `${L}/Discord/app-${v}/resources/app.asar`, ""); }
  await put(root, `${L}/slack/slack.exe`, "MZ");
  await put(root, `${L}/slack/app-4.41.105/slack.exe`, "MZ");
  await put(root, `${L}/slack/app-4.41.105/resources/app.asar`, "");
  // NSIS / per-user installs
  await put(root, `${L}/Programs/Microsoft VS Code/Code.exe`, "MZ");
  await put(root, `${L}/Programs/Microsoft VS Code/resources/app/package.json`, "{}");
  await put(root, `${L}/Programs/Obsidian/Obsidian.exe`, "MZ");
  await put(root, `${L}/Programs/Obsidian/resources/app.asar`, "");
  await put(root, `${L}/Programs/Obsidian/Uninstall Obsidian.exe`, "MZ");
  await put(root, `${L}/Programs/Beeper/Beeper.exe`, "MZ");
  await put(root, `${L}/Programs/Beeper/Uninstall Beeper.exe`, "MZ");
  await put(root, `${L}/Programs/Beeper/resources/app.asar`, "");
  await put(root, `${R}/Spotify/Spotify.exe`, "MZ");
  await put(root, `${R}/Spotify/libcef.dll`, "MZ");
  await put(root, "/C/Program Files/Google/Chrome/Application/chrome.exe", "MZ");
  await put(root, "/C/Program Files/Mozilla Firefox/firefox.exe", "MZ");
  return {
    platform: "win32", home, root,
    env: { LOCALAPPDATA: `${home}\\AppData\\Local`, APPDATA: `${home}\\AppData\\Roaming`, ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", PATH: "C:\\Windows\\system32" },
  };
}

export async function buildLinux(root, home = "/home/sam") {
  await put(root, "/usr/share/code/code", "\x7fELF");
  await put(root, "/usr/share/code/resources/app/package.json", "{}");
  await put(root, "/usr/share/code/bin/code", "#!/usr/bin/env sh\nexec /usr/share/code/code \"$@\"\n");
  await link(root, "/usr/bin/code", "../share/code/bin/code");
  await put(root, "/usr/lib/slack/slack", "\x7fELF");
  await put(root, "/usr/lib/slack/resources/app.asar", "");
  await link(root, "/usr/bin/slack", "../lib/slack/slack");
  await put(root, "/snap/bin/spotify", "");
  await put(root, "/var/lib/flatpak/exports/bin/com.discordapp.Discord", "#!/bin/sh\nexec flatpak run com.discordapp.Discord \"$@\"\n");
  await put(root, `${home}/.local/share/flatpak/exports/bin/md.obsidian.Obsidian`, "#!/bin/sh\nexec flatpak run md.obsidian.Obsidian \"$@\"\n");
  await put(root, "/opt/Beeper/beeper", "\x7fELF");
  await put(root, "/opt/Beeper/chrome-sandbox", "\x7fELF");
  await put(root, "/opt/Beeper/libffmpeg.so", "");
  await put(root, "/opt/Beeper/resources/app.asar", "");
  await put(root, "/opt/Beeper/version", "31.4.0");
  await put(root, "/opt/google/chrome/chrome", "\x7fELF");
  await put(root, "/usr/bin/chromium", "\x7fELF");
  await put(root, "/usr/bin/vim", "\x7fELF");
  return { platform: "linux", home, root, env: { PATH: "/usr/local/bin:/usr/bin:/bin" } };
}
