# Chrome Web Store kit

Everything needed to submit the Morse extension.

| File | What it is |
|---|---|
| [listing.md](listing.md) | Name, short and long description, category, single purpose, remote code answer, data usage answers |
| [permissions.md](permissions.md) | One sentence for every permission in the manifest |
| [screenshots/](screenshots/) | The five store screenshots, 1280×800 |
| [../privacy.md](../privacy.md) | The privacy policy, published at https://sam-siavoshian.github.io/RRAA/site/privacy.html |

## Make the zip

```bash
npm run package:extension
```

This builds `dist/extension` and writes `dist/morse-extension-<version>.zip`
with `manifest.json` at its root. The version comes from `package.json`; the
script refuses to zip a build whose manifest says something else. Upload that
zip in the developer dashboard.

## Screenshots

Spec: **1280×800 PNG**, no rounded corners or padding, up to 5. All five are
taken from the real extension (or, for the last one, the same runtime through
the desktop connector) on the demo sites, with replayed model replies so they
come out the same every time:

```bash
npm run store:screenshots      # DISPLAY=:99 on a machine without a screen
```

`scripts/store-screenshots.js` runs `demo/shoot-extension.js`,
`demo/shoot-godmode.js` and `demo/shoot-gallery.js`, checks each chosen frame
is exactly 1280×800, and copies it here.

| File | Shows | Caption for the store |
|---|---|---|
| `1-point-and-describe.png` | The bar open on a chat app, with the first-run tips | Point at anything, or describe a change to the whole page. |
| `2-it-changes-while-you-watch.png` | A news page restyling while the change is written | The new look shows up while it is being written. |
| `3-add-what-the-app-is-missing.png` | A word count added to a chat app, with Save, Undo, Edit code, Share | Add what a site is missing. Save it, undo it or read the code. |
| `4-edit-tools.png` | The edit tools on a headline | Edit tools: hide, move, resize, rename and recolor with no model. |
| `5-mods-others-made.png` | The Mods panel with mods from the gallery | Turn mods on and off, and try mods other people made. |

**Icons.** The build makes 16, 32, 48 and 128px icons from the logo grid
(`scripts/build.js`). The 128px one has its artwork in the middle 96×96 with
16px of transparent padding on every side, as the store asks; upload
`dist/extension/icons/128.png` as the store icon. Optionally add a **440×280
small promo tile**; `docs/launch/poster-demo.png` can be cropped for it.

## Code that Morse runs

The store allows code that isn't in the package (here: what the user's model
writes, and mods the user installs) only through `chrome.userScripts`. Every
place in the extension that runs or could run code, and why it is allowed:

| Where | What runs | Why it is fine |
|---|---|---|
| `extension/background.js` `execIn`: `chrome.userScripts.execute` in the `USER_SCRIPT` world | A mod's JS, wrapped with Morse's helper kit (`core/kit.js`, in the package), and Morse's own one-line calls into that kit (`__errors`, `__off`, `__stats`) | The one way mod code runs, and only when the user has turned on "Allow User Scripts". |
| The same, when "Allow User Scripts" is off | Nothing. `exec` answers `{ waiting: "userScripts" }` without running anything | The content script still adds the mod's CSS as a `<style>` (styles aren't code). The bar, the Mods panel and the toolbar popup say which mods are waiting, with a button that opens Morse's details page in `chrome://extensions` and three short steps. Coming back to the tab tries the waiting mods again. |
| `extension/popup-states.js`: `chrome.scripting.executeScript` | A fixed function written in the package that reads one attribute, to tell whether Morse is on the tab | No code is passed in (`func` is an arrow function in the file, no `args`). |
| The practice area (`practice.html`, sandboxed) on the welcome page | Nothing. A change shows its CSS only; its JS is never sent there | Its old `eval` is gone, and the manifest gives the sandbox stricter rules than Chrome's default: `script-src 'self'`, no `unsafe-eval` or `unsafe-inline`. |
| Content scripts (`host.js`, `runtime.js`) | Morse's own packaged code | They add mods' CSS and Morse's own UI. They never run a string as code. |
| `background.js` bundle (core and the Anthropic SDK) | Packaged code only | No `eval`, `new Function` or string timers anywhere in the built files. |

`tests/store.test.js` checks this on every `npm test`: no `eval(`,
`new Function(`, `Function("…")`, string `setTimeout`/`setInterval`, `MAIN`
world scripts or `unsafe-eval` in the extension's source or in the built
files; every `executeScript` runs a packaged file or a fixed function with
nothing passed in; `userScripts.execute` appears only in `background.js`;
and the manifest's permissions, page rules and icons are as described here.
`tests/store-ui.test.js` loads the built extension in Chromium (where "Allow
User Scripts" is off) and checks that a saved mod's CSS shows, its JS never
runs, and the page, the bar and the popup say it is waiting.

Not part of the extension: the desktop connector (`daemon/`) runs mods in
desktop apps over the Chrome DevTools Protocol, on the user's own computer.

## Checklist (run again for 0.2.0)

- **Permissions** are `storage`, `scripting`, `userScripts`, `tabs`,
  `downloads`, each used and explained in permissions.md. No optional
  permissions, no `web_accessible_resources`, no `externally_connectable`.
- **Host permissions:** `<all_urls>`, for the bar and saved mods on any site
  (see below).
- **No remote code:** see the table above. Every script tag in the extension's
  pages loads a file from the package, and no page has inline code.
- **Page rules (CSP):** Chrome's default for extension pages; a stricter one
  than the default for the sandboxed practice page.
- **Icons:** 16, 32, 48, 128px; 128px with 16px padding.
- **Version:** from `package.json` (0.2.0); the build writes it into the
  manifest and `npm run package:extension` refuses a mismatch.
- **The zip** (`npm run package:extension`): `dist/morse-extension-0.2.0.zip`,
  about 430 KB, `manifest.json` at its root, 25 files: the worker
  (`background.js`, which bundles the Anthropic SDK), the content scripts
  (`host.js`, `runtime.js`), the popup, options, welcome and practice pages
  with their scripts and styles, four core modules the pages import
  (`hotkeys`, `onboarding`, `prefs`, `summary`), and the icons. The build used
  to copy all of `core/` into the zip; it now ships only what the pages import.

## Before you submit

Things that will block or slow the review:

1. **`<all_urls>`** for host permissions and the content script means an
   in-depth review, which takes longer. It is needed for the product to work
   on any site; the justification is in permissions.md.
2. **"Remote code: Yes".** Answer it as listing.md says. Expect the reviewer
   to ask how the code is run; point to "Allow User Scripts" and the table above.
3. **The privacy policy URL must be live** before submitting. It is published
   by the Pages workflow, which needs Settings → Pages → Source: GitHub
   Actions, and a push to `main`.
4. **The share page's test address.** `extension/host.js` lets
   `http://127.0.0.1:8787` ask for an install, like the real share page, so
   tests can run it locally. It only opens the review, but a reviewer may ask;
   consider leaving it out of store builds.
5. **Screenshots show demo addresses** (127.0.0.1:8789) and "demo replay" in
   the bar's footer. Reviewers accept this, but real sites would sell it better.
   Retake them if the bar's look changes before submitting.
6. A developer account ($5 one-time) and, for a new account, a verified
   contact email.
