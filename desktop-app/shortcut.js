// The open chord as an OS shortcut, owned by Morse Desktop.
//
// A page keydown listener never sees the key when the focused app calls
// preventDefault, a native widget has focus, or Chromium eats Option+Space
// before the injected script. Electron's globalShortcut asks the OS to
// deliver the chord to this process instead. The page listener
// (runtime/boot.js) stays for a tab this process isn't attached to.
//
// globalShortcut reports the press, not the release, and it repeats while
// the keys are held. A press toggles the bar. Holding to talk still happens
// in the page, when the desktop process isn't the one that received the key.

import { execFile } from "node:child_process";
import { parseCombo } from "../core/hotkeys.js";

const ACCEL_KEYS = {
  Space: "Space", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=",
  Backquote: "`", Escape: "Esc", Enter: "Enter", Tab: "Tab", Backspace: "Backspace",
  Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  PageUp: "PageUp", PageDown: "PageDown",
};

function acceleratorKey(code) {
  if (ACCEL_KEYS[code]) return ACCEL_KEYS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return "";
}

// Morse combo ("Ctrl+Alt+Space", "Alt+Shift+KeyK") -> Electron accelerator.
// Ctrl is Control on every platform. Meta is Command on a Mac and Super elsewhere.
export function acceleratorFor(combo, platform) {
  const c = typeof combo === "string" ? parseCombo(combo) : combo;
  if (!c?.code) return "";
  const key = acceleratorKey(c.code);
  if (!key) return "";
  const mods = [c.ctrl && "Control", c.alt && "Alt", c.shift && "Shift", c.meta && (platform === "mac" ? "Command" : "Super")];
  return [...mods.filter(Boolean), key].join("+");
}

// Which connected app the press was for.
//   pid of a connected app  -> that app, even when a native widget has focus
//   a window that has focus -> that app
//   no foreground pid, and only one app -> that app
//   foreground is some other app -> nothing (don't pull a different app forward)
export function pickShortcutTarget(sessions, { pid = 0, selfPid = 0, focused = new Set() } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return null;
  const focus = () => list.find(s => focused.has(s.id))?.id || null;
  if (pid && pid !== selfPid) {
    const hit = list.find(s => (s.pids || []).includes(pid));
    if (hit) return hit.id;
    return focus();
  }
  return focus() || (list.length === 1 ? list[0].id : null);
}

// The frontmost process, so a native widget (which never focuses the page)
// still opens the app it belongs to. 0 when this platform can't say.
const WIN_FOREGROUND = "$p=0; Add-Type -Namespace Morse -Name Fg -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);' -ErrorAction SilentlyContinue; $h=[Morse.Fg]::GetForegroundWindow(); [void][Morse.Fg]::GetWindowThreadProcessId($h, [ref]$p); Write-Output $p";

export function foregroundCommand(platform) {
  if (platform === "darwin") return { file: "/bin/sh", args: ["-c", "lsappinfo info -only pid \"$(lsappinfo front)\""] };
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", WIN_FOREGROUND] };
  if (platform === "linux") return { file: "xdotool", args: ["getwindowfocus", "getwindowpid"] };
  return null;
}

export function parseForegroundPid(platform, text) {
  const s = String(text || "");
  const m = platform === "darwin" ? /"pid"\s*=\s*(\d+)/.exec(s) || /\bpid\s*=\s*(\d+)/.exec(s) : /^\s*(\d+)/.exec(s);
  const n = m ? Number(m[1]) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function readForegroundPid(platform = process.platform, exec = execFile) {
  const cmd = foregroundCommand(platform);
  if (!cmd) return Promise.resolve(0);
  return new Promise(resolve => {
    exec(cmd.file, cmd.args, { timeout: 800, windowsHide: true, encoding: "utf8" }, (err, stdout) => {
      resolve(err ? 0 : parseForegroundPid(platform, stdout));
    });
  });
}

// Registers one accelerator and swaps it when the saved chord changes.
// `register` returns { ok, accelerator }. A chord the OS keeps comes back
// ok: false and is not retried until the chord changes (the page listener
// still works in a tab this process is in).
export function createOpenShortcut({ globalShortcut, onFire, log = () => {}, now = Date.now, gap = 350 } = {}) {
  let current = "";
  let failed = "";
  let lastFire = -1e15;
  const press = () => {
    const t = now();
    if (t - lastFire < gap) return;
    lastFire = t;
    try { onFire(); } catch (e) { log("shortcut", e?.message || e); }
  };
  function unregister() {
    if (!current) return;
    try { globalShortcut.unregister(current); } catch {}
    current = "";
  }
  function register(accelerator) {
    const next = accelerator || "";
    if (next === current) return { ok: true, accelerator: current };
    if (next && next === failed) return { ok: false, accelerator: "" };
    unregister();
    failed = "";
    if (!next) return { ok: true, accelerator: "" };
    let ok = false;
    try { ok = globalShortcut.register(next, press) !== false; }
    catch (e) { log("shortcut", e?.message || e); ok = false; }
    if (!ok) {
      failed = next;
      try { globalShortcut.unregister(next); } catch {}
      log("shortcut", `couldn't register ${next}`);
      return { ok: false, accelerator: "" };
    }
    current = next;
    return { ok: true, accelerator: current };
  }
  return {
    register, unregister, press,
    get current() { return current; },
  };
}
