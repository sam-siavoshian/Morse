// Preload for the overlay window only (not the main Morse window — that uses
// preload.cjs). It exposes the one thing the overlay page needs that the page
// can't do itself: toggle the window's click-through so the bar is interactive
// while the rest of the overlay passes clicks to the app underneath.
//
// Sandboxed preloads are CommonJS and may require only "electron". No
// ipcRenderer, Node, or Electron object reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("morseOverlay", Object.freeze({
  // on=true: the bar should receive clicks. on=false: pass clicks through.
  setInteractive: on => ipcRenderer.send("morse-overlay:interactive", !!on),
}));
