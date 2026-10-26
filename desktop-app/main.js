// Morse Desktop: Morse on your computer without a terminal. The Electron main
// process runs the same daemon code the `morse` command runs (service.js), so
// there is no Node to install. It shows one window (ui/), sits in the tray or
// menu bar, opens apps and browsers with Morse, and opens at login for
// Always open with Morse.
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

import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, dialog, shell, session, protocol, globalShortcut } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createService, loadDaemon } from "./service.js";
import { registerIpc, gateService, PUSH, isOpenLink } from "./ipc.js";
import { markPng } from "./mark.js";
import { LANGUAGES } from "../core/i18n.js";
import { iconSource } from "./icons.js";
import { setAutostart, writeMenuEntry } from "./linux.js";
import { startShellPath } from "./shell-path.js";
import { createUpdater } from "./updater.js";
import { acceleratorFor, createOpenShortcut, readForegroundPid } from "./shortcut.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The window's page is served from morse-app://ui/, a scheme of Morse's own
// (Electron's advice over file://): only the files listed here exist there.
const SCHEME = "morse-app";
const PAGE_URL = `${SCHEME}://ui/index.html`;
const UI_FILES = {
  "/index.html": [path.join(HERE, "ui", "index.html"), "text/html; charset=utf-8"],
  "/app.css": [path.join(HERE, "ui", "app.css"), "text/css; charset=utf-8"],
  "/app.js": [path.join(HERE, "ui", "app.js"), "text/javascript; charset=utf-8"],
  // When the row may say Connected, and when the "isn't running yet" banner may show.
  "/open-bar.js": [path.join(HERE, "..", "daemon", "open-bar.js"), "text/javascript; charset=utf-8"],
  "/tokens.css": [path.join(HERE, "..", "design", "tokens.css"), "text/css; charset=utf-8"],
  // The first run: the name forming out of dots (ui/formation.js).
  "/formation.js": [path.join(HERE, "ui", "formation.js"), "text/javascript; charset=utf-8"],
  // The first run's sky, the website's (copied from site/sky), and its pixel edge.
  "/dither.js": [path.join(HERE, "ui", "dither.js"), "text/javascript; charset=utf-8"],
  "/sky/day.webp": [path.join(HERE, "ui", "sky", "day.webp"), "image/webp"],
  // The marks of the models you can choose (ui/icons/NOTICE), and the site's own Inter and JetBrains Mono.
  ...Object.fromEntries(["claude", "openai", "anthropic"].map(n => [`/icons/${n}.png`, [path.join(HERE, "ui", "icons", `${n}.png`), "image/png"]])),
  ...Object.fromEntries(["inter-regular", "inter-medium", "interdisplay-semibold", "jetbrainsmono-regular"].map(n => [`/fonts/${n}.woff2`, [path.join(HERE, "..", "site", "fonts", `${n}.woff2`), "font/woff2"]])),
  // The window's words in the person's language: core/i18n.js and each language's catalog.
  "/core/i18n.js": [path.join(HERE, "..", "core", "i18n.js"), "text/javascript; charset=utf-8"],
  "/core/hotkeys.js": [path.join(HERE, "..", "core", "hotkeys.js"), "text/javascript; charset=utf-8"],
  ...Object.fromEntries(LANGUAGES.map(l => [`/core/locales/${l.code}.js`, [path.join(HERE, "..", "core", "locales", `${l.code}.js`), "text/javascript; charset=utf-8"]])),
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
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

// Opened from Finder or a launcher, the app has the system's bare PATH. The
// login shell is not asked here: that probe can take seconds, and it used to
// run while this module loaded, before the window existed. whenReady applies
// a cached PATH at once and refreshes the shell in the background (shell-path.js).

// One Morse at a time: a second start (or a morse://open link) shows this window.
// A Morse folder of its own (MORSE_HOME, as tests use) is a Morse of its own.
if (process.env.MORSE_HOME) app.setPath("userData", path.join(process.env.MORSE_HOME, "desktop-profile"));
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, service = null, quitting = false, lastState = null, updater = null, opener = null;
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
  // model, come from Node in this process, not from the page, and don't pass
  // through here.)
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

// An app's own icon, as a data: URL for the list (or null: the list shows the
// Apps glyph, never a letter). icons.js finds the app's real icon file (the icon theme, the app's
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
    // On a Mac the window is glass, the way Zephium's is: the system's sidebar
    // material under a clear background (ui/app.css, body.mac). Dark only, like the website.
    backgroundColor: MAC ? "#00000000" : "#0a0a0b",
    ...(MAC ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 18 }, vibrancy: "sidebar", visualEffectState: "followWindow" } : { autoHideMenuBar: true }),
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
  if (!service) return;
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
    { label: "Turn all mods off", type: "checkbox", checked: off, click: item => service?.setAllModsOff(item.checked) },
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
// morse://open starts Morse or brings its window forward. A link carries nothing else.
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
    // is what lets a browser hand it morse:// links.
    const exec = APPIMAGE || process.execPath;
    writeMenuEntry({ exec }).then(() => new Promise(r => execFile("xdg-mime", ["default", "morse-desktop.desktop", "x-scheme-handler/morse"], () => r()))).catch(e => log("menu entry", e.message));
  } else app.setAsDefaultProtocolClient("morse");
}

