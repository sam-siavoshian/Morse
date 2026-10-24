// Styles for God mode (45-godmode.js, 46-quick.js, 47-capture.js). The
// toolbar's buttons are .ibtn, the popovers and menu are the shared .pop /
// .menu surfaces, tabs and weights are .seg, the hex/size/note inputs are
// .field, tooltips are .tip (all in 99-css.js). This file only lays them out.
// Tokens only; 4px grid, 1px lines, 16px icons with 1.5px strokes.
// Concatenated into the shadow root's <style> by a hook in 10-dom.js.
function GOD_CSS() { return `
  /* the edit frame replaces the dashed selection box, except the still
     "working" outline (Effects: Subtle, the reduced-motion default) */
  :host([data-gm]) .sel:not(.busy) { display: none !important; }
  .gm { position: fixed; inset: 0; pointer-events: none; font: 400 var(--m-text-sm)/1.4 var(--m-font); letter-spacing: var(--m-tracking); color: var(--m-text); }
  /* a sheet open in the bar covers the page: the edit UI steps aside */
  .bar.has-pane ~ .gm { display: none; }

  /* ---- selection frame, resize handles, readout */
  .gm-frame { position: fixed; left: 0; top: 0; border: 1px solid var(--m-signal-4); border-radius: 2px; pointer-events: none;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--m-bg) 55%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--m-bg) 35%, transparent); }
  .gm-frame i { position: absolute; display: none; width: 8px; height: 8px; margin: -4.5px 0 0 -4.5px; background: var(--m-surface);
    border: 1px solid var(--m-signal-4); border-radius: 2px; pointer-events: auto; box-shadow: 0 1px 2px color-mix(in srgb, var(--m-bg) 40%, transparent); }
  .gm-frame[data-tool="resize"] i { display: block; }
  .gm-frame i[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; }      .gm-frame i[data-h="n"] { left: 50%; top: 0; cursor: ns-resize; }
  .gm-frame i[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; }   .gm-frame i[data-h="e"] { left: 100%; top: 50%; cursor: ew-resize; }
  .gm-frame i[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; } .gm-frame i[data-h="s"] { left: 50%; top: 100%; cursor: ns-resize; }
  .gm-frame i[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; }   .gm-frame i[data-h="w"] { left: 0; top: 50%; cursor: ew-resize; }
  .gm-frame[data-tool="move"] { pointer-events: auto; cursor: move; background: color-mix(in srgb, var(--m-signal-4) 5%, transparent); }
  .gm-frame[data-tool="text"] { border-style: dashed; }
  /* the readout is the picker's label (99-css.js), centered under the frame */
  .gm-read { position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); white-space: pre; }
  .gm-read.in { top: auto; bottom: 8px; }

  .gm-svgtext { position: fixed; left: 0; top: 0; padding: 0 8px; pointer-events: auto; box-shadow: var(--m-shadow);
    font: 450 var(--m-text-md)/16px var(--m-font); letter-spacing: var(--m-tracking); }

  /* ---- the edit toolbar: tag, then 32px .ibtn tools in groups */
  .gm-tb { position: fixed; left: 0; top: 0; display: flex; align-items: center; gap: 2px; height: 40px; padding: 3px; pointer-events: auto; outline: none; }
  .gm-tb:focus-within { border-color: var(--m-signal-2); }
  .gm-tag { max-width: 136px; padding-block: 0; padding-inline: 8px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 500 var(--m-text-xs)/28px var(--m-mono); letter-spacing: 0; color: var(--m-text-3); }
  .gm-sep { flex: none; width: 1px; height: 16px; margin: 0 4px; background: var(--m-line-strong); }
  .gm-tb[data-side="below"] .tip, .bar.top .gm-qbtn .tip { bottom: auto; top: calc(100% + 8px); transform: translate(-50%, -2px); }
  .gm-tb[data-side="below"] :is(:hover, :focus-visible) > .tip, .bar.top .gm-qbtn:is(:hover, :focus-visible) > .tip { transform: translate(-50%, 0); }
  /* phone width: drop the tag and the group lines so eleven tools fit in one
     row (360px); narrower than that they wrap instead of running off screen */
  @media (max-width: 560px) {
    .gm-tb { flex-wrap: wrap; gap: 0; height: auto; max-width: calc(100vw - 16px); }
    .gm-tag, .gm-sep { display: none; }
  }

  /* ---- note (frames) and popovers */
  .gm-note { position: fixed; left: 0; top: 0; display: flex; gap: 8px; width: 300px; padding: 8px 12px; pointer-events: auto; color: var(--m-text-2); }
  .gm-note > svg { margin-top: 1px; color: var(--m-text-3); } .gm-note b { color: var(--m-text); font-weight: 500; }
  .gm-pop { position: fixed; left: 0; top: 0; width: 240px; padding: 12px; pointer-events: auto; }
  .gm-pop .seg { display: flex; }
  .gm-sw { display: grid; grid-template-columns: repeat(8, 20px); justify-content: space-between; row-gap: 8px; margin: 12px 0; }
  .gm-sw button { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: var(--c);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent); transition: box-shadow var(--m-fast); }
  .gm-sw button:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent), 0 0 0 2px var(--m-surface), 0 0 0 3px var(--m-line-strong); }
  .gm-sw button[aria-pressed="true"] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent), 0 0 0 2px var(--m-surface), 0 0 0 3px var(--m-text); }
  .gm-sw .none, .gm-hex i.none { background: linear-gradient(135deg, transparent calc(50% - .75px), var(--m-text-3) calc(50% - .75px) calc(50% + .75px), transparent calc(50% + .75px)), var(--m-surface); }
  .gm-hex { display: flex; align-items: center; gap: 8px; padding-block: 0; padding-inline: 8px 3px; }
  .gm-hex i { flex: none; width: 16px; height: 16px; border-radius: 4px; background: var(--c); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent); }
  .gm-hex input { flex: 1; }
  .gm-field { display: flex; align-items: center; justify-content: space-between; min-height: 32px; }
  .gm-step { display: flex; align-items: center; padding: 0 3px; color: var(--m-text-3); font: 500 var(--m-text-sm)/16px var(--m-mono); }
  .gm-step input { width: 32px; text-align: end; font-variant-numeric: tabular-nums; }
  .gm-step span { padding-block: 0; padding-inline: 2px 4px; }
  .gm-range { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 16px; margin: 8px 0 12px; background: transparent; cursor: pointer; border-radius: 4px; }
  .gm-range::-webkit-slider-runnable-track { height: 2px; border-radius: 1px; background: linear-gradient(90deg, var(--m-text) var(--p, 0%), var(--m-line-strong) var(--p, 0%)); }
  .gm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -5px; border-radius: 50%; background: var(--m-surface); border: 1px solid var(--m-text); }
  .gm-weights { margin-top: 4px; } .gm-weights button { padding: 0 2px; font-size: var(--m-text-xs); }

  /* ---- capture */
  .gm-pop-capture { width: 280px; }
  .gm-cap-shot { display: grid; place-items: center; height: 112px; overflow: hidden; border-radius: var(--m-r-sm); background: var(--m-raised); border: 1px solid var(--m-line); }
  .gm-cap-shot img { display: block; width: 100%; height: 100%; object-fit: contain; }
  :host([data-page-inverted]) :is(.gm-cap-shot, .gm-chip) img { filter: invert(1) hue-rotate(180deg); }
  .gm-cap-shot .gm-ph { display: grid; color: var(--m-text-3); }
  .gm-cap-meta { display: flex; flex-direction: column; gap: 2px; margin: 12px 0 8px; }
  .gm-cap-meta b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-cap-meta small { font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; color: var(--m-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-cap-note { display: block; width: 100%; padding: 0 8px; font: 400 var(--m-text-sm)/16px var(--m-font); letter-spacing: var(--m-tracking); }
  .gm-cap-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; color: var(--m-text-3); font-size: var(--m-text-xs); line-height: 16px; }
  .gm-cap-foot button { flex: none; padding-inline-end: 6px; }

  /* ---- page tools: the bar button (.ibtn) and its .menu */
  .gm-menu { inset-inline-end: 8px; bottom: calc(100% + 8px); }
  .bar.top .gm-menu { bottom: auto; top: calc(100% + 8px); }
  .gm-menu .gm-state { margin-inline-start: auto; display: inline-flex; color: var(--m-text-2); font: 500 var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; }
  .gm-menu .gm-state svg { color: var(--m-text); }

  /* ---- clipboard chips in the bar, on its 16px inset */
  .gm-clips { display: flex; align-items: center; gap: 12px; padding-block: 0 8px; padding-inline: 16px 8px; min-width: 0; }
  .gm-clips-l { flex: none; }
  .gm-chips { display: flex; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .gm-chips::-webkit-scrollbar { display: none; }
  .gm-chip { flex: none; display: inline-flex; align-items: center; gap: 8px; max-width: 232px; height: 32px; padding-block: 0; padding-inline: 3px 12px; text-align: start;
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-raised); color: var(--m-text); transition: border-color var(--m-fast), background var(--m-fast); }
  .gm-chip:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  .gm-chip[aria-pressed="true"] { border-color: var(--m-text); background: var(--m-surface); }
  .gm-chip img, .gm-chip .gm-ph { flex: none; width: 40px; height: 24px; border-radius: 4px; object-fit: cover; object-position: left center; background: var(--m-hover); }
  .gm-chip .gm-ph { display: grid; place-items: center; color: var(--m-text-3); }
  .gm-chip span:not(.gm-ph) { display: flex; flex-direction: column; min-width: 0; }
  .gm-chip b { font: 500 var(--m-text-sm)/14px var(--m-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-chip small { font: 10.5px/12px var(--m-mono); letter-spacing: 0; color: var(--m-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`; }
