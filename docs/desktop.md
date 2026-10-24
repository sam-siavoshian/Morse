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

Morse looks where apps are usually installed: `/Applications` on a Mac,
Program Files and your user's app folders on Windows, and `PATH`, `/usr/share`,
`/usr/lib`, `/opt`, snap and flatpak on Linux. Each app gets one line:

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
  added a sleep timer button (☾) to the player in about 13 seconds.
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
| ![](screenshots/126-electron-haiku-working.png) Claude Code (haiku) writing the change | ![](screenshots/127-electron-haiku-result.png) Its result: a sleep timer button (☾) in the player |

Not tested: real Slack, Discord, VS Code or Spotify installs, macOS and
Windows (quitting with AppleScript or taskkill, `.app` bundles, Squirrel
installs), and Wayland.
