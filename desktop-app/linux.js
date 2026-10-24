// Linux desktop files Morse Desktop writes for itself (never for other apps):
//   ~/.config/autostart/morse-desktop.desktop        open at login, only when turned on
//   ~/.local/share/applications/morse-desktop.desktop the app menu entry, which also
//                                                     lets Chrome open morse:// links
// macOS and Windows do both through Electron (main.js).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const AUTOSTART = (home = os.homedir()) => path.join(home, ".config", "autostart", "morse-desktop.desktop");
export const MENU_ENTRY = (home = os.homedir()) => path.join(home, ".local", "share", "applications", "morse-desktop.desktop");

// One word of an Exec= line, quoted the way the Desktop Entry spec reads it.
const quote = s => (/^[\w./:=-]+$/.test(s) ? s : `"${String(s).replace(/(["`$\\])/g, "\\$1")}"`);

export function desktopEntry({ exec, args = [], icon = "", hidden = false, url = false }) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Morse",
    "Comment=Change any app in your own words",
    `Exec=${[exec, ...args].map(quote).join(" ")}${hidden ? " --hidden" : ""}${url ? " %u" : ""}`,
    icon ? `Icon=${icon}` : "",
    "Terminal=false",
    "Categories=Utility;",
    url ? "MimeType=x-scheme-handler/morse;" : "",
    hidden ? "X-GNOME-Autostart-enabled=true" : "",
    "",
  ].filter((l, i, all) => l !== "" || i === all.length - 1).join("\n");
}

export async function setAutostart(on, { exec, args, home } = {}) {
  const file = AUTOSTART(home);
  if (!on) { await fs.rm(file, { force: true }); return; }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, desktopEntry({ exec, args, hidden: true }));
}

export async function writeMenuEntry({ exec, args, icon, home } = {}) {
  const file = MENU_ENTRY(home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, desktopEntry({ exec, args, icon, url: true }));
  return file;
}
