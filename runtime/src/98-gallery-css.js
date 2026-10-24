// Styles for Mods for this site (68-gallery.js): the For this site section in
// the Mods panel, the chip in the bar, the strip while trying a mod, Update
// available on a row, and the update review. Tokens only, monochrome like the
// rest; joined into the overlay by 10-dom.js.
function GALLERY_CSS() { return `
  /* ---- For this site, under the mods in the panel */
  .gl-site { margin: 8px 4px 4px; padding-top: 12px; border-top: 1px solid var(--m-line); }
  .gl-site h4 { margin: 0 8px 8px; }
  /* the whole row opens and closes the list; the Show/Hide .tbtn is the control */
  .gl-head { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 12px; cursor: pointer;
    border: 1px solid var(--m-line); border-radius: var(--m-r-md); background: var(--m-bg); transition: background var(--m-fast), border-color var(--m-fast); }
  .gl-head:hover { background: var(--m-hover); border-color: var(--m-line-strong); }
  .gl-mark { flex: none; display: grid; place-items: center; color: var(--m-text-3); }
  .gl-count { flex: 1; min-width: 0; }
  .gl-count b { display: block; font: 550 var(--m-text-md)/20px var(--m-font); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gl-count small { display: block; font: 400 var(--m-text-sm)/16px var(--m-font); color: var(--m-text-3); }
  .panel .gl-show { flex: none; }
  .gl-show::after { content: ""; display: inline-block; width: 5px; height: 5px; margin: 0 2px 2px 8px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
  .gl-site.open .gl-show::after { transform: rotate(-135deg); margin-bottom: -1px; }
  .gl-items { margin-top: 4px; }
  .gl-item { display: flex; flex-direction: column; padding: 12px 10px; border-bottom: 1px solid var(--m-line); overflow-wrap: anywhere; }
  .gl-item:last-child { border-bottom: 0; }
  .gl-item > b { font: 550 var(--m-text-md)/20px var(--m-font); color: var(--m-text); }
  .gl-item .gl-req { color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 16px; margin-top: 2px; }
  .gl-sum { margin: 6px 0 0; color: var(--m-text-2); font: 400 var(--m-text-sm)/16px var(--m-font); }
  .gl-by { margin-top: 6px; color: var(--m-text-3); font: 400 var(--m-text-xs)/16px var(--m-font); }
  .gl-trying { margin: 8px 0 0; color: var(--m-text); font: 500 var(--m-text-sm)/16px var(--m-font); }
  /* still: only "a model is working" loops */
  .gl-trying::before { content: ""; margin: 0 8px 1px 0; background: var(--m-text); vertical-align: middle; } /* the status dot: 99-css.js */
  .gl-item.trying { background: var(--m-raised); border-radius: var(--m-r-md); border-bottom-color: transparent; }
  .gl-btns { display: flex; gap: 8px; margin-top: 12px; }
  .gl-foot { display: flex; align-items: center; gap: 8px; margin: 4px 10px 0; font: 11px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .gl-foot span { flex: 1; min-width: 0; text-align: left; }
  .panel .gl-link { flex: none; margin-right: -8px; }

  /* ---- Update available, on a mod's row */
  .gl-upd { grid-column: 2; display: flex; align-items: center; gap: 12px; margin-top: 10px; padding: 8px 8px 8px 12px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-bg); }
  .gl-upd p { flex: 1; min-width: 0; margin: 0; font-size: var(--m-text-sm); line-height: 16px; color: var(--m-text-2); overflow-wrap: anywhere; }
  .gl-upd b { color: var(--m-text); font-weight: 600; }
  .gl-upd b::before { content: ""; margin: 0 8px 1px 0; background: var(--m-text); vertical-align: middle; } /* the status dot (99-css.js) */
  .panel .gl-upd button { flex: none; height: 24px; padding: 0 10px; }

  /* ---- the chip in the bar */
  .sug.gl-sug { gap: 6px; padding-left: 8px; margin-left: 4px; position: relative; }
  .sug.gl-sug::before { content: ""; position: absolute; left: -6px; top: 6px; bottom: 6px; width: 1px; background: var(--m-line-strong); }
  .sug.gl-sug .gl-mark { color: var(--m-text-2); }

  /* ---- while trying a mod */
  .gl-trial { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 24px);
    padding: 6px 6px 6px 12px; background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking); animation: gl-drop var(--m-med) var(--m-ease); }
  @keyframes gl-drop { from { transform: translate(-50%, -6px); opacity: 0 } }
  .gl-trial .gl-mark { color: var(--m-text-2); }
  .gl-trial .gl-txt { min-width: 0; display: flex; align-items: baseline; gap: 8px; margin-right: 4px; }
  .gl-trial .gl-txt b { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gl-trial .gl-txt small { color: var(--m-text-3); font-size: var(--m-text-sm); white-space: nowrap; }
  .gl-trial .btn { flex: none; }
  @media (max-width: 560px) { .gl-trial { top: auto; bottom: 12px; } .gl-trial .gl-txt small { display: none; } }

  /* ---- the update review */
  .gl-what { padding: 12px 14px; border: 1px solid var(--m-line); border-radius: var(--m-r-md); background: var(--m-bg); }
  .gl-what h5 { margin: 0 0 8px; }
  .gl-what p { margin: 4px 0 0; color: var(--m-text-2); font-size: var(--m-text-md); line-height: 20px; }
  .gl-what p b { color: var(--m-text); font-weight: 550; }
  .gl-what .gl-note { color: var(--m-text); }
  .gl-what .gl-warn { color: var(--m-text); padding-left: 10px; border-left: 2px solid var(--m-warn); }
  .gl-what p.dim { margin-top: 8px; font: 11px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .gl-diff { min-height: 0; max-height: 220px; padding: 8px 0; white-space: pre; resize: none; }
  .gl-diff span { display: block; padding: 0 12px 0 0; min-height: 20px; }
  .gl-diff i { display: inline-block; width: 28px; text-align: center; font-style: normal; color: var(--m-text-3); user-select: none; }
  .gl-diff .add { background: color-mix(in srgb, var(--m-text) 9%, transparent); color: var(--m-text); }
  .gl-diff .add i { color: var(--m-text); }
  .gl-diff .del { color: var(--m-text-3); background: color-mix(in srgb, var(--m-text) 3%, transparent); }
  .gl-diff .ctx { color: var(--m-text-2); }
  .gl-diff .skip { color: var(--m-text-3); padding-left: 28px; font-style: italic; }
  .gl-hist { margin: 12px 0 0; font-size: var(--m-text-sm); }
`; }
