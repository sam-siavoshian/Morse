# Worked example: add a feature to a stripped native binary

A real, runnable end-to-end demo of the native-DBI path: Morse finds a function
in a **stripped** (closed-source-like) native binary **by signature** — no
symbols — and replaces it to add a feature the binary never shipped, then
reverts cleanly.

The target `ticketd.c` is a long-running CLI that prices tickets with
`compute_total(base, qty)`. The mod adds a 20%-off bulk discount for `qty >= 3`.

## Run it

Needs a C compiler and the optional Frida dependency (`npm install frida`).

```bash
cc -O1 -o native-dbi/example/ticketd native-dbi/example/ticketd.c
strip native-dbi/example/ticketd        # no symbols — the closed-source case
node native-dbi/example/add-feature.mjs
```

Expected output:

```
[sigscan] signature matches in the stripped binary: 1 site

── BEFORE (app as shipped) ──
[ticketd] qty=3 total=$57
[ticketd] qty=4 total=$76
[ticketd] qty=5 total=$95

── AFTER MORSE (new feature: 3+ tickets → 20% off) ──
[ticketd] qty=3 total=$45
[ticketd] qty=4 total=$60
[ticketd] qty=5 total=$76

── AFTER DETACH (hook reverted, app unchanged) ──
[ticketd] qty=3 total=$57
[ticketd] qty=4 total=$76
[ticketd] qty=5 total=$95
```

## What's real here, and what's a stand-in

- **Real:** a genuine native process, stripped of symbols; the function located
  by `sigscan.js` (1 unique match); the hook installed and reverted by the
  actual agent (`agent.js` → in-agent `Memory.scan` + `Interceptor`); the
  declarative `ModSpec` validated by `schema.js`. The behaviour change and the
  clean revert are real.
- **Stand-in:** it's a binary compiled here (a commercial closed-source app
  can't be obtained/run in CI), and it's a headless CLI, so the overlay bar
  isn't in the loop — this exercises the instrumentation core, not the UI.
- **Session note:** the session is opened with Frida `spawn` (launch under
  instrumentation). attach-to-already-running works on a normal machine but
  stalls on some container ptrace configs; the hooking path is identical either
  way. `daemon/native-dbi.js` uses the attach path for `morse launch`.
