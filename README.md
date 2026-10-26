<div align="center">

# Morse: Change Any App

### Reverse engineer any app.

**Add any feature to any app. No limit. A change you keep is code you can read.**

[![Preview build](https://img.shields.io/badge/preview-newest_main-5c4ee5?style=flat-square)](https://github.com/sam-siavoshian/RRAA/releases/tag/preview)
**[Website](https://getmorse.vercel.app/) · [Docs](docs/README.md) · [Showcase](docs/showcase/README.md)**

[Quick start](#quick-start) · [How Morse works](#how-morse-works) · [What you can change](#what-you-can-change) · [Real runs](#real-runs) · [FAQ](#faq) · [Documentation](#documentation)

<code>curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install-app.sh | sh</code>

<br /><br />

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-obsidian-timer.gif" alt="Obsidian had no focus timer. Morse adds a panel with the note's reading time and a 25 minute timer, and Start counts down." width="1000" />

</div>

---

Take a feature in one app and bring it into another. Delete a paywall that is a box on a page that already loaded. Inject your own code. Add a feature the app never shipped. Morse never changes the app's files. Save it, and it is back the next time the app opens.

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

Point at the part you mean, or at nothing for the whole app. Press **Enter**, then **Save**.

## How Morse works

The Morse app opens your app with one extra setting, so it can connect. When you ask for a change, Morse sends your words, the part you pointed at, and a picture of what you see to your AI. The change shows up while the AI writes it.

A change you save is a **mod**. Morse puts your mods back every time the app opens, even when you open it from the Dock or the Start menu.

## What you can change

| Where | What works | Notes |
| --- | --- | --- |
| **Desktop apps** | VS Code, Cursor, Slack, Discord, Spotify, Obsidian, Notion, Figma, Linear, Signal, Claude, and other apps built on web technology | [Which apps work, and why some can't](docs/desktop.md) |
| **Websites** | Any site, in Chrome, Edge, Brave, Arc or Vivaldi | Morse opens the browser for you, still signed in to everything |
| **Not yet** | Safari, Firefox, and native apps like Finder or Notes | They give Morse no way in |

| | |
| --- | --- |
| **Bring a feature** | **Take this** in the app that has it. **Bring here** in the one that does not. [Bring a feature](docs/bring-a-feature.md) |
| **Inject code** | Read the style and the script, and change them. [Mods](docs/mods.md) |
| **Your own feature** | A button, a shortcut, a panel. It stays when the app opens again. [Changing things](docs/changing-things.md) |
| **A paywall** | Point at the box on a page that already loaded. Morse does not sign you in, and it does not fetch a story the site never sent. |

## Real runs

What happened, then the recording.

### The subscription wall came off

A subscription wall covered the rest of the story. Subscribers only. $5 a month. Subscribe to keep reading. Morse hid the wall. The rest of the story was already on the page.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-paywall.gif" alt="A story with a subscription wall, Subscribers only, 5 dollars a month, Subscribe to keep reading. Morse hides the wall and the rest of the story is there." width="900" />

### Copy as Markdown, on every code sample

The Node.js docs put a Copy button on each code sample. Morse added Copy as Markdown beside it. That button copies the sample as Markdown.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-copy-markdown.gif" alt="A Node.js docs code sample. It has a Copy button, then a Copy as Markdown button appears beside it." width="900" />

### A feature the app did not ship

Obsidian has no focus timer. Morse added a panel with this note's reading time and a 25 minute timer. Start, and it counts down.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-obsidian-timer.gif" alt="Obsidian with a new focus panel: reading time, a 25 minute timer, and the timer counting down after Start." width="900" />

### VS Code's command palette, on RubyGems

The command palette was taken from VS Code and brought to rubygems.org. Ctrl+Shift+P searches that page, and a Commands button sits in the header.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-bring-palette.gif" alt="rubygems.org for Rails, then VS Code's command palette open on that page, with a Commands button in the header." width="900" />

### A presentation shortcut VS Code did not have

In Visual Studio Code, Ctrl+Alt+P hides the sidebar and the activity bar and doubles the code, so a room can read it. Press it again and the editor is back. The app was quit and opened again. The shortcut was still there.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-vscode-present.gif" alt="Visual Studio Code, then the same window in presentation mode: sidebar gone, code twice as big, Ctrl+Alt+P to exit." width="900" />

More runs: [Bring a feature](docs/bring-a-feature.md) and [the showcase](docs/showcase/README.md).

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
<summary><strong>Do I have to sign in to my sites again?</strong></summary>

No. Since Chrome 136, browsers don't let any program control your everyday profile, for good reason, so Morse opens your browser on a copy of it in Morse's folder. The first time, the copy takes everything: sign-ins, saved passwords, tabs, extensions, bookmarks (on a Mac it's a clone, instant and free of extra space). Every time after, sign-ins you made in your everyday browser since are brought in too. Morse only reads your everyday profile; it never writes to it. [How it works](daemon/browser-profile.js)

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
