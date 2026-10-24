// Styles for first run and help: the coach, the notice under the input,
// errors in plain words, the empty Mods panel, one-time tips and the help
// pane. Tokens from design/tokens.css only; geometry follows docs/ui/CHECKLIST.md.
function ONBOARDING_CSS() { return `
  /* coach: three steps at the top of the bar */
  .ob-coach { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 12px; padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--m-line); animation: fade var(--m-fast); }
  .ob-steps { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; padding: 0; list-style: none; font: 500 var(--m-text-sm)/20px var(--m-font); color: var(--m-text-3); }
  .ob-steps li { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
  .ob-steps li + li::before { content: ""; width: 16px; height: 1px; background: var(--m-line-strong); margin-right: 1px; }
  /* step numbers: the same 20px round number as Show me once's steps (98-show-once-css.js .so-n) */
  .ob-steps .n { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 10px; border: 1px solid var(--m-line-strong); font: 500 var(--m-text-xs)/1 var(--m-mono); color: var(--m-text-2); letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .ob-steps li.now { color: var(--m-text); }
  .ob-steps li.now .n { background: var(--m-primary); border-color: var(--m-primary); color: var(--m-primary-text); }
  .ob-steps li.done { color: var(--m-text-2); }
  .ob-steps li.done .n { background: var(--m-raised); color: var(--m-text); }
  .ob-hide { margin: -2px 0; } /* .tbtn */
  .ob-say { grid-column: 1 / -1; margin: 0; color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); }
  .ob-say b { color: var(--m-text); font-weight: 500; }
  .ob-say kbd { margin: 0 1px; }
  .ob-link { height: 20px; border: 0; background: none; padding: 0; margin-left: 2px; color: var(--m-text); font: 500 var(--m-text-sm)/20px var(--m-font);
    text-decoration: underline; text-decoration-color: var(--m-signal-1); text-underline-offset: 3px; }
  .ob-link:hover { text-decoration-color: var(--m-text); }

  /* one notice under the input (no model, user scripts off) */
  .ob-note { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; border-top: 1px solid var(--m-line); color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); }
  .ob-dot { background: var(--m-warn); } /* the status dot: 99-css.js */
  .ob-text { flex: 1; min-width: 0; }
  .ob-note .ob-close { color: var(--m-text-3); } /* .btn and .ibtn.sm.close */

  /* errors in plain words: the sentence may take two lines */
  .bar.err .hint:has(.ob-why) { white-space: normal; }
  .hint .ob-why { color: var(--m-text); }

  /* the empty Mods panel */
  .ob-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 44px 24px; line-height: 20px; }
  .ob-empty .radar { margin-bottom: 6px; }
  .ob-empty b { color: var(--m-text); font-weight: 600; }
  .ob-empty > span { max-width: 290px; }
  .ob-empty .caps kbd { height: 18px; min-width: 18px; }
  .ob-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 10px; }

  /* one-time tip inside the share modal */
  .card .ob-tip { display: flex; align-items: flex-start; gap: 10px; margin: 16px 0 0; padding: 10px 12px; border: 1px solid var(--m-line); border-radius: var(--m-r-md);
    background: var(--m-raised); color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); }
  .card .ob-tip .radar { flex: none; margin-top: 3px; color: var(--m-text-2); }

  /* help pane */
  .pane[data-kind="help"] { max-height: min(calc(100vh - 168px), 520px); }
  .ob-help .ob-can { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 18px; margin: 0; padding: 0 8px 8px; list-style: none; }
  .ob-can li { display: flex; flex-direction: column; gap: 1px; padding: 5px 0; min-width: 0; }
  .ob-can b { color: var(--m-text); font: 500 var(--m-text-md)/18px var(--m-font); }
  .ob-can span { color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); }
  .ob-can .caps { vertical-align: 1px; }
  .ob-can .caps kbd { height: 18px; min-width: 18px; font-size: 10.5px; }
  .ob-help h4 { display: flex; align-items: baseline; gap: 10px; padding-top: 8px; border-top: 1px solid var(--m-line); margin: 4px 0 4px; padding-left: 8px; margin-left: 0; margin-right: 0; }
  .ob-help h4 span { color: var(--m-text-3); font: 400 var(--m-text-xs)/16px var(--m-font); text-transform: none; letter-spacing: 0; }
  /* examples: one row per category, sentences flow as chips */
  .ob-ex { display: flex; flex-direction: column; padding: 0 8px 6px; }
  .sheet .ob-ex section, .sheet .ob-ex section + section { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: start; gap: 8px; min-width: 0; padding: 3px 0; border-top: 0; }
  .ob-ex h5 { margin: 0; font: 500 var(--m-text-xs)/26px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ob-ex .chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
  .ob-ex .ex { max-width: 100%; height: 26px; padding: 0 10px; border: 1px solid var(--m-line-strong); border-radius: 999px; background: transparent; color: var(--m-text-2);
    font: 500 var(--m-text-sm)/24px var(--m-font); letter-spacing: var(--m-tracking); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background var(--m-fast), color var(--m-fast), border-color var(--m-fast); }
  .ob-ex .ex:hover, .bar .ob-ex .ex:focus-visible { background: var(--m-hover); color: var(--m-text); border-color: var(--m-signal-1); }
  .ob-help footer { justify-content: flex-start; flex-wrap: wrap; gap: 4px 8px; margin-top: 4px; }
  .ob-help footer > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ob-help footer > span:not(.dim) { color: var(--m-warn); }
  .ob-help footer .tbtn { font-family: var(--m-font); }
  .ob-help header .tbtn { display: inline-flex; align-items: center; gap: 8px; }

  @media (max-width: 560px) {
    .ob-help .ob-can { grid-template-columns: 1fr; }
    .sheet .ob-ex section, .sheet .ob-ex section + section { grid-template-columns: 1fr; gap: 2px; }
    .ob-steps { gap: 6px; } .ob-steps li + li::before { width: 8px; }
    /* the sentence on its own lines, the dot on its first line, the button under the words, × at the end */
    .ob-note { flex-wrap: wrap; align-items: flex-start; row-gap: 8px; } .ob-text { flex-basis: calc(100% - 16px); }
    .ob-note .ob-dot { margin-top: 6px; } .ob-note .btn { margin-left: 16px; } .ob-note .ob-close { margin-left: auto; }
  }
  /* a bar narrower than the three steps and Hide tips (the practice page on a phone): only the current step keeps its word */
  @media (max-width: 360px) {
    .ob-steps li:not(.now) { font-size: 0; gap: 0; } .ob-steps li:not(.now)::before { margin-right: 6px; }
  }
  :host([data-fx="off"]) .ob-coach { animation: none; }

  /* progressive reveal (59-onboarding.js): before the first saved change, the
     bar keeps to the basics. The Edit tools come with their shortcut. */
  :host([data-new]) .gm-qbtn, :host([data-new]) .gl-sug, :host([data-new]) .so-sug { display: none !important; }
  :host([data-new]:not([data-tools])) .gm { display: none !important; }

  /* the first saved change: a card where the toast goes, its mark settling into a check */
  .ob-win { position: fixed; left: 20px; bottom: 20px; width: min(400px, calc(100vw - 40px)); display: flex; gap: 14px; padding: 16px 16px 14px;
    background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-lg); box-shadow: var(--m-shadow);
    font: 400 var(--m-text-sm)/18px var(--m-font); letter-spacing: var(--m-tracking); pointer-events: auto; animation: rise2 var(--m-med) var(--m-ease); }
  .ob-win-mark { position: relative; flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: var(--m-r-md); background: var(--m-raised); color: var(--m-text); }
  .ob-win-mark .radar { position: absolute; }
  .ob-win-mark .radar rect { animation: ob-gather 900ms var(--m-ease) both !important; }
  .ob-win-mark .radar rect.o { opacity: .35; }
  .ob-win-check { position: absolute; opacity: 0; stroke-dasharray: 16; stroke-dashoffset: 16; animation: ob-check 420ms var(--m-ease) 820ms forwards; }
  @keyframes ob-gather { 0% { transform: scale(1); opacity: 1; } 60% { opacity: 1; } 100% { transform: scale(.2); opacity: 0; } }
  .ob-win-mark .radar rect { transform-box: fill-box; transform-origin: center; }
  @keyframes ob-check { to { opacity: 1; stroke-dashoffset: 0; } }
  .ob-win-body { min-width: 0; flex: 1; }
  .ob-win-body > b { display: block; font: 600 var(--m-text-md)/20px var(--m-font); margin-bottom: 4px; }
  .ob-win-body p { margin: 0; color: var(--m-text-2); }
  .ob-win-body h4 { margin: 12px 0 6px; } /* .eyebrow (99-css.js) */
  .ob-win-body ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .ob-win-body li { display: flex; flex-direction: column; }
  .ob-win-body li b { font-weight: 500; color: var(--m-text); }
  .ob-win-body li span { color: var(--m-text-2); }
  .ob-win .caps kbd { height: 18px; min-width: 18px; padding: 0 4px; font-size: 10.5px; }
  .ob-win .caps { gap: 3px; vertical-align: 1px; }
  .ob-win-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .ob-win-row > span { margin-left: auto; color: var(--m-text-3); font-size: var(--m-text-xs); }
  :host([data-fx="off"]) .ob-win, :host([data-fx="off"]) .ob-win-mark .radar rect, :host([data-fx="off"]) .ob-win-check { animation-duration: 1ms !important; animation-delay: 0s !important; }
  @media (prefers-reduced-motion: reduce) { .ob-win-check { animation-delay: 0s !important; } }
`; }
