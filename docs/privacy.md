# Morse privacy policy

Last updated: October 24, 2026. This covers the Morse Chrome extension and the
`morse` command (the Morse helper). It is checked against the code in this
repository; if the two ever disagree, please
[open an issue](https://github.com/sam-siavoshian/RRAA/issues/new).

## The short version

- There is no Morse account and no Morse server. Morse collects nothing about
  you and sends nothing to the people who make it.
- When you ask for a change, Morse sends what it needs to write that change to
  **the model you chose**: Claude Code, Codex, or an Anthropic, OpenAI or other
  API address you entered.
- When you open the bar or the Mods panel, Morse may download **the gallery
  list** of mods other people made, from GitHub Pages. At most once a day.
- When you run `morse doctor`, the `morse` command asks npm whether a newer
  version is out. At most once a day.
- A few things you can choose to use send data elsewhere. They are listed
  below under "Only when you use them".
- Nothing else leaves your computer.

## What is sent to your model, and when

Only when you send a request: you type or say a change or a question, use
Refine or Fix, or use "Explain this page", "Describe this picture" or a
"Fix it" that needs the model. And, if you turned on "Fix my mods
automatically when a site changes" (it is off unless you turn it on), when
one of your saved mods stops working on a page.

Sent to the model you chose:

- what you typed or said
- the address and title of the page or app window
- the HTML of what you pointed at, and the page's layout, headings and button
  labels around it. This can include text that is on the screen, such as
  message previews or names.
- the CSS rules that style what you pointed at
- for Refine and Fix: the code of the mod and the error it hit
- for "Describe this picture": the picture, or a screenshot cropped to it
- for "Show me once": the steps you did on the page while it was recording,
  such as what you clicked and what you typed. What you type in password and
  card number fields is never kept or sent.

Where it goes depends on your choice:

| You chose | Sent to | Under whose terms |
|---|---|---|
| Claude Code | Anthropic, through the `claude` program on your computer | your Claude account |
| Codex | OpenAI, through the `codex` program on your computer | your ChatGPT or OpenAI account |
| Anthropic API key | api.anthropic.com, or the address you set | your Anthropic API account |
| OpenAI API key | api.openai.com, or the address you set (for example a server on your own computer) | that service |

Claude Code and Codex are separate programs with their own privacy terms.
Morse starts them and hands them the request; it does not see what they log.

Apart from that setting, Morse sends nothing to a model on its own. Opening the bar, pointing, the
edit tools, the other page tools, "Easier to use", Read aloud and "Check this
page" itself run on your computer and send nothing to the model.

## The gallery list

To show "Mods for this site", Morse downloads the list of gallery mods from
`https://sam-siavoshian.github.io/RRAA/site/mods/index.json`, and then the
mod files that match the site you are on.

- It happens only when you open the bar or the Mods panel, and the list is
  downloaded at most once a day.
- The request carries no cookies and nothing about you or the page. If you
  set a different list address in settings, the same goes to that address
  instead. GitHub,
  which hosts the files, sees your IP address and which mod files were asked
  for, as with any website. A mod file is named after the site it is for, so
  that can show that you visited that site.
- Turn it off with "Show mods others made" in Morse settings. Then nothing is
  downloaded.

## Checking for a newer version

`morse doctor` shows whether a newer version of the `morse` command is out.
To know, it asks npm, where the command is published:
`https://registry.npmjs.org/morse-cli/latest`.

- Only `morse doctor` asks. Nothing else in Morse does, and the Chrome
  extension never does.
- At most once a day. The answer (the newest version number and when it was
  asked) is kept in `~/.morse/update-check.json`.
- The request carries no cookies and nothing about you, your model, your mods
  or your pages. npm, run by GitHub, sees your IP address, as with any
  website. If you set `MORSE_UPDATE_REGISTRY` to another address, the same
  goes there instead.
- Turn it off with `MORSE_NO_UPDATE_CHECK=1` in your environment. Then
  nothing is asked and nothing is kept.

## Only when you use them

These send data somewhere other than your model, and only when you use them:

- **Voice in Chrome.** Morse uses Chrome's own speech recognition. Chrome
  sends your voice to Google to turn it into text. If the Morse helper is
  paired and can turn speech into text, or you gave Morse an OpenAI key, Morse
  also records what you say while you talk to it, and sends that recording to
  the Morse helper (which uses OpenAI or Whisper on your computer, as below)
  or to OpenAI. If you never use voice, no audio is recorded.
- **Voice in desktop apps.** The Morse helper turns speech into text with
  OpenAI (when you gave it an OpenAI key) or with Whisper on your computer
  (nothing leaves your computer).
- **Read aloud.** Morse picks a voice installed on your computer. If there is
  none, Chrome uses its default voice, which can be an online Google voice.
- **Sharing.** A share link holds the whole mod after the `#`. Browsers do not
  send that part to a server, so the install page at GitHub Pages never sees
  the mod. Sending the link is up to you. The "Post" button opens x.com with
  your request and the link filled in, and the link holds the mod. Nothing is
  posted until you post it.
- **Mod packs from an address.** When you install a pack from a web address,
  Morse downloads it from there. If you chose to get its updates, Morse checks
  that address at most once a day. The request carries no cookies and nothing
  about you or the page; that server sees your IP address, as with any
  website. "Stop updates" in the Mods panel ends it.
- **Submitting to the gallery** opens a new GitHub issue with your mod in it,
  in your browser. Nothing is posted until you click Submit on GitHub.
- **Settings sync.** Your Morse settings (shortcuts, bar position, theme,
  whether to show gallery mods) are kept in Chrome's sync storage. If you
  turned on Chrome sync, Google syncs them between your browsers. Your API key,
  your mods and your history are not in sync storage.

## What stays on your computer

- Your mods: in the extension's storage in Chrome, and in `~/.morse/mods` for
  desktop apps.
- Your API keys: in the extension's local storage, or in `~/.morse/config.json`.
  They are sent only to the service they are for.
- Your past requests, backups and exports.
- The Morse helper listens only on `127.0.0.1` (your own computer). A browser
  must be paired with a one-time code before the helper writes changes for it.

## What mods can do

A mod is code that runs inside the page or app it is for, like any userscript.
It can see what you see there. Mods you make are written by your model at your
request. Before you install a mod from someone else, Morse shows what it does
in plain words and lets you read its code. Morse does not check what a mod sends over the
network; read it, or don't install it.

In Chrome, a mod's code runs only when you turn on “Allow User Scripts” for
Morse. Until you do, Morse only changes how pages look, and says which of your
mods are waiting for it.

## Things Morse never does

- No analytics, tracking, crash reports or ads.
- No selling or sharing of data. Morse has no data to sell.
- Nothing is sent from a page until you use Morse there. Morse runs on every
  page so its shortcut works and your saved mods apply, but it only looks at
  a page to answer you.

## Children

Morse is not made for children under 13 and collects nothing from anyone.

## Changes

Changes to this policy are made in this file, so its history on GitHub shows
every change. Questions:
[open an issue](https://github.com/sam-siavoshian/RRAA/issues/new).
