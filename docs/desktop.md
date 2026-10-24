# Morse in desktop apps

Many desktop apps are web pages inside a window. Slack, Discord, VS Code,
Obsidian, Notion, Figma, Signal and Spotify are all built this way, on
**Electron** or on Chromium. Morse can change those apps the same way it
changes websites: you point at something, say what you want, and keep it.

This page explains how to do that, what Morse does to the app (and what it
doesn't), and which apps can't work.

![Tunes, a real Electron app, with the Morse bar open](screenshots/121-electron-bar.png)

## The short version

```bash
morse apps                 # what Morse found, and whether it can connect
morse launch spotify       # opens Spotify with Morse connected
```

Then, in the app, press **Ctrl+Shift+Space** (**⌥Space** on a Mac). The Morse
bar opens. Point at the part you want to change, type what you want, and press
**Enter**. When you like the result, press **Enter** again to save it.

Next time you open the app with `morse launch`, your changes come back by
themselves.

## Step by step

### 1. Find your app

```bash
morse apps
```

Morse looks where apps are usually installed: `/Applications` and
`~/Applications` on a Mac, your user's app folders, Program Files and the
Start menu on Windows, and `PATH`, `/opt`, snap, flatpak and the app menu on
Linux. There's more for [macOS](#macos) and [Windows](#windows) below. On Linux it also finds AppImages in
`~/Applications`, `~/Downloads` and `~/.local/bin`, and ones an installer added
to the app menu. Each app gets one line:

- **●** Morse can connect to it.
- **○ can't connect** and why, for example "native app, not built on web technology".
- **◌** Morse couldn't tell what it's built on. You can still try.

If your app is somewhere else, give its path instead of its name:
`morse launch "/path/to/My App"`.

### 2. Open it with Morse

```bash
morse launch slack
```

Names don't have to be exact: `code`, `vs code` and `vscode` all find VS Code.

Morse can only connect to an app when the app starts, so if it is already
open, Morse asks whether to quit it and open it again. Say **a** (always) and
it won't ask again for that app. Or pass `--restart`.

While `morse launch` runs, Morse is connected. It prints a line for each
window it connects to, including windows that open later, side panels and
embedded views.

### 3. Change something

In the app:

1. Press **Ctrl+Shift+Space** (**⌥Space** on a Mac). The bar opens.
2. Move the mouse over the part you want to change. Click it.
3. Type what you want, like "add a sleep timer" or "make this list more compact".
4. Press **Enter**. You see the change happen while the model writes it.
5. Press **Enter** to save it, or **Undo** to put the app back.

**Alt+Shift+M** opens the Mods panel, where you can turn your changes on and
off, see their code, share them or delete them.

| | |
|---|---|
| ![](screenshots/122-electron-working.png) Morse writes the change and shows where | ![](screenshots/123-electron-result.png) The result: a sleep timer button (☾) next to the player |
| ![](screenshots/124-electron-mod-back.png) Quit the app and open it again: the change is back | ![](screenshots/125-electron-mods-panel.png) The Mods panel in the app |

### 4. Check and stop

```bash
morse status        # which apps Morse is connected to, their windows, and the changes on in each
morse stop slack    # disconnect; the app keeps running, your changes come off until next time
```

Pressing Ctrl+C in the terminal where `morse launch` runs does the same as
`morse stop`. Quitting the app also ends `morse launch`. Add `--watch` to keep
waiting and connect again when the app comes back.

| | |
|---|---|
| ![](screenshots/80-apps.png) **`morse apps`**: what's installed, and whether Morse can connect to it | ![](screenshots/81-status.png) **`morse status`**: windows, pop-ups and the mods on in each, and an app started with `--watch` waiting to come back |

### What Morse follows in an app

Morse connects to every place the app shows a page: all its windows, pop-ups
that open later, side panels and embedded views (like VS Code's panels). It
keeps up when a window reloads, goes to another page or crashes. A mod saved
in one window shows up in every window it fits.

It leaves alone what isn't the app's own: embedded pages from other sites,
the developer tools, and the app's internal pages.

When the app is already open, Morse says so in one sentence and offers
`--restart`. Your answer is remembered for that app (in `~/.morse/apps.json`);
`--no-restart` forgets it.

### An app that is already running with a debugging port

If you (or a script) started the app yourself with
`--remote-debugging-port=9222`, connect to it without restarting it:

```bash
morse attach --port 9222 --app Slack
```

`--app` names the app, so your changes are saved for it.

## What Morse does to the app

- **It restarts the app with one extra switch**, `--remote-debugging-port`,
  which every Chromium-based app understands. The port only listens on this
  computer. Morse checks that, and checks that what answers is the app it
  started.
- **It never changes the app's files.** Signed apps stay signed, apps that
  check their own files keep passing that check, and app updates don't undo
  anything.
- **Your changes live in your Morse folder** (`~/.morse/mods`), filed under
  the app. A change made in Slack is only ever loaded in Slack.
- **The app's own code can't see Morse.** Morse runs in a separate space in
  each window. Your changes run in the page so they can work with it, but the
  page can't reach Morse or your model.
- When you stop Morse, it takes its bar and your changes off every open
  window. The app keeps running. Its debugging port closes when you quit it.

## Changes to what an app does

Most changes are about how an app looks. Some are about what it does: "add a
button that formats my document", "when I open a note, copy its name", "make
Ctrl+Shift+K copy the line instead of deleting it". For these, Morse needs to
know how the app works inside, not only what is on the screen.

So the first time you open a desktop app with Morse, it reads how the app is
put together, in the background:

- the app's own commands, with their names (VS Code has over two thousand:
  Format Document, Save, Duplicate Selection…; Obsidian and Joplin have their
  own), and how to run them;
- how its windows talk to the rest of the app;
- what its main buttons do.

This takes a few seconds, and you can use Morse while it happens. Morse keeps
what it learned in your Morse folder (`~/.morse/profiles`), so the next time
it is ready at once. When the app updates, Morse reads it again.

When you ask for a change to what the app does, Morse gives your model the
few commands and parts of the app that fit your request. Your change can then
run the app's own commands, the same ones its menus and shortcuts run,
instead of guessing at buttons and keys.

- **Morse only reads.** It never changes the app's files (the tests check
  every file before and after), and it never replaces the app's own code. A
  change adds to what the app does; turning it off takes that away again.
