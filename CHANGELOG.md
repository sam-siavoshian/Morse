# Changelog

Morse's version lives in `package.json`. The build copies it into the Chrome
extension, and `morse --version` prints it.

Add what people will notice under "Unreleased". `npm run release` moves it
under the new version number with the date
([Releasing](docs/dev/releasing.md)).

## Unreleased

Version 0.2.0, the first version for other people to install.

### Describe a change

- Press the shortcut (⌥Space on a Mac, Ctrl+Shift+Space on Windows and
  Linux). Point at something and describe a change. Or point at nothing and
  describe a change to the whole page.
- What you pointed at turns into a grid of small squares while the model
  writes. Changes to how things look show up before it finishes.
- If the new code fails, Morse shows the model what went wrong, and the model
  tries again.
- Ask for more ("make it smaller") to change the same mod. Step back, go back
  to any of the last 20 versions, or fix a mod that stopped working.
- Hold the shortcut and talk instead of typing.
- Bring a feature from one app to another: **Take this** on a command palette,
  a dark mode switch or a notice in one app or site, then **Bring here** in
  another, or just type “add VS Code's command palette here”. Morse builds it
  from that app's own fonts, colors and corners. Chrome and desktop apps share
  what you took once they are paired.

### Where it works

- Websites, with the Chrome extension.
- Desktop apps built from web pages, tested on VSCodium, Obsidian and Joplin.
  `morse launch obsidian` opens the app again with Morse. Morse never changes
  the app's files. When Morse opens an Electron app itself, the app gets a
  private connection that only Morse can use. Other programs can't use it,
  as they could a debugging port. This works on Linux and macOS, and was
  tested on Linux.
- Changes to what a desktop app does, not only how it looks. The first time
  an app opens with Morse, Morse reads how it works inside: its commands, how
  its windows talk to the rest of it, and what its buttons do. It keeps that
  in `~/.morse/profiles` and gives your model the parts that fit your
  request. A change can then run the app's own commands ("add a button that
  formats the document" in VSCodium). `morse profile <app>` shows what Morse
  found.
- Morse Desktop: an app for your computer, so you don't need a terminal or
  Node. It lists your apps and opens them with Morse. It chooses and checks
  your model, and runs the Morse helper for Chrome. Chrome asks once and you
  click Allow, with no code to type. It shows your mods and checks. The first
  run is one screen: the model it found, and your apps to open. It waits in
  the tray or menu bar. It opens at login only if you turn that on. It is
  built as a Linux AppImage. The macOS and Windows builds are set up but not
  tried yet.

### Models

- Claude Code or Codex with your own plan, or an Anthropic or OpenAI API key.
  `morse setup` finds what you have and asks which to use.
- No Morse account and no Morse server.
- Morse uses two strong models from the one you chose. It never uses a small
  one unless you name it. Small changes use the first one (Claude Code:
  sonnet). New buttons, new features and new looks go to the strongest one
  (Claude Code: opus). If the first model's change doesn't work, the stronger
  one tries before Morse gives up. In Settings, Model can be Automatic, Always
  fast or Always best.

### Without a model

- Edit tools: hide, move, resize, rename, recolor, change text size,
  duplicate. Saved as one mod, with undo and redo.
- Page tools: dark or light mode, bigger or smaller text, hide ads and
  pop-ups, focus mode.
- Easier to use: higher contrast, bigger click targets, an easier to read
  font, underlined links, no animations, a focus outline, a reading ruler.
  Read aloud, and Check this page with Fix it.

### Ask and find

- Ask about the app instead of changing it. You get a plain answer with
  numbered markers. Show me shows where to click. Explain this page says what
  the screen is for.

### Mods

- Save any change as a mod. It comes back next time, even after a restart.
  Turn mods on and off, edit their code, or delete them in the Mods panel.
- Share a mod as a link, a file, or a script that runs in Tampermonkey
  without Morse. Before you install a shared mod, Morse tells you what it
  does.
- The gallery: example mods for apps people use every day. "Mods for this
  site" shows them in the bar and the Mods panel. 38 of them were tested on
  the real page or demo app, and still work after a reload. They include dark
  modes, reading modes, contents that stay in view, keyboard shortcuts, a
  focus timer, and copy and download buttons. The gallery page has
  categories, search, and before and after pictures. It shows which mods
  work without Chrome's “Allow User Scripts”.
- One shortcut (⌥⇧0) turns off every mod on a page. Pause Morse on one site
  or everywhere. Back up every mod to one file.
- Mod packs: share several mods together as a link or a file. When you
  install one, you see every mod first and untick the ones you don't want. A
  team can keep its pack at an address. Morse checks it at most once a day
  and shows what changed before anything updates. Commands:
  `morse pack make | install | list`.

### Install

- `npm install -g morse-cli` adds the `morse` command. The Chrome extension
  comes with it (`morse extension` shows where).
- `npm run store` makes the zip for the Chrome Web Store and prints its
  SHA-256. This store build leaves out the address only tests use.
  `npm run store:smoke` tries that zip in a fresh browser.
  [docs/store/SUBMIT.md](docs/store/SUBMIT.md) goes through the submission.
- The welcome page asks one question: websites, desktop apps or both. Then
  you connect in one click. With Morse Desktop open, click **Use Claude
  Code**, and Morse Desktop asks you to Allow. No code to type, no terminal.
  Or paste an Anthropic API key. A practice page guides your first change.
  Then a site you choose opens with Morse ready. “Allow User Scripts” comes up
  only when a change needs it, with a picture of the switch.
  [docs/dev/onboarding.md](docs/dev/onboarding.md) has the before and after.
- The Morse icon sits on a dark tile, so it shows on light backgrounds too.
- Needs Chrome 138 or later, the first with the "Allow User Scripts" switch.
- A privacy policy that says exactly what leaves your computer:
  [docs/privacy.md](docs/privacy.md).
- Try Morse on the website first, with nothing to install. The real Morse
  runs in a small music app and a news site on the page, with sample answers
  for a few changes. Save one and reload the app. It comes back.

## 0.1.0

A first working version for local models: point, describe, and a model on
your computer rewrote the page. Replaced by 0.2.0, which uses the model you
already have.
