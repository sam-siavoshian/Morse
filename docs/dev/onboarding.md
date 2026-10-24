# Onboarding: from "found Morse" to the first saved change

The goal: someone who has never used a terminal goes from installing Morse
to their first saved change in under two minutes, with the fewest steps and
decisions, and nothing to misunderstand. This page maps the paths before and
after onboarding v2, says how they were measured, and how the pieces fit.

User-facing steps: [Getting started](../getting-started.md).

## What changed

| Before | After |
|---|---|
| One dense welcome page: a practice area next to a four-step checklist (connect a model, “Allow User Scripts”, first change, pin to the toolbar) and four "good to know" notes. | One screen at a time: a question, connect, try it, the win. Each has one thing to do. |
| Connecting Claude Code or Codex meant `npm i -g morse-cli`, then pasting `morse setup --pair <code>` in a terminal and answering its questions. | With Morse Desktop open, the page finds it and shows one button, **Use Claude Code**. Morse Desktop asks **“Allow Chrome to use your Claude Code?”**; Allow connects. No code, no terminal. |
| Without a terminal: an API key behind a "Use an Anthropic API key instead" fold. | Without Morse Desktop: **Get Morse Desktop** (recommended) and an API key field side by side (websites), or the key behind a link (desktop apps). The terminal command is still there, folded. |
| “Allow User Scripts” was a checklist step, a standing note in the bar and in the popup, and part of the bar's label. | It comes up only when a change needs it. One button opens Morse's details and a small window with a picture of the switch. When it's on, both close and you're back on your tab, where the change runs. |
| The practice page was one panel among many. | The practice page *is* the step: three steps above it tick as you go (open, point and describe, save), then a page celebrates the first mod and sends you to a real site. |
| After the practice page: nothing. | Suggested sites (Wikipedia, Hacker News, YouTube, BBC News) open with the bar open and the words typed in. Or type any address. Desktop-app people get how to open an app in Morse Desktop. |

Removed: the "Pin Morse to the toolbar" step (not needed: the shortcut opens
Morse), the "good to know" block (its one useful line, reload tabs that were
already open, moved to the last screen), the "Allow User Scripts" checklist
step and the bar's standing note about it.

## The paths, step by step

Counted from the moment the welcome page opens to the first saved change.
Adding the extension to Chrome (Developer mode, Load unpacked) is the same
in both and not counted. So is installing Node (before) or downloading Morse
Desktop (after). A *decision* is a choice the person has to make. A *screen*
is a new surface they have to read (a page, a terminal, a dialog).

### Chrome + Claude Code

**Before**

1. Welcome page: practice area and a four-step checklist. *Decide: the
   command, an API key, or later.*
2. Click **Copy**.
3. Open a terminal (*screen*). Type `npm i -g morse-cli`, Enter, wait for npm.
4. Paste `morse setup --pair <code>`, Enter.
5. Setup asks which model, 1 to 3 (*decide*, Enter), then Automatic, fast or
   best (*decide*, Enter). It checks Claude Code, starts the helper and says
   to keep the terminal open.
6. Back to Chrome (*screen*): the page pairs by itself. *Decide: do the
   other checklist steps (“Allow User Scripts”, pin) now?*
7. Click **Or click here**, click the article, type the request, Enter.
8. *Decide: keep it?* Enter (Save).

If `morse` isn't on the PATH ("command not found"), a fallback line explains
`node daemon/cli.js setup --pair <code>`.

**After**

1. *Screen:* one question. *Decide:* websites, desktop apps or both. Click
   **Websites**.
2. *Screen:* "Found Morse Desktop on this computer. It can use Claude Code."
   Click **Use Claude Code**.
3. *Screen:* Morse Desktop asks "Allow Chrome to use your Claude Code?"
   *Decide*, click **Allow**. The page moves on by itself.
4. *Screen:* three steps and the practice page. Click **click here** (or press
   the shortcut), click the article, type the request, Enter.
5. *Decide: keep it?* Enter (Save). The win screen.

### Chrome + an Anthropic API key

**Before:** welcome page (*decide* how to connect), click **Use an
Anthropic API key instead**, paste the key, click **Save key**, *decide*
about the other checklist steps. Then the practice change as above.

**After:** one question (*decide*, click **Websites**), the connect screen
(*decide*: Morse Desktop or a key), paste the key, Enter. The page moves on
to the practice change.

### Desktop apps

Counted on paper: Morse Desktop's window lands from its own branch and was
not driven here.

**Before:** in a terminal, `npm i -g morse-cli` (20 keys and a wait),
`morse setup` (12 keys, two questions), `morse apps` (11 keys, a list to
read), `morse launch spotify` (21 keys; if Spotify is open, *decide* y/n),
keep the terminal open. In the app, the shortcut, point, describe, Save.
About 64 keystrokes and 4 decisions before the first change, and a terminal
that has to stay open.

