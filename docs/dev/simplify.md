# Simplify: fewer choices, the same Morse

October 24, 2026. The ask was "Simplify it, make sure everything works." This
page is the inventory of every setting, menu item, panel, button and shortcut
people meet, what was decided for each, and an honest log of Morse checked end
to end on a fresh setup.

> Since October 25, 2026 Morse has no Chrome extension: websites open in a
> browser the Morse app starts, like any app. The rows below about the toolbar
> popup, the welcome page, the Morse helper and pairing are history.

The rule used: **the main path (open → point → say → Save) needs no reading**,
a menu shows the 3 to 5 things people use, and everything else is one **More**
away. Nothing was deleted outright; each thing that left a menu has another
way in, named below. Hidden things stay reachable by keyboard and screen
reader (`tests/simplify.test.js`, `tests/a11y-ui.test.js`, `tests/a11y-morse.test.js`).

How often: **always** (every use), **often** (most weeks), **sometimes**
(a few times ever), **rarely** (once, or for developers).

## What changed, in numbers

| Surface | Before | After |
|---|---|---|
| The bar's ⋯ menu | 7 items | 3 (Show me once, Settings, Help) |
| Settings, before scrolling | 16 rows in 6 sections | 5 rows and **More settings** |
| Page tools menu | 19 items in two side-by-side menus | 9; **Easier to use** opens its 11 |
| A mod's row in the Mods panel | 7 actions (Change, History, Copy link, Share, Edit code, Delete, Show code) | Change, Share, History (when there is one), **More** |
| The Mods panel's own buttons | 4 (Make a pack…, Export all mods, Install from a file…, Install a mod…) | Install a mod… and **More** (2) |
| Toolbar popup, a model that works | 9 controls (two choices, code, Pair, model, Sign out, key, model for harder changes, Test) | one line, "Model · Claude Code · …", that opens to all of them |
| Morse Desktop's sections | 5 (Apps, Model, Chrome, Mods, Checks) | 4 (Checks is a card under Model) |
| `morse help` | 36 lines of commands and options | 10 commands; `morse help --all` has every one |

## The bar (`runtime/src/*`)

