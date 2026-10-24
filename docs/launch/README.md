# Morse launch kit

**Morse lets you change any website or desktop app in your own words: point at something, say what you want, and it changes while you watch.**

[![The 85-second demo](poster-demo.png)](morse-demo.mp4)

[Watch the demo](morse-demo.mp4) (85 seconds, no sound) · [Website](https://sam-siavoshian.github.io/RRAA/site/) · [Source](https://github.com/sam-siavoshian/RRAA)

## Who it's for

People who use the same apps every day and wish one thing worked a little differently: a button that's missing, an ad that's in the way, text that's too small. You don't need to know how to code. If you do, you can read and edit every line Morse writes.

## Three things it does

1. **Adds what an app is missing.** “Add a sleep timer” to a music player. “Show a word count under the message box” in a chat app. Your model writes the code and Morse adds it to the running app.
2. **Lets you change things by hand.** Point at something and use the edit tools: rename it, move it, hide it, recolor it. No model, no waiting.
3. **Keeps and shares what you made.** Every change is saved as a mod that comes back next time. Share it as a link, a file, or a script that runs in Tampermonkey without Morse.

There are also page tools for the whole page (dark mode, hide ads and pop-ups, focus mode, text size), voice input, and a Mods panel where you turn mods on and off.

## How it works

1. **Press ⌥ Space** (Alt+Space) in a website or a connected desktop app, and point at the part you want to change.
2. **Say or type what you want.** Morse sends what you pointed at and what you said to your model: Claude Code, Codex, or an API key you already have.
3. **Watch it change.** The model writes CSS and JavaScript, Morse applies it live, and you choose Save, Undo, Edit code or Share.

## What's real today, and what isn't yet

Works today:

- **Websites**, through a Chrome extension you load yourself (it isn't in the Chrome Web Store). Mods run on sites with a strict Content-Security-Policy too.
- **Electron desktop apps** (Spotify, Slack, Discord, VS Code and others), with `morse launch <app>`, which restarts the app with a local debugging port. App files are never changed.
- **Claude Code** as the model, tested for real, including everything in this video.
- **Share links, `.morse.json` files and Tampermonkey scripts**, tested by installing a shared mod in a second browser.

Not yet, or not verified:

- **Native apps that aren't Electron** (Finder, most macOS and Windows system apps) are not supported.
- **The desktop connector was tested on a real Electron app we built for it** (Electron 45 on Linux, with a menu bar, a sandboxed preload, a `<webview>` and a second window, also packed as `app.asar` with its fuses locked down), not on real Spotify, Slack or Discord, and not on macOS or Windows. Some apps turn off the debugging switch; `morse fuses <app>` tells you before you try. See [docs/desktop.md](../desktop.md).
- **Codex** is only tested against a fake `codex` command. **The Anthropic and OpenAI APIs** are only tested against fake servers, not the real ones.
- **Mods are not sandboxed.** The model is told not to use the network, but that isn't enforced yet. Read a shared mod before you install it; the install page shows all of its code first.
- **No tray app yet.** On the desktop you start apps through `morse launch`.

## About the recordings

Everything here was recorded from real runs, by [`demo/record-launch.js`](../../demo/record-launch.js):

- The apps are the demo apps in this repo ([`demo/sites/`](../../demo/sites/)): Tunes (a music app), Parley (a chat app) and The Daily Byte (a news site). They stand in for real apps so the recording can be made again.
- The sleep timer and the word count were written by **Claude Code with the `haiku` model**, through the Morse helper and the Chrome extension, with no edits. While the model works, the video plays faster and says so on screen (“Waiting for the model, sped up 7×”). The bar still shows the real time: 12.4 s for the sleep timer, 6.2 s for the word count.
- One sleep-timer run was thrown away: the model asked for the time with a browser `prompt()`, which can't be seen in a screen recording, so the script recorded the scene again. The script does this on its own for any run that fails, adds nothing visible, or opens a browser dialog.
- The renamed headline, the moved pop-up, hiding ads and dark mode use no model at all.
- The cursor is drawn into the page (screen recordings don't include the real one). Its moves and the typing are paced like a person, with small random delays.

To record everything again after a UI change (needs Xvfb, ffmpeg, Playwright, and Claude Code signed in):

```bash
npm run build
DISPLAY=:99 node demo/record-launch.js
```

`REUSE=<work dir>` rebuilds the videos from saved frames without recording; `ONLY=edit,tools` records just those scenes. The script's header lists the rest.

## Files

| File | What it is | Size |
|---|---|---|
| [`morse-demo.mp4`](morse-demo.mp4) | The demo: sleep timer, word count, direct edits, page tools, share. 1280×800, 30 fps, H.264, 85 s | 4.3 MB |
| [`poster-demo.png`](poster-demo.png) | Poster frame for the demo, 1200×675 | 77 KB |
| [`clip-sleep-timer.mp4`](clip-sleep-timer.mp4) | Clip: “add a sleep timer”, 10 s | 0.3 MB |
| [`clip-sleep-timer.gif`](clip-sleep-timer.gif) | The same clip as a GIF, 720 px wide | 0.7 MB |
| [`poster-sleep-timer.png`](poster-sleep-timer.png) | Poster frame, 1200×675 | 73 KB |
| [`clip-page-tools.mp4`](clip-page-tools.mp4) | Clip: hide ads, then dark mode, 10 s | 0.3 MB |
| [`poster-page-tools.png`](poster-page-tools.png) | Poster frame, 1200×675 | 141 KB |
| [`clip-direct-edit.mp4`](clip-direct-edit.mp4) | Clip: rename a headline, move a pop-up, 14 s | 1.3 MB |
| [`poster-direct-edit.png`](poster-direct-edit.png) | Poster frame, 1200×675 | 437 KB |

The clips are 1280×864: the picture, with a one-line caption under it.

## Suggested posts

**Demo video**
> Morse lets you change any website or desktop app by saying what you want. Point at something, describe the change, and your own model (Claude Code, Codex or an API key) writes it while you watch. Open source.

**clip-sleep-timer**
> I pointed at a music player and typed “add a sleep timer”. Claude Code wrote it and Morse added it to the running app.

**clip-page-tools**
> Hide the ads, then turn on dark mode. Two clicks in Morse, and no model involved.

**clip-direct-edit**
> Not every change needs a model. In Morse you can point at a headline and retype it, or drag a pop-up out of the way, and it stays that way next time.
