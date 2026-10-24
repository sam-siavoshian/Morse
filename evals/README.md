# Morse evals

How often does Morse actually do what people ask? Each case is a realistic request on a demo app ("make the album covers bigger", "hide the ads", "let me sort by this column"). The runner sends it through the real pipeline and then checks the result in the page.

```bash
node evals/run.js                                  # train split, Claude Code, Automatic (sonnet, then opus), 4 at a time
node evals/run.js --repeat 3                       # the numbers below are 3 runs per case
node evals/run.js --split test                     # held-out cases: only for final reports
node evals/run.js --sites hard                     # only the harder apps (--sites easy: the first six)
node evals/run.js --split all --model opus         # spot check with one model (sonnet, opus, haiku…)
node evals/run.js --only t-covers-bigger --dump-context   # print exactly what the model sees
node evals/run.js --only w-dark-cards --dump-context --context-only --provider noop   # ...without calling a model
node evals/run.js --provider noop --split all      # sanity: every checker must fail on the untouched page
node evals/run.js --no-probe                       # engine without the visible-effect check
```

Requires `claude` on PATH and signed in, plus Playwright with Chromium (`npm test` uses the same setup).

## How a case runs

1. Open the demo app (`demo/sites/<site>/`) in Chromium at 1280×800, served with the same CSP as `demo/serve.js`.
2. Like a person, the bar opens and the model gets ready (`prewarm`) 2.5 s before Enter (`--typing-ms`; 0 for no head start); the page gets at least 3.5 s either way, so apps settle (timers, first re-renders) before they are read. Build the context by evaluating **`runtime/src/20-context.js` itself** in the page, with the case's `target` as the pointed-at element. This is exactly what the extension and desktop runtime send. A target can be inside an open shadow root or a same-origin frame: `"hearth-bar >>> room-tabs >>> button"` (the picker points into open shadow roots too).
3. Call **`core/engine.js` `runMorse`** with the `claude-code` provider (`daemon/harness.js`). CSS is applied as it streams (a `style[data-morse-css]`, like `30-mods.js`). JS runs through `wrapModCode` and the helper kit, and late callback errors are collected after the wait the kit asks for (`settle`: 150 ms for most mods, up to 600 ms when timers or events could fire), as `daemon/connector.js` does. The engine also gets `probe`, the runtime's `effectProbe`, as both hosts now pass it.
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

Afterwards main's guarded kit was merged in, and the watch behavior described below was rebuilt inside it. A sanity run of that (×1, all splits): first six apps 54/55, harder apps 29/31 (s-sort, c-bigger).

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

Tried and left out at first: `--effort low` for Claude Code (no faster on haiku on the demo apps: 2946 vs 2655 ms total). On real apps it was: haiku thought for 11 to 21 s before writing at Claude Code's own effort, so low is now the default ([dogfood](../docs/dogfood.md)), and trimming the context (reading the page is under 30 ms on these apps, and the model's thinking, not the prompt length, is what remains).

## Fast and strong models (Automatic)

### Now: sonnet, then opus

Haiku is no longer a default anywhere. The changes people care most about (new UI, new features, restyles) are judged by how they look, and a small model's UI rarely looks like it belongs to the app. So both of Automatic's models are strong ones (`core/route.js` `TIERS`):

| Backend | First model (small tweaks) | Strong model |
|---|---|---|
| Claude Code | `sonnet` | `opus` |
| Anthropic API | `claude-sonnet-5-5` | `claude-opus-5-5` |
| OpenAI API | `gpt-5` | `gpt-5`, `reasoning_effort: "high"` |
| Codex | the plan's model, medium effort | the same, high effort |

Haiku (or any other model) can still be named: `morse config --fast-model haiku`. Names saved in `config.json` are kept, so someone who chose haiku keeps it; a `config.json` without names gets these defaults.

**What goes to the strong model up front.** Any one of: new behavior (a button that does something, a key, a search, saving, asking first…), **new UI** (`add a … panel / badge / count / progress bar`, `show how many …`), or a **restyle** (a theme or dark mode, "make it look native", "less cluttered", "match the app"). The weaker signals (working with the data, several steps, a canvas, a page the notes say keeps changing) still need two. Small tweaks stay on the first model: hiding, bigger text, a color, spacing, sticky, renaming, highlighting. As before, a first draft that fails a guard or the effect check, or still throws after its own repair, goes to the strong model.

