# Morse evals

How often does Morse actually do what people ask? Each case is a realistic request on a demo app ("make the album covers bigger", "hide the ads", "let me sort by this column"). The runner sends it through the real pipeline and then checks the result in the page.

```bash
node evals/run.js                                  # train split, Claude Code haiku, 4 at a time
node evals/run.js --repeat 3                       # the numbers below are 3 runs per case
node evals/run.js --split test                     # held-out cases: only for final reports
node evals/run.js --split all --model sonnet       # spot check with another model
node evals/run.js --only t-covers-bigger --dump-context   # print exactly what the model sees
node evals/run.js --provider noop --split all      # sanity: every checker must fail on the untouched page
node evals/run.js --no-probe                       # engine without the visible-effect check
```

Requires `claude` on PATH and signed in, plus Playwright with Chromium (`npm test` uses the same setup).

## How a case runs

1. Open the demo app (`demo/sites/<site>/`) in Chromium at 1280×800, served with the same CSP as `demo/serve.js`.
2. Build the context by evaluating **`runtime/src/20-context.js` itself** in the page, with the case's `target` as the pointed-at element. This is exactly what the extension and desktop runtime send.
3. Call **`core/engine.js` `runMorse`** with the `claude-code` provider (`daemon/harness.js`). CSS is applied as it streams (a `style[data-morse-css]`, like `30-mods.js`). JS runs through `wrapModCode` and the helper kit, and late callback errors are collected after 600 ms, as `daemon/connector.js` does. The engine also gets `probe`, the runtime's `effectProbe`.
4. Run the case's `check` in the page. A check is the body of an async function that returns `true` or a failure reason. It can use `T` ([`page-helpers.js`](page-helpers.js)):
   - **Queries:** `T.$`, `T.$$`, `T.fresh()` (elements the mod created).
   - **Visibility and text:** `T.visible`, `T.visibleText()` (includes `::before`/`::after` content), `T.freshText()`.
   - **Colors and fonts:** `T.bg`/`T.fg`/`T.contrast`, which account for `invert()` dark modes. `T.fontPx` accounts for `zoom`.
   - **Real input through Playwright:** `T.click`, `T.type`, `T.press`.
   - **Captures:** clipboard and download writes are recorded (`window.__clip`, `T.downloaded()`).
   - **Before value:** a case's optional `before` script runs before the change, and its result is `B` in the check.
5. Record pass/fail, attempts, repair messages, latency, the mod's CSS/JS and errors in `results/<timestamp>.json`, and append a row to the run log below.

## Cases

[`cases.json`](cases.json) has 55 cases on 6 apps. Three apps were already in the repo: **tunes** (music player), **parley** (chat app with a strict CSP) and **byte** (news site with ads). Three are new: **mail** (Postbox email client), **notes** (Inkwell docs/notes editor) and **dash** (Metricly orders dashboard with a data table).

The cases cover looks, layout, hiding, new features, text and renaming, dark mode, reading comfort, tables (sort, filter, totals, sticky header, CSV), keyboard shortcuts, media, and vague requests ("make this less cluttered", "I can't read this", "this text is tiny").

Like real apps, the fixtures use semi-hashed class names, divs with gradient backgrounds instead of images, and state kept in `data-*`/`aria-*` attributes.

The held-out split is 14 cases (25%), marked `"split": "test"`. They were only run for the final comparison; nothing was tuned on them.

## Results

Claude Code `haiku`, 3 runs per case. The baseline is the code before this work: the prompt, context builder and engine at commit 2f7badf, scored with the same final checkers.

| | Train (41 cases ×3) | Held-out test (14 ×3) | Median latency |
|---|---|---|---|
| Baseline | 101/123 **82.1%** (an earlier ×3 run: 85.4%) | 35/42 **83.3%** | 8.6 s |
| Effect check only (old context and prompt) | 103/123 83.7% | | 13.8 s* |
| **Final** | 122/123 **99.2%** | 41/42 **97.6%** | 7.0 s / 7.3 s |
| Final, `sonnet`, ×1 | 40/41 (41/41 after the progress-bar checker fix) | 14/14 | 9.2 s |

\* CLI latency varies a lot with load. The repair round fired on only 8 of 123 runs.

