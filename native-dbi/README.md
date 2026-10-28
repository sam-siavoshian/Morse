# `native-dbi/` — native apps via dynamic binary instrumentation (prototype)

A prototype for reaching **native** apps (compiled, no CDP) that Morse can't
change today, using [Frida](https://frida.re) for instrumentation and
[REA](https://github.com/morluto/rea) for read-only analysis.

> **Read [`docs/dev/native-dbi.md`](../docs/dev/native-dbi.md) first.** This
> crosses the "no native instrumentation" boundary Morse set on purpose
> (`docs/dev/rea.md`). It is opt-in, off by default, and gated on an optional
> dependency (`frida`). `daemon/` reaches it only through the one seam
> `daemon/native-dbi.js`, used by `morse launch` for native apps; the Electron
> desktop app and the CDP connector are untouched. Adopting it further into the
> product is a maintainer decision, not a detail of this prototype.

## What's here

| File | Component | Runs without Frida/target? |
|---|---|---|
| `schema.js` | TargetContext + declarative ModSpec, validators | ✅ pure |
| `sigscan.js` | byte-pattern parse + search + Frida serialisation | ✅ pure |
| `boundaries.js` | ownership gate + platform-restriction diagnostics | ✅ (logic pure; probes shell out) |
| `discover.js` | window → PID → executable metadata | partly (header parsing is pure) |
| `rea-inspect.js` | REA MCP client → symbols & function boundaries | needs `rea` |
| `agent.js` | the in-target Frida agent (hook install/revert) | needs Frida + target |
| `frida-runner.js` | host-side attach/apply/detach, error isolation | needs `frida` |
| `index.js` | the pipeline + `prepareTarget` / `runMods` | orchestration |
| `apply.js` | `NativeModService`: bar request → plan → apply → save → undo | ✅ (planner seam injected) |
| `store.js` | persist native mods per app (`~/.morse/native-mods.json`) | ✅ pure (fs injectable) |
| `window-bounds.js` | target window geometry per platform (for the overlay) | partly (parsers are pure) |
| `overlay.js` | overlay region math + follow/hide controller | ✅ pure |

The overlay that puts the same bar over a native app is split across
`window-bounds.js` + `overlay.js` here (tracking, pure) and
`desktop-app/overlay.js` + `desktop-app/ui/overlay.*` (the Electron window).
See the "bar over native apps" section of the doc.

## Boundaries (enforced / stated)

- Attaches **only to processes owned by the current user**; refuses others and
  refuses root-against-another-user (`boundaries.authorizeTarget`, called before
  every attach).
- **Out of scope by policy:** DRM, licensing/subscription checks, anti-cheat,
  anti-tamper, and anything touching OS integrity. The tool never disables SIP,
  asks for `sudo`, strips/re-signs code signatures, or changes a process's
  integrity level. When a protection blocks it, it reports the protection and
  stops.
- Read-only everywhere before Frida: process tables, binary headers, and REA's
  static analysis. The Frida layer persists nothing — close the app and the
  changes are gone.

## Sketch of use

```js
import { prepareTarget, runMods, createModSpec } from "./native-dbi/index.js";

// 1–3: discover the active window's process, authorize, inspect the binary.
const { context, authorization, assessment, warnings } = await prepareTarget({ focus: ["volume"] });
if (!authorization.ok) { console.log(assessment.text); process.exit(1); }

// 4: a declarative, read-only mod (announce calls for a screen reader).
const mod = createModSpec({
  title: "Announce volume changes",
  match: { exe: context.exe, format: context.format },
  target: { kind: "export", module: context.name, symbol: "set_volume" },
  action: { kind: "observe", onEnter: "log('volume -> ' + args[0].toInt32())" },
  active: true,
});

const run = await runMods(context, [mod], { onEvent: (k, e) => console.log(k, e) });
if (!run.ok) console.log(run.diagnostics);
// ... later ...
await run.session?.detach(); // reverts every hook, leaves the target as found
```

Status: prototype. The pure modules run under `node --test`; the Frida paths
need `npm install frida` and a real, user-owned target.
