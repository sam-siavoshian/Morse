# ▦ Morse

**Morse lets you change any website or desktop app by saying what you want.**

[![Watch the 92-second demo](https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/poster-demo-v2.png)](https://github.com/sam-siavoshian/RRAA/blob/main/docs/launch/morse-demo-v2.mp4)

*[Watch the 92-second demo](https://github.com/sam-siavoshian/RRAA/blob/main/docs/launch/morse-demo-v2.mp4), recorded from real runs: Claude Code wrote the sleep timer, the button, the fix and the round covers. The 36-second cut on a real app (VS Code) and more clips are in [`docs/launch`](docs/launch/).*

Press a shortcut, point at something and say what you want: “add a sleep timer”, “hide the ads”, “make this text bigger”. Morse makes the change right there while you watch. A mod is a change you saved. Morse brings it back every time you open that site or app.

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

You need [Node](https://nodejs.org) 22 or newer. Full steps, and what to do when something goes wrong: [Getting started](docs/getting-started.md).

**Websites (Chrome)**

1. Get Morse: `npm install -g morse-cli` (until the first npm release: `npm install -g github:sam-siavoshian/RRAA`).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder `morse extension` prints. The welcome page opens.
3. Answer its one question, then connect a model: with Morse Desktop open, click **Use Claude Code** and **Allow**. Or paste an Anthropic API key, or run the `morse setup --pair <code>` it shows.
4. Make your first change on its practice page, then press **⌥Space** (Ctrl+Shift+Space on Windows and Linux) on any page. Morse asks for **“Allow User Scripts”** only when a change needs it.

**Desktop apps (tested on VSCodium, Obsidian and Joplin)**

1. Get Morse as in step 1 above, then run `morse setup` to choose your model.
2. `morse apps` shows which of your apps Morse can connect to.
3. `morse launch obsidian` opens the app with Morse connected. Keep the terminal open.
4. In the app, press **Ctrl+Shift+Space** (⌥Space on a Mac), point at something and say what you want. More: [Desktop apps](docs/desktop.md).

To work on Morse itself from a clone, see the [developer guide](docs/dev/README.md#set-up-a-checkout).

## What you can do

| | | |
|---|---|---|
| **Describe a change** | Point at something, or at nothing for the whole page, and say what you want. You see it change while the model writes. | [Changing things](docs/changing-things.md) |
| **Keep improving it** | Ask for a follow-up (“make it smaller”), step back, or bring back any of the last 20 versions. | [Changing things](docs/changing-things.md#keep-improving-it) |
| **Voice** | Hold the shortcut and talk instead of typing. | [Changing things](docs/changing-things.md#voice) |
| **Edit tools** | Hide, move, resize, rename, recolor or copy something yourself. No model, no waiting. | [Edit tools and Page tools](docs/edit-and-page-tools.md) |
| **Page tools** | Dark or light mode, text size, hide ads and pop-ups, focus mode. One click each. | [Edit tools and Page tools](docs/edit-and-page-tools.md#page-tools) |
| **Ask and find** | Ask what something does or where a setting is. **Show me** walks you through the clicks. | [Ask and find](docs/ask-and-find.md) |
| **Show me once** | Do a task by hand once, then turn it into a button, a shortcut, or “do this to every one”. | [Show me once](docs/show-me-once.md) |
| **Bring a feature** | **Take this** in one app (a command palette, a dark mode switch), then **Bring here** in another. Morse builds it there, in that app's own look. | [Bring a feature](docs/bring-a-feature.md) |
| **Easier to use** | Higher contrast, bigger click targets, an easier font, Read aloud, and Check this page with Fix it. | [Easier to use](docs/easier-to-use.md) |
| **Mods** | Turn mods on and off, share them with a link, try mods other people made, and fix one when a site changes. | [Mods](docs/mods.md) |
| **Mod packs** | Share several mods together with your team. Each person picks the ones they want, and the pack can stay up to date. | [Mod packs](docs/mod-packs.md) |
| **Your controls** | One shortcut turns every mod off. Pause Morse on a site. A mod that slows down, freezes or keeps breaking a page is stopped. Back up everything to one file. | [Your controls](docs/your-controls.md) |
| **Your style** | One look on every site and app: your font, bigger text, calmer pages, colors that are easier to tell apart. Say it once, ending with “everywhere”. | [Your style](docs/your-style.md) |
| **Desktop apps** | `morse launch obsidian` opens the app with Morse connected. The app's own files never change. | [Desktop apps](docs/desktop.md) |
| **Morse Desktop** | An app for your computer: open your apps with Morse, choose your model and connect Chrome, all without a terminal. It waits in the tray. | [Morse Desktop](docs/desktop-app.md) |

## Which models work

Morse has no model and no account of its own. It uses one you already have, and `morse setup` finds it.

| Model | What you need |
|---|---|
| **Claude Code** | The `claude` command, signed in with your Claude plan |
| **Codex** | The `codex` command, signed in |
| **Anthropic API key** | A key from console.anthropic.com |
| **OpenAI API key** | A key from platform.openai.com, or another server that works the same way |

Morse uses strong models by default: with Claude Code, `sonnet` for small tweaks and `opus` for new features, new UI and restyles (with an API key, `claude-sonnet-5-5` and `claude-opus-5-5`). A smaller model only if you name one.

How to choose one, and what each can do: [Models and setup](docs/models.md).

## Privacy

There is no Morse server. What you point at and what you ask go only to the model you chose, and only when you ask (or turn on automatic fixes). Your mods stay on your computer.
More, including what mods can do: [Privacy and safety](docs/privacy-and-safety.md) and the [privacy policy](docs/privacy.md).

## Status

Version 0.2, not released yet ([changelog](CHANGELOG.md)). What was checked for real, and what wasn't:

**Verified**

- **Websites:** the Chrome extension on three sites, one with strict security settings, in Chromium on Linux. Share links installed in a second browser profile; the Tampermonkey version runs without Morse.
- **Desktop apps:** a real Electron app built for testing (Electron 45 on Linux, with a menu bar, a locked-down preload, an embedded page and a second window, packed the way apps ship), driven with real keyboard and mouse: launch, change, save, quit, launch again, and the mod is back. Fuses locked down and Chromium's sandbox on: Morse still connects.
- **Claude Code with today's defaults** (sonnet for small tweaks, opus for new features and restyles): 48 of 51 requests on 13 demo apps, against 47 with the earlier haiku-then-sonnet choice ([evals](evals/README.md#fast-and-strong-models-automatic)).
- **Claude Code (haiku)**, the default before, as the model: the demo video, the Electron app, Describe this picture, Show me once (10 of 12 runs), and 55 everyday requests on 6 demo apps, 3 runs each: 163 of 165 worked ([evals](evals/README.md)).
- **Real apps on Linux**, with Claude Code (haiku) and real keyboard and mouse: VSCodium 1.140 (its `.deb`), Obsidian 1.14 and Joplin 3.7 (AppImages). `morse apps` found them and `morse launch` opened them. One change each (a bigger status bar, no ribbon, no Synchronize button) took 6 to 16 seconds and was back after quitting and opening the app again. [Tested on](docs/desktop.md#tested-on).
- **Real websites** with the extension and Claude Code (haiku): pypi.org, gitlab.com, pkg.go.dev, rubygems.org, hub.docker.com and nodejs.org. Five changes worked and were still there after a reload. On the Node.js docs, “hide the left sidebar” blanked the whole page every time. With “Allow User Scripts” off, PyPI blocked a new button; GitLab didn't. [Details](docs/desktop.md#websites).
- **Morse Desktop on Linux:** it lists your apps, opens a real Electron app with Morse, disconnects and connects again, asks before restarting an open app, and keeps running when its window closes. Its AppImage starts and lists this computer's apps. [Morse Desktop](docs/desktop-app.md).
- `npm test` covers every model connection against stand-ins, the Morse helper, the engine, sharing, and the UI in real Chromium.

**Not verified yet**

- Microsoft's VS Code, Spotify, Slack or Discord, Flatpak and Snap installs, macOS, Windows and Wayland. Wikipedia, YouTube, GitHub's pages and other sites the test machine couldn't reach. Apps that aren't built from web pages (Finder, most system apps) can't work. See [Desktop apps](docs/desktop.md#which-apps-cant-work-and-why).
- **Codex** is only tested against a stand-in `codex` command, and **the Anthropic and OpenAI APIs** only against stand-in servers.
- **Mods can do anything the page can.** The model is told not to send data anywhere, but nothing stops it yet. Morse says what a shared mod does before you install it.
- The extension isn't in the Chrome Web Store. Morse Desktop's macOS and Windows builds, their signing, its tray menu and connecting Chrome with one click weren't tried yet ([Releasing](docs/dev/releasing.md#what-was-checked)).
- Most screenshots replay pre-written answers so they come out the same every time; one set uses [real Claude Code](docs/screenshots/claude-code). How each part was checked: [Testing](docs/dev/testing.md#what-was-verified-and-how).

## More

[Docs](docs/README.md) · [Contributing](CONTRIBUTING.md) · [How Morse works](docs/dev/architecture.md) · [Privacy policy](docs/privacy.md) · [Changelog](CHANGELOG.md) · [Launch videos](docs/launch/README.md) · MIT licensed
