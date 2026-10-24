# Testing

```bash
npm ci
npm run check      # build, node --check on every JS file, the runtime bundle, the built extension's files
npm test           # everything that runs headless (Playwright, installed globally, for the browser tests)
npm run test:ui    # the tests that need a display (the built extension), under xvfb-run if there's no $DISPLAY
DISPLAY=:99 npm test   # everything, on a virtual display
```

CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) runs all
three on every push and pull request.

## `npm run check`

[`scripts/check.js`](../../scripts/check.js) builds, then runs cheap checks
that need no extra dependencies, and lists every problem:

1. every JS file parses (`node --check`)
2. the runtime bundle: `runtime/src/*.js` are concatenated into one scope, so
   no two files (or the core modules inlined with them) may declare the same
   top-level name, and the bundle must parse
   ([`scripts/bundle-check.js`](../../scripts/bundle-check.js), also run by
   `tests/bundle.test.js`)
3. every file `extension/manifest.json` and `extension/*.html` point at (and
   the modules those import) exists in `dist/extension` after the build

## `npm test`

`node --test tests/*.test.js`. Unit tests for the parser, every model
provider (a fake `claude` and `codex` on PATH from
[`tests/fake-clis.js`](../../tests/fake-clis.js), fake Anthropic and OpenAI
servers speaking their streaming protocols, the Anthropic one through the
official SDK), the Morse helper (pairing, auth, origins, cancel), the engine,
share links, fuses, voice, the Edit tools, and browser tests of the kit and
the UI in real Chromium.

A few tests read the repo itself:

- `tests/bundle.test.js`: no duplicate top-level names in the runtime.
- `tests/hardening.test.js`: every window listener goes through `listen()`,
  and every key handler checks `isTrusted`.
- `tests/words.test.js`: no developer jargon in what people read (the
  runtime, the extension's pages, the share page, the website, and the user
  pages in `docs/`). See [docs/WRITING.md](../WRITING.md).
- `tests/a11y-morse.test.js`: Morse's own UI with the keyboard alone and a
  screen reader: axe-core (vendored in `demo/vendor/`, test-only) on the key
  states and the extension's pages, the core flows without a mouse, what is
  announced during a generation, forced colors and 320px. `npm run ui` runs
  axe on every catalog state. See [Accessibility](accessibility.md).
- `tests/docs.test.js`: every relative link and image in the README and
  `docs/` exists, every `#anchor` matches a heading, every page is listed in
  [docs/README.md](../README.md), and the README stays short.

Tests that need a display (Chromium extensions only load headed) skip on
`noDisplay`; `npm run test:ui` ([`scripts/test-ui.js`](../../scripts/test-ui.js))
builds and runs just those, on the current display or under `xvfb-run`.

On a busy machine, rerun a failing file alone
(`DISPLAY=:99 node --test tests/<file>.test.js`) to tell a flake from a real
failure. Every test has a 5-minute limit, so a hung test fails instead of
blocking the run.

## Test helpers

Tests are safe to run in parallel, several checkouts at once included: each
test file gets its own `MORSE_HOME` (never your `~/.morse`), every server and
debugging port is picked by the OS, and tests wait on real conditions rather
than sleeping. New tests use [`tests/helpers/`](../../tests/helpers/):

| Helper | What it gives you |
|---|---|
| `home.js` | Import it first: the test process's own `MORSE_HOME`, set before any daemon module reads it, and `tempDir()` for scratch folders (homes, browser profiles, app copies) removed when the process ends, however it ends |
| `disk.js` | Free disk: `npm test` stops at once when the temp folder's disk has under 2 GB free, and each test file warns |
| `net.js` | Ports picked by the OS, never fixed |
| `wait.js` | `waitFor(fn, { what })`: polls until a condition holds, with a generous timeout and a useful error; `waitForStatus`, `waitForReady` and `settle` for the runtime |
| `browser.js` | The globally installed Playwright, skip reasons (`noDisplay`), and launching Chromium with a startup timeout that survives a busy machine |
| `keys.js` | The platform's default hotkeys in Playwright's key syntax, and a reliable tap of Open Morse |
| `demo-server.js` | The demo sites on free ports, routed to their usual addresses in a Playwright context |

`MORSE_TEST_TIMEOUT_SCALE=2` doubles every timeout on a slow machine.

### Temp folders and disk

