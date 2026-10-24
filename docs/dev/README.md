# Developer guide

How to work on Morse itself. For using Morse, see the [docs](../README.md).

- [How Morse works](architecture.md): hosts, the in-app runtime, the `morse`
  kit, the engine, model providers, the mod format, security.
- [Testing](testing.md): `npm run check`, `npm test`, `npm run test:ui`, the
  test helpers, evals, screenshots, and what was verified for real.
- [Adding a feature](adding-a-feature.md): the rules for runtime code, words
  people read, the UI review loop, and where docs go.
- [Accessibility of Morse itself](accessibility.md): keyboard, screen
  readers, zoom and forced colors in Morse's own UI, and how axe-core checks
  it.
- [Checking a Mac or Windows PC](platform-testing.md): the 15-minute check
  for the desktop support that has only been tested on Linux.

## Set up a checkout

You need Node 22 or newer. The browser tests use Playwright, installed
globally (not an npm dependency), and the tests that load the extension need
a display (Xvfb works). Clips need `ffmpeg`.

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm ci                       # the Anthropic SDK and esbuild
npm run build                # builds the Chrome extension into dist/extension
npm link                     # so `morse` runs this checkout
npm run demo:serve           # the demo sites and the website on http://127.0.0.1:8787-8790
```

Load `dist/extension` in `chrome://extensions` (Developer mode, Load
unpacked); `morse extension` prints that folder. After changing anything
under `runtime/`, `core/` or `extension/`, run `npm run build` again and
reload the extension.

People who only use Morse install it with `npm install -g morse-cli` (or,
until the first npm release, `npm install -g github:sam-siavoshian/RRAA`);
the `prepare` script builds the extension inside the package, and
`morse extension` prints where it is.

## Repo layout

```
core/        shared brain: engine, prompt, parser, model providers, mod format, the morse kit,
             onboarding and errors, gallery, heal, show-once, a11y, summary, demo replay (tests)
runtime/     the in-app UI and effect: src/*.js bundled into one file, injected everywhere
extension/   Chrome MV3 host: service worker, content-script bridge, popup, welcome page
daemon/      desktop connector and CLI (CDP, app finder and launcher, ports, status, fuses,
             clip recorder, mod store), the Morse helper for the extension, Claude Code / Codex runners
share/       static install page for share links
site/        public website: landing page, mod gallery, example mods
design/      tokens.css: every color, size and radius the UI uses
demo/        demo apps and sites, and the scripts that made every screenshot
evals/       how often Morse does what people ask, on realistic requests
scripts/     build, check, test:ui
tests/       node --test files and their helpers
docs/        user docs; docs/dev for developers; screenshots, UI catalog, launch kit
```

## The website and the gallery

[`site/`](../../site/) is the public website: static HTML, CSS and ES
modules, no build step. The Pages workflow
([`.github/workflows/pages.yml`](../../.github/workflows/pages.yml))
publishes it laid out like the repo (`/site/` for the site,
`/share/install.html` for share links, `/site/mods/index.json` for the
gallery list); `npm run pages` builds the same thing into `dist/pages` and
fails on a broken link. `site/privacy.html` is made from
[docs/privacy.md](../privacy.md) by `npm run pages`, and
`tests/release.test.js` checks that it is current.

The design is ported from the Lanes landing page (same owner): its layout,
type scale, spacing, components and motion, in plain HTML and CSS, with
Morse's monochrome in place of Lanes' purple. Light only, like Lanes. Static
files were chosen over bringing in Next.js because Lanes' page is itself a
static export whose styles are one plain stylesheet, so a port reproduces it
exactly with no build step, no dependencies and no change to the Pages
layout that share links and the gallery list depend on.

- **`site/index.html`**: the landing page. It holds the one copy of the nav
  bar and footer: `npm run pages` copies them into `site/gallery.html`
  (between its `<!-- chrome:… -->` markers) and `site/privacy.html`.
- **`site/config.js`**: where the buttons go (**Get it for Chrome**, **Get the
  desktop app**; the install steps until there is a store listing or a
  download) and the demo video under the headline (file, poster, shape,
  caption). Swap the video there.
- **`site/site.css`**: the one stylesheet for the site's pages (Nunito Sans,
  OFL, in `site/fonts/`). `site/shots/` holds the screenshots the page shows,
  as WebP copies of `docs/screenshots/`.
- [`tests/site.test.js`](../../tests/site.test.js) checks that every link,
  image, icon, fragment and config target on the pages resolves.
