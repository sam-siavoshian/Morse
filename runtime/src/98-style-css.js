// Your style (72-style.js): its row at the top of the Mods panel, the review
// sheet under the bar, and its section in Settings. Everything else is the
// shared parts in 99-css.js (.sw, .tags, .seg, .field, .btns, .sheet, .srow).
function STYLE_CSS() {
  return `
  /* the Mods panel: Your style sits above the mods, in a hairline box */
  .ys-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 12px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-md); background: var(--m-raised); }
  .ys-row.off .meta b { color: var(--m-text-2); }
  .ys-row.off .meta small, .ys-row.off .tags span { color: var(--m-text-3); }
  .ys-row .btns { flex-wrap: wrap; row-gap: 2px; }
  .ys-row .meta > small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* the bar: what the style does, before Save */
  .ys-sheet header { display: flex; align-items: baseline; gap: 8px; }
  .ys-sheet header .dim { font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; }
  .ys-tags { margin: 4px 8px 8px; }
  .ys-note { margin: 0 8px 8px; font-size: var(--m-text-sm); line-height: 16px; color: var(--m-text-2); }
  .ys-note b { color: var(--m-text); font-weight: 550; }

  /* Settings */
  .ys-field { width: 200px; height: 28px; padding: 0 10px; margin: 0; outline: 0; font: 450 var(--m-text-sm)/16px var(--m-font); letter-spacing: var(--m-tracking); }
  .ys-field::placeholder { color: var(--m-text-3); opacity: 1; }
  .ys-field:focus-visible { border-color: var(--m-signal-3); box-shadow: 0 0 0 1px var(--m-signal-3); }
  .srow.ys-except { align-items: flex-start; }
  .srow.ys-except .ctl { flex-direction: column; align-items: flex-end; gap: 4px; }
  .ys-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .ys-chip { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding-block: 0; padding-inline: 8px 2px; border: 1px solid var(--m-line-strong); border-radius: 4px;
    font: 500 var(--m-text-sm)/16px var(--m-mono); letter-spacing: 0; color: var(--m-text); background: var(--m-bg); }
  .ys-chip .ibtn.xs { width: 20px; height: 20px; font-size: 14px; color: var(--m-text-3); }
  .ys-chip .ibtn.xs:hover { color: var(--m-text); }
  @media (max-width: 560px) { .ys-field { width: 100%; } .srow.ys-except .ctl { align-items: stretch; width: 100%; } }
  `;
}
