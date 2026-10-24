// Runs sandboxed, in its own isolated world: the page sees only window.tunes.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tunes", {
  info: () => ipcRenderer.invoke("tunes:info"),
  openMiniPlayer: () => ipcRenderer.send("tunes:mini"),
  command: cmd => ipcRenderer.send("tunes:command", String(cmd)),
  onCommand: fn => ipcRenderer.on("tunes:command", (_e, cmd) => fn(cmd)),
});
