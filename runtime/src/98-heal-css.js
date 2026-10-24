// Self-heal (71-heal.js): the dot on the Morse mark while a mod here stopped
// working after the site changed, and the "Fixed" note with Share the fix.
// The note itself is the panel's .health (99-css.js).
function HEAL_CSS() {
  return `
  .bar[data-heal] .row > .mark, .panel[data-heal] header > .mark { position: relative; }
  .bar[data-heal] .row > .mark::after, .panel[data-heal] header > .mark::after { content: ""; position: absolute; top: -3px; right: -3px; width: 7px; height: 7px;
    border-radius: 50%; background: var(--m-danger); box-shadow: 0 0 0 2px var(--m-surface); pointer-events: none; }
  .health.heal-fixed b::before { background: var(--m-signal-3); }
  `;
}
