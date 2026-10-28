// The window's only door to Morse Desktop: window.morse, a frozen object of
// plain functions, one per request in ipc.js API (same names, same order).
// No ipcRenderer, no Node, no Electron object reaches the page. Sandboxed
// preloads are CommonJS and can only require "electron".
const { contextBridge, ipcRenderer } = require("electron");

const NAMES = [
  "state", "refreshApps", "openApp", "openBar", "nativeControls", "nativeSetup", "disconnectApp", "addApp",
  "modelChoices", "probeEndpoint", "chooseModel", "setFastMode", "checkModel",
  "setModOn", "deleteMod", "undeleteMod", "setAllModsOff", "runChecks", "setStartAtLogin", "setAutoOpen", "setOpenShortcut", "openLink", "finishWelcome", "installUpdate", "updateLater", "checkForUpdate", "downloadUpdate",
];

const api = {};
for (const name of NAMES) {
  const channel = `morse:${name}`;
  // Only plain values go across, and only as many as the request takes.
  api[name] = (...args) => ipcRenderer.invoke(channel, ...args.map(a => (a === null || ["string", "boolean", "number", "undefined"].includes(typeof a) ? a : undefined)));
}
// Something changed (an app connected, a mod was saved, Chrome paired): the
// callback gets the new state (plain data, the same as state()), never the
// event object.
api.onChange = fn => {
  if (typeof fn !== "function") return () => {};
  const listener = (_event, state) => fn(state);
  ipcRenderer.on("morse:changed", listener);
  return () => ipcRenderer.removeListener("morse:changed", listener);
};

contextBridge.exposeInMainWorld("morse", Object.freeze(api));