A test leaves nothing in the temp folder: make every scratch folder, browser
profile and home with `tempDir()`, never `fs.mkdtemp`. They're removed when
the test process exits, also after a failure, a timeout, Ctrl+C or SIGTERM,
and a browser or app still running from one of them is stopped first so it
can't write into it again. Browser profiles and Electron apps are big, and a
full disk makes Chromium crash ("Target crashed") in ways that look like real
failures, so `npm test` checks for 2 GB free before it starts
(`MORSE_TEST_MIN_FREE_GB` changes that; 0 skips it). The packaged Electron
apps of [`tests/electron.test.js`](../../tests/electron.test.js) aren't copied
per run: they're built once into `~/.cache/morse/tunes`, next to the Electron
runtime, and shared. To check a run left nothing behind, give it a temp
folder of its own:

```bash
T=$(mktemp -d) && TMPDIR=$T DISPLAY=:99 npm test; ls -A $T   # empty
```

### The extension with a real Morse helper

The extension looks for the Morse helper on 127.0.0.1:7457. A test that
pairs the real extension with a real helper (`morse serve`, `morse setup
--pair`) gives both its own port, so runs side by side never meet:

```js
import { freePort } from "./helpers/net.js";

const port = await freePort();
// The extension: chrome.storage.local "morse.helperPort", set through its service worker.
await sw.evaluate(p => chrome.storage.local.set({ "morse.helperPort": p }), port);
// The CLI: MORSE_HELPER_PORT.
spawn(process.execPath, [CLI, "serve"], { env: { ...process.env, MORSE_HELPER_PORT: String(port) } });
```

Set it before the extension looks for a helper: the welcome page opens on
install and starts looking at once, so reload it after setting the port
([`tests/first-run.test.js`](../../tests/first-run.test.js) does both). The
setting only takes a whole number from 1024 to 65535 (anything else means
7457) and the host is always 127.0.0.1. Only the service worker and the
extension's own pages can write it: storage.local is closed to content
scripts, and no message sets it
([`tests/security.test.js`](../../tests/security.test.js)).

### The real Electron app

[`tests/electron.test.js`](../../tests/electron.test.js) runs the desktop
flow on a real Electron runtime when one and a display are there, and skips
with a message otherwise:

```bash
npm install --prefix ~/.cache/morse/electron electron
node ~/.cache/morse/electron/node_modules/electron/install.js   # only if dist/ is missing
DISPLAY=:99 node --test tests/electron.test.js
```

Multi-window edge cases (crashes, kill and restart, `--restart`) are tested
against a fake Chromium app ([`demo/fake-app.js`](../../demo/fake-app.js),
[`tests/desktop.test.js`](../../tests/desktop.test.js)).

## Evals

[`evals/`](../../evals/README.md) measures how often Morse does what people
ask: 55 realistic requests on 6 demo apps, sent through the real pipeline
with Claude Code and checked in the page. Run it after changing the prompt,
the context builder or the engine:

```bash
node evals/run.js                  # train split, Claude Code haiku
node evals/run.js --split test     # held-out cases: only for final reports
```

[`evals/show-once.js`](../../evals/show-once.js) checks Show me once the same
way.

## The UI catalog and review