- **Your request decides.** A change to how something looks doesn't need any
  of this, so Morse leaves it out.
- To see what Morse found in an app, run `morse profile code` (or any app's
  name). To try Morse without it, start it with `MORSE_PROFILE=off`.

PROFILE_TRIES

## Which apps can't work, and why

**Native apps.** Morse changes web pages. Apps that aren't drawn with web
technology have no page to change: Finder, System Settings, most built-in
macOS and Windows apps, Microsoft Office, and native apps like ChatGPT for Mac.
`morse apps` marks them "can't connect".

**Apps that turn off or block the debugging switch.** Morse needs the app to
open its debugging port when it starts. A few apps remove that switch, quit
when they see it, or start through a launcher that drops it (some Microsoft
Store apps on Windows). Then `morse launch` says the app "never opened its
debugging port". There is nothing Morse can safely do about that, because the
only other way in would be changing the app's files.

**AppImages on Linux.** An AppImage is the whole app packed into one file.
Morse opens it the same way as any other app. If your computer can't mount
AppImages (it has no FUSE, as on a fresh Ubuntu 24.04), Morse has the AppImage
unpack itself first. It then takes longer to open. `morse fuses` can't look
inside an AppImage, and says so.

**Electron fuses.** Electron apps can switch off some features when they are
built, using "fuses". Run this to see an app's fuses:

```bash
morse fuses slack
```

None of the fuses turn off the debugging port, so fuses alone never stop
Morse. This was checked on a real Electron app with every fuse that could
matter turned off: no running as plain Node.js, no `--inspect`, no
`NODE_OPTIONS`, only loading the app from its archive, cookie encryption on.
Morse still connected and worked. What fuses do change:

- **`--inspect` fused off**: the app's background Node.js process can't be
  debugged. Morse doesn't use it. Your changes run in the app's windows.
- **The app checks its own files** (ASAR integrity): fine, Morse never
  changes them.

**Running as root on Linux.** Electron and Chromium apps refuse to start as
the root user while their sandbox is on. `morse launch` tells you when that
happens. Run Morse as your own user. If you really must use root, add
`-- --no-sandbox`, which turns the app's sandbox off.

**Apps you can't restart.** Morse can only connect when the app starts. If an
app is in the middle of something you can't lose, wait, or use
`morse launch --restart` when it's a good moment.

**Things the app does in its background process.** Morse changes what you see
in the app's windows: layout, buttons, text, new controls, keyboard shortcuts
in the page. It can't change the app's menus, tray icon, notifications or
files on disk, because those live outside the windows.

## Tips

