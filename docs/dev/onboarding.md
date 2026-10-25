# Onboarding: one app, then Chrome

The goal: someone who has never used a terminal goes from "download" to
their first saved change with the fewest steps and decisions, and nothing to
misunderstand. October 2026, the one-app change: Morse is **one app** (the
Morse app, `desktop-app/`) plus **one optional Chrome extension** that gets
its model from the app. This page maps the paths before and after, says how
they were measured, and how the pieces fit.

User-facing steps: [Getting started](../getting-started.md).

## What changed

| Before | After |
|---|---|
| Three things to understand: the Chrome extension (with its own model setup: an API key, a pairing code, `morse serve`, or Morse Desktop), the `morse` command (Node 22, npm, `morse setup`, `morse launch`, `morse serve`), and Morse Desktop. The README led with npm. | **One app.** "Download Morse" (one link per computer, the site picks it) → open it → done. It finds Claude Code or Codex, lists your apps and opens them with Morse. Chrome is one button in it: **Use Morse in Chrome**. The `morse` command is under "For developers". |
| Morse Desktop's first screen: the model it found and the apps. Chrome was a section of its own, with three steps and a code. | The first screen: "Morse will use Claude Code ✓", your apps, and **Use Morse in Chrome too**. The Chrome section: that button, the "Let Chrome use Morse" switch, and **Advanced** (the folder, a code). |
| Adding the extension: `morse extension` printed a folder inside npm's (or Morse Desktop's **Add to Chrome** showed `~/.morse/chrome-extension`, a hidden folder Load unpacked can't see without a trick). | **Use Morse in Chrome**: the extension copied to `~/Morse for Chrome` (a folder the file chooser shows), the folder shown and its path copied, Chrome opened on `chrome://extensions`, and one real picture of where to click. With a Chrome Web Store listing (`LINKS.chrome`), it opens that page instead. |
| The welcome page asked "websites, desktop apps or both?", then offered Morse Desktop (**Use Claude Code**), an API key, or `morse setup --pair <code>`. | No question. The page finds the Morse app and asks it by itself: the only step is **Allow** in the app. Without the app: one button, **Download Morse**, and **Not now: try a sample**. |
| The popup's Model section: two choices (Morse helper, API key), a pairing code, the helper's model, a key, a model for harder changes, Test. | "Using Claude Code · From the Morse app", or **Connect** / **Download Morse**. The rest is under **Developer**, folded (simplify's one-line fold stays around it). |
| Errors said "Run morse setup in a terminal". | "The Morse app isn't open on this computer. Open it, then try again." and "Open the Morse app to choose what Morse uses." |
| Morse Desktop's window was English only. | Every word in it is in `core/locales/*.js` (`desk.*`), in all nine languages. |

Kept for developers, out of the normal flow: the API key in the browser and
the terminal pairing command (welcome page `?dev`, popup **Developer**), the
code box for a helper that can only show a code (only a developer starts
one), `morse help` (now opening with "The morse command is for developers.
Most people use the Morse app instead"), and the one-line installers. The
extension's direct API-key mode stays: removing it would not simplify much
(`core/providers.js` serves both), and tests and developers use it.

## The paths, step by step

From "download" to the first saved change. A *decision* is a choice the
person has to make; a *screen* is a new surface they have to read (a page, a
terminal, a dialog, a file chooser). Chrome's own steps (Developer mode, Load
unpacked) are counted the same way in each. The welcome-page and Morse-app
parts are measured (below); the rest is counted on paper.

### To a saved change in a desktop app

**Before, the README's path** (Node, npm, the terminal):

1. Install Node 22 (its site, its installer: *screens*).
2. Open a terminal (*screen*). `npm install -g morse-cli`, Enter (25 keys, a wait).
3. `morse setup` (12 keys). *Decide* the model, *decide* Automatic, fast or best (2 Enters).
4. `morse apps` (11 keys), read the list (*screen*). `morse launch obsidian` (22 keys); keep the terminal open.
5. In the app (*screen*): the shortcut, click, type the request, Enter, *decide* to keep it, Enter.

About 92 keystrokes, 1 click, 4 decisions and 6 screens, plus Node's
installer, before the first change. Morse Desktop already did this in one
click, but it was the second way in, after npm.

**After** (the Morse app):

1. **Download Morse** (1 click; the site picks the file for this computer), open it.
2. *Screen:* "Morse will use Claude Code ✓" and your apps. *Decide* which app, click **Open with Morse**.
3. In the app (*screen*): the shortcut, click, type the request, Enter, *decide* to keep it, Enter.

4 clicks, 20 keystrokes, 2 decisions, 3 screens, no terminal.

### To a saved change in Chrome

**Before, the README's path:** Node and `npm install -g morse-cli` as
above, `morse extension` to print the folder, `chrome://extensions` typed,
Developer mode, Load unpacked, the folder found inside npm's (copy and paste
its path), the welcome page's question (*decide*: websites), then (with no
Morse Desktop) *decide* how to connect: copy `morse setup --pair <code>`,
paste it in the terminal, answer its two questions, back to Chrome, then the
practice change. About 100 keystrokes, 7 clicks, 5 decisions, 8 screens,
and a terminal that stays open.

