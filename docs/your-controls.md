# Your controls

Mods run inside apps you're signed into, so you decide what runs and when.
None of these delete anything.

| | |
|---|---|
| ![](screenshots/95-off-switch.png) **⌥⇧0** turns every mod on the page off at once; the message turns them back on | ![](screenshots/98-popup-pause.png) Pause from Chrome's toolbar button, on one site or everywhere |

## The off switch

Press **⌥⇧0** (Alt+Shift+0) to take every mod off the page at once. They stay
off in that tab, even when you reload, until you press it again or click
**Turn back on**. Change the key in Settings, under Shortcuts.

**Turn off all mods here** in Page tools does the same from the bar.

## Pause Morse

- **On one site**: “Pause Morse on youtube.com” in the Mods panel or in the
  Morse popup (Chrome's toolbar button).
- **Everywhere**: “Pause everywhere” in the popup. The toolbar button then
  says *off*.
- **In a terminal**: `morse pause` stops every mod everywhere,
  `morse pause youtube.com` or `morse pause slack` stops them on one site or
  app, and `morse resume` starts them again.

Paused mods stay saved. Every open tab and window follows at once.

![Pause Morse on a site, from the Mods panel](screenshots/97-pause-site.png)

## Safe start

If a page closes, crashes or reloads within seconds after a mod ran, three
times in a row, Morse holds that mod back the next time and asks: **Keep it
off** or **Turn it back on**.

## Before you install

A mod someone shared with you never installs by itself. Morse first says in
plain words what it does, with a clear note when it sends data to another
website or reads what you type, and shows its code. See
[Mods](mods.md#install-a-shared-mod).

## Backups

At the bottom of the Mods panel:

- **Export all mods** saves every mod to one file.
- **Install from a file…** brings them back, on this computer or another one.

In a terminal: `morse export --all` (add `--out <file>` to choose where) and
`morse install <backup file>`.

## Where mods live

- In Chrome, in the Morse extension's own storage.
- For desktop apps, in `~/.morse/mods`, filed under each app. A mod made in
  Slack is only ever loaded in Slack.

To see what leaves your computer, and what a mod can do, read
[Privacy and safety](privacy-and-safety.md).
