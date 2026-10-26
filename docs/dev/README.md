# Developer guide

How to work on Morse itself. For using Morse, see the [docs](../README.md).

- [How Morse works](architecture.md): hosts, the in-app runtime, the `morse`
  kit, the engine, model providers, the mod format, security.
- [App profiles](rea.md): how Morse reads how a desktop app works inside
  (its commands, channels and objects) so changes can use the app's own
  logic. What was taken from REA and why it isn't a dependency.
- [Testing](testing.md): `npm run check`, `npm test`, `npm run test:ui`, the
  test helpers, evals, screenshots, and what was verified for real.
- [Adding a feature](adding-a-feature.md): the rules for runtime code, words
  people read, the UI review loop, and where docs go.
- [Accessibility of Morse itself](accessibility.md): keyboard, screen
  readers, zoom and forced colors in Morse's own UI, and how axe-core checks
  it.
- Onboarding: the first minutes, mapped and measured before
  and after onboarding v2, one-click pairing with Morse Desktop, and
  “Allow User Scripts” only when a change needs it.
- [Checking a Mac or Windows PC](platform-testing.md): the 15-minute check
  for the desktop support that has only been tested on Linux.
- [Simplify](simplify.md): every setting, menu and button people meet, what
  is shown and what waits under More, and Morse checked end to end on a
  fresh setup.

## Set up a checkout

You need Node 22 or newer. The browser tests use Playwright, installed
globally (not an npm dependency), and the tests that open real windows need
a display (Xvfb works). Clips need `ffmpeg`.

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm ci                       # the Anthropic SDK and esbuild
npm run build                # bundles the runtime into dist/runtime (the site's Try it here)
npm link                     # so `morse` runs this checkout
npm run desktop              # the Morse app, from this checkout
npm run demo:serve           # the demo sites and the website on http://127.0.0.1:8787-8797
```

The Morse app and `morse launch` bundle the runtime from `runtime/` when
they start, so a change there shows the next time you open an app with Morse.

People who only use Morse install it with `npm install -g morse-cli` (or,
until the first npm release, `npm install -g github:sam-siavoshian/RRAA`).

## Repo layout

```
core/        shared logic: engine, prompt, parser, model providers, mod format, the morse kit,
             onboarding and errors, gallery, heal, show-once, a11y, summary, demo replay (tests)
