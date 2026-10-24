// What differs between macOS, Windows and Linux outside app discovery
// (apps.js): `morse doctor`'s platform checks, and starting Windows .cmd/.bat
// programs (claude.cmd, codex.cmd from npm) without breaking on spaces.
//
// Everything takes its inputs as arguments, so tests can check each
// platform's answers on any machine.

import os from "node:os";
import path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import { colorOn } from "./colors.js";
import { defaultHotkeys, formatCombo } from "../core/hotkeys.js";

// "macOS 15 (Apple silicon)", "Windows 11 (build 22631, x64)", "Linux 6.8.0 (x64)".
export function systemName({ platform = process.platform, release = os.release(), arch = process.arch } = {}) {
  if (platform === "darwin") {
    // Darwin 20 is macOS 11, 24 is macOS 15; Darwin 25 is macOS 26 (the year numbering).
    const d = parseInt(release, 10);
    const mac = d >= 25 ? d + 1 : d >= 20 ? d - 9 : d >= 4 ? `10.${d - 4}` : "";
    return `macOS ${mac}`.trim() + ` (${arch === "arm64" ? "Apple silicon" : "Intel"})`;
  }
  if (platform === "win32") {
    const [major, , build] = String(release).split(".").map(Number);
    const name = major === 10 && build >= 22000 ? "11" : String(major || "");
    return `Windows ${name} (build ${build || "?"}, ${arch})`;
  }
  return `${platform === "linux" ? "Linux" : platform} ${String(release).split("-")[0]} (${arch})`;
}

// Starting a program by path, with an argument list and no shell. Windows
// can only start .cmd and .bat files (npm installs claude and codex as
// claude.cmd and codex.cmd) through cmd.exe, which splits on spaces, so the
// path is quoted there; the arguments must be plain words.
export function commandFor(file, args = [], { platform = process.platform } = {}) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(file)) return { file, args, shell: false };
  if (!args.every(a => /^[\w.:=/-]+$/.test(a))) throw new Error(`Morse can't pass ${args.join(" ")} to ${path.win32.basename(file)} safely.`);
  return { file: `"${file}"`, args, shell: true };
}

// `morse doctor`'s platform rows: [{ label, ok, text }], ok true (fine),
// false (worth fixing) or null (for your information).
//   home: the Morse folder; userHome: the person's own folder.
export async function platformChecks({
  platform = process.platform, release = os.release(), arch = process.arch, env = process.env,
  home, userHome = os.homedir(), stat = p => fs.stat(p), exists = existsSync,
  uid = process.getuid?.(), color = colorOn(), shortcut = "",
} = {}) {
  const rows = [];
  const row = (label, ok, text) => rows.push({ label, ok, text });
  row("system", null, systemName({ platform, release, arch }));

  // The Morse folder holds API keys (config.json): only you should open it.
  if (platform === "win32") {
    // Windows ignores Unix permission bits; what protects the folder is
    // where it is. Folders under C:\Users\<you> inherit permissions that let
    // in only you, administrators and the system. Morse doesn't change them.
    const inside = String(home).toLowerCase().startsWith(String(userHome).toLowerCase().replace(/\\?$/, "\\"));
    row("folder", inside, inside
      ? `${home} (in your user folder, which only you, administrators and Windows itself can open)`
      : `${home} is outside your user folder, so other people on this PC may be able to read your API keys. Point MORSE_HOME into ${userHome}, or leave it unset.`);
  } else {
    // Morse makes the folder 0700 and config.json 0600; a folder made by an
    // older Morse (or by hand) may be readable by others.
    const mode = async p => { try { return (await stat(p)).mode; } catch { return null; } };
    const dir = await mode(home), cfg = await mode(path.posix.join(home, "config.json"));
    if (dir == null) row("folder", null, `${home} (made the first time Morse saves something)`);
    else if (cfg != null && cfg & 0o077) row("folder", false, `${home}/config.json (your API keys) can be read by other users on this computer. Run: chmod 600 "${home}/config.json"`);
    else if (dir & 0o077) row("folder", null, `${home} can be listed by other users on this computer (your API keys file can't). To make it private: chmod 700 "${home}"`);
    else row("folder", true, `${home} (only you can open it)`);
  }

  const mine = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
  const def = formatCombo(defaultHotkeys(mine).open, mine);
  row("shortcut", null, shortcut && shortcut !== def ? `${shortcut} opens Morse (the default here is ${def})` : `${def} opens Morse in a connected app`);

  row("colors", null, color ? "on" : env.NO_COLOR ? "off (NO_COLOR is set)" : "off (not a terminal; set FORCE_COLOR=1 to force them)");

  if (platform === "darwin") {
    row("access", true, "Morse needs no Accessibility, Screen Recording or other permission. With --restart it quits apps through AppleScript, and macOS asks once whether your terminal may control each app. If you say no, Morse ends the app instead.");
  } else if (platform === "win32") {
    const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
    const ps = path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const hasPs = exists(ps);
    row("processes", hasPs, hasPs ? "PowerShell lists open apps for morse launch" : `No PowerShell at ${ps}: morse launch can't tell whether an app is already open.`);
    row("firewall", true, "The app's debugging port and the Morse helper only listen on 127.0.0.1, so Windows Firewall has nothing to ask.");
  } else {
    const display = env.WAYLAND_DISPLAY ? `Wayland (${env.WAYLAND_DISPLAY})` : env.DISPLAY ? `X11 (${env.DISPLAY})` : "";
    row("display", display ? true : false, display || "No DISPLAY or WAYLAND_DISPLAY: desktop apps can't open their windows from here.");
    if (uid === 0) row("user", false, "You're root. Electron and Chromium apps won't start as root with their sandbox on. Run Morse as your own user.");
  }
  return rows;
}

// The rows as `morse doctor` prints them.
export function formatChecks(rows, { paint }) {
  const mark = ok => ok === true ? paint.g("✓") + " " : ok === false ? paint.y("!") + " " : "";
  return rows.map(r => `  ${r.label.padEnd(9)} ${mark(r.ok)}${r.ok === false ? r.text : paint.d(r.text)}`).join("\n");
}
