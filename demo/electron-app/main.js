// Tunes: a small Electron app shaped like real ones, so Morse can be tried on
// a real Electron runtime instead of Chromium pretending to be an app.
//
// What it has, because real apps have it:
//   - the main window loads its UI from a custom scheme (app://tunes/), like
//     Obsidian or Figma; the UI is demo/sites/tunes plus renderer.js
//   - a preload that exposes a small API with contextBridge; contextIsolation
//     and the renderer sandbox are on, Node integration is off
//   - a <webview> (the Lyrics panel) whose page comes from a local server on
//     a random port, like Slack or Discord guests
//   - a second window (Mini Player, from the menu or Ctrl+Shift+M) loaded
//     from a file:// page
//   - an application menu with accelerators, and a single-instance lock
//
// Run it unpacked:   electron demo/electron-app
// Or packaged:       node demo/electron-app/build.js /opt/Tunes  →  /opt/Tunes/tunes
//
// --user-data-dir=<dir> keeps a test's profile apart (Electron reads it too,
// this just makes it explicit before the single-instance lock).

const { app, BrowserWindow, Menu, protocol, ipcMain, net } = require("electron");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const dataDir = app.commandLine.getSwitchValue("user-data-dir");
if (dataDir) app.setPath("userData", dataDir);

// The UI: ui/ when packaged (build.js copies it), demo/sites/tunes from the repo.
const UI = [path.join(__dirname, "ui"), path.join(__dirname, "..", "sites", "tunes")].find(d => fs.existsSync(path.join(d, "index.html")));

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let main = null, mini = null, lyricsUrl = null;

// The Lyrics panel's page, served on a random localhost port.
function lyricsServer() {
  const page = `<!doctype html><meta charset="utf-8"><title>Lyrics</title>
<style>body{margin:0;padding:14px 18px;background:#1b1530;color:#e9e4ff;font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
h3{margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a99bd6}p{margin:0}.now{color:#fff;font-weight:700}</style>
<h3>Neon Tides · Hollow Coast</h3>
<p>Saltwater signals under the pier</p><p class="now">we kept the porch light on all year</p><p>neon tides, and nobody near</p>`;
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (req.url !== "/lyrics") return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
    });
    srv.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${srv.address().port}/lyrics`));
  });
}

const prefs = { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false };

function openMain() {
  main = new BrowserWindow({ width: 1280, height: 800, x: 0, y: 0, title: "Tunes", backgroundColor: "#000000",
    webPreferences: { ...prefs, webviewTag: true } });
  main.loadURL("app://tunes/index.html");
  main.on("closed", () => { main = null; });
}

function openMini() {
  if (mini) return mini.focus();
  mini = new BrowserWindow({ width: 380, height: 150, x: 860, y: 40, title: "Mini Player", resizable: false, backgroundColor: "#121212",
    webPreferences: prefs });
  mini.loadURL(pathToFileURL(path.join(__dirname, "mini.html")).href);
  mini.on("closed", () => { mini = null; });
}

function menu() {
  const playback = cmd => () => main?.webContents.send("tunes:command", cmd);
  return Menu.buildFromTemplate([
    { label: "Tunes", submenu: [
      { label: "Mini Player", accelerator: "CmdOrCtrl+Shift+M", click: openMini },
      { type: "separator" },
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "quit", accelerator: "CmdOrCtrl+Q" },
    ] },
    { label: "Playback", submenu: [
      { label: "Play / Pause", accelerator: "CmdOrCtrl+P", click: playback("play-pause") },
      { label: "Next", accelerator: "CmdOrCtrl+Right", click: playback("next") },
    ] },
    { role: "help", submenu: [{ label: `About Tunes ${app.getVersion()}`, enabled: false }] },
  ]);
}

app.on("second-instance", () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });

app.whenReady().then(async () => {
  lyricsUrl = await lyricsServer();
  protocol.handle("app", req => {
    const { host, pathname } = new URL(req.url);
    if (host !== "tunes") return new Response("not found", { status: 404 });
    if (pathname === "/renderer.js") return net.fetch(pathToFileURL(path.join(__dirname, "renderer.js")).href);
    const file = path.join(UI, path.normalize(pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(UI)) return new Response("no", { status: 403 });
    if (file.endsWith("index.html")) {
      // The shared demo UI plus the app's own renderer script.
      const html = fs.readFileSync(file, "utf8").replace("</body>", `<script src="app://tunes/renderer.js"></script>\n</body>`);
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return net.fetch(pathToFileURL(file).href);
  });
  ipcMain.handle("tunes:info", () => ({ version: app.getVersion(), electron: process.versions.electron, lyricsUrl }));
  ipcMain.on("tunes:mini", openMini);
  ipcMain.on("tunes:command", (_e, cmd) => main?.webContents.send("tunes:command", cmd));
  Menu.setApplicationMenu(menu());
  openMain();
  app.on("activate", () => { if (!main) openMain(); });
});

app.on("window-all-closed", () => app.quit());
