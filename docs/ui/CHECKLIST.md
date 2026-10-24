# Morse UI review checklist

Every screenshot in `docs/ui/` is reviewed against this list. `npm run ui`
rebuilds the runtime, shoots every state (dark + light host, 1100px + 390px,
four hostile host pages) of the bar, picker, effect, panel, modals, toast,
God mode (edit toolbar, popovers, frame, page tools, capture, clipboard),
voice, settings, hotkey recorder, cheat sheet, suggestions, history and Stop,
and (round 3) Mods for this site, Easier to use (with each page tool on the
demo/sites/a11y library), user control (install review, off switch, pause,
safe start, Show code, backup, the popup's pause switches), refine, version
history and a broken mod with Fix it, and (round 4) Show me once, Your style, the guards, first run in the bar, the
extension's own pages (welcome, practice, popup: the real extension, headful under Xvfb, `--only=extension`) and the bar,
panel, toolbar and settings on a page that enforces Trusted Types (pixel-compared with the normal page), and (round 5) mods
waiting for “Allow User Scripts” (notice, bar note, panel tag, result, popup), mod packs (Make a pack, the install
review with ticks and clashes, the grouped panel, the update review), every status stage of a model run, and a
guard row under Your style's softer colors pixel-compared with the same row without it, and (round 6) Morse Desktop (the real
Electron app under Xvfb, `--only=desktop`: first run, Apps with the apps' own icons, Model with the real marks, Chrome, the
Allow question, Mods, Checks, empty, loading and error states, the window at 760 × 560), the welcome page of onboarding v2
and the “Allow User Scripts” window (`--only=welcome`: every step at 1280 and 390 in English, German and Persian), the
website and Try it here (`--only=site`: 1440, 768 and 390) and the newer bar states (`--only=new-bar`: Esc's “Kept”
toast with Undo, the developer's “rebuilt” note, Your style's “Every site in Chrome” / “Every site and app”, Alt+↑ for a
bigger part, Redo), runs the automated checks marked **[auto]** on each
shot, and writes `docs/ui/index.html`. The rest are checked by eye; verdicts
and notes live in `docs/ui/review.json`.

An item is ✅ when nothing below fails, ⚠️ when an automated check fails or a
known issue is written down with its reason, ❌ when it fails review.

## 1. Contrast (WCAG 2.2 AA)