**The warm process.** A waiting `claude` process holds about 180 MB whichever the model, and saves 1 to 2 s before the first token (measured here: 1.9 to 3.1 s cold, 0.9 to 1.2 s started ahead of time). When the bar opens Morse starts the first model, as before. Now, when typing pauses, the bar tells the host the words so far (`runtime/src/50-bar.js`, `call("warm", { request })`; they go only to the local helper or the extension's worker), and Automatic starts the model those words would start on (`warmSettings(settings, request)`). So a request for new UI finds opus starting or started, while only one process waits at a time; after each request the first model is started again. Warming both models every time the bar opens would make the strong model fully ready but double the memory for every open bar, most of which end in a tweak or nothing; left out.

**Before and after.** 51 cases: 20 on the first six apps (a mix of tweaks and features: `t-covers-bigger, t-sleep-timer, t-space, t-play-green, p-word-count, p-copy-md, p-bigger-text, b-hide-ads, b-dark, b-progress, b-clutter, m-title-count, m-search, m-unread, n-word-count, n-dark, n-date, d-sort, d-filter, d-zebra`) and all 31 on the harder apps. Claude Code, ×1, the real `claude` CLI, Automatic. *Before* ran from a copy of the code before this change (commit 61afab7: haiku, then sonnet, two signals to start strong, no warm while typing); *after* is this change. Both ran at the same time, one case at a time each (2 at a time in all), on a machine with load 15 to 47 from other work, so the absolute times are high; the comparison is what counts. (The eval runner needed one fix first: `context()` now asks for the runtime's language, `getLanguage`, which the eval page didn't define, so every case errored.)

| | Before: haiku, then sonnet | **After: sonnet, then opus** |
|---|---|---|
| Passed, all 51 | 47/51 (92%) | **48/51 (94%)** |
| Total time from Enter, median / p90 | 4.4 s / 9.4 s | 5.9 s / 13.2 s |
| First six apps (20) | 20/20, 4.1 s / 7.7 s | 19/20, 8.6 s / 13.5 s |
| Harder apps (31) | 27/31, 4.4 s / 11.1 s | **29/31**, 4.8 s / 13.2 s |
| Started on the strong model | 8/51 (16%) | 24/51 (47%) |
| … those cases | 6/8, 9.4 s / 11.5 s (process started at Enter: 4.7 s median) | 21/24, 9.7 s / 14.2 s (started while typing: 2.4 s median left at Enter) |
| … the rest, on the first model | 41/43, 3.9 s / 7.7 s (haiku) | **27/27**, 3.3 s / 5.9 s (sonnet) |
| Moved to the strong model after a failed draft | 0 | 0 |

Failures. Before: v-jump (both), r-left (haiku's count missed a finished task), r-confirm (both), c-save-png (sonnet: no download). After: b-progress (opus's reading-progress bar stayed 0 px), v-jump, r-confirm. v-jump and r-confirm failed on every arm in earlier rounds too.

What this says:
- **Success** is the same or better (48 vs 47 of 51). Small tweaks on sonnet passed 27/27 and were as quick as haiku's (3.3 s against 3.9 s median, within this machine's noise). The cases where a model's taste shows (new UI and restyles) now get opus.
- **Speed.** The median grows by about 1.5 s, all of it from the requests that now start on opus (about half of this subset, which leans towards features: 31 of the 86 cases are new UI, behavior or restyles by their words alone). Starting opus while the person types hid about 2 s of its start; at Enter it still had 2.4 s to go (median), since the eval's words arrive only a second before Enter.
- **Usage.** Claude Code maps `sonnet` to claude-sonnet-5-5 and `opus` to claude-opus-5-5. At API prices sonnet costs 20 times haiku per token and opus 40 times. With these 51 cases that is roughly 7 times the old Automatic's share of a Claude plan (27 sonnet and 24 opus requests against 43 haiku and 8 sonnet), assuming similar lengths. **Always fast** (sonnet only) would use about two thirds of Automatic's.

