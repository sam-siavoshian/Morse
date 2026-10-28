// The two JSON shapes the native-DBI prototype passes around, with validators.
//
//   TargetContext — what discover.js + rea-inspect.js learn about a process
//     and its binary. Plain data, no handles, safe to log and cache.
//   ModSpec       — a declarative native mod: what to hook and what to do.
//     The native cousin of core/mod.js's web mod ("mods are data").
//
// Validation here is deliberately small and dependency-free: it rejects the
// shapes the runner and agent can't act on, and normalises the rest. It is not
// a schema language; it is the gate that keeps a malformed mod from reaching
// Interceptor.

export const CONTEXT_VERSION = 1;
export const MODSPEC_VERSION = 1;

export const BINARY_FORMATS = ["macho", "pe", "elf"];
export const TARGET_KINDS = ["export", "signature", "offset"];
export const ACTION_KINDS = ["observe", "replace"];

// ---- TargetContext -------------------------------------------------------

// Shape (all fields optional except pid/exe once discovered):
//   { v, pid, exe, name, format, arch, user, owned, signing:{…},
//     symbols:[{name, address, kind}], candidates:[{name?, address, size?,
//     evidence}], discoveredAt }
export function createContext({ pid, exe, name, format, arch, user, owned, signing, symbols, candidates } = {}) {
  return {
    v: CONTEXT_VERSION,
    pid: Number.isInteger(pid) ? pid : null,
    exe: typeof exe === "string" ? exe : "",
    name: name || (exe ? exe.split(/[\\/]/).pop() : "") || "",
    format: BINARY_FORMATS.includes(format) ? format : null,
    arch: arch || null,
    user: user || null,       // the OS user that owns the process
    owned: owned === true,    // true only once boundaries.authorizeTarget says so
    signing: signing && typeof signing === "object" ? signing : {},
    symbols: Array.isArray(symbols) ? symbols : [],
    candidates: Array.isArray(candidates) ? candidates : [],
    discoveredAt: new Date().toISOString(),
  };
}

export function isContextUsable(ctx) {
  return !!ctx && Number.isInteger(ctx.pid) && ctx.pid > 0 && typeof ctx.exe === "string" && ctx.exe.length > 0;
}

// ---- ModSpec -------------------------------------------------------------

// A target names *where* to hook; an action names *what* to do there.
//   target: { kind:"export",    module, symbol }
//           { kind:"signature", module, pattern, nth? }   // pattern: sigscan syntax
//           { kind:"offset",    module, offset }           // offset: number or "0x…"
//   action: { kind:"observe",  onEnter?, onLeave? }        // strings: agent-side JS bodies
//           { kind:"replace",  retType, argTypes, body }   // NativeCallback definition
//
// The onEnter/onLeave/body strings are evaluated *inside the target* by the
// agent. That is the whole point of a mod, and also why the runner refuses to
// run a spec whose `active` the caller didn't set on purpose, and why observe
// (read-only) is the default kind the doc steers people to.
export function createModSpec({ id, title, match, target, action, active } = {}) {
  return {
    morseNative: MODSPEC_VERSION,
    id: id || newId(),
    title: title || "",
    match: normalizeMatch(match),
    target: target || null,
    action: action || { kind: "observe" },
    active: active === true,
    status: "idle",   // idle | applied | errored, set by the runner
    error: null,
  };
}

function normalizeMatch(m) {
  m = m && typeof m === "object" ? m : {};
  return { exe: m.exe || null, format: BINARY_FORMATS.includes(m.format) ? m.format : null, arch: m.arch || null };
}

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

const HEX = /^0x[0-9a-fA-F]+$/;

// Returns { ok, errors:[string] }. Errors are messages a person could read;
// the runner surfaces them rather than throwing.
export function validateModSpec(spec) {
  const errors = [];
  const bad = msg => errors.push(msg);

  if (!spec || typeof spec !== "object") return { ok: false, errors: ["mod spec is not an object"] };
  if (spec.morseNative !== MODSPEC_VERSION) bad(`unknown mod version ${spec.morseNative}`);
  if (!spec.id || typeof spec.id !== "string") bad("mod needs an id");

  const t = spec.target;
  if (!t || typeof t !== "object") bad("mod needs a target");
  else if (!TARGET_KINDS.includes(t.kind)) bad(`target.kind must be one of ${TARGET_KINDS.join(", ")}`);
  else {
    if (!t.module || typeof t.module !== "string") bad("target.module (a loaded module name) is required");
    if (t.kind === "export" && (!t.symbol || typeof t.symbol !== "string")) bad("export target needs target.symbol");
    if (t.kind === "signature" && (!t.pattern || typeof t.pattern !== "string")) bad("signature target needs target.pattern");
    if (t.kind === "offset") {
      const ok = Number.isInteger(t.offset) || (typeof t.offset === "string" && HEX.test(t.offset));
      if (!ok) bad("offset target needs target.offset as an integer or 0x-hex string");
    }
  }

  const a = spec.action;
  if (!a || typeof a !== "object") bad("mod needs an action");
  else if (!ACTION_KINDS.includes(a.kind)) bad(`action.kind must be one of ${ACTION_KINDS.join(", ")}`);
  else if (a.kind === "observe") {
    if (!a.onEnter && !a.onLeave) bad("observe action needs onEnter and/or onLeave");
    for (const k of ["onEnter", "onLeave"]) if (a[k] != null && typeof a[k] !== "string") bad(`action.${k} must be a string of agent JS`);
  } else if (a.kind === "replace") {
    if (typeof a.body !== "string" || !a.body.trim()) bad("replace action needs a body (NativeCallback JS)");
    if (!a.retType || typeof a.retType !== "string") bad("replace action needs retType (e.g. 'int', 'pointer', 'void')");
    if (!Array.isArray(a.argTypes)) bad("replace action needs argTypes (an array, possibly empty)");
  }

  return { ok: errors.length === 0, errors };
}

// A mod spec the runner is allowed to apply: valid, and explicitly active.
// `active` is separate from valid on purpose — applying a native hook is not
// something to do because a spec merely parsed.
export function isApplicable(spec, context) {
  const v = validateModSpec(spec);
  if (!v.ok || !spec.active) return false;
  const m = spec.match || {};
  if (m.exe && context?.exe && m.exe !== context.exe) return false;
  if (m.format && context?.format && m.format !== context.format) return false;
  if (m.arch && context?.arch && m.arch !== context.arch) return false;
  return true;
}
