// Mods are applied by boot.js (it runs before the UI exists and keeps running
// across navigations); the UI uses the same functions and the same S.mods.
const { setCss, applyMod, removeMod } = B;
async function syncMods() {
  await B.syncMods();
  if (!panel.hidden) renderPanel();
}
