<div align="center">

# Morse: Change Any App

### Your apps have cheat codes. You write them.

**Reverse engineer closed apps. Rip out the parts you hate. Build the features they won’t give you.**

[![Preview build](https://img.shields.io/badge/preview-newest_main-5c4ee5?style=flat-square)](https://github.com/sam-siavoshian/Morse/releases/tag/preview)
**[Website](https://getmorse.vercel.app/) · [Docs](docs/README.md) · [Showcase](docs/showcase/README.md)**

[Quick start](#quick-start) · [How Morse works](#how-morse-works) · [What you can change](#what-you-can-change) · [Real runs](#real-runs) · [FAQ](#faq) · [Documentation](#documentation)

[Download Morse](https://github.com/sam-siavoshian/Morse/releases/tag/preview)

<br /><br />

<img src="https://raw.githubusercontent.com/sam-siavoshian/Morse/main/docs/launch/readme-hero.webp" alt="Change any app. Add anything. Delete anything. Closed source doesn't stop you anymore. Free for Mac, Windows and Linux, on a blue sky with clouds." width="1200" />

</div>

---

The company shipped its version. You don’t have to keep it. Morse inspects the running app and writes code to change it. Delete the feed. Build the missing export. Take a feature from another app and make it work here. Save your version as a mod you can read, edit and turn off.

Morse has no server and no account. It uses the AI you already have: Claude Code, Codex, or an API key.

## Hack your version

These are **example requests to try**, not claims of recorded results. The real recording is under [Real runs](#real-runs).

| The app | Tell Morse |
| --- | --- |
| **YouTube** | “Rip out Shorts and recommendations. Make the home page subscriptions-only.” |
| **Spotify** | “Give me my data. Add a CSV export for the playlist tracks already loaded: names, artists and albums.” |
| **Gmail** | “Give this inbox VS Code’s command palette. Search the actions on this page and run them from the keyboard.” |
| **GitLab** | “Add an approval tripwire. Flag changes made to this merge request after the last approval.” |
| **An article behind an overlay** | “Delete the paywall overlay and signup popup. Let me scroll.” The article must already be loaded. |

The point is control over the app on your computer. Morse can change the interface and behavior it can reach; it doesn’t unlock a service’s private backend or turn paid access into free access.

## Quick start

### Install

**Mac:** [Apple silicon](https://github.com/sam-siavoshian/Morse/releases/download/preview/Morse-mac-arm64.dmg) · [Intel](https://github.com/sam-siavoshian/Morse/releases/download/preview/Morse-mac-x64.dmg). Open the disk image and drag Morse to Applications.

**Windows:** [Morse-Setup.exe](https://github.com/sam-siavoshian/Morse/releases/download/preview/Morse-Setup.exe). **Linux:** [the AppImage](https://github.com/sam-siavoshian/Morse/releases/download/preview/Morse-linux-x86_64.AppImage).

Morse updates itself after that. [First-time setup](docs/desktop-app.md#get-it).

### Open an app

Morse finds your AI and lists your apps. Click **Open with Morse** next to one. In the app, press **Ctrl+Alt+Space** (shown as **⌃⌥Space** on a Mac).

Point at the part you mean, or target the whole app. Tell Morse what to rip out or build in. Press **Enter**, watch the change, then **Save** to keep your version.

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

Actual recordings from installed apps and live sites. The requests above are ideas; this section shows what ran.

### A timer Obsidian did not ship

Obsidian ships no focus timer. The note was open with none. Morse is open at the bottom with the ask: a panel with this note's reading time and a 25 minute countdown. The panel was not there. Then it is.

<img src="https://raw.githubusercontent.com/sam-siavoshian/Morse/main/docs/launch/readme-obsidian-ask.gif" alt="The Obsidian note has no focus timer. Morse is open at the bottom with the ask for a focus panel. The panel was not on the note, then it appears on the right." width="1000" />

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

Morse isn't notarized by Apple yet; that takes a paid Apple Developer ID. After installing the .dmg, open Morse, then System Settings, Privacy & Security, **Open Anyway**.

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

Point at the exact part you mean and say it another way. Morse already checks whether a change did anything and tries again once; if nothing changed, it says so instead of saying it's done. Still stuck? See [Troubleshooting](docs/troubleshooting.md), or [open an issue](https://github.com/sam-siavoshian/Morse/issues) with the app, what you asked, and what happened.

</details>

## Documentation

- [Getting started](docs/getting-started.md): install, the first change, and every way in.
- [The Morse app](docs/desktop-app.md): your apps, Always open with Morse, and updates.
- [Desktop apps](docs/desktop.md): which apps work, and why some can't.
- [Models](docs/models.md): Claude Code, Codex, API keys, and how Morse picks.
- [Mods](docs/mods.md) and [Your controls](docs/your-controls.md): on, off, undo, share, and safe start.
- [For developers](docs/dev/README.md): the `morse` command, and building and testing Morse.

## Contributing

Bugs and ideas: [open an issue](https://github.com/sam-siavoshian/Morse/issues). Code and docs: [send a pull request](https://github.com/sam-siavoshian/Morse/pulls). [CONTRIBUTING.md](CONTRIBUTING.md) has the setup and checks, and [How Morse works](docs/dev/architecture.md) maps the code.

## License

[MIT](LICENSE). The first run's dots and sound come from [Zephium](https://github.com/zephium-browser/zephium), under the Mozilla Public License 2.0 ([notice](desktop-app/ui/sounds/NOTICE.md)).