- If the app has a shortcut that clashes with **Ctrl+Shift+Space**, change
  Morse's in the bar's settings (the slider icon).
- `morse launch <app> -- <switches>` passes extra switches to the app, for
  example `-- --user-data-dir=/tmp/test-profile` for a separate profile.
  Morse ignores switches that would let other computers reach the debugging
  port.
- `morse pause slack` turns off every change in Slack without deleting them.
  `morse resume slack` turns them back on.

## macOS

> **Not yet tested on real hardware.** Everything in this section is built
> and checked against copies of real app folders on Linux, not on a Mac. If
> you have a Mac, the [15-minute check](dev/platform-testing.md) says what to
> try, and an issue with what you saw helps everyone.

### What to do

1. Install Node.js 22 or newer, then Morse: `npm install -g morse-cli`.
2. Open each app you want to change once the usual way, from Finder or
   Launchpad, then quit it. A Mac checks an app you downloaded the first time
   you open it. Morse starts apps from the terminal, where that first check
   can stop the app instead of asking you.
3. Run `morse apps`. It lists the apps in `/Applications`,
   `/Applications/Utilities` and `~/Applications`.
4. Run `morse launch slack --restart`. If Slack is open, Morse asks it to
   quit, the same as pressing ⌘Q. The first time, macOS asks whether your
   terminal may control Slack. Say **OK**: Morse only uses it to ask the app
   to quit. If you say no, Morse tells the app to stop at once instead,
   which can lose its window layout.
5. In the app, press **⌥Space**. The Morse bar opens.

`morse doctor` shows your macOS version, whether your Morse folder
(`~/.morse`) is private, and your shortcut.

### What Morse does on a Mac

- **It reads each app's own description** (`Contents/Info.plist`): its name,
  version and the program inside it. An app built on Electron has
  `Electron Framework` in `Contents/Frameworks`, which also says which
  Electron version. Spotify's has `Chromium Embedded Framework` instead.
  Apps with neither are native: `morse apps` leaves them out, or marks them
  "can't connect" when it knows their name (ChatGPT).
- **It starts the program inside the app**, like
  `Slack.app/Contents/MacOS/Slack`, with the debugging switch. It doesn't use
  `open -a`: that drops the switch when the app is already open, and doesn't
  say which program it started.
- **It never changes the app.** Every Mac app is signed. Changing any file in
  it (the fuses in `Electron Framework` included) breaks the signature, and
  macOS then refuses to open the app. Morse only reads. Your changes live in
  `~/.morse`.
- **It needs no permissions.** Not Accessibility, not Screen Recording, not
  Input Monitoring. The shortcut works because Morse runs inside the app's
  own windows, and clips are recorded from the app's own window. The only
  question macOS asks is the one in step 4, and only for `--restart`.
- **Apple silicon and Intel.** Most apps carry both. `morse fuses` reads the
  fuses of both parts and says so if they differ.

### Things to know on a Mac

- **⌥Space taken.** Alfred, Raycast and the ChatGPT app often use ⌥Space
  themselves, and they get the key before the app does. If the bar doesn't
  open, change Morse's shortcut in the bar's settings, or theirs.
- **Microphone and camera.** macOS can ask for the microphone on behalf of
  your terminal (not the app), because the terminal started the app. If a
  call in Slack or Discord asks for that, allow it, or open the app the usual
  way for calls.
- **The menu bar, the Dock and notifications** stay the app's own. Morse
  changes what's in the app's windows.

### Popular apps on a Mac

All of these should work, as far as Morse can tell without a Mac. None of
them has been tried on one yet.

| App | Built on | What to expect |
|---|---|---|
| Slack | Electron | Only one copy can run, so use `--restart` when it's open. Closing its window doesn't quit it. |
| Discord | Electron | Its update check runs first. If Discord restarts itself after an update, Morse loses it: run `morse launch discord` again. |
| Spotify | Chromium Embedded Framework | Not Electron. Apps built this way usually accept the debugging switch. If this Spotify release doesn't, `morse launch` says it "never opened its debugging port". |
| VS Code | Electron | Works on Linux (VSCodium). Its own protection against outside code is kept on. |
| Notion | Electron | Should work like Slack. |
| Obsidian | Electron | Works on Linux. |
| Figma | Electron | The panels and toolbars can change. The design itself is drawn as a picture, so Morse can't point at shapes in it. |

## Windows

> **Not yet tested on real hardware.** Everything in this section is built
> and checked against copies of real install folders and shortcuts on Linux,
> not on Windows. If you have a Windows PC, the
> [15-minute check](dev/platform-testing.md) says what to try.

