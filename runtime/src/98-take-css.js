// Take this, Bring here (73-take.js): the card in the bar, the Bring here
// list, and Taken from other apps in the Mods panel. Buttons, key caps and
// eyebrows come from 99-css.js and 98-bar-css.js; tokens only.
function TAKE_CSS() { return `
  /* ---- the picture of a taken feature */
  .tk-pic { flex: none; display: grid; place-items: center; width: 64px; height: 40px; border-radius: var(--m-r-sm); overflow: hidden;
    background: var(--m-hover); border: 1px solid var(--m-line); color: var(--m-text-3); }
  .tk-pic img { width: 100%; height: 100%; object-fit: cover; object-position: left top; display: block; }
  :host([data-page-inverted]) .tk-pic img { filter: invert(1) hue-rotate(180deg); }
  .tk-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .tk-meta b { font: 550 var(--m-text-md)/20px var(--m-font); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tk-meta small { font: 400 var(--m-text-sm)/16px var(--m-font); color: var(--m-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tk-btns { display: flex; align-items: center; gap: 8px; flex: none; }

  /* ---- in the bar: what was just taken, or what is being brought */
  .tk-card { display: flex; align-items: flex-start; gap: 12px; padding-block: 12px; padding-inline: 16px 12px; border-bottom: 1px solid var(--m-line); }
  .tk-card .eyebrow { margin-bottom: 2px; }
  .tk-card.bring { align-items: center; padding-block: 8px; }
  .tk-card.bring .tk-pic { width: 48px; height: 30px; }
  .tk-about { margin: 6px 0 0; color: var(--m-text-2); font: 400 var(--m-text-sm)/18px var(--m-font); white-space: pre-line;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .tk-about.busy { display: flex; align-items: center; gap: 8px; color: var(--m-text-3); }
  .tk-card .tk-btns { align-self: center; }

  /* ---- Bring here…: the list in the bar */
  .tk-pick { padding: 12px 8px 8px; }
  .tk-pick header { display: flex; flex-direction: column; padding: 0 8px 8px; }
  .tk-pick header b { font: 550 var(--m-text-md)/20px var(--m-font); color: var(--m-text); }
  .tk-pick header small { font: 400 var(--m-text-sm)/16px var(--m-font); color: var(--m-text-3); }
  .tk-list { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow: auto; scrollbar-width: thin; }
  .tk-it { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--m-r-md);
    background: none; color: var(--m-text); text-align: start; cursor: pointer; font: inherit; }
  .tk-it:hover, .tk-it:focus-visible { background: var(--m-hover); border-color: var(--m-line); }
  .tk-empty { margin: 0; padding: 8px; color: var(--m-text-2); font-size: var(--m-text-sm); line-height: 18px; }
  .tk-note { margin: 8px 8px 0; color: var(--m-text-3); font: 400 var(--m-text-xs)/16px var(--m-font); }

  /* ---- the chips beside the suggestions */
  .sug.tk-sug { gap: 6px; padding-inline-start: 8px; }
  .sug.tk-sug svg { color: var(--m-text-2); }
  /* progressive reveal (59-onboarding.js): like Show me once, they wait until the first saved change; the ⋯ menu has them */
  :host([data-new]) .sug.tk-sug { display: none !important; }

  /* ---- the Mods panel: Taken from other apps */
  .tk-site { margin: 8px 4px 4px; padding-top: 12px; border-top: 1px solid var(--m-line); }
  .tk-site h4 { margin: 0 8px 8px; }
  .tk-item { display: flex; align-items: flex-start; gap: 12px; padding: 10px; border-bottom: 1px solid var(--m-line); overflow-wrap: anywhere; }
  .tk-item:last-of-type { border-bottom: 0; }
  .tk-item .tk-meta p { margin: 4px 0 0; color: var(--m-text-2); font: 400 var(--m-text-sm)/16px var(--m-font); white-space: pre-line;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .tk-item .tk-btns { margin-top: 8px; }

  @media (max-width: 560px) { .tk-card .tk-pic { display: none; } .tk-card { flex-wrap: wrap; } }
`; }
