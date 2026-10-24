// Styles for user control (63-control.js): the action toast, the pause strip
// and backup row in the Mods panel, provenance lines, and the plain-language
// summary in the install review and Show code. Tokens only (design/tokens.css),
// 4px grid. Joined into the shadow root's <style> by a hook in 10-dom.js.
function CONTROL_CSS() { return `
  /* ---- toast with actions */
  .ctl-toast { position: fixed; left: 20px; bottom: 20px; width: max-content; max-width: min(440px, calc(100vw - 40px)); pointer-events: auto;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start;
    background: var(--m-surface); color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-md); box-shadow: var(--m-shadow);
    font: 450 var(--m-text-md)/20px var(--m-font); letter-spacing: var(--m-tracking); animation: rise2 var(--m-med) var(--m-ease); }
  .ctl-toast[hidden] { display: none; }
  .ctl-msg { grid-column: 1; grid-row: 1; display: flex; align-items: flex-start; gap: 10px; padding: 9px 4px 9px 12px; min-width: 0; }
  .ctl-msg .radar { flex: none; color: var(--m-text-2); margin-top: 4px; }
  .ctl-msg span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .ctl-msg b { font-weight: 600; }
  .ctl-toast .ctl-x { grid-column: 2; grid-row: 1; width: 24px; height: 24px; margin: 7px 6px 0 0; padding: 0; display: grid; place-items: center; border: 0; border-radius: var(--m-r-sm);
    background: none; color: var(--m-text-3); font-size: 16px; line-height: 1; }
  .ctl-toast .ctl-x:hover { color: var(--m-text); background: var(--m-hover); }
  .ctl-acts { grid-column: 1 / -1; grid-row: 2; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 0 12px 12px; }
  /* one short message and one action: a single 40px row */
  .ctl-toast.inline { grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; }
  .ctl-toast.inline .ctl-msg { padding-right: 12px; }
  .ctl-toast.inline .ctl-acts { grid-column: 2; grid-row: 1; padding: 0; }
  .ctl-toast.inline .ctl-x { grid-column: 3; margin: 0 6px 0 4px; }
  .ctl-acts button { background: transparent; color: var(--m-text); border: 1px solid var(--m-line-strong); border-radius: var(--m-r-sm);
    height: 28px; padding: 0 10px; font: 500 var(--m-text-sm)/18px var(--m-font); white-space: nowrap; transition: background var(--m-fast), border-color var(--m-fast); }
  .ctl-acts button:hover { background: var(--m-hover); border-color: var(--m-signal-1); }

  /* ---- Mods panel: pause strip, notices */
  .ctl-strip { padding: 4px 8px 8px; border-bottom: 1px solid var(--m-line); }
  .ctl-row { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: var(--m-r-md); cursor: pointer; }
  .ctl-row:hover { background: var(--m-raised); }
  .ctl-l { flex: 1; min-width: 0; display: block; }
  .ctl-l > span { display: block; font-weight: 550; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctl-l small { display: block; color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 16px; }
  .ctl-row .sw { flex: none; display: block; }
  .ctl-note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 0; padding: 8px 8px 8px 12px; border: 1px solid var(--m-line-strong);
    border-radius: var(--m-r-md); background: var(--m-raised); font-size: var(--m-text-sm); line-height: 16px; }
  .ctl-note span { flex: 1 1 180px; min-width: 0; color: var(--m-text); overflow-wrap: anywhere; }
  .panel .ctl-note button { height: 24px; padding: 0 8px; }

  /* ---- Mods panel: where it came from, Show code */
  .meta .ctl-origin { margin-top: 4px; color: var(--m-text-3); font-size: var(--m-text-sm); line-height: 16px; overflow-wrap: anywhere; }
  .panel .ctl-link, .ctl-link { height: 16px; padding: 0; margin-left: 4px; border: 0; background: none; color: var(--m-text-2); font: 500 var(--m-text-sm)/16px var(--m-font);
    letter-spacing: var(--m-tracking); text-decoration: underline; text-decoration-color: var(--m-line-strong); text-underline-offset: 3px; border-radius: 2px; }
  .panel .ctl-link:hover { background: none; color: var(--m-text); text-decoration-color: currentColor; }

  /* ---- Mods panel: backup row */
  .ctl-backup { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 16px; border-top: 1px solid var(--m-line); }
  .ctl-backup > span { flex: 1; min-width: 0; font: 500 var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); text-transform: uppercase; letter-spacing: .06em; }
  .ctl-backup button { flex: none; }

  /* ---- summary: install review and Show code */
  .ctl-card { width: min(640px, calc(100vw - 32px)); }
  .ctl-review + .ctl-review { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--m-line); }
  .ctl-review h3 { margin: 0 0 4px; font-size: var(--m-text-lg); line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
  .ctl-prompt { margin: 0; color: var(--m-text-2); overflow-wrap: anywhere; }
  .ctl-from { margin: 4px 0 0; color: var(--m-text-3); font: 11px/16px var(--m-mono); letter-spacing: 0; overflow-wrap: anywhere; }
  .ctl-from span { color: var(--m-text); }
  .ctl-h { margin: 16px 0 8px; font: 500 var(--m-text-xs)/16px var(--m-mono); color: var(--m-text-3); text-transform: uppercase; letter-spacing: .06em; }
  .ctl-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .ctl-items li { position: relative; padding-left: 20px; }
  .ctl-items li::before { content: ""; position: absolute; left: 4px; top: 7px; width: 6px; height: 6px; border-radius: 1.5px; background: var(--m-signal-3); }
  .ctl-items b { display: block; font-weight: 500; line-height: 20px; }
  .ctl-items small { display: block; color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 16px; }
  .ctl-warn { margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--m-line-strong); border-left: 2px solid var(--m-warn); border-radius: var(--m-r-sm);
    background: var(--m-raised); color: var(--m-text); line-height: 20px; overflow-wrap: anywhere; }
  .ctl-warn b { display: block; color: var(--m-warn); font: 600 var(--m-text-xs)/16px var(--m-mono); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 2px; }
  .ctl-code { margin-top: 12px; }
  .ctl-code summary { display: inline-flex; align-items: center; gap: 6px; height: 28px; cursor: pointer; color: var(--m-text-2); font-weight: 500; border-radius: var(--m-r-sm); list-style: none; }
  .ctl-code summary::-webkit-details-marker { display: none; }
  .ctl-code summary::before { content: ""; width: 0; height: 0; border-style: solid; border-width: 4px 0 4px 6px; border-color: transparent transparent transparent currentColor; transition: transform var(--m-fast); }
  .ctl-code[open] summary::before { transform: rotate(90deg); }
  .ctl-code summary:hover { color: var(--m-text); }
  .ctl-code summary:focus-visible { outline: 2px solid var(--m-signal-3); outline-offset: 2px; }
  .ctl-pre { min-height: 0; max-height: 280px; resize: none; }
  .card .ctl-pre + label, .card .ctl-code label:first-of-type { margin-top: 12px; }
  .ctl-skip { margin: 12px 0 0; font-size: var(--m-text-sm); }
  @media (max-width: 560px) { .ctl-backup { flex-wrap: wrap; } .ctl-backup > span { flex-basis: 100%; } }
`; }
