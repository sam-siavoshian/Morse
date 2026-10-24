# Privacy and safety

Morse has no account and no server of its own. It collects nothing about you
and sends nothing to the people who make it. This page says what does leave
your computer, when, and what mods can do. The formal version is the
[privacy policy](privacy.md).

## What goes to your model

Only when you send a request: a change, a question, a follow-up, Fix it,
Explain this page or Describe this picture. And, if you turned on **Fix my
mods automatically when a site changes** (it is off unless you turn it on),
when a saved mod stops working.

What is sent:

- what you typed or said
- the address and title of the page or app window
- what you pointed at, and an outline of the page around it (its layout,
  headings and button labels). This can include text on the screen, like
  message previews or names. What you typed into fields, hidden fields,
  email addresses and things that look like passwords or keys are left out.
- how what you pointed at is styled
- for follow-ups and Fix it: the mod's code, and what went wrong
- for Describe this picture: the picture

Where it goes depends on the model you chose:

| You chose | It goes to |
|---|---|
| Claude Code | Anthropic, through the `claude` program on your computer, under your Claude account |
| Codex | OpenAI, through the `codex` program on your computer, under your ChatGPT or OpenAI account |
| Anthropic API key | Anthropic, or the server address you set |
| OpenAI API key | OpenAI, or the server address you set (for example a model running on your own computer) |

Claude Code and Codex have their own privacy terms. Morse starts them with
all their tools turned off, in an empty folder, so they can only write text
back.

Pointing, the Edit tools, Page tools, Easier to use, Read aloud and Check
this page run on your computer and send nothing to the model.

## Other things that can leave your computer

- **The gallery list.** To show mods other people made for the site you're
  on, Morse downloads the gallery's list from GitHub at most once a day. The
  page you're on never sees this. Turn it off with **Show mods others made**
  in Settings.
- **Voice.** In Chrome, Chrome turns your speech into text, which sends it to
  Google. In desktop apps, the Morse helper uses OpenAI with your key, or
  Whisper on your computer (then nothing leaves it).
- **Share links.** A share link holds the whole mod after the `#`. Browsers
  never send that part to a server, so the install page never sees the mod.
  Who you send the link to is up to you.
- **Submit to the gallery** and **Post on X** open a page with things filled
  in. Nothing is posted until you post it.
- **Settings sync.** In Chrome, your Morse settings (shortcuts, bar position
  and the like) are kept in Chrome's sync storage. Your keys and mods are not.
- **Newer version.** `morse doctor` asks npm (registry.npmjs.org) whether a
  newer Morse is out, at most once a day. Nothing about you goes with it.
  Turn it off with `MORSE_NO_UPDATE_CHECK=1`.

## What stays on your computer

- Your mods: in Chrome's storage for Morse, and in `~/.morse/mods` for
  desktop apps.
- Your API keys: in Chrome's storage for Morse, or in `~/.morse/config.json`,
  which only you can read. A key is only sent to the service it is for.
- Your past requests, backups and exports.

## What mods can do

A mod is code that runs inside the page or app it is for. It can do anything
that page can, and see what you see there.

- The model is told not to send data anywhere, not to load code from
  elsewhere, and not to build code while it runs. **Nothing enforces that
  yet.**
- Before you install a mod someone shared, Morse says what it does in plain
  words, with a clear note when it sends data to another website or reads
  what you type, and shows its code. This is a careful reading of the code,
  not a guarantee. See [Mods](mods.md#what-a-mod-does-before-you-install-it).
- Every change the model writes is shown, can be undone, and never happens
  without you asking. Pages can contain text written to trick the model; this
  is one reason why.
- In desktop apps, mods only change the app's windows. They can't reach your
  files or the rest of the app.
- [Your controls](your-controls.md): one key turns every mod off, you can
  pause Morse on a site or everywhere, a mod that slows down or freezes a
  page is paused, and a mod that keeps breaking a page is held back.

## Morse is kept apart from the page

Morse's own bar, panel and settings run apart from the page's code. A website
or app can't read your past requests, your other sites' mods, your backups or
your model settings, and can't use your model. A share page can't install a
mod by itself: only your click in Morse's own review does.

## Desktop apps

`morse launch` opens the app with a debugging port, which is how Morse
connects. While the app is open, other programs on your computer could
connect to it too, also ones another account on the same computer runs. Quit
the app to close it. Morse makes sure the port can't be reached from other
computers, and only connects when what answers is the app it started (on
Linux it also checks that no other account's program holds the port).

The Morse helper (`morse serve`) only answers on this computer, only to the
Morse extension, and only to a browser you paired with its one-time code.

For developers, the details are in
[How Morse works](dev/architecture.md#security).
