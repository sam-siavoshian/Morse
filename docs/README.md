# Morse docs

Hack your apps in your own words. Remove the feed. Build the missing export.
Take a feature from another app and make it work here. Save your version as
a mod, and Morse brings it back every time you open the app.

If you're new, start with [Getting started](getting-started.md).

## Using Morse

| Page | What's in it |
|---|---|
| [Getting started](getting-started.md) | Install Morse for Chrome and for desktop apps, connect a model, make your first change |
| [Changing things](changing-things.md) | The bar: point at something, describe a change, Save or Undo, ask for more, History, voice and shortcuts |
| [Edit tools and Page tools](edit-and-page-tools.md) | Change things yourself, with no model: hide, move, recolor, rename. Dark mode, text size, hide ads |
| [Ask and find](ask-and-find.md) | Ask what something does or where a setting is. Show me, and Explain this page |
| [Show me once](show-me-once.md) | Do a task by hand once, then have Morse do it for you |
| [Bring a feature](bring-a-feature.md) | Take this in one app, Bring here in another: a feature rebuilt in that app's own look |
| [Easier to use](easier-to-use.md) | Higher contrast, bigger click targets, easier fonts, Read aloud, Check this page, Describe this picture |
| [Your style](your-style.md) | One look on every site and app: font, text size, calmer pages, colors, and the sites it skips |
| [Mods](mods.md) | The Mods panel, sharing, the gallery, Try it, what a mod does before you install it, and fixing mods when a site changes |
| [Mod packs](mod-packs.md) | Several mods shared together: make a pack, install the ones you want, and packs that stay up to date for a team |
| [Your controls](your-controls.md) | The off switch, pausing Morse, Safe start, mods that slow down or freeze a page, and backups |
| [Desktop apps](desktop.md) | Apps like VS Code, Obsidian and Joplin: how to connect, and which apps can't work |
| [The Morse app](desktop-app.md) | Morse itself: your apps, your model, Chrome, your mods and checks. The one thing to install |
| [Models and setup](models.md) | Claude Code, Codex or an API key: how to choose, and how Chrome reaches your model |
| [Privacy and safety](privacy-and-safety.md) | What leaves your computer, when, and what mods can do |
| [Privacy policy](privacy.md) | The privacy policy for the Morse app and the `morse` command |
| [Troubleshooting](troubleshooting.md) | Common messages, what they mean, and what to do |
| [Morse in your language](i18n.md) | The nine languages, right to left for Persian and Arabic, what stays English, and how to improve a translation |

## Working on Morse

| Page | What's in it |
|---|---|
| [Developer guide](dev/README.md) | Set up a checkout, where things live, the website and gallery, roadmap |
| [Dogfood: 12 real tasks](dogfood.md) | Morse used for real on VSCodium, Obsidian, Joplin, PyPI, GitLab and the Node.js docs: what worked, what didn't, and what was fixed |
| [How a change really happens](dev/how-it-works.md) | A real recording, the live trace, and every step from your words to the change on screen |
| [How Morse works](dev/architecture.md) | Hosts, the in-app code, the `morse` kit, the engine, models, the mod format, security |
| [App profiles](dev/rea.md) | How Morse reads how a desktop app works inside (its commands, channels, objects) so changes can use the app's own logic, and what was taken from REA |
| [Native apps (prototype)](dev/native-dbi.md) | A fenced-off prototype for native apps via Frida dynamic binary instrumentation, why it crosses Morse's read-only boundary, and the ownership gate and platform diagnostics that keep it in scope |
| [Testing](dev/testing.md) | `npm run check`, `npm test`, `npm run test:ui`, test helpers, evals, screenshots, what was verified |
| [Adding a feature](dev/adding-a-feature.md) | Rules for the in-app code, words, the UI review, docs |
| [Accessibility of Morse itself](dev/accessibility.md) | Keyboard, screen readers, zoom and forced colors in Morse's own UI, and the axe-core audit |
| [Simplify](dev/simplify.md) | Every setting, menu and button, what shows and what waits under More, and Morse checked end to end on a fresh setup |
| [Checking a Mac or Windows PC](dev/platform-testing.md) | The 15-minute check for desktop apps on a real Mac or Windows PC |
| [Releasing](dev/releasing.md) | One-time setup, then `npm run release` and one push: npm, the GitHub release, and Morse's builds and signing |
| [How Morse talks](WRITING.md) | The style guide for every word a person reads |
| [Wording pass 2: messages](dev/wording-pass-2.md) | Every message in Morse changed by the second plain-words pass, with before and after |
| [Wording pass 2: docs and website](dev/wording-pass-2-docs.md) | The biggest before and after changes from the second plain-words pass over the docs and the website |
| [Languages in the code](dev/i18n.md) | `t()`, the message catalogs, the Language setting, right-to-left layout, and text that stays English for the model |
| [UI review checklist](ui/CHECKLIST.md) | What every screenshot in the UI catalog is checked against |
| [Launch kit](launch/README.md) | The demo video, clips and how they were recorded |
| [Evals](../evals/README.md) | How often Morse does what people ask, measured |

These pages are plain Markdown files in the repo. To add one, see
[Adding a feature](dev/adding-a-feature.md#docs).
