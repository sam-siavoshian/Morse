# Chrome Web Store kit

Everything needed to submit the Morse extension. Start with
[SUBMIT.md](SUBMIT.md): it goes through the dashboard field by field.

| File | What it is |
|---|---|
| [SUBMIT.md](SUBMIT.md) | Step by step: which field, what to paste, which file to upload, what reviewers ask |
| [listing.md](listing.md) | Summary, description, category, single purpose, permission boxes, remote code answer, data usage answers, captions |
| [permissions.md](permissions.md) | Every permission, why, and where the code uses it |
| [screenshots/](screenshots/) | The five store screenshots, 1280×800 |
| [promo/](promo/) | Small promo tile (440×280) and marquee (1400×560) |
| [../privacy.md](../privacy.md) | The privacy policy, published at https://sam-siavoshian.github.io/RRAA/site/privacy.html |

## Make the zip

```bash
npm run store
```

Builds the extension with `MORSE_STORE=1` into `dist/store/extension` and
writes `dist/morse-extension-<version>-store.zip`, with `manifest.json` at its
root, then prints its path, size and SHA-256. Upload that zip.

The store build differs from the test build (`npm run build`,
`dist/extension`) in one line: `extension/host.js` lets the local copy of the
share page (`http://127.0.0.1:8787`) ask for an install, so tests can run the
share flow; the store build leaves that address out. `scripts/build.js` fails
if the line it removes ever changes, `npm run store` refuses a zip that still
has it, and `tests/store.test.js` builds both and checks that nothing else
differs.

`npm run package:extension` still zips the test build
(`dist/morse-extension-<version>.zip`); don't upload that one.

Then check the zip the way Chrome will see it:

```bash
DISPLAY=:99 npm run store:smoke     # any display; :99 on a machine without a screen
```

`scripts/store-smoke.js` unpacks the store zip into a fresh Chromium profile,
goes through the welcome page (practice change, `morse setup --pair` with the
demo model), turns on "Allow User Scripts", makes and saves one change on a
demo site, reloads, and fails on any error or warning from the service worker
(watched over the DevTools protocol from its first second) or the
extension's pages.

## Screenshots

Spec: **1280×800**, 24-bit PNG without transparency, up to 5. All five are
taken from the real extension with a real model (Claude Code · haiku through
`morse serve`) on real public websites, except the gallery one:

```bash
DISPLAY=:99 npm run store:screenshots       # ONLY=2,3 retakes some
```

`scripts/store-screenshots.js` drives Chromium like a person (shortcut,
pointing, typing, Enter), checks every frame is 1280×800 and writes it here.
A real model writes different code each run, so look at each picture and
retake the ones that don't read well.

| File | Shows | Caption |
|---|---|---|
| `1-describe-a-change.png` | pkg.go.dev while a change is being written: the code examples already dark, the survey banner gone | Say what to change. You see it change while it is being written. |
| `2-save-what-you-like.png` | pypi.org: copy buttons added to the code examples, with Save, Undo, Edit code and Share | Add what a site is missing. Save it, and it is there every time you come back. |
| `3-your-mods.png` | pypi.org: the Mods panel with the three mods just made | Your saved changes for a site in one place. Turn each one on or off. |
| `4-mods-others-made.png` | The Tunes demo app: a gallery mod tried before saving, in the Mods panel | Try changes other people made. Save the ones you like. |
| `5-edit-tools.png` | rubygems.org: the Edit tools and the color palette on the heading | Edit tools change the page at once: hide, move, resize, recolor, rename. |

The gallery picture uses a demo app because the gallery's mods for real sites
are for sites that need an account (or that the machine taking the pictures
can't reach). Its address shows as 127.0.0.1:8789 in the Mods panel.

## Promo images

```bash
npm run store:promo
```

`scripts/store-promo.js` draws both from HTML in Morse's design (the dark
surfaces and gray ramp of `design/tokens.css`, Inter, the logo grid); the
marquee shows part of screenshot 2.

| File | Size | Field |
|---|---|---|
| `promo/small-tile-440x280.png` | 440×280 | Small promo tile (needed for the listing) |
| `promo/marquee-1400x560.png` | 1400×560 | Marquee promo tile (optional; used if the store features Morse) |

## Icon

`npm run build` draws the icons (`scripts/build.js`): the 3×3 logo grid in
the gray ramp on a dark rounded tile, so the light squares show on the
store's white page and on light toolbars too. The squares are whole pixels at
every size. The 128px one has its artwork in the middle 96×96 with 16px of
transparent padding on every side, as the store asks (`tests/store.test.js`
checks it). Upload `dist/store/extension/icons/128.png` as the store icon.

## Code that Morse runs

The store allows code that isn't in the package (here: what the user's model
writes, and mods the user installs) only through `chrome.userScripts`. Every
place in the extension that runs or could run code, and why it is allowed:

| Where | What runs | Why it is fine |
|---|---|---|
| `extension/background.js` `execIn`: `chrome.userScripts.execute` in the `USER_SCRIPT` world | A mod's code, wrapped with Morse's helper kit (`core/kit.js`, in the package), and Morse's own one-line calls into that kit (`__errors`, `__off`, `__stats`) | The one way mod code runs, and only when the user has turned on "Allow User Scripts". |
| The same, when "Allow User Scripts" is off | Nothing. `exec` answers `{ waiting: "userScripts" }` without running anything | The content script still adds the mod's style as a `<style>` (styles aren't code). The bar, the Mods panel and the toolbar popup say which mods are waiting, with a button that opens Morse's details page in `chrome://extensions` and three short steps. Coming back to the tab tries the waiting mods again. |
| `extension/background.js` `ui.load`: `chrome.scripting.executeScript({ files: ["ui.js"] })` | Morse's own interface, a file in the package, the first time the user opens Morse on a page | A packaged file, into the content script's own isolated world. |
| `extension/popup-states.js`: `chrome.scripting.executeScript` | A fixed function written in the package that reads one attribute, to tell whether Morse is on the tab | No code is passed in (`func` is an arrow function in the file, no `args`). |
| The practice area (`practice.html`, sandboxed) on the welcome page | Nothing. A change shows its style only; its code is never sent there | Its old `eval` is gone, and the manifest gives the sandbox stricter rules than Chrome's default: `script-src 'self'`, no `unsafe-eval` or `unsafe-inline`. |
| Content scripts (`host.js`, `boot.js`, then `ui.js`) | Morse's own packaged code | They add mods' styles and Morse's own interface. They never run a string as code. |
| `background.js` bundle (core and the Anthropic SDK) | Packaged code only | No `eval`, `new Function` or string timers anywhere in the built files. |

`tests/store.test.js` checks this on every `npm test`: no `eval(`,
`new Function(`, `Function("…")`, string `setTimeout`/`setInterval`, `MAIN`
world scripts or `unsafe-eval` in the extension's source or in the built
files; every `executeScript` runs a packaged file or a fixed function with
nothing passed in; `userScripts.execute` appears only in `background.js`;
and the manifest's permissions, page rules and icons are as described here.
`tests/store-ui.test.js` loads the built extension in Chromium (where "Allow
User Scripts" is off) and checks that a saved mod's style shows, its code
never runs, and the page, the bar and the popup say it is waiting.

Not part of the extension: the desktop connector (`daemon/`) runs mods in
desktop apps over the Chrome DevTools Protocol, on the user's own computer.

## Checklist (0.2.0, October 24, 2026)

Checked on the zip `npm run store` made, unpacked:

- **Name, version, summary:** Morse, 0.2.0 (from `package.json`; the build
  writes it and refuses a mismatch), and the 130-character summary from
  listing.md.
- **`minimum_chrome_version`: 138**, the first Chrome with the "Allow User
  Scripts" switch Morse's pages talk about (`userScripts.execute` is 135).
- **Permissions:** `storage`, `scripting`, `userScripts`, `tabs`,
  `downloads`; each one is used and explained in permissions.md. Without
  `tabs` the popup can't tell Chrome's own pages apart (checked). No optional
  permissions, no `web_accessible_resources`, no `externally_connectable`.
- **Host permissions:** `<all_urls>`, for the bar and saved mods on any site.
- **No remote code:** see the table above. No `eval`, `new Function` or
  string timers in the zip; every script tag in its pages loads a file from
  the package, and no page has inline code.
- **Page rules (CSP):** the manifest sets none for extension pages, so
  Chrome's Manifest V3 default applies (scripts only from the package, no
  `unsafe-eval`, and Chrome refuses a looser one). The sandboxed practice
  page gets a stricter one than Chrome's sandbox default: `script-src
  'self'`, no `unsafe-eval` or `unsafe-inline`.
- **Icons:** 16, 32, 48, 128px; 128px with 16px transparent padding.
- **Test-only code:** the test share address is left out (above). The
  helper-port key (`morse.helperPort`) stays: it can only move the helper to
  another port on 127.0.0.1, and only the extension itself can set it (see
  permissions.md).
- **The zip:** `dist/morse-extension-0.2.0-store.zip`, about 815 KB, 27
  files: the worker (`background.js`, which bundles the Anthropic SDK), the
  content scripts (`host.js`, `boot.js`) and the interface they load on first
  use (`ui.js`), the popup, options, welcome and practice pages with their
  scripts and styles (`runtime.js` is the practice page's copy of Morse), four
  core modules the pages import, and the icons.
- **Smoke test** (`npm run store:smoke`): welcome page, practice change,
  pairing, one change saved and back after a reload; nothing in the service
  worker's console.
