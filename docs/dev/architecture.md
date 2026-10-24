# How Morse works

```
                 ┌────────────── the app (Chromium renderer) ──────────────┐
                 │  runtime/runtime.js   picker · bar · effect · panel     │
                 │  core/kit.js          `morse` helpers mods run against  │
                 └──────────────▲───────────────────────────▲──────────────┘
         content script + port  │                           │  CDP binding + Runtime.evaluate
                 ┌──────────────┴──────────┐   ┌────────────┴───────────────┐
                 │ extension/background.js │   │ daemon/connector.js        │
                 │ chrome.userScripts      │   │ morse launch / attach      │
                 └──────────────┬──────────┘   └────────────┬───────────────┘
                                │  daemon/bridge.js          │  daemon/harness.js
                                │  (morse serve, 127.0.0.1)──┤  claude -p · codex exec
                                └────────── core/ ───────────┘
                     engine.js (stream → live CSS → run JS → repair)
                     prompt.js · parse.js · providers.js (Anthropic SDK / OpenAI / helper)
                     mod.js (format, share links, userscript export)
```

- **One runtime, two hosts.** The same runtime runs in websites (extension)
  and desktop apps (CDP); only the transport differs.
- **Free until you use it.** Every page gets only a ~49 KB boot
  (`runtime/boot.js`): it applies your mods (with the guards and safe start),
  follows SPA navigations, checks for broken mods after idle and listens for
  the hotkey, with no overlay, layout reads or timers. The UI is injected the
  first time you open Morse. Measured in [`docs/perf/report.md`](../perf/report.md)
  (`node demo/perf.js`), guarded by `tests/perf.test.js`.
