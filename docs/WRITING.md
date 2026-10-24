# How Morse talks

Every word a person reads in Morse should be simple, clear and friendly. This
guide covers the bar, the Mods panel, settings, toasts, the extension popup,
the share page, the `morse` command line and the README. Code comments and
developer docs can stay technical, but should still be plain.

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
- **Sentence case** for everything: buttons, headings, menu items, settings.
  "Keyboard shortcuts", not "Keyboard Shortcuts". Product terms in the
  glossary are capitalized only where the glossary does it ("Mods panel").
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
| customize, customization | change |
| enable, disable, toggle | turn on, turn off |
| prompt (in the UI) | request, or "what you asked for" |
| target, element, node (in the UI) | what you pointed at, this |
| inject, injected | add, run |
| invalid, illegal, fatal | (say what is wrong) |
| please, sorry, oops | (just say it) |
| Morse as a verb ("to morse") | open Morse, change |

## Glossary

Use these names, and only these names, for these things. The same thing has the
same name everywhere: in the bar, in toasts, in the popup, on the share page,
in the CLI and in the README.

| Term | What it means | Don't call it |
|---|---|---|
| **Morse** | The product. Always capitalized in sentences; the lowercase wordmark "morse" is only for the logo. | the tool, the app, the extension (unless you mean the Chrome extension) |
| **change** | What you ask for, and what Morse makes. "Describe a change." | customization, tweak, patch |
| **mod** | One saved change to an app or a site. Plural "mods". Lowercase in sentences. | customization, script, plugin, extension |
| **the bar** | The box at the bottom (or top) where you type or talk to Morse. | command palette, prompt box, input |
| **point at** | Move the mouse over something and click it, to choose what to change. | select, pick, target, inspect |
| **what you pointed at** | Named the way a person would say it: its visible label, then what kind of thing it is. "Player controls", "Send button", "“Release notes” heading". | `div · “Player controls”`, `h3`, `span.label`, CSS selectors |
| **describe** | Type or say what you want. "Describe a change." | prompt, instruct, query |
| **request** | What you described, as text ("Past requests"). | prompt (in the UI) |
| **Send** | Send what you described to Morse. The button and Enter. | Run, Submit, Go |
| **Stop** | Stop Morse while it is working. Nothing is left behind. | Cancel, Abort |
| **Save** | Keep a change as a mod. | Keep, Apply, Commit |
| **Undo** | Remove the change you just made. | Revert, Roll back |
| **Mods panel** | The list of mods for this page or app, where you turn them on and off, share, edit and delete them. Button: "Mods". | mods list, manager, dashboard |
| **turn on / turn off** | What the switch next to a mod does. | enable, disable, toggle, activate |
| **Edit code** | Open the code behind a mod, to read or change it. | Code, Source, Inspect |
| **share link** | A link that carries a mod. Anyone with Morse can install it. | URL, fragment link, permalink |
| **install** | Add a shared mod to Morse. Used on the share page, in the Mods panel and in the CLI. | import, add, load |
| **the model** | The AI that writes changes. Only name it when it matters (settings, errors, the footer label). | the AI, the LLM, the engine, the brain |
| **demo model** | The built-in stand-in Morse uses when no model is installed. | fake model, mock |
| **Morse helper** | The small program on your computer that connects Morse to desktop apps (`morse launch`) and turns speech into text. | daemon, host, connector, server |
| **edit tools** | The toolbar that appears on what you point at: hide, move, resize, edit text, color, text size, duplicate. Works instantly, no model. Shortcut: Edit tools. | God mode (that is the code name only), inspector |
| **direct edits** | Changes made with the edit tools. Saved together as one mod called "Direct edits". | manual edits |
| **page tools** | One-click changes for the whole page: dark mode, light mode, bigger or smaller text, hide ads and pop-ups, focus mode, turn off all mods. | quick actions, presets |
| **capture** | Save the look of something so you can rebuild it in another app. Captured things show under "Captured" in the bar. | copy, clip, clipboard |
| **voice** | Talking to Morse instead of typing. "Hold ⌥Space to talk." | dictation, speech input |
| **shortcut** | A keyboard shortcut. | hotkey, keybinding (fine in developer docs) |
| **settings** | The Settings sheet in the bar. | preferences, options, config |

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
- **Tooltips name the action, then the shortcut**: "Hide H", "Undo ⌘Z".
- **Toasts**: one short phrase has no period ("Dark mode off"); two sentences
  both get periods ("Saved “Sleep timer”. It will be here next time.").
- **Numbers and units** as people say them: "Text size 110%", "12.3s".
- **Quotes** around a mod's title or what the person said: curly “ ”.

## Error messages

An error says **what went wrong, in plain words**, then **the one thing to try**.

```
<What went wrong>. <The one thing to try>.
```

- Lead with what happened to the person, not with a code. Put codes and raw
  error text after, if at all: "(error 401)".
- Never blame the person. "Couldn't find a microphone", not "You have no
  microphone".
- Offer one next step, not a list. If there is nothing to do, say what Morse
  did instead ("Nothing was changed").
- Raw errors from the browser, the network or the mod's own code ("Failed to
  fetch", "x is not defined") never reach a person as is. `plainError()` in
  `runtime/src/12-errors.js` turns them into one plain sentence; the raw text
  stays in the tooltip and the console.
- In the bar, the error line starts "That didn't work:" and the detail
  follows in italics. The bar has room for about 60 characters of detail, so
  keep the message and its next step short. The button next to it is "Try again".

| Before | After |
|---|---|
| Couldn't do that: Model server returned 401 | That didn't work: *The model server refused (error 401). Check the model settings.* |
| Ollama returned 404 | Ollama couldn't answer (error 404). Check that the model is installed. |
| The model did not produce a usable change. | The model's answer had no change in it. Try other words. |
| No microphone found | No microphone found. Plug one in and try again. |
| Not a Morse share link | This isn't a Morse share link. Check that you copied the whole link. |
| Couldn't apply that edit: x | Couldn't make that edit: x. Press ⌘Z to undo it. |

## Before and after

| Where | Before | After |
|---|---|---|
| Bar, pointing | **Point** at anything to change it · or just describe it · Esc to close | **Point** at anything to change it, or just describe it · Esc to close |
| Bar, something pointed at | Type to describe a change · ⌘E to edit directly · Esc to close | Describe a change · ⌘E for edit tools · Esc to close |
| Bar, working | Writing | Writing the change |
| Bar, stopped | **Stopped** · nothing was changed · Enter to run again | **Stopped.** Nothing was changed · Enter to try again |
| Bar, result | Keep · Undo · Code · Share | Save · Undo · Edit code · Share |
| Bar, result | 4.2s · repaired once | 4.2s · needed a second try |
| Toast | Saved “Sleep timer” · it'll be here next time | Saved “Sleep timer”. It will be here next time. |
| Mods panel | Import mod… | Install a mod… |
| Mods panel tags | css · js | style · script |
| Settings | Toggle God mode | Show the edit tools |
| Share | .user.js for Tampermonkey | Download for Tampermonkey |
| Popup | Customize this page | Change this page |
| Popup | Base URL | Server address |
| CLI | In any attached window: Alt+Space to morse | In a connected app, press Alt+Space to open Morse |
| README | Customize any app in one sentence. | Change any app or website in your own words. |
