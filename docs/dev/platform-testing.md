# Checking Morse on a real Mac or Windows PC (15 minutes)

Morse's desktop support has only run for real on Linux. The macOS and
Windows code (finding `.app` bundles and Squirrel installs, starting apps,
`--restart`, fuses, `morse doctor`) is unit-tested from Linux against fake
install trees and real file formats
([`tests/platforms.test.js`](../../tests/platforms.test.js)), which can't
catch what only the real OS does: permission prompts, real binaries, real
process lists. This checklist is what to run on a real machine. Write down
what you see at each **Check** and send it back (see the end).

What it can't check without a model is the model's change itself; step 4
uses the Edit tools, which need none. With a model connected (`morse setup`),
also describe one change.

## 0. Set up (2 min)

- Node.js 22 or newer (`node --version`), git.
- At least two of: Slack, Discord, VS Code, Notion, Obsidian, Figma, Spotify,
  installed the usual way (from the app's website, not the Microsoft Store),
  and opened once by hand.

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm ci && npm run build
npm link        # or run node daemon/cli.js wherever this says morse
```

Before anything else, note each app's signature, to compare at the end:

```bash
# macOS
codesign --verify --deep --strict --verbose=1 /Applications/Slack.app
# Windows (PowerShell)
Get-AuthenticodeSignature (Get-ChildItem "$env:LOCALAPPDATA\slack\app-*\slack.exe" | Select-Object -Last 1) | Format-List Status,Path
```

## 1. The unit tests on the real OS (2 min)

```bash
node --test tests/platforms.test.js tests/core.test.js tests/real-apps.test.js
```

**Check:** all pass. Path, line-ending and file-permission bugs that Linux
can't show turn up here. (On Windows, one step of the fuse test needs
symbolic links; without Developer Mode it skips that step and says so.)

## 2. `morse doctor` and `morse apps` (2 min)

```bash
morse doctor
morse apps
morse apps --json > apps.json
morse apps > apps.txt      # then open apps.txt
```

**Check:**

- `doctor`: the `system` row names your OS and version; `folder` has a ✓;
  `shortcut` says ⌥Space (Mac) or Ctrl+Shift+Space (Windows); `colors` says
  on. Mac: the `access` row. Windows: `processes` ✓ and `firewall`.
- `apps`: every app you installed is listed, with the right version and
  "Electron NN" (Spotify: "Chromium (CEF)"). Nothing native you'd expect to
  be left out (Finder, Notepad) is listed. On Windows, Slack, Discord and
  Figma show an `app-<version>` folder, the newest one you have.
- `apps.txt` has no `[32m`-style codes in it.
- The colors and the ● dots look right in your terminal (Windows: try
  Windows Terminal and the old `cmd` window).

## 3. Fuses (1 min)

```bash
morse fuses slack       # or any app you have
```

**Check:** it says "Morse can connect". On an Apple silicon Mac, for a
universal app, it says "2 parts in this universal binary". On Windows it reads
the `.exe` in the newest `app-<version>` folder.

## 4. Launch, restart, change, reopen (6 min)

With the app **closed**:

```bash
morse launch slack
```

**Check:** the `port` and `engine` lines print, the app opens, and
⌥Space / Ctrl+Shift+Space in the app opens the Morse bar. Point at something,
press ⌘E / Ctrl+E for the Edit tools, hide it, and Save. (With a model:
describe a small change and save it too.) How long from Enter to seeing it?

Quit the app (⌘Q, or Quit from the tray icon on Windows), then with the app
**open** (start it from the Dock or Start menu):

```bash
morse launch slack            # answer y
```

**Check:**

- Mac: macOS asks once whether your terminal may control Slack. Write down
  the exact wording, and what happens if you say Don't Allow (Morse should
  still quit it, just less gently).
- Windows: the app quits within about 10 seconds, even though it hides in the
  tray, and no firewall dialog appears.
- The app opens again, connected, and your change from before is back.
- Mac: if the app asks for the microphone or camera, does macOS name the app,
  or your terminal?

While it runs, in a second terminal:

```bash
morse status
# macOS
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':93[0-9]{2}'
# Windows (PowerShell)
Get-NetTCPConnection -State Listen | Where-Object LocalPort -ge 9333 | Where-Object LocalPort -le 9399
morse stop slack
```

**Check:** the debugging port listens on `127.0.0.1` only, never `0.0.0.0`
or `*`. `morse stop` takes the bar off and the app keeps running.

## 5. Odd cases (2 min)

```bash
# A path with spaces
morse launch "/Applications/Visual Studio Code.app"          # macOS
morse launch "C:\Program Files\Microsoft VS Code\Code.exe"   # Windows, if installed there
# Windows: a Start menu shortcut, and Squirrel's Update.exe
morse launch "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Slack Technologies Inc\Slack.lnk"
morse launch "$env:LOCALAPPDATA\Discord\Update.exe"
# ELECTRON_RUN_AS_NODE from the terminal must not reach the app
ELECTRON_RUN_AS_NODE=1 morse launch obsidian                 # macOS
$env:ELECTRON_RUN_AS_NODE=1; morse launch obsidian           # Windows
```

**Check:** each one opens the app connected. Then compare the signatures
from step 0: still valid, unchanged.

## Send back

Open an issue titled "Platform check: macOS 15.1, M2" (or "Windows 11
23H2, x64") with:

- `node --version`, the output of `morse doctor` and `morse apps`, and
  `apps.json`
- for each app: found? opened? `--restart` worked? bar opened? change saved
  and back after reopening? any dialog, with its wording
- the signature checks, before and after
- anything that surprised you, with the exact error

What these steps cover is listed as unverified in
[Desktop apps](../desktop.md#macos) until someone has run them.
