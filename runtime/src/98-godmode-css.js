// Styles for God mode (45-godmode.js, 46-quick.js, 47-capture.js). Tokens
// only (design/tokens.css); 4px grid, 1px lines, 16px icons with 1.5px strokes.
// Concatenated into the shadow root's <style> by a hook in 10-dom.js.
function GOD_CSS() { return `
  :host([data-gm]) .sel { display: none !important; }
  .gm { position: fixed; inset: 0; pointer-events: none; font: 400 var(--m-text-sm)/1.4 var(--m-font); letter-spacing: var(--m-tracking); color: var(--m-text); }
  .gm kbd, .gm-qbtn kbd { font: 500 10px/1 var(--m-mono); letter-spacing: 0; }

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
  .gm-read { position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); padding: 2px 6px; border-radius: 4px;
    background: var(--m-signal-4); color: var(--m-text-inverse); font: 500 11px/16px var(--m-mono); letter-spacing: 0; white-space: pre;
    font-variant-numeric: tabular-nums; }
  .gm-read.in { top: auto; bottom: 8px; }

  .gm-svgtext { position: fixed; left: 0; top: 0; height: 32px; padding: 0 8px; pointer-events: auto; border: 1px solid var(--m-signal-4); border-radius: var(--m-r-sm);
    background: var(--m-surface); color: var(--m-text); box-shadow: var(--m-shadow); outline: none; font: 450 var(--m-text-md)/1 var(--m-font); letter-spacing: var(--m-tracking); }

  /* ---- toolbar */
  .gm-tb { position: fixed; left: 0; top: 0; display: flex; align-items: center; gap: 2px; height: 40px; padding: 4px; pointer-events: auto;
    background: var(--m-surface); color: var(--m-text-2); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md);
    box-shadow: var(--m-shadow); outline: none; }
  .gm-tb:focus-within { border-color: color-mix(in srgb, var(--m-signal-2) 60%, var(--m-line-strong)); }
  .gm-tag { max-width: 136px; padding: 0 4px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 500 11px/28px var(--m-mono); letter-spacing: 0; color: var(--m-text-3); }
  .gm-tb button, .gm-qbtn { position: relative; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0;
    border-radius: var(--m-r-sm); background: transparent; color: var(--m-text-2); transition: background var(--m-fast), color var(--m-fast); }
  .gm-tb button:hover:not(:disabled), .gm-qbtn:hover { background: var(--m-hover); color: var(--m-text); }
  .gm-tb button[aria-pressed="true"] { background: var(--m-primary); color: var(--m-primary-text); }
  .gm-tb button:disabled { color: var(--m-text-3); opacity: .45; cursor: default; }
  .gm-tb button:focus-visible, .gm-qbtn:focus-visible { outline: 1px solid var(--m-signal-3); outline-offset: -1px; }
  .gm-sep { flex: none; width: 1px; height: 16px; margin: 0 4px; background: var(--m-line-strong); }

  /* ---- tooltips (name + shortcut), shown after a short hover */
  .gm-tip { position: absolute; left: 50%; bottom: calc(100% + 8px); z-index: 1; display: flex; align-items: center; gap: 8px; height: 24px;
    padding: 0 4px 0 8px; border-radius: var(--m-r-sm); background: var(--m-text); color: var(--m-text-inverse); white-space: nowrap;
    font: 500 var(--m-text-xs)/1 var(--m-font); letter-spacing: 0; pointer-events: none; opacity: 0; transform: translate(-50%, 2px);
    transition: opacity var(--m-fast), transform var(--m-fast); box-shadow: 0 4px 12px color-mix(in srgb, var(--m-bg) 30%, transparent); }
  .gm-tip:not(:has(kbd)) { padding-right: 8px; }
  .gm-tip kbd { height: 16px; min-width: 16px; padding: 0 4px; display: inline-grid; place-items: center; border: 0; border-radius: 4px;
    background: color-mix(in srgb, var(--m-text-inverse) 16%, transparent); color: inherit; }
  .gm-tb[data-side="below"] .gm-tip, .bar.top .gm-qbtn .gm-tip { bottom: auto; top: calc(100% + 8px); transform: translate(-50%, -2px); }
  :is(.gm-tb button, .gm-qbtn):is(:hover, :focus-visible) .gm-tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 300ms; }
  .gm-tb button:disabled .gm-tip { display: none; }

  /* ---- note (frames) and popovers */
  .gm-note { position: fixed; left: 0; top: 0; display: flex; gap: 8px; width: 300px; padding: 8px 12px; pointer-events: auto;
    background: var(--m-surface); color: var(--m-text-2); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); box-shadow: var(--m-shadow); }
  .gm-note svg { flex: none; margin-top: 2px; color: var(--m-text-3); } .gm-note b { color: var(--m-text); font-weight: 500; }
  .gm-pop { position: fixed; left: 0; top: 0; width: 240px; padding: 12px; pointer-events: auto; background: var(--m-surface); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); box-shadow: var(--m-shadow); }
  .gm-pop button { font: inherit; }
  .gm-seg { display: flex; gap: 2px; padding: 2px; background: var(--m-raised); border: 1px solid var(--m-line); border-radius: var(--m-r-sm); }
  .gm-seg button { flex: 1; height: 24px; padding: 0 4px; border: 0; border-radius: 4px; background: transparent; color: var(--m-text-2); font: 500 var(--m-text-sm)/1 var(--m-font); }
  .gm-seg button:hover { color: var(--m-text); }
  .gm-seg button[aria-pressed="true"] { background: var(--m-surface); color: var(--m-text); box-shadow: 0 0 0 1px var(--m-line-strong), 0 1px 2px color-mix(in srgb, var(--m-bg) 30%, transparent); }
  .gm-sw { display: grid; grid-template-columns: repeat(8, 20px); justify-content: space-between; row-gap: 8px; margin: 12px 0; }
  .gm-sw button { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: var(--c);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent); transition: box-shadow var(--m-fast); }
  .gm-sw button:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent), 0 0 0 2px var(--m-surface), 0 0 0 3px var(--m-line-strong); }
  .gm-sw button[aria-pressed="true"] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent), 0 0 0 2px var(--m-surface), 0 0 0 3px var(--m-text); }
  .gm-sw .none, .gm-hex i.none { background: linear-gradient(135deg, transparent calc(50% - .75px), var(--m-text-3) calc(50% - .75px) calc(50% + .75px), transparent calc(50% + .75px)), var(--m-surface); }
  .gm-hex { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 4px 0 8px; border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-sm); background: var(--m-bg); }
  .gm-hex:focus-within { border-color: var(--m-signal-2); }
  .gm-hex i { flex: none; width: 16px; height: 16px; border-radius: 4px; background: var(--c); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text) 18%, transparent); }
  .gm-hex input, .gm-step input, .gm-cap-note { min-width: 0; border: 0; outline: 0; background: transparent; color: var(--m-text); font: 500 12px/1 var(--m-mono); letter-spacing: 0; }
  .gm-hex input { flex: 1; }
  .gm-hex button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--m-text-2); }
  .gm-hex button:hover { background: var(--m-hover); color: var(--m-text); }
  .gm-field { display: flex; align-items: center; justify-content: space-between; height: 32px; }
  .gm-field label { font: 500 var(--m-text-xs)/1 var(--m-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--m-text-3); }
  .gm-step { display: flex; align-items: center; height: 32px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-bg); color: var(--m-text-3); font: 500 12px/1 var(--m-mono); }
  .gm-step:focus-within { border-color: var(--m-signal-2); }
  .gm-step input { width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
  .gm-step span { padding: 0 4px 0 2px; }
  .gm-step button { display: grid; place-items: center; width: 28px; height: 30px; padding: 0; border: 0; background: transparent; color: var(--m-text-2); }
  .gm-step button:hover { color: var(--m-text); }
  .gm-range { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 16px; margin: 8px 0 12px; background: transparent; cursor: pointer; }
  .gm-range::-webkit-slider-runnable-track { height: 2px; border-radius: 1px; background: linear-gradient(90deg, var(--m-text) var(--p, 0%), var(--m-line-strong) var(--p, 0%)); }
  .gm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -5px; border-radius: 50%; background: var(--m-surface); border: 1px solid var(--m-text); }
  .gm-weights { margin-top: 4px; } .gm-weights button { font-size: var(--m-text-xs); }

  /* ---- capture */
  .gm-pop-capture { width: 280px; }
  .gm-cap-shot { display: grid; place-items: center; height: 112px; overflow: hidden; border-radius: var(--m-r-sm); background: var(--m-raised); border: 1px solid var(--m-line); }
  .gm-cap-shot img { display: block; width: 100%; height: 100%; object-fit: contain; }
  :host([data-page-inverted]) :is(.gm-cap-shot, .gm-chip) img { filter: invert(1) hue-rotate(180deg); }
  .gm-cap-shot .gm-ph { color: var(--m-text-3); }
  .gm-cap-meta { display: flex; flex-direction: column; gap: 2px; margin: 12px 0 8px; }
  .gm-cap-meta b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-cap-meta small { font: 11px/1.3 var(--m-mono); letter-spacing: 0; color: var(--m-text-3); }
  .gm-cap-note { display: block; width: 100%; height: 32px; padding: 0 8px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-bg); font: 400 var(--m-text-sm)/1 var(--m-font); }
  .gm-cap-note:focus { border-color: var(--m-signal-2); }
  .gm-cap-note::placeholder { color: var(--m-text-3); }
  .gm-cap-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; color: var(--m-text-3); font-size: var(--m-text-xs); }
  .gm-cap-foot button { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 6px 0 10px; border: 1px solid; border-radius: var(--m-r-sm); font-weight: 500; }
  .gm-cap-foot button kbd { height: 16px; padding: 0 4px; display: inline-grid; place-items: center; border: 0; border-radius: 4px;
    background: color-mix(in srgb, var(--m-primary-text) 16%, transparent); color: inherit; }

  /* ---- page tools: button in the bar and its menu */
  .gm-qbtn { flex: none; width: 30px; height: 30px; border-radius: 8px; }
  .gm-qbtn[aria-expanded="true"] { background: var(--m-hover); color: var(--m-text); }
  .gm-menu { position: absolute; right: 8px; bottom: calc(100% + 8px); width: 248px; padding: 4px; background: var(--m-surface); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); box-shadow: var(--m-shadow); animation: fade var(--m-fast); }
  .bar.top .gm-menu { bottom: auto; top: calc(100% + 8px); }
  .gm-menu header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 8px 8px 4px;
    font: 500 var(--m-text-xs)/1 var(--m-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--m-text-3); }
  .gm-menu header small { font-size: var(--m-text-xs); letter-spacing: 0; text-transform: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-menu button { display: flex; align-items: center; gap: 12px; width: 100%; height: 32px; padding: 0 8px; border: 0; border-radius: var(--m-r-sm);
    background: transparent; color: var(--m-text); font: 450 var(--m-text-md)/1 var(--m-font); letter-spacing: var(--m-tracking); text-align: left; }
  .gm-menu button:hover, .gm-menu button:focus-visible { background: var(--m-hover); outline: none; }
  .gm-menu button > svg { flex: none; color: var(--m-text-2); }
  .gm-menu .gm-state { margin-left: auto; display: inline-flex; color: var(--m-text-2); font: 500 var(--m-text-xs)/1 var(--m-mono); letter-spacing: 0; }
  .gm-menu .gm-state svg { color: var(--m-text); }
  .gm-menu hr { height: 1px; margin: 4px; border: 0; background: var(--m-line); }

  /* ---- clipboard chips in the bar */
  .gm-clips { display: flex; align-items: center; gap: 12px; padding: 0 12px 12px 14px; min-width: 0; }
  .gm-clips-l { flex: none; font: 500 var(--m-text-xs)/1 var(--m-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--m-text-3); }
  .gm-chips { display: flex; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .gm-chips::-webkit-scrollbar { display: none; }
  .gm-chip { flex: none; display: inline-flex; align-items: center; gap: 8px; max-width: 232px; height: 36px; padding: 3px 12px 3px 3px; text-align: left;
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-raised); color: var(--m-text); transition: border-color var(--m-fast), background var(--m-fast); }
  .gm-chip:hover { background: var(--m-hover); }
  .gm-chip[aria-pressed="true"] { border-color: var(--m-text); background: var(--m-surface); }
  .gm-chip img, .gm-chip .gm-ph { flex: none; width: 40px; height: 28px; border-radius: 4px; object-fit: cover; object-position: left center; background: var(--m-hover); }
  .gm-chip .gm-ph { display: grid; place-items: center; color: var(--m-text-3); }
  .gm-chip span:not(.gm-ph) { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .gm-chip b { font: 500 var(--m-text-sm)/1.2 var(--m-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-chip small { font: 10.5px/1.2 var(--m-mono); letter-spacing: 0; color: var(--m-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`; }
