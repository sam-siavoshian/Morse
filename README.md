# ▦ Morse

**Change any website or desktop app in your own words.**

[![Watch the 92-second demo](https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/docs/launch/poster-demo-v2.png)](https://github.com/sam-siavoshian/RRAA/blob/main/docs/launch/morse-demo-v2.mp4)

*[Watch the 92-second demo](https://github.com/sam-siavoshian/RRAA/blob/main/docs/launch/morse-demo-v2.mp4). It was recorded from real runs: Claude Code wrote the sleep timer, the button, the fix and the round covers. A 36-second video on a real app (VSCodium) and more clips are in [`docs/launch`](docs/launch/).*

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

You need [Node](https://nodejs.org) 22 or newer. For full steps and help when something goes wrong, see [Getting started](docs/getting-started.md).

**Websites (Chrome)**

1. Install Morse: `npm install -g morse-cli`. Until the first npm release, use `npm install -g github:sam-siavoshian/RRAA`.
2. Open `chrome://extensions` and turn on **Developer mode**. Click **Load unpacked** and choose the folder that `morse extension` prints. The welcome page opens.
3. Answer its one question. Then connect a model. With Morse Desktop open, click **Use Claude Code**, then **Allow**. Or paste an Anthropic API key, or run the `morse setup --pair <code>` command it shows.
4. Make your first change on the practice page. Then press **⌥Space** on any page (Ctrl+Shift+Space on Windows and Linux). Morse asks for **“Allow User Scripts”** only when a change needs it.

**Desktop apps (tested on VSCodium, Obsidian and Joplin)**

1. Install Morse as in step 1 above. Then run `morse setup` to choose your model.
2. Run `morse apps` to see which of your apps Morse can connect to.
3. Run `morse launch obsidian` to open the app with Morse. Keep the terminal open.
4. In the app, press **Ctrl+Shift+Space** (⌥Space on a Mac). Point at something and say what you want. More in [Desktop apps](docs/desktop.md).

To work on Morse itself, see the [developer guide](docs/dev/README.md#set-up-a-checkout).

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
| **Easier to use** | Higher contrast, bigger click targets, an easier font and Read aloud. Check this page finds problems, and Fix it fixes them. | [Easier to use](docs/easier-to-use.md) |
| **Mods** | Turn mods on and off, share them with a link, try mods other people made, and fix one when a site changes. | [Mods](docs/mods.md) |
| **Mod packs** | Share a set of mods with your team. Each person picks the ones they want. The pack can stay up to date. | [Mod packs](docs/mod-packs.md) |
| **Your controls** | One shortcut turns every mod off. Pause Morse on a site. Morse stops a mod that slows down, freezes or keeps breaking a page. Back up everything to one file. | [Your controls](docs/your-controls.md) |
| **Your style** | One look on every site and app: your font, bigger text, calmer pages, colors that are easier to tell apart. Say it once and end with “everywhere”. | [Your style](docs/your-style.md) |
| **Desktop apps** | `morse launch obsidian` opens the app with Morse. The app's own files never change. | [Desktop apps](docs/desktop.md) |
| **Morse Desktop** | An app for your computer. Open your apps with Morse, choose your model and connect Chrome, all without a terminal. It waits in the tray. | [Morse Desktop](docs/desktop-app.md) |

## Which models work

Morse has no model and no account of its own. It uses a model you already have. `morse setup` finds it.

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

Version 0.2, not released yet ([changelog](CHANGELOG.md)). Here is what was tested for real, and what wasn't.

**Tested**

- **Websites:** the Chrome extension on three sites in Chromium on Linux. One site had strict security settings. Share links installed in a second browser profile. The Tampermonkey version runs without Morse.
- **Desktop apps:** a real Electron app built for testing (Electron 45 on Linux). It has a menu bar, a locked-down preload, an embedded page and a second window, and is packed the way apps ship. Real keyboard and mouse input: launch, change, save, quit, launch again, and the mod is back. Morse still connects with fuses locked down and Chromium's sandbox on.
- **Claude Code with today's defaults** (sonnet for small changes, opus for new features and new looks): 48 of 51 requests worked on 13 demo apps. The earlier haiku-then-sonnet choice got 47 ([evals](evals/README.md#fast-and-strong-models-automatic)).
- **Claude Code (haiku)**, the earlier default: the demo video, the Electron app, Describe this picture, Show me once (10 of 12 runs), and 55 everyday requests on 6 demo apps, 3 runs each. 163 of 165 worked ([evals](evals/README.md)).
- **Real apps on Linux**, with Claude Code (haiku) and real keyboard and mouse: VSCodium 1.140 (its `.deb`), Obsidian 1.14 and Joplin 3.7 (AppImages). `morse apps` found them and `morse launch` opened them. Each got one change: a bigger status bar, no ribbon, no Synchronize button. Each took 6 to 16 seconds and was still there after quitting and opening the app again. [Tested on](docs/desktop.md#tested-on).
- **Real websites** with the extension and Claude Code (haiku): pypi.org, gitlab.com, pkg.go.dev, rubygems.org, hub.docker.com and nodejs.org. Five changes worked and were still there after a reload. On the Node.js docs, “hide the left sidebar” blanked the whole page every time. With “Allow User Scripts” off, PyPI blocked a new button. GitLab didn't. [Details](docs/desktop.md#websites).
- **Morse Desktop on Linux:** it lists your apps and opens a real Electron app with Morse. It disconnects and connects again, asks before it restarts an open app, and keeps running when its window closes. Its AppImage starts and lists this computer's apps. [Morse Desktop](docs/desktop-app.md).
- `npm test` covers every model connection against stand-ins, the Morse helper, the engine, sharing, and the UI in real Chromium.

**Not tested yet**

- Microsoft's VS Code, Spotify, Slack or Discord, Flatpak and Snap installs, macOS, Windows and Wayland. Wikipedia, YouTube, GitHub's pages and other sites the test machine couldn't reach. Apps that aren't built from web pages (Finder, most system apps) can't work. See [Desktop apps](docs/desktop.md#which-apps-cant-work-and-why).
- **Codex** was only tested with a stand-in `codex` command. **The Anthropic and OpenAI APIs** were only tested with stand-in servers.
- **Mods can do anything the page can.** The model is told not to send data anywhere, but nothing stops it yet. Before you install a shared mod, Morse tells you what it does.
- The extension isn't in the Chrome Web Store. Nobody has tried Morse Desktop's macOS and Windows builds, their signing, its tray menu or connecting Chrome with one click ([Releasing](docs/dev/releasing.md#what-was-checked)).
- Most screenshots replay saved answers, so they look the same every time. One set uses [real Claude Code](docs/screenshots/claude-code). How each part was tested: [Testing](docs/dev/testing.md#what-was-verified-and-how).

## More

[Docs](docs/README.md) · [Contributing](CONTRIBUTING.md) · [How Morse works](docs/dev/architecture.md) · [Privacy policy](docs/privacy.md) · [Changelog](CHANGELOG.md) · [Launch videos](docs/launch/README.md) · MIT licensed
