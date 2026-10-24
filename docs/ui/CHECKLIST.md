# Morse UI review checklist

Every screenshot in `docs/ui/` is reviewed against this list. `npm run ui`
rebuilds the runtime, shoots every state (dark + light host, 1100px + 390px,
four hostile host pages), runs the automated checks marked **[auto]** on each
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

- [auto] `runtime/src/99-css.js` has no color literals: every color is a `var(--m-*)` (the `#000` in the ticker's mask-image is an alpha mask, not a color).
- Fonts: `--m-font` for UI, `--m-mono` for code, labels, kbd, model names. Sizes from `--m-text-*` (10.5/11.5px only for kbd, tags, ticker).
- Radii: `--m-r-sm` 6 (controls, chip, picker box and label), `--m-r-md` 10 (rows, toast, code fields, effect canvas), `--m-r-lg` 14 (bar, panel, modal). 4px only for kbd, tags and the chip's × hit box; the switch is a pill.
- Borders are 1px `--m-line` / `--m-line-strong` (the picker outline is 1.5px on purpose: it sits on arbitrary app content).

## 3. Geometry (4px grid)

- [auto] Buttons are 28px (`.actions`, modal footers, exports, copy link, panel footer); the bar's input and Run button are 32px; inline controls (chip, panel row buttons, × in the chip) are 24/20px.
- Bar: row 48 (8 + 32 + 8), status ≥ 40, 16px left inset shared by both rows. Panel/modal paddings 12/16/20. Toast 40 tall for one line.
- Icons: radar marks at 12 (inline), 16 (panel), 18 (bar), 22 (empty state); the Run arrow is a 14px SVG at 1.8 stroke; close is the × glyph at 14/18px, centered in a square hit box.

## 4. Text never breaks the layout

- [auto] Nothing that holds text clips it without an ellipsis (`overflow: hidden` without `text-overflow: ellipsis`).
- [auto] Nothing sticks out of its bar, panel, modal or toast, or out of the viewport (measured on the painted rect, after ancestors' overflow clipping). Inside the mods list only horizontal overflow counts (the list scrolls).
- Single-line places (hint, chip, model label, picker label, panel host) end in an ellipsis; the result title shrinks before its timing does; actions never shrink.
- Multi-line places (mod titles and prompts, toast, modal titles) wrap, including unbroken strings (`overflow-wrap: anywhere`). Code does not wrap; it scrolls.
- At 390px the status line wraps: hint on the first row, ticker and actions on the second.

## 5. States

- Every button has a hover state that is visible but subtle (one step: `--m-hover` background, `--m-signal-1` border; primary goes to `--m-primary-hover`).
- [auto] Every focusable control shows a focus ring when focused from the keyboard (`:focus-visible` is checked on each `*-focus` shot): 2px `--m-signal-3`, 2px offset. The text input has no ring by design (the caret and the bar are the focus).
- The radar mark is static (the logo) everywhere except while a model is working (bar mark + phase hint).
- Picker: hover = solid outline + soft ring + label; selected = dashed outline. The label stays on screen at every edge (inside the box at the top edge, shifted in at the sides).

## 6. Motion

- [auto] With `prefers-reduced-motion: reduce` the effect canvas is static (two frames 450ms apart are pixel-identical) and the working mark does not pulse.
- Reduced motion: no slide/rise/fade, no success ping, the field fades out instead of being swept away.
- Default motion: 120ms (hover), 220ms (enter), ease `--m-ease`; nothing loops except "a model is working".

## 7. Isolation from the host page

- [auto] On every host (catalog page, Parley with a strict CSP, The Daily Byte, Tunes, and `demo/sites/hostile/`): the overlay host is visible, `position: fixed`, untransformed; `.bar/.panel/.card/.toast/label` have `direction: ltr`, no text-transform, normal style, our font; the bar is exactly `min(680px, 100vw - 32px)` wide (no zoom leak); the hover box sits within 2px of its target.
- The hostile page applies `* { all: unset }`, `!important` rules on `div, span, button, input…`, `[data-morse-ui] { display: none !important; transform: scale(2) !important }`, `html { zoom: 1.25; font-size: 40px }`, `dir="rtl"`, a rotated body, `[hidden] { display: block !important }`, and (the "-noise" run) `--m-*` custom properties on every `div` and on the overlay host. The overlay must look identical to the plain catalog page.

## 8. Themes

- The runtime follows the host page: a dark page gets the dark tokens, a light page the light ones. Every state is shot on both.
- Light theme status colors (`--m-warn`) are darker than the dark theme's so they pass on white.
