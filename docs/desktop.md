# Morse in desktop apps

Many desktop apps are web pages inside a window. VSCodium, Obsidian and
Joplin are built this way, on **Electron**, and so are many others. Morse
changes these apps the same way it changes websites. Point at something, say
what you want, and save it.

This page shows how to do that, what Morse does to the app (and what it
doesn't), and which apps can't work.

If you'd rather not use a terminal, [Morse Desktop](desktop-app.md) does the
same in a window. It lists your apps, opens them with Morse and disconnects
them.

![Tunes, a real Electron app, with the Morse bar open](screenshots/121-electron-bar.png)

## The short version

```bash
morse apps                 # what Morse found, and whether it can connect
morse launch obsidian      # opens Obsidian with Morse connected
```

Then, in the app, press **Ctrl+Shift+Space** (**⌥Space** on a Mac). The Morse
bar opens. Point at the part you want to change, type what you want, and press
**Enter**. If you like the result, press **Enter** again to save it.

Next time you open the app with `morse launch`, your changes come back.

## Step by step

### 1. Find your app

```bash
morse apps
```

Morse looks where apps are usually installed:

- **Mac:** `/Applications` and `~/Applications`.
- **Windows:** your user's app folders, Program Files and the Start menu.
- **Linux:** `PATH`, `/opt`, snap, flatpak and the app menu. It also finds
  AppImages in `~/Applications`, `~/Downloads` and `~/.local/bin`, and ones
  an installer added to the app menu.

There's more for [macOS](#macos) and [Windows](#windows) below. Each app gets
one line:

- **●** Morse can connect to it.
- **○ can't connect** and why, for example "native app, not built on web technology".
- **◌** Morse couldn't tell what it's built on. You can still try.

If your app is somewhere else, give its path instead of its name:
`morse launch "/path/to/My App"`.

### 2. Open it with Morse

```bash
morse launch vscodium
```

Names don't have to be exact. `codium`, `vs codium` and `vscodium` all find
VSCodium.

Morse can only connect to an app when the app starts. If it is already open,
Morse asks whether to quit it and open it again. Answer **a** (always), and it
won't ask again for that app. Or add `--restart`.

Morse stays connected while `morse launch` runs. It prints a line for each
window it connects to. That includes windows that open later, side panels and
embedded views.

### 3. Change something

In the app:

1. Press **Ctrl+Shift+Space** (**⌥Space** on a Mac). The bar opens.
2. Move the mouse over the part you want to change. Click it.
3. Type what you want, like "add a sleep timer" or "make this list more compact".
4. Press **Enter**. You see the change while the model writes it.
5. Press **Enter** to save it, or **Undo** to put the app back.

**Alt+Shift+M** opens the Mods panel. There you can turn your changes on and
off, see their code, share them or delete them.

| | |
|---|---|
| ![](screenshots/122-electron-working.png) Morse writes the change and shows where | ![](screenshots/123-electron-result.png) The result: a sleep timer button (☾) next to the player |
| ![](screenshots/124-electron-mod-back.png) Quit the app and open it again: the change is back | ![](screenshots/125-electron-mods-panel.png) The Mods panel in the app |

### 4. Check and stop

```bash
morse status          # which apps Morse is connected to, their windows, and the changes on in each
morse stop obsidian   # disconnect; the app keeps running, your changes come off until next time
```

Ctrl+C in the terminal where `morse launch` runs does the same as
`morse stop`. Quitting the app also ends `morse launch`. Add `--watch` to keep
waiting and connect again when the app comes back.

| | |
|---|---|
| ![](screenshots/80-apps.png) **`morse apps`**: what's installed, and whether Morse can connect to it | ![](screenshots/81-status.png) **`morse status`**: windows, pop-ups and the mods on in each, and an app started with `--watch` waiting to come back |

### What Morse follows in an app

Morse connects to every place the app shows a page. That means all its
windows, pop-ups that open later, side panels and embedded views (like
VSCodium's panels). It keeps up when a window reloads, goes to another page or
crashes. A mod saved in one window shows up in every window it fits.

It leaves alone what isn't the app's own: embedded pages from other sites,
the developer tools, and the app's internal pages.

When the app is already open, Morse says so and offers `--restart`. It
remembers your answer for that app (in `~/.morse/apps.json`). `--no-restart`
forgets it.

### An app that is already running with a debugging port

If you started the app yourself with `--remote-debugging-port=9222`, connect
to it without a restart:

```bash
morse attach --port 9222 --app Obsidian
```

`--app` names the app, so your changes are saved for it.

## What Morse does to the app

- **It restarts the app with one extra switch**, `--remote-debugging-port`.
  Every Chromium-based app understands it. The port only listens on this
  computer. Morse checks that, and checks that the app that answers is the one
  it started.
- **It never changes the app's files.** Signed apps stay signed. Apps that
  check their own files still pass that check. App updates don't undo
  anything.
- **Your changes live in your Morse folder** (`~/.morse/mods`), in a folder
  for each app. A change made in Obsidian only ever runs in Obsidian.
- **The app's own code can't see Morse.** Morse runs in a separate space in
  each window. Your changes run in the page so they can work with it, but the
  page can't reach Morse or your model.
- When you stop Morse, it takes its bar and your changes off every open
  window. The app keeps running. Its debugging port closes when you quit the
  app.

## Which apps can't work, and why

**Native apps.** Morse changes web pages. Apps that aren't built from web
pages have no page to change: Finder, System Settings, most built-in macOS and
Windows apps, Microsoft Office, and native apps like ChatGPT for Mac.
`morse apps` marks them "can't connect".

**Apps that turn off or block the debugging switch.** Morse needs the app to
open its debugging port when it starts. A few apps remove that switch, quit
when they see it, or start through a launcher that drops it (some Microsoft
Store apps on Windows). Then `morse launch` says the app "never opened its
debugging port". Morse can't safely get around that. The only other way in is
to change the app's files.

**AppImages on Linux.** An AppImage is a whole app packed into one file.
Morse opens it like any other app. Some computers can't mount AppImages
because they have no FUSE (a fresh Ubuntu 24.04, for example). Then Morse has
the AppImage unpack itself first, so it takes longer to open. `morse fuses`
can't look inside an AppImage, and says so.

**Electron fuses.** Electron apps can turn off some features when they are
built, with "fuses". Run this to see an app's fuses:

```bash
morse fuses vscodium
```

No fuse turns off the debugging port, so fuses alone never stop Morse. This
was tested on a real Electron app with every fuse that could matter turned
off: no running as plain Node.js, no `--inspect`, no `NODE_OPTIONS`, only
loading the app from its archive, cookie encryption on. Morse still connected
and worked. Here is what fuses do change:

- **`--inspect` fused off**: you can't debug the app's background Node.js
  process. Morse doesn't use it. Your changes run in the app's windows.
- **The app checks its own files** (ASAR integrity): fine, Morse never
  changes them.

**Running as root on Linux.** Electron and Chromium apps won't start as the
root user while their sandbox is on. `morse launch` tells you when that
happens. Run Morse as your own user. If you must use root, add
`-- --no-sandbox`. This turns the app's sandbox off.

**Apps you can't restart.** Morse can only connect when the app starts. If an
app is in the middle of something you can't lose, wait. Use
`morse launch --restart` when it's a good moment.

**Things the app does in its background process.** Morse changes what you see
in the app's windows: layout, buttons, text, new controls, keyboard shortcuts
in the page. It can't change the app's menus, tray icon, notifications or
files on disk, because those live outside the windows.

## Tips

- If the app has a shortcut that clashes with **Ctrl+Shift+Space**, change
  Morse's shortcut in the bar's settings (the slider icon).
- `morse launch <app> -- <switches>` passes extra switches to the app. For
  example, `-- --user-data-dir=/tmp/test-profile` opens a separate profile.
  Morse ignores switches that would let other computers reach the debugging
  port.
- `morse pause obsidian` turns off every change in Obsidian without deleting
  them. `morse resume obsidian` turns them back on.

## macOS

> **Not tested on a real Mac yet.** Everything in this section is built and
> checked against copies of real app folders on Linux. If you have a Mac, the
> [15-minute check](dev/platform-testing.md) says what to try. Open an issue
> with what you saw.

### What to do

1. Install Node.js 22 or newer. Then install Morse: `npm install -g morse-cli`.
2. Open each app you want to change once from Finder or Launchpad, then quit
   it. A Mac checks a downloaded app the first time you open it. Morse starts
   apps from the terminal, where that first check can stop the app instead of
   asking you.
3. Run `morse apps`. It lists the apps in `/Applications`,
   `/Applications/Utilities` and `~/Applications`.
4. Run `morse launch obsidian --restart`. If Obsidian is open, Morse asks it to
   quit, the same as pressing ⌘Q. The first time, macOS asks whether your
   terminal may control Obsidian. Click **OK**. Morse only uses this to ask
   the app to quit. If you say no, Morse stops the app at once instead, which
   can lose its window layout.
5. In the app, press **⌥Space**. The Morse bar opens.

`morse doctor` shows your macOS version, whether your Morse folder
(`~/.morse`) is private, and your shortcut.

### What Morse does on a Mac

- **It reads each app's own description** (`Contents/Info.plist`): its name,
  version and the program inside it. An app built on Electron has
  `Electron Framework` in `Contents/Frameworks`, which also gives the
  Electron version. Some apps have `Chromium Embedded Framework` instead.
  Apps with neither are native. `morse apps` leaves them out, or marks them
  "can't connect" when it knows their name (ChatGPT).
- **It starts the program inside the app**, like
  `Obsidian.app/Contents/MacOS/Obsidian`, with the debugging switch. It
  doesn't use `open -a`. That drops the switch when the app is already open,
  and doesn't say which program it started.
- **It never changes the app.** Every Mac app is signed. Changing any file in
  it (including the fuses in `Electron Framework`) breaks the signature. Then
  macOS won't open the app. Morse only reads. Your changes live in `~/.morse`.
- **It needs no permissions.** Not Accessibility, not Screen Recording, not
  Input Monitoring. The shortcut works because Morse runs inside the app's
  own windows. Clips are recorded from the app's own window. The only
  question macOS asks is the one in step 4, and only for `--restart`.
- **Apple silicon and Intel.** Most apps carry both. `morse fuses` reads the
  fuses of both parts and says so if they differ.

### Things to know on a Mac

- **⌥Space taken.** Alfred, Raycast and the ChatGPT app often use ⌥Space, and
  they get the key before the app does. If the bar doesn't open, change
  Morse's shortcut in the bar's settings, or theirs.
- **Microphone and camera.** macOS can ask for the microphone for your
  terminal (not the app), because the terminal started the app. If an app
  asks for it during a call, allow it, or open the app the usual way for
  calls.
- **The menu bar, the Dock and notifications** stay the app's own. Morse
  changes what's in the app's windows.

### Other apps on a Mac (not tested)

These should work, as far as Morse can tell without a Mac. None of them has
been tried on one yet.

| App | Built on | What to expect |
|---|---|---|
| Slack | Electron | Only one copy can run, so use `--restart` when it's open. Closing its window doesn't quit it. |
| Discord | Electron | Its update check runs first. If Discord restarts itself after an update, Morse loses it. Run `morse launch discord` again. |
| Spotify | Chromium Embedded Framework | Not Electron. Apps built this way usually accept the debugging switch. If this Spotify release doesn't, `morse launch` says it "never opened its debugging port". |
| VS Code | Electron | Works on Linux (VSCodium). Its own protection against outside code stays on. |
| Notion | Electron | Should work like Slack. |
| Obsidian | Electron | Works on Linux. |
| Figma | Electron | Its panels and toolbars can change. The design itself is drawn as a picture, so Morse can't point at shapes in it. |

## Windows

> **Not tested on a real Windows PC yet.** Everything in this section is built
> and checked against copies of real install folders and shortcuts on Linux.
> If you have a Windows PC, the [15-minute check](dev/platform-testing.md)
> says what to try.

### What to do

1. Install Node.js 22 or newer from nodejs.org. Then, in PowerShell or
   Windows Terminal, run `npm install -g morse-cli`.
2. Run `morse apps`.
3. Run `morse launch obsidian --restart`.
4. In the app, press **Ctrl+Shift+Space**. The Morse bar opens.

`morse doctor` shows your Windows version and build, where your Morse folder
is, and whether Morse can see which apps are open.

### What Morse does on Windows

- **It finds apps** in these places:
  - `%LOCALAPPDATA%\Programs` (VSCodium, Obsidian and most apps that install
    without an administrator)
  - `%LOCALAPPDATA%` and `%APPDATA%`
  - Program Files, and the Start menu for everything else, including apps on
    other drives
- **Some apps keep one folder per version.** They install with Squirrel: an
  `Update.exe` and a folder like `app-4.41.105` for each version. Morse starts
  the app in the newest folder. If it only finds `Update.exe`, it asks
  `Update.exe` to start the app with the debugging switch. Then it finds the
  app by that switch. It waits up to 20 seconds while the app checks for
  updates.
- **Folders with spaces work.** Morse starts programs with a list of
  arguments, never by typing a command line. So `C:\Program Files` and
  `D:\Tools\Acme Chat` need no quotes.
- **`--restart`** asks each window of the app to close and waits up to 10
  seconds. Then it ends the app and every process it started. Some apps only
  hide in the tray when their window closes, so for them the second step is
  usual. It's the same as quitting from the tray icon.
- **No firewall question.** The app's debugging port and the Morse helper
  only listen on this computer, so Windows Firewall has nothing to ask.
- **Your Morse folder is `%USERPROFILE%\.morse`** (`C:\Users\you\.morse`).
  On macOS and Linux, Morse makes its files readable by you only. Windows
  doesn't use those settings. Instead, only you, administrators and Windows
  itself can open your user folder, and the Morse folder keeps those
  permissions. Morse doesn't change them. If you move the folder to a shared
  drive with `MORSE_HOME`, `morse doctor` warns you. Other people may be able
  to read your API keys there.
- **It never changes the app.** Most Windows apps are signed too. Morse only
  reads them.

### Things to know on Windows

- **Ctrl+Shift+Space** is the shortcut, because Alt+Space opens the window
  menu on Windows (and PowerToys Run). In VSCodium, Ctrl+Shift+Space also
  shows hints for a function. If that's what you see, change Morse's
  shortcut in the bar's settings.
- **Colors** show in Windows Terminal, PowerShell and the old console. Output
  saved to a file has none. `NO_COLOR=1` turns them off. In the old console,
  some fonts show the dots in `morse apps` as question marks. Windows
  Terminal's font has them.
- **Files you edit in Notepad still load**, whatever line endings Notepad
  uses. Morse writes its own files with Unix line endings, which every editor
  on Windows reads.
- **Microsoft Store versions** of apps run from a protected folder and may
  ignore the debugging switch. `morse apps` marks them. Install the app from
  its own website instead.
- **Apps built on Edge's WebView2** (the new Teams, the new Outlook,
  WhatsApp) aren't Chromium apps that Morse can start with the switch. Morse
  can't connect to them for now.

### Other apps on Windows (not tested)

As on the Mac, these should work. None has been tried on Windows yet.

| App | How it installs | What to expect |
|---|---|---|
| Slack | Squirrel, in `%LOCALAPPDATA%\slack` | Hides in the tray when closed, so `--restart` ends it after 10 seconds. |
| Discord | Squirrel, in `%LOCALAPPDATA%\Discord` | Its update check runs first. Morse waits for the real app. |
| Spotify | `%APPDATA%\Spotify` from spotify.com | Chromium Embedded Framework, not Electron. The Store version may not work. |
| VS Code | `%LOCALAPPDATA%\Programs\Microsoft VS Code`, or Program Files | Morse starts `Code.exe`, not the `code` command. |
| Notion | `%LOCALAPPDATA%\Programs\Notion` | Should work like Slack. |
| Obsidian | `%LOCALAPPDATA%\Programs\Obsidian` | Works on Linux. |
| Figma | Squirrel, in `%LOCALAPPDATA%\Figma` | Its panels and toolbars can change, not the design itself. |

### Fuses, on both

Electron apps can lock some features when they're built (`morse fuses <app>`
shows them). None of them turns off the debugging switch, so none of them
stops Morse:

