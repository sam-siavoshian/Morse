# Permission justifications

Every permission in [extension/manifest.json](../../extension/manifest.json),
what it is for, and where the code uses it. Each was checked against the code
on October 24, 2026. The short text to paste into the dashboard is in
[listing.md](listing.md#permission-justifications-privacy-tab).

| Permission | What it is for | Used in |
|---|---|---|
| `storage` | Keeps the user's saved changes (mods), settings, request history and, if they add one, their API key, in the browser. Settings (shortcuts, bar position, theme, gallery on or off) are in `storage.sync`; the key, mods and history are only in `storage.local`, which content scripts can't read (`setAccessLevel` `TRUSTED_CONTEXTS`). | `extension/background.js`, `bar-host.js`, `popup.js`, `welcome.js` and the other hosts |
| `scripting` | Adds the rest of Morse's interface (`ui.js`, in the package) to a page the first time the user opens Morse there, so only the small `boot.js` runs on every page. And, in the popup, runs one fixed function from the package that reads one attribute, to tell whether Morse is on the tab. It never runs code it is given. | `extension/background.js` (`ui.load`: `files: ["ui.js"]`), `extension/popup-states.js` (`func`) |
| `userScripts` | The only way Morse runs the code of the user's own changes, and of mods they chose to install, in an isolated world on the sites they were made for; the user turns this on with "Allow User Scripts". With it off, no such code runs: only the change's style is added, and Morse says which changes are waiting. | `extension/background.js` (`execIn`, `userScriptsAvailable`), `welcome.js`, `onboarding-host.js` (only to check whether it is on) |
| `tabs` | Reads the address of the active tab to show that site's mods, and to explain in the popup why Morse can't work on Chrome's own pages (without `tabs`, `tab.url` is empty there and on Morse's own pages: checked in Chromium 153). Finds Morse's welcome tab if it is already open, opens Morse's pages, reloads a tab when the user asks. | `extension/background.js`, `popup*.js`, `onboarding-host.js`, `welcome.js` |
| `downloads` | Saves a mod file, a copy for Tampermonkey, a backup, a mod pack or a before-and-after image to the Downloads folder (`Downloads/morse/`) when the user clicks to export it. | `extension/background.js` (`download`), `extension/pack-host.js` |
| Host permission `<all_urls>` | The user can change any website they visit, so Morse's bar has to open on any page, and their saved mods have to apply on the sites they were made for. Also lets `captureVisibleTab` take a picture of the tab for "Describe this picture". | `content_scripts` in the manifest, `chrome.tabs.captureVisibleTab` in `background.js` |
| Content script on `<all_urls>` | `host.js` and `boot.js` (about 50 KB): the shortcut, saved mods' styles, and asking the worker to run their code. The rest of the interface loads on first use. It sends nothing anywhere until the user uses Morse on that page. | `extension/host.js`, `boot.js`, `ui.js` |

Not permissions, but reviewers ask:

- **`minimum_chrome_version: "138"`**: `userScripts.execute` arrived in Chrome
  135, and the per-extension "Allow User Scripts" switch that Morse's pages
  point people to arrived in Chrome 138 (before that it was Developer mode).
- **`commands`** (manifest key): the keyboard shortcut that opens Morse
  (Ctrl+Shift+Y by default, changeable in chrome://extensions/shortcuts).
- **`sandbox` page** `practice.html`: the practice area on the welcome page.
  It shows a first change on a sample article, in a sandboxed frame, away
  from any real site. It only ever gets a change's style, never its code.
- **`morse.helperPort`** in `chrome.storage.local`: a whole number from 1024
  to 65535 that moves the Morse helper's address off `http://127.0.0.1:7457`,
  so several test runs can run side by side. Only the extension's own worker
  and pages can write it (content scripts can't read or write
  `storage.local`), no page or message sets it, there is no setting for it,
  and the address is always `127.0.0.1`: it can't point Morse anywhere but
  the user's own computer. It is safe to ship.
- **Network requests** from the extension go to:
  - the model the user chose: api.anthropic.com or api.openai.com (or the
    address the user set), or the Morse helper at `http://127.0.0.1:7457` on
    their own computer, which hands the request to Claude Code, Codex or an
    API;
  - for voice, when the helper can turn speech into text or the user gave an
    OpenAI key: the helper, or api.openai.com;
  - the gallery list at `https://sam-siavoshian.github.io/RRAA/site/mods/index.json`
    and the mod files it lists for the site (at most once a day, only when the
    bar or Mods panel is open, and only while "Show mods others made" is on);
  - a pack's address, when the user installs a pack from one, and once a day
    after that if they chose to get its updates.

  See [docs/privacy.md](../privacy.md).
