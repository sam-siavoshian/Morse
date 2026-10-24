# Changelog

Morse's version lives in `package.json`. The build copies it into the Chrome
extension, and `morse --version` prints it.

## 0.2.0 (not released yet)

The first version meant for other people to install.

### Change apps in your own words

- Press the shortcut (⌥Space on a Mac, Ctrl+Shift+Space elsewhere), point at
  something, and describe a change. Or skip pointing and describe a change to
  the whole page.
- What you pointed at turns into a grid of small squares while the model
  writes. Changes to how things look show up while it is still writing.
- If the new code fails, Morse shows the model what went wrong and it tries
  again.
- Ask for a follow-up ("make it smaller") to change the same mod. Step back,
  bring back any of the last 20 versions, or fix a mod that stopped working.
- Hold the shortcut and talk instead of typing.

### Where it works

- Websites, with the Chrome extension.
- Desktop apps built from web pages (Spotify, Slack, Discord, VS Code, Notion,
  Obsidian and others): `morse launch spotify` reopens the app with Morse
  connected. Morse never changes the app's files.
- Morse Desktop: an app for your computer, so you don't need a terminal or
  Node. It lists your apps and opens them with Morse, chooses and checks your
  model, runs the Morse helper for Chrome (Chrome asks once and you click
  Allow, no code to type), and shows your mods and checks. Its first run is one
  screen: the model it found, and your apps to open. It waits in the tray or menu bar, and
  opens at login only if you turn that on. Built as a Linux AppImage; the macOS
  and Windows builds are set up but not tried yet.

### Your model

- Claude Code or Codex, with your own subscription, or an Anthropic or OpenAI
  API key. `morse setup` finds what you have and asks which to use.
- No Morse account and no Morse server.

### Without a model

- Edit tools: hide, move, resize, rename, recolor, change text size,
  duplicate. Saved as one mod, with undo and redo.
- Page tools: dark or light mode, bigger or smaller text, hide ads and
  pop-ups, focus mode.
- Easier to use: higher contrast, bigger click targets, an easier to read
  font, underlined links, no animations, a focus outline, a reading ruler.
  Read aloud, and Check this page with Fix it.

### Ask and find

- Ask about the app instead of changing it, and get a plain answer with
  numbered markers. Show me walks you through the clicks. Explain this page
  sums up what the screen is for.

### Mods

- Every change can be saved as a mod that comes back next time, even after a
  restart. Turn mods on and off, edit their code, or delete them in the Mods
  panel.
- Share a mod as a link, a file, or a script that runs in Tampermonkey
  without Morse. Before you install a shared mod, Morse says in plain words
  what it does.
- The gallery: example mods for apps people use every day, and "Mods for this
  site" in the bar and the Mods panel.
- One shortcut (⌥⇧0) turns off every mod on a page. Pause Morse on one site
  or everywhere. Back up every mod to one file.
- Mod packs: share several mods together as a link or a file. Installing one
  shows every mod first, and you untick the ones you don't want. A team can
  keep its pack at an address; Morse checks it at most once a day and shows
  what changed before anything updates. `morse pack make | install | list`.

### Installing

- `npm install -g morse-cli` adds the `morse` command, with the Chrome
  extension inside (`morse extension` shows where).
- `npm run package:extension` makes the zip for the Chrome Web Store.
- A privacy policy that says exactly what leaves your computer:
  [docs/privacy.md](docs/privacy.md).

## 0.1.0

A first working version for local models: point, describe, and a model on
your computer rewrote the page. Replaced by 0.2.0, which uses the model you
already have.
