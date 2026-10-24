addEventListener("keydown", e => {
  const morseKey = e.code === "Space" && ((e.altKey && !e.ctrlKey && !e.metaKey) || (e.ctrlKey && e.shiftKey));
  if (morseKey) { e.preventDefault(); e.stopPropagation(); S.open ? closeBar() : openBar(); return; }
  if (e.code === "KeyM" && e.altKey && e.shiftKey) { e.preventDefault(); panel.hidden ? openPanel() : (panel.hidden = true); return; }
  if (e.key === "Escape") { if (!modal.hidden) modal.hidden = true; else if (!panel.hidden) panel.hidden = true; else if (S.open) closeBar(); }
}, true);

onEvent(msg => {
  if (msg.type === "toggle") S.open ? closeBar() : openBar();
  if (msg.type === "panel") openPanel();
  if (msg.type === "mods.changed") syncMods();
});