runtime/     the in-app UI and effect: src/*.js bundled into one file, injected everywhere
daemon/      desktop connector and CLI (CDP, app and browser finder and launcher, ports, status,
             fuses, clip recorder, mod store), Claude Code / Codex runners
desktop-app/ the Morse app (Electron): the window, the first run, updates, Always open with Morse
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
publishes the pages at the root (`/`, `/gallery.html`, `/privacy.html`).
`/site/` redirects there. The files stay in that folder so the pages' relative
paths keep working, share links stay at `/share/install.html`, and the gallery
list stays at `/site/mods/index.json` (the app already requests that address).
`npm run pages` builds the same thing into `dist/pages` and
fails on a broken link. `site/privacy.html` is made from
[docs/privacy.md](../privacy.md) by `npm run pages`, and
`tests/release.test.js` checks that it is current.

The design is Morse's own, taken from the product: the dark grey ramp of
[`design/tokens.css`](../../design/tokens.css), white type, mono for keys
and requests, and the radar's pixels as the one motif (a faint grid behind
the headline, with a few lit squares pulsing like the mark while a model
works). Dark only. There are no drawn pictures: every picture is a real
screenshot or a frame of a real recording, every app icon is the app's own,
and there is no SVG. `tests/site.test.js` checks that. The landing page, in order: the
headline and the film, **See it change** (before and after pairs with a
slider), **How it works** in three steps, **Try it here**, a strip of real
apps, **Install** (two buttons, the steps by hand behind each, and one line
for developers), privacy in two lines, a short FAQ.

- **`site/index.html`**: the landing page. It holds the one copy of the nav
  bar and footer: `npm run pages` copies them into `site/gallery.html`
  (between its `<!-- chrome:… -->` markers) and `site/privacy.html`.
- **`site/config.js`**: every link target and every real picture, in one
  place. `LINKS`: where **Download Morse** and the other buttons go. `DEMO_VIDEO`: the film under the
  headline (file, poster, shape, captions). `SHOWCASE`: the before and after
  pairs, each with the app's name as it shows on screen (VSCodium, not VS
  Code), what was asked and by which model. Swap in the pictures from
  `docs/showcase/` there (`npm run pages` publishes that folder when it
  exists). `REAL_APPS`: the strip of real apps. `site/index.js` builds those
  two sections from it.
- **`site/site.css`**: the one stylesheet for the site's pages (Inter, Inter
  Display and JetBrains Mono, Latin subsets, OFL, in `site/fonts/`).
  `site/shots/` holds the screenshots the page shows, as WebP copies of
  `docs/screenshots/` (same numbers), frames of
  `docs/launch/morse-social-16x9.mp4` (200, 201) and of
  `docs/launch/morse-v3-16x9.mp4` (202, the film's poster), and the Chrome Web
  Store screenshots 2 and 3 (182, 184). `site/icons/` holds the real icon of
  each app and site the page names (`APP_ICONS` in `config.js`: from the
  installed app, or the site's own favicon, 64 pixels at most), shown on the
  gallery cards, the showcase and the strip; a name without one shows its
  first letter. The site has no SVG: the favicon is the Morse mark as a PNG,
  and the arrow, play, pause and slider icons are text.
- **Motion** ([`site/motion.js`](../../site/motion.js)): parts marked
  `data-reveal` rise into view once, the headline and the film follow the
  scroll, and the footer's wordmark lights up under the pointer. With
  reduced motion nothing moves, and without the script everything shows.
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
- **`share/install.html`** follows the reader's light or dark setting, in
  `share/install.css` with `design/tokens.css`.

Run it locally with `npm run demo:serve` and open
`http://127.0.0.1:8787/site/`. Screenshots are in [`docs/site/`](../site/):
`node demo/shoot-site.js` makes them: the landing page whole at 390, 768,
1280 and 1440 pixels wide (it fails if one scrolls sideways), each section
at 1440 and 390 (`section-*`), the first screen, the nav sheet, the gallery,
the privacy policy and the share page.

To add a mod to the gallery, export it (`morse export <id>` writes a
`.morse.json`), drop it in `site/mods/`, and add an entry to
`site/mods/index.json`. A good gallery mod does one thing, its title says
what, it sends nothing over the network, and it uses stable selectors (ids,
`aria-*`, `data-*`, roles), not generated class names like `css-1x2y3`.

Every gallery mod has a checker in
[`evals/gallery-cases.json`](../../evals/gallery-cases.json): a short script
that fails on the page without the mod, and passes with it and again after a
reload, using real clicks and keys. `node evals/gallery.js --generate` asks
Claude Code (sonnet) for each request on its real page or demo app and checks
the answer; `node evals/gallery.js --verify` checks the files in
`site/mods/` (`SHOTS=dir` also takes the before and after pictures). The
demo-app mods are checked again by every test run
(`tests/gallery-mods.test.js`). The real-site results are in
[`site/mods/VERIFIED.md`](../../site/mods/VERIFIED.md). Each entry also has a
`category` (the gallery page's filters), `userScripts` (true when the mod has
code, so it needs Chrome's “Allow User Scripts”), `checked` (when and where it
was checked) and, for the best few, `shots` (before and after pictures in
`site/mods/shots/`).

Morse reads the same list for **Mods for this site**
([`core/gallery.js`](../../core/gallery.js), fetched and cached by
[`core/gallery-host.js`](../../core/gallery-host.js)). Each entry needs
`match` (the mod's hosts and app, so Morse can tell which pages it is for)
and `version`. Raise `version` and add a one-line `changes` when you update a
mod, and people who installed it see Update available. Entries with
`"demo": true` are for the demo sites (`npm run demo:serve` serves the list at
`http://127.0.0.1:8787/site/mods/index.json`, which Morse uses on those
sites). The gallery page shows them with a “Demo app” badge. To read another list, set
`MORSE_GALLERY_URL` or `"gallery": { "index": "…" }` in `~/.morse/config.json`
.

## Releasing

The version lives in `package.json` only. `morse --version` prints it. See
[CHANGELOG.md](../../CHANGELOG.md).

`npm run release -- minor`, then `git push --follow-tags origin main`: the
tag's workflow tests, publishes to npm and makes the GitHub release. The one-time setup and every step: [Releasing](releasing.md).

- **The Morse app:** every push to `main` rebuilds the preview release, and
  installed copies update themselves from it.
- **Privacy policy:** [docs/privacy.md](../privacy.md), published as
  `site/privacy.html` by `npm run pages`.

## Where REA fits

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is a
read-only investigation toolkit for coding agents: it analyzes Electron/JS
bundles statically, reads Electron fuses, observes runtime execution over
CDP, and drives Ghidra/Hopper/IDA/Frida for native code. It deliberately never
modifies a target and is built for careful evidence, not latency, so it is
the wrong tool for Morse's instant loop. Morse reimplements the small parts it
needs, in plain JavaScript with no new dependencies:

- the Electron fuse check (`daemon/fuses.js`, REA's `inspect_electron_fuses`)
  before relaunching an app;
- **app profiles** (`daemon/profile.js`, `core/profile.js`): a one-time,
  read-only pass over the app's code (IPC channels, contextBridge APIs,
  commands, routes, store actions) and over the running window (its own
  objects, a command runner, `inspect_web_event_listeners`-style listener
  reads), cached per app version and given to the model for requests about
  what the app *does*. Mods run the app's commands with
  `morse.app.command(id)`. The design, the choice not to depend on REA, and
  the measurements are in [App profiles](rea.md).

## Roadmap

- **Days:** tune the prompt and kit with Claude Code and Codex on real
  Spotify, Slack, Discord, VS Code, Notion and ChatGPT. A tray app with a
  global hotkey (Tauri) so `morse launch` isn't needed.
- **Weeks:** app profiles for apps whose command runner Morse can't find yet
  (see [App profiles](rea.md#what-doesnt-work-yet)). Enforce the
  no-network rule with a CSP or proxy for mod code. (Mod repair when an app
  update breaks selectors, and a static-site gallery of shared mods, have
  shipped: see [Mods](../mods.md).)
- **Native apps (honest version):** macOS Accessibility and Windows UI
  Automation can read and drive native UIs and draw overlays *on top*, not
  add buttons *inside* Finder. That's "overlay + automation" mods, a v3 item.
