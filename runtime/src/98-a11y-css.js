// Styles for Easier to use (65-a11y.js, 66-read-aloud.js, 67-audit.js,
// 68-describe.js): the menu group, the Read aloud card and its sentence mark,
// the Check this page list, the Describe card. Tokens only, monochrome like
// the rest; joined into the overlay's <style> by a hook in 10-dom.js.
function A11Y_CSS() { return `
  /* ---- "Easier to use": a second .menu beside the page tools menu (rows, header, focus all shared) */
  .gm-menu .a11y-group { inset-inline-end: calc(100% + 8px); bottom: -1px; width: 264px; animation: none; }
  .bar.top .gm-menu .a11y-group { bottom: auto; top: -1px; }
  .gm-menu .a11y-group header small { color: var(--m-text-3); }
  .gm-menu .a11y-sub { height: 28px; padding-inline-start: 36px; color: var(--m-text-2); font-size: var(--m-text-sm); }
  .gm-menu .a11y-sub:hover, .gm-menu .a11y-sub:focus-visible { color: var(--m-text); }
  .gm-menu [aria-checked="true"] > span:not(.gm-state) { color: var(--m-text); font-weight: 500; }
  @media (max-width: 620px) {
    .gm-menu { max-height: min(70vh, 560px); overflow-y: auto; }
    .gm-menu .a11y-group { position: static; width: auto; margin-top: 4px; padding: 4px 0 0; border: 0; border-top: 1px solid var(--m-line); border-radius: 0; box-shadow: none; }
  }

  /* ---- edit toolbar extras */
  .gm-tb .a11y-tb[hidden] { display: none !important; }

  /* ---- Read aloud: the mark on the sentence being read, and the card */
  .ra-layer { position: fixed; inset: 0; pointer-events: none; }
  .ra-layer i { position: fixed; left: 0; top: 0; border-radius: 4px; background: color-mix(in srgb, var(--m-signal-4) 18%, transparent);
    box-shadow: inset 0 -2px 0 var(--m-signal-4); transition: transform 90ms var(--m-ease), width 90ms var(--m-ease); }
  .ra { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px;
    width: max-content; max-width: calc(100vw - 16px); pointer-events: auto; background: var(--m-overlay); color: var(--m-text);
    backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.4 var(--m-font); letter-spacing: var(--m-tracking); animation: fade var(--m-fast); }
  /* the buttons are the shared .ibtn (32) and .btn; play is the one primary, round */
  .ra .ra-main { border-radius: 50%; background: var(--m-primary); color: var(--m-primary-text); margin-inline-end: 4px; }
  .ra .ra-main:hover:not(:disabled) { background: var(--m-primary-hover); color: var(--m-primary-text); }
  .ra-text { display: flex; flex-direction: column; min-width: 128px; padding-block: 0; padding-inline: 8px 12px; }
  .ra-text b { font-weight: 500; font-size: var(--m-text-md); line-height: 18px; }
  .ra-text small { color: var(--m-text-3); font: 11px/16px var(--m-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .ra .ra-rate { min-width: 48px; padding: 0 8px; font: 500 var(--m-text-sm)/16px var(--m-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; }

  /* ---- Check this page: the list in the bar */
  .bar.has-audit .sugs { display: none !important; }
  .au { min-height: 0; overflow: auto; max-height: min(52vh, 420px); border-top: 1px solid var(--m-line); padding: 12px 16px; scrollbar-width: thin; animation: fade var(--m-fast); }
  .au-head { display: flex; align-items: center; gap: 8px; margin-block: -2px 8px; margin-inline: 0 -8px; min-height: 24px; }
  .au-k { flex: none; white-space: nowrap; }
  .au-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--m-text-2); font-size: var(--m-text-sm); }
  .au-again { flex: none; margin-inline-start: auto; }
  .au-list { list-style: none; margin: 0; padding: 0; }
  .au-item { display: flex; align-items: center; gap: 16px; padding: 8px 0; border-top: 1px solid var(--m-line); }
  .au-item:first-child { border-top: 0; padding-top: 2px; }
  .au-main { flex: 1; min-width: 0; }
  .au-main b { display: block; color: var(--m-text); font: 500 var(--m-text-lg)/21px var(--m-font); }
  .au-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 2px; }
  .au-sub small { color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 18px; }
  .au-marks { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .au-marks .ask-n { margin: 0; height: 20px; min-width: 20px; border-radius: 10px; font-size: 10.5px; }
  /* Fix it is a plain .btn; what it will do sits under it */
  .au-act { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 112px; }
  .au-act small { color: var(--m-text-3); font: 400 var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; white-space: nowrap; }
  .au-ok { margin: 0; color: var(--m-text-2); font-size: var(--m-text-md); }

  /* ---- Describe this picture */
  .ds-ring { position: fixed; left: 0; top: 0; pointer-events: none; border-radius: var(--m-r-sm); outline: 2px solid var(--m-signal-4); box-shadow: 0 0 0 5px var(--m-focus); }
  .ds { position: fixed; left: 0; top: 0; width: min(360px, calc(100vw - 16px)); padding: 12px; pointer-events: auto;
    background: var(--m-overlay); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
    color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: fade var(--m-fast); }
  .ds-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-block: -2px 8px; margin-inline: 0 -4px; }
  .ds-k { display: inline-flex; align-items: center; gap: 8px; color: var(--m-text-3); font: 500 var(--m-text-xs)/16px var(--m-mono); letter-spacing: .06em; text-transform: uppercase; }
  .ds-k svg { color: var(--m-text-2); }

  .ds-text { margin: 0; color: var(--m-text); font-size: var(--m-text-lg); line-height: 23px; }
  .ds-text.busy { color: var(--m-text-2); }
  .ds-err { margin: 0; color: var(--m-text-2); } .ds-err i { color: var(--m-warn); font-style: normal; }
  .ds-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .ds-foot small { min-width: 0; margin-inline-start: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--m-text-3); font-size: var(--m-text-xs); }

  @media (prefers-reduced-motion: reduce) { .ra, .ra-layer i, .au, .ds { animation: none !important; transition: none !important; } }
`; }