Results: `results/2026-10-24T17-59-02-models-before-haiku-sonnet.json`, `results/2026-10-24T17-59-04-models-after-sonnet-opus.json`.

### Before: haiku, then sonnet

Until this change, `core/route.js` picked the model per request like this, within the backend the person chose. With Claude Code: haiku first; sonnet when the request looks hard (two or more of: new behavior, working with the data, several steps, a canvas, a page the notes say keeps changing, judged from the words and the page notes, no model call), or when haiku's draft fails a guard, the effect check, or still throws after its own repair round. Each move to sonnet adds one attempt. The runner compares models side by side, interleaved case by case so every arm sees the same machine load, each with its own warm processes:

```bash
node evals/run.js --model haiku,sonnet,auto --concurrency 2     # "auto" = Automatic; "fast"/"best" = the two tiers
```

Claude Code, ×1, 2 at a time, on a machine with load 30 to 60 (other agents were running), so the absolute times are high and noisy; the comparison between arms is what counts.

| | haiku only | sonnet only | **Automatic** |
|---|---|---|---|
| Train (65 cases) | 63/65 96.9% | 64/65 98.5% | **64/65 98.5%** |
| Held-out (21 cases) | 21/21 | 21/21 | **21/21** |
| All 86: total time, median / p90 | 4.1 s / 8.3 s | 5.4 s / 10.2 s | 4.7 s / 10.2 s |
| The 76 cases Automatic started on haiku | 4.0 s / 8.0 s | 5.2 s / 10.2 s | **4.1 s / 8.8 s** |
| The 10 it started on sonnet | 7.2 s / 12.0 s | 6.2 s / 10.9 s | 9.9 s / 19.0 s |
| Started on sonnet | | | 10/86 (12%) |
| Moved to sonnet after a failed draft | | | 2/86 (2%), both then passed |

