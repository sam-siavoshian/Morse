# Easier to use

Some apps are hard to read, hard to click, or never stop moving. Page tools
have an **Easier to use** item that opens a group of tools beside the menu
(click it, or press →) and changes that for the site or app you're on, at
once and with no model.

Each one is a small mod Morse makes itself. It stays on for that site.
Clicking it again turns it off and puts the page back exactly as it was.

![Easier to use, beside Page tools, with three tools on](screenshots/100-easier-to-use.png)

## The tools

- **Higher contrast**: text darker, to at least 7 to 1 against its
  background. Faint borders get stronger, and faded text goes back to full
  strength.
- **Bigger click targets**: buttons, links and fields at least 44 by 44
  pixels. Links inside sentences stay as they are.
- **Easier to read font**: a plain font with a little more space between
  letters, words and lines. Lines stop at about 70 characters, and text is
  never stretched to fill a line.
- **Dyslexia-friendly letters**: OpenDyslexic, Atkinson Hyperlegible or
  Lexend if one is on your computer, or else Verdana. Nothing is downloaded.
- **Underline links**
- **Stop animations**: animations jump to their end, video and sound that
  start by themselves pause, and moving pictures show their first frame.
- **Focus outline everywhere**: a ring you can see on any background when you
  use the keyboard.
- **Reading ruler**: a band that follows the pointer and dims the rest.
- **Hide distractions**: cookie bars, chat bubbles and sticky announcements.
  Never the site's header or menus.

![Higher contrast, before and after](screenshots/103-before-after-contrast.png)

## Read aloud

**Read aloud** reads what you selected, what you pointed at, or the main text
of the page, a sentence at a time, and marks the sentence it's reading. You
can play, pause, go to the previous or next sentence, and choose from five
speeds. **Esc** stops it.

It uses your computer's own voices, so it works offline. (In Chrome, if your
computer has no voice installed, Chrome may use an online one.)

![Read aloud: the sentence being read is marked](screenshots/101-read-aloud.png)

## Check this page

**Check this page** looks for common problems:

- pictures with no description
- buttons and links with no name
- form fields with no label
- text too light to read (measured, not guessed)
- things too small to click
- video or sound that plays by itself

Every place gets a numbered marker, and each kind of problem a **Fix it**
button. What Morse can work out itself is fixed at once: a name from a
tooltip, an icon or where a link goes, a darker color, a bigger size. These
fixes are saved in one mod called “Accessibility fixes”. What needs judgment
becomes one exact request to the model, which you save or undo like any
change.

![Check this page: 17 places, each with a marker, and Fix it](screenshots/102-check-page.png)

## Describe this picture

Point at a picture and press the picture button in the Edit tools. The model
says in a sentence or two what it shows, and **Save as alt text** keeps that
description for screen readers. It's saved in the “Accessibility fixes” mod.

This needs a model that can look at pictures: Claude Code, or an Anthropic
or OpenAI API key. Codex can't, and Morse says so.

Checked once with real Claude Code (haiku) on a demo library site's chart:
“A bar chart titled “Visitors by month” for Riverside Library from January to
June shows visitor counts rising each month: 1,200 in January, … 3,400 in
June”, in about 6 seconds.

For developers: the tools are made by [`core/a11y.js`](../core/a11y.js), and
the screenshots come from [`demo/shoot-a11y.js`](../demo/shoot-a11y.js) on a
[demo library site](../demo/sites/a11y/index.html) with problems planted on
purpose.
