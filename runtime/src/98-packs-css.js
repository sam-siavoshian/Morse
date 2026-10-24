// Styles for mod packs (69-packs.js): the pack review and the update review,
// Make a pack, and pack groups in the Mods panel. Builds on the shared parts
// (99-css.js: .sw, .seg, .field, buttons) and the install review's summary
// (98-control-css.js: .ctl-warn, .ctl-from, .ctl-code). Tokens only, 4px grid;
// joined into the overlay by 10-dom.js.
function PACKS_CSS() { return `
  /* ---- the reviews: one block per mod, with a tick */
  .pk-card { width: min(680px, calc(100vw - 32px)); }
  /* a pack can be long: Install / Update stay in view at the bottom of the card */
  .pk-card footer { position: sticky; bottom: -20px; z-index: 1; margin: 16px -20px -20px; padding: 12px 20px 20px; background: var(--m-surface); border-top: 1px solid var(--m-line); }
  /* the maker's note: a quote in the box the update review's "What changed" uses (98-gallery-css.js .gl-what) */
  .pk-note { margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--m-line); border-radius: var(--m-r-md); background: var(--m-bg); color: var(--m-text); overflow-wrap: anywhere; }
  .pk-items { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .pk-item { min-width: 0; padding: 12px; border: 1px solid var(--m-line); border-radius: var(--m-r-md); background: var(--m-bg); }
  /* unticked: muted by color (the AA tokens), never by opacity */
  .pk-item.off { background: transparent; }
  .pk-item.off .pk-pick b, .pk-item.off .pk-does { color: var(--m-text-2); }
  .card .pk-pick { display: flex; align-items: flex-start; gap: 12px; margin: 0; cursor: pointer; font: inherit; letter-spacing: var(--m-tracking); text-transform: none; color: var(--m-text); }
  .pk-pick input, .pk-sub input, .pk-sel input { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--m-primary); cursor: pointer; }
  .pk-pick > span { flex: 1; min-width: 0; }
  .pk-pick b { display: block; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
  .pk-pick .ctl-from { display: block; margin: 0; }
  .pk-body { min-width: 0; margin: 4px 0 0 28px; }
  .pk-body pre { max-width: 100%; }
  .pk-body .ctl-prompt { font-size: var(--m-text-sm); line-height: 16px; }
  .pk-does { margin: 8px 0 0; color: var(--m-text); font-size: var(--m-text-sm); line-height: 20px; overflow-wrap: anywhere; }
  .pk-does b { font-weight: 600; }
  .pk-body .ctl-warn { margin-top: 8px; font-size: var(--m-text-sm); line-height: 20px; }
  .pk-body .ctl-code { margin-top: 4px; }
  .pk-count { margin: 8px 0 0; font-size: var(--m-text-sm); line-height: 16px; }
  .pk-clash { margin: 8px 0 0; padding: 8px 12px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-raised); font-size: var(--m-text-sm); line-height: 20px; color: var(--m-text); overflow-wrap: anywhere; }
  div.pk-clash { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  div.pk-clash p { flex: 1 1 200px; margin: 0; }
  .card .pk-clash .seg button { height: 24px; border: 0; padding: 0 8px; }
  .card .pk-clash .seg button:hover { background: transparent; }
  .card .pk-clash .seg button[aria-checked="true"] { background: var(--m-surface); }
  .card .pk-sub { display: flex; align-items: flex-start; gap: 12px; margin: 16px 0 0; padding: 12px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); cursor: pointer;
    font: inherit; letter-spacing: var(--m-tracking); text-transform: none; color: var(--m-text); }
  .pk-sub b { display: block; font-weight: 600; line-height: 20px; }
  .pk-sub small { display: block; color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 16px; }
  .pk-subbed { margin: 16px 0 0; color: var(--m-text-2); font-size: var(--m-text-sm); }
  .card .ctl-h + .pk-items { margin-top: 0; }
  .pk-before { margin-top: 16px; }
  .pk-before > summary { display: inline-flex; align-items: center; gap: 6px; height: 28px; cursor: pointer; list-style: none; color: var(--m-text-2); font-weight: 500; border-radius: var(--m-r-sm); }
  .pk-before > summary::-webkit-details-marker { display: none; }
  .pk-before > summary::before { content: ""; border-style: solid; border-width: 4px 0 4px 6px; border-color: transparent transparent transparent currentColor; transition: transform var(--m-fast); }
  .pk-before[open] > summary::before { transform: rotate(90deg); }
  .pk-before > summary:hover { color: var(--m-text); }
  .pk-before .pk-items { margin-top: 8px; }
  /* Install with nothing ticked, or while it installs. Color only: no opacity or filter on a
     review's button, or the browser can't tell it's uncovered (80-modals.js settleReview). */
  .pk-card button:disabled { cursor: default; }
  .pk-card button.primary[data-settle="busy"]:disabled { background: var(--m-line-strong) !important; border-color: var(--m-line-strong) !important; color: var(--m-text-2) !important; }

  /* ---- Make a pack */
  .pk-field { display: flex; align-items: center; padding: 0 12px; }
  .pk-field input { flex: 1; font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking); }
  .pk-note-in { display: block; width: 100%; min-height: 72px; margin: 0; padding: 8px 12px; resize: vertical; outline: 0; background: var(--m-bg); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking); }
  .pk-note-in:focus-visible { border-color: var(--m-signal-3); box-shadow: 0 0 0 1px var(--m-signal-3); }
  .pk-note-in::placeholder { color: var(--m-text-3); opacity: 1; }
  .pk-list { list-style: none; margin: 0; padding: 4px 12px; border: 1px solid var(--m-line); border-radius: var(--m-r-md); max-height: 200px; overflow: auto; }
  .pk-list li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--m-line); }
  .pk-list li:last-child { border-bottom: 0; }
  .pk-list b { min-width: 0; font-weight: 550; overflow-wrap: anywhere; }
  .pk-list small { flex: none; max-width: 50%; color: var(--m-text-3); font: 11px/16px var(--m-mono); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pk-link { margin-top: 16px; }
  .pk-err { margin: 12px 0 0; color: var(--m-danger); font-size: var(--m-text-sm); line-height: 20px; }
  .pk-err.ok { color: var(--m-text-2); font: var(--m-text-xs)/16px var(--m-mono); }
  .pk-err:empty { display: none; }

  /* ---- the Mods panel: a pack's mods under its name */
  .pk-group { margin: 8px 0 4px; border: 1px solid var(--m-line); border-radius: var(--m-r-md); overflow: hidden; }
  .pk-group .pk-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 12px; align-items: center; padding: 12px; background: var(--m-raised); }
  .pk-group .pk-head .sw { align-self: start; margin-top: 0; }
  .pk-meta b { display: block; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
  .pk-meta small { display: block; color: var(--m-text-3); font-size: var(--m-text-sm); line-height: 16px; }
  .pk-group.off .pk-meta b { color: var(--m-text-2); }
  .pk-btns { grid-column: 2; display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0 0 -8px; }
  .panel .pk-btns button { height: 24px; padding: 0 8px; border: 0; background: none; color: var(--m-text-3); font: 500 var(--m-text-sm)/16px var(--m-font); }
  .panel .pk-btns button:hover { color: var(--m-text); background: var(--m-hover); }
  .pk-group .pk-upd { margin: 0; border-width: 1px 0 0; border-radius: 0; padding: 8px 8px 8px 12px; }
  .pk-group > article { margin: 0; border-radius: 0; border-top: 1px solid var(--m-line); }
  .pk-group > article:hover { background: var(--m-raised); }

  /* ---- the Mods panel: choosing mods for a pack */
  .pk-bar { border-top: 1px solid var(--m-line); }
  .pk-bar + .ctl-backup { border-top: 0; padding-top: 0; }
  .list.pk-picking article > label.sw, .list.pk-picking article > :is(.btns, .versions, .vhint, .health, .gl-upd) { display: none; }
  .list.pk-picking .pk-group > .pk-upd, .list.pk-picking .pk-btns, .list.pk-picking .pk-head .sw { display: none; }
  .pk-sel { display: grid; place-items: center; width: 32px; height: 20px; cursor: pointer; }
  .pk-sel input { margin: 0; }
  .pk-pickbar { position: sticky; top: -8px; z-index: 1; display: flex; align-items: center; gap: 8px; margin: -8px -8px 8px; padding: 12px; background: var(--m-surface); border-bottom: 1px solid var(--m-line); }
  .pk-pickbar span { flex: 1; min-width: 0; }
  .pk-pickbar b { display: block; font-weight: 600; line-height: 20px; }
  .pk-pickbar small { display: block; color: var(--m-text-3); font-size: var(--m-text-sm); line-height: 16px; }
  /* Next with nothing chosen: the same off look as Install with nothing ticked (color only) */
  .panel .pk-pickbar button.primary:disabled { background: var(--m-line-strong); border-color: var(--m-line-strong); color: var(--m-text-2); cursor: default; }
`; }
