// The native-DBI prototype, tied together: the window→context→authorize→
// inspect pipeline, and a one-call way to run a batch of native mods against a
// target with full lifecycle and error isolation.
//
// This is the only module meant to be imported from outside native-dbi/, and
// nothing in daemon/ imports it. It stays opt-in.

import { discover } from "./discover.js";
import { inspectWithRea } from "./rea-inspect.js";
import { assess, authorizeTarget } from "./boundaries.js";
import { NativeSession, triage, loadFrida, fridaMissingMessage } from "./frida-runner.js";

export { createModSpec, validateModSpec, createContext } from "./schema.js";
export { parsePattern, scan, resolveOffset, toFridaPattern, uniqueness } from "./sigscan.js";
export { assess, authorizeTarget, probeRestrictions } from "./boundaries.js";
export { NativeSession } from "./frida-runner.js";

// Step 1–4 of discovery/context extraction. Returns a context ready to show the
// person (what can be hooked) plus the authorization verdict and any warnings.
//   { context, authorization, assessment, warnings }
// `inspect:false` skips REA (just the process/binary facts); `focus` are words
// from the person's request that steer REA's deep pass.
export async function prepareTarget({ pid, platform = process.platform, inspect = true, focus = [] } = {}) {
  const { context, warnings } = discover({ pid, platform });
  if (!context) return { context: null, authorization: { ok: false, reason: "no target" }, warnings };

  // Authorize before any inspection of the binary — same-user only.
  const authorization = authorizeTarget(context, { platform });
  context.owned = authorization.ok;

  const assessment = assess(context, { platform });

  if (inspect && authorization.ok) {
    const { context: enriched, warning } = await inspectWithRea(context, { focus });
    if (warning) warnings.push(warning);
    return { context: enriched, authorization, assessment, warnings };
  }
  return { context, authorization, assessment, warnings };
}

// Run a batch of mods against a prepared context. Opens a NativeSession,
// applies the active+valid ones, and hands back the live session so the caller
// can listen for "mod"/"detached"/"error" and call detach() when done.
//   { ok, session?, reason?, diagnostics, applied?, invalid }
export async function runMods(context, specs = [], { onEvent } = {}) {
  const { active, invalid } = triage(specs);

  if (!(await loadFrida())) return { ok: false, reason: "frida-missing", diagnostics: fridaMissingMessage(), invalid };

  const auth = authorizeTarget(context);
  if (!auth.ok) return { ok: false, reason: "unauthorized", diagnostics: `✗ ${auth.reason}`, invalid };

  const session = new NativeSession(context);
  if (onEvent) {
    session.on("mod", e => onEvent("mod", e));
    session.on("detached", e => onEvent("detached", e));
    session.on("error", e => onEvent("error", e));
  }

  const res = await session.attach(active);
  if (!res.ok) return { ok: false, reason: res.reason, diagnostics: res.diagnostics, invalid };
  return { ok: true, session, diagnostics: res.diagnostics, applied: res.applied, invalid };
}
