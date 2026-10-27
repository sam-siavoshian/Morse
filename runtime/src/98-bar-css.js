// Styles for the command bar's newer parts: textarea input, mic + level meter,
// stop button, suggestion chips, overflow menu, settings sheet, hotkey
// recorder, cheat sheet. Buttons, menus, segmented controls, fields, keys,
// eyebrows, tags and the focus ring are the shared ones in 99-css.js; this
// file only places and sizes them. Tokens from design/tokens.css only.
function BAR_CSS() { return `
  .bar { display: flex; flex-direction: column; max-height: calc(100vh - 56px); }
  .bar[data-pos="top"] { bottom: auto !important; top: 28px !important; }
  .bar[data-pos="bottom"] { top: auto !important; bottom: 28px !important; }
  /* A dropped bar: left/top from the drag (50-bar.js). The gesture only changes
     the translate, so the page does not reflow per move, and nothing eases it
     (prefers-reduced-motion included: the bar just follows the pointer). */
  .bar.placed {
    left: var(--m-bx) !important; top: var(--m-by) !important; right: auto !important; bottom: auto !important;
    transform: translate3d(var(--m-bdx, 0px), var(--m-bdy, 0px), 0) !important;
    animation: none !important; transition: none !important;
  }
  .bar.dragging, .bar.dragging * { cursor: grabbing !important; }
  .grip { flex: none; width: 16px; height: 20px; margin-top: 6px; align-self: flex-start; cursor: grab; touch-action: none;
    background: radial-gradient(circle, var(--m-text-3) 1.15px, transparent 1.4px) center / 6px 6px; }
  .grip:hover { background-image: radial-gradient(circle, var(--m-text-2) 1.15px, transparent 1.4px); }
  /* Glass is the calm-page look (backdrop on .bar in 99-css.js). A sheet, or
     page text sitting under the surface (50-bar.js Backing adds .solid), is an
     opaque --m-surface. Drop the blur then: it costs a composite and does not
     change what you read. */
  .bar.has-pane,
  :is(.bar, .so-strip, .guide, .ds).solid {
    background: var(--m-surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .row { align-items: flex-start; cursor: grab; user-select: none; }
  .row > .mark { margin-top: 7px; cursor: grab; touch-action: none; }
  .row > .chip { margin-top: 4px; }
  textarea.in { display: block; resize: none; height: 32px; max-height: 113px; overflow-y: hidden; margin: 0; scrollbar-width: thin; field-sizing: fixed; cursor: text; user-select: text; }
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
  .status { position: relative; cursor: grab; user-select: none; touch-action: none; }
  .hint:has(.note) { flex: 1 1 auto; max-width: none; }
  .hint .note { color: var(--m-text-2); font-style: normal; overflow: hidden; text-overflow: ellipsis; }
  .hint .note::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-block: 0 1px; margin-inline: 0 8px; border-radius: 2px; background: var(--m-warn); vertical-align: middle; }
  .hint:has(.note) ~ .ticker { display: none; }
  /* a result with a sentence for a note (the waiting note, “Stopped…”):
     the note gives way before the title does, and ends in an ellipsis (the hint's title has it all) */
  .hint:has(.said) .ok { flex: 0 1 auto; }
  .hint .ok + .dim.said { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  /* one more thing to do (the waiting button, Model settings: data-ob): the hint gets a row of its own */
  .status:has(> .actions > [data-ob]) { flex-wrap: wrap; row-gap: 4px; }
  .status:has(> .actions > [data-ob]) > .hint { flex: 1 1 100%; }
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
  /* simplify: More settings, a disclosure under the few settings people change */
  .sheet .more-set { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 8px 0; }
  .sheet .more-set::after { content: ""; width: 6px; height: 6px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: translateY(-2px) rotate(45deg); transition: transform var(--m-fast) var(--m-ease); }
  .sheet .more-set[aria-expanded="true"]::after { transform: translateY(1px) rotate(-135deg); }
  .sheet .more-settings > section:first-child { border-top: 1px solid var(--m-line); padding-top: 8px; }
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
    /* what you pointed at gets a line of its own above the input, so the
       input keeps the width of the row less its three buttons */
    .row:has(> .chip:not([hidden])) { flex-wrap: wrap; row-gap: 0; }
    .row:has(> .chip:not([hidden]))::after { content: ""; order: 1; flex: 0 0 100%; height: 8px; }
    .row > .chip { order: 0; max-width: 100%; margin-top: 0; }
    .row:has(> .chip:not([hidden])) > .mark { margin-top: 3px; } /* (shown at this width only for a mod that needs fixing: 98-heal-css.js) */
    .row > :not(.chip, .mark) { order: 2; }
    /* ⋯ ends the hint's row, so a full row of actions never pushes it onto a line of its own */
    .status:has(> .hint:not(:empty)) > .hint { order: -2; flex-basis: calc(100% - 40px); }
    .status:has(> .hint:not(:empty)) > .more { order: -1; }
    /* more actions than fit: they wrap, right-aligned, inside the bar */
    .actions { flex-wrap: wrap; justify-content: flex-end; row-gap: 8px; }
    .srow { flex-wrap: wrap; row-gap: 8px; }
    .srow .ctl:has(.seg) { flex: 1 1 100%; justify-content: flex-start; }
  }

  /* effect intensity: subtle keeps a still outline while the model works */
  .sel.busy { outline-style: solid; outline-color: var(--m-signal-2); box-shadow: 0 0 0 4px var(--m-focus); }
  :host([data-fx="off"]) .mark.live .radar rect, :host([data-fx="off"]) .hint .radar rect { animation: none; }
  :host([data-fx="off"]) .bar, :host([data-fx="off"]) .pane, :host([data-fx="off"]) .menu, :host([data-fx="subtle"]) .bar { animation: none; }
  @media (prefers-reduced-motion: reduce) { .bar, .pane, .menu, .mic.nudge, .hkrow.shake .hk { animation: none !important; } }

  /* Landing-page glass and button treatment (site/site.css .glass / .btn).
     Keep theme tokens for light host apps and opaque backing over busy content. */
  .bar { width: min(600px, calc(100vw - 24px)); isolation: isolate;
    --m-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --m-mono: "JetBrains Mono", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    border-radius: 18px; font-feature-settings: "cv11", "ss01"; -webkit-font-smoothing: antialiased;
    border-color: color-mix(in srgb, var(--m-text) 18%, transparent);
    background: linear-gradient(155deg, rgba(125, 163, 224, 0.13), transparent 65%), var(--m-overlay);
    backdrop-filter: blur(22px) saturate(1.5); -webkit-backdrop-filter: blur(22px) saturate(1.5);
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--m-text) 16%, transparent), inset 0 1px 0 color-mix(in srgb, var(--m-text) 12%, transparent), var(--m-shadow); }
  .bar::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: -1; border-radius: inherit;
    background: radial-gradient(180px circle at var(--bar-light-x, 50%) var(--bar-light-y, 0%), color-mix(in srgb, var(--m-text) 9%, transparent), transparent);
    opacity: 0; transition: opacity 300ms var(--m-ease); }
  .bar.lit::before { opacity: 1; }
  .bar.solid, .bar.has-pane { background: linear-gradient(155deg, rgba(125, 163, 224, 0.10), transparent 65%), var(--m-surface); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .bar .row { gap: 8px; padding: 8px 8px 8px 12px; }
  .bar textarea.in { font-size: var(--m-text-md); line-height: 21px; }
  .bar .status { background: color-mix(in srgb, var(--m-bg) 20%, transparent); border-radius: 0 0 17px 17px; gap: 8px; padding: 5px 8px 5px 12px; min-height: 36px; border-top-color: color-mix(in srgb, var(--m-text) 10%, transparent); }
  .bar .actions { gap: 6px; }
  .bar .model { max-width: 120px; font-family: var(--m-font); }
  .bar .sugs, .bar .gm-clips { padding-inline: 12px 8px; }
  .bar .sugs { gap: 6px; }
  .bar .sug { height: 26px; padding-inline: 8px; border-color: transparent; background: color-mix(in srgb, var(--m-text) 4%, transparent); }
  .bar .sug:hover { border-color: var(--m-line-strong); background: var(--m-hover); }
  .bar .chip { font-family: var(--m-font); max-width: min(28%, 140px); border-color: transparent; background: color-mix(in srgb, var(--m-text) 5%, transparent); }
  .bar .actions button, .bar .go, .bar .ibtn { border-radius: 9px; }
  .bar .btn, .bar .actions button { background: color-mix(in srgb, var(--m-text) 6%, transparent);
    border-color: color-mix(in srgb, var(--m-text) 16%, transparent);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.24), inset 0 -1px 0 color-mix(in srgb, var(--m-text) 8%, transparent);
    transition: background-color 140ms var(--m-ease), border-color 140ms var(--m-ease), transform 90ms var(--m-ease), box-shadow 90ms var(--m-ease); }
  .bar .btn:hover, .bar .actions button:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  .bar .go:not(:disabled), .bar .actions button.primary { background: var(--m-primary); color: var(--m-primary-text);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.18), inset 0 -1px 0 rgba(255, 255, 255, 0.45); }
  .bar .go:not(:disabled):hover, .bar .actions button.primary:hover { background: var(--m-primary-hover); }
  .bar.working .go:not(:disabled) { background: var(--m-raised); color: var(--m-text); box-shadow: inset 0 0 0 1px var(--m-line-strong); }
  .bar .ibtn, .bar .sug { box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.16), inset 0 -1px 0 color-mix(in srgb, var(--m-text) 5%, transparent); }
  .bar .go:active:not(:disabled), .bar .actions button:active:not(:disabled), .bar .btn:active:not(:disabled), .bar .ibtn:active:not(:disabled), .bar .sug:active:not(:disabled) {
    box-shadow: inset 0 3px 6px rgba(0, 0, 0, 0.3), inset 0 -1px 0 color-mix(in srgb, var(--m-text) 5%, transparent); }
  .bar.working { border-color: var(--m-signal-2); }
  .bar.err, .bar.has-error { border-color: color-mix(in srgb, var(--m-danger) 60%, var(--m-line-strong)); }
  .bar .pane { border-top-color: color-mix(in srgb, var(--m-text) 10%, transparent); border-radius: 0 0 17px 17px; }
  .bar.has-pane .status { border-radius: 0; }
  .bar .sheet { padding: 6px 12px 12px; }
  .bar .sheet header b { font-family: "Inter Display", var(--m-font); font-size: 15px; letter-spacing: -0.025em; }
  .bar .sheet h4, .bar .menu > header, .bar .sugs .try { text-transform: none; letter-spacing: 0.02em; font-weight: 400; }
  .bar .srow { padding-inline: 8px; }
  .bar .menu { min-width: min(248px, calc(100vw - 48px)); max-width: calc(100vw - 48px); padding: 6px; border-radius: 14px;
    background: linear-gradient(155deg, rgba(125, 163, 224, 0.08), transparent 65%), var(--m-surface);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--m-text) 12%, transparent), var(--m-shadow); }
  .bar .menu > button { border-radius: 8px; }
  .bar kbd { border-radius: 6px; }
  .bar .actions button:active:not(:disabled), .bar .go:active:not(:disabled), .bar .ibtn:active:not(:disabled) { transform: translateY(1px); }
  .bar .ticker { display: none; }
  .bar.working .hint { flex: 1; }
  .bar.done .status { flex-wrap: wrap; }
  .bar.done .hint { flex: 1 1 220px; flex-wrap: wrap; column-gap: 8px; row-gap: 0; }
  .bar.done .hint .ok { overflow-wrap: anywhere; white-space: normal; }
  .bar.done .hint .dim { font-size: var(--m-text-xs); font-family: var(--m-font); }
  .bar.err .status, .bar.has-error .status { flex-wrap: wrap; align-items: flex-start; }
  .bar.err .hint, .bar.has-error .hint { flex: 1 1 calc(100% - 40px); max-height: min(28vh, 160px); overflow: auto; white-space: normal; overflow-wrap: anywhere; user-select: text; cursor: text; scrollbar-width: thin; }
  .bar.has-error .hint .note { white-space: normal; overflow: visible; flex-basis: 100%; }
  .bar.err .hint i { color: var(--m-text-2); }
  .bar.err .actions, .bar.has-error .actions { order: 2; }
  .bar.saving .hint { color: var(--m-text-2); }
  .bar.saving button:disabled { cursor: wait; }
  .bar.saving .go, .bar.saving .actions button { background: var(--m-raised) !important; color: var(--m-text-3) !important; border-color: var(--m-line-strong) !important; }
  @media (max-width: 560px) {
    .bar .chip { max-width: 100%; }
    .bar.done .hint { flex-basis: calc(100% - 40px); }
    .bar .actions { flex-wrap: wrap; }
    .bar .sugs { gap: 4px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar::before { display: none; }
    .bar *, .bar::before { transition-duration: 0.01ms !important; }
    .bar .actions button:active:not(:disabled), .bar .go:active:not(:disabled), .bar .ibtn:active:not(:disabled) { transform: none; }
  }

  /* One primary action per state: Send while typing, Save below a preview.
     Keep the send button's place stable while a follow-up is empty. */
  .bar .grip { display: none; }
  .bar .row > .mark { margin-inline-end: 0; }
  .bar.done:not(.refining) .go { visibility: hidden; pointer-events: none; }
  .bar .go .i-save { display: none; }
  .bar .row { padding-block: 10px; }
  .bar .status { min-height: 40px; padding-block: 6px; }
  .bar .actions button { height: 28px; padding-inline: 10px; }
  .bar.done .hint { flex-basis: 160px; }
  .bar.done .hint .ok { max-height: 60px; overflow-y: auto; scrollbar-width: thin; user-select: text; }
  .bar .bmenu { max-height: min(400px, calc(100vh - 160px)); overflow-y: auto; overscroll-behavior: contain; }
  .bar .pane { overscroll-behavior: contain; }
  @media (max-width: 400px) {
    .bar .row { gap: 6px; padding-inline: 10px; }
    .bar .status { gap: 6px; padding-inline: 10px; }
    .bar.done .hint { flex-basis: calc(100% - 38px); }
    .bar .actions { max-width: calc(100% - 38px); }
  }

  /* Quiet surfaces and clear grouping keep the request as the focal point. */
  .bar, .bar.solid, .bar.has-pane { background: var(--m-surface); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .bar::before { display: none; }
  .bar .btn, .bar .actions button, .bar .ibtn, .bar .sug { box-shadow: none; }
  .bar .row { padding: 14px 12px; }
  .bar textarea.in { font-size: var(--m-text-lg); }
  .bar .sugs { padding: 0 12px 12px; }
  .bar .status { background: transparent; }
  .bar .settings-group { border-top: 1px solid var(--m-line); }
  .bar .settings-group > summary { padding: 13px 8px; cursor: pointer; font-weight: 500; color: var(--m-text); }
  .bar .settings-group > summary:hover { background: var(--m-hover); border-radius: 8px; }
  .bar .settings-group > section { border-top: 0; margin: 0; }
  .bar .settings-group[data-group="style"] h4 { display: none; }
`; }