- [auto] Body text ≥ 4.5:1, large text (≥ 24px, or ≥ 18.66px bold) ≥ 3:1, measured on the rendered element: its color and opacity composited over its real background stack (translucent bar over the host page). (`audit()` in demo/ui-catalog.js)
- [auto] Every text/background **token pair** the overlay uses passes in both themes, worst case over the host page: for the translucent bar that is a page at the theme-switch threshold (#7f7f7f / #808080). (`node demo/contrast.js`)
- [auto] Non-text UI that carries meaning (focus ring, switch track/knob, picker outline) ≥ 3:1.
- Disabled-looking rows (an "off" mod) still meet AA: muted by color tokens, never by opacity.

## 2. Tokens only

- [auto] `runtime/src/99-css.js`, `98-bar-css.js` and `98-godmode-css.js` have no color literals: every color is a `var(--m-*)` (the `#000` in the ticker's mask-image and the close icon's mask are alpha masks, not colors).
- Fonts: `--m-font` for UI, `--m-mono` for code, labels, kbd, model names. Sizes from `--m-text-*` (10.5/11.5px only for kbd, tags, ticker).
- [auto] Radii: `--m-r-sm` 6 (controls, chip, picker box and label, fields, menu rows), `--m-r-md` 10 (rows, toast, code fields, effect canvas, popovers, menus, the edit toolbar), `--m-r-lg` 14 (bar, panel, modal). 4px only for kbd, tags and controls nested inside a 6px control (segments, the ± and eyedropper buttons, the chip's ×); 2px for the edit frame and its handles (a hairline hugging arbitrary content); round for the switch, swatches, numbered steps (Show me once, the first-run coach) and the recording dot. The 6px status dot (a paused or stopped mod, trying a mod, a notice under the input) is one of the radar mark's squares: 1.5px corners, declared once in 99-css.js.
- [auto] Borders are 1px `--m-line` / `--m-line-strong` (the picker outline is 1.5px on purpose: it sits on arbitrary app content). Rings that mean "selected" or "focused" are box-shadows on top of the 1px border, never thicker borders.

## 3. Geometry (4px grid)

- [auto] Every control is 20, 24, 28 or 32px tall. 32: the bar's input row (input, page tools, mic, Run/Stop), edit-toolbar tools, popover fields, menu rows, clipboard chips. 28: text buttons (`.btn`: actions, modal footers, exports, suggestion chips), segmented controls, the hotkey field, header icon buttons (close, ⋯). 24: ghost text buttons (`.tbtn`), segments, inline icon buttons inside fields. 20: swatches, key caps in sheets, the chip's ×.
- Bar: row 48 (8 + 32 + 8), status ≥ 40, 16px left inset shared by both rows. Panel/modal paddings 12/16/20. Toast 40 tall for one line.
- [auto] Icons: one set on a 16px grid, drawn at 16×16 with 1.5px round strokes (Run arrow, Stop, mic, ⋯, every God mode and page-tools icon). Close is the same × drawn as a 16px mask (14px in the 20px chip ×), so the glyph in any markup renders identically. Radar marks keep their sizes: 12 (inline), 16 (panel), 18 (bar), 22 (empty state).

## 4. Text never breaks the layout

- [auto] Nothing that holds text clips it without an ellipsis (`overflow: hidden` without `text-overflow: ellipsis`).
- [auto] Nothing sticks out of its bar, panel, modal or toast, or out of the viewport (measured on the painted rect, after ancestors' overflow clipping). Inside the mods list only horizontal overflow counts (the list scrolls).
- Single-line places (hint, chip, model label, picker label, panel host) end in an ellipsis; the result title shrinks before its timing does; actions never shrink.
- Multi-line places (mod titles and prompts, toast, modal titles) wrap, including unbroken strings (`overflow-wrap: anywhere`). Code does not wrap; it scrolls.
- At 390px the status line wraps: hint and ⋯ on the first row, ticker and actions on the second; actions that don't fit wrap inside the bar, right-aligned.
- At 390px what you pointed at (the chip) gets a line of its own above the input, so the input keeps the row less its three buttons (~60% of the bar) and never breaks words.
- A result's note that is a sentence (“Needs “Allow User Scripts” to work…”) gives way before the title and ends in an ellipsis; the hint's title holds the whole sentence. With one more thing to do (Turn on “Allow User Scripts”) the hint gets a row of its own.

## 5. States

- Refusals are said as Morse holding back, not as a failure: “Morse didn't apply it: it would have hidden this whole page” (the full sentence is the hint's title).
- Every button has a hover state that is visible but subtle (one step: `--m-hover` background, `--m-signal-1` border; primary goes to `--m-primary-hover`). Pressed tools (`aria-pressed`) are primary; a button whose menu is open (`aria-expanded`) keeps the hover look.
- [auto] Every focusable control shows a focus ring when focused from the keyboard (`:focus-visible`, and a real 2px indicator, are checked on each `*-focus` shot): 2px `--m-signal-3`, 2px offset for standalone controls, flush (offset 0) in tight groups (edit toolbar, segments, swatches), inset (−2px) on menu rows, which also take the hover background. Fields light their border into a 2px `--m-signal-3` ring. The bar's text input has no ring by design (the caret and the bar are the focus).
- Disabled controls use `--m-signal-1`, never opacity, show no tooltip and take no focus.
- One tooltip at a time: hovering a sibling hides the focused one's; an open menu hides its button's. Tooltips show after 300ms, name + key cap.
- Invalid input (hex color) turns the field's border and text `--m-danger`; a rejected hotkey shakes and turns red; a warning is `--m-warn` text under the row.
- The radar mark is static (the logo) everywhere except while a model is working (bar mark + phase hint).
- [auto] Popovers and notes never cover what they edit: the toolbar's far side first, then the element's other side, then beside it (only a selection that fills the screen is covered).
- [auto] Tab and Shift+Tab walk the edit toolbar's tools (arrows nudge the selection).
- [auto] While pointing, the bar steps aside only when the pointer rests on it away from its controls (350ms); a pointer heading for a suggestion, the page tools or any button never makes it jump.
- Toasts never cover the open bar: with the bar at the bottom they show at the top.
- Picker: hover = solid outline + soft ring + label; selected = dashed outline. The label stays on screen at every edge (inside the box at the top edge, shifted in at the sides).

## 6. Motion

- [auto] With `prefers-reduced-motion: reduce` the working indicator is static (two frames 450ms apart are pixel-identical; Effects default to Subtle there, which draws no canvas: the still `.sel.busy` outline on the target) and the working mark does not pulse.
- Nothing else loops: "Trying a mod" and similar states are a still dot.
- Reduced motion: no slide/rise/fade, no success ping, the field fades out instead of being swept away.
- Default motion: 120ms (hover), 220ms (enter), ease `--m-ease`; nothing loops except "a model is working".

## 6b. One product

- Shared parts live once in `runtime/src/99-css.js`: focus ring, `.ibtn` (icon buttons), `.btn` / `.tbtn` (text buttons), `.pop` surfaces, `.menu`, `.seg`, `.field`, `kbd` / `.caps`, `.tip`, eyebrow labels, tags, the close icon. `98-bar-css.js` and `98-godmode-css.js` only place and size them.
- Section labels everywhere (sheets, menus, popovers, modals, Try, Clipboard) are the same eyebrow: 11px mono, uppercase, .06em, `--m-text-3`.
- The picker label and the edit frame's size/offset readout are the same inverse mono label.
- Both menus (⋯ and Page tools) have 32px rows, the same hover and focus, and right-aligned detail (key caps, state, check).
- New bar rows (suggestions, clipboard, Show me once's steps, the first-run coach and notice) share the 16px left inset of the input and status rows.
- Numbered steps look the same wherever they are: a 20px round mono number, the current one filled `--m-primary` (Show me once's strip and steps, the first-run coach); a done step shows the 16px check.
- Removable chips (the bar's target, Your style's sites) are one `.chip` with the shared `.x` (14px mask ×); the × ring is flush (offset 0) inside the chip.
- A list that scrolls shows a part of its next row (Show me once's steps in the bar: five and a half rows), so it reads as one that scrolls.
- New features use the shared parts by class, never copies: `.btn` / `.btn.primary` (toasts with actions, the trial strip, Describe, Fix it), `.tbtn` (Check again, Show/Hide, Stop showing these; works inside the panel too), `.ibtn` (Read aloud, the toolbar's Read aloud and Describe), `.ibtn.close` (every × outside the panel and modal headers: the same 16px mask glyph), `.menu` (the Easier to use group is a second `.menu`), `.eyebrow` (section labels).
- Notes in a row (install review) read as one box with one "Note" label; the warn edge is a 2px inset shadow inside the 1px border.
- A sheet open in the bar is solid (`--m-surface`), pauses the picker's hover box and hides the edit toolbar, so nothing draws through or over it.
- The see-through surfaces (bar, Show me once's strip, the guide, Describe) are glass only over a calm page: when the page's own text sits under one it turns solid `--m-surface` (50-bar.js `Backing`), so its words never read over the page's.
- A control toast's title (Safe start, Turn on “Allow User Scripts”) is a line of its own above its sentence.
- Unticked mods in a pack review are muted by color (`--m-text-2`), never opacity; a disabled primary (Next, Install) is `--m-line-strong` with `--m-text-2`.

## 6c. Your style

- [auto] Your style's softer colors filter the page, never Morse: the overlay lives in the top layer, which the page's filter doesn't reach, so it takes no counter-filter there. A guard row (with the `--m-danger` dot) is shot with and without the style and must be pixel-identical.

## 7. Isolation from the host page

- [auto] On every host (catalog page, Parley with a strict CSP, The Daily Byte, Tunes, and `demo/sites/hostile/`): the overlay host is visible, `position: fixed`, untransformed; `.bar/.panel/.card/.toast/label` have `direction: ltr`, no text-transform, normal style, our font; the bar is exactly `min(680px, 100vw - 32px)` wide (no zoom leak); the hover box sits within 2px of its target.
- On every hostile host the edit toolbar, color popover, in-place text editing, settings sheet and page-tools menu are shot too. Text being edited in place lives in the page (a span marked `data-morse-ui`), so it carries `!important` inline display/visibility: `[data-morse-ui] { display: none !important }` must not hide it.
- The hostile page applies `* { all: unset }`, `!important` rules on `div, span, button, input…`, `[data-morse-ui] { display: none !important; transform: scale(2) !important }`, `html { zoom: 1.25; font-size: 40px }`, `dir="rtl"`, a rotated body, `[hidden] { display: block !important }`, and (the "-noise" run) `--m-*` custom properties on every `div` and on the overlay host. The overlay must look identical to the plain catalog page.

## 7b. Trusted Types

- [auto] On a page that sends `require-trusted-types-for 'script'` (VS Code's window), the runtime builds its UI without HTML strings (00-trusted-html.js). The bar, edit toolbar, Mods panel and settings are shot on that page and on the normal one and must be pixel-identical.

## 7c. Extension pages

- The welcome page, the practice page and the popup use design/tokens.css only (no fallback colors), the same control heights (28 buttons, 24 inline), 1px lines, 4px key caps and the radar-square status dot. Disabled is `--m-signal-1`, never opacity.
- [auto] Nothing sticks out of the page or scrolls it sideways at 1100px and 390px; text that is cut ends in an ellipsis.

## 7c2. Morse Desktop and whole pages (round 6)

- An app's icon is its own (desktop-app/icons.js); an app with none gets the sidebar's Apps glyph, never a letter. Model marks are the real Claude, OpenAI and Anthropic marks (desktop-app/ui/icons/NOTICE); no other drawn art.
- A list's empty or loading row is a line inside the list, never a second bordered box.
- At the window's smallest (760 × 560) nothing that names something is cut: buttons wrap under the name.
- [auto] Whole pages (`pageShot`): nothing sticks out or scrolls sideways, cut text ends in an ellipsis (visually hidden text excepted), axe-core on the page; focus states check a 2px ring.
- Disabled buttons and done steps on extension pages are muted by tokens, never opacity. Grid columns that hold words are `minmax(0, 1fr)`, so a long German word never widens the page.

## 7d. Languages

- The bar (empty, typing, a status stage, result, error), ⋯ menu, Settings (top and bottom) and the Mods panel are shot in German (long words) and Persian (right to left), `--only=i18n`.
- [auto] The overlay is right to left only in Persian and Arabic; every surface follows the host's `dir`.
- Long words wrap or end in an ellipsis; a textarea's placeholder can't end in one, so it must fit (German “Was soll sich ändern…”). A button that wraps stays at the end of its row.
- Persian and Arabic letters join: labels set in the mono face (eyebrows, Try, pills, tags, “hold”) take the UI face there, since the mono face has none of those letters. Key caps, code and the model's name stay mono and left to right.

## 8. Themes

- The runtime follows the host page: a dark page gets the dark tokens, a light page the light ones. Every state is shot on both.
- Light theme status colors (`--m-warn`, `--m-danger`) are darker than the dark theme's so they pass on white.
