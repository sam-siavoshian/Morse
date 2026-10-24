// Styles for the command bar's newer parts: textarea input, mic + level meter,
// stop button, suggestion chips, overflow menu, settings sheet, hotkey
// recorder, cheat sheet. Buttons, menus, segmented controls, fields, keys,
// eyebrows, tags and the focus ring are the shared ones in 99-css.js; this
// file only places and sizes them. Tokens from design/tokens.css only.
function BAR_CSS() { return `
  .bar { display: flex; flex-direction: column; max-height: calc(100vh - 56px); }
  .bar[data-pos="top"] { bottom: auto !important; top: 28px !important; }
  .bar[data-pos="bottom"] { top: auto !important; bottom: 28px !important; }
  /* a sheet is a reading surface: solid, not see-through */
  .bar.has-pane { background: var(--m-surface); }
  .row { align-items: flex-start; }
  .row > .mark { margin-top: 7px; }
  .row > .chip { margin-top: 4px; }
  textarea.in { display: block; resize: none; height: 32px; max-height: 113px; overflow-y: hidden; margin: 0; scrollbar-width: thin; field-sizing: fixed; }
  textarea.in::placeholder { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .in.interim { color: var(--m-text-2); }
  .bar.listening .in::placeholder { color: var(--m-text-2); }

  /* the bar row's buttons (page tools, mic, run/stop) are 32px squares */
  .go, .mic, .gm-qbtn { align-self: flex-end; }
  .go { position: relative; }
  .go .i-stop, .bar.working .go .i-go { display: none; }
  .bar.working .go .i-stop { display: block; }
  .bar.working .go { background: var(--m-raised); color: var(--m-text); box-shadow: inset 0 0 0 1px var(--m-line-strong); }
  .bar.working .go:hover { background: var(--m-hover); }
  .mic { transition: width var(--m-med) var(--m-ease), background var(--m-fast), color var(--m-fast), box-shadow var(--m-fast); }
  .mic > * { grid-area: 1 / 1; }
  .mic.off { color: var(--m-text-3); }
  .mic .lvl, .mic .spin { display: none; }
  .mic[data-state="listening"], .mic[data-state="starting"] { width: 48px; background: var(--m-raised); color: var(--m-text); box-shadow: inset 0 0 0 1px var(--m-line-strong); }
  .mic[data-state="listening"] .i-mic, .mic[data-state="transcribing"] .i-mic { display: none; }
  .mic[data-state="listening"] .lvl { display: block; }
  .mic[data-state="transcribing"] .spin { display: inline-flex; color: var(--m-text-2); }
  .mic.nudge { animation: nudge 360ms var(--m-ease); }
  @keyframes nudge { 25% { transform: translateX(-2px) } 75% { transform: translateX(2px) } }
  .bar.listening { border-color: var(--m-signal-2); }

  /* the status line: room for one-line notes */
  .status { position: relative; }
  .hint:has(.note) { flex: 1 1 auto; max-width: none; }
  .hint .note { color: var(--m-text-2); font-style: normal; overflow: hidden; text-overflow: ellipsis; }
  .hint .note::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-block: 0 1px; margin-inline: 0 8px; border-radius: 2px; background: var(--m-warn); vertical-align: middle; }
  .hint:has(.note) ~ .ticker { display: none; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* suggestion chips: .sug is a quiet .btn, on the bar's 16px inset */
  .sugs { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-block: 0 8px; padding-inline: 16px 8px; }
  .sugs .try { margin-inline-end: 4px; }
  .sug { color: var(--m-text-2); }
  .sug:hover { color: var(--m-text); }
  .sug .ell { color: var(--m-text-3); margin-inline-start: -8px; }

  /* the overflow menu (a .menu) */
  .bmenu { inset-inline-end: 8px; bottom: calc(100% + 8px); }
  .bmenu.below { bottom: auto; top: calc(100% + 8px); }

  /* panes: settings + shortcuts */
  .pane { min-height: 0; overflow: auto; border-top: 1px solid var(--m-line); max-height: min(calc(100vh - 168px), 640px); scrollbar-width: thin; animation: fade var(--m-fast); }
  .pane[data-kind="shortcuts"] { max-height: min(62vh, 400px); }
  .sheet { padding: 4px 8px 8px; }
  .sheet header { display: flex; align-items: center; gap: 8px; padding-block: 8px 4px; padding-inline: 8px 0; }
  .sheet header b { font: 600 var(--m-text-md)/20px var(--m-font); color: var(--m-text); }
  .sheet header .flash { flex: 1; font: var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); opacity: 0; letter-spacing: 0; }
  .sheet header .flash.show { animation: saved 1.6s var(--m-ease); }
  @keyframes saved { 0%, 70% { opacity: 1 } 100% { opacity: 0 } }
  .sheet.kbsheet header b { flex: 1; }
  .sheet section { padding: 4px 0 8px; }
  .sheet section + section { border-top: 1px solid var(--m-line); padding-top: 8px; }
  .sheet h4 { margin: 8px 8px 4px; }
  .srow { display: flex; align-items: center; gap: 12px; min-height: 40px; padding-block: 4px; padding-inline: 8px 0; border-radius: var(--m-r-sm); }
  .srow .lbl { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .srow .lbl > span { color: var(--m-text); font: 450 var(--m-text-md)/16px var(--m-font); }
  .srow .lbl small { color: var(--m-text-3); font: 400 var(--m-text-xs)/16px var(--m-font); letter-spacing: 0; }
  .srow .lbl .warn, .srow .lbl small.warn { color: var(--m-warn); }
  .srow .lbl .bad { color: var(--m-danger); }
  .srow .ctl { flex: none; display: flex; align-items: center; gap: 8px; }
  .pill.on { color: var(--m-text); }
  .pill.on::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 2px; background: var(--m-signal-4); margin-inline-end: 6px; }

  /* hotkey recorder: a .field that holds key caps */
  .hk { min-width: 96px; height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 4px; }
  .hk:hover { border-color: var(--m-signal-1); }
  .hkrow.recording { background: var(--m-raised); }
  .hkrow.recording .hk { border-color: var(--m-signal-3); background: var(--m-surface); box-shadow: 0 0 0 1px var(--m-signal-3), 0 0 0 4px var(--m-focus); }
  .hk .rec { display: inline-flex; align-items: center; gap: 8px; }
  .hk .dots { display: inline-flex; color: var(--m-text-2); }
  .hk .dots .radar rect.c { animation: m-pulse 1.5s ease-in-out infinite both; }
  .hk .dots .radar rect.o { animation: m-pulse-dim 1.5s ease-in-out infinite both; }
  .hkrow.shake .hk { animation: nudge 320ms var(--m-ease); border-color: var(--m-danger); box-shadow: 0 0 0 1px var(--m-danger); }
  .sheet footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0 0; border-top: 1px solid var(--m-line); font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; }

  /* cheat sheet */
  .kbsheet .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .kbsheet section + section { border-top: 0; padding-top: 4px; }
  .krow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; padding: 4px 8px; border-radius: var(--m-r-sm); color: var(--m-text); font: 450 var(--m-text-md)/16px var(--m-font); }
  .krow:hover { background: var(--m-raised); }
  .krow .k { display: inline-flex; align-items: center; gap: 8px; }
  .krow .k small { color: var(--m-text-3); font: var(--m-text-xs)/16px var(--m-mono); letter-spacing: 0; }
  @media (max-width: 560px) {
    .kbsheet .cols { grid-template-columns: 1fr; }
    /* phone width: the input needs the room more than the mark does */
    .row > .mark { display: none; }
    .chip { max-width: 40%; }
    .srow { flex-wrap: wrap; row-gap: 8px; }
    .srow .ctl:has(.seg) { flex: 1 1 100%; justify-content: flex-start; }
  }

  /* effect intensity: subtle keeps a still outline while the model works */
  .sel.busy { outline-style: solid; outline-color: var(--m-signal-2); box-shadow: 0 0 0 4px var(--m-focus); }
  :host([data-fx="off"]) .mark.live .radar rect, :host([data-fx="off"]) .hint .radar rect { animation: none; }
  :host([data-fx="off"]) .bar, :host([data-fx="off"]) .pane, :host([data-fx="off"]) .menu, :host([data-fx="subtle"]) .bar { animation: none; }
  @media (prefers-reduced-motion: reduce) { .bar, .pane, .menu, .mic.nudge, .hkrow.shake .hk { animation: none !important; } }
`; }
