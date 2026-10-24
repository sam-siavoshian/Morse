// Morse Desktop: Morse on your computer without a terminal. The Electron main
// process runs the same daemon code the `morse` command runs (service.js), so
// there is no Node to install. It shows one window (ui/), sits in the tray or
// menu bar, runs the Morse helper for Chrome in the background, and opens at
// login only when the person turns that on.
//
// Security: the window loads only ui/ from disk, with a strict CSP, context
// isolation and the sandbox on, and a preload (preload.cjs) that exposes one
// narrow API. It never loads remote content, never navigates, opens no other
// windows and asks for no permissions; requests from anything but that page
// are refused (ipc.js). Morse never changes another app's files: it opens
// apps with one extra switch (daemon/apps.js).
//
//   node desktop-app/run.js          start it from a clone
//   node desktop-app/build.js        package it (docs/dev/releasing.md)

import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, dialog, shell, session } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createService, loadDaemon } from "./service.js";
import { registerIpc, PUSH, pairCodeFromLink } from "./ipc.js";
import { markPng } from "./mark.js";
import { linuxIconFor } from "./icons.js";
import { setAutostart, writeMenuEntry } from "./linux.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "ui", "index.html");
const PAGE_URL = pathToFileURL(PAGE).href;
// Morse's page, whatever its query (?platform=…) says.
const isPage = url => { try { const u = new URL(url); u.search = ""; u.hash = ""; return u.href === PAGE_URL; } catch { return false; } };
const MAC = process.platform === "darwin", WIN = process.platform === "win32";
const log = (...a) => { if (!app.isPackaged || process.env.MORSE_DEBUG) console.log("[morse]", ...a); };

app.setName("Morse");

// One Morse at a time: a second start shows this window (and hands over a
// morse:// link Chrome opened).
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, service = null, quitting = false, lastState = null;
const startHidden = process.argv.includes("--hidden"); // opened at login: tray only

// ---------------------------------------------------------------- security
// Nothing but Morse's own page, in any web contents this app ever has.
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", e => e.preventDefault()); // the page never goes anywhere (a reload is not a navigation)
  contents.on("will-redirect", e => e.preventDefault());
  contents.on("will-attach-webview", e => e.preventDefault());
});

function lockSession() {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, _perm, done) => done(false));
  s.setPermissionCheckHandler(() => false);
  s.setDevicePermissionHandler?.(() => false);
  // The page loads only its own files. (The daemon's own requests, to your
  // model and to the Morse helper, come from Node in this process, not from
  // the page, and don't pass through here.)
  s.webRequest.onBeforeRequest((details, done) => {
    const ok = details.url.startsWith(pathToFileURL(HERE).href + "/") || details.url.startsWith(pathToFileURL(path.join(HERE, "..", "design")).href + "/") || details.url.startsWith("devtools://");
    if (!ok) log("blocked", details.url);
    done({ cancel: !ok });
  });
}

// Requests from Morse's page in Morse's window only, not from a frame inside
// it or from anything that navigated.
const isTrusted = event => !!win && !win.isDestroyed() && event.sender === win.webContents
  && event.senderFrame === win.webContents.mainFrame && isPage(event.senderFrame?.url);

// ---------------------------------------------------------------- icons
const appIcon = () => nativeImage.createFromBuffer(markPng(256, { tile: true }));
function trayIcon() {
  // macOS: a template image (black, the menu bar tints it). Elsewhere: light
  // on the usual dark panel.
  const color = MAC ? [0, 0, 0] : [237, 237, 239];
  const base = MAC ? 16 : 24;
  const img = nativeImage.createFromBuffer(markPng(base, { color, dim: 0.45 }), { scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, buffer: markPng(base * 2, { color, dim: 0.45 }) });
  if (MAC) img.setTemplateImage(true);
  return img;
}

// An app's own icon, as a data: URL for the list (or null: the list shows a letter).
async function iconFor(a) {
  if (MAC || WIN) {
    const img = await app.getFileIcon(a.path || a.exe, { size: MAC ? "large" : "normal" });
    return img.isEmpty() ? null : img.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
  }
  const file = linuxIconFor(a);
  if (!file) return null;
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? null : img.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
}

