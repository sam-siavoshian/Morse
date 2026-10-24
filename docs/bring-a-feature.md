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

<!-- pictures -->

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

## How well it works

<!-- results -->

For developers: [How Morse works](dev/architecture.md#take-this-bring-here).
The check with a real model is [`evals/bring.js`](../evals/bring.js) (cases
in [`evals/bring-cases.json`](../evals/bring-cases.json)); the test without a
model is [`tests/take-ui.test.js`](../tests/take-ui.test.js); the pictures of
the demo apps come from [`demo/shoot-take.js`](../demo/shoot-take.js).
