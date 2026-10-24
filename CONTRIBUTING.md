# Contributing to Morse

Bug reports, mods for the gallery and pull requests are all welcome.

- **Report a bug:** [open an issue](https://github.com/sam-siavoshian/RRAA/issues/new).
  Say what you did, what Morse did, and on which site or app. Leave out API
  keys, pairing codes and anything private. [Troubleshooting](docs/troubleshooting.md)
  may already have the answer.
- **Add a mod to the gallery:** in Morse, click **Share** on the mod, then
  **Submit to the gallery…**. Or see [The website and the gallery](docs/dev/README.md#the-website-and-the-gallery).
- **Work on the code:** start with the [developer guide](docs/dev/README.md):
  - [How Morse works](docs/dev/architecture.md): hosts, the runtime, the kit, the engine, models, the mod format
  - [Testing](docs/dev/testing.md): `npm run check`, `npm test`, `npm run test:ui`, helpers, evals
  - [Adding a feature](docs/dev/adding-a-feature.md): the runtime rules, plain words, the UI review loop, docs

Before you open a pull request:

```bash
node scripts/build.js
npm run check
DISPLAY=:99 npm test
```

Words people read follow [How Morse talks](docs/WRITING.md). A new feature
gets a page in [docs/](docs/README.md) and one row in the README's “What you
can do” table, nothing more in the README.

By contributing you agree your work is released under the [MIT license](LICENSE).
