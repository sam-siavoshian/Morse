// Mods are applied by boot.js (it runs before the UI exists and keeps running
// across navigations); the UI uses the same functions and the same S.mods.
// After every sync the boot calls the UI's modsChanged() (97-boot.js), which
// re-renders the panel when it's open.
const { setCss, applyMod, removeMod, syncMods } = B;
