# Permission justifications

One sentence for every permission in [extension/manifest.json](../../extension/manifest.json),
for the "Privacy practices" tab. Each one was checked against the code that uses it.

| Permission | Justification | Used in |
|---|---|---|
| `storage` | Keeps the user's saved changes (mods), settings, request history and, if they add one, their API key, in the browser. | `extension/background.js`, `extension/bar-host.js`, `extension/popup.js` |
| `scripting` | Runs the change the user asked for in the page when "Allow User Scripts" is off, and checks whether Morse can work on the current tab to explain why not. | `extension/background.js` (`execIn`), `extension/popup-states.js` |
| `userScripts` | Runs the code of the user's own changes, and of mods they chose to install, in an isolated world on the sites they were made for; the user turns this on with "Allow User Scripts". | `extension/background.js` (`execIn`) |
| `tabs` | Reads the address of the active tab to show and apply the mods for that site, opens Morse's own pages (welcome, settings, share), reloads a tab when the user asks, and takes a screenshot of the visible tab when the user asks to describe a picture or capture a look. | `extension/background.js`, `extension/popup*.js`, `extension/onboarding-host.js` |
| `downloads` | Saves a mod file, a Tampermonkey script, a backup or a before-and-after image to the Downloads folder when the user clicks to export it. | `extension/background.js` (`download`) |
| Host permission `<all_urls>` | The user can change any website they visit, so Morse's bar has to open on any page, and their saved mods have to apply on the sites they were made for. | `content_scripts` in the manifest, `chrome.tabs.captureVisibleTab` |
| Content script on `<all_urls>` | Adds the Morse bar and the user's saved mods to pages; it sends nothing anywhere until the user uses Morse on that page. | `extension/host.js`, `runtime.js` |

Not permissions, but reviewers ask:

- **`commands`** (manifest key): the keyboard shortcut that opens Morse (Ctrl+Shift+Y by default, changeable in chrome://extensions/shortcuts).
- **`sandbox` page** `practice.html`: the practice area on the welcome page. It runs the user's first change on a sample article in a sandboxed frame, away from any real site.
- **Network requests** from the extension go to: the model the user chose (api.anthropic.com, or the Morse helper at http://127.0.0.1:7457 on their own computer, which forwards to Claude Code, Codex or an API), and the gallery list at https://sam-siavoshian.github.io/RRAA/site/mods/index.json (at most once a day, only when the bar or Mods panel is open, and only while "Show mods others made" is on). See [docs/privacy.md](../privacy.md).