Failures: haiku s-prices (used the shop's generated class names) and s-sort (no button); sonnet r-confirm; Automatic r-confirm (started on sonnet, failed like sonnet-only).

**The cases where the arms differ, ×2** (12 train cases: the ten Automatic sends to sonnet or moved to sonnet, plus s-prices and r-confirm): haiku 21/24, sonnet 22/24, Automatic 19/24. Every arm failed r-confirm twice (a hard case for both models). Automatic's other misses: s-prices twice (haiku's draft used generated class names: it works on the page as it is and breaks with the app's next release, so neither the guards nor the effect check saw a problem and nothing moved it to sonnet) and r-left once (on sonnet).

**Fix: generated class names count as a guard hit.** When the page notes say the class names are generated, a draft that selects by one (`.css-1nsad8`) now gets a repair message, and under Automatic goes to sonnet (`generatedNames` in `core/engine.js`, the same test for "looks generated" as the context). The shop's four train cases ×2 afterwards: haiku 8/8, sonnet 8/8, Automatic 8/8 (s-prices moved to sonnet both times and passed; it was 0/2). Held-out s-4cols ×2: 2/2 for every arm. The checkers are unchanged.

What this says:
- **Success.** Automatic matched sonnet-only on all 86 cases (85/86) and beat haiku-only (84/86). On the cases where the arms differ the gap is within noise, and the one systematic loss (generated class names) is fixed above.
- **Speed.** Where Automatic stays on haiku (88% of requests) it is as fast as haiku (median 4.1 s vs 4.0 s). The cost is on the 12% it sends to sonnet: 9.9 s against sonnet-only's 6.2 s, because sonnet is not started ahead of time (on this loaded machine starting `claude` took several seconds). Most of the warm-process speedup is kept: haiku is warmed when the bar opens and again after every request, also after one that went to sonnet (`warmSettings`, `daemon/harness.js`).
- **Pre-warming sonnet too** would save those few seconds on about one request in eight, for a second waiting process (about 185 MB) every time the bar opens. Left off; the fast model is the one most requests need.
- **Usage.** Claude Code maps `haiku` to claude-haiku-5-5 and `sonnet` to claude-sonnet-5-5. At Anthropic's API prices sonnet costs about 20 times as much per token (a one-line `claude -p` ping: $0.0006 vs $0.0095 as Claude Code reports it), and a Claude plan's usage limits are used up in proportion. Automatic sent about 14% of requests to sonnet (12% from the start, 2% after haiku), so it uses roughly 3 to 4 times haiku-only's share of the plan, about a fifth of sonnet-only's.

Results: `results/2026-10-24T16-02-10-routing-train.json`, `results/2026-10-24T16-20-13-routing-heldout.json`, `results/2026-10-24T16-25-26-routing-differ-x2.json` (each record has `arm`, `model` (who answered), `startedStrong`, `escalated`, `routeWhy`).

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
| 2026-10-24 11:58 | speed: baseline subset | claude-code:haiku | only | 36/36 (100%) | 9.4s |
| 2026-10-24 12:14 | speed: after, warm subset (bar opened 2.5 s before Enter) | claude-code:haiku | only | 36/36 (100%) | 2.7s |
| 2026-10-24 12:19 | speed: after, cold (no head start) subset | claude-code:haiku | only | 36/36 (100%) | 5.8s |
| 2026-10-24 12:29 | speed: final, all cases x2 (machine load ~80, latency not comparable) | claude-code:haiku | all | 110/110 (100%) | 18.2s |
| 2026-10-24 16:02 | routing: haiku vs sonnet vs automatic, train | claude-code:haiku | train | 63/65 (97%) | 4.2s (p90 8.7s) |
| 2026-10-24 16:02 | routing: haiku vs sonnet vs automatic, train | claude-code:sonnet | train | 64/65 (99%) | 5.4s (p90 10.7s) |
| 2026-10-24 16:02 | routing: haiku vs sonnet vs automatic, train | claude-code:auto | train | 64/65 (99%) | 4.9s (p90 10.3s) |
| 2026-10-24 16:20 | routing: haiku vs sonnet vs automatic, held-out | claude-code:haiku | test | 21/21 (100%) | 3.7s (p90 8.1s) |
| 2026-10-24 16:20 | routing: haiku vs sonnet vs automatic, held-out | claude-code:sonnet | test | 21/21 (100%) | 5.0s (p90 7.1s) |
| 2026-10-24 16:20 | routing: haiku vs sonnet vs automatic, held-out | claude-code:auto | test | 21/21 (100%) | 3.3s (p90 6.4s) |
| 2026-10-24 16:25 | routing: the cases where the arms differ, x2 | claude-code:haiku | only | 21/24 (88%) | 4.9s (p90 10.9s) |
| 2026-10-24 16:25 | routing: the cases where the arms differ, x2 | claude-code:sonnet | only | 22/24 (92%) | 3.9s (p90 10.7s) |
| 2026-10-24 16:25 | routing: the cases where the arms differ, x2 | claude-code:auto | only | 19/24 (79%) | 6.8s (p90 11.5s) |
| 2026-10-24 16:33 | routing: generated class names count as a guard hit, shop x2 | claude-code:haiku | only | 8/8 (100%) | 7.0s (p90 10.4s) |
| 2026-10-24 16:33 | routing: generated class names count as a guard hit, shop x2 | claude-code:sonnet | only | 8/8 (100%) | 3.1s (p90 6.3s) |
| 2026-10-24 16:33 | routing: generated class names count as a guard hit, shop x2 | claude-code:auto | only | 8/8 (100%) | 5.4s (p90 6.7s) |
| 2026-10-24 16:35 | routing: held-out shop case after the generated-names check | claude-code:haiku | only | 2/2 (100%) | 3.9s (p90 3.9s) |
| 2026-10-24 16:35 | routing: held-out shop case after the generated-names check | claude-code:sonnet | only | 2/2 (100%) | 2.5s (p90 2.5s) |
| 2026-10-24 16:35 | routing: held-out shop case after the generated-names check | claude-code:auto | only | 2/2 (100%) | 2.7s (p90 2.7s) |
| 2026-10-24 17:59 | models: before, Automatic haiku then sonnet (copy of 61afab7) | claude-code:auto | only | 47/51 (92%) | 4.4s (p90 9.4s) |
| 2026-10-24 17:59 | models: after, Automatic sonnet then opus | claude-code:auto | only | 48/51 (94%) | 5.9s (p90 13.2s) |
<!-- run-log -->
