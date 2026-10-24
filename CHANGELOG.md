# Changelog

Morse's version lives in `package.json`. The build copies it into the Chrome
extension, and `morse --version` prints it.

Add what people will notice under "Unreleased". `npm run release` moves it
under the new version number with the date
([Releasing](docs/dev/releasing.md)).

## Unreleased

Version 0.2.0, the first version meant for other people to install.

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
  connected. Morse never changes the app's files. Electron apps Morse opens
  itself get a private connection only Morse can use, instead of a debugging
  port other programs could use too (Linux and macOS; tried on Linux).
- Changes to what a desktop app does, not only how it looks: the first time
  an app opens with Morse, Morse reads how it works inside (its commands,
  how its windows talk to the rest of it, what its buttons do), keeps that in
  `~/.morse/profiles`, and gives your model the parts that fit your request.
  A change can then run the app's own commands ("add a button that formats
  the document" in VSCodium). `morse profile <app>` shows what Morse found.
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
- Two strong models from what you chose, and never a small one unless you
  name it: small tweaks use the first (Claude Code: sonnet), and new UI, new
  features and restyles go straight to the strongest (Claude Code: opus).
  When the first model's change doesn't work, the stronger one tries before
  Morse gives up. Settings has Model: Automatic, Always fast or Always best.

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
  site" in the bar and the Mods panel. 38 of them were checked on the real
  page or demo app: they work, and still work after a reload. Dark modes,
  reading modes, contents that stay in view, keyboard shortcuts, a focus
  timer, copy and download buttons and more. The gallery page has
  categories, search, before and after pictures, and shows which mods work
  without Chrome's “Allow User Scripts”.
- One shortcut (⌥⇧0) turns off every mod on a page. Pause Morse on one site
  or everywhere. Back up every mod to one file.
- Mod packs: share several mods together as a link or a file. Installing one
  shows every mod first, and you untick the ones you don't want. A team can
  keep its pack at an address; Morse checks it at most once a day and shows
  what changed before anything updates. `morse pack make | install | list`.

### Installing

- `npm install -g morse-cli` adds the `morse` command, with the Chrome
  extension inside (`morse extension` shows where).
- `npm run store` makes the zip for the Chrome Web Store (a store build,
  without the address only tests use) and prints its SHA-256;
  `npm run store:smoke` tries that zip in a fresh browser.
  [docs/store/SUBMIT.md](docs/store/SUBMIT.md) goes through the submission.
- The welcome page asks one question (websites, desktop apps or both), then
  connects in one click: with Morse Desktop open, **Use Claude Code** and
  Morse Desktop asks you to Allow. No code to type, no terminal. Or paste an
  Anthropic API key. The first change is guided on a practice page, then a
  site you choose opens with Morse ready. “Allow User Scripts” comes up only
  when a change needs it, with a picture of the switch.
  [docs/dev/onboarding.md](docs/dev/onboarding.md) has the before and after.
- The Morse icon sits on a dark tile, so it shows on light backgrounds too.
- Needs Chrome 138 or later, the first with the "Allow User Scripts" switch.
- A privacy policy that says exactly what leaves your computer:
  [docs/privacy.md](docs/privacy.md).
- Try it on the website first, with nothing to install: the real Morse runs
  in a small music app and a news site on the page, with sample answers for a
  few changes. Save one, reload the app, and it comes back.

## 0.1.0

A first working version for local models: point, describe, and a model on
your computer rewrote the page. Replaced by 0.2.0, which uses the model you
already have.
