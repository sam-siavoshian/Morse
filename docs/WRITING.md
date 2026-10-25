# How Morse talks

Every word a person reads in Morse should be simple, clear and friendly. This
guide covers the bar, the Mods panel, settings, toasts, the Morse app's window,
the welcome page, the share page, the website, the `morse` command line, the
README and the user pages in `docs/`. Code comments and developer docs
(`docs/dev/`) can stay technical, but should still be plain.

The reader is a normal person who uses apps, not someone who builds them.
Assume they have never heard of CSS, Electron or an API. The only places
written for developers are listed under [Where technical words are fine](#where-technical-words-are-fine).

## Voice

- **Short sentences.** One idea per sentence. If a line needs a comma and an
  "and", it is probably two lines.
- **Everyday words.** "Turn off", not "disable". "Change", not "customize".
  "Address", not "base URL", where a person has to type it.
- **Say what happens, then what to do next.** "Saved. It will be here next
  time." "Stopped. Nothing was changed."
- **Write for someone who has never heard of CSS or Electron.** Keep technical
  terms for developer docs and for the code view, where people chose to look
  at code.
- **Calm, not excited.** No exclamation marks. No emoji. No hype.
- **No sales rhythm.** No rhetorical questions ("Like it?"), no "X. Y. Z."
  slogans, no lists of three for the sound of it, no em dashes. Say the one
  thing that is true, and stop.
- **Only claim what was checked.** Name the apps Morse was
  [tested on](desktop.md#tested-on) (Visual Studio Code, VSCodium, Obsidian, Logseq, Joplin), not apps it
  might work with.
- **Plain, not clever.** No jokes, puns or cute names. A label says what the
  thing does. "Rewire" and "the magic moment" say nothing; "Change keys" and
  "Watch it happen" do.
- **Sentence case** for everything: buttons, headings, menu items, settings.
  "Keyboard shortcuts", not "Keyboard Shortcuts". Feature names follow the
  rule below.
- **"You" for the person, "Morse" for the product.** Not "we", not "I".

### Words we don't use

| Don't write | Write instead |
|---|---|
| leverage, utilize | use |
| seamless, seamlessly | (say what actually happens) |
| powerful, robust | (say what it can do) |
| AI-powered, smart, intelligent | (say what it does; "the model" if you must name it) |
| magic, magical, the magic moment | (describe what you see) |
| unlock, supercharge, level up | (say what the person gets) |
| revolutionary, next-gen, cutting-edge | (nothing) |
| effortless, intuitive, streamline, blazing fast | (say what happens, and how long it takes) |
| elevate, empower, delve, harness, game-changer, next-level | (nothing) |
| simply, just, easily | (cut it: "Describe the change", not "Just describe the change"; "just now" is fine) |
| Let's…, Ready to…? | (say what to do: "Connect a model") |
| customize, customization | change |
| enable, disable, toggle | turn on, turn off |
| refine (in the UI) | change, "describe what to change" |
| prompt (in the UI) | request, or "what you asked for" |
| target, element, node (in the UI) | what you pointed at, this, part of the page |
| inject, injected | add, run |
| apply, applying (a change) | make, show, "you see it" |
| invalid, illegal, fatal | (say what is wrong) |
| please, sorry, oops | (just say it) |
| Morse as a verb ("to morse") | open Morse, change |

`tests/words.test.js` checks for these, and for exclamation marks and emoji,
in everything a person reads (the developer docs only for the marketing words).

### Words people don't know

These never appear in text a person reads in Morse, on the website, in the
README or in the user pages in `docs/`. `tests/words.test.js` checks the
runtime, the Morse app, the website and the user pages in `docs/` for
them (code in backticks is skipped).

| Technical word | Say instead |
|---|---|
| CSS, stylesheet | style, how it looks |
| JS, JavaScript, script (as a noun for code) | code |
| selector, DOM, element, node | part of the page, what you pointed at |
| CDP, DevTools protocol, debugging port | (say "Morse connects to the app") |
| userScripts, user scripts (lowercase) | “Allow User Scripts” (Chrome's own words, quoted) |
| service worker, content script, background page | Morse |
| runtime, harness, backend, provider, bridge, daemon | Morse, the model, the Morse app |
| endpoint, base URL, API (alone) | server address, API key |
| localhost, 127.0.0.1, port | this computer |
| Electron (alone) | desktop apps (VSCodium, Obsidian, Joplin…) |
| HTTP status codes in the sentence | the plain words, then "(error 401)" at the end |

"API key" is fine: people paste one, and the provider's site calls it that.
"Code" is fine: Morse shows it, and people can read it.

### Where technical words are fine

- The code view: Edit code, Show code, the share page's code below the
  summary, the gallery's code. People chose to look at code there, so "Style
  (CSS)" and "Script (JavaScript)" are fine as headings.
- `morse help` flags and `morse doctor` / `morse model` output (developers run
  them), and the developer docs in `docs/dev/` (how it works, testing,
  security, roadmap, repo layout).
- Code comments, tests and developer docs.

## Names, one for each thing

Use these names, and only these names, for these things. The same thing has the
same name everywhere: in the bar, in toasts, in the Morse app, on the share page,
on the website, in the CLI and in the README.

**Feature names start with a capital letter, everywhere, even mid-sentence:**
Mods panel, Edit tools, Page tools, Easier to use, Read aloud, Check this
page, Describe this picture, Settings. "Open the Mods panel", "use the Edit
tools", "the Easier to use group in Page tools". Ordinary words stay lowercase:
mod, change, the bar, share link.

### Mod and change

People see both words, and they mean different things:

- A **change** is what you ask for and what you see happen on the page.
  "Describe a change." Until you save it, it's just a change.
- A **mod** is a change you saved. Morse keeps it and brings it back every
  time you open that site or app. "Mods" is also the button that opens the
  Mods panel.

Every first stop (the welcome page, the website, the README, the first Save
tip) explains "mod" once, in these words or close: **"A mod is a change you
saved. Morse brings it back every time you open that site or app."**

**Which word in a sentence.** Decide by whether it is saved:

- Write **change** for anything not saved yet: what you ask for, what the
  model is making, what you see on the page now. "The change didn't run on
  this page." "Closing the bar saves a change."
- Write **mod** only for a saved one, and always when the sentence names a
  place or action that holds saved ones: the Mods panel, a share link, a
  pack, install, back up, turn on or off. "Turn off every mod on this page."
  "Install a mod…" "Back up all mods."
- Don't switch words for variety inside one message. The one place both
  words meet is the sentence that explains them.
- In other languages, use that language's word for mod everywhere (Mod, mod,
  MOD, 模组, ماد, تعديل), never the English "mod" inside Persian, Arabic,
  Chinese or Japanese text.

### Save and Undo

One rule for anything on the page that isn't saved yet, whether the model
just made it or you are trying one from the gallery:

- **Save** keeps it. It becomes a mod.
- **Undo** takes it off the page. Nothing is saved.

Never "Keep", "Apply" or "Remove" for these. ("Keep it off" in Safe start is
a different thing: it keeps a mod turned off.)

### Glossary

| Term | What it means | Don't call it |
|---|---|---|
| **Morse** | The product. Always capitalized in sentences; the lowercase wordmark "morse" is only for the logo. | the tool, the extension |
| **change** | What you ask for, and what Morse makes. "Describe a change." | customization, tweak, patch |
| **mod** | A change you saved. Plural "mods". Lowercase in sentences. Explained once on every first stop (see above). | customization, script, plugin, extension, userscript |
| **the bar** | The box at the bottom (or top) where you type or talk to Morse. | command palette, prompt box, input |
| **point at** | Move the mouse over something and click it, to choose what to change. | select, pick, target, inspect |
| **what you pointed at** | Named the way a person would say it: its visible label, then what kind of thing it is. "Player controls", "Send button", "“Release notes” heading". | `div · “Player controls”`, `h3`, `span.label`, CSS selectors |
| **part of the page** | Anything on the page, when you can't name it. "It looks for a part of the page that isn't there." | element, node, selector |
| **describe** | Type or say what you want. "Describe a change." | prompt, instruct, query |
| **request** | What you described, as text ("Past requests"). | prompt (in the UI) |
| **Send** | Send what you described to Morse. The button and Enter. | Run, Submit, Go |
| **Stop** | Stop Morse while it is working. Nothing is left behind. | Cancel, Abort |
| **Save** | Keep a change as a mod. Also for a mod you're trying from the gallery. | Keep, Apply, Commit |
| **Undo** | Take off the page a change you haven't saved, or step back one version. | Revert, Roll back, Remove |
| **Change** (button) | On a saved mod in the Mods panel: open the bar on it to describe what to change. | Refine, Iterate, Edit (that's Edit code) |
| **version** | One of the last 20 states of a mod. "Back to version 2." Listed under **History**. | revision, snapshot |
| **Mods panel** | The list of mods for this page or app, where you turn them on and off, share, edit and delete them. Button: "Mods". | mods list, manager, dashboard |
| **turn on / turn off** | What the switch next to a mod does. | enable, disable, toggle, activate |
| **Edit code** | Open the code behind a mod, to read or change it. | Code, Source, Inspect |
| **Show code** | Read a mod's code without changing it (install review, Mods panel). | View source |
| **share link** | A link that carries a mod. Anyone with Morse can install it. | URL, fragment link, permalink |
| **mod file** | A mod saved as a file (`.morse.json`). Button: "Download mod file". | JSON, export |
| **install** | Add a shared mod to Morse. Used on the share page, in the Mods panel and in the CLI. | import, add, load |
| **Try it** | Run a mod from the gallery on this page without saving it. Then Save or Undo. | Preview, Test |
| **gallery** | The list of mods other people made, on the website and under "For this site" in the Mods panel. | store, marketplace, library |
| **the model** | The AI that writes changes. Only name it when it matters (settings, errors, the footer label). | the AI, the LLM, the engine, the brain, the backend, the provider |
| **connect a model** | Tell Morse which model to use: Claude Code, Codex, or an API key. | configure a provider, set a backend |
| **demo model** | The built-in stand-in Morse uses when no model is connected. It only knows the demo sites. | fake model, mock |
| **the Morse app** | Morse on your computer: the one thing people install. It finds the model, opens apps with Morse, and adds Morse to Chrome. "Download Morse", "open the Morse app". (Developers call it Morse Desktop, in code and `docs/dev/`.) | Morse Desktop (in what people read), the desktop client, the launcher |
| **Edit tools** | The toolbar that appears on what you point at: hide, move, resize, edit text, color, text size, duplicate. Works at once, no model. Shortcut: Edit tools. | God mode (that is the code name only), inspector, direct edit mode |
| **direct edits** | Changes made with the Edit tools. Saved together as one mod called "Direct edits". | manual edits |
| **Page tools** | One-click changes for the whole page: dark mode, light mode, bigger or smaller text, hide ads and pop-ups, focus mode, turn off all mods. | quick actions, presets |
| **Easier to use** | The group in Page tools that makes an app easier to read and use: higher contrast, bigger click targets, easier to read font, underline links, stop animations, focus outline everywhere, reading ruler, hide distractions. Plus Read aloud and Check this page. | accessibility mode, a11y (fine in developer docs) |
| **Read aloud** | The computer reads text out loud, a sentence at a time. | text to speech, TTS |
| **Check this page** | A quick look for common problems (pictures with no description, unnamed buttons, unlabeled fields, faint text, tiny targets, autoplay). Each kind has a **Fix it** button. | audit, scan, lint |
| **Describe this picture** | The model says what a picture shows, and you can save that for screen readers. | caption, image recognition |
| **alt text** | The description of a picture that screen readers read. "Save as alt text". | alt attribute, image label |
| **Accessibility fixes** | The one mod per site that holds what Fix it and Describe this picture saved. | |
| **Show me once** | Do a task by hand once so Morse can write down the steps; then say what to do with them (a button, a shortcut, every item). Each one is a **step**: Click “Archive”. A password's value shows as “(hidden)”. | record a macro, automation, workflow |
| **Your style** | One style that follows you to every site and app: your font, text size, calmer colors, no autoplay and more. Say it once in the bar, ending with "everywhere", or set it in Settings. **Not on this site** leaves one site out. **Fit to this site** asks the model to fix what it breaks there; you review it like any change. | theme, global mod, preferences |
| **capture** | Save the look of something so you can rebuild it in another app. Captured things show under "Captured" in the bar. | copy, clip, clipboard |
| **Take this / Bring here** | Take a feature from one app or site (point at it, or open it while Morse watches), then bring it into another, where Morse builds it in that app's own look. What you took is under “Taken from other apps” in the Mods panel. “Taken from VS Code”. | copy, clone, port, transplant, import |
| **voice** | Talking to Morse instead of typing. "Hold ⌥Space to talk." | dictation, speech input |
| **shortcut** | A keyboard shortcut. | hotkey, keybinding (fine in developer docs) |
| **Settings** | The Settings sheet in the bar. | preferences, options, config |
| **pause** | Stop every mod on a site, or everywhere, without deleting them. "Pause Morse on youtube.com". | suspend, disable |
| **Safe start** | When a mod keeps closing or reloading a page, Morse holds it back next time and asks. | crash guard, quarantine |
| **desktop app** | An app on your computer that Morse can connect to (VSCodium, Obsidian, Joplin…). Name only apps Morse was [tested on](desktop.md#tested-on) as examples. Say "Electron" only for developers. | Electron app, CDP target |
| **“Allow User Scripts”** | Chrome's switch that lets Morse run the code in mods on every site. Always Chrome's exact words, in quotes or bold. | userScripts, user scripts permission |

## Buttons and labels

- **Buttons are verbs**, one or two words: "Save", "Undo", "Share", "Edit code",
  "Copy link", "Install", "Try again", "Turn off", "Reset".
  A button that only closes something says "Close" or "Done".
- **A button that opens more choices ends in "…"**: "Install a mod…", "Change
  shortcuts…".
- **Say the result, not the mechanism**: "Download image", not "Card image";
  "Download for Tampermonkey", not ".user.js".
- **Settings labels are nouns, help text is a short sentence without a
  period**: "Send after a pause" / "Sends when you stop talking".
- **Key hints use the caps, then "to" and a verb**: "<kbd>Enter</kbd> to send",
  "<kbd>Esc</kbd> to close". Join parts of one status line with " · ".
- **Hints say what to do**, starting with the verb: "Describe a change",
  "Point at something", "Click the marked spot".
- **Tooltips are short**: name the action, then the shortcut: "Hide H",
  "Undo ⌘Z". No full sentences in a tooltip.
- **Toasts**: one short phrase has no period ("Dark mode off"); two sentences
  both get periods ("Saved “Sleep timer”. It will be here next time.").
- **Numbers and units** as people say them: "Text size 110%", "12.3s".
- **Quotes** around a mod's title or what the person said: curly “ ”.

## Error messages

An error says **what went wrong, in plain words**, then **the one thing to try**,
in one or two short sentences.

```
<What went wrong>. <The one thing to try>.
```

- Lead with what happened to the person, not with a code. Put codes after, if
  at all: "(error 401)".
- Never blame the person. "Couldn't find a microphone", not "You have no
  microphone".
- Offer one next step, not a list. If there is nothing to do, say what Morse
  did instead ("Nothing was changed").
- Raw errors from the browser, the network or the mod's own code ("Failed to
  fetch", "x is not defined", "synthesis-failed") never reach a person as is.
  `plainError()` in `core/onboarding.js` (built on `explainError()`, shared by
  the runtime and the Morse app) turns them into one plain
  sentence; a raw message it can't place becomes "Something went wrong. Try
  again." The raw text stays in the tooltip and the console.
- A mod that stopped working says why in words, never with its code: "It looks
  for a part of the page that isn't there right now", not “It looks for
  “.btns > span””.
- In the bar, the error line starts "That didn't work:" and the detail
  follows in italics. The bar has room for about 60 characters of detail, so
  keep the message and its next step short. The button next to it is "Try again".

| Before | After |
|---|---|
| Couldn't do that: Model server returned 401 | That didn't work: *The model didn't accept the sign-in or API key. Check it in model settings.* |
| The model did not produce a usable change. | The model's answer had no change in it. Try other words. |
| No microphone found | No microphone found. Plug one in and try again. |
| Not a Morse share link | This isn't a Morse share link. Check that you copied the whole link. |
| Couldn't apply that edit: x | Couldn't make that edit. Press ⌘Z to undo it. |
| Couldn't read aloud (synthesis-failed). | Couldn't read aloud. Check that this computer has a voice installed. |
| It looks for “[data-testid="player"] .btns”, and nothing on this page matches. | It looks for a part of the page that isn't there right now. |

## Before and after

| Where | Before | After |
|---|---|---|
| Bar, pointing | **Point** at anything to change it · or just describe it · Esc to close | **Point** at something, or describe a change · Esc to close |
| Bar, something pointed at | Type to describe a change · ⌘E to edit directly · Esc to close | Describe a change · ⌘E for Edit tools · Esc to close |
| Bar, working | Writing | Writing the change |
| Bar, fixing | Fixing a problem in the new code | Fixing a mistake and trying again |
| Bar, stopped | **Stopped** · nothing was changed · Enter to run again | **Stopped.** Nothing was changed · Enter to try again |
| Bar, result | Keep · Undo · Code · Share | Save · Undo · Edit code · Share |
| Bar, result | 4.2s · repaired once | 4.2s · needed a second try |
| Bar, after a result | Refine… | Describe what to change… |
| Toast | Saved “Sleep timer” · it'll be here next time | Saved “Sleep timer”. It will be here next time. |
| Mods panel | Import mod… | Install a mod… |
| Mods panel | Refine | Change |
| Mods panel tags | css · js | style · script |
| Gallery, Try it | Keep · Remove | Save · Undo |
| Settings | Toggle God mode | Show the Edit tools |
| Share | .user.js for Tampermonkey | Download for Tampermonkey |
| CLI | In any attached window: Alt+Space to morse | In a connected app, press Alt+Space to open Morse |
| README | Customize any app in one sentence. | Change any app or website in your own words. |
| Website | Mods are data. Share them as a link. | Share a mod with a link. |
| Bar, first tip | Like it? Save keeps it for next time… | Save keeps it for next time. Undo puts the page back. |
| Ask, Show me | You do the clicking; Morse points the way. | Morse shows where to click. You do the clicking. |
| Settings | Push to talk | Hold to talk |
| Settings | Effects: Full · Subtle · Off | Effects: Full · Less · Off |
| Settings | Small tweaks use sonnet. New features, restyles and second tries use opus | Every change uses opus: it thinks briefly for small ones and longer for new features, new looks and second tries |
| Mods panel | Export all mods | Back up all mods |
| Error | The change the model wrote didn't work on this page. Try again, or describe it differently. | The model's change didn't work on this page. Try again, or try other words. |
| Welcome | Already have it? Open Morse Desktop. | If you have it, open the Morse app. |
| Safe start | “Loopy” is held back: this page closed or reloaded right after it ran. | “Loopy” is off for now. This page closed or reloaded right after it ran. |

The full list from the second pass over every message is in
[docs/dev/wording-pass-2.md](dev/wording-pass-2.md).