- **`RunAsNode`**: when it's on and your terminal has
  `ELECTRON_RUN_AS_NODE` set, the app would start as plain Node.js with no
  window. Morse clears that setting (and `NODE_OPTIONS`) for the app it
  starts.
- **`EnableNodeCliInspectArguments`** off: you can't debug the app's
  background process with `--inspect`. Morse doesn't use it.
- **ASAR integrity** on: the app checks its own files. Morse never changes
  them.

What does stop Morse is an app that quits when it sees the debugging switch,
or ignores it. `morse launch` then says the app "never opened its debugging
port".

## Tested on

Real apps, downloaded from their official releases and installed the way
their own instructions say. The test machine ran Linux (Ubuntu 24.04 in a
container, as root, so each app had `-- --no-sandbox`). Each app was opened
with `morse launch` and changed with **Claude Code (haiku)**, using the real
shortcut, mouse and keyboard. Then the change was saved, the app quit, and
the app opened again with `morse launch`.

| App | How it was installed | What was asked | Result | Time | Back after reopening |
|---|---|---|---|---|---|
| VSCodium 1.140 (VS Code without Microsoft's name and logo, Electron 43) | its `.deb` | "make the status bar bigger" (pointing at it) | The status bar got taller (22 to 36 pixels) with bigger icons | 10.3 s, and 13.7 s on a second run | Yes, both times |
| Obsidian 1.14.5 (Electron 43) | its AppImage, in `~/Applications` | "hide this ribbon" (pointing at the left ribbon) | The ribbon is gone | 5.6 s, and 15.9 s on a second run | Yes, both times |
| Joplin 3.7.21 (Electron 42) | its AppImage, in `~/.joplin` with a menu entry, as its install script does | "hide this button, I don't use sync" (pointing at Synchronize) | The button is gone. Its code relies on names Joplin makes up when it builds, so a Joplin update may break it | 13.0 s | Yes |

`morse apps` found all three. `morse fuses` read VSCodium's fuses from its
program, and said it can't look inside the two AppImages. The time is from
pressing Enter to seeing the change. The test machine was very busy, so times
vary a lot between runs.

| | |
|---|---|
| ![](screenshots/147-vscodium-bar.png) VSCodium: pointing at the status bar | ![](screenshots/148-vscodium-status-bar-back.png) VSCodium opened again: the taller status bar is back |
| ![](screenshots/149-obsidian-bar.png) Obsidian: pointing at the ribbon | ![](screenshots/150-obsidian-ribbon-gone.png) Obsidian opened again: no ribbon |
| ![](screenshots/151-joplin-bar.png) Joplin: pointing at Synchronize | ![](screenshots/152-joplin-sync-hidden.png) Joplin: the Synchronize button is gone |

These apps turned up some problems. All are fixed now:

- **VSCodium's window refused Morse's bar.** VS Code only lets its own code
  put HTML into its window ("Trusted Types"). That rule blocked Morse too, so
  the bar never appeared. Morse now builds its bar piece by piece there. The
  rule still protects VS Code's own code.
- **`morse apps` didn't find VSCodium or the AppImages.** It now reads the app
  menu and looks for AppImages. VSCodium is in its list of known apps.
- **Obsidian's AppImage quit at once**, because the computer had no FUSE.
  Morse now has it unpack first.
- **Joplin quit with "Unknown flag"**, because Morse passed a second switch it
  didn't need. Morse now passes only the debugging port.
- **A saved change in an AppImage app wouldn't have come back.** An AppImage
  runs from a new folder each time, and Morse matched changes by the whole
  folder path. It now matches by the page inside the app.
- **The Mods panel said "Stops every mod on this site"** in an app. It now
  says "in this app".

Not tested: Microsoft's own VS Code, Slack, Discord, Signal and Spotify.
Their downloads aren't reachable from the test machine, or they need an
account. Also not tested: Flatpak and Snap installs, macOS, Windows, Wayland,
and signing in to anything. For what's ready on macOS and Windows and how to
check it, see [macOS](#macos) and [Windows](#windows).

### Websites

The same check on public websites, with the built Chrome extension in
Chromium 153 on Linux, paired with `morse serve` and Claude Code (haiku). Each
change was saved, then the page was reloaded.

| Site | What was asked | Result | Time | Back after a reload |
|---|---|---|---|---|
| pypi.org (strict rules for scripts) | "add a back to top button in the bottom right corner" | A round ↑ button. With “Allow User Scripts” off, the site blocked Morse's code. The model's second try was an arrow that only looks like a button (32 s) | 12.6 s | Yes |
| gitlab.com (strict rules, but code is allowed) | the same | The button works, with “Allow User Scripts” on or off | 12.3 s | Yes |
| gitlab.com | "hide this project information box" | Partly: it hid the description in the box, not the whole box | 7.8 s | Yes |
| pkg.go.dev | "make the code examples bigger" (pointing at one) | Bigger code text | 7.6 s | Yes |
| rubygems.org | "make the download numbers much bigger" (pointing at them) | The first try changed nothing. The second made the total downloads big | 8.3 s | Yes |
| hub.docker.com | "make these code blocks bigger with a dark background" | Bigger text on dark blocks | 11.6 s | Yes |
| nodejs.org (the docs) | "hide the left sidebar so the docs use the full width" | Failed three times: the whole page went blank. The model hid a style the sidebar and the docs share. Undo puts the page back | 10 to 26 s | (blank) |

Wikipedia, Hacker News, MDN, YouTube, the BBC and GitHub's pages weren't
tested. The test machine's network can't reach them.

| | |
|---|---|
| ![](screenshots/153-web-gitlab-back-to-top.png) GitLab: the back to top button (bottom right) | ![](screenshots/154-web-pypi-after-reload.png) PyPI after a reload: the button is still there |
| ![](screenshots/155-web-docker-hub-code.png) Docker Hub: bigger code on dark blocks | ![](screenshots/156-web-pypi-user-scripts-off.png) PyPI with “Allow User Scripts” off: only an arrow, which doesn't scroll |

You can run the same steps on any installed app with
[`demo/try-real-app.js`](../demo/try-real-app.js). For websites, use
[`demo/try-real-sites.js`](../demo/try-real-sites.js) and
[`demo/real-sites.json`](../demo/real-sites.json).

## How this was tested

Morse was tested on a real Electron 45 on Linux, with a small music app built
for it: [`demo/electron-app`](../demo/electron-app) ("Tunes"). It has what
real apps have: a native menu bar, a preload script with context isolation
and the renderer sandbox on, its UI on a custom `app://` address, a
`<webview>` side panel served from a random local port, a second window from a
`file://` page, and a single-instance lock. It is packaged the way apps ship:
Electron renamed to `tunes`, with the app next to it, unpacked or as
`app.asar`.

- [`demo/shoot-electron.js`](../demo/shoot-electron.js) runs the whole flow
  with real keyboard and mouse input from the X server (xdotool) and takes the
  screenshots above: `morse launch`, the shortcut, pointing, a change, Save,
  quitting with the app's own Ctrl+Q, `morse launch` again (the change is
  back), the Mods panel, the second window, `morse status`, `morse stop` and
  `morse fuses`.
- It ran with the test model, and once with **real Claude Code (haiku)**.
  Haiku built a working "Sleep: off / 15 / 30 / 60 min" picker in about 10
  seconds. That run found a real problem: haiku's first try asked for the
  minutes with `prompt()`, which Electron doesn't support. Morse now tells the
  model not to use it. In a second run for the pictures below (October 24),
  haiku built a sleep timer picker under the player in about 4 seconds.
- The same app ran as a normal user with Chromium's sandbox fully on, and
  Morse connected with `morse attach --port`.
- [`tests/electron.test.js`](../tests/electron.test.js) runs the flow on every
  `npm test` when Electron and a display are there. Otherwise it skips and
  says why. To set it up:

  ```bash
  npm install --prefix ~/.cache/morse/electron electron
  node ~/.cache/morse/electron/node_modules/electron/install.js   # only if dist/ is missing
  DISPLAY=:99 node --test tests/electron.test.js
  ```

| | |
|---|---|
| ![](screenshots/126-electron-haiku-working.png) Claude Code (haiku) writing the change | ![](screenshots/127-electron-haiku-result.png) Its result: a sleep timer picker under the player |

Real installed apps (VSCodium, Obsidian, Joplin) are under
[Tested on](#tested-on). Not tested: Slack, Discord, Microsoft's VS Code,
Spotify, macOS, Windows and Wayland. The macOS and Windows parts were tested
on Linux against copies of real app folders and real file formats
([`tests/platforms.test.js`](../tests/platforms.test.js)), not on the real
systems. That covers reading `.app` bundles, Squirrel installs and Start menu
shortcuts, quitting with AppleScript or taskkill, starting apps, and the fuses
in a Mac app.
