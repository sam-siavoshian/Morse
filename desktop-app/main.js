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

import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, dialog, shell, session, protocol } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createService, loadDaemon } from "./service.js";
import { registerIpc, PUSH, isOpenLink } from "./ipc.js";
import { markPng } from "./mark.js";
import { chromeCommand, isStoreUrl } from "./chrome.js";
import { LINKS } from "../site/config.js";
import { LANGUAGES } from "../core/i18n.js";
import { iconSource } from "./icons.js";
import { setAutostart, writeMenuEntry } from "./linux.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The window's page is served from morse-app://ui/, a scheme of Morse's own
// (Electron's advice over file://): only the files listed here exist there.
const SCHEME = "morse-app";
const PAGE_URL = `${SCHEME}://ui/index.html`;
const UI_FILES = {
  "/index.html": [path.join(HERE, "ui", "index.html"), "text/html; charset=utf-8"],
  "/app.css": [path.join(HERE, "ui", "app.css"), "text/css; charset=utf-8"],
  "/app.js": [path.join(HERE, "ui", "app.js"), "text/javascript; charset=utf-8"],
  "/tokens.css": [path.join(HERE, "..", "design", "tokens.css"), "text/css; charset=utf-8"],
  // The marks of the models you can choose (ui/icons/NOTICE), and the site's own Inter.
  ...Object.fromEntries(["claude", "openai", "anthropic"].map(n => [`/icons/${n}.png`, [path.join(HERE, "ui", "icons", `${n}.png`), "image/png"]])),
  ...Object.fromEntries(["inter-regular", "inter-medium", "interdisplay-semibold"].map(n => [`/fonts/${n}.woff2`, [path.join(HERE, "..", "site", "fonts", `${n}.woff2`), "font/woff2"]])),
  // Where to click in Chrome (demo/shoot-chrome-steps.js), for Use Morse in Chrome.
  "/chrome-steps.png": [path.join(HERE, "ui", "chrome-steps.png"), "image/png"],
  // The window's words in the person's language: core/i18n.js and each language's catalog.
  "/core/i18n.js": [path.join(HERE, "..", "core", "i18n.js"), "text/javascript; charset=utf-8"],
  ...Object.fromEntries(LANGUAGES.map(l => [`/core/locales/${l.code}.js`, [path.join(HERE, "..", "core", "locales", `${l.code}.js`), "text/javascript; charset=utf-8"]])),
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
// Morse's page, whatever its query (?platform=…) says.
const isPage = url => { try { const u = new URL(url); u.search = ""; u.hash = ""; return u.href === PAGE_URL; } catch { return false; } };
const MAC = process.platform === "darwin", WIN = process.platform === "win32";
const log = (...a) => { if (!app.isPackaged || process.env.MORSE_DEBUG) console.log("[morse]", ...a); };

app.setName("Morse");

// Run from an AppImage, this process has the AppImage's own variables. The apps
// Morse opens must not inherit them (a library path into Morse's mount would
// break them), so they are kept here and taken out of the environment.
const APPIMAGE = process.env.APPIMAGE || "";
if (APPIMAGE) {
  const dir = process.env.APPDIR || "";
  for (const k of ["APPIMAGE", "APPDIR", "ARGV0", "OWD"]) delete process.env[k];
  for (const k of ["LD_LIBRARY_PATH", "PATH", "XDG_DATA_DIRS", "GSETTINGS_SCHEMA_DIR"]) {
    if (!dir || !process.env[k]) continue;
    const kept = process.env[k].split(":").filter(p => p && !p.startsWith(dir));
    if (kept.length) process.env[k] = kept.join(":"); else delete process.env[k];
  }
}

// One Morse at a time: a second start (or a morse://open link) shows this window.
// A Morse folder of its own (MORSE_HOME, as tests use) is a Morse of its own.
if (process.env.MORSE_HOME) app.setPath("userData", path.join(process.env.MORSE_HOME, "desktop-profile"));
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
    const ok = details.url.startsWith(`${SCHEME}://ui/`) || details.url.startsWith("devtools://") || details.url.startsWith("data:");
    if (!ok) log("blocked", details.url);
    done({ cancel: !ok });
  });
  // The page's files, from inside the app, with the CSP as a header too.
  s.protocol.handle(SCHEME, async req => {
    const u = new URL(req.url);
    const hit = u.host === "ui" && UI_FILES[u.pathname];
    if (!hit || req.method !== "GET") return new Response("Not found", { status: 404 });
    const body = await fs.readFile(hit[0]);
    return new Response(body, { headers: { "content-type": hit[1], "content-security-policy": CSP, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
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

// An app's own icon, as a data: URL for the list (or null: the list shows a
// letter). icons.js finds the app's real icon file (the icon theme, the app's
// folder, inside an AppImage, the .icns in a Mac app); Electron's
// app.getFileIcon is the fallback on macOS and the way on Windows. On Linux it
// gives a generic "program" picture, not the app's, so it isn't used there.
async function iconFor(a) {
  const src = iconSource(a);
  let img = src?.png ? nativeImage.createFromBuffer(src.png) : src?.file ? nativeImage.createFromPath(src.file) : null;
  if ((!img || img.isEmpty()) && (MAC || WIN)) img = await app.getFileIcon(a.path || a.exe, { size: "large" });
  return !img || img.isEmpty() ? null : img.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
}

// ---------------------------------------------------------------- the window
function createWindow() {
  win = new BrowserWindow({
    width: 960, height: 720, minWidth: 760, minHeight: 560, show: false,
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
  win.loadURL(`${PAGE_URL}?platform=${process.platform}`);
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
    const exec = APPIMAGE || process.execPath;
    const args = APPIMAGE || app.isPackaged ? [] : [app.getAppPath()];
    await setAutostart(on, { exec, args });
  } else app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
  return { ok: true };
}

// ---------------------------------------------------------------- morse:// links
// morse://open (from Chrome's welcome page, say) starts Morse or brings its
// window forward. A link carries nothing else: connecting Chrome goes through
// the Morse helper and the person's Allow (createBridge's ask, service.js askAllow).
function handleLink(url) {
  if (isOpenLink(url)) app.whenReady().then(showWindow);
}
app.on("open-url", (e, url) => { e.preventDefault(); app.whenReady().then(() => handleLink(url)); }); // macOS
app.on("second-instance", () => showWindow()); // a second start (or a morse://open link) brings this window forward

function registerLinks() {
  // Packaged only: a clone started with run.js shouldn't take over morse:// links.
  if (!app.isPackaged) return;
  if (process.platform === "linux") {
    // The AppImage has no installer: Morse adds its own app menu entry, which
    // is what lets Chrome hand it morse:// links.
    const exec = APPIMAGE || process.execPath;
    writeMenuEntry({ exec }).then(() => new Promise(r => execFile("xdg-mime", ["default", "morse-desktop.desktop", "x-scheme-handler/morse"], () => r()))).catch(e => log("menu entry", e.message));
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
  // macOS needs a menu for ⌘Q, ⌘W and copy and paste (the API key field); elsewhere there is none.
  Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  service = createService({ daemon: await loadDaemon(), emit: changed, log, iconFor, copyExtension: app.isPackaged || process.env.MORSE_COPY_EXTENSION === "1", ...(process.env.MORSE_CHROME_FOLDER && { chromeFolder: process.env.MORSE_CHROME_FOLDER }), chromeStore: isStoreUrl(LINKS.chrome) ? LINKS.chrome : "", self: [process.execPath, APPIMAGE], onAsk: () => showWindow() });
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
      // The folder, selected in its own folder, ready for Chrome's Load unpacked.
      revealFolder: async dir => { if (!dir) return { error: "The Chrome extension isn't built yet." }; shell.showItemInFolder(dir); return { ok: true }; },
      // Chrome on its extensions page (desktop-app/chrome.js); false when there's no Chrome here.
      openChrome: async () => {
        const c = chromeCommand();
        if (!c) return false;
        try {
          const child = spawn(c.file, c.args, { detached: true, stdio: "ignore" });
          child.on("error", e => log("Chrome didn't start:", e.message));
          child.unref();
          return true;
        } catch (e) { log("Chrome didn't start:", e.message); return false; }
      },
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
