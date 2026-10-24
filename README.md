# ▦ Morse

**Customize any app in one sentence.** Press a hotkey, point at something, say what you want. A local model writes the change and Morse applies it to the running app, live, while you watch.

![Morse adding a sleep timer to a music player](docs/screenshots/clip-sleep-timer.gif)

*Recorded automatically by Morse. The model in this clip is the built-in demo model (see [Status](#status)); everything after generation — streaming, injection, self-repair, recording — is the real pipeline.*

Most software you use every day is a web app or an Electron app: Chromium plus JavaScript. Morse injects a small runtime into those apps, sends what you pointed at and what you said to a local model, and runs the CSS/JS it writes back. It's Tampermonkey/Vencord/Spicetify, except you don't write the script.

```
press ⌥Space ─▶ point ─▶ "add a sleep timer" ─▶ ▦▦▦ local model streams CSS+JS ▦▦▦ ─▶ applied live ─▶ Keep · Share
```

## What works today (v0.1)

| | |
|---|---|
| **Point or describe** | Hover-highlight picker, or skip pointing and describe a page-wide change |
| **The magic moment** | The target dissolves into a contribution-graph grid; the model's tokens rain through it as glyphs; the grid sweeps away to reveal the change |
| **Live CSS** | CSS is applied *while the model is still writing it* (complete rules only) |
| **Self-repair** | If the generated JS throws, Morse shows the model the error and retries once |
| **Persistent mods** | Saved per site (web) or per app (desktop), re-applied on reload and on app restart |
| **Undo / edit** | Every mod is fully reversible (all elements, listeners, timers, observers are tracked) and editable |
| **Share** | Before/after share card (1200×675), auto-recorded GIF + MP4 clip (desktop), share link with the mod in the URL fragment, `.morse.json`, and a `.user.js` that runs in Tampermonkey without Morse |
| **Web** | Chrome extension (MV3). Mod JS runs through `chrome.userScripts`, so it works on strict-CSP sites |
| **Desktop** | `morse launch spotify` relaunches an Electron app with a debugging port and attaches over CDP. No patching of app files: code signatures and ASAR integrity stay intact, updates don't break it |
| **Local models** | Ollama (auto-detected) or any OpenAI-compatible server (llama.cpp, LM Studio, vLLM, or a cloud key if you choose) |
| **God mode** | Direct editing with no model call: hide, move, resize, rename, recolor, retype, duplicate. Page tools (dark/light mode, text size, hide ads, focus mode). Capture an element in one app and rebuild it in another |
| **You stay in control** | An off switch for every mod on a page (⌥⇧0), Pause Morse on a site or everywhere, safe start for mods that crash a page, a plain-language summary before anything shared is installed, and one-file backups |

## Screenshots

All captured by [`demo/shoot-extension.js`](demo/shoot-extension.js) and [`demo/shoot-desktop.js`](demo/shoot-desktop.js) driving the real extension and the real desktop connector.

### Desktop app (CDP connector)

| | |
|---|---|
| ![](docs/screenshots/02-point-at-anything.png) **Point** at anything (⌥Space) | ![](docs/screenshots/03-say-what-you-want.png) **Say** what you want |
| ![](docs/screenshots/04-the-magic-moment.png) **The magic moment**: grid + token glyphs over the target, live code in the bar | ![](docs/screenshots/05-fixes-its-own-bugs.png) **Self-repair**: first attempt threw, the error goes back to the model |
| ![](docs/screenshots/06-done.png) **Done**, with Keep / Undo / Code / Share | ![](docs/screenshots/08-the-new-feature-works.png) **The new feature works** (sleep timer counting down) |
| ![](docs/screenshots/09-css-applies-while-it-writes.png) **Page-wide**: CSS applies while the model writes it | ![](docs/screenshots/10-covers-done.png) Result |
| ![](docs/screenshots/11-mods-panel.png) **Mods panel** (⌥⇧M): toggle, share, edit, delete | ![](docs/screenshots/12-edit-the-code.png) **Edit the code** |
| ![](docs/screenshots/07-share.png) **Share** modal | ![](docs/screenshots/13-still-there-after-restart.png) **Quit and relaunch the app**: mods come back |

![](docs/screenshots/14-share-card.png)
*The generated share card: same crop before and after, the change outlined.*

![](docs/screenshots/00-terminal.png)

### Web (Chrome extension)

| | |
|---|---|
| ![](docs/screenshots/21-web-point.png) Point at a chat composer (the bar dodges your cursor) | ![](docs/screenshots/22-web-working.png) Working |
| ![](docs/screenshots/24-web-word-count-works.png) Live word count, on a site with `script-src 'self'` | ![](docs/screenshots/25-web-new-button.png) "add a button that copies the conversation as markdown" |
| ![](docs/screenshots/26-news-before.png) A cluttered news site | ![](docs/screenshots/27-news-restyling-live.png) Restyling live, mid-stream |
| ![](docs/screenshots/29-news-after.png) After | ![](docs/screenshots/28-news-share.png) Share |
| ![](docs/screenshots/30-share-link.png) A friend opens the share link (code shown before install) | ![](docs/screenshots/32-friend-gets-the-mod.png) …installs it, and gets the mod |
| ![](docs/screenshots/33-userscript-runs-without-morse.png) The `.user.js` export running **without Morse** | ![](docs/screenshots/34-popup.png) Toolbar popup: model settings |
| ![](docs/screenshots/20-extension-installed.png) Installed with "Allow User Scripts" on | |

### Voice, hotkeys and the command bar

Captured by [`demo/shoot-bar.js`](demo/shoot-bar.js) from [`demo/bar-playground.html`](demo/bar-playground.html) (the real runtime, a fake host, Chromium's fake microphone).

| | |
|---|---|
| ![](docs/screenshots/60-voice.png) **Hold ⌥Space to talk**: live transcript, radar-pixel level meter | ![](docs/screenshots/61-settings.png) **Settings** (⌘, in the bar) |
| ![](docs/screenshots/62-hotkey-recorder.png) **Hotkey recorder** refuses ⌘Q, Alt+F4 and friends | ![](docs/screenshots/63-suggestions.png) **Suggestions** for what you pointed at (Tab, ←/→) |
| ![](docs/screenshots/64-shortcuts.png) **`?`** shows the shortcuts you actually have | ![](docs/screenshots/65-cancelled.png) **Esc** stops the model; nothing is left behind |

- **Voice.** Tap the mic, or hold the hotkey (tap opens, hold talks). The Web Speech API is used where it works (Chrome websites); everywhere else (Electron apps) Morse records and the host transcribes with OpenAI `gpt-4o-mini-transcribe` (your key: `OPENAI_API_KEY` or `"voice": { "openaiKey" }` in `~/.morse/config.json`) or a local `whisper-cli` / `whisper` on your PATH. "Send after a pause" is a setting.
- **Hotkeys** for open, push to talk, Mods panel and God mode, recorded from `event.code`. Defaults: ⌥Space (Ctrl+Shift+Space on Windows, where Alt+Space opens the window menu). Settings live in `~/.morse/settings.json` (desktop) or Chrome sync (extension).
- **Command-bar basics:** ↑/↓ prompt history per app, Shift+Enter for a new line, Esc or ⌘. to stop, Tab stays in the bar, focus returns to where you were, and closed means closed: only your hotkeys are ever taken from the page.

### God mode: edit directly, no model

Point at something and an edit toolbar anchors to it. Every key is a tool while it has focus: **H** hide, **M** move (drag or arrow keys, Shift locks the axis / nudges 10px), **R** resize, **T** edit text in place, **C** color (text, fill, border), **F** size and weight, **D** duplicate, **⇧C** capture, **A** ask, or just start typing to describe a change instead. A session's edits become one "Manual edits" mod with undo/redo (⌘Z / ⇧⌘Z), compiled by [`core/edits.js`](core/edits.js) into the same plain CSS/JS a model would write, so it persists, shares and exports like any mod.

| | |
|---|---|
| ![](docs/screenshots/50-godmode-toolbar.png) The toolbar, with shortcuts in every tooltip | ![](docs/screenshots/53-rename.png) **T**: rename the headline in place |
| ![](docs/screenshots/51-move.png) **M**: move a fixed popup out of the way (Shift locks the axis) | ![](docs/screenshots/52-recolor.png) **C**: recolor the masthead |
| ![](docs/screenshots/54-dark-mode.png) Page tools: hide ads, then a smart-invert dark mode that keeps media and already-dark parts as they are | ![](docs/screenshots/55-capture.png) **⇧C**: capture the masthead to the Morse clipboard |
| ![](docs/screenshots/56-reuse.png) In a different app, pick it from the bar: the model rebuilds that look natively | |

### You stay in control

Captured by [`demo/shoot-control.js`](demo/shoot-control.js) driving the real extension.

| | |
|---|---|
| ![](docs/screenshots/95-off-switch.png) **⌥⇧0** (Alt+Shift+0) turns every mod on the page off at once; the toast turns them back on | ![](docs/screenshots/96-install-summary.png) **Before installing** a shared mod: what it does, in plain words, with a note when it sends data elsewhere or reads what you type. The code is folded below |
| ![](docs/screenshots/97-pause-site.png) **Pause Morse on a site** from the Mods panel; every row says where the mod came from and has **Show code** | ![](docs/screenshots/98-popup-pause.png) The same from the toolbar popup, plus **Pause everywhere** |

- **Off switch.** A hotkey like the others (Settings → Shortcuts, default ⌥⇧0 / Alt+Shift+0). It removes every mod's CSS at once, then undoes their code. It stays off in that tab, even across reloads, until you press it again or click Turn back on. Nothing is deleted.
- **Pause.** "Pause Morse on <site>" in the Mods panel and the popup, "Pause everywhere" in the popup (the toolbar icon then says *off*), and in a terminal `morse pause [site|app]` / `morse resume`. Paused mods stay saved; every open tab and window follows at once.
- **Safe start.** If a page closes, crashes or reloads within seconds after a mod ran, three times in a row, Morse holds that mod back on the next load and asks: *Keep it off* or *Turn it back on*. Tracked per tab by the host (`chrome.storage.local`, `~/.morse/control.json`).
- **What a mod does, before you install it.** [`core/summary.js`](core/summary.js) reads the mod's code and lists what it changes and can do: *Changes how the page looks*, *Adds buttons to the page*, *Reads what you type in this page*, *Sends data to another website*, *Remembers settings on this site*, and so on. It errs on the side of mentioning things. The share page, the Import dialog and `morse import` all show it first, with the code below, and install only on an explicit Install. On the web, a page can't install anything by itself: the share page's Install button opens Morse's own review, and only a click there installs.
- **Where it came from.** Each mod in the panel and popup says how it got there (made here with which model, your own edits, installed from a shared link and by whom, restored from a backup), with **Show code** next to it. `morse code <id>` does the same in a terminal.
- **Backups.** *Export all mods* and *Import from file* at the bottom of the Mods panel; `morse export --all [--out file]` and `morse import <file|link>`.

## Status

Honest accounting of what was verified and how:

- **Verified end to end** (in a Linux container, Chromium 153): extension on three sites including a strict-CSP one; desktop connector via `morse launch` → CDP attach → inject → generate → self-repair → save → full app restart → mods re-applied; share link → install in a second browser profile; userscript export running standalone; clip recording to GIF/MP4. `npm test` covers the parser, providers, engine, share links, fuses and the helper kit (18 tests, the kit ones in real Chromium).
- **The model in the screenshots is the demo model.** The container had no access to model weights (ollama.com / Hugging Face were blocked), so generation was replayed from [`core/demo.js`](core/demo.js) at a local-model-like pace. The Ollama and OpenAI-compatible providers are implemented and tested against fake servers speaking those protocols, but have not been run against real weights yet. Expect a 7B coder model to nail CSS and simple DOM features and to miss more often on logic inside minified apps; the self-repair loop and the `morse` helper kit exist to raise that hit rate.
- **No real Electron app was available** in the container. The "desktop app" in the screenshots is a Chromium app window (`--app=`), which speaks exactly the protocol Electron apps expose with `--remote-debugging-port`. Spotify/Slack/Discord/VS Code paths in [`daemon/apps.js`](daemon/apps.js) are untested. Some apps strip or block the debugging switch; `morse fuses <app>` reads the Electron fuse wire (REA's `inspect_electron_fuses` check) to tell you what to expect.

## Install

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm run build                       # builds dist/extension (no dependencies)

# a local model (optional — without one Morse runs in demo mode)
ollama pull qwen2.5-coder:7b
```

**Web:** `chrome://extensions` → Developer mode → Load unpacked → `dist/extension`. Then in Morse's details, turn on **Allow User Scripts** (needed for JS mods on sites with a strict CSP; CSS mods work without it). Press **⌥Space** (Alt+Space) on any page.

**Desktop apps:**

```bash
node daemon/cli.js launch spotify --restart   # or slack, discord, vscode, notion, obsidian, a path…
node daemon/cli.js mods
node daemon/cli.js pause                        # stop every mod everywhere (morse resume to undo)
node daemon/cli.js export --all                 # back up every mod to one file
node daemon/cli.js model --provider openai --base-url http://127.0.0.1:8080 --model qwen2.5-coder
```

Requires Node 22+. For clips, `ffmpeg` on your PATH.

## How it works

```
                 ┌────────────── the app (Chromium renderer) ──────────────┐
                 │  runtime/runtime.js   picker · bar · effect · panel     │
                 │  core/kit.js          `morse` helpers mods run against  │
                 └──────────────▲───────────────────────────▲──────────────┘
         content script + port  │                           │  CDP binding + Runtime.evaluate
                 ┌──────────────┴─────────┐   ┌─────────────┴──────────────┐
                 │ extension/background.js │   │ daemon/connector.js        │
                 │ chrome.userScripts       │   │ morse launch / attach      │
                 └──────────────┬─────────┘   └─────────────┬──────────────┘
                                └────────── core/ ──────────┘
                     engine.js (stream → live CSS → run JS → repair)
                     prompt.js · parse.js · providers.js (Ollama / OpenAI-compatible)
                     mod.js (format, share links, userscript export)
```

- **One runtime, two hosts.** The same `runtime.js` runs in websites (extension) and desktop apps (CDP); only the transport differs.
- **The `morse` kit is the secret sauce for small models.** `morse.watch(selector, fn)` survives React re-renders; `morse.el(...)` creates elements that are tracked for undo; errors inside callbacks are captured and fed back to the model. Short, concrete API → fewer tokens, fewer mistakes.
- **Context, not the whole DOM.** The model gets the picked element's trimmed HTML, a stable selector that avoids hashed class names, its ancestors, a 40-line page outline, and the theme colors. Small prompts keep local models fast.
- **Mods are data.** A mod is a JSON document (prompt, match, CSS, JS). Share links carry it in the URL fragment, so no server ever sees it.

## Where REA fits

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is a read-only investigation toolkit for coding agents: it analyzes Electron/JS bundles statically, reads Electron fuses, observes runtime execution over CDP, and drives Ghidra/Hopper/IDA/Frida for native code. It deliberately never modifies a target and is built for careful evidence, not latency, so it is the wrong tool for Morse's instant loop. Morse borrows its approach where it helps:

- **Now:** the Electron fuse check (`daemon/fuses.js`, a reimplementation of REA's `inspect_electron_fuses`) before relaunching an app.
- **Next:** a one-time "app profile" pass with REA's static JS analysis (modules, IPC channels, routes) and `inspect_web_event_listeners`, cached and fed to the model as context for requests that need the app's *logic*, not just its DOM ("make shuffle actually random").

## Security model

Mods are code running inside apps you're signed into, so:

- The model is told not to use the network, eval, or external scripts, but **that is not enforced yet** (see roadmap). Before a shared mod is installed, Morse says in plain words what its code can do (sending data elsewhere and reading what you type get a clear note) and shows the code; imported mods say where they came from. The summary is pattern matching, not a guarantee, so it errs on the side of mentioning things and flags code that builds code while it runs.
- One key (⌥⇧0) turns every mod on a page off; Morse can be paused per site or everywhere; a mod that keeps crashing a page is held back on the next load.
- Mods run in the renderer only. They get no Node/Electron APIs.
- `morse launch` opens a debugging port on 127.0.0.1. While it's open, **any local process can attach to that app**, which is the same trust level as anything else running as you, but worth knowing. Quit the app normally to close it.
- Share links carry the mod in the URL fragment, which browsers never send to a server.
- Page text goes to the model, so a page can try to prompt-inject it. That's one reason generated code is always shown, reversible, and never silent.

## Roadmap

- **Days:** test against real Ollama models and tune the prompt/kit on real Spotify, Slack, Discord, VS Code, Notion, ChatGPT; tray app with a global hotkey (Tauri) so `morse launch` isn't needed; clip recording in the extension (`tabCapture`).
- **Weeks:** REA-powered app profiles for logic-level changes; mod auto-repair when an app update breaks selectors; a static-site gallery of shared mods; enforce the no-network rule with a CSP/proxy for mod code.
- **Native apps (honest version):** macOS Accessibility / Windows UI Automation can read and drive native UIs and draw overlays *on top*, not add buttons *inside* Finder. That's "overlay + automation" mods, a v3 item.

## Repo layout

```
core/        shared brain: engine, prompt, parser, providers, mod format, helper kit, demo model
runtime/     the in-app UI and effect (one file, injected everywhere)
extension/   Chrome MV3 host
daemon/      desktop connector + CLI (CDP, app launcher, fuses, clip recorder, mod store)
share/       static install page for share links
demo/        demo apps + the scripts that produced every screenshot
```

Regenerate the screenshots: `npm run demo:serve &` then `DISPLAY=:99 npm run screenshots` (needs Xvfb, Chromium/Playwright, ffmpeg; set `MORSE_HOME` to a scratch dir). God mode's are `DISPLAY=:99 node demo/shoot-godmode.js`.

MIT licensed.
