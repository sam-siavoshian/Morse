// The help pane: what Morse can do, and example sentences by category. Click
// one to put it in the input. Opened from Help in the bar's menu, F1 while the
// bar is open, "Examples" in the `?` cheat sheet, the coach and the empty Mods
// panel. Keys live in the cheat sheet (96-shortcuts.js); this links there
// instead of repeating them.

// [category, how many examples]: message ids "help.cat.<category>" and
// "help.ex.<category>.<i>" (core/locales/en.js), so the examples are in the
// person's language, like what they'd type.
const HELP_EXAMPLES = () => [["looks", 3], ["layout", 3], ["buttons", 2], ["hiding", 3], ["reading", 2], ["media", 3], ["writing", 2]]
  .map(([cat, n]) => [t(`help.cat.${cat}`), Array.from({ length: n }, (_, i) => t(`help.ex.${cat}.${i + 1}`))]);

function helpAbilities() {
  const k = id => (hotkey(id) ? caps(hotkey(id)) : "");
  // The edit toolbar: its own hotkey if one is set, else the primary key + E on a picked element (45-godmode.js).
  const edit = typeof GodMode === "undefined" ? "" : hotkey("godmode") ? caps(hotkey("godmode")) : caps([primaryMod, "E"]);
  return [
    [t("bar.input"), esc(t("help.describe"))],
    hotkey("talk") && [t("help.talk"), t("help.talk.d", { key: k("talk") })],
    edit && [t("help.edit"), t("help.edit.d", { key: edit })],
    typeof GodQuick !== "undefined" && [t("quick.title"), esc(t("help.quick.d"))],
    [t("help.save"), hotkey("mods") ? t("help.save.d", { key: k("mods") }) : esc(t("help.save.dNoKey"))],
  ].filter(Boolean);
}

function helpSetup() {
  const st = Onboarding.state(), status = Onboarding.status();
  const rows = [];
  if (modelMissing(status, S.label)) rows.push(`<span>${t("help.noModel")}</span><button type="button" class="tbtn" data-ob="model">${t("welcome.model.b")}</button>`);
  else if (S.label) rows.push(`<span class="dim">${t("help.model", { label: esc(S.label) })}</span>`);
  return rows.join("");
}

function renderHelp() {
  if (paneKind !== "help") return;
  pane.innerHTML = `<div class="sheet ob-help" role="group" aria-label="${esc(t("help.label"))}">
    <header><b>${t("help.title")}</b><button type="button" class="tbtn" data-act="keys">${t("menu.shortcuts")} <span class="caps"><kbd>?</kbd></span></button></header>
    <ul class="ob-can">${helpAbilities().map(([title, d]) => `<li><b>${esc(title)}</b><span>${d}</span></li>`).join("")}</ul>
    <h4>${t("help.try")} <span>${t("help.tryHint")}</span></h4>
    <div class="ob-ex">${HELP_EXAMPLES().map(([cat, list]) => `<section><h5>${esc(cat)}</h5><div class="chips">${list.map(s =>
      `<button type="button" class="ex" data-ex="${esc(s)}" title="${esc(s)}">${esc(s)}</button>`).join("")}</div></section>`).join("")}</div>
    <footer>${helpSetup()}</footer>
  </div>`;
}

function toggleHelp() {
  if (!S.open) openBar();
  if (paneKind === "help") return closePane();
  showPane("help");
  renderHelp();
  pane.querySelector(".ex")?.focus({ preventScroll: true });
}

pane.addEventListener("click", e => {
  if (e.target.closest("[data-act=help]")) return toggleHelp(); // "Examples" in the cheat sheet
  if (paneKind !== "help") return;
  const ex = e.target.closest("[data-ex]");
  if (ex) { setInput(ex.dataset.ex); closePane(); return; }
  if (e.target.closest("[data-act=keys]")) { showPane("shortcuts"); return; }
  const ob = e.target.closest("[data-ob]");
  if (ob) Onboarding.act(ob.dataset.ob, ob);
});

// F1 toggles help while the bar is open; the page keeps F1 otherwise.
listen("keydown", e => {
  if (!e.isTrusted || e.key !== "F1" || !S.open || !modal.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  toggleHelp();
}, true);
