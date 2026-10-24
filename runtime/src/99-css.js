// Styles for everything inside the shadow root. Every value comes from
// design/tokens.css (injected as TOKENS_CSS), so the overlay reskins with it.
// Geometry: 4px grid; controls are 24 (inline), 28 (buttons), 32 (the bar's
// input row); radii are the tokens' 6/10/14 (4 for kbd/tags, round for the
// switch). docs/ui/CHECKLIST.md lists the rules; `npm run ui` checks them.
function CSS() { return `
  :host { all: initial; direction: ltr; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; cursor: pointer; color: inherit; margin: 0; }
  :focus-visible { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }

  /* the radar is still (the Morse mark) unless a model is working */
  .radar rect { animation: none; }
  .radar rect.c { opacity: 0.9; }
  .radar rect.o { opacity: 0.3; }
  .mark.live .radar rect.c, .hint .radar rect.c { animation: m-pulse 1.5s ease-in-out infinite both; }
  .mark.live .radar rect.o, .hint .radar rect.o { animation: m-pulse-dim 1.5s ease-in-out infinite both; }
  .mark { display: inline-flex; color: var(--m-text); flex: none; }

  .fx { position: fixed; display: none; pointer-events: none; border-radius: var(--m-r-md); }
  .hl, .sel { position: fixed; pointer-events: none; border-radius: var(--m-r-sm); transition: all 70ms var(--m-ease);
    outline: 1.5px solid var(--m-signal-4); outline-offset: 0; box-shadow: 0 0 0 4px var(--m-focus); background: color-mix(in srgb, var(--m-signal-4) 6%, transparent); }
  .sel { outline-style: dashed; box-shadow: none; }
  .hl span { position: absolute; left: -1.5px; top: -24px; max-width: calc(100vw - 8px); overflow: hidden; text-overflow: ellipsis;
    background: var(--m-signal-4); color: var(--m-text-inverse); font: 500 var(--m-text-xs)/12px var(--m-mono); padding: 4px 6px; border-radius: var(--m-r-sm); white-space: nowrap; letter-spacing: 0; }
  .hl span.inside { top: 4px; left: 4px; }
  .pulse { position: fixed; pointer-events: none; border-radius: var(--m-r-md); border: 1.5px solid var(--m-signal-4); animation: ping 900ms var(--m-ease) forwards; }
  @keyframes ping { 0% { box-shadow: 0 0 0 0 var(--m-focus); opacity: 1 } 100% { box-shadow: 0 0 0 16px transparent; opacity: 0 } }

  /* ---- command bar */
  .bar { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(680px, calc(100vw - 32px)); pointer-events: auto;
    background: var(--m-overlay); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
    color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: rise var(--m-med) var(--m-ease); }
  .bar.top { bottom: auto; top: 28px; }
  @keyframes rise { from { transform: translate(-50%, 6px); opacity: 0 } }
  .bar.working { border-color: var(--m-signal-2); }
  .bar.err { border-color: color-mix(in srgb, var(--m-danger) 60%, var(--m-line-strong)); }
  .row { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; }
  .row .mark { margin-right: 4px; }
  .in { flex: 1; min-width: 0; height: 32px; background: transparent; border: 0; outline: 0; color: var(--m-text); font: 450 var(--m-text-lg)/20px var(--m-font); letter-spacing: var(--m-tracking); padding: 6px 0; margin: 0; }
  .in::placeholder { color: var(--m-text-3); opacity: 1; }
  .in:disabled { color: var(--m-text-2); }
  .go { flex: none; width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border-radius: var(--m-r-sm); border: 0; background: var(--m-primary); color: var(--m-primary-text); transition: background var(--m-fast); }
  .go:hover { background: var(--m-primary-hover); }
  .chip { display: inline-flex; align-items: center; gap: 2px; height: 24px; max-width: 44%; flex: none; background: var(--m-raised); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); padding: 0 1px 0 8px; font: 500 var(--m-text-sm)/16px var(--m-mono); letter-spacing: 0; white-space: nowrap; }
  .chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .chip .x { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border: 0; border-radius: 4px; background: none; color: var(--m-text-3); font-size: 14px; line-height: 1; padding: 0; }
  .chip .x:hover { color: var(--m-text); background: var(--m-hover); }
  .status { display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 16px; border-top: 1px solid var(--m-line); font-size: var(--m-text-sm); line-height: 16px; color: var(--m-text-2); min-height: 40px; }
  /* one line that ends in an ellipsis, whatever it holds (hint, error, phase) */
  .hint { flex: 0 1 auto; min-width: 0; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint > .radar { vertical-align: -2px; margin-right: 8px; }
  .hint b { color: var(--m-text); font-weight: 500; } .hint i { color: var(--m-warn); font-style: normal; }
  /* the result: the title gives way, the timing stays */
  .hint:has(.ok) { display: flex; align-items: baseline; gap: 8px; }
  .hint .ok { color: var(--m-text); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .hint .ok + .dim { flex: none; }
  .ticker { flex: 1 1 0; min-width: 0; overflow: hidden; white-space: nowrap; font: 11.5px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 35%); mask-image: linear-gradient(90deg, transparent, #000 35%); }
  .actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; max-width: 100%; }
  .btn, .actions button, .panel button, .card button { background: transparent; color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm);
    height: 28px; padding: 0 10px; font: 500 var(--m-text-sm)/18px var(--m-font); white-space: nowrap; transition: background var(--m-fast), border-color var(--m-fast); }
  .actions button:hover, .panel button:hover, .card button:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  button.primary { background: var(--m-primary) !important; border-color: var(--m-primary) !important; color: var(--m-primary-text) !important; }
  button.primary:hover { background: var(--m-primary-hover) !important; }
  .actions em { font-style: normal; color: var(--m-text-3); margin-left: 4px; font-variant-numeric: tabular-nums; }
  .model { font: 11px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; min-width: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ms { font: 500 var(--m-text-sm)/16px var(--m-mono); color: var(--m-text-2); font-variant-numeric: tabular-nums; letter-spacing: 0; }
  kbd { font: 10.5px/12px var(--m-mono); background: var(--m-raised); border: 1px solid var(--m-line-strong); border-radius: 4px; padding: 1px 4px; color: var(--m-text-2); }
  button.primary kbd { background: transparent; border-color: color-mix(in srgb, var(--m-primary-text) 25%, transparent); color: inherit; opacity: .7; margin-left: 4px; }
  .dim { color: var(--m-text-3); }
  /* phone width: the status line wraps, actions go to their own row */
  @media (max-width: 560px) {
    .status { flex-wrap: wrap; row-gap: 4px; }
    .hint { flex: 1 1 100%; }
    .hint:empty { display: none; }
    .model { max-width: 140px; }
  }

  /* ---- mods panel */
  .panel { position: fixed; top: 12px; right: 12px; bottom: 12px; width: 372px; max-width: calc(100vw - 24px); pointer-events: auto; display: flex; flex-direction: column;
    background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: slide var(--m-med) var(--m-ease); }
  @keyframes slide { from { transform: translateX(12px); opacity: 0 } }
  .panel header { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--m-line); }
  .panel header div { flex: 1; min-width: 0; } .panel header b { font-size: var(--m-text-lg); line-height: 20px; font-weight: 600; display: block; }
  .panel header small { display: block; color: var(--m-text-3); font: 11px/16px var(--m-mono); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel header button, .card header button { flex: none; width: 28px; height: 28px; padding: 0; display: grid; place-items: center; border: 0 !important; background: none !important; font-size: 18px; line-height: 1; color: var(--m-text-3); border-radius: var(--m-r-sm); }
  .panel header button:hover, .card header button:hover { color: var(--m-text); background: var(--m-hover) !important; }
  .list { flex: 1; overflow: auto; padding: 8px; }
  .list article { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 12px; padding: 12px; border-radius: var(--m-r-md); margin-bottom: 4px; transition: background var(--m-fast); }
  .list article:hover { background: var(--m-raised); }
  .meta { min-width: 0; overflow-wrap: anywhere; }
  .meta b { display: block; font-size: var(--m-text-md); line-height: 20px; font-weight: 550; } .meta small { color: var(--m-text-2); display: block; font-size: var(--m-text-sm); line-height: 16px; margin-top: 2px; }
  /* a disabled mod reads as off, but stays readable (AA) */
  .list article.off .meta b { color: var(--m-text-2); } .list article.off .meta small, .list article.off .tags span { color: var(--m-text-3); }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; } .tags span { font: 10.5px/16px var(--m-mono); color: var(--m-text-2); border: 1px solid var(--m-line-strong); border-radius: 4px; padding: 0 5px; letter-spacing: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btns { grid-column: 2; display: flex; gap: 2px; margin: 8px 0 0 -8px; }
  .panel .btns button { border: 0; color: var(--m-text-3); height: 24px; padding: 0 8px; }
  .panel .btns button:hover { color: var(--m-text); background: var(--m-hover); }
  .empty { color: var(--m-text-2); text-align: center; padding: 48px 24px; line-height: 24px; margin: 0; }
  .empty .radar { color: var(--m-text-3); margin-bottom: 12px; }
  .panel footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px 10px 16px; border-top: 1px solid var(--m-line); font: 11px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .panel footer span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel footer button { flex: none; }
  .sw { position: relative; width: 32px; height: 20px; margin-top: 0; } .sw input { opacity: 0; width: 0; height: 0; position: absolute; margin: 0; }
  .sw span { position: absolute; inset: 0; background: var(--m-line-strong); border-radius: 10px; transition: var(--m-fast); cursor: pointer; }
  .sw span::after { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--m-text-2); transition: var(--m-fast) var(--m-ease); }
  .sw:hover span { background: var(--m-signal-1); }
  .sw input:checked + span { background: var(--m-primary); } .sw input:checked + span::after { transform: translateX(12px); background: var(--m-primary-text); }
  .sw:hover input:checked + span { background: var(--m-primary-hover); }
  .sw input:focus-visible + span { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }

  /* ---- keep iterating (70-panel.js): search, rows you can move through,
     versions, and the "not working" note with Fix it */
  .psearch { padding: 8px 8px 0; }
  .psearch .search { display: block; width: 100%; height: 32px; margin: 0; padding: 0 12px; background: var(--m-bg); color: var(--m-text); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-sm); font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking); outline: 0; -webkit-appearance: none; appearance: none; }
  .psearch .search::placeholder { color: var(--m-text-3); opacity: 1; }
  .psearch .search:focus { border-color: var(--m-signal-2); }
  .list article { outline: none; }
  .list article:focus-visible { background: var(--m-raised); box-shadow: inset 0 0 0 1.5px var(--m-signal-3); }
  .meta small.latest { color: var(--m-text-3); }
  .tags .when { font: 400 var(--m-text-xs)/16px var(--m-font); font-style: normal; color: var(--m-text-3); letter-spacing: 0; white-space: nowrap; }
  /* a follow-up is typed: Enter refines, so Keep loses its ↵ */
  .bar.refining .actions [data-a=keep] kbd { display: none; }
  .panel .btns { flex-wrap: wrap; row-gap: 2px; }
  .panel .btns em { font: 10.5px/16px var(--m-mono); font-style: normal; color: var(--m-text-3); margin-left: 2px; letter-spacing: 0; }
  .health { grid-column: 2; display: flex; align-items: center; gap: 12px; margin-top: 10px; padding: 8px 8px 8px 12px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: var(--m-bg); }
  .health p { flex: 1; min-width: 0; margin: 0; font-size: var(--m-text-sm); line-height: 16px; color: var(--m-text-2); overflow-wrap: anywhere; }
  .health b { color: var(--m-text); font-weight: 600; }
  .health b::before { content: ""; display: inline-block; width: 6px; height: 6px; margin: 0 7px 1px 0; border-radius: 1.5px; background: var(--m-danger); vertical-align: middle; }
  .panel .health button { flex: none; height: 24px; padding: 0 10px; }
  .versions { grid-column: 2; list-style: none; margin: 8px 0 0 -8px; padding: 4px; border: 1px solid var(--m-line); border-radius: var(--m-r-sm); }
  .versions li { margin: 0; }
  .versions li.cur, .panel .versions button { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; width: 100%; height: auto; padding: 4px 6px;
    border: 0; border-radius: 4px; text-align: left; font: 400 var(--m-text-sm)/16px var(--m-font); letter-spacing: var(--m-tracking); white-space: normal; }
  .panel .versions button:hover { background: var(--m-hover); }
  .versions .vn { font: 10.5px/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .versions .vp { color: var(--m-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .versions .vt { font: 11px/16px var(--m-font); color: var(--m-text-3); white-space: nowrap; letter-spacing: 0; }
  .versions li.cur .vp, .panel .versions button:hover .vp { color: var(--m-text); }
  .versions li.cur .vn { color: var(--m-text); }
  .vhint { grid-column: 2; margin: 6px 0 0; font-size: var(--m-text-xs); line-height: 16px; color: var(--m-text-3); }

  /* ---- modals */
  .modal { position: fixed; inset: 0; background: var(--m-scrim); display: flex; align-items: center; justify-content: center; pointer-events: auto; animation: fade var(--m-fast); }
  @keyframes fade { from { opacity: 0 } }
  .card { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow: auto; background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-lg); padding: 20px; font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); box-shadow: var(--m-shadow); animation: rise2 var(--m-med) var(--m-ease); }
  .card header { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: start; margin-bottom: 16px; }
  .card header b { font-size: var(--m-text-xl); line-height: 28px; font-weight: 600; overflow-wrap: anywhere; } .card header small { grid-row: 2; color: var(--m-text-2); margin-top: 4px; overflow-wrap: anywhere; }
  .card header button { grid-row: 1; grid-column: 2; margin: 0 -4px 0 0; }
  .card label { display: block; font: 500 var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); margin: 16px 0 8px; text-transform: uppercase; letter-spacing: .06em; }
  .card label .dim, .card label code { text-transform: none; letter-spacing: 0; font: inherit; }
  .code { display: block; width: 100%; min-height: 128px; background: var(--m-bg); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); padding: 12px; margin: 0;
    font: 12px/20px var(--m-mono); letter-spacing: 0; resize: vertical; outline: 0; white-space: pre; overflow: auto; }
  .code[data-k="src"] { white-space: pre-wrap; word-break: break-all; }
  .code::placeholder { color: var(--m-text-3); opacity: 1; }
  .code:focus { border-color: var(--m-signal-2); }
  .code:focus-visible { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }
  .card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .cardimg { width: 100%; border-radius: var(--m-r-md); border: 1px solid var(--m-line); display: block; }
  .link { display: flex; gap: 8px; margin-top: 12px; } .link input { flex: 1; min-width: 0; height: 28px; margin: 0; background: var(--m-bg); color: var(--m-text-2); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); padding: 0 10px; font: 12px/18px var(--m-mono); letter-spacing: 0; text-overflow: ellipsis; outline: 0; }
  .link input:focus-visible { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }
  .exports { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .saved { margin: 12px 0 0; font: 11px/16px var(--m-mono); }
  .saved:empty { display: none; }

  .toast { position: fixed; left: 20px; bottom: 20px; max-width: min(480px, calc(100vw - 40px)); pointer-events: none; display: flex; align-items: flex-start; gap: 10px; background: var(--m-surface); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); padding: 9px 14px 9px 12px; font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking);
    box-shadow: var(--m-shadow); animation: rise2 var(--m-med) var(--m-ease); }
  .toast .radar { flex: none; color: var(--m-text-2); margin-top: 4px; }
  .toast span { min-width: 0; overflow-wrap: anywhere; }
  @keyframes rise2 { from { transform: translateY(6px); opacity: 0 } }

  /* reduced motion: nothing slides, pulses or sweeps; state changes are instant */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
    .mark.live .radar rect, .hint .radar rect { animation: none !important; }
    .mark.live .radar rect.c, .hint .radar rect.c { opacity: 1; }
    .mark.live .radar rect.o, .hint .radar rect.o { opacity: 0.55; }
  }
`; }
