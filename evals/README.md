# Morse evals

How often does Morse actually do what people ask? Each case is a realistic request on a demo app ("make the album covers bigger", "hide the ads", "let me sort by this column"). The runner sends it through the real pipeline and then checks the result in the page.

```bash
node evals/run.js                                  # train split, Claude Code haiku, 4 at a time
node evals/run.js --repeat 3                       # the numbers below are 3 runs per case
node evals/run.js --split test                     # held-out cases: only for final reports
node evals/run.js --sites hard                     # only the harder apps (--sites easy: the first six)
node evals/run.js --split all --model sonnet       # spot check with another model
node evals/run.js --only t-covers-bigger --dump-context   # print exactly what the model sees
node evals/run.js --only w-dark-cards --dump-context --context-only --provider noop   # ...without calling a model
node evals/run.js --provider noop --split all      # sanity: every checker must fail on the untouched page
node evals/run.js --no-probe                       # engine without the visible-effect check
```

Requires `claude` on PATH and signed in, plus Playwright with Chromium (`npm test` uses the same setup).

## How a case runs

1. Open the demo app (`demo/sites/<site>/`) in Chromium at 1280×800, served with the same CSP as `demo/serve.js`. Wait 3.5 s: apps settle (timers, first re-renders), and a person points and types before the page is read.
2. Build the context by evaluating **`runtime/src/20-context.js` itself** in the page, with the case's `target` as the pointed-at element. This is exactly what the extension and desktop runtime send. A target can be inside an open shadow root or a same-origin frame: `"hearth-bar >>> room-tabs >>> button"` (the picker points into open shadow roots too).
3. Call **`core/engine.js` `runMorse`** with the `claude-code` provider (`daemon/harness.js`). CSS is applied as it streams (a `style[data-morse-css]`, like `30-mods.js`). JS runs through `wrapModCode` and the helper kit, and late callback errors are collected after 600 ms, as `daemon/connector.js` does. The engine also gets `probe`, the runtime's `effectProbe`, as both hosts now pass it.
4. Run the case's `check` in the page. A check is the body of an async function that returns `true` or a failure reason. It can use `T` ([`page-helpers.js`](page-helpers.js)):
   - **Queries:** `T.$`, `T.$$`; `T.q`/`T.qq` for `"host >>> inside"` paths; `T.all(sel)` in every root (document, open shadow roots, same-origin frames); `T.fresh()` (elements the mod created, in any root).
   - **Visibility and text:** `T.visible` (across shadow roots and frames), `T.visibleText()` (includes `::before`/`::after` content), `T.deepText()`, `T.freshText()`.
   - **Colors and fonts:** `T.bg`/`T.fg`/`T.contrast`, which account for `invert()` dark modes. `T.fontPx` accounts for `zoom`.
   - **Real input through Playwright:** `T.click` (scrolls only when the element isn't already on screen and on top, like a person), `T.hover`, `T.type`, `T.press`, `T.scroll`, `__evalDrag`.
   - **Captures:** clipboard and download writes are recorded (`window.__clip`, `T.downloaded()`, `T.downloads()` with MIME types); `confirm()` is recorded in `window.__confirms` and answers `window.__confirmAnswer`.
   - **Before value:** a case's optional `before` script runs before the change, and its result is `B` in the check.
5. Record pass/fail, attempts, repair messages, latency (model and apply: `genMs`; reading the page: `ctxMs`), prompt size, the mod's CSS/JS and errors in `results/<timestamp>.json`, and append a row to the run log below.

## Cases

[`cases.json`](cases.json) has 86 cases on 13 apps.

**The first six apps** (55 cases): **tunes** (music player), **parley** (chat app with a strict CSP), **byte** (news site with ads), **mail** (email client), **notes** (docs editor) and **dash** (orders dashboard with a data table). They cover looks, layout, hiding, new features, text, dark mode, reading comfort, tables, keyboard shortcuts, media and vague requests. Their fixtures use semi-hashed class names, divs with gradient backgrounds instead of images, and state in `data-*`/`aria-*` attributes.

**Seven harder apps** (31 cases), each built around something real apps do that trips a model up:

| App | What makes it hard | Cases |
|---|---|---|
| **shop** (storefront) | Every class name is generated: CSS-module names (`Header_cart__k3J9x`) and emotion names (`css-1q2w3e`). Each checker first calls `__rehash()`, the app's next release: every generated name changes, so a mod that used them stops working. | hide the banner, bigger bold prices, hide out-of-stock products, a sort-by-price button, 4 per row |
| **home** (smart home) | Web components with open shadow roots, nested (`hearth-bar >>> room-tabs`). The cards expose `part="card"` and read `--card-bg`; the switches are reachable only from inside. The tabs re-render their shadow root on every click. | dark cards, bigger switches (still working), hide offline devices, an "all off" button, rename a tab (survives a re-render) |
| **builder** (page builder) | The page being edited is a same-origin `<iframe>`; a help widget is another one. Page CSS doesn't reach inside. | bigger preview text, hide the preview's cookie notice, wider preview, a dark preview (not the editor) |
| **logs** (log viewer) | A virtualized list: 5,000 lines, 37 row elements reused as you scroll. The level is only text. Checkers scroll to several places and look again. | errors in red, hide DEBUG lines, a copy button per line (copies the line it's on now), jump to the newest line |
| **tasks** (kanban) | A React-style app: the header re-renders every second and the board every 3 seconds, with `innerHTML`, wiping anything a script added. Priority is only text. Checkers wait for re-renders and click. | cross out finished tasks, "N left" next to the title (updates), high priority in orange, confirm before deleting (says no, then yes), rename a column |
| **sketch** (drawing app) | Canvas: what you see is pixels. Checkers read pixels and draw with the mouse. | save as PNG, move the minimap, press C to clear, a bigger drawing area (that still draws under the pointer) |
| **wiki** (encyclopedia page) | 11,000+ elements: a 700-row table, 500 references, 400 comments, a long footer. | hide the comments, keep the contents visible while scrolling, highlight cities over a million, back to top |

The held-out split is 21 cases (24%), marked `"split": "test"`: 14 on the first six apps and 7 on the harder ones (one per app). Nothing was tuned on them; they were run only for the final comparison.

## Results

Claude Code `haiku`, 3 runs per case, all 86 cases. **Baseline** is the code before this round (commit fa7b111: the first round's final prompt, context builder, kit and engine); **Final** is this branch. Both ran at the same time, against the same apps and checkers.

| | First six apps, train (41 ×3) | First six, held-out (14 ×3) | Harder apps, train (24 ×3) | Harder, held-out (7 ×3) |
|---|---|---|---|---|
| Baseline | 121/123 98.4% | 41/42 97.6% | 58/72 **80.6%** | 16/21 **76.2%** |
| **Final** | 123/123 **100%** | 41/42 **97.6%** | 70/72 **97.2%** | 19/21 **90.5%** |
| *An earlier pair of runs:* baseline / final | 98.4% / 99.2% | 95.2% / 100% | 73.6% / 94.4% | 61.9% / 90.5% |

The earlier pair ran before the last few fixes and the merge of main, with two canvas checkers that were later fixed (below), so its baseline on the harder apps is lower.

By kind of app (harder apps, train and held-out together, baseline → final): virtualized list 4/12 → **12/12**, iframes 8/12 → **12/12**, shadow DOM 12/15 → **15/15**, re-rendering app 12/15 → 13/15, hashed classes 14/15 → 15/15, 11k-element page 12/12 → 11/12, canvas 12/12 → 11/12.

**Latency and prompt size** (all 258 runs per side; the CLI was much slower during the second pair, so both pairs are shown):

| | Model + apply, median / p90 | Prompt, median / p90 | Reading the page (`context()`), median / p90 | Repair rounds |
|---|---|---|---|---|
| Baseline | 18.8 s / 57.2 s (earlier pair: 10.2 s / 20.6 s) | 5,617 / 7,492 chars | 28 / 230 ms (harder apps p90: 1,149 ms) | 10 |
| Final | 19.6 s / 54.6 s (earlier pair: 10.1 s / 19.7 s) | 6,963 / 8,482 chars | 50 / 266 ms (harder apps p90: 307 ms) | 3 |

The prompt grew by about 1,300 characters (the notes about the page, a few rules and helpers), which didn't show in the time. Reading the 11,000-element page went from about 1.1 s to 0.3 s (p90), mostly by working out outline selectors only for the lines that are kept.

### What moved the numbers

Every baseline failure on the harder apps came from the model not knowing what kind of page it was on, or from the kit not being able to reach where the change had to go.

| Failure (baseline, or *during development*) | Cause | Fix |
|---|---|---|
| Virtualized log: errors red / DEBUG hidden on the first screen only, or on the wrong lines after scrolling; copy buttons copying stale lines | One-time `morse.watch` decisions on rows the list reuses for other lines; CSS can't read the level text | A page note: "a virtualized list: 37 row elements stand in for about 5,000 items… decide from a row's current content every time it changes", naming the row's fields. Kit: `morse.watch(sel, fn, { live: true })` re-runs `fn` when a row changes, undoing what it did before. Prompt: "CSS can't select by text" |
| Dark cards / bigger switches did nothing | Page CSS can't reach into shadow roots; the context never showed what's inside them | The context reaches into open shadow roots: `"host >>> inside"` selectors, a `<shadow-root>` in the snippet, shadow content in the layout and outline, the component's parts and CSS variables. Kit: `morse.css(css, "device-card")` puts CSS inside every component; `morse.watch`/`morse.$$` understand `>>>` |
| Hide the preview's cookie notice / dark preview did nothing (or answered instead of changing) | Same for same-origin frames | Frames in the layout, outline and notes (with the CSS that sizes their text); `morse.css(css, "#pv")`. `host >>> inside { … }` rules written in the CSS block move to the JS automatically (`core/parse.js`) |
| High priority not orange, or every task orange | `:has(.pri:not(:empty))` hacks: "High" is only text | The facts say when similar elements differ only by text: *"Their text differs ("High" ×4, "Medium" ×4, "Low" ×3) but none of their attributes do: CSS can't pick them by it"*. And a new repair: a class the JS adds that no CSS uses (`deadHooks`, also catches a CSS variable nobody reads) |
| Cities over a million: nothing highlighted | `tr.querySelector("td.n")` is the rank column | Cells keep their column in selectors (`td.n:nth-of-type(4)`), "700 similar elements: … td:nth-child(4)", and *"Careful: td.n matches 4 cells in each row"* |
| *Sort-by-price on the hashed shop picked a card as the grid* | The layout named list containers only `div` | A list's unnamed container shows its full selector; "12 similar elements (the same part of each repeated item)" |
| "Show N left" stopped updating; renamed items came back | The app's re-render wiped what the mod set once | A page note on what re-renders and how often. Kit: `morse.watch` puts back what a re-render wiped (elements it added, classes, inline styles, attributes, text), while what the mod's own handlers change counts as the new state |
| *"Add a button that turns every device off" → only a toast* | Model laziness | A new repair: a change that only shows a notice gets one more try |

The kit changes are tested on their own in `tests/kit.test.js` (re-render wiping, a mod's own toggles staying put, live rows, shadow roots and frames).

### The effect check is live in both hosts

`runMorse({ probe })` used to be passed only by the eval. Now:
- **Desktop** ([`daemon/connector.js`](../daemon/connector.js)): evaluates `__morseProbe(targetSelector, selectors)` in Morse's isolated world of the document that asked. Pushes and probes go over the same CDP session, so the streamed CSS is on the page first.
- **Extension** ([`extension/background.js`](../extension/background.js), [`extension/host.js`](../extension/host.js)): the worker asks over the bar's port, after the CSS it streamed; the content script answers from its world. No answer within 3 s (an old content script, the practice page) means no check.
- `runtime/src/20-context.js` publishes `__morseProbe` in Morse's own world (never the page's); it waits 100 ms so CSS transitions have started. The fingerprint now covers open shadow roots and same-origin frames, styles for the first 4,000 elements and boxes for the rest.
- Tests: `tests/connector.test.js` and `tests/effect-check.test.js` (the real extension, a real helper with the demo model) ask for "paint the page gold": the demo model's first draft matches nothing, and the effect check sends it back once.

### Privacy

The context now carries CSS rules, inline styles and a layout tree, so everything that goes to the model passes through one helper, `redact()` in [`runtime/src/20-context.js`](../runtime/src/20-context.js) (marked `// redact`): `context()` runs it on the whole object and `snippet()` on every element clone. Input values are never read from the live page; `value` attributes are dropped from inputs other than buttons and checkboxes (passwords, `cc-*` fields, prefilled fields), hidden inputs keep only `type`/`name`/`id`, and textareas are emptied. JWTs, API keys (`sk-…`, `ghp_…`, `AKIA…`), long random strings, token/key/session/code values in URLs, Luhn-valid card numbers and email addresses become `[token]`, `[redacted]`, `[card]` and `[email]`. Field labels never use a field's own text. `tests/context-privacy.test.js` builds the real prompt for a billing page full of secrets and checks none of them is in it.

### Remaining failures (final)

- **A count that has to follow the app** (r-left, 2 of 3 in the second pair): the mod writes "N left" but recomputes it on the wrong trigger, or counts an invented `.done` class.
- **Canvas size** (c-bigger, held-out, 1 of 3): made it 1200×764, which runs off the screen.
- **Back to top on a very long page** (l-top, held-out, 1 of 3): the smooth scroll up 80,000 px was still running when the checker looked. A checker timing problem, fixed after the run (it now waits up to 4 s); the number above counts it as a failure.
- **Search box** (m-search, held-out, 1 of 3): the JS listens and does nothing.
- In the earlier pair also: an "all off" button that was only a toast (now a repair round), a PNG save that took longer than the checker waited (now 2 s), and one structural selector off by one.

### Checker fixes in this round

Each was a checker rejecting a working change; none was loosened to pass a broken one.
- w-all-off: offline devices can't be switched off, so only online switches have to show "off".
- f-wider: a preview that fills the stage between the two side panels (640 → 724 px) counts as wider: 1.1×, not 1.2×.
- c-bigger: keeping the drawing's shape, the stage fits about 1.29× the area, so the checker asked for more than the layout allows: 1.15×.
- c-save-png: waits up to 2 s for the PNG (toBlob is asynchronous).
- l-top: waits for the smooth scroll to finish.

## The first round

The first round (6 apps, 55 cases) raised Claude Code haiku from about 82% to 99% on train and 98% held-out by showing the model what it was missing: the target's rendered size and look, the CSS rules on it, its parent and its grid/flex container, a layout tree of visible blocks with repeated siblings collapsed to `×N` (and their state attributes), "N elements match `div.ad-slot`", and prompt rules ("pointing is approximate", "a request about items changes the whole item", "your CSS must beat the existing rules", "you must append it"). It also added the visible-effect repair to the engine, which then fired on 0 of 123 final train runs; with the old context it fired on 8 and rescued a few. Its checker fixes: the sleep timer may be a `<select>`; text and bars may be pseudo-elements; a pale red row tint counts as red; the title count may update on a 2-second interval; a transparent track isn't the progress bar.

## Run log

Rows before "baseline (rescored checkers)" used earlier checkers. "dev" rows are this round's development runs on the train split. Results JSON is kept only for the final pair (`results/*-baseline.json`, `results/*-final.json`); this table summarizes the rest. Baseline rows ran from a copy of commit fa7b111 with the current apps and checkers.

| When (UTC) | Label | Model | Split | Pass | Median latency |
|---|---|---|---|---|---|
| 2026-10-24 08:38 | baseline (old checkers) | claude-code:haiku | train | 33/41 (81%) | 10.6s |
| 2026-10-24 08:41 | baseline x2 (old checkers) | claude-code:haiku | train | 66/82 (81%) | 7.9s |
| 2026-10-24 08:46 | context+prompt, no item attributes (old checkers) | claude-code:haiku | train | 72/82 (88%) | 7.8s |
| 2026-10-24 08:52 | baseline (rescored checkers) | claude-code:haiku | train | 105/123 (85%) | 8.5s |
| 2026-10-24 08:57 | context+prompt+effect check | claude-code:haiku | train | 121/123 (98%) | 9.4s |
| 2026-10-24 09:05 | final | claude-code:haiku | train | 122/123 (99%) | 7.0s |
| 2026-10-24 09:10 | final (held-out) | claude-code:haiku | test | 41/42 (98%) | 7.3s |
| 2026-10-24 09:12 | baseline (final checkers) | claude-code:haiku | all | 136/165 (82%) | 8.7s |
| 2026-10-24 09:20 | ablation: effect check only (old context+prompt) | claude-code:haiku | train | 103/123 (84%) | 13.8s |
| 2026-10-24 09:30 | final, sonnet spot check | claude-code:sonnet | all | 54/55 (98%) | 9.2s |
| 2026-10-24 10:37 | baseline (fa7b111), harder apps x3 | claude-code:haiku | train (hard) | 53/72 (74%) | 19.6s (p90 31.1s) |
| 2026-10-24 10:57 | dev | claude-code:haiku | only | 5/8 (63%) | 20.7s |
| 2026-10-24 10:59 | dev: old cases | claude-code:haiku | train | 40/41 (98%) | 26.2s |
| 2026-10-24 11:02 | dev2 hard x3 | claude-code:haiku | train | 64/72 (89%) | 29.8s |
| 2026-10-24 11:16 | dev3 hard x3 | claude-code:haiku | train (hard) | 61/72 (85%) | 26.7s (p90 38.7s) |
| 2026-10-24 11:31 | dev4 easy | claude-code:haiku | train (easy) | 40/41 (98%) | 20.6s (p90 35.4s) |
| 2026-10-24 11:31 | dev4 hard x3 | claude-code:haiku | train (hard) | 66/72 (92%) | 18.6s (p90 36.5s) |
| 2026-10-24 11:39 | dev5 easy x2 | claude-code:haiku | train (easy) | 81/82 (99%) | 14.6s (p90 25.3s) |
| 2026-10-24 11:39 | dev5 hard x3 | claude-code:haiku | train (hard) | 67/72 (93%) | 16.9s (p90 28.4s) |
| 2026-10-24 11:47 | dev6 shop | claude-code:haiku | only | 11/12 (92%) | 13.8s (p90 18.9s) |
| 2026-10-24 11:48 | baseline (fa7b111), all apps | claude-code:haiku | all | 227/258 (88%) | 14.1s (p90 25.2s) |
| 2026-10-24 11:48 | final, all apps | claude-code:haiku | all | 251/258 (97%) | 13.9s (p90 23.9s) |
| 2026-10-24 12:15 | baseline (fa7b111), all apps, run 2 | claude-code:haiku | all | 236/258 (92%) | 23.5s (p90 61.4s) |
| 2026-10-24 12:15 | final (merged), all apps | claude-code:haiku | all | 253/258 (98%) | 23.8s (p90 59.3s) |
| 2026-10-24 13:05 | after merging the guarded kit, harder apps | claude-code:haiku | all (hard) | 29/31 (94%) | 42.1s (p90 65.2s) |
| 2026-10-24 13:05 | after merging the guarded kit, first six apps | claude-code:haiku | all (easy) | 54/55 (98%) | 36.4s (p90 48.6s) |
<!-- run-log -->
