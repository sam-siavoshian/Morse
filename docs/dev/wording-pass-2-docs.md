# Wording pass 2: docs and website

A second plain-words pass over everything a person reads outside the UI
string catalog: the README, CONTRIBUTING, the changelog, the user pages in
`docs/`, the website (landing page, gallery, Try it here), the privacy
policy, the store listing, the launch kit and Morse Desktop's window. The
developer docs got a lighter pass: fewer semicolons, no cute words.

The rules are in [How Morse talks](../WRITING.md): short everyday words, one
idea per sentence, active voice, lead with the action, plain labels for
headings, no rhetorical questions, no semicolons in prose, no hype. Only
VSCodium, Obsidian and Joplin are named as examples of desktop apps, since
they are the ones [tested](../desktop.md#tested-on). Untested apps are named
only where a page says they are not tested.

## Biggest changes

| Where | Before | After |
|---|---|---|
| README, first line | Morse lets you change any website or desktop app by saying what you want. | Change any website or desktop app in your own words. |
| README, install | Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder `morse extension` prints. | Open `chrome://extensions` and turn on **Developer mode**. Click **Load unpacked** and choose the folder that `morse extension` prints. |
| README, Status | **Verified** / **Not verified yet** | **Tested** / **Not tested yet** |
| Landing, hero | Press a shortcut, point at something and say what you want. Your own model makes the change in the running app while you watch. | Point at something and say what you want. The app changes while you watch. Morse uses the model you already have. |
| Landing, step 3 | **Keep it.** Save keeps it, and Morse brings it back every time you open the app. Undo puts it back the way it was. | **Save it.** Save keeps it for next time. Undo puts the app back. |
| Landing, step 2 | **Say the change.** … Your model writes the change and you see it as it happens. | **Describe the change.** … You see the change while your model writes it. |
| Landing, install | Get Morse. Pick where you want to change things. | Install Morse. Choose websites, desktop apps or both. |
| Landing, FAQ | If an update moves things around and a mod stops working, Fix it in the Mods panel asks your model for a new version. | If an update breaks a mod, click Fix it in the Mods panel. Your model writes a new version. |
| Try it here | Try Morse right here. Nothing to install. | Try Morse here, with nothing to install. |
| Try it here | Sample answers in this demo. With Morse installed, your own AI writes any change you ask for. | This demo uses sample answers. Install Morse, and your own model writes any change you ask for. |
| Getting started | Have a terminal and the `morse` command? **Use a terminal instead** shows one command… | If you use a terminal, click **Use a terminal instead**. It shows one command… |
| Getting started | Not ready to connect a model? **Not now: try it with a sample answer** lets you… | To try it before you connect a model, click **Not now: try it with a sample answer**. |
| Ask and find | **Show me** walks you through them, one step at a time. | Click **Show me**. Morse shows where to click. You do the clicking. |
| Show me once | Clicking the same things over and over? Do the task by hand once… | Do a task by hand once, and Morse writes down the steps. |
| Edit tools | Like how something looks in one app? Point at it and press **⇧C**. | To reuse how something looks in another app, point at it and press **⇧C**. |
| Changing things | A result isn't final. **Follow-ups.** … | You can keep changing a result. **Ask for more.** … |
| Your style | Your words become building blocks Morse makes itself ([`core/style.js`]…): … It is style only, so it costs next to nothing when a page loads; only no autoplay… | Morse makes these itself: … They add almost no time when a page loads. Only no autoplay and dark pages add a little code. (Code links moved to “How it was tested”.) |
| Desktop apps | Slack, Discord, VS Code, Obsidian, Notion, Figma, Signal and Spotify are all built this way… `morse launch spotify` | VSCodium, Obsidian and Joplin are built this way, on **Electron**, and so are many others. `morse launch obsidian` |
| Desktop apps | Popular apps on a Mac | Other apps on a Mac (not tested) |
| Your controls | If a page closes, crashes or reloads within seconds after a mod ran, three times in a row, Morse holds that mod back… | Sometimes a page closes, crashes or reloads a few seconds after a mod runs. If that happens three times in a row, Morse holds the mod back next time… |
| Privacy and safety | Every change the model writes is shown, can be undone, and never happens without you asking. Pages can contain text written to trick the model; this is one reason why. | You see every change the model writes, and you can undo it. A change never happens unless you ask. One reason: a page can hide text that tries to trick the model. |
| Privacy policy | use Refine or Fix | ask for more on a result, or use … a "Fix it" |
| Troubleshooting | ## Still stuck? | ## If it still doesn't work |
| Changelog | ### Change apps in your own words / ### Your model / ### Installing | ### Describe a change / ### Models / ### Install |
| Store listing | Your model, your account | Models |
| Store caption | Say what to change. You see it change while it is being written. | Describe a change. You see it while your model writes it. |
| Launch kit | Twelve seconds later, it was one. | It took about 12 seconds. |
| Launch kit | **No tray app yet.** | **Morse Desktop was tested on Linux only.** Its tray menu, and the macOS and Windows builds, weren't tried yet. |
| Morse Desktop | Something wrong? Troubleshooting says what each message means. | If something is wrong, Troubleshooting says what each message means. |
| Docs index | New here? Start with Getting started. | If you're new, start with Getting started. |
| Developer guide | core/ shared brain: … · One page that sells in a minute | core/ shared logic: … · The landing page, in order |

## Left as is

- Messages quoted from the UI (Troubleshooting, Getting started) stay word
  for word. They come from `core/locales/en.js`, which has its own pass.
- The privacy policy keeps the three lines `tests/words.test.js` allows on
  purpose (“API address you entered”, “the CSS rules that style”, “Anthropic
  API key”).
- “sample answers” stays in Try it here's unknown-request note, which
  `tests/try.test.js` checks.
- `Contents/MacOS` is a real folder name inside a Mac app.