**What moved the numbers.** Almost all of the gain came from what the model sees ([`runtime/src/20-context.js`](../runtime/src/20-context.js)) and is told ([`core/prompt.js`](../core/prompt.js)). Each baseline failure maps to missing information:

| Baseline failure | Cause | Fix |
|---|---|---|
| Covers not bigger (targeted `img`, or `min-width` inside a fixed grid column) | Couldn't see that covers are 155px divs with gradient backgrounds, sized by `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))` on the grid | Target facts: rendered size, look, "No `<img>`: the visuals are CSS background images", the CSS rules on the target, its parent and its grid/flex container. Inline `style` kept in the snippet. Prompt: "change what actually sets the size" |
| "Hide the ads" left 2 of 4 ad slots; "get rid of these" only hid the one pointed at | The outline listed landmarks only; ad slots never appeared | A layout tree of visible blocks with sizes and flags (fixed, grid, scrolls, bg-gradient), repeated siblings collapsed to `×N`. "N elements match `div.ad-slot`". Prompt: "pointing is approximate; 'these' means every similar element" |
| "Highlight failed orders in red" colored only the badge | Took the pointed-at part literally | Prompt: "a request about items changes the whole item" |
| "Make the writing area wider" set `max-width` against a fixed `width: 620px` | Couldn't see the rule | CSS rules on the target and its parent |
| "Make my messages blue" changed the text color | Didn't know the bubble is a background | Computed background, color, radius |
| Play button not green | Lost to existing specificity | Prompt: "your CSS must beat the existing rules" |
| "Mark everything as read" guessed `.unread` | Unread state is `data-unread="true"` | Repeated items in the layout show their attributes |
| Progress bar never appeared | `morse.el` doesn't attach the element | Prompt: "you must append it" |

**The visible-effect repair** ([`core/engine.js`](../core/engine.js)) is a safety net. With the new context it almost never fires: 0 of 123 runs in the final train run. With the old context it fired on 8 of 123 runs and rescued a few (a specificity loss, a dead `:has()` selector). It can't help when the model lacks the information (n-wider still failed after the hint).

Two false positives turned up during development and were fixed:
- `position: sticky` changes nothing until you scroll, so the fingerprint now includes `position`.
- CSS for state that only appears after a click (`th[data-sort=asc]`) no longer counts as dead when the JS found its targets.

**Remaining failures** (final, haiku):
- **Scroll-driven feature wiring** (b-progress, 1 of 3): the JS updates a CSS variable that the CSS never reads. Nothing is wrong at apply time, so neither the JS error repair nor the effect check can catch it.
- **Magnitude on vague layout asks** (m-compact, 1 of 3): rows got 19% denser where the check wants 20%.

The eval is close to saturated for these fixtures. The next useful cases are harder apps: fully hashed class names, shadow DOM, iframes, virtualized lists, very large DOMs, and multi-step features.

**Checker fixes made during the work.** Each was a checker rejecting a working change; none was loosened to pass a broken one.
- The sleep timer may be a `<select>`, not only a button.
- Text and bars may be CSS pseudo-elements (`content: attr(data-words) " words"`, `body::before`).
- A pale red row tint counts as "highlight in red".
- The title count may update on a 2-second interval.
- A transparent full-width track doesn't count as the progress bar.

The baseline above was re-scored with the final checkers.

**Wiring the effect check in the app.** `runMorse({ probe })` is optional, and hosts that don't pass it behave exactly as before. Today only the eval passes it. To turn it on, the desktop connector and the extension need to evaluate `effectProbe(targetSelector, selectors)` from `20-context.js` in the page and return `{ fp, unmatched }`.

## Run log

Rows before "baseline (rescored checkers)" used earlier checkers. Results JSON is kept only for the latest final run; this table summarizes the rest.

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
| 2026-10-24 11:58 | speed: baseline subset | claude-code:haiku | only | 36/36 (100%) | 9.4s |
| 2026-10-24 12:14 | speed: after, warm subset | claude-code:haiku | only | 36/36 (100%) | 5.2s |
| 2026-10-24 12:19 | speed: after, cold (no head start) subset | claude-code:haiku | only | 36/36 (100%) | 5.8s |
<!-- run-log -->