// ---------------------------------------------------------------- the window
function createWindow() {
  win = new BrowserWindow({
    width: 940, height: 660, minWidth: 760, minHeight: 520, show: false,
    title: "Morse", icon: MAC ? undefined : appIcon(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0c" : "#fbfbfb",
    ...(MAC ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 18 } } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.removeMenu?.();
  win.loadFile(PAGE, { query: { platform: process.platform } });
  win.once("ready-to-show", () => { if (!startHidden) win.show(); });
  // Closing the window keeps Morse in the tray; Quit (tray menu, ⌘Q) ends it.
  win.on("close", e => { if (!quitting) { e.preventDefault(); win.hide(); if (MAC) app.dock?.hide(); } });
  win.on("show", () => { if (MAC) app.dock?.show(); });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------- the tray
async function ask(appName) {
  const r = await dialog.showMessageBox(win?.isVisible() ? win : undefined, {
    type: "question", buttons: ["Restart", "Cancel"], defaultId: 0, cancelId: 1,
    message: `${appName} is open. Restart it with Morse?`,
    detail: "Morse can only connect to an app when it starts. Your work in it may be lost if it isn't saved.",
    checkboxLabel: `Always restart ${appName}`,
  });
  return r.response !== 0 ? null : r.checkboxChecked ? "a" : "y";
}

async function openFromTray(a) {
  let r = await service.openApp(a.id);
  if (r.needsRestart) {
    const answer = await ask(a.name);
    if (!answer) return;
    r = await service.openApp(a.id, { answer });
  }
  if (r.error) dialog.showMessageBox({ type: "warning", message: `Morse couldn't open ${a.name}.`, detail: r.error, buttons: ["OK"] });
}

function rebuildTray() {
  if (!tray) return;
  const st = lastState;
  const apps = (st?.apps || []).filter(a => a.canAttach !== false);
  const off = !!st?.pause?.all;
  const appItems = apps.length ? apps.map(a => {
    const on = a.state === "connected";
    return { label: on ? `${a.name}  ·  connected` : a.name, enabled: !["opening", "disconnecting"].includes(a.state), click: () => (on ? service.disconnectApp(a.id) : openFromTray(a)) };
  }) : [{ label: "No apps found", enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Morse", click: showWindow },
    { type: "separator" },
    { label: "Open an app with Morse", submenu: appItems },
    { label: "Turn all mods off", type: "checkbox", checked: off, click: item => service.setAllModsOff(item.checked) },
    { type: "separator" },
    { label: "Quit Morse", accelerator: MAC ? "Cmd+Q" : undefined, click: quit },
  ]));
  tray.setToolTip(off ? "Morse · all mods off" : "Morse");
}

// ---------------------------------------------------------------- start at login
async function setLoginItem(on) {
  if (process.platform === "linux") {
    const exec = process.env.APPIMAGE || process.execPath;
    const args = process.env.APPIMAGE || app.isPackaged ? [] : [app.getAppPath()];
    await setAutostart(on, { exec, args });
  } else app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
  return { ok: true };
}

// ---------------------------------------------------------------- morse:// links
function handleLink(url) {
  const code = pairCodeFromLink(url);
  if (!code) return;
  service?.pairRequest(code);
  showWindow();
}
app.on("open-url", (e, url) => { e.preventDefault(); app.whenReady().then(() => handleLink(url)); }); // macOS
app.on("second-instance", (_e, argv) => {
  const link = argv.find(a => a.startsWith("morse://"));
  if (link) handleLink(link); else showWindow();
});

function registerLinks() {
  // Packaged only: a clone started with run.js shouldn't take over morse:// links.
  if (!app.isPackaged) return;
  if (process.platform === "linux") {
    // The AppImage has no installer: Morse adds its own app menu entry, which
    // is what lets Chrome hand it morse:// links.
    const exec = process.env.APPIMAGE || process.execPath;
    writeMenuEntry({ exec }).then(() => app.setAsDefaultProtocolClient("morse")).catch(e => log("menu entry", e.message));
  } else app.setAsDefaultProtocolClient("morse");
}

// ---------------------------------------------------------------- start, quit
let pushTimer = null;
function changed() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { lastState = await service.state(); } catch (e) { log("state", e.message); return; }
    if (win && !win.isDestroyed()) win.webContents.send(PUSH, lastState);
    rebuildTray();
  }, 120);
}

async function quit() {
  quitting = true;
  app.quit();
}
let shutDown = false;
app.on("before-quit", e => {
  quitting = true;
  if (shutDown || !service) return;
  e.preventDefault();
  shutDown = true;
  // Apps Morse connected keep running; their mods come off until next time.
  Promise.race([service.shutdown(), new Promise(r => setTimeout(r, 5000))]).finally(() => app.quit());
});
app.on("window-all-closed", () => {}); // the tray keeps Morse running

app.whenReady().then(async () => {
  lockSession();
  if (["dark", "light"].includes(process.env.MORSE_DESKTOP_THEME)) nativeTheme.themeSource = process.env.MORSE_DESKTOP_THEME; // screenshots
  if (MAC) app.dock?.setIcon(appIcon());
  service = createService({ daemon: await loadDaemon(), emit: changed, log, iconFor });
  registerIpc({
    ipcMain, service, isTrusted, log,
    native: {
      pickApp: async () => {
        const r = await dialog.showOpenDialog(win, {
          title: "Add an app", buttonLabel: "Add",
          defaultPath: MAC ? "/Applications" : WIN ? process.env.LOCALAPPDATA : "/opt",
          properties: ["openFile"],
          filters: MAC ? [{ name: "Apps", extensions: ["app"] }] : WIN ? [{ name: "Apps", extensions: ["exe", "lnk"] }] : [],
        });
        return r.canceled ? null : r.filePaths[0];
      },
      showFolder: async dir => { if (dir) { const e = await shell.openPath(dir); return e ? { error: "Morse couldn't open that folder." } : { ok: true }; } return { error: "The Chrome extension isn't built yet." }; },
      openExternal: async url => { await shell.openExternal(url); return { ok: true }; },
      setLoginItem,
    },
  });
  createWindow();
  tray = new Tray(trayIcon());
  tray.on("click", showWindow);
  registerLinks();
  const link = process.argv.find(a => a.startsWith("morse://"));
  if (link) handleLink(link);
  // The Morse helper runs in the background so Chrome can use your model,
  // unless you turned it off.
  const s = await service.loadSettings();
  if (s.helper) await service.startHelper();
  // Apps opening and closing on their own: look again now and then.
  setInterval(changed, 4000).unref?.();
  changed();
});
