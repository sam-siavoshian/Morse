# Handoff: Measure and cut desktop app cold-start time to first usable window

w-1ytgx6h7-startup-e2 stopped (previous replacement failed to start). w-1ytgx6h7-startup-e3 takes over on branch morrow/1ytgx6h7/startup.

Last checkpoint: da62c4357e8c8e00aaa63ad8d799a59377560057.

## Requirements
Goal: make Morse open noticeably faster from launch to an interactive main window, with numbers before and after.

1. Baseline first. Add lightweight timing marks: process start, app 'ready', BrowserWindow created, 'ready-to-show', renderer DOMContentLoaded, and first app list rendered. Use the existing perf tooling where it fits (demo/perf.js, demo/perf-lib.js, docs/perf/budgets.md). Record cold and warm start times in docs/perf/startup.md.

2. Main process (desktop-app/main.js, run.js, service.js, ipc.js, shortcut.js, updater.js, overlay.js, linux.js, shell-path.js, icons.js, native-picker.js, slim.js):
- Defer anything not needed for the first window until after 'ready-to-show' or idle. Examples: the update check (updater.js, daemon/update-check.js), overlay window creation, global shortcut registration if safe, icon generation, shell PATH resolution if it blocks, tray and extra windows.
- Turn top-level requires of heavy modules into lazy requires.
- Create the BrowserWindow as early as possible with show:false and a matching backgroundColor, then show it on 'ready-to-show' so the window appears sooner without a white flash.
- Make sure nothing synchronous (execSync, readFileSync of large files, spawnSync) runs before the window is created.

3. Daemon and service startup (daemon/*.js as used by desktop-app/service.js):
- Make sure the UI does not wait on slow scans (daemon/installed.js, apps.js, native-scan.js, local-runtimes.js, models.js, setup.js, status.js) before first paint.
- Start those scans in parallel, cache the last results in daemon/store.js, and serve cached results immediately, refreshing in the background.
- Lazy-load modules only needed for mods, recording, or CDP until they are used.

4. Renderer first paint (desktop-app/ui/index.html, app.js, app-list.js, formation.js, dither.js, overlay-boot.js, app.css, zephium/*.css, zephium/*.js):
- Do not block first paint on large assets. Defer or lazy-load the sky images (ui/sky/day.webp, zephium/sky-*.avif), the intro sound (ui/sounds/intro.m4a), and decorative effects (dither.js, stage.js, camera.js) until after first render or idle.
- Use defer/async on scripts, avoid render-blocking CSS where possible, and show a skeleton app list while data loads instead of waiting.

5. Packaging (desktop-app/build.js, builder.config.js, package.json): check that the asar is used, devDependencies and demo/docs files are excluded from the bundle, and V8 code cache or snapshot options are on if cheap. Don't change signing or release settings.

6. Verify. Re-run the measurements and record the after numbers in docs/perf/startup.md with what changed and how much each change saved. Run the existing test suite and CI checks and make sure they pass, and confirm onboarding, the app list, the overlay hotkey (Ctrl+Alt+Space), and the update check still work, just later. Don't change behavior or the UI's look. Only change timing and loading order.

Whole task: Incress the speed in app, it should be faster to open

## Files you own
- desktop-app/**
- daemon/**
- docs/perf/**
- demo/perf.js
- demo/perf-lib.js

## Decisions so far (messages from w-1ytgx6h7-startup-e2, newest last)
- None recorded.

## Changed files on the branch
- .morrow/handoff/ws-startup.md
- demo/perf-lib.js
- demo/perf.js
- desktop-app/main.js
- desktop-app/mark.js
- desktop-app/startup-trace.js
- desktop-app/ui/app.js
- docs/perf/startup-before.json
- docs/perf/startup-probe.json

## Outstanding tests
- Make `npm test` pass.

## Last error
- None detected.

## Who is who
People (Relay names): h-sam-siavoshian. h-sam-siavoshian created this task and decides when a person has to.
Workstreams:
- startup: Measure and cut desktop app cold-start time to first usable window (branch morrow/1ytgx6h7/startup, owns desktop-app/**, daemon/**, docs/perf/**, demo/perf.js, demo/perf-lib.js). This is you: w-1ytgx6h7-startup-e3, claude on sam-siavoshian's machine.

## If you stop
Every worker spends a teammate's plan. When a plan hits its usage limit, or a CLI crashes or signs out, Morrow stops that worker, commits and pushes its worktree as a checkpoint, and starts a replacement on another teammate's machine on the same branch. The replacement starts from that checkpoint and a handoff note, so commit working steps often and post decisions in the channel: what is neither committed nor written down is lost. A replacement confirms with ACK <its lease id>.