| Thing | What it does | How often | Decision |
|---|---|---|---|
| The input | Say what to change | always | keep |
| Pointing (the default when the bar opens) | Choose the part to change | always | keep |
| The chip with × | What you pointed at; × points again | often | keep |
| Send / Stop | Sends; turns into Stop while the model works | always | keep |
| Mic | Talk instead of typing | sometimes | keep (it is Talk's one place now) |
| Page tools button | One-click changes, no model | sometimes | keep, menu shortened (below) |
| Suggestions under the input | Ideas for what you pointed at | often | keep |
| Mods button and its count | Opens the Mods panel | often | keep (it is the Mods panel's place in the bar now) |
| The model's name in the status line | Which model answers | rarely | keep (small, read-only) |
| ⋯ menu: Show me once | Do it by hand, Morse learns it | sometimes | keep |
| ⋯ menu: Settings | Settings | sometimes | keep |
| ⋯ menu: Help and examples | What you can do, examples, the shortcut list | sometimes | keep |
| ⋯ menu: Talk | Starts voice | sometimes | **remove from the menu**: the mic button is beside the input, and its key (hold Ctrl+Shift+Space) is in Help |
| ⋯ menu: Mods panel | Opens the panel | often | **remove from the menu**: the Mods button sits beside ⋯, and Alt+Shift+M |
| ⋯ menu: Keyboard shortcuts | The cheat sheet | rarely | **merge into Help** (its header button), and `?` |
| ⋯ menu: Choose with keys | Point with the keyboard | rarely (needed by keyboard and screen-reader users) | **move**: Alt+↓ still works everywhere, the hint read to screen readers names it, and it is on the shortcut list |
| Result: Save ↵, Undo, Edit code, Share | After a change | always / often / rarely / sometimes | keep: Save is the main step; Edit code stays because Morse always shows the code it wrote (security) |
| Edit tools (Alt+Shift+G): hide, move, resize, text, color, font, duplicate, capture, ask, undo, redo | Change a part without a model | sometimes | keep (its own key; not on the main path) |
| Help pane | What you can do, examples to click | sometimes | keep |
| Shortcut list (`?`) | Every key | rarely | keep (from Help) |
| First-run coach (Point, Describe, Save) | The three steps, once | once | keep (onboarding v2 owns it) |

### Page tools

| Thing | How often | Decision |
|---|---|---|
| Explain this page | sometimes | keep |
| Dark mode, Light mode, Bigger text, Smaller text | often | keep |
| Hide ads and pop-ups, Focus mode | sometimes | keep |
| Turn off all mods here | sometimes | keep |
| Easier to use: Higher contrast, Bigger click targets, Easier to read font, Dyslexia-friendly letters, Underline links, Stop animations, Focus outline everywhere, Reading ruler, Hide distractions, Read aloud, Check this page | the people who need them, often; everyone else, never | **move behind one item**, "Easier to use ›", with a tick when one is on. Click, Enter or → opens it beside the menu; ← goes back |

### Settings

| Row | What it does | How often | Decision |
|---|---|---|---|
| Your style | One look for every site and app | sometimes | keep |
| Open Morse (shortcut) | The key that opens the bar | sometimes (the one key people change) | keep |
| Theme | Match app, Light, Dark | sometimes | keep |
| Language | Morse's words | once | keep |
| Fix my mods automatically | Self-heal in the background | sometimes | keep (off by default: it sends the page to the model without asking, so it stays a choice) |
| Push to talk, Mods panel, Edit tools, Turn off all mods (shortcuts) | Change those keys | rarely | **More settings** |
| Send after a pause, Speech to text | Voice details | rarely | **More settings** |
| Effects, Bar position | The animation; where the bar sits | rarely | **More settings** (defaults: follow the system's motion setting; Auto) |
| Model: Automatic, Always fast, Always best | Which model tier | rarely (expert) | **More settings** (default Automatic is right for most) |
| Welcome message, Show mods others made | Small notices | rarely | **More settings** |
| Reset all settings | | rarely | **More settings** |

More settings stays open while the bar is, and opens by itself when you
change one of its shortcuts.

## The Mods panel

| Thing | How often | Decision |
|---|---|---|
| Pause Morse on this site | sometimes | keep |
| A mod's switch | often | keep |
| Change | often | keep |
| Share | sometimes | keep (the dialog has the link, a picture, the file, Tampermonkey) |
| History (n) | sometimes | keep, shown only when there are versions |
| Copy link | sometimes | **More** (Share has the same link) |
| Show code | rarely | **More** |
| Edit code | rarely | **merge into Show code** (its Edit code button) |
| Delete | sometimes | **More** |
| Fix it, Turn back on, Update available, Share the fix | when needed | keep (they show only then) |
| Mods for this site (gallery) | sometimes | keep |
| Install a mod… | sometimes | keep |
| Install from a file… | rarely | **merge into Install a mod…** (a button in its dialog) |
| Export all mods, Make a pack… | rarely | **More**, beside Install a mod… |

## Morse Desktop (`desktop-app/`)

| Thing | How often | Decision |
|---|---|---|
| First run: the model it found, the apps, Open with Morse, Skip | once | keep |
| Apps: Open with Morse / Connect / Disconnect, Look again, Add an app… | often | keep |
| Model: Morse uses …, Check, Change… | rarely | keep |
| Checks: Run checks (like `morse doctor`) | rarely | **merge into Model** as a card: it checks the model and this computer, and one fewer section to choose from |
| Chrome: Let Chrome use Morse, Show the extension folder, Show a code | once | keep |
| Mods: each mod's switch | sometimes | keep |
| Mods on, Open at login (side) | sometimes | keep |

## The CLI (`morse help`)

| Command | How often | Decision |
|---|---|---|
| `morse launch <app>`, `morse apps`, `morse stop <app>` | often | `morse help` |
| `morse extension`, `morse serve` | once | `morse help` |
| `morse setup`, `morse doctor` | once, when stuck | `morse help` |
| `morse mods`, `morse install`, `morse pause` | sometimes | `morse help` |
| `launch --restart/--watch/--name/--port/-- args`, `attach`, `status`, `fuses` | rarely | `morse help --all` |
| `pair`, `unpair` | rarely | `--all` |
| `model`, `config --provider/--model-mode/--fast-model/--best-model/--model/--anthropic-key/--openai-key/--base-url` | rarely (expert) | `--all` |
| `rm`, `export`, `export --all`, `code` | rarely | `--all` |
| `pack make/install/list/unsubscribe` | rarely | `--all` |
| `resume` | sometimes | `--all` (`morse pause` says how to resume) |
| An unknown command | | now says "There's no command “x”", shows the short list, and exits 1 (it printed the whole help and exited 0) |

## Defaults, so most people never open Settings

Unchanged, and checked to be right: Automatic model (sonnet for small tweaks,
opus for new features with Claude Code; never haiku), effects follow the
system's motion setting, the bar moves away from what you point at, the
theme matches the app, the language follows the computer, mods others made
show, fixing mods automatically is off (it sends a page to the model without
asking). Nothing to set on the main path.

## Checked end to end

A fresh setup: the extension built with `node scripts/build.js`, loaded in a
new Chromium profile (Playwright, headed, `DISPLAY=:99`), paired with
`morse serve` in a terminal on its usual port, using the real `claude` CLI
(Claude Code 2.x; Automatic, so sonnet, opus for bigger changes). Real sites:
nodejs.org, rubygems.org, pkg.go.dev. Real apps: VSCodium 1.140, Obsidian
1.14.5, Joplin 3.7.21, each with its own fresh profile, driven with the real
shortcut and mouse (xdotool, or CDP input for Morse Desktop).

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | `morse serve` in a terminal with nothing set up | passed | Found Claude Code by itself: "Claude Code · Automatic" |
| 2 | Install the extension in a fresh profile | passed | The welcome page opens by itself |
| 3 | Welcome → Websites → Connect | passed | "Found the Morse helper on this computer", **Use Claude Code**, `y` in the terminal; no code to type |
| 4 | Allow User Scripts | passed | The switch on Chrome's details page |
| 5 | nodejs.org: point, "add a small Back to top button fixed at the bottom right corner of the page" | passed | 24.3 s (code, so the strong model); Save; back after a reload |
| 6 | rubygems.org: point at the footer, "hide this footer" | passed | 6.3 s; Save; back after a reload |
| 7 | pkg.go.dev: point at the title, "make this title red" | passed | 7.0 s; Save; back after a reload |
| 8 | Undo a change that isn't saved | passed | The page is as it was, nothing saved, still so after a reload |
| 9 | Share link from the Mods panel | passed | Mods panel → Share → the link in its box |
| 10 | The share link in a second fresh profile with no model | passed | The share page, Morse's own review ("Install “Hide page footer”?"), Install; the footer is hidden on rubygems.org |
| 11 | Mods panel switch off and on | passed | The footer comes back, then goes again |
| 12 | Off switch, Alt+Shift+0, twice | passed | Every mod off, then on |
| 13 | Self-heal: the Back to top mod edited to hang on a part that isn't there | passed | Reload → the Mods panel says "Not working. It looks for a part of the page that isn't there right now." → **Fix it** → fixed in 17.4 s, and after a reload |
| 14 | Uninstall | passed | No Morse UI, no mod, no Morse keys left in the sites' storage. The Morse helper still lists the browser as paired (it can't hear about an uninstall); the token only works for that extension, and `morse unpair` removes it |
| 15 | VSCodium: `morse launch codium`, point at the status bar, "make the status bar taller with bigger text", Enter to Save, quit, `morse launch` again | **fixed**, then passed | The second `morse launch` failed with "The model took too long to answer", though no model was asked: VSCodium, just opened on a busy machine, took over 1.5 s to answer on its debugging port. Morse now waits longer each try and says the app didn't answer (`daemon/ports.js` `identify`, test in `tests/simplify.test.js`). Then: 5.9 s, back after reopening |
| 16 | Obsidian (fresh profile, its starter screen): point at Quick start, "make this button green", Save, quit, launch again | passed | 5.0 s, back after reopening |
| 17 | Joplin (fresh profile): point at Synchronize, "hide this button, I don't use sync", Save, quit, launch again | passed | 12.2 s, back after reopening. Its CSS uses Joplin's generated class names, so a Joplin update may break it (self-heal is there for that) |
| 18 | Disconnect (`morse stop`) on VSCodium, Obsidian and Joplin | passed | "Disconnected from …. It keeps running without Morse." The app keeps running; its mod and Morse's UI are gone (checked in VSCodium and Obsidian); `morse status` agrees |
| 19 | Morse Desktop (`npm run desktop`), fresh: first run | passed | "Morse will use Claude Code", Obsidian offered |
| 20 | Morse Desktop: Open with Morse → change ("make this button green", 4.7 s) → Save → quit Obsidian → Open with Morse again | passed | The change is back |
| 21 | Morse Desktop: Disconnect | passed | Morse comes off, Obsidian keeps running |
| 22 | Every command in `morse help --all`, three ways: nothing set up, a `config.json` that isn't JSON, no model (no `claude` or `codex` on PATH, no keys) | **fixed** | `morse rm` with no id said "Deleted {id}."; `morse rm <id that isn't there>` said "Deleted …" though nothing was; `morse export` with no id said "Something went wrong. Try again. (There's no mod called {id}…)"; `morse code` with no id said "No mod . List them…". Now each asks "Which mod?" or names the id that isn't there, and exits 1. A broken `config.json` was ignored without a word and overwritten by the next change: now every command says Morse can't read it, and a copy is kept before a new one is written. An unknown command printed the whole help and exited 0: now it says so and exits 1. Everything else said something useful in all three setups. Tests: `tests/simplify.test.js` |
| 23 | The popup after pairing in it | **fixed** | With the Model box folding whenever a model worked, pairing in the popup folded away its own "Paired" note. It now folds only as the popup opens |

Still not perfect:

- The Morse helper keeps a paired browser's token after the extension is
  removed (step 14). Harmless, but it is something left behind.
- `demo/try-real-app.js` can wait forever to quit Joplin the second time
  (Joplin doesn't always close on `Browser.close`); the check itself passed.

Screenshots of each simplified surface, before and after, were looked at one
by one: the ⋯ menu, Settings (closed and with More settings open), Page tools
(and Easier to use open), the Mods panel (and each More open), the popup, and
Morse Desktop's Model with Checks. The ones the docs use are retaken:
`docs/screenshots/11`, `12`, `34`, `61`, `62`, `100` and `167` to `175`.
