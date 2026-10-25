// Styles for everything inside the shadow root. Every value comes from
// design/tokens.css (injected as TOKENS_CSS), so the overlay reskins with it.
// Geometry: 4px grid; controls are 20 (swatches, chip ×), 24 (inline), 28
// (buttons, fields in sheets), 32 (the bar's input row, the edit toolbar,
// fields in popovers); radii are the tokens' 6/10/14 (4 for kbd, tags and
// controls nested inside a 6px control; round for the switch and swatches).
// docs/ui/CHECKLIST.md lists the rules; `npm run ui` checks them.
//
// This file owns the shared parts every surface uses (98-bar-css.js and
// 98-godmode-css.js only add what is specific to them):
//   focus ring · .ibtn icon buttons · .btn / .tbtn text buttons · .pop
//   surfaces · .menu · .seg · .field · kbd / .caps · .tip tooltips ·
//   eyebrow labels · tags · the close icon · 16px icons with 1.5px strokes
// (a function, not a const: 10-dom.js calls CSS() before this file's top level runs)
function CSS() {
  const ICON_CLOSE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M4 4l8 8M12 4l-8 8'/%3E%3C/svg%3E\")";
  return `
  :host { all: initial; direction: ltr; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; cursor: pointer; color: inherit; margin: 0; }

  /* ---- focus: one ring everywhere, 2px --m-signal-3. Outside the control
     (offset 2) when it stands alone, flush (offset 0) in tight groups, inside
     (offset -2) on menu rows, which also take the hover background. */
  :focus-visible { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }
  :is(.gm-tb, .seg, .gm-sw) button:focus-visible { outline-offset: 0; }
  :is(.menu, .a11y-group) > button:focus-visible { outline-offset: -2px; background: var(--m-hover); }
  /* boxes that take focus themselves (the edit toolbar after Ctrl+E, the Mods search) ring like fields: border + 1px = 2px */
  .gm-tb:focus-visible { border-color: var(--m-signal-3); box-shadow: 0 0 0 1px var(--m-signal-3), var(--m-shadow); }
  .psearch .search:focus-visible { border-color: var(--m-signal-3); box-shadow: 0 0 0 1px var(--m-signal-3); }

  /* ---- icons: one set, drawn on a 16px grid with 1.5px round strokes */
  button > svg:not(.radar), .menu svg, .gm-note > svg { flex: none; width: 16px; height: 16px; }
  button > svg[stroke], .menu svg[stroke], .gm-note > svg[stroke] { stroke-width: 1.5px; }
  /* the close icon (×) as a mask, so the glyph in any markup draws the same */
  .chip .x, .panel header > button, .card header > button, .ibtn.close { font-size: 0 !important; display: flex !important; align-items: center; justify-content: center; }
  .chip .x::before, .panel header > button::before, .card header > button::before, .ibtn.close::before { content: ""; width: 16px; height: 16px; background: currentColor;
    -webkit-mask-image: ${ICON_CLOSE}; mask-image: ${ICON_CLOSE}; -webkit-mask-size: 16px; mask-size: 16px; }
  .chip .x::before { width: 14px; height: 14px; -webkit-mask-size: 14px; mask-size: 14px; }

  /* ---- icon buttons: ghost squares. 32 in the bar row and the toolbar, 28 in headers, 24 inside fields */
  .ibtn { flex: none; position: relative; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: var(--m-r-sm);
    background: transparent; color: var(--m-text-2); transition: background var(--m-fast), color var(--m-fast); }
  .ibtn.sm { width: 28px; height: 28px; }
  .ibtn.xs { width: 24px; height: 24px; border-radius: 4px; }
  .ibtn:hover:not(:disabled), .ibtn[aria-expanded="true"] { background: var(--m-hover); color: var(--m-text); }
  .ibtn[aria-pressed="true"] { background: var(--m-primary); color: var(--m-primary-text); }
  .ibtn:disabled { color: var(--m-signal-1); cursor: default; }

  /* ---- text buttons: outlined 28 (.btn), ghost 24 (.tbtn), primary */
  .btn, .actions button, .panel button, .card button, .sug { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: transparent; color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); height: 28px; padding: 0 10px; font: 500 var(--m-text-sm)/18px var(--m-font);
    letter-spacing: var(--m-tracking); white-space: nowrap; transition: background var(--m-fast), border-color var(--m-fast), color var(--m-fast); }
  .btn:hover, .actions button:hover, .panel button:hover, .card button:hover, .sug:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  .tbtn, .panel .tbtn, .panel .btns button { height: 24px; padding: 0 8px; border: 0; border-radius: var(--m-r-sm); background: none; color: var(--m-text-2);
    font: 500 var(--m-text-sm)/16px var(--m-font); letter-spacing: var(--m-tracking); white-space: nowrap; transition: background var(--m-fast), color var(--m-fast); }
  .tbtn:hover, .panel .tbtn:hover, .panel .btns button:hover { color: var(--m-text); background: var(--m-hover); }
  button.primary { background: var(--m-primary) !important; border-color: var(--m-primary) !important; color: var(--m-primary-text) !important; }
  button.primary:hover { background: var(--m-primary-hover) !important; }

  /* ---- keys: one cap. 16 tall inline in text, 20 in sheets and menus */
  kbd { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; vertical-align: 1px;
    font: 500 10.5px/1 var(--m-mono); letter-spacing: 0; color: var(--m-text-2); background: var(--m-raised); border: 1px solid var(--m-line-strong); border-radius: 4px; }
  .caps { display: inline-flex; gap: 4px; align-items: center; }
  .caps kbd { min-width: 20px; height: 20px; padding: 0 6px; font-size: var(--m-text-xs); vertical-align: 0; }
  .caps.off { font: var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); }
  :is(button.primary, .tip) kbd { background: color-mix(in srgb, currentColor 14%, transparent); border-color: color-mix(in srgb, currentColor 24%, transparent); color: inherit; }

  /* ---- eyebrow labels: section names in sheets, menus, popovers and modals */
  .card label, .sheet h4, :is(.menu, .a11y-group) > header, .gm-field label, .gm-clips-l, .sugs .try, .eyebrow {
    font: 500 var(--m-text-xs)/16px var(--m-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--m-text-3); }

  /* ---- tags: small mono labels in a hairline box */
  .tags span, .pill { display: inline-flex; align-items: center; height: 20px; padding: 0 6px; font: 10.5px/16px var(--m-mono); letter-spacing: 0; color: var(--m-text-2);
    border: 1px solid var(--m-line-strong); border-radius: 4px; white-space: nowrap; }

  /* ---- floating surfaces: toolbar, popovers, menus, notes */
  .pop, .gm-tb, .gm-pop, .gm-note, .menu { background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-md); box-shadow: var(--m-shadow); }

  /* ---- menus: 32px rows, icon or label, then what it shows on the right */
  /* :is(.menu, .a11y-group): the Easier to use group in Page tools is a second menu panel inside the first (first-run fix: it showed bare buttons) */
  .menu { position: absolute; z-index: 2; min-width: 248px; padding: 4px; animation: rise2 var(--m-fast) var(--m-ease); }
  :is(.menu, .a11y-group) > header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 4px 8px; }
  :is(.menu, .a11y-group) > header small { min-width: 0; font-size: var(--m-text-xs); letter-spacing: 0; text-transform: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :is(.menu, .a11y-group) > button { display: flex; align-items: center; gap: 12px; width: 100%; height: 32px; padding: 0 8px; border: 0; border-radius: var(--m-r-sm); background: transparent;
    color: var(--m-text); font: 450 var(--m-text-md)/16px var(--m-font); letter-spacing: var(--m-tracking); text-align: start; white-space: nowrap; }
  :is(.menu, .a11y-group) > button:hover { background: var(--m-hover); }
  :is(.menu, .a11y-group) > button > span:not([class]) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  :is(.menu, .a11y-group) > button > svg { color: var(--m-text-2); }
  :is(.menu, .a11y-group) > button small { color: var(--m-text-3); font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; }
  .menu hr { height: 1px; margin: 4px; border: 0; background: var(--m-line); }

  /* ---- segmented control (radio group / tabs): 28 tall, 24px segments */
  .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--m-r-sm); background: var(--m-raised); box-shadow: inset 0 0 0 1px var(--m-line); }
  .seg button { flex: 1; height: 24px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--m-text-2);
    font: 500 var(--m-text-sm)/16px var(--m-font); letter-spacing: var(--m-tracking); white-space: nowrap; transition: background var(--m-fast), color var(--m-fast); }
  .seg button:hover { color: var(--m-text); }
  .seg button:is([aria-checked="true"], [aria-pressed="true"]) { background: var(--m-surface); color: var(--m-text); box-shadow: 0 0 0 1px var(--m-line-strong); }

  /* ---- fields: a hairline box on --m-bg; focus lights the border into a 2px ring; invalid turns it red */
  .field, .link input, .code { background: var(--m-bg); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); }
  .field { height: 32px; transition: border-color var(--m-fast), box-shadow var(--m-fast); }
  .field input { min-width: 0; height: 100%; padding: 0; margin: 0; border: 0; outline: 0; background: transparent; color: var(--m-text); font: 500 var(--m-text-sm)/16px var(--m-mono); letter-spacing: 0; }
  .field:is(:focus-within, :focus-visible), .link input:focus-visible, .code:focus-visible { outline: 0; border-color: var(--m-signal-3); box-shadow: 0 0 0 1px var(--m-signal-3); }
  .field:has(input:invalid) { border-color: var(--m-danger); box-shadow: 0 0 0 1px var(--m-danger); }
  .field:has(input:invalid) input { color: var(--m-danger); }
  .field::placeholder, .field input::placeholder { color: var(--m-text-3); opacity: 1; }

  /* ---- tooltips: name + shortcut, after a short hover or on keyboard focus */
  .tip { position: absolute; left: 50%; bottom: calc(100% + 8px); z-index: 3; display: flex; align-items: center; gap: 8px; height: 24px; padding-block: 0; padding-inline: 8px 4px;
    border-radius: var(--m-r-sm); background: var(--m-text); color: var(--m-text-inverse); white-space: nowrap; font: 500 var(--m-text-xs)/16px var(--m-font); letter-spacing: 0;
    pointer-events: none; opacity: 0; transform: translate(-50%, 2px); transition: opacity var(--m-fast), transform var(--m-fast); box-shadow: var(--m-shadow); }
  .tip:not(:has(kbd)) { padding-inline-end: 8px; }
  .tip kbd { height: 16px; border: 0; }
  :is(:hover, :focus-visible) > .tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 300ms; }
  /* one tooltip at a time: hovering a sibling hides the focused one; an open menu hides its button's */
  :hover > :focus-visible:not(:hover) > .tip, [aria-expanded="true"] > .tip, :disabled > .tip { opacity: 0; transition-delay: 0ms; }

  /* the radar is still (the Morse mark) unless a model is working */
  .radar rect { animation: none; }
  .radar rect.c { opacity: 0.9; }
  .radar rect.o { opacity: 0.3; }
  .mark.live .radar rect.c, .hint .radar rect.c { animation: m-pulse 1.5s ease-in-out infinite both; }
  .mark.live .radar rect.o, .hint .radar rect.o { animation: m-pulse-dim 1.5s ease-in-out infinite both; }
  .mark { display: inline-flex; color: var(--m-text); flex: none; }

  .fx { position: fixed; display: none; pointer-events: none; border-radius: var(--m-r-md); }
  .hl, .sel { position: fixed; pointer-events: none; border-radius: var(--m-r-sm); transition: all 70ms var(--m-ease);
    outline: 1.5px solid var(--m-signal-4); outline-offset: 0; box-shadow: 0 0 0 4px var(--m-focus); background: color-mix(in srgb, var(--m-signal-4) 6%, transparent); }
  .sel { outline-style: dashed; box-shadow: none; }
  /* the picker label and the edit frame's readout: one inverse mono label */
  .hl span, .gm-read { background: var(--m-signal-4); color: var(--m-text-inverse); font: 500 var(--m-text-xs)/12px var(--m-mono); padding: 4px 6px;
    border-radius: var(--m-r-sm); white-space: nowrap; letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .hl span { position: absolute; left: -1.5px; top: -24px; max-width: calc(100vw - 8px); overflow: hidden; text-overflow: ellipsis; }
  .hl span.inside { top: 4px; left: 4px; }
  /* while a sheet is open in the bar, pointing pauses: no box drawn through it */
  .hl:has(~ .bar.has-pane) { display: none !important; }
  .pulse { position: fixed; pointer-events: none; border-radius: var(--m-r-md); border: 1.5px solid var(--m-signal-4); animation: ping 900ms var(--m-ease) forwards; }
  @keyframes ping { 0% { box-shadow: 0 0 0 0 var(--m-focus); opacity: 1 } 100% { box-shadow: 0 0 0 16px transparent; opacity: 0 } }

  /* ---- command bar */
  .bar { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(680px, calc(100vw - 32px)); pointer-events: auto;
    background: var(--m-overlay); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
    color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: rise var(--m-med) var(--m-ease); }
  .bar.top { bottom: auto; top: 28px; }
  @keyframes rise { from { transform: translate(-50%, 6px); opacity: 0 } }
  .bar.working { border-color: var(--m-signal-2); }
  .bar.err { border-color: color-mix(in srgb, var(--m-danger) 60%, var(--m-line-strong)); }
  .row { display: flex; align-items: center; gap: 8px; padding-block: 8px; padding-inline: 16px 8px; }
  .row .mark { margin-inline-end: 4px; }
  .in { flex: 1; min-width: 0; height: 32px; background: transparent; border: 0; outline: 0; color: var(--m-text); font: 450 var(--m-text-lg)/20px var(--m-font); letter-spacing: var(--m-tracking); padding: 6px 0; margin: 0; }
  .in::placeholder { color: var(--m-text-3); opacity: 1; }
  .in:disabled { color: var(--m-text-2); }
  .go { flex: none; width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border-radius: var(--m-r-sm); border: 0; background: var(--m-primary); color: var(--m-primary-text); transition: background var(--m-fast); }
  .go:hover { background: var(--m-primary-hover); }
  .chip { display: inline-flex; align-items: center; gap: 2px; height: 24px; max-width: 44%; flex: none; background: var(--m-raised); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); padding-block: 0; padding-inline: 8px 1px; font: 500 var(--m-text-sm)/16px var(--m-mono); letter-spacing: 0; white-space: nowrap; }
  .chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .chip .x { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border: 0; border-radius: 4px; background: none; color: var(--m-text-3); padding: 0; }
  .chip .x:hover { color: var(--m-text); background: var(--m-hover); }
  .chip .x:focus-visible { outline-offset: 0; } /* nested in the chip: flush, so the ring doesn't cover the words */
  .status { display: flex; align-items: center; gap: 12px; padding-block: 6px; padding-inline: 16px 8px; border-top: 1px solid var(--m-line); font-size: var(--m-text-sm); line-height: 16px; color: var(--m-text-2); min-height: 40px; }
  /* one line that ends in an ellipsis, whatever it holds (hint, error, phase) */
  .hint { flex: 0 1 auto; min-width: 0; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint > .radar { vertical-align: -2px; margin-inline-end: 8px; }
  .hint b { color: var(--m-text); font-weight: 500; } .hint i { color: var(--m-warn); font-style: normal; }
  /* the result: the title gives way, the timing stays */
  .hint:has(.ok) { display: flex; align-items: baseline; gap: 8px; }
  .hint .ok { color: var(--m-text); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .hint .ok + .dim { flex: none; }
  .ticker { flex: 1 1 0; min-width: 0; overflow: hidden; white-space: nowrap; font: 11.5px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 35%); mask-image: linear-gradient(90deg, transparent, #000 35%); }
  .actions { display: flex; align-items: center; gap: 8px; margin-inline-start: auto; flex: none; max-width: 100%; }
  .actions em { font-style: normal; color: var(--m-text-3); margin-inline-start: 4px; font-variant-numeric: tabular-nums; }
  .model { font: var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; min-width: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ms { font: 500 var(--m-text-sm)/16px var(--m-mono); color: var(--m-text-2); font-variant-numeric: tabular-nums; letter-spacing: 0; }
  .dim { color: var(--m-text-3); }
  /* phone width: the status line wraps, actions go to their own row */
  @media (max-width: 560px) {
    .status { flex-wrap: wrap; row-gap: 4px; }
    .hint { flex: 1 1 100%; }
    .hint:empty { display: none; }
    .model { max-width: 140px; }
  }

  /* ---- mods panel */
  .panel { position: fixed; top: 12px; inset-inline-end: 12px; bottom: 12px; width: 372px; max-width: calc(100vw - 24px); pointer-events: auto; display: flex; flex-direction: column;
    background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: slide var(--m-med) var(--m-ease); }
  @keyframes slide { from { transform: translateX(12px); opacity: 0 } }
  .panel header { display: flex; align-items: center; gap: 12px; padding-block: 12px; padding-inline: 16px 12px; border-bottom: 1px solid var(--m-line); }
  .panel header div { flex: 1; min-width: 0; } .panel header b { font-size: var(--m-text-lg); line-height: 20px; font-weight: 600; display: block; }
  .panel header small { display: block; color: var(--m-text-3); font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* the close buttons are .ibtn.sm in all but name */
  .panel header > button, .card header > button { flex: none; width: 28px; height: 28px; padding: 0; display: grid; place-items: center; border: 0 !important; background: none !important; color: var(--m-text-2); border-radius: var(--m-r-sm); }
  .panel header > button:hover, .card header > button:hover { color: var(--m-text); background: var(--m-hover) !important; }
  .list { flex: 1; overflow: auto; padding: 8px; }
  .list article { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 12px; padding: 12px 8px; border-radius: 0; margin: 0; transition: background var(--m-fast); }
  .list > article + article { border-top: 1px solid var(--m-line); }
  .list article:hover { background: var(--m-hover); }
  .list > article:hover, .list > article:hover + article { border-top-color: transparent; }
  .meta { min-width: 0; overflow-wrap: anywhere; }
  .meta b { display: block; font-size: var(--m-text-md); line-height: 20px; font-weight: 550; } .meta small { color: var(--m-text-2); display: block; font-size: var(--m-text-sm); line-height: 16px; margin-top: 2px; }
  /* a disabled mod reads as off, but stays readable (AA) */
  .list article.off .meta b { color: var(--m-text-2); } .list article.off .meta small, .list article.off .tags span { color: var(--m-text-3); }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; } .tags span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .btns { grid-column: 2; display: flex; gap: 2px; margin-block: 8px 0; margin-inline: -8px 0; }
  .panel .btns button { color: var(--m-text-3); }
  .empty { color: var(--m-text-2); text-align: center; padding: 48px 24px; line-height: 24px; margin: 0; }
  .empty .radar { color: var(--m-text-3); margin-bottom: 12px; }
  .panel footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-block: 10px; padding-inline: 16px 12px; border-top: 1px solid var(--m-line); font: var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .panel footer span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel footer button { flex: none; }
  .sw { position: relative; flex: none; width: 32px; height: 20px; margin-top: 0; } .sw input { opacity: 0; width: 0; height: 0; position: absolute; margin: 0; }
  .sw span { position: absolute; inset: 0; background: var(--m-line-strong); border-radius: 10px; transition: var(--m-fast); cursor: pointer; }
  .sw span::after { content: ""; position: absolute; inset-inline-start: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--m-text-2); transition: var(--m-fast) var(--m-ease); }
  .sw:hover span { background: var(--m-signal-1); }
  .sw input:checked + span { background: var(--m-primary); } .sw input:checked + span::after { transform: translateX(12px); background: var(--m-primary-text); }
  .sw:hover input:checked + span { background: var(--m-primary-hover); }
  .sw input:focus-visible + span { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }

  /* ---- keep iterating (70-panel.js): search, rows you can move through,
     versions, and the "not working" note with Fix it */
  .psearch { padding: 8px 8px 0; }
  .psearch .search { display: block; width: 100%; height: 32px; margin: 0; padding: 0 12px; background: var(--m-bg); color: var(--m-text); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-sm); font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking); outline: 0; -webkit-appearance: none; appearance: none; }
  .psearch .search::placeholder { color: var(--m-text-3); opacity: 1; }
  .psearch .search:focus { border-color: var(--m-signal-2); }
  .list article { outline: none; }
  .list article:focus-visible { background: var(--m-raised); outline: 2px solid var(--m-signal-3); outline-offset: -2px; }
  .meta small.latest { color: var(--m-text-3); }
  .tags .when { font: 400 var(--m-text-xs)/16px var(--m-font); font-style: normal; color: var(--m-text-3); letter-spacing: 0; white-space: nowrap; }
  /* a follow-up is typed: Enter refines, so Keep loses its ↵ */
  .bar.refining .actions [data-a=keep] kbd { display: none; }
  .panel .btns { flex-wrap: wrap; row-gap: 2px; }
  .panel .btns em { font: 10.5px/16px var(--m-mono); font-style: normal; color: var(--m-text-3); margin-inline-start: 2px; letter-spacing: 0; }
  /* simplify: a row's rarer actions, and the panel's own (backup, packs), under More */
  .rmore, .pmore { position: relative; }
  .rmore > summary, .pmore > summary { list-style: none; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: var(--m-r-sm); color: var(--m-text-3); cursor: pointer;
    font: 450 var(--m-text-sm)/24px var(--m-font); letter-spacing: var(--m-tracking); }
  .pmore > summary { height: 28px; color: var(--m-text-2); }
  .rmore > summary::-webkit-details-marker, .pmore > summary::-webkit-details-marker { display: none; }
  .rmore > summary::after, .pmore > summary::after { content: ""; width: 5px; height: 5px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: translateY(-2px) rotate(45deg); }
  .rmore[open] > summary::after, .pmore[open] > summary::after { transform: translateY(1px) rotate(-135deg); }
  .rmore > summary:hover, .pmore > summary:hover { color: var(--m-text); background: var(--m-hover); }
  .rmore[open] { flex-basis: 100%; }
  .rmore-list { display: flex; flex-wrap: wrap; gap: 2px; }
  .pmore { flex: 1; min-width: 0; }
  .pmore[open] { flex-basis: 100%; order: 3; }
  .pmore .ctl-backup { padding-inline: 0; border-top: 0; padding-block: 6px 0; font-family: var(--m-font); }
  .panel footer:has(.pmore[open]) { flex-wrap: wrap; }
  .card footer .ctl-file { margin-inline-end: auto; }
  .health { grid-column: 2; display: flex; align-items: center; gap: 12px; margin-top: 10px; padding-block: 8px; padding-inline: 12px 8px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-bg); }
  .health p { flex: 1; min-width: 0; margin: 0; font-size: var(--m-text-sm); line-height: 16px; color: var(--m-text-2); overflow-wrap: anywhere; }
  .health b { color: var(--m-text); font-weight: 600; }
  .health b::before { content: ""; margin-block: 0 1px; margin-inline: 0 7px; background: var(--m-danger); vertical-align: middle; }
  /* ---- the status dot: a 6px square with 1.5px corners, one of the radar mark's squares
     (a stopped or paused mod, trying a mod, a notice under the input, a list of what's in a mod) */
  .health b::before, .gl-trying::before, .gl-upd b::before, .ctl-items li::before, .ob-dot { flex: none; display: inline-block; width: 6px; height: 6px; border-radius: 1.5px; }
  .panel .health button { flex: none; height: 24px; padding: 0 10px; }
  /* two buttons (a paused mod, 64-guard.js): the words get the whole row, the buttons go under them on the right */
  .health.guard { flex-wrap: wrap; row-gap: 8px; }
  .health.guard p { flex-basis: 100%; }
  .health.guard p + button { margin-inline-start: auto; }
  .versions { grid-column: 2; list-style: none; margin-block: 8px 0; margin-inline: -8px 0; padding: 0; border: 0; border-radius: 0; }
  .versions li { margin: 0; }
  .versions li + li { border-top: 1px solid var(--m-line); }
  .versions li.cur, .panel .versions button { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; width: 100%; height: 24px; padding: 4px 6px;
    border: 0; border-radius: 4px; text-align: start; font: 400 var(--m-text-sm)/16px var(--m-font); letter-spacing: var(--m-tracking); white-space: normal; }
  .panel .versions button:hover { background: var(--m-hover); }
  .versions .vn { font: 10.5px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .versions .vp { color: var(--m-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .versions .vt { font: 11px/16px var(--m-font); color: var(--m-text-3); white-space: nowrap; letter-spacing: 0; }
  .versions li.cur .vp, .panel .versions button:hover .vp { color: var(--m-text); }
  .versions li.cur .vn { color: var(--m-text); }
  .vhint { grid-column: 2; margin: 6px 0 0; font-size: var(--m-text-xs); line-height: 16px; color: var(--m-text-3); }

  /* ---- modals */
  .modal { position: fixed; inset: 0; background: var(--m-scrim); display: flex; align-items: center; justify-content: center; pointer-events: auto; animation: fade var(--m-fast); }
  /* a <dialog> (shown modally for reviews, 80-modals.js): none of the browser's dialog look */
  dialog.modal { margin: 0; padding: 0; border: 0; width: auto; height: auto; max-width: none; max-height: none; color: inherit; overflow: visible; }
  dialog.modal::backdrop { background: transparent; }
  @keyframes fade { from { opacity: 0 } }
  .card { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow: auto; background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-lg); padding: 20px; font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); box-shadow: var(--m-shadow); animation: rise2 var(--m-med) var(--m-ease); }
  .card header { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: start; margin-bottom: 16px; }
  .card header b { font-size: var(--m-text-xl); line-height: 28px; font-weight: 600; overflow-wrap: anywhere; } .card header small { grid-row: 2; color: var(--m-text-2); margin-top: 4px; overflow-wrap: anywhere; }
  .card header > button { grid-row: 1; grid-column: 2; margin-block: 0; margin-inline: 0 -4px; }
  .card label { display: block; margin: 16px 0 8px; }
  .card label .dim, .card label code { text-transform: none; letter-spacing: 0; font: inherit; }
  .code { display: block; width: 100%; min-height: 128px; border-radius: var(--m-r-md); padding: 12px; margin: 0;
    font: 12px/20px var(--m-mono); letter-spacing: 0; font-variant-ligatures: none; resize: vertical; outline: 0; white-space: pre; overflow: auto;
    scrollbar-width: thin; scrollbar-color: var(--m-signal-2) transparent; /* not the system's light scrollbars on a dark box */ }
  .code[data-k="src"] { white-space: pre-wrap; word-break: break-all; }
  .code::placeholder { color: var(--m-text-3); opacity: 1; }
  .card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .cardimg { width: 100%; border-radius: var(--m-r-md); border: 1px solid var(--m-line); display: block; }
  .link { display: flex; gap: 8px; margin-top: 12px; } .link input { flex: 1; min-width: 0; height: 28px; margin: 0; color: var(--m-text-2); padding: 0 10px; font: 12px/18px var(--m-mono); letter-spacing: 0; text-overflow: ellipsis; outline: 0; }
  .exports { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .saved { margin: 12px 0 0; font: var(--m-text-xs)/16px var(--m-mono); }
  .saved:empty { display: none; }

  .toast { position: fixed; inset-inline-start: 20px; bottom: 20px; max-width: min(480px, calc(100vw - 40px)); pointer-events: none; display: flex; align-items: flex-start; gap: 10px; background: var(--m-surface); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); padding-block: 9px; padding-inline: 12px 14px; font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking);
    box-shadow: var(--m-shadow); animation: rise2 var(--m-med) var(--m-ease); }
  /* while the bar is open at the bottom, toasts go to the top so they never cover it */
  .bar:not([hidden]):not(.top) ~ :is(.toast, .ctl-toast) { bottom: auto; top: 20px; }
  .toast .radar { flex: none; color: var(--m-text-2); margin-top: 4px; }
  .toast span { min-width: 0; overflow-wrap: anywhere; }
  @keyframes rise2 { from { transform: translateY(6px); opacity: 0 } }

  /* reduced motion: nothing slides, pulses or sweeps; state changes are instant */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
    .mark.live .radar rect, .hint .radar rect { animation: none !important; }
    .mark.live .radar rect.c, .hint .radar rect.c { opacity: 1; }
    .mark.live .radar rect.o, .hint .radar rect.o { opacity: 0.55; }
  }

  /* ---- right to left (Persian, Arabic: 04-i18n.js sets dir on the host).
     Sides are logical above; what's left: things that move or point one
     way, and key caps, which read left to right in every language. */
  :host([dir=rtl]) { direction: rtl; }
  kbd, .caps { direction: ltr; unicode-bidi: isolate; }
  .in { unicode-bidi: plaintext; } /* what you type lines up with its own language */
  :host([dir=rtl]) :is(.i-go, [data-t=undo] svg, [data-t=redo] svg) { transform: scaleX(-1); }
  .chip span, .model, .panel header small, .panel article small, .ys-row small { unicode-bidi: plaintext; text-align: match-parent; } /* names of things on the page keep their own direction */
  :host([dir=rtl]) .panel { animation-name: slide-rtl; }
  @keyframes slide-rtl { from { transform: translateX(-12px); opacity: 0 } }
  :host([dir=rtl]) .sw input:checked + span::after { transform: translateX(-12px); }
  :host([dir=rtl]) :is(.ctl-code, .i-code) summary::before { transform: scaleX(-1); }
  :host([dir=rtl]) :is(.ctl-code, .i-code)[open] summary::before { transform: rotate(90deg); }
  /* Persian and Arabic letters join: the mono face has none of them, and its
     fallback (or tracking) draws them apart. Labels that hold words take the
     UI face; code, key caps and the model's name stay mono. */
  :host([dir=rtl]) :is(.card label, .sheet h4, :is(.menu, .a11y-group) > header, .gm-field label, .gm-clips-l, .sugs .try, .eyebrow, .tags span, .pill,
    :is(.menu, .a11y-group) > button small, .krow .k small, .panel header small, .caps.off, .sheet header .flash, .saved, .hl span, .gm-read) { font-family: var(--m-font); letter-spacing: 0; }
  /* forced colors (Windows High Contrast): shadows and fills are dropped and
     colors become the system's, so every focus ring is an outline in
     Highlight, every surface and button keeps a border, and what is on or
     chosen shows as a ring. Swatches keep their real colors. */
  @media (forced-colors: active) {
    :focus-visible, .list article:focus-visible, .sw input:focus-visible + span, .field:is(:focus-within, :focus-visible), .link input:focus-visible, .code:focus-visible, .in:focus-visible {
      outline: 2px solid Highlight !important; outline-offset: 2px; }
    :is(.menu, .a11y-group) > button:focus-visible, .list article:focus-visible { outline-offset: -2px; }
    .bar, .panel, .card, .toast, .pop, .gm-tb, .gm-pop, .gm-note, .menu, .chip, .tip, .guide, .ctl-toast, .so-strip, kbd { border: 1px solid CanvasText; }
    .go, .ibtn, .tbtn, .seg button, .sug, .chip .x, .panel header > button, .card header > button, .gm-chip { border: 1px solid ButtonText !important; }
    :is(.seg button, .ibtn, .gm-chip, .gm-sw button):is([aria-checked="true"], [aria-pressed="true"]) { outline: 2px solid Highlight; outline-offset: -2px; }
    .sw span { border: 1px solid ButtonText; }
    .sw span::after { background: ButtonText; }
    .sw input:checked + span { background: Highlight; }
    .sw input:checked + span::after { background: HighlightText; }
    .hl, .sel, .gm-frame { outline-color: Highlight; border-color: Highlight; }
    .gm-sw button, .gm-hex i { forced-color-adjust: none; }
  }
`; }
