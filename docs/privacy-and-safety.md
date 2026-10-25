# Privacy and safety

Morse has no account and no server of its own. It collects nothing about you
and sends nothing to the people who make it. This page says what leaves your
computer, when, and what mods can do. For the full legal text, see the
[privacy policy](privacy.md).

## What goes to your model

Morse sends something only when you send a request: a change, a question,
asking for more, Fix it, Explain this page or Describe this picture. It also
sends when a saved mod stops working, if you turned on **Fix my mods
automatically when a site changes**. That setting is off until you turn it
on.

What is sent:

- what you typed or said
- the address and title of the page or app window
- what you pointed at, and an outline of the page around it (its layout,
  headings and button labels). This can include text on the screen, like
  message previews or names. Morse leaves out what you typed into fields,
  hidden fields, email addresses, and things that look like passwords or
  keys.
- how what you pointed at looks
- when you ask for more, or click Fix it: the mod's code, and what went wrong
- for Describe this picture: the picture

Where it goes depends on the model you chose:

| You chose | It goes to |
|---|---|
| Claude Code | Anthropic, through the `claude` program on your computer, under your Claude account |
| Codex | OpenAI, through the `codex` program on your computer, under your ChatGPT or OpenAI account |
| Anthropic API key | Anthropic, or the server address you set |
| OpenAI API key | OpenAI, or the server address you set (for example a model running on your own computer) |

Claude Code and Codex have their own privacy terms. Morse starts them with
all their tools turned off, in an empty folder. They can only write text
back.

Pointing, the Edit tools, Page tools, Easier to use, Read aloud and Check
this page run on your computer and send nothing to the model.

## Other things that can leave your computer

- **The gallery list.** To show mods other people made for the site you're
  on, Morse downloads the gallery's list from GitHub at most once a day. The
  page you're on never sees this. To stop it, turn off **Show mods others
  made** in Settings.
- **Voice.** In Chrome, Chrome turns your speech into text. To do that, it
  sends your speech to Google. In desktop apps, the Morse helper uses OpenAI
  with your key, or Whisper on your computer (then nothing leaves it).
- **Share links.** A share link holds the whole mod after the `#`. Browsers
  never send that part to a server, so the install page never sees the mod.
  You decide who gets the link.
- **Submit to the gallery** and **Post on X** open a page with things filled
  in. Nothing is posted until you post it.
- **Settings sync.** In Chrome, your Morse settings (shortcuts, bar position
  and the like) are kept in Chrome's sync storage. Your keys and mods are not.
- **Newer version.** `morse doctor` asks npm (registry.npmjs.org) whether a
  newer Morse is out, at most once a day. Nothing about you goes with it.
  To stop it, set `MORSE_NO_UPDATE_CHECK=1`.

## What stays on your computer

- Your mods: in Chrome's storage for Morse, and in `~/.morse/mods` for
  desktop apps.
- Your API keys: in Chrome's storage for Morse, or in `~/.morse/config.json`,
  which only you can read. A key is only sent to the service it is for.
- Your past requests, backups and exports.
- What you took with **Take this** ([Bring a feature](bring-a-feature.md)):
  in Chrome's storage for Morse, and in `~/.morse/taken.json`, which only you
  can read. When Chrome is paired with the Morse helper, the two share it
  over the helper on this computer. Its small picture never goes to the
  model.

## What mods can do

A mod is code that runs inside the page or app it is for. It can do anything
that page can, and see what you see there.

- The model is told not to send data anywhere, not to load code from
  elsewhere, and not to build code while it runs. **Nothing enforces that
  yet.**
- Before you install a mod someone shared, Morse tells you what it does and
  shows its code. It warns you clearly if the mod sends data to another
  website or reads what you type. This is a careful reading of the code, not
  a promise. See [Mods](mods.md#what-a-mod-does-before-you-install-it).
- You see every change the model writes, and you can undo it. A change never
  happens unless you ask. One reason: a page can hide text that tries to
  trick the model.
- In desktop apps, mods only change the app's windows. They can't reach your
  files or the rest of the app.
- [Your controls](your-controls.md): one key turns every mod off. You can
  pause Morse on a site or everywhere. Morse pauses a mod that slows down or
  freezes a page, and holds back a mod that keeps breaking a page.

## Morse is kept apart from the page

Morse's own bar, panel and settings run apart from the page's code. A website
or app can't read your past requests, your other sites' mods, your backups or
your model settings. It can't use your model. A share page can't install a
mod by itself. Only your click in Morse's own review does.

## Desktop apps

To connect to a desktop app, Morse has to open it with a switch that lets
another program control it.

**Most Electron apps get a private connection.** When Morse opens an Electron
app itself (`morse launch`, or Open with Morse in the Morse app), it gives the
app a connection that only Morse holds. It doesn't open a port. Other
programs on your computer, even ones another account runs, can't reach the
app through it. This was tested on Linux with VSCodium, Obsidian, Joplin and
Electron 10 to 45. On a Mac it works the same way, but it hasn't been tested
there yet.

What that doesn't cover:

- **Programs running as you.** Any program that runs under your own account
  can already control your apps in other ways. Morse can't protect an app
  from those, with or without this.
- **A debugging port is still used** where the private connection isn't
  possible: on Windows (not tested yet), for browsers and other Chromium-based
  apps, apps that start through a launcher (like Squirrel's `Update.exe`,
  flatpak or snap), and Electron 9 and older. It is also used when you pass
  `--port` or set `MORSE_PIPE=0`, and for `morse attach` to an app that is
  already open with a port. While such a port is open, other programs on your
  computer could connect to the app too, even ones another account on the
  same computer runs. Quit the app to close the port. Morse makes sure other
  computers can't reach the port. It only connects when the app that answers
  is the one it started. On Linux, it also checks that no other account's
  program holds the port.
- **After Morse stops or quits**, the app keeps running, and nothing else can
  use the private connection. Morse can't use it again either. To connect
  later, Morse has to open the app again. (The Morse app can connect again
  while it stays open.) If Morse crashes instead of quitting, it can't take
  its code off. Until the app restarts, pages the app opens still load
  Morse's small start-up code. That code does nothing without Morse (no bar,
  no mods).
- **An app that restarts itself** (some do after an update) starts again
  without Morse.

The Morse helper (`morse serve`) only answers on this computer. It only
answers the Morse extension, and only a browser you paired with its one-time
code.

For developers, the details are in
[How Morse works](dev/architecture.md#security).
