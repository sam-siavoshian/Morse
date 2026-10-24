# Bring a feature from one app to another

Like the command palette in VS Code, the dark mode switch on one site, or the
“Jump to” box on another? Take it, and bring it into the app you use.

1. In the app or site that has it, open Morse and choose **Take this**.
2. In the app or site that should have it, open Morse and choose
   **Bring here…**, then press **Enter**.

Morse builds it there from that app's own fonts, colors and corners, so it
looks like it was always there. It works the way it did where you took it:
the same keys open it, typing narrows it, Esc closes it. The result is a
change like any other: **Save**, **Undo**, **Share**.

## Take this

**Take this** is a button under the box in the empty bar, and in the **⋯**
menu.

- **Something you can see** (a switch, a toolbar, a button): point at it,
  then choose **Take this**. It is taken at once.
- **Something that opens and closes** (a palette, a menu, a notice): choose
  **Take this** without pointing. Morse watches while you open it the way
  you usually do, and use it once. Then press **Stop**, or the Morse shortcut.
  Morse takes what opened, and writes down how you opened it (“Press
  Ctrl+Shift+P”).

Then the model gives it a name and says in a few lines what it does. The bar
shows both.

| | |
|---|---|
| ![](screenshots/bring-14-vscodium-take.png) **Take this** in VSCodium: open the command palette while Morse watches | ![](screenshots/bring-15-vscodium-taken.png) **Taken**: the model named it and wrote what it does |
| ![](screenshots/bring-16-rubygems-before.png) **RubyGems.org in Chrome**, before | ![](screenshots/bring-17-rubygems-palette.png) **Brought**: Ctrl+Shift+P opens a palette of this page's own things, and a **Commands** button sits in the header, in RubyGems' own font, red and corners |

These pictures are real: VSCodium and RubyGems.org, Claude Code (sonnet named
it, opus built it). The palette was taken in the desktop app and brought into
Chrome, which shares the list through the Morse helper.

More, from real sites:

| | |
|---|---|
| ![](screenshots/bring-08-go-take.png) **pkg.go.dev**: its “Jump to” box (press F), taken while Morse watches | ![](screenshots/bring-09-node-before.png) **The Node.js docs**, before |
| ![](screenshots/bring-10-node-jump-to.png) **Brought**: F opens “Jump to” in Node's green and font, and a “Jump to…” link joins the page's own links | ![](screenshots/bring-11-node-jumped.png) **It works**: Enter goes to `filehandle.readFile()` |
| ![](screenshots/bring-12-pypi-switch.png) **The Node.js docs' dark mode switch**, brought into PyPI: the moon sits in PyPI's top bar | ![](screenshots/bring-13-pypi-dark.png) **Clicked**: PyPI in dark colors of its own, not a filter over the page |

## Bring here

Open Morse where you want it and choose **Bring here…**. It lists what you
took, newest first. Pick one: the bar says what it will do (“Add “Command
palette” from VSCodium here”). Point at a spot first if you want it there,
add your own words if you like, and press **Enter**.

You can also type it: “add the command palette from VSCodium here”. If
you took something with that name, Morse brings it. If you didn't, and you
name a well-known feature of another app (“add Linear's keyboard shortcuts
list here”), the model builds it from what it knows.

## Where it is kept

What you took is listed in the **Mods** panel under **Taken from other
apps**, with **Bring here** and **Delete**. A mod you brought says where it
came from: “Taken from VSCodium”.

- **Chrome and desktop apps share the list** once Morse in Chrome is paired
  with the Morse helper on your computer ([Models and setup](models.md)).
  Take VS Code's palette in the desktop app, bring it into a website in
  Chrome, or the other way around. When they aren't paired, the panel says
  so: “Only in Chrome” or “Only in desktop apps”.
- **What is kept:** the shape of the feature (its parts and their styles),
  how you opened it, a small picture, its name and the app it came from. Long
  text is cut, and the same rules as everything Morse reads apply: no
  passwords or what you typed into fields, no email addresses, no secret
  looking values. The picture stays on your computer: it never goes to the
  model.

## Without a model, on the demo apps

The same steps on two demo apps, with the stand-in model Morse's tests use:
Codepad (a small code editor) and Inkwell (a notes app).

| | |
|---|---|
| ![](screenshots/bring-01-take-this.png) **Take this**, under the box | ![](screenshots/bring-02-watching.png) **Watching**: each step in the strip |
| ![](screenshots/bring-03-taken.png) **Taken**, with what to do next | ![](screenshots/bring-04-bring-here.png) **Bring here…** in Inkwell |
| ![](screenshots/bring-05-bringing.png) **Bringing**: press Enter | ![](screenshots/bring-06-brought.png) **Brought**: Ctrl+Shift+P in Inkwell, in its font and corners |
| ![](screenshots/bring-07-mods-panel.png) **The Mods panel**: “Taken from Codepad”, and Taken from other apps | |

## How well it works

Checked on October 24, 2026 with real Claude Code (Automatic: sonnet names
what you took, opus builds it) by [`evals/bring.js`](../evals/bring.js), which
checks that the brought feature opens and works, and that its fonts, colors
and corners are ones the page already uses:

- **pkg.go.dev's “Jump to” → the Node.js docs**: works, fits (about 60 s,
  one second try).
- **The Node.js docs' dark mode switch → PyPI**: works, fits (about 20 s).
- **VSCodium's command palette → RubyGems.org** (desktop app to Chrome):
  works, fits (about 45 s, one second try).

What to expect: the model builds it from what it can see on the page. The
first try at “Jump to” looked for links the Node.js docs write differently;
Morse noticed the list would be empty and the model fixed it. A dark mode
built by an earlier version was a filter over the whole page; it now uses
the app's own colors. Give it a moment, and say what to change if it isn't
right (“make the list taller”).

For developers: [How Morse works](dev/architecture.md#take-this-bring-here).
The check with a real model is [`evals/bring.js`](../evals/bring.js) (cases
in [`evals/bring-cases.json`](../evals/bring-cases.json)); the test without a
model is [`tests/take-ui.test.js`](../tests/take-ui.test.js); the pictures of
the demo apps come from [`demo/shoot-take.js`](../demo/shoot-take.js).
