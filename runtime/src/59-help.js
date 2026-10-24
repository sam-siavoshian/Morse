// The help pane: what Morse can do, and example sentences by category. Click
// one to put it in the input. Opened from Help in the bar's menu, F1 while the
// bar is open, "Examples" in the `?` cheat sheet, the coach and the empty Mods
// panel. Keys live in the cheat sheet (96-shortcuts.js); this links there
// instead of repeating them.

const HELP_EXAMPLES = [
  ["Looks", ["Make the buttons rounder", "Use a softer background color", "Make this text bigger"]],
  ["Layout", ["Make the main column wider", "Move the sidebar to the left", "Put these side by side"]],
  ["New buttons", ["Add a button that copies this as Markdown", "Add a back-to-top button"]],
  ["Hiding things", ["Hide this", "Hide the ads and banners", "Hide the comments"]],
  ["Reading", ["Make this easier to read", "Show reading time under the title"]],
  ["Media", ["Add a sleep timer", "Add playback speed buttons", "Make the player controls bigger"]],
  ["Writing", ["Show a word count under this box", "Make this box taller"]],
];

function helpAbilities() {
  const k = id => (hotkey(id) ? caps(hotkey(id)) : "");
  // The edit toolbar: its own hotkey if one is set, else the primary key + E on a picked element (45-godmode.js).
  const edit = typeof GodMode === "undefined" ? "" : hotkey("edit") ? caps(hotkey("edit")) : caps([primaryMod, "E"]);
  return [
    ["Describe a change", `Point at something first, or just describe a change to the whole page.`],
    hotkey("talk") && ["Talk instead of typing", `Hold ${k("talk")} and say it.`],
    edit && ["Use the edit tools", `Point at something, then press ${edit} to hide, move, resize, recolor or rename it. No model needed.`],
    typeof GodQuick !== "undefined" && ["Page tools", `Dark mode, bigger text, focus mode and more, from the tools button in the bar.`],
    ["Save, undo, share", `Every change you save is a mod. ${hotkey("mods") ? `${k("mods")} opens Mods` : "Mods"} to turn them off, edit or share them.`],
  ].filter(Boolean);
}

function helpSetup() {
  const st = Onboarding.state(), status = Onboarding.status();
  const rows = [];
  if (modelMissing(status, S.label)) rows.push(`<span>No model connected</span><button type="button" class="tbtn" data-ob="model">Connect a model</button>`);
  else if (S.label) rows.push(`<span class="dim">Model: ${esc(S.label)}</span>`);
  if (status.userScripts === false) rows.push(`<button type="button" class="tbtn" data-ob="userscripts">Turn on Allow User Scripts</button>`);
  if (st) rows.push(`<button type="button" class="tbtn" data-ob="tour">Show the 3 steps again</button>`);
  return rows.join("");
}

function renderHelp() {
  if (paneKind !== "help") return;
  pane.innerHTML = `<div class="sheet ob-help" role="group" aria-label="Help">
    <header><b>What you can do</b><button type="button" class="tbtn" data-act="keys">Keyboard shortcuts <span class="caps"><kbd>?</kbd></span></button></header>
    <ul class="ob-can">${helpAbilities().map(([t, d]) => `<li><b>${esc(t)}</b><span>${d}</span></li>`).join("")}</ul>
    <h4>Try saying <span>Click one to use it</span></h4>
    <div class="ob-ex">${HELP_EXAMPLES.map(([cat, list]) => `<section><h5>${esc(cat)}</h5><div class="chips">${list.map(s =>
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
addEventListener("keydown", e => {
  if (e.key !== "F1" || !S.open || !modal.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  toggleHelp();
}, true);
