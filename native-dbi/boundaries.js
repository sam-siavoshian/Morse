// Security boundaries and platform diagnostics for native DBI.
//
// The platforms do not let you attach to any process you like, and they are
// right not to. This module does two things, and refuses to do a third:
//
//   authorizeTarget(context)  — the gate. Same-user ownership only. The runner
//                               calls it before attaching and stops on !ok.
//   probeRestrictions(context) — detect the platform protection in the way
//                               (hardened runtime, integrity level, ptrace
//                               scope, SIP) and describe it.
//   summarise(diagnostics)    — one human-readable block, doctor-style.
//
// It never bypasses anything. When a protection blocks instrumentation, the
// remedy it prints is something the person does for an app and a machine that
// are theirs (install a debuggable build, run at a matching integrity level,
// change their own kernel setting) — or, when the honest answer is "you can't,
// and shouldn't try", it says that. No path here disables SIP, asks for sudo,
// re-signs code, or touches another process's integrity level.
//
// Everything takes its inputs as arguments (platform, env, a `run` for shelling
// out, a `readFile`) so each platform's answers are testable on any machine.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

const defaultRun = (file, args) => {
  try { return execFileSync(file, args, { encoding: "utf8", timeout: 4000, windowsHide: true }); }
  catch { return null; }
};
const defaultRead = p => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// ---- The gate: who owns the process --------------------------------------

// { ok, reason }. ok:true only when the target belongs to the current user.
//   context: a TargetContext (schema.js). context.user is the process owner.
// The rule is intentionally narrow: your own processes, never anyone else's,
// and never as root reaching into another user's process. Everything the tool
// does downstream assumes this returned ok.
export function authorizeTarget(context, {
  platform = process.platform,
  me = currentUser(platform),
  uid = process.getuid?.(),
} = {}) {
  if (!context || !Number.isInteger(context.pid) || context.pid <= 0) {
    return { ok: false, reason: "no valid target process" };
  }
  if (context.pid === process.pid) return { ok: false, reason: "refusing to instrument Morse itself" };

  const owner = context.user;
  // Unknown owner: don't guess in the permissive direction.
  if (!owner) return { ok: false, reason: "can't confirm who owns this process; not attaching" };

  if (platform !== "win32" && uid === 0 && owner !== "root") {
    return { ok: false, reason: `running as root but the target belongs to ${owner}; attach as ${owner} instead` };
  }
  if (me && owner !== me) {
    return { ok: false, reason: `this process belongs to ${owner}, not you (${me}); Morse only instruments your own processes` };
  }
  return { ok: true, reason: "owned by the current user" };
}

export function currentUser(platform = process.platform) {
  try { return os.userInfo().username || (platform === "win32" ? process.env.USERNAME : process.env.USER) || null; }
  catch { return (platform === "win32" ? process.env.USERNAME : process.env.USER) || null; }
}

// ---- The platform protections --------------------------------------------

// Returns [{ id, blocking, detail, remedy }]. blocking:true means an attach
// will fail (or shouldn't be attempted). The runner turns these into what the
// person sees and does not attempt to attach past a blocking one.
export function probeRestrictions(context, {
  platform = process.platform,
  env = process.env,
  run = defaultRun,
  read = defaultRead,
} = {}) {
  if (platform === "darwin") return probeMac(context, run);
  if (platform === "win32") return probeWindows(context, env, run);
  return probeLinux(context, read);
}

function probeMac(context, run) {
  const out = [];
  const exe = context?.exe || "";

  // SIP-protected system locations: out of scope, not a thing to work around.
  if (/^\/(System|usr\/(?!local)|bin|sbin|Applications\/(Safari|Mail|Messages)\.app)/.test(exe)) {
    out.push({ id: "sip", blocking: true,
      detail: `${exe} is a system binary protected by System Integrity Protection.`,
      remedy: "System apps are out of scope. Morse won't disable SIP; point it at an app you installed yourself." });
    return out;
  }

  // Hardened runtime + no get-task-allow ⇒ you can't attach a debugger/Frida.
  // `codesign --display --entitlements` is read-only; parse, don't bypass.
  const info = run("codesign", ["--display", "--verbose=2", "--entitlements", "-", exe]);
  const hardened = info != null && /flags=.*runtime/i.test(info);
  const getTaskAllow = info != null && /com\.apple\.security\.get-task-allow\b[^<]*<true/i.test(info);
  if (hardened && !getTaskAllow) {
    out.push({ id: "hardened-runtime", blocking: true,
      detail: "This app uses the hardened runtime without the get-task-allow entitlement, so macOS won't let any debugger (or Frida) attach.",
      remedy: "DBI needs a build you can debug: a debug build, or — only for an app you're entitled to re-sign — one you re-sign yourself with get-task-allow. Morse won't strip or forge the app's signature." });
  }
  if (info == null) {
    out.push({ id: "signing-unknown", blocking: false,
      detail: "Couldn't read the code signature (codesign unavailable or the path isn't a signed bundle).",
      remedy: "If attach fails, the hardened runtime is the likely cause." });
  }
  return out;
}

