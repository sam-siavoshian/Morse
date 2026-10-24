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
2. Like a person, the bar opens and the model gets ready (`prewarm`) 2.5 s before Enter (`--typing-ms`; 0 for no head start). Build the context by evaluating **`runtime/src/20-context.js` itself** in the page, with the case's `target` as the pointed-at element. This is exactly what the extension and desktop runtime send.
3. Call **`core/engine.js` `runMorse`** with the `claude-code` provider (`daemon/harness.js`). CSS is applied as it streams (a `style[data-morse-css]`, like `30-mods.js`). JS runs through `wrapModCode` and the helper kit, and late callback errors are collected after the wait the kit asks for (`settle`: 150 ms for most mods, up to 600 ms when timers or events could fire), as `daemon/connector.js` does. The engine also gets `probe`, the runtime's `effectProbe`.
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

## Speed

Every run prints the median and p90 of each stage, in ms from Enter, and the results JSON has them per case (`stages`). The subset below is 18 cases on all six apps (CSS-only and JS changes), ×2, Claude Code `haiku`, 2 at a time, on a busy machine (load 13 to 30).

| Stage (ms from Enter) | Before | After, bar opened 2.5 s before Enter | After, no head start |
|---|---|---|---|
| Reading the page (in the page) | 7 / 16 | 9 / 28 | 8 / 15 |
| Prompt size (chars) | 6020 / 7974 | 6020 / 7974 | 6020 / 7974 |
| `claude -p` start (spawn to ready) | 3078 / 6018 | 138 / 349 | 2902 / 4137 |
| First token | 5123 / 8520 | 1800 / 4831 | 5088 / 9447 |
| First change on the page | 5304 / 8678 | **1685 / 4712** | 4857 / 9577 |
| Model done | 8838 / 12196 | 2489 / 5346 | 5363 / 10837 |
| Total | 9197 / 12913 | **2655 / 5561** | 5503 / 11109 |
| Passed | 36/36 | 36/36 | 36/36 |

Median / p90. All 55 cases ×2 after the changes: 110/110. Run side by side on a much busier machine (load 50 to 66, both at once, after merging main): first change on the page 13523 / 17780 → 6935 / 11684, total 17973 / 22260 → 7483 / 11969, 36/36 both. There, starting `claude` took longer than the 2.5 s head start, so the process was still starting at Enter.

What moved the numbers:
- **Answer at `message_stop`** (`daemon/harness.js`). Claude Code kept running for 2.4 to 4.8 s after the last token (a summary of the turn, usage, exit) before the harness returned. Now it returns at `message_stop`, and the CLI runs with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Last token to done: 3124 → 33 ms.
- **A process started ahead of time.** Starting `claude` takes 1 to 3 s (more on a busy machine). When the bar opens, and after each request, Morse starts the next process with `--input-format stream-json` and stdin open; the request is written to it on Enter. Each process answers one request in a fresh empty directory with no session saved, and only takes a request whose model, instructions and environment match. Unused, it stops after 5 minutes (about 185 MB while it waits). `MORSE_WARM=0` turns it off.
- **Error wait per mod** (`core/kit.js` `settle`). Hosts waited 600 ms after running JS for late errors. The kit now says how long its callbacks can take: 150 ms for watches and clicks, until the first tick for timers, 600 ms for events that fire on their own. Model done to total, JS changes: 768 → 326 ms.
- **The page outline** built a page-wide selector for every button before trimming to 50 lines. On a page with 5,000 table rows that took 27 s; now 0.35 s, with byte-identical context on all 55 cases.
- **Anthropic API** (measured against a local mock; no key here): the instructions go in a cached `system` block, and opening the bar sends a `max_tokens: 0` request that writes the cache and loads the SDK. The first request's own overhead went from 1.1 to 1.5 s to 25 to 120 ms.

Tried and left out: `--effort low` for Claude Code (no faster on haiku: 2946 vs 2655 ms total), and trimming the context (reading the page is under 30 ms on these apps, and the model's thinking, not the prompt length, is what remains).

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
| 2026-10-24 12:14 | speed: after, warm subset (bar opened 2.5 s before Enter) | claude-code:haiku | only | 36/36 (100%) | 2.7s |
| 2026-10-24 12:19 | speed: after, cold (no head start) subset | claude-code:haiku | only | 36/36 (100%) | 5.8s |
| 2026-10-24 12:29 | speed: final, all cases x2 (machine load ~80, latency not comparable) | claude-code:haiku | all | 110/110 (100%) | 18.2s |
<!-- run-log -->