`npm run ui` builds the runtime, drives it through every state of every part
of the UI ([`demo/ui-catalog.js`](../../demo/ui-catalog.js)), saves one
screenshot per state in a dark and a light host, at desktop and phone width,
and on hostile host pages, audits each one, and writes
[`docs/ui/index.html`](../ui/index.html) as a contact sheet. `node
demo/contrast.js` checks every color token pair. The checklist is
[docs/ui/CHECKLIST.md](../ui/CHECKLIST.md); verdicts and notes live in
`docs/ui/review.json`. See
[Adding a feature](adding-a-feature.md#the-ui-review-loop).

## Screenshots

Every screenshot in [`docs/screenshots/`](../screenshots/) is made by a
script in `demo/`, with the real extension or the real desktop connector:

```bash
npm run demo:serve &
DISPLAY=:99 npm run screenshots    # shoot-extension, shoot-desktop, shoot-control
```

They replay pre-written replies ([`core/demo.js`](../../core/demo.js)) so they
come out the same every time. For a real model, run `demo/shoot-desktop.js`
with `MORSE_PROVIDER=claude-code MORSE_MODEL=haiku
SHOTS=docs/screenshots/claude-code`. They need Xvfb, Chromium through
Playwright and ffmpeg; set `MORSE_HOME` to a scratch folder.

Each feature has its own script: `shoot-bar.js` (voice, shortcuts, settings,
from [`demo/bar-playground.html`](../../demo/bar-playground.html)),
`shoot-godmode.js` (Edit tools), `shoot-iterate.js` (follow-ups, History,
Fix it), `shoot-ask.js`, `shoot-control.js`, `shoot-gallery.js`,
`shoot-a11y.js`, `shoot-show-once.js`, `shoot-heal.js`, `shoot-electron.js`,
`shoot-onboarding.js` and `shoot-apps.js` (`morse apps` and `morse status`,
rendered from the macOS fixture tree in
[`demo/fake-installs.js`](../../demo/fake-installs.js)). The launch videos
are made by [`demo/record-launch.js`](../../demo/record-launch.js); see the
[launch kit](../launch/README.md).

Some of the older screenshots (the 00–60s) were taken before the
plain-words pass and still show old labels (“Keep”, “Code”). The script that
made each one retakes it.

## What was verified and how

- **Verified end to end** (in a Linux container, Chromium 153): the
  extension on three sites including a strict-CSP one; the desktop connector
  via `morse launch` → CDP attach → inject → generate → self-repair → save →
  full app restart → mods re-applied; share link → install in a second
  browser profile; userscript export running standalone; clip recording to
  GIF and MP4.
- **The main screenshots replay pre-written replies** from
  [`core/demo.js`](../../core/demo.js), a test fixture. The same desktop flow
  was also run with **real Claude Code** (`claude` on the Claude
  subscription, model `haiku`):
  [`docs/screenshots/claude-code`](../screenshots/claude-code). It built a
  working sleep timer on the first try (no repair round needed) in about
  15 s. Its "bigger album covers" change targeted `img` elements the demo app
  doesn't have, so that one did nothing visible: a small fast model guessing
  at markup. The extension was checked the same way: paired with
  `morse serve`, the popup's Test button, a full generation through the
  helper, and Stop killing the `claude` process mid-run.
- **The demo video** was recorded from real runs: Claude Code (haiku) wrote
  the sleep timer and the word count with no edits
  ([launch kit](../launch/README.md#about-the-recordings)).
- **Codex** isn't installed in the container, so it is only tested against a
  fake `codex` that prints both of its JSON output formats. **The Anthropic
  and OpenAI APIs** are tested against fake servers speaking their streaming
  protocols, not against the real endpoints.
- **A real Electron app** (Electron 45 on Linux):
  [`demo/electron-app`](../../demo/electron-app), a small music app with a
  native menu, a sandboxed preload with context isolation, an `app://` UI, a
  `<webview>` and a second `file://` window, packaged the way apps ship
  (unpacked and as `app.asar`). Verified with real X keyboard and mouse
  input: `morse apps` finds it, `morse launch` → hotkey → point → change
  (test model, and once real Claude Code haiku) → Save → quit with the app's
  Ctrl+Q → `morse launch` again, mod back → Mods panel → second window and
  webview get Morse → `morse status` → `morse stop`; `morse attach --port` to
  a copy running as a normal user with Chromium's sandbox fully on; and the
  same app with its fuses locked down. Details:
  [Desktop apps](../desktop.md#how-this-was-tested).
- **Describe this picture**: checked once with real Claude Code (haiku) on
  the demo site's chart, about 6 s.
- **Show me once**: [`evals/show-once.js`](../../evals/show-once.js) with
  real Claude Code (haiku), 10 of 12 runs for “do this to every unread
  email”, every run for a shortcut.
- **Evals**: 55 cases on 6 demo apps with Claude Code haiku, 3 runs each:
  122/123 on the train split, 41/42 held out
  ([results](../../evals/README.md#results)).
- **macOS and Windows, from Linux only:**
  [`tests/platforms.test.js`](../../tests/platforms.test.js) checks the code
  for both against fake install trees ([`demo/fake-installs.js`](../../demo/fake-installs.js))
  written in the real formats: binary `Info.plist`s (and one made by
  Python's plistlib), `app.asar`, universal Mach-O fuse wires, `.lnk`
  shortcuts (and one made by pylnk3, with only an item list). Fake process
  tables and fake `osascript` / `taskkill` runners cover `--restart`;
  `morse apps` has a snapshot per platform in
  [`tests/snapshots/`](../../tests/snapshots/) (`UPDATE_SNAPSHOTS=1` rewrites
  them); hashing every fixture file before and after shows nothing Morse
  does to find, read or plan a launch changes an app's files.
- **Not tested:** real Slack, Discord, VS Code or Spotify installs; macOS and
  Windows on real hardware (permission prompts, Gatekeeper, real Squirrel
  hand-offs, PowerShell's process list, the firewall, terminal colors);
  Wayland. [Checking a Mac or Windows PC](platform-testing.md) is the
  15-minute check to run there.