### What to do

1. Install Node.js 22 or newer from nodejs.org, then, in PowerShell or
   Windows Terminal: `npm install -g morse-cli`.
2. Run `morse apps`.
3. Run `morse launch slack --restart`.
4. In the app, press **Ctrl+Shift+Space**. The Morse bar opens.

`morse doctor` shows your Windows version and build, where your Morse folder
is, and whether Morse can see which apps are open.

### What Morse does on Windows

- **It finds apps** in `%LOCALAPPDATA%\Programs` (VS Code, Obsidian, Notion
  and most apps that install without asking for an administrator),
  `%LOCALAPPDATA%` (Slack, Discord, Figma), `%APPDATA%` (Spotify), Program
  Files, and the Start menu, for everything else, including apps on other
  drives.
- **Slack, Discord and Figma keep one folder per version.** They install
  with Squirrel: an `Update.exe` and a folder like `app-4.41.105` for each
  version. Morse starts the app in the newest folder. If it only finds
  `Update.exe`, it asks `Update.exe` to start the app with the debugging
  switch, then finds the app by that switch, and waits up to 20 seconds while
  the app checks for updates first.
- **Folders with spaces just work.** Morse starts programs with a list of
  arguments, never by typing a command line, so `C:\Program Files` and
  `D:\Tools\Acme Chat` need no quotes.
- **`--restart`** asks each window of the app to close, waits up to 10
  seconds, then ends the app and every process it started. Slack and Discord
  only hide in the tray when their window closes, so for them the second step
  is usual. It's the same as quitting from the tray icon.
- **No firewall question.** The app's debugging port and the Morse helper
  only listen on this computer, so Windows Firewall has nothing to ask about.
- **Your Morse folder is `%USERPROFILE%\.morse`** (`C:\Users\you\.morse`).
  On macOS and Linux, Morse makes its files readable by you only. Windows
  doesn't use those settings. Instead, your user folder can only be opened by
  you, administrators and Windows itself, and the Morse folder keeps those
  permissions. Morse doesn't change them. If you move the folder with
  `MORSE_HOME` to a shared drive, `morse doctor` warns you, because other
  people may be able to read your API keys there.
- **It never changes the app.** Most Windows apps are signed too, and Morse
  only reads them.

### Things to know on Windows

- **Ctrl+Shift+Space**, because Alt+Space opens the window menu on Windows
  (and PowerToys Run). In VS Code, Ctrl+Shift+Space also shows hints for a
  function. If that's what you see, change Morse's shortcut in the bar's
  settings.
- **Colors** show in Windows Terminal, PowerShell and the old console. Output
  saved to a file has none, and `NO_COLOR=1` turns them off. In the old
  console, some fonts show the dots in `morse apps` as question marks.
  Windows Terminal's font has them.
- **Files you edit in Notepad still load**, whatever line endings Notepad
  saves with. Morse writes its own files with Unix line endings, which every
  editor on Windows reads.
- **Microsoft Store versions** (Spotify from the Store) run from a protected
  folder and may ignore the debugging switch. `morse apps` marks them.
  Install the app from its own website instead.
- **Apps built on Edge's WebView2** (the new Teams, the new Outlook,
  WhatsApp) aren't Chromium apps Morse can start with the switch. Morse can't
  connect to them for now.

### Popular apps on Windows

As on the Mac: all of these should work, and none has been tried on Windows
yet.

| App | How it installs | What to expect |
|---|---|---|
| Slack | Squirrel, in `%LOCALAPPDATA%\slack` | Hides in the tray when closed, so `--restart` ends it after 10 seconds. |
| Discord | Squirrel, in `%LOCALAPPDATA%\Discord` | Its update check runs first. Morse waits for the real app. |
| Spotify | `%APPDATA%\Spotify` from spotify.com | Chromium Embedded Framework, not Electron. The Store version may not work. |
| VS Code | `%LOCALAPPDATA%\Programs\Microsoft VS Code`, or Program Files | Morse starts `Code.exe`, not the `code` command. |
| Notion | `%LOCALAPPDATA%\Programs\Notion` | Should work like Slack. |
| Obsidian | `%LOCALAPPDATA%\Programs\Obsidian` | Works on Linux. |
| Figma | Squirrel, in `%LOCALAPPDATA%\Figma` | The panels and toolbars can change, not the design itself. |

### Fuses, on both

