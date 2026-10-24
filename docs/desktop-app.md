# Morse Desktop

Morse Desktop is Morse as an app on your computer. You don't need a terminal
or anything else installed. It lists your apps and opens them with Morse. It
also helps you choose your model, connects Chrome and shows your mods.

A mod is a change you saved. Morse brings it back every time you open that
site or app.

![Morse Desktop: your apps, each with its own icon, with Visual Studio Code connected](screenshots/167-desktop-app-apps.png)

## Get it

Until the first release, Morse Desktop is built from the Morse folder (see
[Releasing](dev/releasing.md)). After that, there is one download for each
kind of computer:

| Computer | Download | The first time |
|---|---|---|
| **Linux** | `Morse-<version>-linux-x86_64.AppImage` | Make it runnable: right-click it, Properties, Permissions, turn on “Allow executing file as program”. Then open it. |
| **Mac** | `Morse-<version>-mac-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel) | Open the dmg and drag Morse to Applications. |
| **Windows** | `Morse-Setup-<version>.exe` | Open it. It installs Morse for you only, with no admin question. |

A Mac or Windows build that isn't signed yet makes the computer warn you once.
On a Mac, right-click Morse in Applications and choose Open. On Windows, click
**More info**, then **Run anyway**.

Working from the Morse folder? `npm run desktop` opens it from there.

## The first time

Morse Desktop opens on one screen. It finds Claude Code or Codex by itself and
checks that it answers, then shows your apps. Click **Open with Morse** next to
one, and you're done. If Morse finds neither, paste an API key there instead.

![The first run: the model Morse found, and your apps](screenshots/175-desktop-app-first-run.png)

## Your apps

Morse Desktop shows the apps Morse can connect to: the same list as `morse apps`.
Each one says whether it's open, and whether Morse is connected to it.

- **Open with Morse** opens the app with Morse connected. Then, in the app,
  press **Ctrl+Shift+Space** (**⌥Space** on a Mac), point at something and
  say what to change.
- **Disconnect** takes Morse off the app. The app keeps running, and your mods
  come off until next time.
- **Connect** shows up for an app that is open and ready for Morse, for
  example after you disconnected. Morse connects without restarting it.
- **Add an app…** lets you choose an app Morse didn't find, by its file.

Morse can only connect to an app when the app starts. If the app is already
open, Morse asks first. Choose **Always restart** and it won't ask again for
that app.

![“Visual Studio Code is open. Restart it with Morse?”](screenshots/168-desktop-app-restart.png)

Morse never changes an app's files. It opens the app again with one extra
setting so it can connect.

## Model

Morse has no model of its own. It uses one you already have: Claude Code,
Codex or an API key. **Change…** shows what's on this computer and recommends
one, the same as `morse setup`. Each choice says **Ready** or **Not
installed**. **How to install** shows the one command to run, and **Look
again** finds it once it's there. **Check** asks the model a short question to
make sure it answers.

![Model: Claude Code answered, and the choices: Claude Code ready, Codex not installed, an API key](screenshots/169-desktop-app-model.png)

The marks of Claude, OpenAI and Anthropic only name the service you choose.
Where they come from: `desktop-app/ui/icons/NOTICE`.

## Chrome

Morse Desktop runs the Morse helper in the background while it's open, so the
Morse extension in Chrome can use your model too. Turn off **Let Chrome use
Morse** if you don't want that.

To connect Chrome:

1. Add the Morse extension to Chrome. **Show the extension folder** opens the
   folder that Chrome's **Load unpacked** asks for (turn on Developer mode in
   `chrome://extensions` first).
2. On the welcome page Chrome opens, click **Connect**. Morse Desktop asks
   “Allow Chrome to use your Claude Code?”. Click **Allow**. There's no code
   to type.
3. Or click **Show a code** and type that code in Morse's menu in Chrome,
   under Morse helper.

![Chrome: the Morse helper is on, with a code to type](screenshots/170-desktop-app-chrome.png)

![“Allow Chrome to use your Claude Code?”](screenshots/171-desktop-app-allow-chrome.png)

Only the Morse extension can ask, only from this computer, and nothing
connects until you click **Allow**. Allow it only when you clicked
Connect in Chrome a moment ago. **Sign out browsers** disconnects every browser.

## Mods

Your mods, app by app, each with a switch to turn it on or off. A mod you turn
off stays saved.

The **Mods on** switch at the bottom left turns every mod off at once, in
every app, and back on again. It is the same off switch as `morse pause`.

![Mods, app by app, with their switches](screenshots/172-desktop-app-mods.png)

## Checks

**Run checks** shows what Morse found on this computer and asks your model a
short question, like `morse doctor`. A row marked **!** says what to do about
it.

![Checks: what Morse found, and the model answered](screenshots/173-desktop-app-checks.png)

## In the tray or menu bar

Closing the window keeps Morse running, with its mark in the tray (Windows and
Linux) or the menu bar (Mac). Click it for:

- **Open Morse**: the window again.
- **Open an app with Morse**: your apps. Click a connected one to disconnect it.
- **Turn all mods off**: the off switch.
- **Quit Morse**: Morse leaves every app it connected (they keep running) and
  stops the Morse helper.

On Linux, some desktops don't show tray icons. Open Morse Desktop again and its
window comes back.

Morse Desktop doesn't open when you log in, unless you turn on **Open at
login** at the bottom left. Then it starts in the tray, without the window.

![Morse Desktop in light mode](screenshots/174-desktop-app-light.png)

## Morse Desktop and the morse command

They are the same Morse, with the same folder (`~/.morse`), the same model and
the same mods. `morse status` lists the apps Morse Desktop connected, and
`morse stop <app>` disconnects them. Apps you opened with `morse launch` show as
connected in Morse Desktop too.

## Safety

- The window only shows Morse's own page. It never loads anything from the
  internet, and web pages can't control it.
- Morse never changes an app's files, and asks before it restarts an app.
- Chrome connects only after you click **Allow** in Morse Desktop (or type a code).
- What Morse sends to your model, and when: [Privacy and safety](privacy-and-safety.md).
