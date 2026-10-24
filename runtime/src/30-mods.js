// Mods are applied by boot.js (it runs before the UI exists and keeps running
// across navigations), with the same rules: the off switch, pauses and safe
// start (63-control.js reads the boot's Control), repair health (70-panel.js),
// and a toast when a mod can't run. The UI uses the same functions and the
// same S.mods; after every sync the boot calls the UI's modsChanged()
// (97-boot.js), which re-renders the panel when it's open.
const { setCss, applyMod, removeMod, syncMods } = B;
