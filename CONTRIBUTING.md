# Contributing to Morse

Thanks for helping. You can report a bug, add a mod to the gallery or send a
pull request.

## Report a bug

[Open an issue](https://github.com/sam-siavoshian/RRAA/issues/new/choose) and
pick "Something doesn't work". Say what you did, what Morse did, and on which
site or app. Run `morse --version` to get the version. Leave out API keys,
pairing codes and anything private on the page.
[Troubleshooting](docs/troubleshooting.md) may already have the answer.

## Add a mod to the gallery

In Morse, open the Mods panel. Click Share on the mod, then **Submit to the
gallery**. This opens a GitHub issue with everything filled in. You can also
[open one by hand](https://github.com/sam-siavoshian/RRAA/issues/new?template=gallery.md).

Someone reads every line before a mod goes in the gallery. A good gallery mod:

- does one thing, and its title says what
- only changes the page it is for, and sends nothing over the network
- uses stable selectors (ids, `aria-*`, `data-*`, roles), not generated class
  names like `css-1x2y3`

To add one yourself, put the `.morse.json` file in `site/mods/`. Then add an
entry to `site/mods/index.json`. See
[The website and the gallery](docs/dev/README.md#the-website-and-the-gallery).

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

The tests start real Chromium through Playwright. On a machine without a
screen, run them under Xvfb:

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

The version is in `package.json` only. Write what changed under
"Unreleased" in CHANGELOG.md, then:

- `npm run release -- minor` raises the version, dates the CHANGELOG entry,
  runs the checks and tests, commits and tags. Use `patch`, `major` or a
  version like `1.4.0` in place of `minor`. Add `--dry-run` first to see what
  it does.
- `git push --follow-tags origin main` starts the release workflow. It
  publishes to npm and makes the GitHub release with the Chrome Web Store zip.
- Upload that zip as [docs/store/SUBMIT.md](docs/store/SUBMIT.md) says.

For the one-time setup and the details, see [Releasing](docs/dev/releasing.md).

By contributing, you agree that your work is released under the [MIT license](LICENSE).
