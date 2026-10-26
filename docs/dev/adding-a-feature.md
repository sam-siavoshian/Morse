# Adding a feature

Most features touch the same places: a pure module in `core/`, a file in
`runtime/src/`, a request handler in each host, styles, tests, screenshots
and a docs page. Many people work on Morse at once, so each feature hooks in
with as few lines as possible in shared files.

## The usual shape

1. **Pure logic in `core/<feature>.js`**, with no imports and no globals, so
   node tests can load it as is and `runtime/bundle.js` can inline it. Add it
   to the `shared` list in [`runtime/bundle.js`](../../runtime/bundle.js)
   with `inlineModule(...)` (its exports become locals in their own scope).
2. **In-app code in `runtime/src/NN-<feature>.js`**. Files run in filename
   order, so pick a number after what you depend on (see the table in
   [How Morse works](architecture.md#the-runtime-runtime)). Styles go in
   `runtime/src/98-<feature>-css.js`, using the shared parts in
   `99-css.js`.
3. **Hooks, one marked line each.** Where your feature has to touch a shared
   file (the bar, the panel, Settings, the page tools menu, boot), add one
   line and mark it, so others can merge around it:
   ```js
   <style>${HEAL_CSS() /* self-heal hook: 98-heal-css.js */}</style>
   ```
   Some files offer hook arrays instead, like `quickMenuGroups` in
   `46-quick.js` or `outgoing` in `01-rpc.js`.
4. **Host requests.** The desktop connector routes them to a
   `daemon/<feature>.js`. Code the site's Try it here shares goes in
   `core/<feature>-host.js` with its storage passed in (like
   [`core/gallery-host.js`](../../core/gallery-host.js)).
5. **Tests**: unit tests for the core module, a browser test for the UI
   (`tests/<feature>-ui.test.js`, using [the helpers](testing.md#test-helpers)).
6. **Screenshots**: a `demo/shoot-<feature>.js` that drives the real
   desktop connector, writing to `docs/screenshots/`.
7. **Docs**: see [Docs](#docs) below.

## Runtime rules

The runtime is one function scope injected into other people's pages. These
rules are checked by tests:

- **No duplicate top-level names.** `runtime/src/*.js` and the inlined core
  modules share one scope. A second `const` with the same name is a
  SyntaxError that kills the whole runtime. A second `function` silently
  replaces the first. Wrap a feature in one object
  (`const Heal = (() => { … return { soon, kept }; })();`) and keep helpers
  inside it. `npm run check` and `tests/bundle.test.js` fail on a duplicate,
  naming both places.
- **Every window listener goes through `listen()`** (from `01-rpc.js`), never
  a bare `addEventListener` on the page's window or document. `listen()`
  checks `live()`, so a copy of the runtime that was detached (`morse stop`)
  leaves the page's keys and clicks alone. `tests/hardening.test.js` checks
  every file.
- **Key handlers check `isTrusted`.** Every `listen("keydown", e => {…})` and
  `keyup` handler starts by ignoring events the page made up
  (`if (!e.isTrusted || …) return;`), so a page can't open the bar, talk or
  act inside it. Checked by `tests/hardening.test.js`.
- **Nothing per key, per pointer move or per frame that reads layout.** Hit
  tests (`elementsFromPoint`), rects and `getComputedStyle` cost a few ms
  each on a big page. Do them when something actually moved, and after a
  scroll once the page rests; with nothing of Morse's showing, a page's
  scrolling runs nothing of Morse's. The bar's solid backing
  (`50-bar.js` Backing) is the pattern. A feature that runs while the bar is
  open gets a count budget in `tests/perf.test.js` and a row in
  [`docs/perf/budgets.md`](../perf/budgets.md).
- **UI lives in the shadow root** created in `10-dom.js`. Anything that has to
  live in the page (text being edited in place, a mod's own elements) is
  marked `data-morse-ui` or `data-morse`.
- **Colors, sizes and radii come from tokens**
  ([`design/tokens.css`](../../design/tokens.css)), as `var(--m-*)`. No color
  literals in the runtime's CSS.
- **Errors reach people through `plainError()`** from
  [`core/onboarding.js`](../../core/onboarding.js). Raw errors from the
  browser, the network or a mod's code never show as is. A new kind of error
  gets a rule in `ERROR_RULES` and a row in
  [Troubleshooting](../troubleshooting.md).

## Plain words

Every word a person reads follows [How Morse talks](../WRITING.md): short
sentences, everyday words, one name for each thing (the glossary), Save and
Undo for anything not saved yet, and errors that say what went wrong and the
one thing to try.

[`tests/words.test.js`](../../tests/words.test.js) scans the runtime's
strings, the Morse app, the share page, the website and the user
pages in `docs/` for words people don't know (CSS, selector, element, prompt,
enable, hotkey, …). When a developer word belongs in a place on purpose (the
Edit code view), add it to the test's `ALLOWED` list with the reason.

## The UI review loop

1. `npm run ui` builds the runtime and shoots every state of the UI
   ([`demo/ui-catalog.js`](../../demo/ui-catalog.js)): dark and light hosts,
   desktop and phone widths, and hostile host pages that try to break the
   overlay. Add your feature's states to the catalog. `--only=<area>` shoots
   one area.
2. Each shot is audited automatically (clipped text, boxes off screen,
   control heights, style leaking in from the host, text contrast), and
   `node demo/contrast.js` checks every token pair.
3. Open the contact sheet `npm run ui` wrote beside the shots, and
   check each shot by eye against [the checklist](../ui/CHECKLIST.md).
   The sheet is not committed.
4. Write verdicts and notes in `docs/ui/review.json`
   (`{ states: { "area/state": { note, verdict, accept } } }`). An automated
   issue that is fine on purpose needs an `accept` with the reason.
5. Fix what fails, shoot again, until every state is ✅ or has a written
   reason.

## Docs

- **A user page in `docs/`** for the feature: what it does and how to use it,
  in plain words, with screenshots from `docs/screenshots/`. Add it to the
  table in [docs/README.md](../README.md), or add a section to the page it
  belongs to.
- **One row in the README's “What you can do” table**: a name, one plain
  line, a link to the docs page. Nothing else goes in the README. If what is
  verified changes, update its Status block, and keep it in step with
  [Desktop apps](../desktop.md) and the [launch kit](../launch/README.md).
- **Developer detail in `docs/dev/`**: how it works goes in
  [How Morse works](architecture.md), how it's tested in
  [Testing](testing.md).
- `npm test` checks that every link and image path resolves and every page
  is listed (`tests/docs.test.js`), and that user pages follow the word list
  (`tests/words.test.js`).

## Before you commit

```bash
node scripts/build.js
npm run check
DISPLAY=:99 npm test
```
