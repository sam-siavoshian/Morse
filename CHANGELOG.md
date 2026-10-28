# Changelog

Morse's version lives in `package.json`; `morse --version` prints it.

Add what people will notice under "Unreleased". `npm run release` moves it
under the new version number with the date
([Releasing](docs/dev/releasing.md)).

## Unreleased

- **Download update installs Morse.** When a newer version is published, Download update downloads it, checks it against the release, replaces this copy and opens Morse again. If the download or the install can't finish, Morse says so and keeps this version.

## 0.3.4 (2026-10-27)

- **Move a captured look.** The dots on a capture show you can pick it up. Drag it onto the page and Morse rebuilds that look where you drop it. **Use it here** does the same for what you pointed at, or for the page. Click the capture again, or press Backspace, to clear the pick. **Remove** takes it out of the bar.
- **First run shows the app.** Setup stands on a night sky, with a window of Morse beside the steps. Each step has an icon. The app you pick has one Open button.
- **A zoomed app stays in the picture.** Morse crops the picture to what you pointed at, including when the app is zoomed out.
- **Stopping a change stops it.** If you stop while Morse is still fixing the change, it stops.

## 0.3.3 (2026-10-27)

- **Your apps have cheat codes.** The desktop welcome, in-app prompts, CLI, website and docs share the same direct language about removing unwanted features and building your own. Core branding is updated in every supported language.
- **A clearer desktop app.** App search and filters, connection status, model setup, navigation and saving mods have additional checks and fixes.
- **Native controls on macOS.** Morse includes a native control picker with Accessibility setup for supported actions outside web content.
- **More reliable changes.** Failed or cancelled drafts are cleaned up, incomplete responses are rejected, and saved mods have regression coverage.
- **Self-hosted AI setup.** Connect an existing compatible model server from the desktop app.

## 0.3.2 (2026-10-26)

