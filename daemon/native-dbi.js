// The daemon's thin bridge to the native-DBI prototype (native-dbi/).
//
// This is the one place daemon/ reaches into native-dbi/, and it stays behind
// the same walls the prototype set: frida is optional (loaded lazily, never a
// hard dependency), and nothing attaches without the ownership gate and the
// platform assessment passing. The CLI launch path (daemon/desktop.js) calls
// these; the Electron desktop app keeps its own macOS Accessibility native
// path and is not touched here.
//
// Native support attaches to a process the person already started — it does
// not spawn or inject into a fresh launch. So the app must be running.

import { listProcesses, findAppProcesses } from "./apps.js";
import { prepareTarget } from "../native-dbi/index.js";
import { runMods } from "../native-dbi/index.js";
import { loadFrida, fridaMissingMessage } from "../native-dbi/frida-runner.js";

// Is native DBI possible here at all? (frida installed.) Cheap after the first
// call (frida-runner caches the import attempt).
export async function nativeAvailable() {
  const frida = await loadFrida();
  return frida ? { ok: true } : { ok: false, reason: "frida-missing", message: fridaMissingMessage() };
}

// The running PID for this app, or null when it isn't open. Reuses the same
// process-matching daemon/apps.js uses for Electron apps, so "which process is
// this app" has one answer.
export function nativePid(app, { platform = process.platform, procs } = {}) {
  const list = procs || listProcesses(platform);
  const matches = findAppProcesses(app, list, { platform });
  return matches[0]?.pid ?? null;
}

// Connect: discover → authorize (same-user gate) → assess (platform
// restrictions) → attach and apply mods. Returns a plain result the caller
// turns into output; it never throws for an expected refusal.
//   { ok, reason?, diagnostics, context?, session?, applied?, warnings }
// `inspect:false` — we don't need REA's symbol maps just to attach and hold a
// session; those are for authoring mods, not for connecting.
export async function connectNative(app, { pid, mods = [], onEvent, platform = process.platform } = {}) {
  const avail = await nativeAvailable();
  if (!avail.ok) return { ok: false, reason: "frida-missing", diagnostics: avail.message, warnings: [] };

  const { context, authorization, assessment, warnings } = await prepareTarget({ pid, platform, inspect: false });
  if (!context) return { ok: false, reason: "no-target", diagnostics: (warnings || []).join("\n") || "no target process found", warnings: warnings || [] };
  if (!authorization.ok) return { ok: false, reason: "unauthorized", diagnostics: assessment.text, context, warnings };
  if (!assessment.attachable) return { ok: false, reason: "blocked", diagnostics: assessment.text, context, warnings };

  const run = await runMods(context, mods, { onEvent });
  if (!run.ok) return { ok: false, reason: run.reason, diagnostics: run.diagnostics, context, warnings };
  return { ok: true, session: run.session, context, applied: run.applied, invalid: run.invalid, diagnostics: assessment.text, warnings };
}
