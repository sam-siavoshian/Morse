# ▦ Morse

**Change any website or desktop app in your own words.**

[![Microsoft's Visual Studio Code after “make the whole editor look like a warm paper notebook”: cream backgrounds, brown text, serif file names, and the Morse bar offering Save](https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/screenshots/321-vscode-result.png)](docs/desktop.md#tested-on)

*Visual Studio Code on Linux, after “make the whole editor look like a warm paper notebook: cream backgrounds, dark brown text, and a serif font in the sidebar and the tabs”. Claude Code (opus) wrote it in 18 seconds. It was still there when the app opened again. More real apps and sites: [Tested on](docs/desktop.md#tested-on). Videos are in [`docs/launch`](docs/launch/).*

Press a shortcut, point at something and say what you want: “add a sleep timer”, “hide the ads”, “make this text bigger”. Morse makes the change while you watch. A mod is a change you saved. Morse brings it back every time you open that site or app.

<!--
  Contributors: keep this README short. It is the 30-second version.
  - Put the detail of a feature (how to use it, screenshots, limits) in a page in docs/
    and list that page in docs/README.md. Developer detail goes in docs/dev/.
  - For a new feature, add one row to "What you can do" below: a name, one plain line,
    and a link to its docs page. Nothing else.
  - Keep "Status" honest and in step with docs/desktop.md and docs/launch/README.md.
  - Words follow docs/WRITING.md. `npm test` checks every link (tests/docs.test.js).
  - Images use full https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/... addresses:
    npmjs.com shows this README too, and can't follow a relative image path.
-->

## Install

Morse is one app. Download it, open it, and you're done.

**[Download Morse](https://sam-siavoshian.github.io/RRAA/site/#install):** [Mac (Apple silicon)](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-mac-arm64.dmg) · [Mac (Intel)](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-mac-x64.dmg) · [Windows](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-Setup.exe) · [Linux](https://github.com/sam-siavoshian/RRAA/releases/download/preview/Morse-linux-x86_64.AppImage)

1. Open Morse. It finds Claude Code or Codex by itself, and lists your apps.
2. Click **Open with Morse** next to an app. In the app, press **Ctrl+Shift+Space** (**⌥Space** on a Mac), point at something and say what you want.
3. **Chrome:** click **Use Morse in Chrome** in the Morse app. Then click **Allow** when Morse asks.

These are [preview builds](https://github.com/sam-siavoshian/RRAA/releases/tag/preview) of the newest `main`, not signed yet. The first time, on a Mac: open Morse, then System Settings, Privacy & Security, **Open Anyway**. On Windows: **More info**, then **Run anyway**. Full steps and help: [Getting started](docs/getting-started.md).

## What you can do

| | | |
|---|---|---|
| **Describe a change** | Point at something and say what you want. Point at nothing to change the whole page. You see the change while the model writes it. | [Changing things](docs/changing-things.md) |
| **Keep improving it** | Ask for more (“make it smaller”), step back, or go back to any of the last 20 versions. | [Changing things](docs/changing-things.md#keep-improving-it) |
| **Voice** | Hold the shortcut and talk instead of typing. | [Changing things](docs/changing-things.md#voice) |
| **Edit tools** | Hide, move, resize, rename, recolor or copy something yourself. No model, no waiting. | [Edit tools and Page tools](docs/edit-and-page-tools.md) |
| **Page tools** | Dark or light mode, text size, hide ads and pop-ups, focus mode. One click each. | [Edit tools and Page tools](docs/edit-and-page-tools.md#page-tools) |
| **Ask and find** | Ask what something does or where a setting is. **Show me** shows where to click. | [Ask and find](docs/ask-and-find.md) |
| **Show me once** | Do a task by hand once. Then turn it into a button, a shortcut, or “do this to every one”. | [Show me once](docs/show-me-once.md) |
| **Bring a feature** | **Take this** in one app (a command palette, a dark mode switch), then **Bring here** in another. Morse builds it there, in that app's own look. | [Bring a feature](docs/bring-a-feature.md) |
| **Easier to use** | Higher contrast, bigger click targets, an easier font and Read aloud. Check this page finds problems, and Fix it fixes them. | [Easier to use](docs/easier-to-use.md) |
| **Mods** | Turn mods on and off, share them with a link, try mods other people made, and fix one when a site changes. | [Mods](docs/mods.md) |
| **Mod packs** | Share a set of mods with your team. Each person picks the ones they want. The pack can stay up to date. | [Mod packs](docs/mod-packs.md) |
| **Your controls** | One shortcut turns every mod off. Pause Morse on a site. Morse stops a mod that slows down, freezes or keeps breaking a page. Back up everything to one file. | [Your controls](docs/your-controls.md) |
| **Your style** | One look on every site and app: your font, bigger text, calmer pages, colors that are easier to tell apart. Say it once and end with “everywhere”. | [Your style](docs/your-style.md) |
| **The Morse app** | Opens your apps with Morse, finds your model, and adds Morse to Chrome. The apps' own files never change. It waits in the tray. | [The Morse app](docs/desktop-app.md) |
| **Desktop apps** | Which apps work, and why some can't. | [Desktop apps](docs/desktop.md) |

## Which models work

Morse has no model and no account of its own. It uses a model you already have. The Morse app finds it.

| Model | What you need |
|---|---|
| **Claude Code** | The `claude` command, signed in with your Claude plan |
| **Codex** | The `codex` command, signed in |
| **Anthropic API key** | A key from console.anthropic.com |
| **OpenAI API key** | A key from platform.openai.com, or from another server that works the same way |

Morse uses strong models unless you name another one. With Claude Code, it uses `sonnet` for small changes and `opus` for new features, new buttons and panels, and new looks. With an API key, it uses `claude-sonnet-5-5` and `claude-opus-5-5`.

To choose a model and see what each can do, read [Models and setup](docs/models.md).

## Privacy

There is no Morse server. What you point at and what you ask go only to the model you chose. They go only when you ask, or when you turn on automatic fixes. Your mods stay on your computer.
More, including what mods can do: [Privacy and safety](docs/privacy-and-safety.md) and the [privacy policy](docs/privacy.md).

## Status

Version 0.2.0, the first release ([download](https://github.com/sam-siavoshian/RRAA/releases/tag/v0.2.0), [changelog](CHANGELOG.md)). Here is what was tested for real, and what wasn't.

**Tested**

- **Websites:** the Chrome extension on three sites in Chromium on Linux. One site had strict security settings. Share links installed in a second browser profile. The Tampermonkey version runs without Morse.
- **Desktop apps:** a real Electron app built for testing (Electron 45 on Linux). It has a menu bar, a locked-down preload, an embedded page and a second window, and is packed the way apps ship. Real keyboard and mouse input: launch, change, save, quit, launch again, and the mod is back. Morse still connects with fuses locked down and Chromium's sandbox on.
- **Claude Code with today's defaults** (sonnet for small changes, opus for new features and new looks): 48 of 51 requests worked on 13 demo apps. The earlier haiku-then-sonnet choice got 47 ([evals](evals/README.md#fast-and-strong-models-automatic)).
- **Claude Code (haiku)**, the earlier default: the demo video, the Electron app, Describe this picture, Show me once (10 of 12 runs), and 55 everyday requests on 6 demo apps, 3 runs each. 163 of 165 worked ([evals](evals/README.md)).
- **Real apps on Linux**, with Claude Code (haiku) and real keyboard and mouse: VSCodium 1.140 (its `.deb`), Obsidian 1.14 and Joplin 3.7 (AppImages). `morse apps` found them and `morse launch` opened them. Each got one change: a bigger status bar, no ribbon, no Synchronize button. Each took 6 to 16 seconds and was still there after quitting and opening the app again. [Tested on](docs/desktop.md#tested-on).
- **Microsoft's VS Code 1.143 and Obsidian 1.14, big changes** with Claude Code (opus, and sonnet for two): 14 of them. They range from a Windows 95 look and a typewriter theme to a focus timer, a presentation-mode shortcut, a New daily note button and pinned notes. Each was saved, then the app was closed and opened again with `morse launch`, and each change was back. Four more were on real websites. Before and after pictures: [showcase](docs/showcase/README.md).
- **Real websites** with the extension and Claude Code (haiku): pypi.org, gitlab.com, pkg.go.dev, rubygems.org, hub.docker.com and nodejs.org. Five changes worked and were still there after a reload. On the Node.js docs, “hide the left sidebar” blanked the whole page every time. With “Allow User Scripts” off, PyPI blocked a new button. GitLab didn't. [Details](docs/desktop.md#websites).
- **Morse Desktop on Linux:** it lists your apps and opens a real Electron app with Morse. It disconnects and connects again, asks before it restarts an open app, and keeps running when its window closes. Its AppImage starts and lists this computer's apps. [Morse Desktop](docs/desktop-app.md).
- `npm test` covers every model connection against stand-ins, the Morse helper, the engine, sharing, and the UI in real Chromium.

**Not tested yet**

- Spotify, Slack or Discord, Flatpak and Snap installs, macOS, Windows and Wayland. Wikipedia, YouTube, GitHub's pages and other sites the test machine couldn't reach. Apps that aren't built from web pages (Finder, most system apps) can't work. See [Desktop apps](docs/desktop.md#which-apps-cant-work-and-why).
- **Codex** was only tested with a stand-in `codex` command. **The Anthropic and OpenAI APIs** were only tested with stand-in servers.
- **Mods can do anything the page can.** The model is told not to send data anywhere, but nothing stops it yet. Before you install a shared mod, Morse tells you what it does.
- The extension isn't in the Chrome Web Store. Nobody has tried Morse Desktop's macOS and Windows builds, their signing, its tray menu or connecting Chrome with one click ([Releasing](docs/dev/releasing.md#what-was-checked)).
- Most screenshots replay saved answers, so they look the same every time. One set uses [real Claude Code](docs/screenshots/claude-code). How each part was tested: [Testing](docs/dev/testing.md#what-was-verified-and-how).

## For developers

The `morse` command does everything the app does, from a terminal, and works on Morse itself. It needs [Node](https://nodejs.org) 22 or newer.

- One line installs it: `curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install.sh | sh` on macOS and Linux, `irm https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install.ps1 | iex` in Windows PowerShell. Run it again to update; `morse uninstall` removes it. Or `npm install -g github:sam-siavoshian/RRAA`.
- `morse setup` chooses the model, `morse apps` lists your apps, `morse launch obsidian` opens one with Morse, and `morse help` lists the rest.
- The Chrome extension's folder: `morse extension`. Its welcome page with `?dev` has the developer ways to connect: an Anthropic API key, or `morse setup --pair <code>`.
- To build and test Morse: the [developer guide](docs/dev/README.md#set-up-a-checkout).

## More

[Docs](docs/README.md) · [Contributing](CONTRIBUTING.md) · [How Morse works](docs/dev/architecture.md) · [Privacy policy](docs/privacy.md) · [Changelog](CHANGELOG.md) · [Launch videos](docs/launch/README.md) · MIT licensed
