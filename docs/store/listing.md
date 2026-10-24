# Chrome Web Store listing

Copy each block into the matching field of the developer dashboard.

## Name

Morse

## Short description (132 characters at most)

The manifest's description is used, so keep the two the same:

```
Change any website in your own words. Point at something, describe the change, and your model makes it while you watch.
```

(114 characters.)

## Category

Productivity. Language: English.

## Detailed description

```
Morse lets you change any website in your own words.

Press the shortcut, point at something on the page, and say what you want: "hide Shorts", "make this easier to read", "add a word count under the message box". Morse makes the change right there, while you watch. If you like it, save it, and it is there every time you come back.

What you can do
• Hide what you never use, restyle what tires your eyes, or add the button a site forgot.
• Watch it change: the new look shows up while the change is being written.
• Ask for a follow-up ("a bit smaller") or undo it. Every change can be removed completely.
• Use the edit tools without any model: hide, move, resize, rename, recolor, change text size.
• Page tools in one click: dark mode, bigger text, hide ads and pop-ups, focus mode.
• Easier to use: higher contrast, bigger click targets, an easier to read font, a reading ruler, Read aloud, and Check this page.
• Ask about a page instead of changing it, and Morse points at the answer.
• Share a change as a link. Before anyone installs a shared change, Morse shows in plain words what it does.

Your model, your account
Morse has no account and no server. The changes are written by a model you already have:
• Claude Code or Codex, through the free Morse helper on your computer (npm install -g morse-cli), or
• an Anthropic API key, pasted into Morse's settings.

Privacy
What you pointed at and what you asked for go to the model you chose, and nowhere else. Your changes stay in your browser. Morse collects nothing. The full policy: https://sam-siavoshian.github.io/RRAA/site/privacy.html

Open source
Morse is MIT licensed. Read every line: https://github.com/sam-siavoshian/RRAA

Tip: in chrome://extensions, open Morse's details and turn on "Allow User Scripts". Changes that only restyle a page work without it. Changes that add buttons or features need it, and Morse tells you which of your changes are waiting for it.
```

## Links

- Homepage: https://sam-siavoshian.github.io/RRAA/site/
- Support: https://github.com/sam-siavoshian/RRAA/issues
- Privacy policy: https://sam-siavoshian.github.io/RRAA/site/privacy.html

## Single purpose

```
Morse changes the website you are on in the way you describe: you point at part of the page, describe a change, and Morse applies CSS and JavaScript for that change, then keeps it for that site if you save it.
```

## Remote code

Answer: **Yes, I am using remote code**, and explain:

```
Morse runs code that is written at the user's request by the language model the user connected (their own Claude Code, Codex or Anthropic API account), and code from mods the user chooses to install. It runs only after the user asks for a change or confirms an install, and only on the site it was made for. It runs only through the chrome.userScripts API, which the user turns on with "Allow User Scripts". With it off, Morse runs no such code at all: it only adds the change's CSS, and tells the user which changes are waiting. The extension never runs strings as code in any other way (no eval, no new Function, no scripting.executeScript with generated code). The extension's own code is all in the package; nothing is loaded from a Morse server.
```

Every place that could run code is listed in docs/store/README.md, "Code that
Morse runs", and `tests/store.test.js` checks the source and the built zip.

## Data usage (privacy practices tab)

Check what is true, as the privacy policy says:

| The form asks about | Answer | Why |
|---|---|---|
| Personally identifiable information | No | |
| Health, financial, authentication, personal communications, location | No | The API key is stored locally and only sent to the provider it is for, as the user's own credential. Page text sent to the model can include such content; that is covered by "Website content". |
| Web history | Yes | The address and title of the page are sent to the user's chosen model with a request. |
| User activity | No | |
| Website content | Yes | The HTML and text of what the user pointed at, and the page outline, are sent to the user's chosen model with a request. |

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.
