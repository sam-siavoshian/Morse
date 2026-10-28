// The Electron side of the native overlay: a transparent, always-on-top window
// that renders the same Morse bar (runtime/) and is pinned over a native app's
// window by native-dbi/overlay.js's controller.
//
// It owns no tracking logic — it only knows how to show/move/hide/destroy a
// window. That split keeps the follow/diff/hide behaviour in native-dbi/ (pure,
// tested) and leaves this as a thin, Electron-specific host.
//
// The Electron pieces (BrowserWindow, screen) are passed in, not imported, so
// this module loads in a plain Node test too. In the app, main.js passes the
// real ones.
//
// What makes it an overlay and not a normal window:
//   transparent + frame:false     no chrome, see the app underneath
//   alwaysOnTop ("screen-saver")  floats over the target
//   skipTaskbar, no focus steal   doesn't become "an app" in its own right
//   setIgnoreMouseEvents(forward) clicks pass through to the app, except where
//                                 the bar asks to be interactive (setInteractive)

import path from "node:path";
import { fileURLToPath } from "node:url";

export const OVERLAY_URL = "morse-app://ui/overlay.html";
const DEFAULT_PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), "overlay-preload.cjs");

// `material` opts into a system-native window material for the overlay surface
// (macOS vibrancy, Windows Mica/Acrylic), for a feature whose chrome should
// read as part of the OS. It's off by default: a pinned overlay is mostly
// transparent so the app shows through, and the bar paints its own frosted
// surface (backdrop-filter) within its bounds. When set: "mac" vibrancy values
// ("hud", "under-window", "fullscreen-ui") or Windows backgroundMaterial
// ("mica", "acrylic", "tabbed").
export function createOverlayHost({ BrowserWindow, screen = null, ipcMain = null, runtimeUrl = OVERLAY_URL, platform = process.platform, preload = DEFAULT_PRELOAD, material = null, nativeService = null } = {}) {
  if (!BrowserWindow) throw new TypeError("createOverlayHost needs Electron's BrowserWindow");
  let win = null;

  // The overlay page asks (via overlay-preload.cjs) to become interactive while
  // the pointer is over the bar, and click-through again when it leaves.
  const onInteractive = (_event, on) => { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!on, { forward: true }); };
  ipcMain?.on?.("morse-overlay:interactive", onInteractive);
  // The bar's "apply a change" messages (generate / save / list / toggle) reach
  // here and go to the native mod service (native-dbi/apply.js) when one is
  // wired. Without a service — or when the model that writes the hook isn't
  // connected — the reply is honest rather than a pretend success.
  ipcMain?.handle?.("morse-overlay:native", async (_event, msg) => {
    if (!nativeService) return { ok: false, error: "No native session is active for this app." };
    try { return await nativeService.handle(msg); }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  const ensure = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      show: false, frame: false, transparent: true, backgroundColor: "#00000000",
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: true, acceptFirstMouse: true, hasShadow: false,
      // System-native material (opt-in). Transparent stays on so the app shows
      // through where the material/overlay is clear.
      ...(material && platform === "darwin" ? { vibrancy: material, visualEffectState: "active" } : {}),
      ...(material && platform === "win32" ? { backgroundMaterial: material } : {}),
      // Keep it off screen captures of the desktop where the OS supports it.
      webPreferences: {
        preload: preload || undefined,
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        webSecurity: true, devTools: false,
      },
    });
    win.removeMenu?.();
    // Above full-screen apps and other always-on-top windows.
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    // Click-through everywhere; the page turns this off over the bar itself.
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadURL(runtimeUrl);
    return win;
  };

  // Physical screen pixels (from the OS tools in window-bounds.js) → the DIP
  // rect Electron's setBounds wants. On HiDPI these differ; screenToDipRect
  // does the conversion when it's available.
  const toDip = rect => {
    try { return screen?.screenToDipRect ? screen.screenToDipRect(win, rect) : rect; }
    catch { return rect; }
  };

  return {
    show(region) {
      const w = ensure();
      w.setBounds(toDip(region));
      w.showInactive(); // visible without stealing focus from the app
    },
    move(region) {
      if (!win || win.isDestroyed()) return this.show(region);
      win.setBounds(toDip(region));
      if (!win.isVisible()) win.showInactive();
    },
    hide() { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); },
    // Open the bar (the app calls this on the Morse hotkey).
    open() { if (win && !win.isDestroyed()) win.webContents.send("morse-overlay:open"); },
    destroy() {
      ipcMain?.removeListener?.("morse-overlay:interactive", onInteractive);
      ipcMain?.removeHandler?.("morse-overlay:native");
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
    // Direct toggle (same effect as the page's IPC), exposed for callers/tests.
    setInteractive(on) { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!on, { forward: true }); },
    get window() { return win; },
  };
}

// Tie the host to the native window: start the controller tracking `pid`, and
// return a handle whose stop() tears the overlay down. `BrowserWindow`/`screen`
// come from main.js; `boundsFor` is injectable for tests.
export async function startNativeOverlay({ pid, BrowserWindow, screen = null, ipcMain = null, platform = process.platform, preload = DEFAULT_PRELOAD, material = null, nativeService = null, regionOptions = {}, boundsFor = null, subscribe = null, onGone = null }) {
  const { OverlayController, trackWindow } = await import("../native-dbi/overlay.js");
  const host = createOverlayHost({ BrowserWindow, screen, ipcMain, platform, preload, material, nativeService });
  // The real bar expands to panels, so the overlay covers the whole window and
  // hit-tests the bar for click-through (overlay-boot.js), rather than being a
  // fixed strip.
  regionOptions = { mode: "full", ...regionOptions };
  const controller = boundsFor
    ? new OverlayController({ host, bounds: () => boundsFor(), subscribe, regionOptions, onGone }).start()
    : trackWindow({ pid, host, platform, regionOptions, subscribe, onGone });
  return { stop: () => controller.stop(), host, controller };
}
