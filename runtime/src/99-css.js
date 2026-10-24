// Styles for everything inside the shadow root. Every value comes from
// design/tokens.css (injected as TOKENS_CSS), so the overlay reskins with it.
function CSS() { return `
  :host { all: initial; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; cursor: pointer; color: inherit; }
  .radar rect.c { animation: m-pulse 1.5s ease-in-out infinite both; }
  .radar rect.o { animation: m-pulse-dim 1.5s ease-in-out infinite both; }
  .mark { display: inline-flex; color: var(--m-text); flex: none; }
  .mark:not(.live) .radar rect { animation: none; }
  .mark:not(.live) .radar rect.c { opacity: 0.9; }
  .mark:not(.live) .radar rect.o { opacity: 0.3; }

  .fx { position: fixed; display: none; pointer-events: none; border-radius: 10px; }
  .hl, .sel { position: fixed; pointer-events: none; border-radius: var(--m-r-sm); transition: all 70ms var(--m-ease);
    outline: 1.5px solid var(--m-signal-4); outline-offset: 0; box-shadow: 0 0 0 4px var(--m-focus); background: color-mix(in srgb, var(--m-signal-4) 6%, transparent); }
  .sel { outline-style: dashed; box-shadow: none; }
  .hl span { position: absolute; left: -1.5px; top: -24px; background: var(--m-signal-4); color: var(--m-text-inverse);
    font: 500 11px/1 var(--m-mono); padding: 5px 7px; border-radius: 5px; white-space: nowrap; letter-spacing: 0; }
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
  .row { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; }
  .in { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: var(--m-text); font: 450 var(--m-text-lg)/1.4 var(--m-font); letter-spacing: var(--m-tracking); padding: 4px 0; }
  .in::placeholder { color: var(--m-text-3); }
  .in:disabled { color: var(--m-text-2); }
  .go { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 0; background: var(--m-primary); color: var(--m-primary-text); transition: background var(--m-fast); }
  .go:hover { background: var(--m-primary-hover); }
  .chip { display: inline-flex; align-items: center; gap: 2px; max-width: 44%; background: var(--m-raised); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: 7px; padding: 3px 3px 3px 8px; font: 500 var(--m-text-sm)/1.4 var(--m-mono); letter-spacing: 0; white-space: nowrap; }
  .chip span { overflow: hidden; text-overflow: ellipsis; }
  .chip .x { border: 0; background: none; color: var(--m-text-3); font-size: 14px; line-height: 1; padding: 0 5px; }
  .chip .x:hover { color: var(--m-text); }
  .status { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-top: 1px solid var(--m-line); font-size: var(--m-text-sm); color: var(--m-text-2); min-height: 40px; }
  .hint { flex: none; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 62%; }
  .hint b { color: var(--m-text); font-weight: 500; } .hint i { color: var(--m-warn); font-style: normal; }
  .hint .ok { color: var(--m-text); font-weight: 500; }
  .ticker { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; font: 11.5px/1 var(--m-mono); color: var(--m-text-3); letter-spacing: 0;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 35%); mask-image: linear-gradient(90deg, transparent, #000 35%); }
  .actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
  .btn, .actions button, .panel button, .card button { background: transparent; color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm);
    padding: 4px 10px; font: 500 var(--m-text-sm)/1.5 var(--m-font); transition: background var(--m-fast), border-color var(--m-fast); }
  .actions button:hover, .panel button:hover, .card button:hover { background: var(--m-hover); }
  button.primary { background: var(--m-primary) !important; border-color: var(--m-primary) !important; color: var(--m-primary-text) !important; }
  button.primary:hover { background: var(--m-primary-hover) !important; }
  button:focus-visible { outline: 2px solid var(--m-focus); outline-offset: 1px; }
  .actions em { font-style: normal; color: var(--m-text-3); margin-left: 4px; font-variant-numeric: tabular-nums; }
  .model { font: 11px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .ms { font: 500 var(--m-text-sm) var(--m-mono); color: var(--m-text-2); font-variant-numeric: tabular-nums; letter-spacing: 0; }
  kbd { font: 10.5px/1 var(--m-mono); background: var(--m-raised); border: 1px solid var(--m-line-strong); border-radius: 4px; padding: 2px 4px; color: var(--m-text-2); }
  button.primary kbd { background: transparent; border-color: color-mix(in srgb, var(--m-primary-text) 25%, transparent); color: inherit; opacity: .7; }
  .dim { color: var(--m-text-3); }

  /* ---- mods panel */
  .panel { position: fixed; top: 12px; right: 12px; bottom: 12px; width: 372px; max-width: calc(100vw - 24px); pointer-events: auto; display: flex; flex-direction: column;
    background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); animation: slide var(--m-med) var(--m-ease); }
  @keyframes slide { from { transform: translateX(12px); opacity: 0 } }
  .panel header { display: flex; align-items: center; gap: 10px; padding: 14px 12px 12px 16px; border-bottom: 1px solid var(--m-line); }
  .panel header div { flex: 1; } .panel header b { font-size: var(--m-text-lg); font-weight: 600; display: block; } .panel header small { color: var(--m-text-3); font: 11px var(--m-mono); letter-spacing: 0; }
  .panel header button, .card header button { border: 0 !important; background: none !important; font-size: 18px; color: var(--m-text-3); padding: 2px 8px; }
  .list { flex: 1; overflow: auto; padding: 8px; }
  .list article { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; padding: 12px; border-radius: var(--m-r-md); margin-bottom: 4px; transition: background var(--m-fast); }
  .list article:hover { background: var(--m-raised); }
  .list article.off .meta { opacity: .5; }
  .meta b { display: block; font-size: var(--m-text-md); font-weight: 550; } .meta small { color: var(--m-text-2); display: block; margin-top: 1px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; } .tags span { font: 10.5px var(--m-mono); color: var(--m-text-2); border: 1px solid var(--m-line-strong); border-radius: 4px; padding: 0 5px; letter-spacing: 0; }
  .btns { grid-column: 2; display: flex; gap: 2px; margin: 6px 0 0 -8px; }
  .panel .btns button { border: 0; color: var(--m-text-3); padding: 2px 8px; }
  .panel .btns button:hover { color: var(--m-text); background: var(--m-hover); }
  .empty { color: var(--m-text-2); text-align: center; padding: 48px 16px; line-height: 1.8; }
  .empty .radar { color: var(--m-text-3); margin-bottom: 10px; }
  .panel footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px 10px 16px; border-top: 1px solid var(--m-line); font: 11px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .sw { position: relative; width: 30px; height: 18px; margin-top: 1px; } .sw input { opacity: 0; width: 0; height: 0; position: absolute; }
  .sw span { position: absolute; inset: 0; background: var(--m-line-strong); border-radius: 9px; transition: var(--m-fast); cursor: pointer; }
  .sw span::after { content: ""; position: absolute; left: 2px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--m-text-2); transition: var(--m-fast) var(--m-ease); }
  .sw input:checked + span { background: var(--m-primary); } .sw input:checked + span::after { transform: translateX(12px); background: var(--m-primary-text); }

  /* ---- modals */
  .modal { position: fixed; inset: 0; background: var(--m-scrim); display: flex; align-items: center; justify-content: center; pointer-events: auto; animation: fade var(--m-fast); }
  @keyframes fade { from { opacity: 0 } }
  .card { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow: auto; background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-lg); padding: 20px; font: 400 var(--m-text-md)/1.45 var(--m-font); letter-spacing: var(--m-tracking); box-shadow: var(--m-shadow); animation: rise2 var(--m-med) var(--m-ease); }
  .card header { display: grid; grid-template-columns: 1fr auto; margin-bottom: 14px; } .card header b { font-size: var(--m-text-xl); font-weight: 600; } .card header small { grid-row: 2; color: var(--m-text-2); margin-top: 2px; }
  .card header button { grid-row: 1 / 3; grid-column: 2; }
  .card label { display: block; font: 500 var(--m-text-xs) var(--m-mono); color: var(--m-text-3); margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .06em; }
  .card label .dim, .card label code { text-transform: none; letter-spacing: 0; }
  .code { width: 100%; min-height: 130px; background: var(--m-bg); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); padding: 12px; font: 12px/1.6 var(--m-mono); letter-spacing: 0; resize: vertical; outline: 0; }
  .code:focus { border-color: var(--m-signal-2); }
  .card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .cardimg { width: 100%; border-radius: var(--m-r-md); border: 1px solid var(--m-line); display: block; }
  .link { display: flex; gap: 8px; margin-top: 12px; } .link input { flex: 1; min-width: 0; background: var(--m-bg); color: var(--m-text-2); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); padding: 6px 10px; font: 12px var(--m-mono); letter-spacing: 0; }
  .exports { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .saved { margin: 10px 0 0; font: 11px var(--m-mono); }

  .toast { position: fixed; left: 20px; bottom: 20px; pointer-events: none; display: flex; align-items: center; gap: 10px; background: var(--m-surface); color: var(--m-text);
    border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); padding: 9px 14px 9px 12px; font: 450 var(--m-text-md)/1.4 var(--m-font); letter-spacing: var(--m-tracking);
    box-shadow: var(--m-shadow); animation: rise2 var(--m-med) var(--m-ease); }
  .toast .radar { color: var(--m-text-2); }
  @keyframes rise2 { from { transform: translateY(6px); opacity: 0 } }
`; }
