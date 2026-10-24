# ▦ Morse

**Change any app or website in your own words.** Press a shortcut, point at something and say what you want. Morse makes the change right there in the app while you watch. Save it as a mod, turn it off any time, or share it with a link. The change is written by a model you already have: Claude Code, Codex, or an API key.

![Morse adding a sleep timer to a music player](docs/screenshots/clip-sleep-timer.gif)

*Recorded automatically by Morse. To make the clip the same every time, the model's replies in it are replayed from a file (see [Status](#status)). Everything after the reply is real: showing the change as it is written, fixing mistakes, saving and recording. The same steps with real Claude Code replies are in [`docs/screenshots/claude-code`](docs/screenshots/claude-code).*

Most apps you use every day are websites, or desktop apps built from web pages (such as Slack, Spotify, Discord and VS Code). Morse adds a small layer inside those apps. It sends what you pointed at and what you said to your model, then runs the change the model writes back. It's like Tampermonkey or Vencord, except you don't write the code.

```
press ⌥Space ─▶ point ─▶ "add a sleep timer" ─▶ ▦▦▦ the model writes the change ▦▦▦ ─▶ you see it ─▶ Save · Share
```

## What works today (v0.1)

| | |
|---|---|
| **Point or describe** | Point at one thing to change it, or skip pointing and describe a change to the whole page |
| **Watch it happen** | What you pointed at turns into a grid of small squares while the model writes, then the grid sweeps away to show the change |
| **See it as it's written** | Changes to how things look show up while the model is still writing |
| **Fixes its own mistakes** | If the new code fails, Morse shows the model what went wrong and tries once more |
| **Mods stay** | Saved for each site or app, and back every time you open it, even after a restart |
| **Undo and edit** | Every mod can be removed completely, and you can edit its code |
| **Keep improving it** | Ask for a follow-up ("make it smaller") to change the same mod, step back with ⌘Z, bring back any of the last 20 versions, and fix a mod that stopped working with one click |
| **Share** | A before-and-after image, a short clip (desktop apps), a share link that carries the mod, a mod file, and a version that runs in Tampermonkey without Morse |
| **Websites** | A Chrome extension. With Allow User Scripts on, mods work even on sites with strict security settings |
| **Desktop apps** | `morse launch spotify` reopens the app with Morse connected. Morse never changes the app's files, so app updates don't break it |
| **Your model** | Claude Code or Codex (your own subscription, no API key), or an Anthropic or OpenAI API key. See [Models](#models) |
| **Edit tools** | Change things directly, with no model: hide, move, resize, rename, recolor, change text size, duplicate. Page tools for dark or light mode, text size, hiding ads and focus mode. Capture something in one app and rebuild it in another |
| **Ask and find** | Ask about the app instead of changing it. You get a plain answer with numbered markers on what it means. Ask where something is and Morse tells you which menu to open. **Show me** walks you through the steps while you click. **Explain this page** sums up what the screen is for |

## Screenshots

All captured by [`demo/shoot-extension.js`](demo/shoot-extension.js) and [`demo/shoot-desktop.js`](demo/shoot-desktop.js) driving the real extension and the real desktop connector.

### Desktop app (CDP connector)

| | |
|---|---|
| ![](docs/screenshots/02-point-at-anything.png) **Point** at anything (⌥Space) | ![](docs/screenshots/03-say-what-you-want.png) **Say** what you want |
| ![](docs/screenshots/04-the-magic-moment.png) **Watch it happen**: a grid over what you pointed at, the code as it is written in the bar | ![](docs/screenshots/05-fixes-its-own-bugs.png) **Fixes its own mistakes**: the first try failed, so the error goes back to the model |
| ![](docs/screenshots/06-done.png) **Done**: save it, undo it, see the code or share it | ![](docs/screenshots/08-the-new-feature-works.png) **The new feature works** (sleep timer counting down) |
| ![](docs/screenshots/09-css-applies-while-it-writes.png) **Whole page**: the new look shows up while the model writes it | ![](docs/screenshots/10-covers-done.png) Result |
| ![](docs/screenshots/11-mods-panel.png) **Mods panel** (⌥⇧M): turn mods on and off, share, edit, delete | ![](docs/screenshots/12-edit-the-code.png) **Edit the code** |
| ![](docs/screenshots/07-share.png) **Share** | ![](docs/screenshots/13-still-there-after-restart.png) **Quit and relaunch the app**: mods come back |

![](docs/screenshots/14-share-card.png)
*The generated share card: same crop before and after, the change outlined.*

![](docs/screenshots/00-terminal.png)

### Finding and tracking desktop apps

| | |
|---|---|
| ![](docs/screenshots/80-apps.png) **`morse apps`** lists what's installed and whether Morse can connect to it (rendered from the macOS fixture tree in [`demo/fake-installs.js`](demo/fake-installs.js); the container has no Mac) | ![](docs/screenshots/81-status.png) **`morse status`** from real sessions: windows, popups and app frames, mods on in each, and an app started with `--watch` waiting to come back |

- **`morse apps`** looks in `/Applications` and `~/Applications` (reads each `Info.plist`, checks for Electron Framework / Chromium Embedded Framework), on Windows in `%LOCALAPPDATA%\Programs`, Program Files, Roaming and Squirrel `app-<version>` folders, and on Linux on `PATH`, `/usr/share`, `/usr/lib`, `/opt`, snap and flatpak exports. Native apps (ChatGPT for Mac) are listed as "can't connect".
- **`morse launch vs code`** — names are fuzzy: `code`, `vscode`, `spot`, `discrod` all work.
- **Every place an app renders**: all windows, popups opened later, `<webview>`s, BrowserViews, and the app's own out-of-process frames (VS Code webviews). Third-party embeds, workers, DevTools and internal pages are skipped. Reloads, navigation and renderer crashes are followed; a mod saved in one window shows up in every window it matches.
- **Already open?** Morse says so in one sentence and offers `--restart` (AppleScript quit on macOS, WM_CLOSE then taskkill on Windows, SIGTERM on Linux). The choice is remembered per app in `~/.morse/apps.json`; `--no-restart` forgets it.
- **`--watch`** keeps waiting when the app quits and connects again when it's back. **`morse stop <app>`** (or Ctrl+C) disconnects: the bar and mods come off open windows and the app keeps running.

### Web (Chrome extension)

| | |
|---|---|
| ![](docs/screenshots/21-web-point.png) Point at a chat composer (the bar dodges your cursor) | ![](docs/screenshots/22-web-working.png) Working |
| ![](docs/screenshots/24-web-word-count-works.png) Live word count, on a site with `script-src 'self'` | ![](docs/screenshots/25-web-new-button.png) "add a button that copies the conversation as markdown" |
| ![](docs/screenshots/26-news-before.png) A cluttered news site | ![](docs/screenshots/27-news-restyling-live.png) The new look, applied while the model writes |
| ![](docs/screenshots/29-news-after.png) After | ![](docs/screenshots/28-news-share.png) Share |
| ![](docs/screenshots/30-share-link.png) A friend opens the share link (code shown before install) | ![](docs/screenshots/32-friend-gets-the-mod.png) …installs it, and gets the mod |
| ![](docs/screenshots/33-userscript-runs-without-morse.png) The Tampermonkey version running **without Morse** | ![](docs/screenshots/34-popup.png) The toolbar popup: mods on this site and model settings |
| ![](docs/screenshots/20-extension-installed.png) Installed with "Allow User Scripts" on | |

### Voice, shortcuts and the bar

Captured by [`demo/shoot-bar.js`](demo/shoot-bar.js) from [`demo/bar-playground.html`](demo/bar-playground.html) (the real runtime, a fake host, Chromium's fake microphone).

| | |
|---|---|
| ![](docs/screenshots/60-voice.png) **Hold ⌥Space to talk**: your words appear as you speak | ![](docs/screenshots/61-settings.png) **Settings** (⌘, in the bar) |
| ![](docs/screenshots/62-hotkey-recorder.png) **Change a shortcut**: Morse refuses ⌘Q, Alt+F4 and other keys that would cause trouble | ![](docs/screenshots/63-suggestions.png) **Suggestions** for what you pointed at (Tab, ←/→) |
| ![](docs/screenshots/64-shortcuts.png) **`?`** shows the shortcuts you have | ![](docs/screenshots/65-cancelled.png) **Esc** stops Morse. Nothing is left behind |

- **Voice.** Tap the mic, or hold the shortcut (tap opens Morse, hold talks). On websites in Chrome, Chrome turns speech into text. In desktop apps, Morse records you and the Morse helper turns it into text with OpenAI `gpt-4o-mini-transcribe` (your key: `OPENAI_API_KEY` or `"voice": { "openaiKey" }` in `~/.morse/config.json`) or a local `whisper-cli` / `whisper` on your PATH. Turn on "Send after a pause" in Settings to send when you stop talking.
- **Shortcuts** to open Morse, push to talk, open the Mods panel and show the edit tools. Change them in Settings. Defaults: ⌥Space on macOS, Ctrl+Shift+Space on Windows and Linux (where Alt+Space opens the window menu, or KRunner on KDE). The extension's toolbar shortcut is Ctrl+Shift+Y (⌘⇧Y), so it never takes the in-page one. Settings live in `~/.morse/settings.json` (desktop) or Chrome sync (extension).
- **In the bar:** ↑/↓ for your past requests in this app, Shift+Enter for a new line, Esc or ⌘. to stop. When the bar closes, you are back where you were, and the app gets every key except your Morse shortcuts.

### Edit tools: change things directly, no model

Point at something and the edit tools appear next to it. Press ⌘E (Ctrl+E) to use them from the keyboard: **H** hide, **M** move (drag or use the arrow keys; Shift keeps it straight or moves 10px), **R** resize, **T** edit text in place, **C** color (text, fill, border), **F** text size and weight, **D** duplicate, **⇧C** capture, **A** describe a change instead. Or just start typing to describe a change. Your edits are saved as one "Direct edits" mod with undo and redo (⌘Z / ⇧⌘Z). In the code this is "God mode": the edits are compiled by [`core/edits.js`](core/edits.js) into the same plain CSS/JS a model would write, so it persists, shares and exports like any mod.

| | |
|---|---|
| ![](docs/screenshots/50-godmode-toolbar.png) The edit tools, with the shortcut in every tooltip | ![](docs/screenshots/53-rename.png) **T**: rename the headline in place |
| ![](docs/screenshots/51-move.png) **M**: move a pop-up out of the way | ![](docs/screenshots/52-recolor.png) **C**: recolor the masthead |
| ![](docs/screenshots/54-dark-mode.png) Page tools: hide ads, then dark mode, which leaves photos, videos and already-dark parts as they are | ![](docs/screenshots/55-capture.png) **⇧C**: capture the masthead |
| ![](docs/screenshots/56-reuse.png) In a different app, pick it from the bar and the model rebuilds that look there | |

### Keep iterating: refine, history, fix it

A result isn't final. Type a follow-up under it ("make it bigger", "use icons instead") and Enter changes the same mod: the model gets the original request, the code as it is now and your follow-up, and writes the whole thing again. Enter on an empty input saves it, and ⌘Z / Ctrl+Z steps back one version. Every saved mod keeps its last 20 versions ([`core/versions.js`](core/versions.js)); the Mods panel lists them with times, and clicking one brings it back. **Refine** on any saved mod opens the bar on it.

When a saved mod fails as it loads (its code throws, or nothing it looks for has shown up after 5 seconds, from `morse.__stats` in [`core/kit.js`](core/kit.js)), its row says so in plain words and **Fix it** sends the model the error, the page as it is now and the old code. The panel also has search (past six mods), **Copy link**, and keys: ↑/↓ to move, Space to turn a mod on or off, Enter to refine.

Captured by [`demo/shoot-iterate.js`](demo/shoot-iterate.js) with the real desktop connector and the demo model.

| | |
|---|---|
| ![](docs/screenshots/40-refine.png) A follow-up typed under the result: Enter refines, Save keeps it | ![](docs/screenshots/41-history.png) **History**: three versions; click one to bring it back |
| ![](docs/screenshots/42-fix-it.png) The app changed under a saved mod: **Fix it** | |

### Ask and find: understand the app, not just change it

Same hotkey, same bar: ask a question instead of describing a change ("what does this button do?", "why is this greyed out?", "where do I change my password?"). The model decides which it is; a question gets a short, plain answer in the bar and numbered markers on what it's talking about (click a number to scroll there). If the thing is inside a closed menu, the answer says which menu to open: the page outline the model sees now includes menu buttons, tabs, settings links and what's inside closed menus. When the answer is a few clicks on this page, **Show me** walks through them one at a time, marking each step and waiting for *you* to click it. Morse never clicks or types for you. Follow-ups work ("and how do I undo that?"): the page's questions and answers are kept in memory, never saved. **Explain this page** in the page tools gives a five-line summary of what the screen is for. Captured by [`demo/shoot-ask.js`](demo/shoot-ask.js).

| | |
|---|---|
| ![](docs/screenshots/90-ask.png) **Ask** what something does: an answer, and a marker on it | ![](docs/screenshots/91-find.png) **Find** a setting that lives behind a menu |
| ![](docs/screenshots/92-show-me.png) **Show me**: one step at a time, you do the clicking | ![](docs/screenshots/93-explain.png) **Explain this page**, from the page tools |

## Status

Honest accounting of what was verified and how:

- **Verified end to end** (in a Linux container, Chromium 153): extension on three sites including a strict-CSP one; desktop connector via `morse launch` → CDP attach → inject → generate → self-repair → save → full app restart → mods re-applied; share link → install in a second browser profile; userscript export running standalone; clip recording to GIF/MP4. `npm test` covers the parser, every model backend (fake `claude` and `codex` on PATH, a fake Anthropic API), the Morse helper (pairing, auth, origins, cancel), the engine, share links, fuses, voice, God mode and the helper kit (the kit and UI ones in real Chromium).
- **The main screenshots replay pre-written replies** from [`core/demo.js`](core/demo.js), a test fixture, so they come out the same every time. The same desktop flow was also run with **real Claude Code** (`claude` on the Claude subscription, model `haiku`): [`docs/screenshots/claude-code`](docs/screenshots/claude-code). It built a working sleep timer on the first try (no repair round needed) in about 15 s. Its "bigger album covers" change targeted `img` elements the demo app doesn't have, so that one did nothing visible: a small fast model guessing at markup. The extension was checked the same way: paired with `morse serve`, the popup's Test button, a full generation through the helper, and Stop killing the `claude` process mid-run.
- **Codex** isn't installed in the container, so it is only tested against a fake `codex` that prints both of its JSON output formats. **The Anthropic and OpenAI APIs** are tested against fake servers speaking their streaming protocols (the Anthropic one through the official SDK), not against the real endpoints.
- **No real Electron app was available** in the container. The "desktop app" in the screenshots is a Chromium app window (`--app=`), which speaks exactly the protocol Electron apps expose with `--remote-debugging-port`. Multi-window behavior (popups, an isolated app frame, a third-party embed, reloads, crashes, kill and restart, `--restart`, `status`, `stop`) is tested against a fake app built from that Chromium ([`demo/fake-app.js`](demo/fake-app.js), [`tests/desktop.test.js`](tests/desktop.test.js)). App discovery is tested against fixture directory trees for macOS, Windows and Linux, not real installs; AppleScript and taskkill quitting, Windows process listing, and the real Spotify/Slack/Discord/VS Code layouts are untested. `webview` targets only exist in Electron, so they are covered by unit tests only. Some apps strip or block the debugging switch; `morse fuses <app>` reads the Electron fuse wire (REA's `inspect_electron_fuses` check) to tell you what to expect.

## Install

You need Node 22 or newer. To record clips of your changes, you also need `ffmpeg`.

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm install                         # the Anthropic SDK and esbuild
npm run build                       # builds the Chrome extension into dist/extension
node daemon/cli.js doctor           # finds your model and checks that it answers
```

Below, `morse` means `node daemon/cli.js`. Run `npm link` once to type just `morse`.

**Desktop apps:**

```bash
node daemon/cli.js apps                       # what's installed, and whether Morse can connect
node daemon/cli.js launch spotify --restart   # or "vs code", slack, discord, notion, obsidian, a path…
node daemon/cli.js status                     # connected apps, their windows, ports and mods
node daemon/cli.js stop spotify               # disconnect; the app keeps running
node daemon/cli.js mods
```

`launch` reopens the app with Morse connected. Keep the terminal open while you use it.

**Websites (Chrome):**

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/extension` folder.
3. Open Morse's details and turn on **Allow User Scripts**. Mods that only change the look work without it. Mods that add buttons or features need it on some sites.
4. The Morse settings page opens the first time. Connect a model there (see [Models](#models)).
5. Open any page and press **⌥Space** (Ctrl+Shift+Space on Windows and Linux).

## How to use

1. Press **⌥Space** (Ctrl+Shift+Space on Windows and Linux). The Morse bar opens.
2. Point at the thing you want to change and click it. To change the whole page, skip this step.
3. Describe what you want, like "add a sleep timer" or "make this easier to read", and press Enter. Or hold ⌥Space and say it.
4. Watch the change happen. Click **Save** to keep it, or **Undo** to remove it.
5. Press **⌥⇧M** to open the Mods panel. There you can turn mods on and off, share them, edit their code or delete them.

Small changes don't need the model. Point at something and use the edit tools that appear next to it, or click the page tools button in the bar for dark mode, bigger text and more. Press `?` in the bar to see every shortcut.

## Models

Morse doesn't come with a model. It uses one you already have.

| | What you need | How Morse uses it |
|---|---|---|
| **Claude Code** | The `claude` command, signed in with your Claude plan | Runs `claude -p` with every tool turned off, no MCP servers, no saved session, in an empty folder under `~/.morse`. It can only write text back. |
| **Codex** | The `codex` command, signed in | Runs `codex exec` in a read-only sandbox, in an empty folder |
| **Anthropic API** | An API key | Uses `claude-opus-5-5` at low effort unless you choose `claude-sonnet-5-5` or `claude-haiku-5-5`. If Claude declines a request, Morse tells you in plain words. |
| **OpenAI API** | An API key (or any OpenAI-compatible server, with `--base-url`) | Chat completions, streamed |

On a computer, Morse uses the first one it finds, in that order. To choose yourself:

```bash
node daemon/cli.js model                                   # which model Morse will use
node daemon/cli.js config --provider claude-code --model haiku    # opus · sonnet · haiku
node daemon/cli.js config --provider anthropic --anthropic-key sk-ant-…
node daemon/cli.js config --provider openai --openai-key sk-…
node daemon/cli.js config --provider auto                  # let Morse choose again
node daemon/cli.js doctor                                  # what's installed, plus a real test call
```

Keys are saved in `~/.morse/config.json`, which only you can read. Morse also reads `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.

**In Chrome** there are two ways to connect a model. Pick one in the toolbar popup:

- **Morse helper** (for Claude Code, Codex, or keys kept on your computer). Run `node daemon/cli.js serve`. It shows a 6-character code. Type the code into the popup and click Pair. `morse pair` shows a new code, and `morse unpair` signs every browser out. The helper only listens on 127.0.0.1:7457, only answers Chrome extensions (and local tools like curl, which send no Origin), and needs the token it gave out at pairing. When you press Stop or close the tab, the model on your computer stops too.
- **Anthropic API key (nothing to install).** Paste a key in the popup and pick a model. The key stays in this browser's extension storage, and requests go straight from the extension to Anthropic.

The popup's **Test the model** button sends a small real request and shows the reply.

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
                                │  daemon/bridge.js          │  daemon/harness.js
                                │  (morse serve, 127.0.0.1)──┤  claude -p · codex exec
                                └────────── core/ ──────────┘
                     engine.js (stream → live CSS → run JS → repair)
                     prompt.js · parse.js · providers.js (Anthropic SDK / OpenAI / helper)
                     mod.js (format, share links, userscript export)
```

- **One runtime, two hosts.** The same `runtime.js` runs in websites (extension) and desktop apps (CDP); only the transport differs.
- **No patching.** On the web, mod JS runs through `chrome.userScripts`, so it works on strict-CSP sites. On the desktop, `morse launch` relaunches an Electron app with `--remote-debugging-port` and attaches over CDP; app files, code signatures and ASAR integrity stay intact.
- **Live and reversible.** CSS is applied while the model streams it (complete rules only). Every element, listener, timer and observer a mod creates is tracked, so turning it off removes all of it.
- **The `morse` kit keeps mods short and robust.** `morse.watch(selector, fn)` survives React re-renders; `morse.el(...)` creates elements that are tracked for undo; errors inside callbacks are captured and fed back to the model. Short, concrete API → fewer tokens, fewer mistakes.
- **Context, not the whole DOM.** The model gets the picked element's trimmed HTML, a stable selector that avoids hashed class names, its ancestors, a capped page outline (landmarks, controls, menu buttons, tabs, settings links and what sits inside closed menus), and the theme colors. Small prompts keep local models fast.
- **Mods are data.** A mod is a JSON document (prompt, match, CSS, JS). Share links carry it in the URL fragment, so no server ever sees it.

## Where REA fits

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is a read-only investigation toolkit for coding agents: it analyzes Electron/JS bundles statically, reads Electron fuses, observes runtime execution over CDP, and drives Ghidra/Hopper/IDA/Frida for native code. It deliberately never modifies a target and is built for careful evidence, not latency, so it is the wrong tool for Morse's instant loop. Morse borrows its approach where it helps:

- **Now:** the Electron fuse check (`daemon/fuses.js`, a reimplementation of REA's `inspect_electron_fuses`) before relaunching an app.
- **Next:** a one-time "app profile" pass with REA's static JS analysis (modules, IPC channels, routes) and `inspect_web_event_listeners`, cached and fed to the model as context for requests that need the app's *logic*, not just its DOM ("make shuffle actually random").

## Security model

Mods are code running inside apps you're signed into, so:

- The model is told not to use the network, eval, or external scripts, but **that is not enforced yet** (see roadmap). Read shared mods before installing; the share page shows the full code first, and imported mods are marked.
- Mods run in the renderer only. They get no Node/Electron APIs.
- Morse's own UI runs in an isolated JS world (a content script on the web, a CDP isolated world on desktop), so the app's or website's scripts can't reach Morse's host API: your prompt history, the clipboard, other sites' mods, exports or your model. Mod code runs in the page's main world, because it needs the page's own objects. Host requests are answered for the page that asked.
- `morse launch` opens a debugging port on 127.0.0.1. While it's open, **any local process can attach to that app**, which is the same trust level as anything else running as you, but worth knowing. Quit the app normally to close it. Morse picks a free port, drops any `--remote-debugging-address` you pass, checks the port can't be reached from this machine's other addresses, and won't connect if what answers isn't the app it started (process id, then user agent).
- Share links carry the mod in the URL fragment, which browsers never send to a server.
- Page text goes to the model, so a page can try to prompt-inject it. That's one reason generated code is always shown, reversible, and never silent, and why Claude Code and Codex run with no tools, no MCP servers and an empty working folder: the model can only write text.
- The Morse helper (`morse serve`) binds to 127.0.0.1 only, refuses web-page origins and non-loopback Host headers, and serves completions only to a browser that paired with a one-time code. Tokens are stored hashed.

## Roadmap

- **Days:** tune the prompt/kit with Claude Code and Codex on real Spotify, Slack, Discord, VS Code, Notion, ChatGPT; tray app with a global hotkey (Tauri) so `morse launch` isn't needed; clip recording in the extension (`tabCapture`).
- **Weeks:** REA-powered app profiles for logic-level changes; mod auto-repair when an app update breaks selectors; a static-site gallery of shared mods; enforce the no-network rule with a CSP/proxy for mod code.
- **Native apps (honest version):** macOS Accessibility / Windows UI Automation can read and drive native UIs and draw overlays *on top*, not add buttons *inside* Finder. That's "overlay + automation" mods, a v3 item.

## Site

[`site/`](site/) is the public website: static HTML, CSS and ES modules, no build step, so GitHub Pages can serve the repo root as is (`/site/` for the site, `/share/install.html` for share links).

- **`site/index.html`**: the landing page, with an in-browser demo of the pixel effect (simulated, no model runs).
- **`site/gallery.html`**: example mods from [`site/mods/`](site/mods/) (`index.json` lists them; each `*.morse.json` is a normal mod). Search, filter by app, read the code, then **Install in Morse** (a share link built exactly like `encodeShare` in `core/mod.js`), **Download for Tampermonkey** or **Copy link**. The mods were written by hand against each app in October 2026, so a selector may need a refresh.
- **`site/radar.js`**: the radar mark (OpenCode's 4×4 pixel spinner) as a tiny module.
- **`share/install.html`** uses the same styles.

Run it locally with `npm run demo:serve` and open `http://127.0.0.1:8787/site/`. Screenshots (1440×900 and 390×844, dark and light) are in [`docs/site/`](docs/site/).

To add a mod to the gallery, export it (`morse export <id>` writes a `.morse.json`), drop it in `site/mods/`, and add an entry to `site/mods/index.json`.

## Repo layout

```
core/        shared brain: engine, prompt, parser, model providers, mod format, helper kit, demo replay (tests)
runtime/     the in-app UI and effect (src/ bundled into one file, injected everywhere)
extension/   Chrome MV3 host
daemon/      desktop connector + CLI (CDP, app finder/launcher, ports, status, fuses, clip recorder, mod store),
             the Morse helper for the extension, Claude Code / Codex runners
share/       static install page for share links
site/        public website: landing page, mod gallery, example mods
demo/        demo apps + the scripts that produced every screenshot
```

Regenerate the screenshots: `npm run demo:serve &` then `DISPLAY=:99 npm run screenshots` (replayed replies; add `MORSE_PROVIDER=claude-code MORSE_MODEL=haiku SHOTS=docs/screenshots/claude-code` to `demo/shoot-desktop.js` for a real model) (needs Xvfb, Chromium/Playwright, ffmpeg; set `MORSE_HOME` to a scratch dir). God mode's are `DISPLAY=:99 node demo/shoot-godmode.js`; `morse apps` / `morse status` are `node demo/shoot-apps.js`.

MIT licensed.
