// Show me once (64-show-once.js): the recording strip and the steps in the
// bar. Buttons, key caps, the focus ring and .sr come from 99-css.js and
// 98-bar-css.js; tokens from design/tokens.css only. 4px grid, 28px rows.
function SHOW_ONCE_CSS() { return `
  /* ---- the strip while recording: the bar's glass, in the bottom right corner (top right when in the way) */
  .so-strip { position: fixed; right: 16px; bottom: 16px; width: min(400px, calc(100vw - 32px)); pointer-events: auto;
    background: var(--m-overlay); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
    color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: so-rise var(--m-med) var(--m-ease); }
  .so-strip.top { bottom: auto; top: 16px; }
  @keyframes so-rise { from { transform: translateY(6px); opacity: 0 } }
  .so-head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; }
  .so-head b { font-weight: 550; white-space: nowrap; }
  .so-head .btn svg { margin-left: -4px; }
  .so-dot { flex: none; width: 8px; height: 8px; margin-right: 2px; border-radius: 50%; background: var(--m-text); box-shadow: 0 0 0 3px var(--m-focus); animation: so-blink 1.6s ease-in-out infinite; }
  @keyframes so-blink { 50% { opacity: .35; box-shadow: 0 0 0 1px var(--m-focus); } }
  .so-count { font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; color: var(--m-text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .so-sp { flex: 1; }
  .so-empty { margin: 0; padding: 12px 16px; border-top: 1px solid var(--m-line); color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 18px; }
  .so-foot { padding: 8px 16px; border-top: 1px solid var(--m-line); color: var(--m-text-3); font-size: var(--m-text-xs); line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ---- steps: a numbered list, the newest one lit */
  .so-steps { list-style: none; margin: 0; padding: 4px 8px; border-top: 1px solid var(--m-line); }
  .so-steps li { display: flex; align-items: center; gap: 12px; min-height: 28px; padding: 0 0 0 8px; border-radius: var(--m-r-sm); }
  .so-steps li:hover { background: var(--m-hover); }
  .so-n { flex: none; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 4px; border-radius: 10px; background: var(--m-raised);
    border: 1px solid var(--m-line-strong); color: var(--m-text-2); font: 500 var(--m-text-xs)/1 var(--m-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .so-w { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .so-hid { color: var(--m-text-3); font: 500 var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; }
  .so-last .so-n { background: var(--m-primary); border-color: var(--m-primary); color: var(--m-primary-text); }
  .so-strip .so-last { animation: so-in var(--m-med) var(--m-ease); }
  @keyframes so-in { from { opacity: 0; transform: translateY(4px); } }
  .so-more { color: var(--m-text-3); font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; padding-left: 40px !important; }
  .so-more:hover { background: none !important; }
  .so-rm { opacity: 0; color: var(--m-text-3); }
  li:hover > .so-rm, .so-rm:focus-visible { opacity: 1; }

  /* ---- in the bar after Stop: the steps above the input */
  .so-card { border-bottom: 1px solid var(--m-line); }
  .so-ch { display: flex; align-items: center; gap: 8px; padding: 8px 8px 0 16px; }
  /* five and a half rows: a sixth step peeks out, so the list reads as one that scrolls */
  .so-card .so-steps { border-top: 0; padding: 4px 8px 8px; max-height: 158px; overflow: auto; scrollbar-width: thin; }

  /* ---- the way in, beside the suggestions */
  .sug.so-sug { gap: 6px; padding-left: 8px; margin-left: 4px; position: relative; }
  .sug.so-sug::before { content: ""; position: absolute; left: -7px; top: 6px; bottom: 6px; width: 1px; background: var(--m-line-strong); }
  .sug.so-sug svg { color: var(--m-text-2); }
  .sug.so-sug + .gl-sug::before { display: none; }
  .sug.so-sug + .gl-sug { margin-left: 0; }

  @media (max-width: 560px) { .so-strip { left: 16px; width: auto; } .so-foot { display: none; } }
  @media (prefers-reduced-motion: reduce) { .so-strip, .so-dot, .so-last { animation: none !important; } }
`; }
