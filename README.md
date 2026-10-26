<div align="center">

# Morse: Change Any App

### Reverse engineer any app.

**Add any feature to any app. No limit. A change you keep is code you can read.**

[![Preview build](https://img.shields.io/badge/preview-newest_main-5c4ee5?style=flat-square)](https://github.com/sam-siavoshian/RRAA/releases/tag/preview)
**[Website](https://getmorse.vercel.app/) · [Docs](docs/README.md) · [Showcase](docs/showcase/README.md)**

[Quick start](#quick-start) · [How Morse works](#how-morse-works) · [What you can change](#what-you-can-change) · [App cheats](#app-cheats) · [FAQ](#faq) · [Documentation](#documentation)

<code>curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install-app.sh | sh</code>

<br /><br />

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-paywall.gif" alt="Before: a Foreign Policy article stops on a subscription wall, quarterly, annual, and insider. Adding it: Morse on that wall. After: the article continues. The rest of the story was already on the page." width="1000" />

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

## App cheats

Real apps. Before, adding it, after.

### The subscription wall

Foreign Policy, on the live site. The article stops, and the page puts up a subscription: quarterly, annual, insider. Morse hid that wall. The rest of the story was already on the page.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-paywall.gif" alt="Before: a Foreign Policy article stops on a subscription wall, quarterly, annual, and insider. Adding it: Morse on that wall. After: the article continues. The rest of the story was already on the page." width="900" />

### A timer Obsidian did not ship

Obsidian ships no focus timer. The note was open. Morse added a panel with the reading time and a 25 minute countdown. Start, and it runs.

<img src="https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/readme-obsidian.gif" alt="Before: an Obsidian note, Deep Work, with no timer. Adding it: Morse writing a focus panel and a 25 minute countdown. After: the countdown is running." width="900" />

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
