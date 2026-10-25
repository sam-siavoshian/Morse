# Accessibility of Morse itself

Morse's own interface (the bar, the Mods panel, the modals, the Edit tools,
Ask and Show me, Show me once, toasts, the gallery, self-heal, guard and
style rows) and the Morse app's window work with the keyboard alone and with a screen reader. "Easier to use"
([`core/a11y.js`](../../core/a11y.js), [docs/easier-to-use.md](../easier-to-use.md))
is the other direction: Morse making *other* apps easier to use.

The user-facing summary is in
[Getting started](../getting-started.md#using-morse-with-the-keyboard-or-a-screen-reader).

## How it's checked

| What | Where | When |
|---|---|---|
| axe-core on a few key states (bar, choosing with keys, Edit tools with Color and Text size, ⋯ menu, Page tools, Settings, shortcuts, working, result, Edit code, Share, a toast, the Mods panel with 13 mods, Install a mod, the install review, Show me once) | [`tests/a11y-morse.test.js`](../../tests/a11y-morse.test.js) | `npm test` |
| axe-core on the gallery, self-heal, guard, Your style, Ask and Show me, Show me once and install-review states, inside their own tests | `tests/{gallery,heal,guard,style,show-once,control}-ui.test.js`, `tests/ask.test.js` | `npm test` |
| The core flows with the keyboard only | `tests/a11y-morse.test.js` | `npm test` |
| What screen readers hear during a generation | `tests/a11y-morse.test.js` | `npm test` |
| Forced colors, 320px, 200% zoom | `tests/a11y-morse.test.js` | `npm test` |
| axe-core on every state of the UI catalog | [`demo/ui-catalog.js`](../../demo/ui-catalog.js) | `npm run ui` |

axe-core is **4.13.0** from npm, vendored unchanged at
[`demo/vendor/axe-4.13.0.min.js`](../../demo/vendor/) (MPL-2.0, its license
next to it) and loaded by [`demo/axe.js`](../../demo/axe.js). It is only for
tests: `npm run check` fails if it ever ends up in `dist/runtime`, and the
npm package doesn't include `demo/`. `axeCheck(page)` audits the overlay
inside its shadow root (open only under automation with `morse:debug`, as in
every UI test); `axeCheck(page, { page: true })` audits a whole page.

Rules: WCAG 2.2 A and AA plus axe's best practices. On the overlay these are
off, because they're about the page underneath, not Morse: `region`,
`landmark-one-main`, `page-has-heading-one`, `bypass`,
`landmark-complementary-is-top-level`, `landmark-unique` and `heading-order`
(the overlay follows whatever heading level the page ends on).

`npm run ui` runs axe after each screenshot, except on the animation states
(effect, pulse, motion, radar), which are timed to the frame. Findings show
in `docs/ui/index.html` with the other verdicts, and the run ends with a
count per rule. `node demo/ui-catalog.js --out=/tmp/ui --theme=dark --width=1100`
audits without touching `docs/ui`; `--no-axe` skips it.

## What was found and fixed (October 2026)

axe-core on the key states before this work (the runtime as it was, driven
the same way) and on the catalog:

| Rule | Where | Fix |
|---|---|---|
| `aria-allowed-attr` (critical) | the captured chips in the bar: `role=option` with `aria-pressed` | a group of toggle buttons |
| `aria-required-children` (critical) | Page tools: a `<header>` counted as a banner inside `role=menu`. The empty Mods list: `role=list` with no items | card headers and footers are `role="none"`. The list is a `role=group` named Mods |
| `label` (critical) | Edit code's two code fields, the Share link field | `<label for>`, `aria-label` |
| `aria-allowed-role` (minor) | the Mods panel was an `<aside role=dialog>`, each mod an `<article role=listitem>` | a `<section role=dialog>`. Rows are plain articles with their name |
| `landmark-no-duplicate-banner`, `landmark-no-duplicate-contentinfo` (moderate) | every card's `<header>`/`<footer>` counted as the page's banner and footer | `role="none"` on them (12-focus.js does it for every card) |
| `color-contrast` (serious), `landmark-one-main`, `region` | practice page | the byline is #707070 (4.9:1), the ad label .85 opacity, a `<main>`, the cookie bar is a named region |
| `scrollable-region-focusable` (serious) | the full catalog: Show code and the install review's code blocks, and Page tools at phone width (it scrolls, and its items are out of the Tab order) | the code blocks are named, focusable regions. A menu's current item is its one Tab stop |

The welcome page had none. The full catalog (519 states in the dark theme,
phone width included) found only `scrollable-region-focusable`. After that
fix, the light theme's 519 states had no violations at all, nor did the
Trusted Types and round 4's hostile hosts (`--only=trusted-types,hostile-r4`).


Semantics added without an axe rule asking for them:

- **Page tools** on/off items were `menuitem` with `aria-checked`. They are
  `menuitemcheckbox`. Color's Text/Fill/Border were `role=tab` with
  `aria-pressed` and no tab panels. They and the weights are radio groups.

- **Modals** (Edit code, Share, Install a mod, the review, Show code, Update):
  `role=dialog`, `aria-modal`, `aria-labelledby` its title,
  `aria-describedby` its line under the title. Focus goes to the first field
  (or Cancel in a review), Tab stays inside, and Esc, Close, Cancel, a click
  outside or Install put focus back where it was (or the bar input, or the
  panel). The bar's own `aria-modal` steps aside while a modal is open.
- **The bar** stays a modal dialog: the page is for pointing at while it's
  open, so Tab cycles inside it. The Edit tools and their popover float
  outside its box, so the bar `aria-owns` them and Tab reaches them.
- **Menus** (⋯ and Page tools): `aria-haspopup`, `aria-expanded`,
  `aria-controls`. Items are out of the Tab order; ↑/↓ wrap, Home/End, and
  type-ahead (`menuKeys`, 12-focus.js); Tab or Esc closes and returns to the
  button.
- **Icon buttons** all have names. Tooltips are `aria-hidden` (the name is
  on the button) and the tools list their keys in `aria-keyshortcuts`.
  Swatches say a color name, not a hex code. The radar, the effect canvas,
  the picker frame and the edit frame are `aria-hidden`.

## Keyboard

- **Choose with keys** ([`runtime/src/41-keypick.js`](../../runtime/src/41-keypick.js)):
  Alt+↓ (⌥↓) in the bar, or the ⋯ menu. It walks landmarks, headings,
  focusable parts and pictures in page order (open shadow roots included),
  with the picker's frame and label; ← picks the bigger part around it, →
  goes back; Enter chooses. Focus never leaves the bar, so it doesn't fight
  the page's focus handling. Only trusted key events count, like every key
  Morse takes.
- **Edit tools**: Tab walks the tools (UI review round 3) and, past the last
  one, goes on to the rest of the bar instead of wrapping. On a tool,
  ←/→/Home/End move between tools too (the toolbar pattern). On the toolbar
  itself (Ctrl+E), or with Move on, arrows still move the selection. Color
  and Text size take focus when they open. The palette moves with arrows
  over its 8 columns.
- **Mods panel**: one Tab stop for the list (the current row and its own
  buttons), so Install a mod… is a few Tabs away however many mods there
  are.
- **Show me**: Alt+↓ goes to the step's part of the page (focus only, Morse
  never clicks). Each step is announced.
