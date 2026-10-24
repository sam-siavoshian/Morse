# Soak tests

Long, heavy, realistic use of Morse, measured over time, to find memory
leaks, slowdowns and crashes. The scripts are in [`demo/soak/`](../../demo/soak/);
a short version of each runs with `npm run test:soak`
([`tests/soak/`](../../tests/soak/)), and every leak found here has a quick
regression test in [`tests/soak.test.js`](../../tests/soak.test.js) (part of
`npm test`).

## How to run

```bash
node scripts/build.js
DISPLAY=:99 npm run test:soak      # the short versions, a few minutes; not part of npm test

# The long ones. --out keeps the numbers; report.js turns them into the tables below.
DISPLAY=:99 node demo/soak/extension.js --iterations=600 --minutes=110 --out=ext.json
DISPLAY=:99 node demo/soak/extension.js --iterations=150 --sw-restart-min=2 --sw-restart-mid=5 --out=sw.json
DISPLAY=:99 node demo/soak/desktop.js --iterations=500 --minutes=100 --cycle-every=10 --out=desktop.json
node demo/soak/mods.js --minutes=30 --out=mods.json
node demo/soak/report.js ext.json sw.json desktop.json mods.json
```

Extensions only load in headed Chromium, so the extension runs need a display
(Xvfb). Each script takes `--short` (the CI profile) and its own flags (see
the top of each file): `--sample-every`, `--reload-every`, `--cycle-every`,
`--sites=parley`, `--demo-ms` (the demo model's speed per token, 3 ms by
default; real models stream at about this pace). `SOAK_ONLY=edit,page` runs
only those steps of the loop. `--retainers` (extension) ends with a heap
snapshot and prints, for the detached elements JS still holds, the path from
a GC root ([`retainers.js`](../../demo/soak/retainers.js)): that is how the
leaks below were traced. Profiles and the Morse home are temp folders,
removed when the run ends.

## The scenarios

| Script | What it does |
|---|---|
| [`extension.js`](../../demo/soak/extension.js) | The Chrome extension on three demo sites (Parley, Daily Byte, Tunes), one tab each, with the demo model behind a real Morse helper. Each iteration, on the next tab: open the bar, point, generate, refine, then Save or Undo (alternating); open the Mods panel and turn a mod off and on (and delete the oldest past six, as a person tidying up would); an SPA route change and back; Settings then Help; Show me once (record two clicks, Stop); the Edit tools (recolor, move, undo, undo, redo; hide, then ⌘Z, ⇧⌘Z, ⌘Z); the page tools (dark mode, bigger text, and back); Try it on a gallery mod, then Undo. Parley's document lives the whole run (only SPA navigation), so anything leaked per action piles up there; the other two tabs reload or load again every few visits. |
| same, `--sw-restart-min` / `--sw-restart-mid` | The same loop while the service worker is stopped (CDP `Target.closeTarget` on it) every few minutes wherever the loop is, and on purpose while a change is being made. Pending requests must settle and the next iteration must work. |
| [`desktop.js`](../../demo/soak/desktop.js) | The desktop connector, in a process of its own, attached to a demo "app" (Chromium with `--app`, `--remote-debugging-port`, like `tests/desktop.test.js`). The same loop in a main window (Tunes, never reloaded) and a second one (Daily Byte, reloaded and navigated), plus a popup opened and closed, a window of its own crashed (`Page.crash`) and reloaded, and `morse stop` + attach every 10 iterations. |
| [`mods.js`](../../demo/soak/mods.js) | 50 saved mods on one site, CSS and JS written the way generated mods are (a badge on every message, a click handler on every message, an observer per message, a class and a counter, styles inside each message), while the Parley chat streams a new message every 300 ms, a few words at a time, keeping the last 40. Every 10 s a person opens and closes the bar; every 30 s the Mods panel with its 50 rows. 30 minutes. |

Measured at every sample, after a forced garbage collection:

- the page: JS heap (`Performance.getMetrics`), DOM nodes, JS event
  listeners, listeners on `window` and `document`
  (`DOMDebugger.getEventListeners`), and per JS world (the page's own,
  Morse's runtime, the mod kit) the live MutationObservers and the detached
  elements JS still holds (`Runtime.queryObjects`)
- the service worker: heap, `chrome.storage` bytes, saved mods, when it last
  started
- the daemon: RSS, heap, open CDP sessions, windows, pending CDP calls, the
  hang guard's remembered code, active handles, clips on disk
- every step's time, every iteration's time, console errors and unhandled
  rejections from every world, and the longest run of failing iterations (3
  or more in a row is a wedge)

The machine: 4 cores, 15 GB, shared with other jobs (load average 30 to 90
during these runs). Times are therefore slow and noisy; the counts are not.

## What was found and fixed

Each fix is marked `// soak` in the code.

1. **`morse stop` + attach left a whole Morse behind in every open window**
   (desktop). The old copy went quiet (no UI, no keys) but kept its window
   listeners, its MutationObservers and its intervals, and through them its
   whole UI. Each cycle added one: in the main window, listeners went
   170 → 314 → 460, runtime observers 22 → 62 → 95 and the heap
   6.0 → 9.9 → 12.9 MB over two cycles. The boot split that landed meanwhile
   (`runtime/boot.js`) now has the next boot dispose of the old one's
   listeners; the soak showed that this wasn't enough: the UI's own
   MutationObservers still held it (runtime observers 25 → 101 over three
   cycles), and the document held each old overlay through the bar's
   `aria-owns` (60 detached elements after two cycles). Now the UI's
   observers are tracked while they observe and disconnected when the boot
   disposes of that copy, the old overlay is emptied
   ([`runtime/src/01-rpc.js`](../../runtime/src/01-rpc.js) `letGo`,
   [`runtime/boot.js`](../../runtime/boot.js) `dispose`), and the debug
   status timer of a quiet copy stops. Detached elements stay at 1.
2. **The mod kit kept every element a streaming page had dropped**
   ([`core/kit.js`](../../core/kit.js)). `morse.on(el, …)` kept a clean-up
   holding each element and its handler; an observer made per element stayed
   in the mod's set after its `disconnect()`; `morse.css(text, where)` kept
   a clean-up per matched part. With 50 mods on the streaming chat, in 4
   minutes: page nodes 2,758 → 18,392, listeners 181 → 5,881, live observers
   35 → 5,003, detached elements held 0 → 6,437, until the hang guard saw a
   frozen page and reloaded it. Now those are held weakly (`WeakRef`) and
   pruned, and observers count only while observing; over 30 minutes the
   same run stays level (nodes ~5,400, listeners 1,084, observers ~330).
3. **Running a mod again on an element that stays kept each earlier run's
   elements** (kit). A watch that had run on an element stayed in that
   element's set after its mod stopped, and with it everything its callback
   made. Every refine, Undo, off and on of the word-count mod on Parley's
   composer left its counter behind: detached elements held in Parley's
   three JS worlds grew from 6 to 335 over 120 iterations (Morse's world
   4 → 166, the mods' world 2 → 99, the page's 0 → 70). Stopped mods now
   release their watches, and dead ones are dropped from the element's set:
   4, 0 and 0 after 529 iterations.
4. **Clips on the desktop filled the disk.** Every change made in an app
   left a GIF and an MP4 (or, without ffmpeg, up to 1,800 JPEG frames) in
   `~/.morse/clips`, never removed: 30 MB after 21 iterations, about 1.4 MB
   per change. Only the newest 20 are kept now, and a clip being recorded
   keeps at most 48 MB of frames in memory (1,800 frames of a busy screen was
   a few hundred MB) ([`daemon/record.js`](../../daemon/record.js)).
5. **Recording a clip slowed the bar down 2 to 4 times** (desktop). The
   screencast started when the bar opened and sent every frame to the daemon
   for as long as it stayed open, also while using the Edit tools, the page
   tools, Settings or the Mods panel, which never make a clip. Edit tools
   took 5.9 s (median) with it and 1.5 s without; page tools 4.6 s and 2.5 s.
   Recording now starts when a change starts
   ([`runtime/src/60-generate.js`](../../runtime/src/60-generate.js)); the
   clip still shows the change being made.
6. **A page that started while the extension's worker restarted stayed
   without its mods.** Its first request failed ("Morse restarted") and
   Morse never asked again, so no mods ran and the bar had no model until
   the next reload. It now asks again a few times
   ([`runtime/boot.js`](../../runtime/boot.js) `askAgain`).
7. **The hang guard remembered the code of every change made in a window**
   for as long as the window lived (every draft has its own id). Now at most
   64, and none from an earlier document ([`daemon/guard.js`](../../daemon/guard.js)).
8. **Smaller ones:** the connector kept retry entries for windows that were
   gone; `stop()` left a clip being recorded running; the Mods panel's health
   map kept entries for deleted mods; the "re-renders" map in the page
   context held up to 200 elements the page had already thrown away.
9. **Test builds of the demo Electron app filled the disk.** Every change to
   its sources (and every worktree) left a new ~224 MB copy in
   `~/.cache/morse/tunes` that nothing removed (4.6 GB). Only the few most
   recently used builds stay now
   ([`demo/electron-app/build.mjs`](../../demo/electron-app/build.mjs) `pruneBuilds`).

The service worker itself stayed level in every run (heap about 1.4 to
2 MB, storage about 40 to 50 KB with the mods capped by the loop), and
restarting it never wedged anything: in 150 iterations with 45 restarts (30
of them on purpose while a change was being made), each interrupted change
ended with "Morse restarted. Try again." and the next one worked.

## Seen, not fixed

- **Typing into a text field and clearing it adds two nodes to Chromium's
  count**, in any page (a plain page with a textarea does it too): the
  editing undo history. That is the slow rise in Parley's node count after
  the fixes (about 4 per visit: the request and the follow-up). It isn't
  held by Morse and Chromium caps it.
- **The guard pauses a mod as slow when the machine is overloaded.** Its
  budget is wall-clock time; at a load average of 80, 1 to 3 of the 50 mods
  were paused during the 30-minute run. Never for looping or adding too much.
- **MutationObserver counts in an isolated world, before the fixes, are
  low**: an observer whose wrapper JS no longer references can be collected
  while it still observes. After fix 1 the UI holds its observers, so the
  numbers are exact.
- **Node and listener counts are per renderer process**: on the desktop the
  main window shares one with the second window and the popups, so those two
  rise and fall with whatever the other windows do. The detached-element
  counts are per page and per JS world, and are the ones to trust.
- **Near the end of the 110-minute extension run, the Morse helper stopped
  recognizing the browser** (iterations 525 to 528: "Pair again"). Its home
  folder, a temp folder, was most likely removed from outside while the disk
  was being cleaned; it isn't counted as a wedge.

## Results

Before: the code as it was (commit `e44ab4b`), run with the same scripts.
After: with the fixes. "Per 100 iterations" is the slope over the second
half of the run; a series "grows" when its last third is above its first by
more than the noise allowed for it and is still rising. The bars show each
series over the run.

<!-- tables: node demo/soak/report.js … -->