**Before, with Morse Desktop (onboarding v2):** download and open it (2
clicks), its first screen (Skip, 1 click), find **Chrome** in the sidebar
(*decide*, 1 click), **Add to Chrome** (1 click), Chrome's extensions page:
Developer mode, drag the folder in (2), then the welcome page: the question
(*decide*, 1 click), **Use Claude Code** (1 click), **Allow** in Morse
Desktop (*decide*, 1 click), the practice change. 12 clicks, 26 keystrokes,
4 decisions, 8 screens.

**After:**

1. **Download Morse** and open it (2 clicks). Its first screen: **Use Morse in Chrome too** (1 click).
2. Chrome opens on its extensions page, and the app shows where to click: **Developer mode**, **Load unpacked**, choose **Morse for Chrome** (4 clicks, the file chooser is one more *screen*).
3. Morse's welcome page opens and asks by itself; the app asks "Allow Chrome to use your Claude Code?" (*decide*, **Allow**, 1 click). Then the practice change.

10 clicks, 26 keystrokes, 2 decisions, 8 screens. Nothing to click in Chrome
before Allow, no question, no "which way to connect", no terminal. Once
Morse is in the Chrome Web Store, step 2 becomes Chrome's own **Add to
Chrome** (2 clicks, no Developer mode).

## Before and after, measured

`demo/measure-onboarding.js` drives the parts Morse owns, with the real
`claude` CLI (Claude Code 2.1.310, signed in) and fresh profiles, and counts
what the person does. "Before" is a build of `main` from just before this
change (`--before`); the Morse app's helper is `tests/helpers/fake-desktop.js`
(the real helper, as the app runs it) for Chrome, and the real Morse app
(Electron) with Tunes (`demo/electron-app`) for the desktop path, typing into
Tunes with real keys.

*Measured* is the wall-clock time of everything that isn't the person (the
model, the app, the pages loading; the script clicks instantly). *Estimated*
adds the person with keystroke-level model operators: 1.1 s a click, 0.28 s a
keystroke, 1.35 s a decision, 3 s to read a new screen. Medians of three runs
(October 25, 2026).

| Path | Clicks | Keystrokes | Decisions | Screens | Measured | Estimated |
|---|---|---|---|---|---|---|
| Chrome, the app open, to the first saved change: before (the question, Use Claude Code, Allow) | 5 | 26 | 3 | 4 | 8.7 s | 37.6 s |
| Chrome, the app open, to the first saved change: after (Allow) | 3 | 26 | 2 | 3 | 8.9 s | 31.2 s |
| The Morse app, first screen to a saved change in a desktop app (after) | 2 | 20 | 2 | 2 | 6.7 s | 23.2 s |

