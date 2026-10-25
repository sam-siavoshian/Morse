<div align="center">

# Morse: Change Any App

### Change any app or website in your own words.

**See something you'd change? Point at it and say how.**

[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)
[![macOS, Windows, Linux](https://img.shields.io/badge/macOS_·_Windows_·_Linux-111113?style=flat-square)](#quick-start)
[![Preview build](https://img.shields.io/badge/preview-newest_main-5c4ee5?style=flat-square)](https://github.com/sam-siavoshian/RRAA/releases/tag/preview)

**[Website](https://sam-siavoshian.github.io/RRAA/site/) · [Docs](docs/README.md) · [Showcase](docs/showcase/README.md)**

[Quick start](#quick-start) · [How Morse works](#how-morse-works) · [What you can change](#what-you-can-change) · [Showcase](#showcase) · [FAQ](#faq) · [Documentation](#documentation)

<code>curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install-app.sh | sh</code>

<br /><br />

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/showcase/vscode-windows-95.jpg" alt="Visual Studio Code before and after one request: a dark editor, then a classic Windows 95 look with gray bevelled panels and a navy title bar. Claude Code (opus) wrote it in 31 seconds, and it was back after quitting and opening the app again." width="1200" />

</div>

---

See something in an app you'd change? Press a shortcut, point at it, and say what you want: "show one cover, not five", "add a sleep timer", "make this sidebar quieter". Morse makes the change while you watch, in the app's own look.

Morse works on desktop apps built on web technology, like VS Code, Slack, Spotify, Obsidian, Notion and Discord, and on websites in Chrome, Edge, Brave, Arc and Vivaldi. It never touches the app's files. Every change you keep comes back each time the app opens.

Morse has no server and no account. It uses the AI you already have: Claude Code, Codex, or an API key.

## Quick start

### Install

**Mac**, in Terminal. There are no security prompts: the line checks Morse against the release's checksums and puts it in Applications.

```bash
curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install-app.sh | sh
```

**Windows:** [Morse-Setup.exe](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-Setup.exe). **Linux:** the same line as the Mac, or [the AppImage](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-linux-x86_64.AppImage). Or download the Mac app: [Apple silicon](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-mac-arm64.dmg) · [Intel](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-mac-x64.dmg).

Morse updates itself after that.

### Open an app

Morse finds your AI and lists your apps. Click **Open with Morse** next to one. In the app, press **⌥Space** on a Mac (**Ctrl+Shift+Space** on Windows and Linux).

### Ask

```text
Show one album cover here, not five.
```

Point at the part you mean, or at nothing for the whole app. Press **Enter**, then **Save** to keep it.

## How Morse works

The Morse app opens your app with one extra setting, so it can connect. When you ask for a change, Morse sends your words, the part you pointed at, and a picture of what you see to your AI. The change shows up while the AI writes it. Morse checks that something really changed and that what it added lines up with the app, and fixes it once if not.

A change you save is a **mod**. Morse puts your mods back every time the app opens, even when you open it from the Dock or the Start menu.

## What you can change

| Where | What works | Notes |
| --- | --- | --- |
| **Desktop apps** | VS Code, Cursor, Slack, Discord, Spotify, Obsidian, Notion, Figma, Linear, Signal, Claude, and other apps built on web technology | [Which apps work, and why some can't](docs/desktop.md) |
| **Websites** | Any site, in Chrome, Edge, Brave, Arc or Vivaldi | Morse opens the browser with a Morse profile of its own; you sign in to your sites there once |
| **Not yet** | Safari, Firefox, and native apps like Finder or Notes | They give Morse no way in |

What you can ask for:

| | |
| --- | --- |
| **Describe a change** | New buttons, panels, shortcuts and looks. Keep improving it, or step back to any of the last 20 versions. [Changing things](docs/changing-things.md) |
| **Voice** | Hold the shortcut and talk. [Changing things](docs/changing-things.md#voice) |
| **Edit tools** | Hide, move, resize or recolor something yourself, with no AI and no waiting. [Edit tools](docs/edit-and-page-tools.md) |
| **Ask and find** | "Where is the export setting?" **Show me** shows where to click. [Ask and find](docs/ask-and-find.md) |
| **Bring a feature** | **Take this** in one app, **Bring here** in another. Morse rebuilds it in that app's look. [Bring a feature](docs/bring-a-feature.md) |
| **Your style** | One font, text size or calmer look on every app and site. [Your style](docs/your-style.md) |
| **Mods** | Turn them on and off, undo, share them with a link, and turn everything off with one shortcut. [Mods](docs/mods.md) · [Your controls](docs/your-controls.md) |

## Showcase

Real apps, real requests, real Claude Code (opus). Each change was saved, the app was quit and opened again, and the change was back.

### Obsidian: an old typewriter

"Make Obsidian look like an old typewriter: cream paper background with a subtle paper texture, a typewriter font like Courier for everything, dark brown ink for the text, and paper-colored side panels with thin ruled lines." 14.7 seconds.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/showcase/obsidian-typewriter.jpg" alt="Obsidian before and after: plain dark notes, then cream paper, a typewriter font, brown ink and ruled side panels" width="900" />

### VS Code: a focus timer

"Add a big Pomodoro focus timer panel in the top right of the editor: a large 25:00 countdown with Start, Pause and Reset buttons, styled like VS Code's own widgets." 28.3 seconds.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/showcase/vscode-focus-timer.jpg" alt="VS Code before and after: a new 25:00 focus timer panel with Start, Pause and Reset buttons, styled like VS Code's own widgets" width="900" />

### Obsidian: a New daily note button

"Add a big New daily note button at the top of the file list, with its label vertically centered and fully visible, that creates a note named with today's date, like 2026-10-24, and opens it." It really makes and opens the day's note. 12.9 seconds.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/showcase/obsidian-daily-note-button.jpg" alt="Obsidian before and after: a new New daily note button at the top of the file list" width="900" />

More, with every request word for word: [the showcase](docs/showcase/README.md). Made something good with Morse? Share it in an [issue](https://github.com/sam-siavoshian/RRAA/issues).

## FAQ

<details>
<summary><strong>Which AI does Morse use?</strong></summary>

The one you have: Claude Code or Codex signed in with your plan, or an Anthropic or OpenAI API key. The Morse app finds it by itself. With Claude Code or an Anthropic key, every change uses Opus: it thinks briefly for small changes and longer for new features. [Models](docs/models.md)

</details>

<details>
<summary><strong>Does Morse change the app's files?</strong></summary>

No. Morse opens the app with one extra setting so it can connect, and adds your changes while it runs. Turn every mod off with one shortcut, or quit Morse, and the app is exactly as it was.

</details>

<details>
<summary><strong>Why does my Mac warn about Morse?</strong></summary>

Morse isn't notarized by Apple yet; that takes a paid Apple Developer ID. A Mac asks about apps a browser downloaded. The Terminal line above installs Morse without that prompt, after checking it against the release's checksums. With the .dmg, open Morse, then System Settings, Privacy & Security, **Open Anyway**.

</details>

<details>
<summary><strong>Why a separate browser window for websites?</strong></summary>

Since Chrome 136, browsers don't let any program control your everyday profile, for good reason. Morse opens your browser with a Morse profile of its own instead. You sign in to your sites there once.

</details>

<details>
<summary><strong>What leaves my computer?</strong></summary>

What you ask, the part you pointed at, and a picture of it, sent to the AI you chose when you press Enter. Nothing else, and there is no Morse server. Your mods stay on your computer. [Privacy and safety](docs/privacy-and-safety.md)

</details>

<details>
<summary><strong>A change didn't work. What now?</strong></summary>

Point at the exact part you mean and say it another way. Morse already checks whether a change did anything and tries again once; if nothing changed, it says so instead of saying it's done. Still stuck? See [Troubleshooting](docs/troubleshooting.md), or [open an issue](https://github.com/sam-siavoshian/RRAA/issues) with the app, what you asked, and what happened.

</details>

## Documentation

- [Getting started](docs/getting-started.md): install, the first change, and every way in.
- [The Morse app](docs/desktop-app.md): your apps, Always open with Morse, and updates.
- [Desktop apps](docs/desktop.md): which apps work, and why some can't.
- [Models](docs/models.md): Claude Code, Codex, API keys, and how Morse picks.
- [Mods](docs/mods.md) and [Your controls](docs/your-controls.md): on, off, undo, share, and safe start.
- [For developers](docs/dev/README.md): the `morse` command, and building and testing Morse.

## Contributing

Bugs and ideas: [open an issue](https://github.com/sam-siavoshian/RRAA/issues). Code and docs: [send a pull request](https://github.com/sam-siavoshian/RRAA/pulls). [CONTRIBUTING.md](CONTRIBUTING.md) has the setup and checks, and [How Morse works](docs/dev/architecture.md) maps the code.

## License

[MIT](LICENSE). The first run's dots and sound come from [Zephium](https://github.com/zephium-browser/zephium), under the Mozilla Public License 2.0 ([notice](desktop-app/ui/sounds/NOTICE.md)).
