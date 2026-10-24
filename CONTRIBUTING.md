# Contributing to Morse

Thanks for helping. Bug reports, mods for the gallery and pull requests are
all welcome.

## Report a bug

[Open an issue](https://github.com/sam-siavoshian/RRAA/issues/new/choose) and
pick "Something doesn't work". Say what you did, what Morse did, and on which
site or app. `morse --version` gives the version. Please leave out API keys,
pairing codes and anything private from the page.

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
entry to `site/mods/index.json` (see "Site" in the README).

## Work on the code

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

`npm run demo:serve` serves the demo sites and the website on
`http://127.0.0.1:8787`. The README's "Repo layout" says where things live.

Before you open a pull request:

- `DISPLAY=:99 npm test` passes.
- Words people read follow [docs/WRITING.md](docs/WRITING.md): short
  sentences, everyday words, the glossary's names for things.
- Colors and spacing come from [design/tokens.css](design/tokens.css).
- A change to what leaves the computer also changes
  [docs/privacy.md](docs/privacy.md). Run `npm run pages` after editing it.
- Note anything people will notice in [CHANGELOG.md](CHANGELOG.md).

## Release

The version is in `package.json` only. Raise it, add a CHANGELOG entry, then:

- `npm publish` for the `morse` command (it builds the extension first).
- `npm run package:extension` for the Chrome Web Store zip. The listing is in
  [docs/store/](docs/store/).

By contributing you agree your work is released under the [MIT license](LICENSE).
