// The cheat sheet: `?` in an empty input. Built from the live settings, so it
// always shows the keys that actually work.

function renderShortcuts() {
  const talkSame = hotkey("talk") && hotkey("talk") === hotkey("open");
  const enter = PLATFORM === "mac" ? "↩" : "Enter";
  const groups = [
    ["Anywhere", [
      ["Open or close Morse", hotkey("open") ? caps(hotkey("open")) : caps([])],
      ["Talk", hotkey("talk") ? `${caps(hotkey("talk"))}${talkSame ? `<small>hold</small>` : ""}` : caps([])],
      ["Mods panel", caps(hotkey("mods"))],
      ["God mode", caps(hotkey("godmode"))],
    ]],
    ["In the bar", [
      ["Run", caps([enter])],
      ["New line", caps([PLATFORM === "mac" ? "⇧" : "Shift", enter])],
      ["Previous prompts", caps(["↑", "↓"])],
      ["Stop the model", `${caps(["Esc"])}<small>or</small>${caps([primaryMod, "."])}`],
      ["Settings", caps([primaryMod, ","])],
      ["Suggestions", caps([PLATFORM === "mac" ? "⇥" : "Tab"])],
      ["This sheet", caps(["?"])],
      ["Close", caps(["Esc"])],
    ]],
  ];
  pane.innerHTML = `<div class="sheet kbsheet" role="group" aria-label="Keyboard shortcuts">
    <header><b>Keyboard shortcuts</b><button type="button" class="tbtn" data-act="help">Examples</button><!-- onboarding hook: 59-help.js --><button type="button" class="tbtn" data-act="settings">Change…</button></header>
    <div class="cols">${groups.map(([title, rows]) => `<section><h4>${title}</h4>${rows.map(([l, k]) => `<div class="krow"><span>${esc(l)}</span><span class="k">${k}</span></div>`).join("")}</section>`).join("")}</div>
  </div>`;
  pane.querySelector("[data-act=settings]").onclick = () => toggleSettings();
}
