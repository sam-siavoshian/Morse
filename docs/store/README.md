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

Also needed, not made here: a **128×128 icon** (the build makes
`dist/extension/icons/128.png`; the store wants the artwork inside 96×96 with
transparent padding, so check it), and optionally a **440×280 small promo
tile**. `docs/launch/poster-demo.png` can be cropped for the tile.

## Before you submit

Things that will block or slow the review, found while preparing this kit:

1. **Running model-written code without "Allow User Scripts".** When the user
   has not turned on Allow User Scripts, `extension/background.js` (`execIn`)
   falls back to `chrome.scripting.executeScript` in the page's main world and
   runs the code with `eval`. The store's Manifest V3 rules forbid running code
   that is not in the package except through `chrome.userScripts`. Expect a
   rejection for this. The fix: without Allow User Scripts, apply only the CSS
   part of a change and ask the user to turn it on for the rest.
2. **`<all_urls>`** for host permissions and the content script means an
   in-depth review, which takes longer. It is needed for the product to work
   on any site; the justification is in permissions.md.
3. **The privacy policy URL must be live** before submitting. It is published
   by the Pages workflow, which needs Settings → Pages → Source: GitHub
   Actions, and a push to `main`.
4. **Screenshots show demo addresses** (127.0.0.1:8789) and "demo replay" in
   the bar's footer. Reviewers accept this, but real sites would sell it better.
5. A developer account ($5 one-time) and, for a new account, a verified
   contact email.