- **Esc** closes the top layer first everywhere: a menu, a popover or tool,
  choosing with keys, a sheet, a modal, the panel, then the bar. Read aloud,
  Describe this picture and Show me leave Esc to an open panel or modal.
- **Focus** comes back on close. When nothing on the page had focus before,
  the page's next Tab starts from its top instead of past Morse's hidden UI
  at the end of the document (`focusPageTop`).
- **The focus ring** is 2px everywhere (`:focus-visible`, 99-css.js). A
  mod's row and the boxes that take focus themselves (the Edit toolbar, the
  Mods search) ring too. The bar's input has no ring by design: the bar
  around it is the focus.

## Screen readers

`announce(text)` (12-focus.js) writes to one polite live region: inside the
open modal, else inside the bar, else on the overlay itself, so it is heard
under `aria-modal` and after the bar closes. A generation says at most:
"Working on your change", "The first change is showing on the page"
(the first CSS that lands), "Fixing a mistake and trying again" (if it does),
then "Done: <title>, <time>. Press Enter to save it…" or "That didn't work:
<why>". The streaming ticker is never in a live region, and the status
line is echoed only while idle (notes, voice, Stopped).
`tests/a11y-morse.test.js` records every message during a 60-token
generation and expects 2 to 5, none of them code. Toasts and the toasts with
buttons (`controlToast`) are announced too. One with buttons stays while it
has focus or the pointer.

## Zoom, forced colors, motion

- **200% zoom and 320px**: the bar, the panel and the modals fit, with no
  sideways scrolling (checked at 640×400 and 320×640).
- **Forced colors** (`@media (forced-colors: active)`, 99-css.js): every
  focus ring is a 2px `Highlight` outline (shadows are dropped there),
  surfaces and icon buttons keep a border, what's on or chosen shows as a
  ring, and swatches keep their real colors (`forced-color-adjust: none`).
- **Reduced motion**: Effects default to Subtle (a still outline), as
  before. Nothing slides or pulses.

## What's left

- In `npm run ui`, the gallery and self-heal areas stop partway ("flow
  failed": a Try it strip button and the stopped-working dot never show in
  the catalog's fake host). That happens on main without these changes too;
  the states before it are audited, and the gallery and heal tests run axe
  on the real flows.

- The edit frame's resize handles are pointer-only. Resizing by keyboard
  isn't there yet (Move nudges with arrows; Text size and Color have
  fields).
- A `controlToast`'s buttons (Turn back on, Undo a fix) are reached by Tab
  from the page. There is no shortcut to jump to them. The same actions are
  in the Mods panel.
- Show me needs the user to use the marked part themselves; Alt+↓ takes
  focus there, but a part that isn't focusable can only be found, not
  focused.
- Screen-reader output was checked through the live regions and the
  accessibility tree, not with VoiceOver, NVDA or JAWS by hand.