- **Check for updates works.** The installed app was missing a file it needs to start, so Settings couldn't see whether a newer Morse was published. It starts, and Check for updates says if you're up to date.
- **Check for updates.** Settings has a button that looks for a newer Morse and says whether you're up to date, or that an update is available.
- **The website is [getmorse.vercel.app](https://getmorse.vercel.app/).** Share links and the gallery list use that address.

## 0.3.1 (2026-10-25)

- **Change the keys that open the bar.** Settings shows the keys. Press the ones you want. Morse uses those from then on.
- **Quieter windows.** The restart window and the update window use a thin line. The update window shows the Morse mark and how far the download has got.
- **The Mods list is easier to read.** An app's name is on its own line. The number of mods is on the line under it.
- **Your apps is one list.** The apps sit on one surface, with a thin line between them.
- **Connected means Morse is in the app.** An app is not marked Connected while Morse is still starting.
- **On a Mac, Morse remembers that you allowed it to open your apps.** After it restarts, it does not ask again.
- **A new film on the website.** It shows the latest Morse and stays under a minute.
- **No more Chrome extension.** The Morse app opens websites the way it opens
  apps: pick Chrome, Edge, Brave, Arc or Vivaldi in the Morse app and it opens
  with Morse, so your mods and your style work on every site. Nothing to
  install in the browser, nothing to pair.
- **Still signed in to everything.** A browser opens with Morse on a copy of
  your everyday profile: sign-ins, saved passwords, tabs and extensions come
  along the first time (a clone on a Mac), and new sign-ins every time after.
  Your everyday profile is only read. With **Always open with Morse**, a
  browser opened from the Dock opens again with Morse when you have website
  mods on.
- **Glass on a Mac.** The Morse app's sidebar and first run show the Mac's own
  translucent material, like Zephium's window.
- **Undo for Delete and for going back.** Deleting a mod, in the Mods panel
  or in the Morse app's Mods list, shows Undo, and the mod comes back as it
  was, history and all. Bringing back an older version shows Undo too.
- **Smarter changes at the same speed.** Every change uses Opus (Claude Code or
  an Anthropic key): it thinks briefly for small changes and longer for new
  features, new looks and second tries.
- **The model sees what you see.** A picture of the app, around what you
  pointed at, goes with your words, so what it adds matches the app: its dark
  or light mode, colors, fonts and spacing.
- **The Morse app updates itself.** It checks for a new version at start and
  every 4 hours, downloads it in the background, checks it against the
  release's checksums, and puts it in when no app is connected or when you
  quit Morse.
- **The Morse app finds Claude Code and Codex on a Mac** when it's opened from
  Finder or the Dock, not only from a terminal.
- **Open the bar**, beside each connected app in the Morse app, opens Morse's
  bar in that app when the shortcut does nothing (another app may own ⌥Space).
- **Your mods are always there.** Open an app with mods from the Dock, Finder
  or the Start menu, and the Morse app opens it again with Morse a moment
  later. **Always open with Morse** is on unless you turn it off; Morse opens
  at login for it.
- **A new first run.** Morse's name forms out of dots with a short sound, then
  three short steps: the AI Morse found, how it works, and an app to try. It
  follows [Zephium](https://github.com/zephium-browser/zephium)'s first run;
  the dots and the sound are Zephium's (Mozilla Public License 2.0).
- **A change that does nothing never says it's done.** Morse learns what
  moves on the page by itself (a song's elapsed time) before a change, so a
  change that did nothing is caught and tried again; if it still does
  nothing, it comes off and Morse says so.
- **New things line up.** Morse measures whether what a change adds sits in
  the middle of its row, and fixes it when it doesn't.
- **A calmer bar.** No step-by-step tips on top of the bar, a one-line "first
  change" card, and only Save and Undo after a change (Edit code and Share
  are in ⋯).
- **Typing after you pick something is easier.** The page stops lighting up
  under the mouse once something is chosen; click something else to choose
  that instead.
- **One working animation**, over what's changing, instead of three.
- **Faster voice** with a whisper on your computer: it transcribes once when
  you stop, on every core, instead of again and again while you talk.

## 0.2.0 (2026-10-25)

Version 0.2.0, the first version for other people to install.

### Getting Morse

- **One app.** Morse is the Morse app: download it, open it, done. It finds
  Claude Code or Codex by itself, lists your apps with their own icons and
  opens them with Morse. Nobody needs Node, npm or a terminal. Its first
  screen: the model it will use, your apps, and **Use Morse in Chrome too**.
- **Morse in Chrome gets its model from the Morse app.** Its welcome page
  finds the app and asks it by itself: you click **Allow** in the app, and
  that's all. Without the app, it shows one button, **Download Morse** (and
  **Not now: try a sample**). The question "websites, desktop apps or
  both", the API key and the terminal command left the welcome page; the
  popup and the welcome page keep them for developers, under **Developer**
  and `?dev`.
- **Use Morse in Chrome** in the Morse app: until Morse is in the Chrome Web
  Store, it copies the extension to **Morse for Chrome** in your home
  folder, shows it, opens Chrome on its extensions page, and shows one
  picture of where to click (Developer mode, Load unpacked). With a store
  listing, it opens that page instead.
- The Morse app's window is in your language (the nine languages Morse has).
- The website and the README say the same: **Download Morse**, then (for
  websites) Use Morse in Chrome. The `morse` command is in "For developers".
- The Morse app has one download for each computer (Mac, Windows, Linux),
  rebuilt from `main` on every change, in the `preview` release.
- For developers: `morse setup --auto` and `morse doctor --offline` are new.

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
- Morse: an app for your computer, so you don't need a terminal or
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
  you connect in one click. With Morse open, click **Use Claude
  Code**, and Morse asks you to Allow. No code to type, no terminal.
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

### Known issues

- On a page that keeps adding and removing content (a chat, a live feed), a
  mod that watches it can hold on to the items the page dropped, so memory
  grows over a long session. Reloading the page frees it. [Details](docs/perf/soak.md).
- The macOS and Windows apps are not signed yet. The first time, open Morse,
  then System Settings, Privacy & Security, Open Anyway (Mac), or More info,
  Run anyway (Windows).
- Morse on macOS and Windows was only checked by GitHub's build machines, not
  on a real computer.

## 0.1.0

A first working version for local models: point, describe, and a model on
your computer rewrote the page. Replaced by 0.2.0, which uses the model you
already have.
