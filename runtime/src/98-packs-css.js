// Styles for mod packs (69-packs.js): the pack review and the update review,
// Make a pack, and pack groups in the Mods panel. Builds on the shared parts
// (99-css.js: .sw, .seg, .field, buttons) and the install review's summary
// (98-control-css.js: .ctl-warn, .ctl-from, .ctl-code). Tokens only, 4px grid;
// joined into the overlay by 10-dom.js.
function PACKS_CSS() { return `
  /* ---- the reviews: one block per mod, with a tick */
  .pk-card { width: min(680px, calc(100vw - 32px)); }
  .pk-note { margin: 0 0 12px; padding: 8px 12px; border-left: 2px solid var(--m-line-strong); color: var(--m-text-2); overflow-wrap: anywhere; }
  .pk-items { display: grid; gap: 8px; }
  .pk-item { padding: 12px; border: 1px solid var(--m-line); border-radius: var(--m-r-md); background: var(--m-bg); transition: opacity var(--m-fast); }
  .pk-item.off { background: transparent; }
  .pk-item.off .pk-body { opacity: .6; }
  .pk-pick { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
  .card .pk-pick { margin: 0; font: inherit; letter-spacing: var(--m-tracking); text-transform: none; color: var(--m-text); }
  .pk-pick input, .pk-sub input, .pk-sel input { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--m-primary); cursor: pointer; }
  .pk-pick > span { flex: 1; min-width: 0; }
  .pk-pick b { display: block; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
  .pk-pick .ctl-from { display: block; margin: 0; }
  .pk-body { margin: 4px 0 0 28px; }
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
  .pk-sub { display: flex; align-items: flex-start; gap: 12px; margin: 16px 0 0; padding: 12px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); cursor: pointer; }
  .card .pk-sub { font: inherit; letter-spacing: var(--m-tracking); text-transform: none; color: var(--m-text); }
  .pk-sub b { display: block; font-weight: 600; line-height: 20px; }
  .pk-sub small { display: block; color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 16px; }
  .pk-subbed { margin: 16px 0 0; color: var(--m-text-2); font-size: var(--m-text-sm); }
  .card .ctl-h + .pk-items { margin-top: 0; }
  .card button:disabled { opacity: .5; cursor: default; }

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
  .list.pk-picking article > label.sw { display: none; }
  .pk-sel { display: grid; place-items: center; width: 32px; height: 20px; cursor: pointer; }
  .pk-sel input { margin: 0; }
  .pk-pickbar { position: sticky; top: -8px; z-index: 1; display: flex; align-items: center; gap: 8px; margin: -8px -8px 8px; padding: 12px; background: var(--m-surface); border-bottom: 1px solid var(--m-line); }
  .pk-pickbar span { flex: 1; min-width: 0; }
  .pk-pickbar b { display: block; font-weight: 600; line-height: 20px; }
  .pk-pickbar small { display: block; color: var(--m-text-3); font-size: var(--m-text-sm); line-height: 16px; }
  .panel .pk-pickbar button:disabled { opacity: .5; cursor: default; }
`; }
