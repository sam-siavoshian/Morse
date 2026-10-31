# Desktop start-up

How long Morse Desktop takes from launch to a window you can use, and what
was changed to make it shorter. Only timing and loading order changed: the
window, the app list, onboarding, the hotkey and the update check work and
look as before.

## Measuring

    node demo/perf.js --only startup --runs 7 --label after

Starts `desktop-app/` with `MORSE_STARTUP_TRACE` (desktop-app/startup-trace.js)
and `MORSE_STARTUP_QUIT=1`, `--runs` times cold and warm, and writes
`docs/perf/startup-<label>.json`. Needs an Electron runtime (the one
`node desktop-app/run.js` finds) and a display; it does not use Playwright.
Without the trace variable no marks are kept and nothing is written.

- **cold**: a new Morse folder and Chromium profile each run (a first launch on
  this computer). The OS file cache is warm: dropping it needs root.
- **warm**: one folder, started once first so its caches exist.

The marks, in milliseconds after the spawn:

| Mark | Where |
|---|---|
| `process` | the Electron main process started (Node's `performance.timeOrigin`) |
| `main:start` | main.js's first import runs (all static imports parsed) |
| `main:loaded` | main.js's imports evaluated |
| `app-ready` | `app.whenReady()` |
| `menu`, `shell-path`, `updater` | steps in `whenReady` before the window |
| `window` | `new BrowserWindow` returned and the page is loading |
| `tray` | the tray icon is up |
| `service` | the daemon modules are loaded and the service exists |
| `ready-to-show` | the window's first paint; it is shown here |
| `page:domContentLoaded`, `page:first-paint`, `page:first-contentful-paint` | the renderer's navigation and paint timing |
| `page:first-render` | ui/app.js rendered state for the first time (`morse:first-render`) |
| `page:apps-listed` | the app list shows apps, or says there are none (`morse:apps-listed`): the window is usable |

## Before

`startup-before.json`, 7 runs, medians, Linux, 2026-10-31:

| ms after spawn | cold | warm |
|---|---|---|
| main:start | 169 | 164 |
| app-ready | 244 | 244 |
| updater (last step before the window) | 252 | 251 |
| window | 402 | 395 |
| service | 453 | 443 |
| page:domContentLoaded | 561 | 543 |
| page:first-render | 570 | 553 |
| ready-to-show | 595 | 572 |
| page:first-contentful-paint | 618 | 575 |
| **page:apps-listed** | **777** | **710** |

Where the time went:

1. **updater → window, ~150 ms.** `createWindow` drew the 256 px window icon
   (mark.js, a pixel loop: 50–67 ms cold) before `new BrowserWindow`.
2. **process → main:start, ~135 ms.** Electron itself, plus parsing main.js's
   whole static import graph before any of it runs. service.js (48 ms in
   Node), runtime/bundle.js (33 ms, only for the overlay window), icons.js
   (31 ms) and native-picker.js (14 ms) were static imports, though none is
   used before the window exists.
3. **first-render → apps-listed, ~200 ms.** The window renders at once
   without apps (`appsPending`), and the app scan follows. Then `changed()` in
   main.js waited its 120 ms debounce before pushing the list, and the scan
   (`discoverApps`, synchronous) ran on every launch before anything was listed.

Already fine and left alone: the window is created with `show: false` and a
matching `backgroundColor` and shown on `ready-to-show`; the shell PATH probe,
the update check (5 s after start), the native picker and the shortcut already
start after the window; app.js is a module script (deferred); images (the
skies) don't block first paint; the packaged app ships an explicit file list
(build.js `APP_FILES`: no demo, docs, tests or devDependencies; the intro
sound is left out) inside an asar.

## What changed

| Change | Files | Expected saving |
|---|---|---|
| The window icon comes from a PNG kept in the profile (`window-icon-<version>.png`); with none yet (a first start), the window is created without it and the icon is drawn and set right after `ready-to-show`. On macOS the same for the Dock icon. | main.js | 50–67 ms before the window, every start |
| mark.js supersamples only pixels on an edge (every shape is convex, so a pixel whose outer samples are all inside one shape, or whose samples miss every shape, is filled directly). Output is byte-identical (checked for 55 size/option pairs). | mark.js | 50 → 32 ms per draw (Node, cold) |
| service.js, icons.js, native-picker.js and runtime/bundle.js are imported when first used, after the window is created. | main.js | 60–100 ms of parsing moved from before `main:start` to behind the loading page |
| V8's compile cache for those modules is kept in the profile (`module.enableCompileCache`). | main.js | ~45 ms on warm starts (Node: 134 → 90 ms for service + daemon + icons + bundle) |
| Pushes to the window skip the 120 ms debounce until the app list has been shown once. | main.js | ~120 ms off apps-listed |
| The last app scan is kept (`~/.morse/app-scan.json`, keyed by platform and version, daemon/store.js). The next launch lists it first and walks the disk again 0.4 s later, then pushes the fresh list. | service.js, daemon/store.js | the scan's time off apps-listed on warm starts (machine-dependent: hundreds of ms on a Mac with many apps) |

## After

**Not measured yet.** The machine these changes were made on can't start
Electron (no display, missing system libraries), so the after numbers need a
run on a desktop:

    node demo/perf.js --only startup --runs 7 --label after

and the table above filled in from `startup-after.json`. Until then, the
expected savings above come from timing each piece in Node.
