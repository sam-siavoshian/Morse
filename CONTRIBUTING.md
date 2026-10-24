# Contributing to Morse

Thanks for helping. Bug reports, mods for the gallery and pull requests are
all welcome.

## Report a bug

[Open an issue](https://github.com/sam-siavoshian/RRAA/issues/new/choose) and
pick "Something doesn't work". Say what you did, what Morse did, and on which
site or app. `morse --version` gives the version. Please leave out API keys,
pairing codes and anything private from the page.
[Troubleshooting](docs/troubleshooting.md) may already have the answer.

## Add a mod to the gallery

In Morse, open the Mods panel, click Share on the mod, then **Submit to the
gallery**. That opens a GitHub issue with everything filled in. You can also
[open one by hand](https://github.com/sam-siavoshian/RRAA/issues/new?template=gallery.md).

Someone reads every line before a mod goes in the gallery. A good gallery mod:

- does one thing, and its title says what
- only changes the page it is for, and sends nothing over the network
- uses stable selectors (ids, `aria-*`, `data-*`, roles), not generated class
  names like `css-1x2y3`

To add one yourself, put the `.morse.json` file in `site/mods/` and add an
entry to `site/mods/index.json` (see
[The website and the gallery](docs/dev/README.md#the-website-and-the-gallery)).

## Work on the code

Start with the [developer guide](docs/dev/README.md):

- [Set up a checkout](docs/dev/README.md#set-up-a-checkout) and the repo layout
- [How Morse works](docs/dev/architecture.md): hosts, the runtime, the kit,
  the engine, models, the mod format, security
- [Testing](docs/dev/testing.md): `npm run check`, `npm test`,
  `npm run test:ui`, the test helpers, evals, screenshots
- [Adding a feature](docs/dev/adding-a-feature.md): the runtime rules (no
  duplicate top-level names, `listen()`, `isTrusted`), plain words, the UI
  review loop, and where docs go

You need Node 22 or newer.

```bash
git clone https://github.com/sam-siavoshian/RRAA morse && cd morse
npm install
npm run build      # builds the Chrome extension into dist/extension
npm link           # so `morse` runs this checkout
```

The tests start real Chromium through Playwright, so on a machine without a
screen run them under Xvfb:

```bash
Xvfb :99 &
DISPLAY=:99 npm test
```

Before you open a pull request:

- `npm run check` and `DISPLAY=:99 npm test` pass.
- Words people read follow [docs/WRITING.md](docs/WRITING.md): short
  sentences, everyday words, the glossary's names for things.
- Colors and spacing come from [design/tokens.css](design/tokens.css).
- A new feature gets a page (or a section) in [docs/](docs/README.md) and one
  row in the README's “What you can do” table. Nothing more goes in the
  README. Developer detail goes in [docs/dev/](docs/dev/README.md).
- A change to what leaves the computer also changes
  [docs/privacy.md](docs/privacy.md) and
  [Privacy and safety](docs/privacy-and-safety.md). Run `npm run pages` after
  editing the policy.
- Note anything people will notice in [CHANGELOG.md](CHANGELOG.md).

## Release

The version is in `package.json` only. Raise it, add a CHANGELOG entry, then:

- `npm publish` for the `morse` command (it builds the extension first).
- `npm run store` for the Chrome Web Store zip. How to submit it is in
  [docs/store/SUBMIT.md](docs/store/SUBMIT.md).

More: [Releasing](docs/dev/README.md#releasing).

By contributing you agree your work is released under the [MIT license](LICENSE).