- **No patching.** On the web, mod JS runs through `chrome.userScripts`, so it
  works on strict-CSP sites. On the desktop, `morse launch` relaunches an
  Electron app with `--remote-debugging-pipe` (a private channel, see
  [The private pipe](#the-private-pipe); `--remote-debugging-port` on
  127.0.0.1 where that can't be used) and attaches over CDP; app files, code
  signatures and ASAR integrity stay intact.
- **Live and reversible.** CSS is applied while the model streams it
  (complete rules only). Every element, listener, timer and observer a mod
  creates is tracked, so turning it off removes all of it.
- **The `morse` kit keeps mods short, and keeps them working when the page re-renders.** `morse.watch(selector, fn)`
  survives React re-renders; `morse.el(...)` creates elements that are
  tracked for undo; errors inside callbacks are captured and fed back to the
  model. Short, concrete API → fewer tokens, fewer mistakes.
- **Context, not the whole DOM.** The model gets the picked element's trimmed
  HTML, a stable selector that avoids hashed class names, its ancestors, a
  capped page outline (landmarks, controls, menu buttons, tabs, settings
  links and what sits inside closed menus), and the theme colors. Small
  prompts keep answers fast.
- **Mods are data.** A mod is a JSON document (prompt, match, CSS, JS). Share
  links carry it in the URL fragment, so no server ever sees it.

## Hosts

A host loads the runtime into a page and answers its requests (generate,
run, save, share, settings, history…). Requests are answered for the page
that asked: mods, history and saves are scoped to the calling document's URL
and app, never to what the message claims.

### Chrome extension (`extension/`)

- [`background.js`](../../extension/background.js): the service worker. It
  serves the same requests the desktop connector does, backed by `chrome.*`
  APIs, and runs `core/engine.js` itself (it has to run mod JS in the page and
  retry). Mod JS runs through `chrome.userScripts`, which is exempt from page
  CSP; without “Allow User Scripts”, Morse falls back to the page's main
  world, which strict-CSP sites block. Models: either the Morse helper (see
  below) or an Anthropic API key in `chrome.storage.local`, called straight
  from the worker. `scripts/build.js` bundles it with `core/` and the
  Anthropic SDK.
- [`host.js`](../../extension/host.js): the content-script side, which
  bridges the runtime to the worker and reconnects if Chrome recycles it.
  Requests still waiting when the port closes get an error reply, so the
  runtime's calls settle instead of hanging.
- `popup.*`, `welcome.*`, `practice.html`: the toolbar popup, the welcome page
  and its sandboxed practice page. The `*-host.js` files are hooks, one per
  feature, that add request handlers to the worker.

### Desktop connector (`daemon/`)

- [`connector.js`](../../daemon/connector.js) attaches to every window,
  webview and app frame of a Chromium/Electron app over CDP, keeps up as they
  come, go, reload or crash, injects the runtime, and serves its requests.
  CDP evaluation is exempt from the page's CSP, so mods work in locked-down
  apps too.
- [`apps.js`](../../daemon/apps.js) finds apps: `/Applications` and
  `~/Applications` on macOS (reads each `Info.plist`, XML or binary, without
  `plutil`; checks for Electron Framework, whose own plist has the Electron
  version, or Chromium Embedded Framework; reads `package.json` from
  `Contents/Resources/app.asar`), `%LOCALAPPDATA%\Programs`, Program Files,
  Roaming, Squirrel `app-<version>` folders (newest wins) and Start menu
  `.lnk` shortcuts (`parseLnk`: LinkInfo, the item list, the
  `%VARIABLE%` target block, and `Update.exe --processStart X.exe`) on
  Windows, and `PATH`, `/usr/share`, `/usr/lib`, `/opt`, snap and flatpak
  exports on Linux. Native apps (ChatGPT for Mac) are listed as "can't
  connect". Names are fuzzy: `code`, `vscode`, `spot`, `discrod` all work.
  All disk access goes through `hostContext({ platform, root, home, env })`
  and `ctx.pp` (`path.win32` for Windows), so every platform's discovery runs
  against fixture trees on any machine.
- `launchCommand()` (apps.js) is the launch plan, `{ file, args, env, handoff }`:
  always a program and an argument list, never a shell string. macOS runs
  `Contents/MacOS/<exe>` (not `open -a`, which drops `--args` for a running
  app and hides the pid); Windows runs the newest `app-<version>\X.exe`, or
  `Update.exe --processStart X.exe --process-start-args "<args quoted for
  CommandLineToArgvW>"` when that's all there is. `ELECTRON_RUN_AS_NODE` and
  `NODE_OPTIONS` are removed from the app's environment. A launcher that
  hands off (`handoff`) gets a longer grace in `waitForLaunch`, and
  `desktop.js` then finds the real app by its `--remote-debugging-port`.
  `launchApp(app, PIPE)` starts it on the private pipe instead (`pipeFor()`
  says which apps can be, `connectApp` / `openOnPipe` in `desktop.js` do it).
- [`cdp.js`](../../daemon/cdp.js) is the CDP client, over either transport:
  `portBrowser(port)` (HTTP `/json/list`, a WebSocket per target) or
  `pipeBrowser(conn)` (one `PipeConnection` for every target, flat sessions).
  The connector only sees `listTargets()` and `connect(target)`.
- `desktop.js` runs `launch`, `attach`, `status` and `stop`. An app that is
  already open is quit with AppleScript on macOS (SIGTERM at once if
  `osascript` fails, as when Automation is refused), `taskkill /T` then
  `/T /F` on Windows, SIGTERM on Linux, when you pass `--restart`; the choice
  is kept per app in `~/.morse/apps.json`. Windows processes come from
  PowerShell's `Get-CimInstance Win32_Process` with UTF-8 output.
- [`platform.js`](../../daemon/platform.js) holds `morse doctor`'s platform
  rows (system, the Morse folder's permissions: mode bits on macOS and Linux,
  "inside your user folder" on Windows, where ACLs inherited from the
  profile do that job and Morse doesn't touch them; shortcut; colors;
  Automation, PowerShell, firewall, display, root) and `commandFor()` for
  starting `.cmd` files through cmd.exe with the path quoted.
  [`colors.js`](../../daemon/colors.js): ANSI colors only on a TTY,
  `NO_COLOR` / `FORCE_COLOR` respected; every CLI file takes its colors there. `targets.js` decides which targets get Morse:
  windows, popups opened later, `<webview>`s, BrowserViews and the app's own
  out-of-process frames (VS Code webviews); third-party embeds, workers,
  DevTools and internal pages are skipped.
- `ports.js`, `fuses.js` (the Electron fuse check), `record.js` (clips with
  ffmpeg), `store.js` (mods in `~/.morse/mods`, config, settings),
  `status.js` (sessions for `morse status`), `control.js` (pause, export,
  install, code), `cli.js` (the `morse` command), `setup.js` (`morse setup`).

### The private pipe

A debugging port has no password: while it is open, any local process can
drive the app, including another account's on a shared computer, and one
could take the port before the app binds it (round 9's `/proc` owner check
narrows that on Linux only). Chromium's `--remote-debugging-pipe` has no
port: CDP runs as JSON messages ending in a null byte, which the app reads on
file descriptor 3 and writes on 4. Only the process that started the app
holds the other ends, so Morse uses it whenever it starts the app itself.

**What was tried** (round 10, Linux, Xvfb; [`tests/pipe.test.js`](../../tests/pipe.test.js),
the pipe tests in [`tests/electron.test.js`](../../tests/electron.test.js) and
[`tests/desktop-app-ui.test.js`](../../tests/desktop-app-ui.test.js)):

| App | Electron | Answers on the pipe | When its fd 3 reads an end of file |
|---|---|---|---|
| Tunes (`demo/electron-app`) | 45.0.0 | yes | quits (exit 0) |
| VSCodium 1.140 | 43.7.3 | yes | quits |
| Obsidian 1.14.5 (AppImage, unpacked to run) | 43.8.3 | yes: the AppImage runtime passes fds 3 and 4 on | quits |
| Joplin 3.7.21 (AppImage, unpacked to run) | 42.3.0 | yes | logs the disconnect, still running 20 s later (Joplin handles quitting itself) |
| a minimal app on the stock runtime | 30.5.1, 20.3.12, 12.2.3 | yes | quits |
| the same | 11.5.0, 10.4.7, 10.0.0 | yes | keeps running |
| the same | 9.4.4 | no answer (the switch is ignored) | n/a |

So Electron 10 and later honour the pipe. Each app listed its targets
(`Target.getTargets`), flat sessions attached (`Target.attachToTarget`,
`flatten: true`) and `Runtime.evaluate` ran in the window. Three things came
out of trying it, and shape the code:

- **Electron 12 and later quit when Morse goes.** Chromium logs "Connection
  terminated while reading from pipe" and Electron quits the app, so closing
  Morse (or Morse crashing) would close the person's app. A failed write on
  fd 4 is only logged. So `spawnWithPipe()` gives the app a third descriptor,
  fd 5: a copy of the end Morse writes to. Holding a writer itself, the app
  never reads an end of file, and keeps running when Morse quits or is
  killed (tried with `SIGKILL`). Morse must never `end()` that socket: a
  shutdown reaches the app whoever else holds it.
- **Node's sockets don't block, and the app inherits that.** Node has no
  `socketpair()`, so the pair comes from a Unix socket in a fresh `mkdtemp`
  folder (0700), removed at once. `O_NONBLOCK` is a property of the open
  file, shared with every copy of the descriptor, and Chromium's reader
  thread takes `EAGAIN` for a closed pipe: the connection dropped within a
  second. The app's end is set to block (`setBlocking(true)`) before the
  spawn. fd 4 is a pipe Node makes for the child, which already blocks.
- **An app that relaunches itself** (`app.relaunch()`, as after an update)
  keeps `--remote-debugging-pipe` in its arguments but not the descriptors:
  fds 3 and 4 of the new process were `icudtl.dat` and
  `v8_context_snapshot.bin`. It started and ran normally (reads fail, writes
  to a read-only file fail), but Morse can't reach it. On a port it came back
  on the same port, and `--watch` reattached.

When the pipe is used: Electron apps (`app.engine`) that Morse starts itself,
directly (an AppImage counts: it passes the descriptors on), on Linux and
macOS, with a known Electron version of 10 or later or an unknown one. macOS
uses the same POSIX descriptors but hasn't been tried. Everything else keeps
the port, with round 9's checks: Windows (Node passes descriptors to a child
through the C runtime there, and it hasn't been tried), browsers and CEF
apps, launchers that hand off (Squirrel's `Update.exe`, flatpak, snap, wrapper
scripts, which would drop the descriptors), Electron 9 and older, `--port`,
`MORSE_PIPE=0`, `morse attach`, and an app that is already open with a port.
An app whose version isn't known and that never answers on the pipe within
the launch timeout is quit (it's the copy Morse just started) and opened on
a port (`openOnPipe` returns null).

What changes for people:

- `morse stop`, then `morse launch` again: the app has no port to find, so
  Morse asks to restart it, as for any app open without Morse.
- `--watch`: the app can't come back on its own to a pipe. When it quits,
  Morse waits and says to run `morse launch <app>`; that second command
  writes `~/.morse/sessions/<app>.open` (`status.js requestOpen`), and the
  waiting Morse opens the app on a pipe of its own (`startSession`'s
  `reopen`, `Connector.useBrowser`).
- Morse Desktop keeps the pipe of an app it disconnected from (`held` in
  `service.js`), so Connect works without a restart while Morse Desktop is
  open; quitting Morse Desktop closes every pipe and the apps keep running.
- If Morse is killed, it can't detach: the app's sessions stay attached on
  the pipe, so new documents still get the boot script, which stays idle
  (its binding calls go nowhere) until the app restarts. A clean stop
  detaches every session first (`Target.detachFromTarget`).

What the pipe doesn't do: a process running as the same user can still read
the app's memory or ptrace it, and the app's own child processes inherit fds
3 to 5 (Chromium's helpers don't; processes the app starts through Node's
`child_process` do). Neither is a boundary Morse can draw.

### Morse Desktop (`desktop-app/`)

The app people install instead of the `morse` command ([user page](../desktop-app.md),
[releasing](releasing.md)). Its Electron main process imports the daemon
modules and runs them in place, so there is no separate Node:

- [`service.js`](../../desktop-app/service.js) holds what the window can do,
  with no Electron in it: the app list (`discoverApps`, processes, session
  files), Open with Morse and Connect (`connectApp` + `startSession` from
  `desktop.js`, the same steps as `morse launch`, several sessions in one
  process), the model (`setup.js` `detectBackends`, `saveChoice`,
  `checkModel`), the Morse helper (`createBridge`, `startPairing`, run in the
  background), mods (`store.js`), the off switch (`control.js` pause) and
  `morse doctor`'s rows. Its own settings are `~/.morse/desktop.json`.
- [`ipc.js`](../../desktop-app/ipc.js) is the only door from the window: one
  channel per request, argument checks, and a sender check (the main frame
  of Morse's window, on `morse-app://ui/index.html`). Errors come back as
  `{ error }` in plain words.
- [`preload.cjs`](../../desktop-app/preload.cjs) exposes those requests as
  `window.morse` (frozen; plain values only) and nothing else.
- [`main.js`](../../desktop-app/main.js): the window (context isolation,
  sandbox, no Node, no webviews; it can't navigate or open windows, and asks
  for no permissions), the page served from a `morse-app://` scheme with a
  CSP that allows only its own files, the tray, open at login (Electron on
  macOS and Windows, `~/.config/autostart` on Linux), and `morse://open`
  links (they only show the window).
- The Morse helper runs inside it as `createBridge({ app: "desktop", ask })`
  (one-click pairing, onboarding v2): the extension asks,
  the window shows “Allow Chrome to use your Claude Code?”, and only Allow
  makes a token. The requests are in [Pairing](pairing.md).
- The first run is one screen: the model Morse found by itself (checked
  once) and the apps to open. Opening one, or Skip, leads to the main window.

Sessions Morse Desktop holds are ordinary session files with its own pid, so
`morse status` and `morse stop` work on them, and apps a terminal connected
show as connected in the window.

### The Morse helper (`daemon/bridge.js`)

`morse serve` runs a small HTTP server on 127.0.0.1:7457 so the extension
can use models that need a process on this computer (Claude Code, Codex) or
keys kept there.

```
GET  /v1/health    status (no auth, never includes keys)
POST /v1/pair      { code } -> { token }   one-time code printed by `morse serve` / `morse pair`
POST /v1/complete  { messages, model? }    Bearer token -> NDJSON {type: token|done|error}
GET  /v1/voice, POST /v1/transcribe        Bearer token, see daemon/voice.js
GET  /v1/style     -> { style }            Bearer token: Your style as this computer keeps it
POST /v1/style     { style, was }          Bearer token: Chrome's copy, only if this one is still `was` (409)
```

The helper only streams text, and shares Your style: Chrome keeps its own
copy and syncs it with `~/.morse/style.json` through `/v1/style`
([`core/style-sync.js`](../../core/style-sync.js)), so a style said in
either place shows in both. The desktop watches that file, so a change made
by `morse serve` reaches the windows `morse launch` holds. Closing the connection aborts the generation
and kills the Claude Code or Codex process. `MORSE_HELPER_PORT` moves it off
7457 (tests run several helpers at once); the extension talks to 7457 unless a
test set chrome.storage.local "morse.helperPort" ([testing](testing.md#the-extension-with-a-real-morse-helper)).

## The runtime (`runtime/`)

The runtime comes in two parts. [`runtime/boot.js`](../../runtime/boot.js)
(with `hotkeys.js`, `prefs.js`, `control.js`, the detection half of `heal.js`
and `guard.js` inlined) runs on every page: it applies mods, follows
navigations and catches the hotkey. The UI below is injected the first time
it is needed (host request `ui.load`) and takes over through the handoff
object boot.js leaves on `window[Symbol.for("morse.boot")]`.

[`runtime/bundle.js`](../../runtime/bundle.js) concatenates
`runtime/src/*.js`, sorted by filename, into one IIFE string, after the
design tokens and the pure core modules it shares with the hosts
(`hotkeys.js` and `prefs.js` inlined with `export` dropped; `edits.js`,
`versions.js`, `onboarding.js`, `answer.js`, `summary.js`, `control.js`,
`gallery.js`, `a11y.js`, `showonce.js`, `heal.js`, `style.js` and `guard.js` inlined each
in its own scope). Both the extension build and the desktop connector inject exactly
this string after the boot (`bundleBoot()`, `bundleUI()`). Because it is one scope, two files must never declare the same
top-level name ([Adding a feature](adding-a-feature.md#runtime-rules)).

The files run in order, by number:

| Files | What they do |
|---|---|
| `01-rpc.js` | Talks to the host through `globalThis.__morseHost` (`send`, `onMessage`); `listen()`, which every window listener goes through; the generation counter that makes a detached copy go quiet |
| `02-state.js`, `03-prefs.js`, `05-radar.js`, `10-dom.js` | Shared state, settings, the radar mark, and the closed shadow root all UI lives in, so the app's CSS can't touch it and Morse's can't leak out |
| `20-context.js` | What the model sees: the pointed-at element, a stable selector, the page outline, the styles. It never sends what was typed into fields, hidden fields, secret-looking attributes, email addresses or signed URL queries |
| `30-mods.js` | Running saved mods: CSS, JS through the host, turning them off |
| `40-picker.js` … `47-capture.js` | Pointing, the Edit tools (code name God mode), Page tools, capture |
| `50-bar.js` … `59-onboarding.js` | The bar, voice, Settings, history, suggestions, help, first-run guide |
| `60-generate.js`, `61-ask.js`, `62-markers.js` | A request: generate, show the result, Save/Undo/follow-ups; questions and answers with markers |
| `63-control.js` … `71-heal.js` | Feature hooks: user control, Show me once, guards (`64-guard.js`), Easier to use, Read aloud, Check this page, Describe this picture, the gallery, self-heal |
| `70-panel.js`, `80-modals.js` | The Mods panel, Share and Edit code |
| `90-effect.js` | The pixel effect over what the model is changing |
| `95-keys.js`, `96-shortcuts.js` | Shortcuts and the cheat sheet |
| `97-boot.js` | Boot: says hello to the host, loads settings and mods, starts self-heal |
| `98-*-css.js`, `99-css.js` | Styles, one file per feature plus the shared parts |

Morse's UI runs in an isolated JS world: a content script on the web, a CDP
isolated world named "morse" on the desktop. The app's scripts can't see or
call the host API. Mod code runs in the page's main world, because mods need
the page's own JS objects. On `morse stop`, the host bumps
`globalThis.__morseGen`; the old copy goes quiet (no UI, no hotkeys) and a
later attach can start a fresh one.

## The kit (`core/kit.js`)

The `morse` object mod code runs against, injected as source text into
whichever world runs mods (the page's main world over CDP, the USER_SCRIPT
world in the extension, or a userscript). Every resource a mod creates is
tracked, so turning the mod off fully undoes it.

- `morse.watch(selector, fn)`: calls `fn` for every match, now and later
  (survives re-renders)
- `morse.el(tag, props, ...children)`: creates an element tagged with the
  mod's id
- `morse.css(text)`, `morse.on(target, event, fn)`, `morse.every(ms, fn)`,
  `morse.after(ms, fn)`, `morse.byText(selector, text)`
- `morse.waitFor`, `morse.type`, `morse.choose`, `morse.key`, `morse.sleep`:
  for doing steps (Show me once)
- `morse.store.get/set`: settings kept per mod in the site's localStorage
- `morse.toast(message)`

Callbacks are wrapped: an error (or a rejected promise) is recorded on the
mod, shown in the Mods panel, and fed back to the model on repair.
`wrapModCode(id, js)` wraps a mod's code for running.

## Guards

So a mod can't hurt the page:

- **Before anything runs**, [`core/guard.js`](../../core/guard.js) refuses
  code that would obviously break the page (CSS hiding `html`, `body` or `*`,
  `pointer-events: none` on the page, a `while (true)` with no way out,
  reloading or leaving the page when you didn't ask) and gives the model one
  more try with what was wrong. The runtime checks saved mods' CSS with
  `cssHidesPage()` before applying it.
- **While a mod runs**, [`core/kit.js`](../../core/kit.js) times every
  callback it hands Morse, and the `setTimeout`, `setInterval`,
  `requestAnimationFrame` and `MutationObserver` it uses directly: over
  200 ms of every second for 3 seconds, one burst over a second, more than
  1,000 new matches a second for 3 seconds (a feedback loop through the
  page), an observer called back over 250 times in a second, or more than
  20,000 new elements in a second, and the mod is paused and turned off with
  the reason saved (`mod.paused`). `every()` and `setInterval` run at most
  every 100 ms; changes a mod makes never trigger its own watches or
  observers; only its first few errors reach the console. This costs about
  2 µs per callback and nothing measurable for watches (30 watch mods on a
  streaming chat: same main-thread time as without guards).
  [`runtime/src/64-guard.js`](../../runtime/src/64-guard.js) shows why in
  the Mods panel, with Turn back on and Fix it.
- **Frozen pages.** Code that never returns can't be stopped from inside the
  page. On the desktop, [`daemon/guard.js`](../../daemon/guard.js) pings each
  page that runs mod code once a second; after 4 seconds without an answer (6
  once the mod's code has started), it interrupts the script over CDP
  (`Runtime.terminateExecution`), asks the kit whose code was running, turns
  that mod off and reloads the page. Pages where no mod code ran are never
  interrupted. In the extension only a debugger could interrupt a page, and
  Morse doesn't ask for that permission. There, a saved mod with a loop that
  has no way out never starts, a mod whose code doesn't finish within 4
  seconds of starting is turned off so the next load is clean, and a freeze
  later on is left to Chrome's *Page unresponsive* dialog and safe start.

## The engine (`core/engine.js`)

One request: build the messages ([`prompt.js`](../../core/prompt.js)),
stream the model's answer, parse it as it arrives
([`parse.js`](../../core/parse.js): a `TITLE:` line, a ```` ```css ```` block
and a ```` ```js ```` block), apply complete CSS rules while it streams, run
the JS, and if the JS throws, show the model the error and try once more. With
`probe` from the host (a fingerprint of what the page renders, and which
selectors match nothing), a change that ran but did nothing visible gets the
repair round too. Questions get an answer instead of a mod
([`answer.js`](../../core/answer.js)).

The system prompt is small on purpose, and tells the model not to use the
network, eval or external scripts. The [evals](../../evals/README.md) measure
what changes to the prompt and context do.

## Model providers (`core/providers.js`)

Every provider streams tokens through `onToken` and resolves with the full
text. The file runs unchanged in Node and in the extension's service worker.

| Provider | What it is |
|---|---|
| `claude-code` | The `claude` CLI on the user's subscription ([`daemon/harness.js`](../../daemon/harness.js)): `claude -p` with every tool off, no MCP servers, no saved session, in an empty folder under `~/.morse`. Under Automatic `--model sonnet`, `opus` for new UI, features and restyles |
| `codex` | The `codex` CLI: `codex exec` in a read-only sandbox, in an empty folder. Under Automatic the plan's model at medium effort, high for new UI, features and restyles |
| `anthropic` | An Anthropic API key, through the official SDK, at low effort. Under Automatic `claude-sonnet-5-5` for small tweaks and `claude-opus-5-5` for new UI, features and restyles ([`core/route.js`](../../core/route.js)); one model chosen is used for everything. Refusals become a plain message |
| `openai` | An OpenAI API key, or any OpenAI-compatible server (`--base-url`); chat completions, streamed. Under Automatic `gpt-5`, then `gpt-5` with `reasoning_effort: "high"` |
| `helper` | The extension's client for the Morse helper |
| `demo` | A test fixture that replays canned replies ([`core/demo.js`](../../core/demo.js)); never offered to users |

Auto-detect order on a computer: Claude Code on PATH, Codex on PATH, an
Anthropic key, an OpenAI key ([`daemon/models.js`](../../daemon/models.js)).
Config lives in `~/.morse/config.json` (mode 600); `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY` are read too.

## The mod format (`core/mod.js`)

```json
{
  "morse": 1,
  "id": "k3x9qa1b2c",
  "title": "Sleep timer",
  "prompt": "add a sleep timer",
  "match": { "hosts": ["127.0.0.1:8789"], "app": null },
  "target": { "selector": "[data-testid=player] .controls", "label": "Player controls" },
  "css": "…",
  "js": "…",
  "enabled": true,
  "model": "Claude Code · opus",
  "created": "2026-10-24T10:00:00.000Z",
  "updated": "2026-10-24T10:00:00.000Z"
}
```

Optional fields: `history` and `refined` (the last 20 versions and the
follow-up that made the current one, [`core/versions.js`](../../core/versions.js)),
`kind` and `edits` (Edit tools and Page tools mods, compiled by
[`core/edits.js`](../../core/edits.js)), `from` (where a captured look came
from), `fp` (the self-heal fingerprint, [`core/heal.js`](../../core/heal.js)),
`paused` (why a guard turned it off, [Guards](#guards)),
`imported`, `importedFrom` (`link`, `file`, `backup` or `pack`), `importedAt` and
`gallery`, `author` (where an installed mod came from, shown by `modOrigin()` in
`core/summary.js`), and `pack` (`{ id, name, mod, at, url? }`: the pack it came
from, the mod's id in that pack, and the address it updates from; see
[`core/pack.js`](../../core/pack.js)).

A **pack** (`{ morse: "morse-pack", version: 1, id, name, note, author?, made,
mods }`) is read like a stranger's file: at most 2 MB and 50 mods, broken or
duplicate mods left out, names cleaned to one line of text, no History, on/off,
provenance or Your style. The install review is `runtime/src/69-packs.js`;
`pack.install` re-reads the source and checks the hash the review showed, and
an id that clashes with one of your mods needs an explicit Keep both or
Replace yours. Packs from an address (`core/pack-host.js`) are fetched by the
extension or the helper with the gallery's rules: https only (or loopback),
ETag / Last-Modified, a capped read, at most daily (max-age within a week),
the old copy kept when offline, and updates applied only from the update
review.

`match.hosts` holds the host for web pages, or the file itself for local
files; `match.app` names the desktop app. `modMatches()` decides where a mod
runs.

- **Share links** (`encodeShare`/`decodeShare`) carry the compressed mod in
  the URL fragment of `share/install.html`, so no server sees it.
- **Userscript export** (`toUserscript`) wraps the mod and the kit into a
  Tampermonkey script that runs without Morse.
- **Install review** ([`core/summary.js`](../../core/summary.js)) lists what
  a mod's code does, by pattern matching. It errs on the side of mentioning
  things, and flags code that builds code while it runs (eval, encoded
  strings, `window["..."]`), because then reading the code isn't enough.
- **User control** ([`core/control.js`](../../core/control.js)): pauses
  (per site or app, or everywhere) and safe start (a page that ends within
  6 s after a mod ran is a strike; 3 strikes in a row hold the mod back), in
  `chrome.storage.local` "morse.control" or `~/.morse/control.json`.
- **Self-heal** ([`core/heal.js`](../../core/heal.js),
  [`runtime/src/71-heal.js`](../../runtime/src/71-heal.js)): a saved mod
  records which of its selectors matched and how many elements each found.
  After the page settles on a later visit, a mod is "broken" only when every
  selector that used to match now matches nothing, on the same kind of page,
  at a similar size, twice in a row.

## Security

Mods are code running inside apps you're signed into, so:

- The model is told not to use the network, eval, or external scripts, but
  **that is not enforced yet** (see the [roadmap](README.md#roadmap)). Before
  a shared mod is installed, Morse says in plain words what its code can do
  and shows the code; imported mods say where they came from. The summary is
  pattern matching, not a guarantee.
- One key (⌥⇧0) turns every mod on a page off; Morse can be paused per site
  or everywhere; a mod that keeps crashing a page is held back on the next
  load; a mod that slows down, freezes or hides the page is paused (see
  [Guards](#guards)).
- Mods run in the renderer only. They get no Node or Electron APIs.
- Morse's own UI runs in an isolated JS world (a content script on the web, a
  CDP isolated world on the desktop), so the app's or website's scripts can't
  reach Morse's host API: your prompt history, the clipboard, other sites'
  mods, exports or your model. Host requests are answered for the page that
  asked. Only Morse's share page can ask for an install: a page that loaded
  in `/RRAA/share/` on Morse's site, not any other page on that address
  (every GitHub Pages project of the same owner shares it). Its Install
  button opens Morse's own review; only a click there installs.
- `morse launch` and Morse Desktop open Electron apps on the
  [private pipe](#the-private-pipe) where they can (Electron 10+, started
  directly, Linux and macOS; tried on Linux only): no port, and only Morse
  holds the other ends of the app's descriptors, so other local processes,
  other accounts' included, can't attach through it. Processes running as
  the same user remain out of reach of any such boundary.
- Everywhere else (Windows, browsers, CEF apps, launchers that hand off,
  Electron 9 and older, `--port`, `MORSE_PIPE=0`, `morse attach`, an app
  already open with a port) Morse uses a debugging port on 127.0.0.1. While
  it's open, **any local process can attach to that app**, including one
  another account on the same computer runs: the port has no password. Quit
  the app normally to close it. Morse picks a free port, drops any
  `--remote-debugging-address`, `--remote-debugging-pipe` or
  `--remote-allow-origins` you pass (however it's spelled), checks the
  port can't be reached from this machine's other addresses, won't connect
  if what answers isn't the app it started (process id, then user agent),
  and on Linux won't connect when another account's program holds the port
  (`/proc/net/tcp`, `ports.js portIsMine`), since that program could say
  any process id and user agent. Morse Desktop doesn't count a Morse helper
  another account started as running, for the same reason.
- Share links carry the mod in the URL fragment, which browsers never send to
  a server.
- Page text goes to the model, so a page can try to prompt-inject it. That's
  one reason generated code is always shown, reversible and never silent, and
  why Claude Code and Codex run with no tools, no MCP servers and an empty
  working folder: the model can only write text. The context builder leaves
  out field values, hidden fields, secret-looking attributes, email addresses
  and signed URL queries.
- The Morse helper binds to 127.0.0.1 only, refuses requests with an Origin
  other than `chrome-extension://<id>` (no Origin means curl or the CLI) and
  non-loopback Host headers (DNS rebinding), and serves completions only to a
  browser that paired with a one-time code. Tokens are stored hashed and bound
  to the pairing extension's origin.
- The gallery list is fetched by the extension or the helper, never by the
  page, at most once a day, and not at all with "Show mods others made" off.

The user-facing version of this is [Privacy and safety](../privacy-and-safety.md).