// ---------------------------------------------------------------- start, quit
let pushTimer = null;
// The open chord, held by this process. The OS delivers it even when the
// focused app eats the key. A saved custom chord replaces the default.
function syncOpenShortcut() {
  if (!opener || !service?.openCombo) return;
  service.openCombo().then(combo => {
    const platform = MAC ? "mac" : WIN ? "win" : "linux";
    const r = opener.register(acceleratorFor(combo, platform));
    if (!r.ok && combo) log("shortcut", `couldn't register ${combo}; a connected page can still open Morse with it`);
  }).catch(e => log("shortcut", e.message));
}

function changed() {
  clearTimeout(pushTimer);
  syncOpenShortcut();
  pushTimer = setTimeout(async () => {
    if (!service) return;
    try { lastState = { ...(await service.state()), update: updater?.status || { phase: "idle" } }; } catch (e) { log("state", e.message); return; }
    if (win && !win.isDestroyed()) win.webContents.send(PUSH, lastState);
    updater?.idle(); // an app was disconnected: a downloaded update may install now
    rebuildTray();
  }, 120);
}

async function quit() {
  quitting = true;
  try { opener?.unregister(); } catch {}
  app.quit();
}
let shutDown = false;
app.on("before-quit", e => {
  quitting = true;
  if (shutDown || !service) return;
  e.preventDefault();
  shutDown = true;
  // Apps Morse connected keep running; their mods come off until next time.
  // A downloaded update installs now (updater.js), without opening Morse again.
  Promise.race([service.shutdown(), new Promise(r => setTimeout(r, 5000))]).finally(() => { if (!updater?.onQuit()) app.quit(); });
});
app.on("will-quit", () => { try { opener?.unregister(); globalShortcut.unregisterAll(); } catch {} });
app.on("window-all-closed", () => {}); // the tray keeps Morse running

// Model and backend detection run commands from PATH. On a first launch the
// login shell may still be running; wait for it instead of looking too early.
function whenPathReady(daemon, pathReady) {
  for (const name of ["detectBackends", "checkModel"]) {
    const fn = daemon[name];
    if (typeof fn !== "function") continue;
    daemon[name] = (...args) => Promise.resolve(pathReady).then(() => fn.apply(daemon, args));
  }
  return daemon;
}

app.whenReady().then(async () => {
  lockSession();
  if (["dark", "light"].includes(process.env.MORSE_DESKTOP_THEME)) nativeTheme.themeSource = process.env.MORSE_DESKTOP_THEME; // screenshots
  if (MAC) app.dock?.setIcon(appIcon());
  // macOS needs a menu for ⌘Q, ⌘W and copy and paste (the API key field); elsewhere there is none.
  Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  // Cached PATH now (no shell). The probe continues in the background.
  const pathReady = startShellPath({
    packaged: app.isPackaged, platform: process.platform,
    cacheFile: path.join(app.getPath("userData"), "shell-path.json"),
  });
  let resolveService, rejectService;
  const serviceReady = new Promise((res, rej) => { resolveService = res; rejectService = rej; });
  registerIpc({
    ipcMain, service: gateService(serviceReady), isTrusted, log,
    native: {
      updateStatus: () => updater?.status || { phase: "idle" },
      installUpdate: () => !!updater?.installNow(),
      updateLater: () => !!updater?.later(),
      checkForUpdate: async () => {
        if (!updater) return { phase: "error" };
        await updater.check({ user: true });
        return { ...updater.status };
      },
      pickApp: async () => {
        const r = await dialog.showOpenDialog(win, {
          title: "Add an app", buttonLabel: "Add",
          defaultPath: MAC ? "/Applications" : WIN ? process.env.LOCALAPPDATA : "/opt",
          properties: ["openFile"],
          filters: MAC ? [{ name: "Apps", extensions: ["app"] }] : WIN ? [{ name: "Apps", extensions: ["exe", "lnk"] }] : [],
        });
        return r.canceled ? null : r.filePaths[0];
      },
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
  // The page is already loading. The daemon comes up behind it; state() waits
  // (gateService) and then answers without a cold app scan.
  try {
    const daemon = whenPathReady(await loadDaemon(), pathReady);
    service = createService({ daemon, emit: changed, log, iconFor, self: [process.execPath, APPIMAGE] });
    resolveService(service);
    opener = createOpenShortcut({
      globalShortcut, log,
      onFire: () => {
        service?.openFromShortcut(readForegroundPid(), process.pid).catch(e => log("shortcut", e.message));
      },
    });
    syncOpenShortcut();
  } catch (e) {
    log("start", e?.stack || e);
    rejectService(e);
    return;
  }
  // Updates itself from the preview release: downloads in the background, and
  // installs when no app is connected and the window isn't in use, or at quit.
  // The check stays on its own 5s delay (updater.js); startup does not add one.
  updater = createUpdater({ app, log, getAppImage: () => APPIMAGE, busy: () => service.sessions.size > 0, onStatus: () => { changed(); if (["downloading", "ready"].includes(updater?.status.phase) && win && !win.isVisible()) showWindow(); } });
  updater.start();
  const s = await service.loadSettings();
  // Always open with Morse (on unless you turn it off) needs Morse running:
  // it opens at login, set once here, after which the switch decides.
  if (app.isPackaged && s.autoOpen && !s.startAtLogin && !s.loginSet) {
    await setLoginItem(true).catch(e => log("login item", e.message));
    await service.setSetting("startAtLogin", true);
    await service.setSetting("loginSet", true);
  }
  // Apps opening and closing on their own: look again now and then.
  setInterval(changed, 4000).unref?.();
  changed();
});
