# ▦ Morse

**Change any app or website in your own words.** Press a shortcut, point at something and say what you want. Morse makes the change right there in the app while you watch. Save it as a mod, turn it off any time, or share it with a link.

![Morse adding a sleep timer to a music player](docs/screenshots/clip-sleep-timer.gif)

*Recorded automatically by Morse. The model in this clip is the built-in demo model (see [Status](#status)). Everything after the model writes the change is real: showing it as it is written, fixing mistakes, saving and recording.*

Most apps you use every day are websites, or desktop apps built from web pages (such as Slack, Spotify, Discord and VS Code). Morse adds a small layer inside those apps. It sends what you pointed at and what you said to a model on your computer, then runs the change the model writes back. It's like Tampermonkey or Vencord, except you don't write the code.

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
| **Share** | A before-and-after image, a short clip (desktop apps), a share link that carries the mod, a mod file, and a version that runs in Tampermonkey without Morse |
| **Websites** | A Chrome extension. With Allow User Scripts on, mods work even on sites with strict security settings |
| **Desktop apps** | `morse launch spotify` reopens the app with Morse connected. Morse never changes the app's files, so app updates don't break it |
| **Your own model** | Ollama (found automatically) or any OpenAI-compatible server (llama.cpp, LM Studio, vLLM, or a cloud key if you choose) |
| **Edit tools** | Change things directly, with no model: hide, move, resize, rename, recolor, change text size, duplicate. Page tools for dark or light mode, text size, hiding ads and focus mode. Capture something in one app and rebuild it in another |

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
- **Shortcuts** to open Morse, push to talk, open the Mods panel and show the edit tools. Change them in Settings. Defaults: ⌥Space (Ctrl+Shift+Space on Windows, where Alt+Space opens the window menu). Settings live in `~/.morse/settings.json` (desktop) or Chrome sync (extension).
- **In the bar:** ↑/↓ for your past requests in this app, Shift+Enter for a new line, Esc or ⌘. to stop. When the bar closes, you are back where you were, and the app gets every key except your Morse shortcuts.

### Edit tools: change things directly, no model

Point at something and the edit tools appear next to it. Press ⌘E (Ctrl+E) to use them from the keyboard: **H** hide, **M** move (drag or use the arrow keys; Shift keeps it straight or moves 10px), **R** resize, **T** edit text in place, **C** color (text, fill, border), **F** text size and weight, **D** duplicate, **⇧C** capture, **A** describe a change instead. Or just start typing to describe a change. Your edits are saved as one "Direct edits" mod with undo and redo (⌘Z / ⇧⌘Z). In the code this is "God mode": the edits are compiled by [`core/edits.js`](core/edits.js) into the same plain CSS/JS a model would write, so it persists, shares and exports like any mod.

| | |
|---|---|
| ![](docs/screenshots/50-godmode-toolbar.png) The edit tools, with the shortcut in every tooltip | ![](docs/screenshots/53-rename.png) **T**: rename the headline in place |
| ![](docs/screenshots/51-move.png) **M**: move a pop-up out of the way | ![](docs/screenshots/52-recolor.png) **C**: recolor the masthead |
| ![](docs/screenshots/54-dark-mode.png) Page tools: hide ads, then dark mode, which leaves photos, videos and already-dark parts as they are | ![](docs/screenshots/55-capture.png) **⇧C**: capture the masthead |
| ![](docs/screenshots/56-reuse.png) In a different app, pick it from the bar and the model rebuilds that look there | |

## Status

Honest accounting of what was verified and how:

- **Verified end to end** (in a Linux container, Chromium 153): extension on three sites including a strict-CSP one; desktop connector via `morse launch` → CDP attach → inject → generate → self-repair → save → full app restart → mods re-applied; share link → install in a second browser profile; userscript export running standalone; clip recording to GIF/MP4. `npm test` covers the parser, providers, engine, share links, fuses and the helper kit (18 tests, the kit ones in real Chromium).
- **The model in the screenshots is the demo model.** The container had no access to model weights (ollama.com / Hugging Face were blocked), so generation was replayed from [`core/demo.js`](core/demo.js) at a local-model-like pace. The Ollama and OpenAI-compatible providers are implemented and tested against fake servers speaking those protocols, but have not been run against real weights yet. Expect a 7B coder model to nail CSS and simple DOM features and to miss more often on logic inside minified apps; the self-repair loop and the `morse` helper kit exist to raise that hit rate.
- **No real Electron app was available** in the container. The "desktop app" in the screenshots is a Chromium app window (`--app=`), which speaks exactly the protocol Electron apps expose with `--remote-debugging-port`. Spotify/Slack/Discord/VS Code paths in [`daemon/apps.js`](daemon/apps.js) are untested. Some apps strip or block the debugging switch; `morse fuses <app>` reads the Electron fuse wire (REA's `inspect_electron_fuses` check) to tell you what to expect.

## Install

You need Node 22 or newer. To record clips of your changes, you also need `ffmpeg`.

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm run build                       # builds the Chrome extension into dist/extension (nothing to download)

# a model on your computer (optional: without one, Morse uses its demo model)
ollama pull qwen2.5-coder:7b
```

**Websites (Chrome):**

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/extension` folder.
3. Open Morse's details and turn on **Allow User Scripts**. Mods that only change the look work without it. Mods that add buttons or features need it on some sites.
4. Open any page and press **⌥Space** (Alt+Space).

**Desktop apps:**

```bash
node daemon/cli.js launch spotify --restart   # or slack, discord, vscode, notion, obsidian, or the app's path
node daemon/cli.js mods                        # list your mods
node daemon/cli.js model --provider openai --base-url http://127.0.0.1:8080 --model qwen2.5-coder   # use a different model
```

`launch` reopens the app with Morse connected. Keep the terminal open while you use it.

## How to use

1. Press **⌥Space** (Alt+Space; Ctrl+Shift+Space on Windows). The Morse bar opens.
2. Point at the thing you want to change and click it. To change the whole page, skip this step.
3. Describe what you want, like "add a sleep timer" or "make this easier to read", and press Enter. Or hold ⌥Space and say it.
4. Watch the change happen. Click **Save** to keep it, or **Undo** to remove it.
5. Press **⌥⇧M** to open the Mods panel. There you can turn mods on and off, share them, edit their code or delete them.

Small changes don't need the model. Point at something and use the edit tools that appear next to it, or click the page tools button in the bar for dark mode, bigger text and more. Press `?` in the bar to see every shortcut.

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
- **No patching.** On the web, mod JS runs through `chrome.userScripts`, so it works on strict-CSP sites. On the desktop, `morse launch` relaunches an Electron app with `--remote-debugging-port` and attaches over CDP; app files, code signatures and ASAR integrity stay intact.
- **Live and reversible.** CSS is applied while the model streams it (complete rules only). Every element, listener, timer and observer a mod creates is tracked, so turning it off removes all of it.
- **The `morse` kit is what makes small models work.** `morse.watch(selector, fn)` survives React re-renders; `morse.el(...)` creates elements that are tracked for undo; errors inside callbacks are captured and fed back to the model. Short, concrete API → fewer tokens, fewer mistakes.
- **Context, not the whole DOM.** The model gets the picked element's trimmed HTML, a stable selector that avoids hashed class names, its ancestors, a 40-line page outline, and the theme colors. Small prompts keep local models fast.
- **Mods are data.** A mod is a JSON document (prompt, match, CSS, JS). Share links carry it in the URL fragment, so no server ever sees it.

## Where REA fits

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is a read-only investigation toolkit for coding agents: it analyzes Electron/JS bundles statically, reads Electron fuses, observes runtime execution over CDP, and drives Ghidra/Hopper/IDA/Frida for native code. It deliberately never modifies a target and is built for careful evidence, not latency, so it is the wrong tool for Morse's instant loop. Morse borrows its approach where it helps:

- **Now:** the Electron fuse check (`daemon/fuses.js`, a reimplementation of REA's `inspect_electron_fuses`) before relaunching an app.
- **Next:** a one-time "app profile" pass with REA's static JS analysis (modules, IPC channels, routes) and `inspect_web_event_listeners`, cached and fed to the model as context for requests that need the app's *logic*, not just its DOM ("make shuffle actually random").

## Security model

Mods are code running inside apps you're signed into, so:

- The model is told not to use the network, eval, or external scripts, but **that is not enforced yet** (see roadmap). Read shared mods before installing; the share page shows the full code first, and imported mods are marked.
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