function probeWindows(context, env, run) {
  const out = [];
  // Our own integrity level, from whoami. A target at a higher IL than us
  // (admin/System) can't be opened for instrumentation without elevating —
  // and elevating to reach past a protection is exactly what we don't do.
  const groups = run("whoami", ["/groups"]) || "";
  const mine = /High Mandatory Level/i.test(groups) ? "high"
    : /System Mandatory Level/i.test(groups) ? "system"
    : /Medium Mandatory Level/i.test(groups) ? "medium" : "unknown";
  out.push({ id: "integrity", blocking: false,
    detail: `Morse is running at ${mine} integrity.`,
    remedy: "If the target runs elevated (as administrator or System), it's at a higher integrity level and can't be opened from here. Run both the same way — don't elevate just to get around a protection." });

  if (context?.signing?.ppl) {
    out.push({ id: "ppl", blocking: true,
      detail: "The target is a Protected Process (PPL). The OS blocks handles to it by design.",
      remedy: "Protected processes are out of scope." });
  }
  return out;
}

function probeLinux(context, read) {
  const out = [];
  // Yama ptrace_scope: 0 = classic, 1 = child-only (the common default),
  // 2 = admin-only, 3 = no attach. Frida's attach (non-child ptrace) needs 0,
  // or CAP_SYS_PTRACE. This is the person's own kernel setting; report it,
  // don't change it.
  const scope = (read("/proc/sys/kernel/yama/ptrace_scope") || "").trim();
  if (scope && scope !== "0") {
    const blocking = scope !== "1"; // "1" can still work if we become the parent; ≥2 won't for us
    out.push({ id: "ptrace_scope", blocking,
      detail: `kernel.yama.ptrace_scope is ${scope}, which restricts attaching to a process you didn't fork.`,
      remedy: scope === "1"
        ? "Attach may still work for a process Morse launched. Otherwise this is your kernel setting to change (sysctl kernel.yama.ptrace_scope=0) if it's your machine and you accept the trade-off."
        : "Non-child attach is blocked by your kernel. Change kernel.yama.ptrace_scope yourself if it's your machine; Morse won't change it for you." });
  }
  // Containers often drop CAP_SYS_PTRACE; surface it as info.
  const status = read(`/proc/${context?.pid}/status`) || read("/proc/self/status") || "";
  const capEff = /CapEff:\s*([0-9a-f]+)/i.exec(status)?.[1];
  if (capEff && !hasPtraceCap(capEff)) {
    out.push({ id: "cap_sys_ptrace", blocking: false,
      detail: "This environment doesn't appear to grant CAP_SYS_PTRACE (common inside containers).",
      remedy: "Run Morse where you have ptrace capability; Morse won't try to raise its own privileges." });
  }
  return out;
}

// CAP_SYS_PTRACE is bit 19.
function hasPtraceCap(hex) {
  try { return (BigInt("0x" + hex) & (1n << 19n)) !== 0n; } catch { return true; }
}

// ---- Putting it together --------------------------------------------------

// A single verdict the runner acts on and the person reads.
//   { attachable, gate, restrictions, text }
export function assess(context, opts = {}) {
  const gate = authorizeTarget(context, opts);
  const restrictions = gate.ok ? probeRestrictions(context, opts) : [];
  const blocked = restrictions.filter(r => r.blocking);
  return {
    attachable: gate.ok && blocked.length === 0,
    gate,
    restrictions,
    text: summarise({ gate, restrictions }),
  };
}

export function summarise({ gate, restrictions = [] }) {
  const lines = [];
  if (gate && !gate.ok) lines.push(`✗ not attaching: ${gate.reason}`);
  else if (gate) lines.push(`✓ ${gate.reason}`);
  for (const r of restrictions) {
    lines.push(`${r.blocking ? "✗" : "!"} ${r.detail}`);
    if (r.remedy) lines.push(`    ${r.remedy}`);
  }
  if (lines.length === (gate ? 1 : 0)) lines.push("No platform restrictions detected.");
  return lines.join("\n");
}
