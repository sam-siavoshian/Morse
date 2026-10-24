# Chrome Web Store listing

Copy each block into the matching field of the developer dashboard.
[SUBMIT.md](SUBMIT.md) says which tab and field each one goes in.

## Name

Morse

(From the manifest; the dashboard shows it, you don't type it.)

## Summary (132 characters at most)

The dashboard takes this from the manifest's `description`, so the two are
the same (`tests/store.test.js` checks it):

```
Change any website in your own words. Point at something, say what you want, see it change. Uses Claude Code, Codex or an API key.
```

(130 characters.)

## Category

**Make Chrome Yours → Functionality & UI.** Morse changes how websites look
and work; that is what this category is for. (If the dashboard you see has
the older single list, pick **Productivity**.) Language: **English**.

## Description

```
Morse lets you change any website in your own words.

Open Morse on a page, point at something, and say what you want: "hide the sidebar", "make this easier to read", "add a copy button to every code example". You see the page change while Morse writes the change. If you like it, press Save and it becomes a mod. A mod is a change you saved. Morse brings it back every time you open that site.

What you can do
• Hide parts you never use, make text easier to read, or add a button a site is missing.
• Watch it change. The new look shows up while the change is being written.
• Ask for a follow-up ("a bit smaller"), or undo it. Nothing is saved until you press Save.
• Use the Edit tools to hide, move, resize, recolor or rename part of a page at once, with no typing.
• Page tools in one click: dark mode, bigger text, hide ads and pop-ups, focus mode.
• Easier to use: higher contrast, bigger click targets, an easier to read font, a reading ruler, Read aloud and Check this page.
• Ask a question about a page instead of changing it, and Morse points at the answer.
• See all your mods for a site in the Mods panel, and turn each one on or off.
• Try mods other people made, and share yours as a link. Before you install a mod from someone else, Morse says in plain words what it does.
• Morse speaks English, Spanish, German, French, Brazilian Portuguese, Simplified Chinese, Japanese, Persian and Arabic. You can describe changes in any language.

Your model, your account
Morse has no account and no server of its own. Changes are written by a model you already use:
• Claude Code or Codex, through the free Morse helper on your computer (npm install -g morse-cli, then morse setup), or
• an Anthropic or OpenAI API key, pasted into Morse's settings.
The welcome page walks you through it. Until a model is connected, you can try Morse on a practice page.

Changes that add buttons or features
Changes that only restyle a page work right away. Changes that add buttons or features need one switch: in chrome://extensions, open Morse's details and turn on "Allow User Scripts". Morse tells you when a change is waiting for it and takes you there.

Privacy
When you ask for a change, what you pointed at and what you asked for go only to the model you chose. Your mods stay in your browser. Morse has no analytics and sends nothing to the people who make it. Full policy: https://sam-siavoshian.github.io/RRAA/site/privacy.html

Open source
Morse is free and MIT licensed. Read every line: https://github.com/sam-siavoshian/RRAA
```

## Links (Store listing tab)

- Homepage URL: `https://sam-siavoshian.github.io/RRAA/site/`
- Support URL: `https://github.com/sam-siavoshian/RRAA/issues`

## Single purpose (Privacy tab)

```
Change any website in your own words.

You open Morse on a page, point at part of it and say what you want changed. Morse has your model write that change and shows it on the page. If you save it, Morse brings it back whenever you visit that site. Everything else in Morse (the Edit tools, Page tools, the Mods panel, sharing) serves that one purpose: changing the websites you use.
```

## Permission justifications (Privacy tab)

One box per permission. The longer notes, and where each is used, are in
[permissions.md](permissions.md).

**storage**
```
Keeps the user's saved changes (mods), their settings, their past requests and, if they add one, their API key, in the browser.
```

**scripting**
```
Adds the rest of Morse's own interface (ui.js, a file in the package) to a page the first time the user opens Morse there, and runs one fixed function from the package in the popup to check whether Morse is on the current tab. It never runs code that is passed to it.
```

**userScripts**
```
The only way Morse runs the code of a change: the user's own changes, written by their model at their request, and mods they chose to install after reviewing them. The code runs in an isolated world, only on the site it was made for, and only after the user turns on "Allow User Scripts". With it off, Morse runs no such code; it adds only the change's style and tells the user which changes are waiting.
```

**tabs**
```
Reads the address of the active tab, so Morse shows that site's mods and can explain, in the popup, why it can't work on Chrome's own pages (their addresses are only visible with this permission). Also finds Morse's own welcome tab if it is already open instead of opening another, opens Morse's pages, and reloads a tab when the user asks.
```

**downloads**
```
Saves a file to the Downloads folder when the user asks: a mod file, a copy of a mod for Tampermonkey, a backup of all their mods, a mod pack, or a before-and-after picture.
```

**Host permission (<all_urls>)**
```
Morse's purpose is to let the user change any website they visit. Its bar has to open on whatever page the user is on, and their saved changes have to come back on the sites they were made for, so the content script runs on all sites. It sends nothing from a page until the user uses Morse there. It also lets Morse take a picture of the visible tab when the user asks it to describe a picture on the page.
```

## Remote code (Privacy tab)

Answer: **Yes, I am using remote code.** Justification:

```
Morse runs code that is not in the package in two cases, both started by the user: (1) the code of a change the user asked for, written at that moment by the language model the user connected (their own Claude Code, Codex, Anthropic or OpenAI account); (2) a mod the user chose to install from a share link, a file, a pack or the gallery, after Morse showed them in plain words what it does and let them read its code.

This code runs only through the chrome.userScripts API (userScripts.execute in a USER_SCRIPT world), only on the site it was made for, and only after the user turns on "Allow User Scripts" for Morse. With that off, no such code runs at all: Morse adds only the change's style and tells the user which changes are waiting.

Code the model writes comes straight from the user's own model account; it is never fetched from a server run by Morse's developer. Morse downloads mods only from the public gallery (mod files on the project's GitHub Pages site, https://sam-siavoshian.github.io/RRAA/site/mods/, added by the project's maintainer through the public repository) or from a pack address the user pastes, and a downloaded mod runs only after the user opens its review and clicks Try it, Install or Update. The extension never runs strings as code any other way: no eval, no new Function, no remote scripts, and chrome.scripting only runs files from the package. All of the extension's own code is in the package.
```

Every place that could run code is listed in [README.md](README.md), "Code
that Morse runs", and `tests/store.test.js` checks the source and the build.

## Data usage (Privacy tab)

Checked against [docs/privacy.md](../privacy.md) and the code. Tick exactly
these:

| The form asks about | Tick | What it is in Morse |
|---|---|---|
| Personally identifiable information | No | Morse asks for none. (Text on a page the user points at can include names; that is "Website content".) |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | **Yes** | The API key the user may paste. It is kept in the browser and sent only to the service it is for (api.anthropic.com or api.openai.com, or the address the user set), as the user's own sign-in. |
| Personal communications | No | Morse reads no mail or messages on its own. (If the user points at a message and asks about it, that text is sent as "Website content".) |
| Location | No | |
| Web history | **Yes** | The address and title of the page are sent to the user's model with each request. |
| User activity | **Yes** | For "Show me once", the steps the user did while recording (what they clicked and typed; password and card fields are left out) are sent to their model when they press Send. Voice: when the user talks to Morse, the recording goes to the Morse helper or to OpenAI to become text. |
| Website content | **Yes** | The HTML of what the user pointed at, the page's headings and labels around it, and, for "Describe this picture", a picture of it, are sent to the user's model with a request. |

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://sam-siavoshian.github.io/RRAA/site/privacy.html`

## Screenshots and captions

Upload the five files in [screenshots/](screenshots/) in this order. The
dashboard doesn't ask for captions; these are for the description, a post
about the launch, or alt text.

| File | Caption |
|---|---|
| 1-describe-a-change.png | Say what to change. You see it change while it is being written. |
| 2-save-what-you-like.png | Add what a site is missing. Save it, and it is there every time you come back. |
| 3-your-mods.png | Your saved changes for a site in one place. Turn each one on or off. |
| 4-mods-others-made.png | Try changes other people made. Save the ones you like. |
| 5-edit-tools.png | Edit tools change the page at once: hide, move, resize, recolor, rename. |
