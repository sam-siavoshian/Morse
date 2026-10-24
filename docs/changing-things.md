# Changing things

Everything starts in the bar. Press the shortcut, point at something, say
what you want, and watch it change.

```
press ⌥Space ─▶ point ─▶ "add a sleep timer" ─▶ ▦▦▦ the model writes the change ▦▦▦ ─▶ you see it ─▶ Save · Share
```

![Morse adding a sleep timer to a music player](screenshots/clip-sleep-timer.gif)

*Recorded by Morse. The model's answers in this clip are played back from a
file so it comes out the same every time. The same steps with real Claude
Code answers are in [screenshots/claude-code](screenshots/claude-code).*

## Point

Press **⌥Space** (Ctrl+Shift+Space on Windows and Linux). The bar opens and
Morse waits for you to point. Move the mouse over the part you want to change
and click it. The bar names what you pointed at, the way a person would say
it: “Player controls”, “Send button”.

To change the whole page, don't point. Just describe the change.

## Describe

Type what you want and press **Enter**: “add a sleep timer”, “hide the ads”,
“make this text bigger”, “show a word count under this box”. One sentence is
enough. Or hold the shortcut and say it (see [Voice](#voice)).

For ideas, press **F1** in the bar. When you point at something, the bar
also suggests a few changes for it: **Tab** picks one, **←** and **→** move
between them.

| | |
|---|---|
| ![](screenshots/121-electron-bar.png) The bar, under the app's own menu bar | ![](screenshots/63-suggestions.png) Suggestions for what you pointed at |

## Watch it happen

While the model writes, what you pointed at turns into a grid of small
squares, and the bar shows the change as it is written. Changes to how things
look show up while the model is still writing. When it's done, the grid
sweeps away and you see the result.

If the change doesn't work the first time, Morse shows the model what went
wrong and it tries once more. The bar then says “needed a second try”.

New buttons, panels and restyles should look like they came with the app.
The model sees the app's own colors, fonts, icons and a few of its buttons
and lists, and is asked to reuse them, in light and dark mode. Then, with
**Polish changes** on, Morse looks at what it added or restyled once more:
the bar says “Checking that it fits the app”, and anything that looks out of
place is fixed before you see the result. This takes a few seconds more. Turn
it off in Settings, under Changes. Small changes, like hiding something or
making text bigger, skip it.

Press **Esc** at any time to stop. Nothing is left behind.

| | |
|---|---|
| ![](screenshots/122-electron-working.png) Working on the player controls | ![](screenshots/04-the-magic-moment.png) The grid over what you pointed at, and the change as it is written in the bar |
| ![](screenshots/05-fixes-its-own-bugs.png) The first try failed, so the model gets the error and tries again | ![](screenshots/08-the-new-feature-works.png) The new sleep timer counting down |
| ![](screenshots/09-css-applies-while-it-writes.png) A new look for the whole page, shown while it is written | ![](screenshots/65-cancelled.png) **Esc** stops Morse. Nothing was changed |

## Save or Undo

When the change is done, the bar shows what it made and how long it took.

- **Save** keeps it. It becomes a mod, and Morse brings it back every time you
  open that site or app, even after a restart. **Enter** with nothing typed
  also saves.
- **Undo** takes it off the page. Nothing is saved.
- **Edit code** shows the code the model wrote, if you want to read or change
  it.
- **Share** makes a link, an image or a file to send to someone. See
  [Mods](mods.md#share-a-mod).

| | |
|---|---|
| ![](screenshots/123-electron-result.png) The result: a sleep timer button (☾) next to the player | ![](screenshots/124-electron-mod-back.png) Quit the app and open it again: the change is back |
| ![](screenshots/27-news-restyling-live.png) A cluttered news site, restyled while the model writes | ![](screenshots/29-news-after.png) After |
| ![](screenshots/24-web-word-count-works.png) A live word count, on a site with strict security settings | ![](screenshots/25-web-new-button.png) “add a button that copies the conversation as markdown” |

## Keep improving it

A result isn't final.

- **Follow-ups.** Type under the result, like “make it bigger” or “use icons
  instead”, and press **Enter**. The model gets your first request, the code
  as it is now and your follow-up, and changes the same mod.
- **Step back.** **⌘Z** (Ctrl+Z) goes back one version.
- **History.** Every saved mod keeps its last 20 versions. Open the Mods panel
  (**⌥⇧M**) and choose **History** on a mod. Click a version to bring it back.
- **Change.** On a saved mod in the Mods panel, **Change** opens the bar on it,
  so you can describe what to change.
- **Fix it.** When a saved mod stops working, its row in the Mods panel says
  so, and **Fix it** asks the model to repair it. See
  [Mods](mods.md#when-a-site-changes).

| | |
|---|---|
| ![](screenshots/40-refine.png) A follow-up typed under the result | ![](screenshots/41-history.png) **History**: three versions; click one to bring it back |

## Voice

Tap the microphone in the bar, or hold the shortcut: a tap opens Morse, and
holding it talks. Your words appear as you speak. Let go and Morse starts on
the change. Turn on **Send after a pause** in Settings to send as soon as you
stop talking.

- **In Chrome**, Chrome turns your speech into text.
- **In desktop apps**, the Morse helper does it, with your OpenAI key or with
  Whisper if it's installed on your computer. Setup:
  [Models and setup](models.md#voice-in-desktop-apps).

![Hold the shortcut to talk: your words appear as you speak](screenshots/60-voice.png)

## Shortcuts and Settings

Open Settings from the slider button in the bar, or with **⌘,** (Ctrl+,).
There you can change every shortcut: open Morse, talk, the Mods panel, the
Edit tools, and the off switch. Morse refuses keys that would cause trouble,
like ⌘Q or Alt+F4.

The defaults are ⌥Space on macOS and Ctrl+Shift+Space on Windows and Linux,
where Alt+Space opens the window menu (or KRunner on KDE). Morse's own
button in Chrome's toolbar uses Ctrl+Shift+Y (⌘⇧Y), so it never takes the
keys Morse uses in the page. The full list is in
[Getting started](getting-started.md#shortcuts).

In the bar:

- **↑** and **↓** go through your past requests in this app.
- **Shift+Enter** starts a new line.
- **Esc** or **⌘.** stops Morse.
- **?** shows every shortcut you have.

When the bar closes, you're back where you were, and the app gets every key
except your Morse shortcuts.

| | |
|---|---|
| ![](screenshots/61-settings.png) **Settings** | ![](screenshots/62-hotkey-recorder.png) **Change a shortcut**: Morse refuses keys that would quit the app |
| ![](screenshots/64-shortcuts.png) **?** shows the shortcuts you have | ![](screenshots/21-web-point.png) Pointing at a chat box: the bar moves out of your way |

Settings are kept in Chrome's sync storage for the extension, and in
`~/.morse/settings.json` for desktop apps.
