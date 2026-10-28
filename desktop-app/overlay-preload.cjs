// Preload for the overlay window only (not the main Morse window — that uses
// preload.cjs). It exposes the small surface the overlay page needs:
//   setInteractive(on)  toggle the window's click-through (hit-testing the bar)
//   onOpen(cb)          the app opened Morse on this app (the hotkey)
//   native(message)     the bar's "apply a change" messages → the native session
//
// Sandboxed preloads are CommonJS and may require only "electron". No
// ipcRenderer, Node, or Electron object reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

let openCb = null;
ipcRenderer.on("morse-overlay:open", () => { try { openCb && openCb(); } catch {} });

contextBridge.exposeInMainWorld("morseOverlay", Object.freeze({
  setInteractive: on => ipcRenderer.send("morse-overlay:interactive", !!on),
  onOpen: cb => { openCb = typeof cb === "function" ? cb : null; },
  // Only plain data crosses. Resolves with the native backend's reply.
  native: message => ipcRenderer.invoke("morse-overlay:native", message && typeof message === "object" ? message : {}),
}));