The welcome page: two clicks, one decision and one screen fewer, about 6 s
less for a person. The model's time is the same. With the counted steps
above, from download: a desktop app goes from about 92 keystrokes, 4
decisions and a terminal (the README's path) to 4 clicks, 20 keystrokes and 2
decisions; Chrome goes from about 100 keystrokes and 5 decisions (the
README's path), or 12 clicks and 4 decisions (with Morse Desktop), to 10
clicks, 26 keystrokes and 2 decisions.

Run it again:

```bash
git archive <main before the one-app change> | tar -x -C ../morse-before && (cd ../morse-before && node scripts/build.js)
node scripts/build.js && DISPLAY=:99 node demo/measure-onboarding.js --before ../morse-before --json out.json
```

(The checkout goes next to this one so its build finds `node_modules`.)

## How it works

### One-click pairing (the Morse helper)

`daemon/bridge.js` takes two options from whoever runs the helper:

- `app`: `"desktop"` (the Morse app) or `"cli"` (`morse serve`,
  `morse setup --pair`). `/v1/health` reports it, so the page says "Found
  the Morse app" or "Found the Morse helper".
- `ask({ origin, label, words, signal })`: asks a person on this computer
  whether Chrome may connect, resolving true (Allow) or false (Deny).
  `words` is `askWords(label)`: "Allow Chrome to use your Claude Code?", the
  detail, Allow and Deny, in the person's language. Health reports `ask:
  true` when there is someone to ask.

Endpoints, both POST (Chrome sends an extension's `Origin` on POST, not GET):

- `POST /v1/pair/ask` → `202 { id, expires }`. Extension origins only. One
  question at a time (asking again while waiting returns the same id). After
  Deny, that extension waits a few seconds before it can ask again. Without
  an `ask` handler: `404 { code: "no-ask" }`, and the page offers the code.
- `POST /v1/pair/ask/<id>` → `{ state: "waiting" | "allowed" | "denied" |
  "expired", token? }`. Only the extension that asked can read it; the token
  is handed out once, then the question is gone. Questions nobody answers
  expire after two minutes (and `signal` aborts, so the dialog closes).

The token is the same one a pairing code gets: random, stored hashed, bound to
the extension's origin. Security is unchanged: a web page can't ask (wrong
origin), a local program can't ask (no origin), and nothing connects unless a
person on this computer clicks Allow.

`health.signedIn` says whether Claude Code (`claude auth status`) and Codex
(`codex login status`) are signed in, checked in the background at most every
five minutes. The page warns when the model it would use isn't.

**Morse Desktop** (`desktop-app/`, landing from its own branch) turns this on
in `desktop-app/service.js`: `startHelper()` calls
`d.createBridge({ port, app: "desktop", ask: askAllow, log })`. `askAllow`
brings its window forward and shows `words.message` with Allow and Deny in
the window's own dialog. An aborted `signal` counts as Deny, and turning the
helper off answers Deny to anything waiting. The welcome page's "If you have
it, open the Morse app" opens `morse://open`, which shows Morse Desktop's
window (and starts it, once it is installed). Morse Desktop's
`docs/dev/pairing.md` describes its side; `daemon/bridge.js` is the source of
truth for the protocol.

**`morse serve` in a terminal** asks too (`terminalAsk` in
`daemon/bridge.js`): "Allow Chrome to use your Claude Code? … Allow? (y/n)".
Not in a terminal, it asks only with `--ask` (tests pipe the answer).

### The welcome page

`extension/welcome.html` / `welcome.js` / `welcome.css`. Three screens:
connect → try → win. The screen is kept in `chrome.storage.local`
`"morse.start"`, so a reload or "Connect a model" from the bar (`#model`)
lands in the right place. It polls `popup.state` (helper health) every 1.5 s
while connecting.

Connect shows one card, from what it found (`connectView`): looking; the
Morse app (or a helper that can ask) found: it asks by itself once the page
is in front (`askSoon`), and the card says "The Morse app is asking. Click
Allow there." After Deny or no answer, **Ask again**. A helper with no model:
"choose one in the Morse app". Nothing found: **Download Morse**
(`core/links.js` `DOWNLOAD`, the site's Install section, which picks the file
for the computer), "If you have it, open the Morse app" (`morse://open`), and
"This page finds it by itself". The extension side of one-click pairing is
`popup.askStart` and `popup.askCheck` in `extension/background.js`; Allow
stores the token exactly like `popup.pair`.

For developers, `?dev` adds a folded **Developer** card under it: an
Anthropic API key (kept in this browser), and `morse setup --pair <code>`,
which the page pairs with by itself when the helper waits with that code. A
helper that can only show its own code (`morse serve` with no terminal) gets
the code box without `?dev`.

The practice page loads with the welcome page (hidden), so the bar opens at
once on "try". The steps tick from the requests the practice bar sends, which
the page relays anyway: `warm` (the bar opened), `generate`, `mods.save`.
The win screen suggests sites; with the Morse app found, it also says how to
change a desktop app there.

A suggested site opens through `onboarding.open` with `what: "site"` (from
extension pages only; `onboarding-host.js`): once the site has loaded, the
worker sends `{ morseToggle, text }` (retrying while the page's Morse isn't
listening yet), `host.js` passes `text` on, and `97-boot.js` types it into the
bar it just opened.

### The popup

`extension/popup.html` / `popup.js`: Model is one card (`renderApp`): "Using
Claude Code · From the Morse app on this computer", or "Found the Morse app"
with **Connect** (the welcome page, `#model`), or "The Morse app isn't open"
with **Download Morse**. **Developer** folds the rest: the Morse helper's
code and model, the API key, Test the model. It opens by itself when the API
key is the one in use. Simplify's fold (`#modelbox`, one line once a model
works) is around both.

### The Morse app: first run and Use Morse in Chrome

`desktop-app/ui/index.html` `#first`: the model it found (checked once),
up to six apps with **Open with Morse**, and a card **Use Morse in Chrome
too**. Opening an app or Skip ends the first run (`desktop.json`
`welcomed`). **Use Morse in Chrome** (first run, and the Chrome section)
calls `useChrome` (`ipc.js`): `service.useChrome()` turns the helper on, then
either returns the Chrome Web Store page (`chromeStore`, from
`site/config.js` `LINKS.chrome` when `isStoreUrl` says it is a listing; main
opens it) or copies the extension to `~/Morse for Chrome` (`extensionFolder`;
`MORSE_CHROME_FOLDER` and `MORSE_COPY_EXTENSION` for tests and pictures).
`ipc.js` then shows the folder (selected, its path copied) and starts Chrome
on `chrome://extensions` (`desktop-app/chrome.js`, `MORSE_CHROME` for a
stand-in). The window opens `#chrome-guide`: one real picture of Chrome's
extensions page with the two places marked (`ui/chrome-steps.png`, made by
`demo/shoot-chrome-steps.js`), three lines, and a live line that says when
Chrome connected; it closes by itself then, or gives way to the Allow
question.

### “Allow User Scripts”, only when needed

The bar's standing "is off" note, the popup's standing warning and the
"· “Allow User Scripts” off" suffix on the bar's label are gone. What's left
is what a change needs: the waiting-mods notice and result note
(`runtime/src/64-waiting.js`) and the popup's list of waiting mods. Their
button calls `onboarding.open` `"userscripts"`, which opens Morse's details in
Chrome and `extension/allow.html` in a small window beside it, with a picture
of the switch (`extension/allow-user-scripts.png`). `allow.js` watches for
the switch, then closes both, brings the tab back, and sends `morseRetry`,
which `host.js` turns into a `waiting.retry` event: the waiting mods run.

## Tests and pictures

- `tests/first-run.test.js`: no question; nothing on the computer: Download
  Morse only (no API key, no terminal); the Morse app opens: the page asks by
  itself, Deny connects nothing, Ask again, Allow connects. The steps tick,
  then the win screen (with the desktop apps part). A suggested site opens
  with the words typed. A demo site's change saved, back after a reload,
  shared. `?dev`: the API key path, `morse setup --pair`, and the code box.
  “Allow User Scripts” only when needed, and back to the tab with the mod
  running.
- `tests/desktop-app.test.js`: Use Morse in Chrome (the copy in a folder you
  can see, its mark, a folder Morse didn't make is never emptied, the helper
  on, the folder shown, Chrome opened; with a store listing, its page).
  `tests/desktop-app-ui.test.js`: the real window's first run, the button,
  the picture loading, a stand-in Chrome asked for `chrome://extensions`.
- `tests/i18n.test.js`: every word id the Morse app's window, the welcome page
  and the popup use is in every language.
- `tests/site.test.js`: Download Morse before Add to Chrome, and no terminal
  steps on the landing page.
- `tests/bridge.test.js`: the ask endpoints (origins, one question, once-only
  token, Deny, no `ask` handler).
- `demo/shoot-onboarding-v2.js`: screenshots 190, 191 (Download Morse), 194,
  195 (the app asking), 198 to 205, 206 (the popup), with the real `claude`.
  `demo/shoot-desktop-app.js`: 167 to 176, with the real apps on this machine
  (175 the first run, 176 the Chrome picture).
