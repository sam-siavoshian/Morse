// Your style (72-style.js): its row at the top of the Mods panel, the review
// sheet under the bar, and its section in Settings. Everything else is the
// shared parts in 99-css.js (.sw, .tags, .seg, .field, .btns, .sheet, .srow).
function STYLE_CSS() {
  return `
  /* the Mods panel: Your style is the first row, a hairline under it, the same surface as the mods */
  .ys-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 12px; padding: 12px 8px; margin: 0; border: 0; border-bottom: 1px solid var(--m-line);
    border-radius: 0; background: transparent; }
  .ys-row.off .meta b { color: var(--m-text-2); }
  .ys-row.off .meta small, .ys-row.off .tags span { color: var(--m-text-3); }
  .ys-row .btns { flex-wrap: wrap; row-gap: 2px; }
  .ys-row .tags .when { flex-basis: 100%; } /* where it runs: always its own line, never beside a tag */
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
  .ys-chips .chip { max-width: 100%; } /* the bar's chip (99-css.js), × and all */
  @media (max-width: 560px) { .ys-field { width: 100%; } .srow.ys-except .ctl { align-items: stretch; width: 100%; } .srow.ys-except .tbtn { align-self: flex-end; } }
  `;
}
