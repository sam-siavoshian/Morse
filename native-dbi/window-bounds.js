// Where a native app's window is on screen, so an overlay can pin itself over
// it and follow as it moves. Given a PID, return the main/focused window's
// bounds in screen coordinates: { x, y, width, height }.
//
// There is no portable API for this, so each platform shells out to a tool it
// already ships (the same approach as discover.js's window→PID step). The
// parsing of each tool's output is split into a pure function so it is testable
// on any machine, and the shelling is a thin wrapper.
//
// Read-only: it asks the window server / X for geometry. It does not move,
// focus, or touch the target window.

import { execFileSync } from "node:child_process";

const run = (file, args, timeout = 3000) => {
  try { return execFileSync(file, args, { encoding: "utf8", timeout, windowsHide: true }).trim(); }
  catch { return null; }
};

// { x, y, width, height } or null. A null means "no visible window right now"
// (minimised, closed, or on another space) — the overlay hides on null.
export function windowBounds(pid, { platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === "darwin") return parseMacBounds(run("osascript", ["-e", macScript(pid)]));
  if (platform === "win32") return parseWinRect(run("powershell", ["-NoProfile", "-NonInteractive", "-Command", winScript(pid)]));
  return parseLinuxGeometry(linuxGeometry(pid));
}

// ---- macOS ---------------------------------------------------------------

// AppleScript via System Events reads the front window's position and size for
// the process with this Unix id. (No Screen Recording permission; AX geometry
// only.) Prints "x,y,w,h".
export function macScript(pid) {
  return [
    `tell application "System Events" to tell (first process whose unix id is ${pid})`,
    `  set {px, py} to position of front window`,
    `  set {sw, sh} to size of front window`,
    `end tell`,
    `return (px as text) & "," & (py as text) & "," & (sw as text) & "," & (sh as text)`,
  ].join("\n");
}

export function parseMacBounds(out) {
  if (!out) return null;
  const n = out.split(",").map(s => Number(s.trim()));
  if (n.length !== 4 || n.some(v => !Number.isFinite(v))) return null;
  const [x, y, width, height] = n;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

// ---- Windows -------------------------------------------------------------

// GetWindowRect on the process's main window handle, via inline P/Invoke.
// Prints "left,top,right,bottom".
export function winScript(pid) {
  return [
    "$s=@'",
    "using System;using System.Runtime.InteropServices;",
    "public struct R{public int L,T,Rt,B;}",
    "public class Win{[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr h,out R r);}",
    "'@",
    "Add-Type $s",
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if($p -and $p.MainWindowHandle -ne 0){$r=New-Object R;[void][Win]::GetWindowRect($p.MainWindowHandle,[ref]$r);\"$($r.L),$($r.T),$($r.Rt),$($r.B)\"}",
  ].join("\n");
}

export function parseWinRect(out) {
  if (!out) return null;
  const n = out.split(",").map(s => Number(s.trim()));
  if (n.length !== 4 || n.some(v => !Number.isFinite(v))) return null;
  const [left, top, right, bottom] = n;
  const width = right - left, height = bottom - top;
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : null;
}

// ---- Linux (X11) ---------------------------------------------------------

// Wayland does not expose another window's geometry to a client, by design;
// there is no fallback (the overlay layer reports this up the stack).
function linuxGeometry(pid) {
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) return null;
  const ids = run("xdotool", ["search", "--pid", String(pid)]);
  const id = (ids || "").split(/\s+/).filter(Boolean)[0];
  if (!id) return null;
  return run("xdotool", ["getwindowgeometry", "--shell", id]);
}

// xdotool --shell prints WINDOW=/X=/Y=/WIDTH=/HEIGHT= lines.
export function parseLinuxGeometry(out) {
  if (!out) return null;
  const get = k => { const m = new RegExp(`^${k}=(-?\\d+)`, "m").exec(out); return m ? Number(m[1]) : null; };
  const x = get("X"), y = get("Y"), width = get("WIDTH"), height = get("HEIGHT");
  if ([x, y, width, height].some(v => v == null)) return null;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

// Why bounds came back null, for a diagnostic.
export function boundsHint(platform = process.platform) {
  if (platform === "linux" && process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)
    return "On Wayland, window geometry isn't available to other apps, so the overlay can't pin itself. X11 is required.";
  if (platform === "linux") return "Install xdotool so the overlay can track the window.";
  return "The app may have no visible window right now (minimised or hidden).";
}
