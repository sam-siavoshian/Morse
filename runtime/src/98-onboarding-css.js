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
  .ob-steps .n { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 5px; border: 1px solid var(--m-line-strong); font: 500 10.5px/1 var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .ob-steps li.now { color: var(--m-text); }
  .ob-steps li.now .n { background: var(--m-primary); border-color: var(--m-primary); color: var(--m-primary-text); }
  .ob-steps li.done { color: var(--m-text-2); }
  .ob-steps li.done .n { background: var(--m-raised); color: var(--m-text); }
  .ob-hide { height: 24px; padding: 0 8px; margin: -2px 0; border: 0; border-radius: var(--m-r-sm); background: none; color: var(--m-text-3); font: 500 var(--m-text-xs)/24px var(--m-font); white-space: nowrap; }
  .ob-hide:hover { color: var(--m-text); background: var(--m-hover); }
  .ob-say { grid-column: 1 / -1; margin: 0; color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); }
  .ob-say b { color: var(--m-text); font-weight: 500; }
  .ob-say kbd { margin: 0 1px; }
  .ob-link { border: 0; background: none; padding: 0; margin-left: 2px; color: var(--m-text); font: 500 var(--m-text-sm)/18px var(--m-font);
    text-decoration: underline; text-decoration-color: var(--m-signal-1); text-underline-offset: 3px; }
  .ob-link:hover { text-decoration-color: var(--m-text); }

  /* one notice under the input (no model, user scripts off) */
  .ob-note { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; border-top: 1px solid var(--m-line); color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); }
  .ob-dot { flex: none; width: 6px; height: 6px; border-radius: 1.5px; background: var(--m-warn); }
  .ob-text { flex: 1; min-width: 0; }
  .ob-note button { flex: none; height: 28px; padding: 0 10px; border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm); background: transparent; color: var(--m-text);
    font: 500 var(--m-text-sm)/18px var(--m-font); white-space: nowrap; transition: background var(--m-fast), border-color var(--m-fast); }
  .ob-note button:hover { background: var(--m-hover); border-color: var(--m-signal-1); }
  .ob-note .ob-close { width: 28px; padding: 0; border-color: transparent; color: var(--m-text-3); font-size: 16px; line-height: 1; }
  .ob-note .ob-close:hover { border-color: transparent; color: var(--m-text); }

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
  .ob-ex { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 18px; padding: 0 0 4px; }
  .sheet .ob-ex section, .sheet .ob-ex section + section { min-width: 0; padding: 4px 0; border-top: 0; }
  .ob-ex h5 { margin: 0 8px 2px; font: 500 var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); letter-spacing: 0; }
  .ob-ex .ex { display: block; width: 100%; height: 28px; padding: 0 8px; border: 0; border-radius: var(--m-r-sm); background: none; color: var(--m-text); text-align: left;
    font: 450 var(--m-text-md)/28px var(--m-font); letter-spacing: var(--m-tracking); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background var(--m-fast); }
  .ob-ex .ex::before { content: "“"; color: var(--m-text-3); }
  .ob-ex .ex::after { content: "”"; color: var(--m-text-3); }
  .ob-ex .ex:hover, .bar .ob-ex .ex:focus-visible { background: var(--m-hover); }
  .ob-help footer { justify-content: flex-start; flex-wrap: wrap; gap: 4px 8px; margin-top: 4px; }
  .ob-help footer > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ob-help footer > span:not(.dim) { color: var(--m-warn); }
  .ob-help footer .tbtn { font-family: var(--m-font); }
  .ob-help header .tbtn { display: inline-flex; align-items: center; gap: 8px; }

  @media (max-width: 560px) {
    .ob-help .ob-can, .ob-ex { grid-template-columns: 1fr; }
    .ob-steps { gap: 6px; } .ob-steps li + li::before { width: 8px; }
    .ob-note { flex-wrap: wrap; } .ob-text { flex-basis: calc(100% - 60px); }
  }
  :host([data-fx="off"]) .ob-coach { animation: none; }
`; }
