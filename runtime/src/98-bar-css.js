// Styles for the command bar's newer parts: textarea input, mic + level meter,
// stop button, suggestion chips, overflow menu, settings sheet, hotkey
// recorder, cheat sheet. Tokens from design/tokens.css only.
function BAR_CSS() { return `
  .bar { display: flex; flex-direction: column; max-height: calc(100vh - 56px); }
  .bar[data-pos="top"] { bottom: auto !important; top: 28px !important; }
  .bar[data-pos="bottom"] { top: auto !important; bottom: 28px !important; }
  .row { align-items: flex-start; }
  .row > .mark, .row > .chip { margin-top: 6px; }
  .row > .chip { margin-top: 4px; }
  textarea.in { display: block; resize: none; height: 29px; max-height: 113px; overflow-y: hidden; margin: 0; scrollbar-width: thin; field-sizing: fixed; }
  .in.interim { color: var(--m-text-2); }
  .bar.listening .in::placeholder { color: var(--m-text-2); }

  /* buttons at the right end of the input */
  .go, .mic { flex: none; align-self: flex-end; }
  .go { position: relative; }
  .go .i-stop, .bar.working .go .i-go { display: none; }
  .bar.working .go .i-stop { display: block; }
  .bar.working .go { background: var(--m-raised); color: var(--m-text); box-shadow: inset 0 0 0 1px var(--m-line-strong); }
  .bar.working .go:hover { background: var(--m-hover); }
  .mic { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 0; background: transparent; color: var(--m-text-2);
    transition: width var(--m-med) var(--m-ease), background var(--m-fast), color var(--m-fast), box-shadow var(--m-fast); }
  .mic > * { grid-area: 1 / 1; }
  .mic:hover { background: var(--m-hover); color: var(--m-text); }
  .mic.off { color: var(--m-text-3); }
  .mic .lvl, .mic .spin { display: none; }
  .mic[data-state="listening"], .mic[data-state="starting"] { width: 46px; background: var(--m-raised); color: var(--m-text); box-shadow: inset 0 0 0 1px var(--m-line-strong); }
  .mic[data-state="listening"] .i-mic, .mic[data-state="transcribing"] .i-mic { display: none; }
  .mic[data-state="listening"] .lvl { display: block; }
  .mic[data-state="transcribing"] .spin { display: inline-flex; color: var(--m-text-2); }
  .mic.nudge { animation: nudge 360ms var(--m-ease); }
  @keyframes nudge { 25% { transform: translateX(-2px) } 75% { transform: translateX(2px) } }
  .bar.listening { border-color: var(--m-signal-2); }

  /* focus you can see, in the bar's own gray */
  .bar button:focus-visible, .bar .sw input:focus-visible + span, .bar [tabindex]:focus-visible {
    outline: 2px solid var(--m-signal-3); outline-offset: 2px; }
  .bar .go:focus-visible, .bar .mic:focus-visible { outline-offset: 1px; }

  /* the status line: room for one-line notes */
  .status { position: relative; }
  .hint:has(.note) { flex: 1 1 auto; max-width: none; }
  .hint .note { color: var(--m-text-2); font-style: normal; overflow: hidden; text-overflow: ellipsis; }
  .hint .note::before { content: ""; display: inline-block; width: 6px; height: 6px; margin: 0 7px 1px 0; border-radius: 1.5px; background: var(--m-warn); vertical-align: middle; }
  .hint:has(.note) ~ .ticker { display: none; }
  .more { flex: none; width: 26px; height: 26px; display: grid; place-items: center; margin: -3px -4px -3px 0; border: 0; border-radius: var(--m-r-sm); background: transparent; color: var(--m-text-3); }
  .more:hover, .more[aria-expanded="true"] { background: var(--m-hover); color: var(--m-text); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* suggestion chips */
  .sugs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px 42px; margin-top: -2px; }
  .sugs .try { font: 500 var(--m-text-xs) var(--m-mono); color: var(--m-text-3); letter-spacing: .06em; text-transform: uppercase; margin-right: 2px; }
  .sug { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--m-line-strong); background: transparent;
    color: var(--m-text-2); font: 500 var(--m-text-sm)/1 var(--m-font); letter-spacing: var(--m-tracking); white-space: nowrap; transition: background var(--m-fast), color var(--m-fast), border-color var(--m-fast); }
  .sug:hover, .sug:focus-visible { background: var(--m-hover); color: var(--m-text); border-color: var(--m-signal-1); }
  .sug .ell { color: var(--m-text-3); margin-left: 1px; }

  /* overflow menu */
  .bmenu { position: absolute; right: 8px; bottom: calc(100% + 6px); min-width: 248px; padding: 5px; background: var(--m-surface); border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-md); box-shadow: var(--m-shadow); z-index: 2; animation: rise2 var(--m-fast) var(--m-ease); }
  .bmenu.below { bottom: auto; top: calc(100% + 6px); }
  .bmenu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px 7px 10px; border: 0; border-radius: var(--m-r-sm); background: transparent;
    color: var(--m-text); font: 450 var(--m-text-md)/1.2 var(--m-font); letter-spacing: var(--m-tracking); text-align: left; }
  .bmenu button > span:first-child { flex: 1; }
  .bmenu button small { color: var(--m-text-3); font: 11px var(--m-mono); letter-spacing: 0; }
  .bmenu button:hover, .bar .bmenu button:focus-visible { background: var(--m-hover); outline: none; }

  /* key caps */
  .caps { display: inline-flex; gap: 3px; align-items: center; }
  .caps kbd { min-width: 20px; height: 20px; display: inline-grid; place-items: center; padding: 0 5px; font: 500 11px/1 var(--m-mono); color: var(--m-text-2);
    background: var(--m-raised); border: 1px solid var(--m-line-strong); border-bottom-width: 2px; border-radius: 5px; }
  .caps.off { font: 11px var(--m-mono); color: var(--m-text-3); }

  /* panes: settings + shortcuts */
  .pane { min-height: 0; overflow: auto; border-top: 1px solid var(--m-line); max-height: min(calc(100vh - 168px), 640px); scrollbar-width: thin; animation: fade var(--m-fast); }
  .pane[data-kind="shortcuts"] { max-height: min(62vh, 400px); }
  .sheet { padding: 4px 6px 6px; }
  .sheet header { display: flex; align-items: center; gap: 10px; padding: 8px 8px 4px; }
  .sheet header b { font: 600 var(--m-text-md)/1.2 var(--m-font); color: var(--m-text); }
  .sheet header .flash { flex: 1; font: 11px var(--m-mono); color: var(--m-text-3); opacity: 0; letter-spacing: 0; }
  .sheet header .flash.show { animation: saved 1.6s var(--m-ease); }
  @keyframes saved { 0%, 70% { opacity: 1 } 100% { opacity: 0 } }
  .sheet.kbsheet header b { flex: 1; }
  .sheet section { padding: 2px 0 6px; }
  .sheet section + section { border-top: 1px solid var(--m-line); padding-top: 6px; }
  .sheet h4 { margin: 8px 8px 2px; font: 500 var(--m-text-xs)/1.4 var(--m-mono); color: var(--m-text-3); text-transform: uppercase; letter-spacing: .06em; }
  .srow { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 3px 8px; border-radius: var(--m-r-sm); }
  .srow .lbl { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .srow .lbl > span { color: var(--m-text); font: 450 var(--m-text-md)/1.3 var(--m-font); }
  .srow .lbl small { color: var(--m-text-3); font: 400 var(--m-text-xs)/1.35 var(--m-font); letter-spacing: 0; }
  .srow .lbl small kbd { font-size: 10px; padding: 1px 4px; }
  .srow .lbl .warn, .srow .lbl small.warn { color: var(--m-warn); }
  .srow .lbl .bad { color: var(--m-danger); }
  .srow .ctl { flex: none; display: flex; align-items: center; gap: 8px; }
  .tbtn { border: 0; background: none; padding: 3px 6px; border-radius: var(--m-r-sm); color: var(--m-text-2); font: 500 var(--m-text-sm)/1.2 var(--m-font); }
  .tbtn:hover { color: var(--m-text); background: var(--m-hover); }
  .pill { font: 500 11px/1 var(--m-mono); color: var(--m-text-3); border: 1px solid var(--m-line-strong); border-radius: 999px; padding: 4px 8px; letter-spacing: 0; }
  .pill.on { color: var(--m-text); }
  .pill.on::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 1.5px; background: var(--m-signal-4); margin-right: 6px; vertical-align: 1px; }

  /* hotkey recorder */
  .hk { min-width: 92px; height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 5px;
    border: 1px solid var(--m-line-strong); border-radius: 8px; background: var(--m-bg); color: var(--m-text); transition: border-color var(--m-fast), background var(--m-fast); }
  .hk:hover { border-color: var(--m-signal-1); }
  .hkrow.recording { background: var(--m-raised); }
  .hkrow.recording .hk { border-color: var(--m-signal-3); background: var(--m-surface); box-shadow: 0 0 0 3px var(--m-focus); }
  .hk .rec { display: inline-flex; align-items: center; gap: 6px; }
  .hk .dots { display: inline-flex; color: var(--m-text-2); }
  .hk .dots .radar rect.c { animation: m-pulse 1.5s ease-in-out infinite both; }
  .hk .dots .radar rect.o { animation: m-pulse-dim 1.5s ease-in-out infinite both; }
  .hkrow.shake .hk { animation: nudge 320ms var(--m-ease); border-color: color-mix(in srgb, var(--m-danger) 70%, var(--m-line-strong)); }

  /* segmented control */
  .seg { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--m-line-strong); border-radius: 8px; background: var(--m-bg); }
  .seg button { border: 0; background: transparent; color: var(--m-text-2); padding: 4px 10px; border-radius: 6px; font: 500 var(--m-text-sm)/1.3 var(--m-font); letter-spacing: var(--m-tracking); }
  .seg button:hover { color: var(--m-text); }
  .seg button[aria-checked="true"] { background: var(--m-raised); color: var(--m-text); box-shadow: 0 0 0 1px var(--m-line-strong); }
  .sheet footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 4px; border-top: 1px solid var(--m-line); font: 11px var(--m-mono); letter-spacing: 0; }

  /* cheat sheet */
  .kbsheet .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; padding: 0 2px; }
  .kbsheet section + section { border-top: 0; padding-top: 2px; }
  .krow { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px; padding: 3px 8px; border-radius: var(--m-r-sm); color: var(--m-text); font: 450 var(--m-text-md)/1.3 var(--m-font); }
  .krow:hover { background: var(--m-raised); }
  .krow .k { display: inline-flex; align-items: center; gap: 6px; }
  .krow .k small { color: var(--m-text-3); font: 11px var(--m-mono); letter-spacing: 0; }
  @media (max-width: 560px) { .kbsheet .cols { grid-template-columns: 1fr; } }

  /* effect intensity: subtle keeps a still outline while the model works */
  .sel.busy { outline-style: solid; outline-color: var(--m-signal-2); box-shadow: 0 0 0 4px var(--m-focus); }
  :host([data-fx="off"]) .mark.live .radar rect, :host([data-fx="off"]) .hint .radar rect { animation: none; }
  :host([data-fx="off"]) .bar, :host([data-fx="off"]) .pane, :host([data-fx="off"]) .bmenu, :host([data-fx="subtle"]) .bar { animation: none; }
  @media (prefers-reduced-motion: reduce) { .bar, .pane, .bmenu, .mic.nudge, .hkrow.shake .hk { animation: none !important; } }
`; }
