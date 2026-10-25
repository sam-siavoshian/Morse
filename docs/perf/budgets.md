# Performance budgets

What the tests hold, with the numbers measured on 2026-10-24 (a heavily
loaded 4-core machine: compare counts, and times only side by side). Full
tables: [report.md](report.md) (`node demo/perf.js`; real sites with
`DISPLAY=:99 node demo/perf.js --label after --only realbar,realboot`,
baseline in `before-real.json`).

| Area | Budget | Held by | Before → after |
|---|---|---|---|
| Boot script on every page | < 52,000 bytes; compile + run < 15 ms | `tests/perf.test.js` | 49,224 (last report) → 51,971 bytes: 29 bytes of headroom. Same code measured side by side today: JS heap +12 to +50 KB per page with one mod (394–421 → 409–451 KB), counts unchanged |
| Boot on real sites, nothing opened | no UI, no layout reads, Morse callbacks < 1 ms | `tests/perf.test.js` (synthetic) | 0 mods: +197–269 KB heap, 0.4–0.7 ms of Morse callbacks; 20 watch mods: +2.3–3.7 MB heap (mostly the page elements the watches touch), 1.4–6.7 ms |
| Bar's solid backing (`50-bar.js` Backing) | typing 39 keys: ≤ 20 hit tests; pointing: 0; bar stepping top/bottom: ≤ 40; 20 scroll ticks: ≤ 40; closed: no callbacks | `tests/perf.test.js` | GitHub file view, typing 48 keys: 560 → 20 hit tests (1,743 → 9 ms); pointing 540 → 20; stepping 260 → 0; scrolling 394 → 81. nodejs.org: typing 155 → 5 (3,286 → 12 ms), longest callback 612 → 13 ms. Closed scrolling: 16–19 timer callbacks → 0 |
| `morse.watch` over a long flat list (`core/kit.js`) | 3,000 rows < 1.5 s, not paused | `tests/kit.test.js` | 1,000 rows: 324–990 ms → 32–65 ms; 2,000+ rows: paused as slow before finishing → 28 ms (2,000), 339 ms (4,000), 555–774 ms (8,000) |
| Languages | English: no word request; others: 1 per page, none on reopening | `tests/perf.test.js` | as budgeted (hotkey to bar on first open: 1,362 ms English, 1,476 ms German, within noise) |
| Warm as you type | 1 host request per pause, not per key; processes: 1 on opening, +1 when the words turn hard | `tests/perf.test.js`, `tests/routing.test.js` | as budgeted |
| Your style, Chrome ↔ helper | ≤ 1 helper check per 5 s of page loads; no storage write when nothing changed | `tests/style.test.js`, `tests/style-share.test.js` | 1 write per check → 0 |
| Your style, desktop `style.json` watch | a stat every 700 ms | — | 3 ms CPU in 20 s; a change is noticed in 0.4 s; own writes are not reported back |