**After:** open Morse Desktop. It finds Claude Code by itself (or Model,
Change, Use this: two clicks and a decision). Click **Open with Morse** next
to the app (if it's open, *decide* Restart: one click). In the app, the
shortcut, point, describe, Save. One to four clicks, no terminal.

## Before and after, measured

`demo/measure-onboarding.js` drives each Chrome path in a fresh Chrome
profile and a fresh `MORSE_HOME` under Xvfb, with the real `claude` CLI
(Claude Code 2.1.310, signed in), and counts what the person does. "Before"
is a build of `main` from just before onboarding v2; "after" uses
`tests/helpers/fake-desktop.js`, the real Morse helper as Morse Desktop runs
it, for Morse Desktop's Allow.

*Measured* is the wall-clock time of everything that isn't the person: the
model answering, the helper starting, the pages loading (the script clicks
instantly). *Estimated* adds the person, with keystroke-level model
operators: 1.1 s a click, 0.28 s a keystroke, 1.35 s a decision, 3 s to read
a new screen, 2 s to open a terminal, and 30 s for `npm i -g` (before only).
Medians of three to five runs.

| Path | Clicks | Keystrokes | Decisions | Screens | Measured | Estimated |
|---|---|---|---|---|---|---|
| Claude Code, before (terminal) | 3 | 50 | 5 | 3 | 24.1 s | 89 s |
| Claude Code, after (Morse Desktop) | 5 | 26 | 3 | 4 | 15.1 s | 44 s |
| API key to connected, before | 2 | 2 | 2 | 1 | 1.3 s | 9.7 s |
| API key to connected, after | 1 | 3 | 2 | 2 | 1.4 s | 12.0 s |

Claude Code: half the keystrokes (none of them in a terminal), two fewer
decisions, and about half the time. First change saved in well under a
minute. Without the 30 s npm estimate, before is about 59 s. The API key
path costs one more screen (the question) and about 2 s. The practice change
after it is the same as with Claude Code. Two more clicks after (**Use
Claude Code**, **Allow**) replace a whole terminal session.

Run it again:

```bash
git archive <commit before onboarding v2> | tar -x -C /tmp/morse-before && (cd /tmp/morse-before && npm ci && node scripts/build.js)
node scripts/build.js && DISPLAY=:99 node demo/measure-onboarding.js --before /tmp/morse-before --json out.json
```

## How it works

### One-click pairing (the Morse helper)

`daemon/bridge.js` takes two options from whoever runs the helper:

- `app`: `"desktop"` (Morse Desktop) or `"cli"` (`morse serve`,
  `morse setup --pair`). `/v1/health` reports it, so the page says "Found
  Morse Desktop" or "Found the Morse helper".
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
helper off answers Deny to anything waiting. The welcome page's "Already have
it? Open Morse Desktop" opens `morse://open`, which shows Morse Desktop's
window (and starts it, once it is installed). Morse Desktop's
`docs/dev/pairing.md` describes its side; `daemon/bridge.js` is the source of
truth for the protocol.

**`morse serve` in a terminal** asks too (`terminalAsk` in
`daemon/bridge.js`): "Allow Chrome to use your Claude Code? … Allow? (y/n)".
Not in a terminal, it asks only with `--ask` (tests pipe the answer).

### The welcome page

`extension/welcome.html` / `welcome.js` / `welcome.css`. The screen and the
answer to the question are kept in `chrome.storage.local` `"morse.start"`, so
a reload or "Connect a model" from the bar (`#model`) lands in the right
place. It polls `popup.state` (helper health) every 1.5 s while connecting.
The extension side of one-click pairing is `popup.askStart` and
`popup.askCheck` in `extension/background.js`; Allow stores the token exactly
like `popup.pair`.

The practice page loads with the welcome page (hidden), so the bar opens at
once on "try". The steps tick from the requests the practice bar sends, which
the page relays anyway: `warm` (the bar opened), `generate`, `mods.save`.

A suggested site opens through `onboarding.open` with `what: "site"` (from
extension pages only; `onboarding-host.js`): once the site has loaded, the
worker sends `{ morseToggle, text }` (retrying while the page's Morse isn't
listening yet), `host.js` passes `text` on, and `97-boot.js` types it into the
bar it just opened.

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

- `tests/first-run.test.js`: the question; Morse Desktop found, Deny connects
  nothing, Allow connects. The steps tick, then the win screen. A suggested site opens
  with the words typed. A demo site's change saved, back after a reload,
  shared. The API key path. The terminal path and the code box. “Allow User
  Scripts” only when needed, and back to the tab with the mod running.
- `tests/bridge.test.js`: the ask endpoints (origins, one question, once-only
  token, Deny, no `ask` handler).
- `demo/shoot-onboarding-v2.js`: screenshots 190–205 (desktop and phone
  width) with the real `claude`.