Electron apps can lock some features when they're built (`morse fuses <app>`
shows them). None of them turns off the debugging switch, so none of them
stops Morse:

- **`RunAsNode`**: when it's on and your terminal has
  `ELECTRON_RUN_AS_NODE` set, the app would start as plain Node.js with no
  window. Morse clears that setting (and `NODE_OPTIONS`) for the app it
  starts.
- **`EnableNodeCliInspectArguments`** off: the app's background process
  can't be debugged with `--inspect`. Morse doesn't use it.
- **ASAR integrity** on: the app checks its own files. Morse never changes
  them.

What does stop Morse is an app that quits when it sees the debugging switch,
or ignores it. `morse launch` then says the app "never opened its debugging
port".

## Tested on

Real apps, downloaded from their official releases and installed the way their
own instructions say, on Linux (Ubuntu 24.04 in a container, running as root,
so each had `-- --no-sandbox`). Each was opened with `morse launch`, changed
with **Claude Code (haiku)** using the real shortcut, mouse and keyboard, saved,
quit, and opened again with `morse launch`.

| App | How it was installed | What was asked | Result | Time | Back after reopening |
|---|---|---|---|---|---|
| VSCodium 1.140 (VS Code without Microsoft's branding, Electron 43) | its `.deb` | "make the status bar bigger" (pointing at it) | The status bar got taller (22 to 36 pixels) with bigger icons | 10.3 s, and 13.7 s on a second run | Yes, both times |
| Obsidian 1.14.5 (Electron 43) | its AppImage, in `~/Applications` | "hide this ribbon" (pointing at the left ribbon) | The ribbon is gone | 5.6 s, and 15.9 s on a second run | Yes, both times |
| Joplin 3.7.21 (Electron 42) | its AppImage, in `~/.joplin` with a menu entry, as its install script does | "hide this button, I don't use sync" (pointing at Synchronize) | The button is gone. Its code relies on Joplin's generated names, so a Joplin update may break it | 13.0 s | Yes |

`morse apps` found all three, and `morse fuses` reported each one (VSCodium's
fuses from its binary; for the two AppImages it says it can't look inside).
The time is from pressing Enter to seeing the change. The test machine was
heavily loaded, so times vary a lot between runs.

| | |
|---|---|
| ![](screenshots/147-vscodium-bar.png) VSCodium: pointing at the status bar | ![](screenshots/148-vscodium-status-bar-back.png) VSCodium opened again: the taller status bar is back |
| ![](screenshots/149-obsidian-bar.png) Obsidian: pointing at the ribbon | ![](screenshots/150-obsidian-ribbon-gone.png) Obsidian opened again: no ribbon |
| ![](screenshots/151-joplin-bar.png) Joplin: pointing at Synchronize | ![](screenshots/152-joplin-sync-hidden.png) Joplin: the Synchronize button is gone |

What these apps turned up, now fixed:

- **VS Code's window refused Morse's bar.** VS Code only lets its own code put
  HTML into its window ("Trusted Types"), and that rule reached Morse too, so
  the bar never appeared. Morse now builds its bar piece by piece there. The
  rule still protects VS Code's own code.
- **`morse apps` didn't find VSCodium or the AppImages.** It now reads the app
  menu and looks for AppImages, and VSCodium is in its list of known apps.
- **Obsidian's AppImage quit at once**, because the computer had no FUSE.
  Morse now has it unpack first.
- **Joplin quit with "Unknown flag"**, because Morse passed a second switch it
  didn't need. Morse now passes only the debugging port.
- **A saved change in an AppImage app wouldn't have come back**: an AppImage
  runs from a new folder each time, and Morse matched changes by the whole
  folder path. It now matches by the page inside the app.
- **The Mods panel said "Stops every mod on this site"** in an app. It now
  says "in this app".

Not tested: Microsoft's own VS Code build, Slack, Discord, Signal and Spotify
(their downloads aren't reachable from the test machine, or they need
an account), Flatpak and Snap installs, macOS, Windows and Wayland. Signing in
to anything wasn't tested. For macOS and Windows, see what's ready and how to
check it in [macOS](#macos) and [Windows](#windows).

### Websites

The same check on public websites, with the built Chrome extension in
Chromium 153 on Linux, paired with `morse serve` and Claude Code (haiku). Each
change was saved, then the page was reloaded.

| Site | What was asked | Result | Time | Back after a reload |
|---|---|---|---|---|
| pypi.org (strict rules for scripts) | "add a back to top button in the bottom right corner" | A round ↑ button. With “Allow User Scripts” off, the site blocked Morse's code and the model's second try was an arrow that only looks like a button (32 s) | 12.6 s | Yes |
| gitlab.com (strict rules, but code is allowed) | the same | The button works, with “Allow User Scripts” on or off | 12.3 s | Yes |
| gitlab.com | "hide this project information box" | Partly: it hid the description in the box, not the whole box | 7.8 s | Yes |
| pkg.go.dev | "make the code examples bigger" (pointing at one) | Bigger code text | 7.6 s | Yes |
| rubygems.org | "make the download numbers much bigger" (pointing at them) | The first try changed nothing. The second made the total downloads big | 8.3 s | Yes |
| hub.docker.com | "make these code blocks bigger with a dark background" | Bigger text on dark blocks | 11.6 s | Yes |
| nodejs.org (the docs) | "hide the left sidebar so the docs use the full width" | Failed, three times: the whole page went blank. The model hid a style the sidebar and the docs share. Undo puts the page back | 10 to 26 s | (blank) |

Wikipedia, Hacker News, MDN, YouTube, the BBC and GitHub's pages couldn't be
tried: the test machine's network doesn't reach them.

| | |
|---|---|
| ![](screenshots/153-web-gitlab-back-to-top.png) GitLab: the back to top button (bottom right) | ![](screenshots/154-web-pypi-after-reload.png) PyPI after a reload: the button is still there |
| ![](screenshots/155-web-docker-hub-code.png) Docker Hub: bigger code on dark blocks | ![](screenshots/156-web-pypi-user-scripts-off.png) PyPI with “Allow User Scripts” off: only an arrow, which doesn't scroll |

The same flow can be run on any installed app with
[`demo/try-real-app.js`](../demo/try-real-app.js), and on websites with
[`demo/try-real-sites.js`](../demo/try-real-sites.js) and
[`demo/real-sites.json`](../demo/real-sites.json).

## How this was tested

On a real Electron 45 on Linux, with a small music app built for it,
[`demo/electron-app`](../demo/electron-app) ("Tunes"). It has what real apps
have: a native menu bar, a preload script with context isolation and the
renderer sandbox on, its UI on a custom `app://` address, a `<webview>` side
panel served from a random local port, a second window from a `file://` page,
and a single-instance lock. It is packaged the way apps ship: Electron
renamed to `tunes`, with the app next to it, unpacked or as
`app.asar`.

- [`demo/shoot-electron.js`](../demo/shoot-electron.js) drives the whole flow
  with real keyboard and mouse input from the X server (xdotool) and takes the
  screenshots above: `morse launch`, the shortcut, pointing, a change, Save,
  quitting with the app's own Ctrl+Q, `morse launch` again (the change is
  back), the Mods panel, the second window, `morse status`, `morse stop` and
  `morse fuses`.
- It ran with the test model, and once with **real Claude Code (haiku)**,
  which built a working "Sleep: off / 15 / 30 / 60 min" picker in about 10
  seconds. That run found a real problem: haiku's first try asked for the
  minutes with `prompt()`, which Electron doesn't support. Morse now tells the
  model not to use it. Run again for the pictures below (October 24), haiku
  built a sleep timer picker under the player in about 4 seconds.
- The same app was run as a normal user with Chromium's sandbox fully on and
  connected with `morse attach --port`.
- [`tests/electron.test.js`](../tests/electron.test.js) runs the flow on every
  `npm test` when Electron and a display are there, and skips with
  a message otherwise. To set it up:

  ```bash
  npm install --prefix ~/.cache/morse/electron electron
  node ~/.cache/morse/electron/node_modules/electron/install.js   # only if dist/ is missing
  DISPLAY=:99 node --test tests/electron.test.js
  ```

| | |
|---|---|
| ![](screenshots/126-electron-haiku-working.png) Claude Code (haiku) writing the change | ![](screenshots/127-electron-haiku-result.png) Its result: a sleep timer picker under the player |

Real installed apps (VSCodium, Obsidian, Joplin) are under
[Tested on](#tested-on). Not tested: Slack, Discord, Microsoft's VS Code or
Spotify, macOS and Windows, and Wayland. The macOS and Windows parts (reading
`.app` bundles, Squirrel installs and Start menu shortcuts, quitting with
AppleScript or taskkill, starting apps, the fuses in a Mac app) are checked
on Linux against copies of real app folders and real file formats
([`tests/platforms.test.js`](../tests/platforms.test.js)), not on the real
systems.
