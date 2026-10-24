// Styles for Ask and find (61-ask.js, 62-markers.js): the answer card in the
// bar, the numbered markers on the page, and the Show me guide. Tokens only,
// monochrome like the rest; joined into the overlay's <style> by 10-dom.js.
function ASK_CSS() { return `
  /* ---- the answer card, between the input row and the status line */
  .bar.has-answer .sugs { display: none !important; } /* the answer is what matters now */
  .ask { min-height: 0; overflow: auto; max-height: min(46vh, 380px); border-top: 1px solid var(--m-line); padding: 12px 16px 12px;
    scrollbar-width: thin; animation: fade var(--m-fast); }
  .ask-head { display: flex; align-items: center; gap: 8px; margin-block: -2px 8px; margin-inline: 0 -8px; min-height: 24px; }
  .ask-q { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--m-text-2); font: 500 var(--m-text-sm)/16px var(--m-font); }
  .ask-q::before { content: "Q"; display: inline-block; margin-inline-end: 8px; padding: 0 4px; border: 1px solid var(--m-line-strong); border-radius: 4px; font: 600 10px/14px var(--m-mono); color: var(--m-text-3); vertical-align: 1px; }
  .ask-ctx { flex: none; font: 11px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .ask-new { flex: none; margin-inline-start: auto; height: 24px; padding: 0 8px; border: 0; border-radius: var(--m-r-sm); background: none; color: var(--m-text-3); font: 500 var(--m-text-xs)/16px var(--m-font); }
  .ask-new:hover { color: var(--m-text); background: var(--m-hover); }
  .ask-new + .ask-x { margin-inline-start: 0; }
  .ask-x { flex: none; margin-inline-start: auto; width: 24px; height: 24px; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--m-r-sm); background: none; color: var(--m-text-3); font-size: 16px; line-height: 1; }
  .ask-x:hover { color: var(--m-text); background: var(--m-hover); }

  .ask-body { color: var(--m-text); font: 400 var(--m-text-lg)/23px var(--m-font); letter-spacing: var(--m-tracking); max-width: 64ch; overflow-wrap: anywhere; }
  .ask-body p { margin: 0 0 8px; }
  .ask-body ul, .ask-body ol { margin: 0 0 8px; padding-inline-start: 22px; }
  .ask-body li { margin: 2px 0; padding-inline-start: 2px; }
  .ask-body li::marker { color: var(--m-text-3); font-variant-numeric: tabular-nums; }
  .ask-body > :last-child { margin-bottom: 0; }
  .ask-body b { font-weight: 600; }
  .ask-body i { font-style: italic; }
  .ask-body code { font: 12.5px/1 var(--m-mono); letter-spacing: 0; background: var(--m-raised); border: 1px solid var(--m-line); border-radius: 4px; padding: 1px 4px; }
  .ask-body pre { margin: 0 0 8px; padding: 8px 12px; background: var(--m-raised); border: 1px solid var(--m-line); border-radius: var(--m-r-sm); overflow: auto; }
  .ask-body pre code { background: none; border: 0; padding: 0; font-size: 12px; line-height: 18px; white-space: pre; }
  .ask-ref, .ask-n { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 0; vertical-align: 1px;
    background: var(--m-primary); color: var(--m-primary-text); font: 600 11px/1 var(--m-mono); letter-spacing: 0; cursor: pointer; margin: 0 1px; }
  .ask-ref:hover { background: var(--m-primary-hover); }
  .ask-caret { display: inline-block; width: 7px; height: 15px; margin-inline-start: 2px; vertical-align: -2px; background: var(--m-text-2); animation: m-pulse 1s steps(2) infinite; }

  .ask-marks { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; padding: 0; }
  .ask-marks button { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; height: 28px; padding-block: 0; padding-inline: 5px 10px; background: transparent; color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); font: 500 var(--m-text-sm)/16px var(--m-font); transition: background var(--m-fast), border-color var(--m-fast); }
  .ask-marks button:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  .ask-marks .ask-n { cursor: inherit; margin: 0; }
  .ask-marks .ask-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ask-marks small { color: var(--m-text-3); font-size: var(--m-text-xs); white-space: nowrap; }
  .ask-marks .away .ask-n { background: transparent; color: var(--m-text-2); box-shadow: inset 0 0 0 1px var(--m-line-strong); }

  .ask-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .ask-foot button { height: 28px; padding: 0 10px; border-radius: var(--m-r-sm); border: 1px solid var(--m-line-strong); background: transparent; color: var(--m-text);
    font: 500 var(--m-text-sm)/18px var(--m-font); white-space: nowrap; transition: background var(--m-fast), border-color var(--m-fast); }
  .ask-foot button:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  .ask-foot button small { margin-inline-start: 8px; font: 500 10.5px/1 var(--m-mono); opacity: .7; letter-spacing: 0; }
  .ask-tip { min-width: 0; color: var(--m-text-3); font-size: var(--m-text-sm); line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---- markers on the page */
  .mk-layer { position: fixed; inset: 0; pointer-events: none; }
  .mk-ring { position: fixed; border-radius: var(--m-r-sm); outline: 2px solid var(--m-signal-4); outline-offset: 0;
    box-shadow: 0 0 0 5px var(--m-focus); background: color-mix(in srgb, var(--m-signal-4) 5%, transparent); }
  .mk-ring.ping { animation: ping 900ms var(--m-ease); }
  .mk-badge { position: fixed; left: 0; top: 0; display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px;
    background: var(--m-primary); color: var(--m-primary-text); border: 2px solid var(--m-surface); box-shadow: var(--m-shadow);
    font: 700 12px/1 var(--m-mono); letter-spacing: 0; pointer-events: auto; cursor: pointer; transition: background var(--m-fast); }
  .mk-badge:hover { background: var(--m-primary-hover); }
  .mk-badge[data-dir=up]::after { content: "↑"; margin-inline-start: 3px; font-weight: 500; }
  .mk-badge[data-dir=down]::after { content: "↓"; margin-inline-start: 3px; font-weight: 500; }
  /* Show me: one step, everything else dimmed (clicks still go through) */
  .mk-layer.focus .mk-ring { outline-width: 2.5px; box-shadow: 0 0 0 9999px var(--m-scrim); background: transparent; animation: mk-breathe 1.6s var(--m-ease) infinite; }
  @keyframes mk-breathe { 50% { outline-offset: 3px; } }

  /* ---- Show me guide */
  .guide { position: fixed; left: 0; top: 0; width: min(340px, calc(100vw - 16px)); pointer-events: auto; padding: 12px;
    background: var(--m-overlay); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
    color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); transition: transform 180ms var(--m-ease); }
  .g-row { display: flex; align-items: flex-start; gap: 12px; }
  .g-n { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 12px; background: var(--m-primary); color: var(--m-primary-text); font: 700 12px/1 var(--m-mono); }
  .g-text { flex: 1; min-width: 0; padding-top: 2px; }
  .g-text b { display: block; font: 600 var(--m-text-lg)/20px var(--m-font); }
  .g-text small { display: block; margin-top: 2px; color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 16px; }
  .g-x { flex: none; width: 24px; height: 24px; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--m-r-sm); background: none; color: var(--m-text-3); font-size: 16px; line-height: 1; }
  .g-x:hover { color: var(--m-text); background: var(--m-hover); }
  .g-foot { display: flex; align-items: center; gap: 6px; margin-top: 12px; padding-inline-start: 36px; }
  .g-dots { flex: 1; display: flex; align-items: center; gap: 4px; }
  .g-dots span { margin-inline-start: 8px; color: var(--m-text-3); font: 11px/16px var(--m-mono); letter-spacing: 0; white-space: nowrap; }
  .g-dots i { width: 6px; height: 6px; border-radius: 3px; background: var(--m-signal-1); transition: width var(--m-med) var(--m-ease); }
  .g-dots i.past { background: var(--m-signal-3); }
  .g-dots i.now { width: 16px; background: var(--m-signal-4); }
  .g-foot button { height: 28px; padding: 0 10px; border-radius: var(--m-r-sm); border: 1px solid var(--m-line-strong); background: transparent; color: var(--m-text);
    font: 500 var(--m-text-sm)/18px var(--m-font); transition: background var(--m-fast); }
  .g-foot button:hover:not(:disabled) { background: var(--m-hover); }
  .g-foot button:disabled { color: var(--m-text-3); cursor: default; }
  @media (prefers-reduced-motion: reduce) { .ask, .mk-ring, .ask-caret, .guide { animation: none !important; transition: none !important; } }
`; }