- **`site/gallery.html`**: example mods from [`site/mods/`](../../site/mods/)
  (`index.json` lists them; each `*.morse.json` is a normal mod). Search,
  filter by app, read the code, then **Install in Morse** (a share link built
  exactly like `encodeShare` in `core/mod.js`), **Download for Tampermonkey**
  or **Copy link**. The mods were written by hand against each app in October
  2026, so a selector may need a refresh.
- **`site/radar.js`**: the radar mark (OpenCode's 4×4 pixel spinner) as a
  tiny module.
- **`share/install.html`** keeps the site's earlier look, in
  `share/install.css` with `design/tokens.css`.

Run it locally with `npm run demo:serve` and open
`http://127.0.0.1:8787/site/`. Screenshots are in [`docs/site/`](../site/):
`node demo/shoot-site.js` makes the pages' own (1440×900 and 390×844), and
the `compare-*` pictures put Lanes' page beside Morse's at 390, 768, 1280
and 1440 pixels wide, the first screen and the whole page.

To add a mod to the gallery, export it (`morse export <id>` writes a
`.morse.json`), drop it in `site/mods/`, and add an entry to
`site/mods/index.json`. A good gallery mod does one thing, its title says
what, it sends nothing over the network, and it uses stable selectors (ids,
`aria-*`, `data-*`, roles), not generated class names like `css-1x2y3`.

Morse reads the same list for **Mods for this site**
([`core/gallery.js`](../../core/gallery.js), fetched and cached by
[`core/gallery-host.js`](../../core/gallery-host.js)). Each entry needs
`match` (the mod's hosts and app, so Morse can tell which pages it is for)
and `version`; raise `version` and add a one-line `changes` when you update a
mod, and people who installed it see Update available. Entries with
`"demo": true` are for the demo sites (`npm run demo:serve` serves the list at
`http://127.0.0.1:8787/site/mods/index.json`, which Morse uses on those
sites) and don't show on the gallery page. To read another list, set
`MORSE_GALLERY_URL` or `"gallery": { "index": "…" }` in `~/.morse/config.json`
(desktop), or `morse.gallery.url` in the extension's local storage.

## Releasing

The version lives in `package.json` only; the build writes it into the
extension's manifest, and `morse --version` prints it. See
[CHANGELOG.md](../../CHANGELOG.md).

- **npm:** `npm publish` (the `prepare` script builds the extension that
  ships inside the package, also for installs from GitHub).
- **Chrome Web Store:** `npm run store` makes
  `dist/morse-extension-<version>-store.zip` (a `MORSE_STORE=1` build) and
  prints its SHA-256. The listing text, permission notes, screenshots and the
  step-by-step guide are in [`docs/store/`](../store/SUBMIT.md).
- **Privacy policy:** [docs/privacy.md](../privacy.md), published as
  `site/privacy.html` by `npm run pages`.

## Where REA fits

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is a
read-only investigation toolkit for coding agents: it analyzes Electron/JS
bundles statically, reads Electron fuses, observes runtime execution over
CDP, and drives Ghidra/Hopper/IDA/Frida for native code. It deliberately never
modifies a target and is built for careful evidence, not latency, so it is
the wrong tool for Morse's instant loop. Morse borrows its approach where it
helps:

- **Now:** the Electron fuse check (`daemon/fuses.js`, a reimplementation of
  REA's `inspect_electron_fuses`) before relaunching an app.
- **Next:** a one-time "app profile" pass with REA's static JS analysis
  (modules, IPC channels, routes) and `inspect_web_event_listeners`, cached
  and fed to the model as context for requests that need the app's *logic*,
  not just its DOM ("make shuffle actually random").

## Roadmap

- **Days:** tune the prompt and kit with Claude Code and Codex on real
  Spotify, Slack, Discord, VS Code, Notion and ChatGPT; a tray app with a
  global hotkey (Tauri) so `morse launch` isn't needed; clip recording in the
  extension (`tabCapture`).
- **Weeks:** REA-powered app profiles for logic-level changes; enforce the
  no-network rule with a CSP or proxy for mod code. (Mod repair when an app
  update breaks selectors, and a static-site gallery of shared mods, have
  shipped: see [Mods](../mods.md).)
- **Native apps (honest version):** macOS Accessibility and Windows UI
  Automation can read and drive native UIs and draw overlays *on top*, not
  add buttons *inside* Finder. That's "overlay + automation" mods, a v3 item.
