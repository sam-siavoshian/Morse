// The cheat sheet: `?` in an empty input. Built from the live settings, so it
// always shows the keys that actually work.

function renderShortcuts() {
  const talkSame = hotkey("talk") && hotkey("talk") === hotkey("open");
  const enter = PLATFORM === "mac" ? "↩" : "Enter";
  const groups = [
    [t("keys.anywhere"), [
      [t("keys.open"), hotkey("open") ? caps(hotkey("open")) : caps([])],
      [t("bar.talk"), hotkey("talk") ? `${caps(hotkey("talk"))}${talkSame ? `<small>${t("menu.hold")}</small>` : ""}` : caps([])],
      [t("hk.mods"), caps(hotkey("mods"))],
      [t("hk.godmode"), caps(hotkey("godmode"))],
      [t("hk.off"), caps(hotkey("off"))], // user control (63-control.js)
    ]],
    [t("keys.inBar"), [
      [t("bar.send"), caps([enter])],
      [t("keys.newLine"), caps([PLATFORM === "mac" ? "⇧" : "Shift", enter])],
      [t("menu.keypick"), caps(KEYPICK_COMBO)], // 41-keypick.js
      [t("keys.past"), caps(["↑", "↓"])],
      [t("bar.stop"), `${caps(["Esc"])}<small>${t("keys.or")}</small>${caps([primaryMod, "."])}`],
      [t("menu.settings"), caps([primaryMod, ","])],
      [t("bar.suggestions"), caps([PLATFORM === "mac" ? "⇥" : "Tab"])],
      [t("keys.thisList"), caps(["?"])],
      [t("btn.close"), caps(["Esc"])],
    ]],
  ];
  pane.innerHTML = `<div class="sheet kbsheet" role="group" aria-label="${esc(t("menu.shortcuts"))}">
    <header><b>${t("menu.shortcuts")}</b><button type="button" class="tbtn" data-act="help">${t("keys.examples")}</button><!-- onboarding hook: 59-help.js --><button type="button" class="tbtn" data-act="settings">${t("keys.change")}</button></header>
    <div class="cols">${groups.map(([title, rows]) => `<section><h4>${title}</h4>${rows.map(([l, k]) => `<div class="krow"><span>${esc(l)}</span><span class="k">${k}</span></div>`).join("")}</section>`).join("")}</div>
  </div>`;
  pane.querySelector("[data-act=settings]").onclick = () => toggleSettings();
}
