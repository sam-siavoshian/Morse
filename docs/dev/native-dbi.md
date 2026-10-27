# Native apps, through dynamic binary instrumentation (prototype)

Morse changes apps it can reach over the Chrome DevTools Protocol: Electron
and Chromium apps, and websites. A native app — one compiled to machine code
with no CDP, no renderer, no JavaScript to read — is out of reach today.
`morse profile` lists such apps as "can't connect" and stops there.

This directory (`native-dbi/`) is a **prototype** for reaching those apps with
**dynamic binary instrumentation (DBI)**: attaching to a process the person
already runs, reading its memory, and wrapping specific functions so a mod can
observe or change what they do. It uses [Frida](https://frida.re) for the
instrumentation and [REA](https://github.com/morluto/rea) for read-only
analysis of the binary beforehand.

It is kept out of `daemon/` on purpose. Read the next section before building
on it.

## This crosses a boundary Morse set deliberately

Everything Morse ships is non-invasive, and that is a promise, not an accident:

- `docs/dev/architecture.md`: **"No patching.** App files, code signatures and
  ASAR integrity stay intact." Morse relaunches an Electron app with a
  debugging pipe and attaches over CDP; it never writes to the app.
- `docs/dev/rea.md`, "Read only": **"No native instrumentation, no hooking, no
  injection into native processes."** Profiles are static reads of the app's
  JavaScript plus CDP in its pages.
- `README.md`: Morse "doesn't unlock a service's private backend or turn paid
  access into free access."

DBI is the opposite kind of tool. It injects a thread into another process and
rewrites its instructions in memory. The person owns the process and asks for
the change, but the host app did not consent at build time, and the technique
is the same one used for game cheats, piracy, and malware. That is why it is
fenced off here rather than folded into `daemon/`, and why the whole subsystem
is **opt-in, off by default, and gated on an optional dependency the person
installs themselves** (`frida`, which `daemon/` never requires).

Adopting any of this into the shipping product is a maintainer decision about
what Morse is willing to be, not a detail of this prototype. The code is
written so that decision stays easy to make in either direction: nothing in
`daemon/` imports from `native-dbi/`.

### Non-goals, enforced where we can and stated where we can't

Morse stays on the same side of the line it always has. This subsystem will
not help with, and the prototype actively refuses or declines to assist with:

- **Processes that are not the person's own.** The runner attaches only to a
  PID whose owner is the current user (`boundaries.authorizeTarget`). It
  refuses other users' processes and refuses to attach as root to another
  user's process.
- **DRM, licensing, entitlement, or subscription checks.** Out of scope by
  policy. The tool offers no help locating or neutralising them.
- **Anti-cheat and anti-tamper.** Out of scope by policy. If a target ships
  one, the right outcome is to stop (see "Failing gracefully").
- **OS platform integrity.** The tool never disables SIP, never asks for
  `sudo`, never strips or re-signs code signatures, never touches another
  process's integrity level, and never attempts to defeat a protection the OS
  or the app enforces. When a protection blocks it, it reports the protection
  and stops.

The honest limit: once a tool can wrap an arbitrary function in a process you
own, policy — not a `switch` statement — is what keeps it pointed at
accessibility and customisation rather than at those targets. The prototype
makes the legitimate path easy and the refusals explicit; it does not claim to
make misuse impossible, and it adds nothing that helps with it.

## The four components

```
  user window ──► discover.js ──► TargetContext {pid, exe, format, arch, signing}
                                        │
                                        ▼
                          boundaries.authorizeTarget()  ── refuse / diagnose
                                        │ ok
                      ┌─────────────────┴──────────────────┐
                      ▼                                     ▼
              rea-inspect.js                          sigscan.js
       (REA MCP: exports, procedures,          (byte-pattern search, for
        function boundaries → JSON)             stripped builds / updates)
                      │                                     │
                      └──────────────► ModSpec[] ◄──────────┘
                                        │  (schema.js)
                                        ▼
                              frida-runner.js  ──loads──►  agent.js (in target)
                        attach · apply · detach · unhook      Interceptor + Memory.scan
                        error isolation, host never crashes   each hook try/caught + revertible
```

### 1. Target discovery & context extraction — `discover.js`, `rea-inspect.js`

**Window → PID → executable metadata**, per platform, best-effort with clear
fallbacks:

| | active-window → PID | PID → exe path | metadata |
|---|---|---|---|
| macOS | `osascript` (System Events `unix id`) | `ps -p … -o comm=` / `lsof` | Mach-O magic, arch, signature via `codesign` |
| Windows | PowerShell `GetForegroundWindow` + `GetWindowThreadProcessId` | `(Get-Process -Id).Path` | PE magic, machine field, Authenticode presence |
| Linux | `xdotool` / `xprop _NET_WM_PID` (X11 only) | `/proc/<pid>/exe` | ELF magic, class, `PT_GNU_STACK`/RELRO hints |

It reuses `daemon/apps.js`'s `listProcesses()` for the PID→row mapping so the
two agree on what a process is. The output is a `TargetContext` (see
`schema.js`), a plain JSON object with no handles, safe to log and cache.

**REA inspection** (`rea-inspect.js`) drives REA's MCP server — stdio by
default, or `rea mcp --http` at `/mcp` on loopback — to read the binary
*statically and read-only*. It calls, in order:

- `open_binary { path, provider_id }` then `binary_session {}` to pick a
  provider and learn which tools are callable;
- `inspect_macho` (facets `exports`/`imports`) or `inspect_binary_layout` for
  PE/ELF, plus `list_names`, for exported and dynamic symbols;
- `list_procedures` / `search_procedures` and `resolve_containing_procedure`
  to map **candidate function boundaries** (start address, size, name when
  known);
- `analyze_function { address }` for the shortlist the person's request points
  at (callers, callees, a disassembly facet) — used to *propose* a byte
  signature for a function that has no stable symbol.

The result is folded into the `TargetContext.symbols` and
`TargetContext.candidates` arrays: a structured map of what can be hooked,
with the evidence (symbol vs. signature vs. offset) for each.

### 2. Frida-based instrumentation core — `frida-runner.js`, `agent.js`, `mod spec` in `schema.js`

A **declarative mod** names a target (exported symbol, or a signature, or a
raw module+offset), a replacement or an observation, and an `active` flag:

```jsonc
{
  "morseNative": 1,
  "id": "…",
  "title": "Announce the current track for a screen reader",
  "match": { "exe": "…/Player", "format": "macho", "arch": "arm64" },
  "target": { "kind": "export", "module": "Player", "symbol": "_now_playing" },
  "action": { "kind": "observe", "onEnter": "…", "onLeave": "…" },
  "active": true
}
```

`action.kind` is `observe` (an `Interceptor.attach` that only reads and reports
— the safe default) or `replace` (an `Interceptor.replace` / `NativeCallback`
that changes behaviour). `target.kind` is `export`, `signature` (a pattern from
`sigscan.js`), or `offset` (module + byte offset, for when the person already
knows it).

**`frida-runner.js` (host/Node side):**

- `frida` is imported dynamically and is **optional**. Absent → a clean
  diagnostic ("install `frida` to use native mods"), never a crash, and
  `daemon/` stays at one dependency.
- Attaches to an already-running, authorized PID. It does not spawn, patch, or
  re-sign anything.
- Applies mods one at a time and tracks every hook, so detach is complete.

**`agent.js` (runs inside the target):** resolves each target
(`Module.getExportByName`, or `Memory.scan` for a signature, or
`module.base.add(offset)`), installs the hook **inside a try/catch**, and on
any failure reverts that one hook and reports it. One broken mod never takes
down the others or the host app.

**Lifecycle & error isolation** — the core requirement:

- Each mod is independent. A throw while installing, or inside a replacement,
  is caught, the hook for that mod is reverted (`Interceptor.revert`), and the
  mod is marked `errored` with the message — the process keeps running.
- `detach()` reverts every hook (`Interceptor.revert` for each, or
  `Interceptor.detachAll`), unloads the script, and detaches the session, in
  that order, so the target is left exactly as found.
- The session's `detached` signal (target exited, or crashed for its own
  reasons) is surfaced as an event, not an exception.
- Nothing is persisted into the target. Close the app and the changes are
  gone — "live and reversible", the same promise CDP mods make.

### 3. Signature scanning — `sigscan.js`

Commercial native apps ship stripped: no symbol for the function you want, and
the offset moves every point release. A **byte-pattern signature** — a run of
opcode bytes with the volatile bytes (addresses, offsets) wildcarded — is how
you find the same function across minor revisions.

`sigscan.js` is a pure utility (no Frida, fully unit-testable):

- `parsePattern("48 8B ?? ?? ?? ?? E8")` → `{ bytes, mask }`, IDA/x64dbg
  syntax, `??` or `?` for a wildcard byte.
- `scan(buffer, pattern, { limit })` → offsets, with a first-fixed-byte skip so
  scanning a whole code section is cheap.
- `toFridaPattern(pattern)` → the `"48 8b ?? e8"` string `Memory.scan` takes,
  so the exact signature resolved against a file on disk is the one the agent
  searches for in memory.
- `uniqueness(buffer, pattern)` → how many times it matches, so a mod can
  prefer a signature that resolves to exactly one site.

A signature resolves to an offset; the offset still goes through the same
authorization and the same revertible hook. Sigscanning widens *which builds* a
mod survives; it does not widen *what the tool is allowed to do*.

### 4. Architecture & security boundaries — `boundaries.js`

The platforms do not let you attach to a process freely, and they are right not
to. The tool's job is to detect the restriction and **fail with a diagnostic a
person can act on**, never to defeat it.

| Platform | Restriction | What the tool reports (it does not bypass) |
|---|---|---|
| **macOS** | Hardened runtime without `get-task-allow`; SIP protects system binaries; Apple-platform & App Store apps aren't debuggable by you | "This app uses the hardened runtime and can't be instrumented. DBI needs a build you can debug (a debug build, or one re-signed with the `get-task-allow` entitlement **by you, for an app you're entitled to re-sign**). System apps are protected by SIP and are out of scope." |
| **Windows** | Target at a higher integrity level (admin/System) than Morse; PPL; a debugger-present or anti-tamper check | "This app runs at a higher integrity level than Morse, so it can't be opened for instrumentation. Run both the same way, or stop — don't elevate to get around a protection." |
| **Linux** | `yama ptrace_scope` ≥ 1 blocks non-child attach; a container may drop `CAP_SYS_PTRACE` | "The kernel's `ptrace_scope` is set to N; non-child attach is blocked. This is a system setting — change it yourself if it's your machine and you accept the trade-off; Morse won't change it for you." |

`boundaries.js` exposes:

- `authorizeTarget(context)` → `{ ok, reason }`. Enforces same-user ownership;
  refuses other users and root-against-another-user. **This gate is not
  advisory** — the runner calls it before attaching and stops on `!ok`.
- `probeRestrictions(context)` → `[{ id, blocking, detail, remedy }]`. The
  platform checks above. `blocking: true` means attach will fail; the runner
  turns these into the diagnostics the person sees.
- `summarise(diagnostics)` → one human-readable block, in the spirit of
  `morse doctor`'s platform rows.

The design rule for every one of these: when a protection is in the way, the
remedy we print is something the person does for an app and machine that are
theirs — install a debuggable build, run at a matching integrity level, change
their own kernel setting — and when the honest remedy is "you can't, and you
shouldn't try," that is what it says.

## Status

Prototype. Pure modules (`sigscan.js`, `schema.js`, the parsing/diagnostic
logic in `boundaries.js`, the REA response mapping in `rea-inspect.js`) run and
are unit-testable without Frida or a target. The Frida paths
(`frida-runner.js`, `agent.js`) are written against Frida's documented API and
need `frida` installed plus a real, user-owned target to exercise. No part of
this is wired into the CLI, the desktop app, or `daemon/`.
