// Target discovery and context extraction: map a user window to a PID, the PID
// to an executable, and read enough of the executable's header to know what it
// is (format, arch) before any analysis. Produces a TargetContext (schema.js).
//
// Window→PID is genuinely platform-specific and has no portable API, so each
// platform shells out to a tool that already ships with it, best-effort, with
// a clear fallback to "give me a PID directly". This mirrors how daemon/
// already shells osascript / PowerShell / ps. The PID→row step reuses
// daemon/apps.js's listProcesses() so the two agree on what a process is.
//
// Read-only throughout: it reads process tables and the first bytes of a file.
// It does not attach, map memory, or write anything.

import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
import { listProcesses } from "../daemon/apps.js";
import { createContext } from "./schema.js";
import { currentUser } from "./boundaries.js";

const run = (file, args, timeout = 4000) => {
  try { return execFileSync(file, args, { encoding: "utf8", timeout, windowsHide: true }).trim(); }
  catch { return null; }
};

// PID of the user's active (frontmost/focused) window, or null. The person can
// always skip this and pass a PID; this is the convenience path.
export function activeWindowPid(platform = process.platform) {
  if (platform === "darwin") {
    // System Events reports the Unix PID of the frontmost app. No special
    // permission for the PID itself (controlling the app is a separate prompt).
    const out = run("osascript", ["-e", 'tell application "System Events" to get unix id of first process whose frontmost is true']);
    const n = Number(out);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  if (platform === "win32") {
    // GetForegroundWindow + GetWindowThreadProcessId via inline P/Invoke.
    const ps = [
      "$s=@'",
      "using System;using System.Runtime.InteropServices;",
      "public class W{[DllImport(\"user32.dll\")]public static extern IntPtr GetForegroundWindow();",
      "[DllImport(\"user32.dll\")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}",
      "'@",
      "Add-Type $s",
      "$p=0;[void][W]::GetWindowThreadProcessId([W]::GetForegroundWindow(),[ref]$p);$p",
    ].join("\n");
    const out = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
    const n = Number(out);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  // Linux/X11. Wayland does not expose another window's PID to a client, by
  // design — there is no fallback, and the caller gets null and a clear reason.
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) return null;
  const byId = run("xdotool", ["getactivewindow", "getwindowpid"]);
  if (byId && Number(byId) > 0) return Number(byId);
  const win = run("xdotool", ["getactivewindow"]);
  if (win) {
    const prop = run("xprop", ["-id", win, "_NET_WM_PID"]);
    const m = prop && /_NET_WM_PID\D+(\d+)/.exec(prop);
    if (m) return Number(m[1]);
  }
  return null;
}

// Why activeWindowPid returned null, for the diagnostic.
export function activeWindowHint(platform = process.platform) {
  if (platform === "linux" && process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)
    return "On Wayland, a window's PID isn't available to other apps. Pass the PID directly (e.g. from `ps` or your task manager).";
  if (platform === "linux") return "Install xdotool, or pass the PID directly.";
  return "Couldn't read the frontmost window. Pass the PID directly.";
}

// A process row { pid, ppid, exe, cmd } for a PID, from the OS process table.
export function processRow(pid, platform = process.platform) {
  return listProcesses(platform).find(p => p.pid === pid) || null;
}

// The executable path for a PID. The process table's exe is reliable on
// Windows; elsewhere derive it from the kernel or the command.
export function exePath(pid, row, platform = process.platform) {
  if (platform === "win32") return row?.exe || argv0(row?.cmd) || "";
  if (platform === "linux") {
    const link = run("readlink", ["-f", `/proc/${pid}/exe`]);
    if (link) return link;
  }
  if (platform === "darwin") {
    const p = run("ps", ["-p", String(pid), "-o", "comm="]);
    if (p) return p;
  }
  return argv0(row?.cmd) || "";
}

const argv0 = cmd => {
  if (!cmd) return "";
  const s = String(cmd).trim();
  if (s[0] === '"') return s.slice(1, s.indexOf('"', 1));
  return s.split(/\s+/)[0];
};

// The OS user that owns the process (for the ownership gate in boundaries.js).
export function processOwner(pid, platform = process.platform) {
  if (platform === "win32") {
    const out = run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Invoke-CimMethod -MethodName GetOwner).User`]);
    return out || null;
  }
  const out = run("ps", ["-o", "user=", "-p", String(pid)]);
  return out || null;
}

// Read the first bytes of a file and classify the binary. Read-only: opens,
// reads a header, closes. { format, arch } or nulls.
export function readBinaryHeader(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(64);
    const n = readSync(fd, buf, 0, 64, 0);
    if (n < 4) return { format: null, arch: null };
    return classifyHeader(buf);
  } catch {
    return { format: null, arch: null };
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch {}
  }
}

// Magic-number classification. Pure, so it's unit-testable with a few bytes.
export function classifyHeader(buf) {
  const be32 = o => buf.readUInt32BE(o), le32 = o => buf.readUInt32LE(o), le16 = o => buf.readUInt16LE(o);

  // Mach-O: FEEDFACE/FEEDFACF (thin, BE magic), CEFAEDFE/CFFAEDFE (LE), and
  // CAFEBABE (fat/universal — a wrapper over thin slices).
  const m = be32(0);
  if (m === 0xcafebabe) return { format: "macho", arch: "universal" };
  if (m === 0xfeedface || m === 0xcefaedfe) return { format: "macho", arch: "x86" };
  if (m === 0xfeedfacf || m === 0xcffaedfe) {
    // cputype at offset 4 (little-endian thin): 0x0100000C = arm64, 0x01000007 = x86_64.
    const cpu = le32(4);
    return { format: "macho", arch: cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x86_64" : "64-bit" };
  }

  // PE: "MZ" then, at the e_lfanew offset, "PE\0\0" and a machine field.
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const peOff = le32(0x3c);
    // Header may be past our 64-byte read; report PE with unknown machine then.
    if (peOff + 6 <= buf.length && buf[peOff] === 0x50 && buf[peOff + 1] === 0x45) {
      const machine = le16(peOff + 4);
      const arch = machine === 0x8664 ? "x86_64" : machine === 0x14c ? "x86" : machine === 0xaa64 ? "arm64" : "unknown";
      return { format: "pe", arch };
    }
    return { format: "pe", arch: null };
  }

  // ELF: 0x7F 'E' 'L' 'F', class byte at 4 (1=32,2=64), machine at 18 (LE for little-endian ELF).
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    const cls = buf[4] === 2 ? "64" : buf[4] === 1 ? "32" : "?";
    const machine = buf[5] === 1 ? le16(18) : buf.readUInt16BE(18);
    const arch = machine === 0x3e ? "x86_64" : machine === 0xb7 ? "arm64" : machine === 0x03 ? "x86" : `${cls}-bit`;
    return { format: "elf", arch };
  }

  return { format: null, arch: null };
}

// The whole step: a PID (or the active window) → a TargetContext, without the
// REA symbol maps yet (rea-inspect.js adds those) and before authorization
// (boundaries.authorizeTarget sets `owned`). Returns { context, warnings }.
export function discover({ pid, platform = process.platform } = {}) {
  const warnings = [];
  let targetPid = pid;
  if (!Number.isInteger(targetPid) || targetPid <= 0) {
    targetPid = activeWindowPid(platform);
    if (!targetPid) { warnings.push(activeWindowHint(platform)); return { context: null, warnings }; }
  }
  const row = processRow(targetPid, platform);
  const exe = exePath(targetPid, row, platform);
  if (!exe) warnings.push(`couldn't resolve the executable path for PID ${targetPid}`);
  const { format, arch } = exe ? readBinaryHeader(exe) : { format: null, arch: null };
  const user = processOwner(targetPid, platform);
  const context = createContext({
    pid: targetPid, exe, format, arch, user,
    name: row?.exe || exe, signing: {},
  });
  // `me` recorded for the diagnostic; authorization is boundaries.js's job.
  if (user && user !== currentUser(platform)) warnings.push(`PID ${targetPid} is owned by ${user}, not you`);
  return { context, warnings };
}
