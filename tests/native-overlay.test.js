// The overlay engine (native-dbi/window-bounds.js, native-dbi/overlay.js) and
// the Electron host (desktop-app/overlay.js) against a fake BrowserWindow.
// No display or Electron is needed: the bounds parsers are pure, the controller
// is driven tick-by-tick, and the host is checked against a BrowserWindow stub.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMacBounds, parseWinRect, parseLinuxGeometry } from "../native-dbi/window-bounds.js";
import { computeRegion, sameRegion, OverlayController } from "../native-dbi/overlay.js";
import { createOverlayHost } from "../desktop-app/overlay.js";

test("packaging: native-dbi/ ships wherever it's imported from", () => {
  const root = new URL("../", import.meta.url);
  // daemon/native-dbi.js and desktop-app/overlay.js both import ../native-dbi/*,
  // so native-dbi/ must be in the npm package and the desktop app bundle or the
  // shipped artifacts break at runtime (node --check won't catch a missing dir).
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("package.json", root)), "utf8"));
  assert.ok(pkg.files.some(f => f.replace(/\/$/, "") === "native-dbi"), "package.json files includes native-dbi/");

  const build = readFileSync(fileURLToPath(new URL("desktop-app/build.js", root)), "utf8");
  const copy = /const COPY\s*=\s*\[([^\]]*)\]/.exec(build)?.[1] || "";
  assert.match(copy, /"native-dbi"/, "desktop-app build COPY includes native-dbi");
});

test("window-bounds: parses each platform's geometry output", () => {
  assert.deepEqual(parseMacBounds("100, 200, 800, 600"), { x: 100, y: 200, width: 800, height: 600 });
  assert.equal(parseMacBounds("garbage"), null);
  assert.equal(parseMacBounds("1, 2, 0, 0"), null, "zero-size window is treated as no window");

  // Windows RECT is left,top,right,bottom → x,y,w,h
  assert.deepEqual(parseWinRect("50,60,850,660"), { x: 50, y: 60, width: 800, height: 600 });
  assert.equal(parseWinRect(null), null);

  const shell = "WINDOW=12345\nX=10\nY=20\nWIDTH=640\nHEIGHT=480\nSCREEN=0";
  assert.deepEqual(parseLinuxGeometry(shell), { x: 10, y: 20, width: 640, height: 480 });
  assert.equal(parseLinuxGeometry("WINDOW=1\nX=0\nY=0"), null, "missing width/height → null");
});

test("overlay: computeRegion centres a bar strip and can cover the whole window", () => {
  const bounds = { x: 100, y: 100, width: 1000, height: 800 };
  const bar = computeRegion(bounds, { mode: "bar", margin: 16, barHeight: 56, maxWidth: 720 });
  assert.equal(bar.width, 720, "capped at maxWidth");
  assert.equal(bar.x, 100 + Math.round((1000 - 720) / 2), "centred horizontally");
  assert.equal(bar.y, 116);
  assert.equal(bar.height, 56);

  // Narrow window: bar fits within margins instead of maxWidth.
  const narrow = computeRegion({ x: 0, y: 0, width: 400, height: 300 }, { margin: 16, maxWidth: 720 });
  assert.equal(narrow.width, 400 - 32);

  assert.deepEqual(computeRegion(bounds, { mode: "full" }), bounds);
  assert.equal(computeRegion(null), null);
});

test("overlay: sameRegion compares by value", () => {
  assert.ok(sameRegion({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 }));
  assert.ok(!sameRegion({ x: 1, y: 2, width: 3, height: 4 }, { x: 9, y: 2, width: 3, height: 4 }));
  assert.ok(!sameRegion(null, { x: 1, y: 2, width: 3, height: 4 }));
});

test("OverlayController: shows, moves only on change, hides when the window is gone", () => {
  const calls = [];
  const host = {
    show: r => calls.push(["show", r]),
    move: r => calls.push(["move", r]),
    hide: () => calls.push(["hide"]),
    destroy: () => calls.push(["destroy"]),
  };
  let bounds = { x: 0, y: 0, width: 1000, height: 800 };
  const c = new OverlayController({ host, bounds: () => bounds, regionOptions: { maxWidth: 400, margin: 0 } });

  c.tick();                       // first paint → show
  c.tick();                       // unchanged → nothing
  bounds = { x: 0, y: 0, width: 1000, height: 800 }; // same values (new object)
  c.tick();                       // still unchanged → nothing
  bounds = { x: 200, y: 0, width: 1000, height: 800 }; // moved
  c.tick();                       // → move
  bounds = null;                  // minimised/closed
  c.tick();                       // → hide
  c.tick();                       // still gone → no repeat hide
  bounds = { x: 200, y: 0, width: 1000, height: 800 }; // back
  c.tick();                       // → show again

  const kinds = calls.map(c => c[0]);
  assert.deepEqual(kinds, ["show", "move", "hide", "show"]);

  c.stop();
  assert.deepEqual(calls.at(-1), ["destroy"]);
  c.stop(); // idempotent
  assert.equal(calls.filter(c => c[0] === "destroy").length, 1);
});

test("OverlayController: an event source re-anchors immediately (no poll wait)", () => {
  const calls = [];
  const host = { show: r => calls.push(["show", r]), move: r => calls.push(["move", r]), hide: () => calls.push(["hide"]), destroy: () => calls.push(["destroy"]) };
  let pushCb = null;
  const subscribe = cb => { pushCb = cb; return () => { pushCb = null; }; };
  // bounds() (poll) returns nothing; all movement comes from the event source.
  const c = new OverlayController({ host, bounds: () => null, subscribe, regionOptions: { mode: "full" } });
  c.start();
  assert.equal(typeof pushCb, "function", "subscribed to the event source");
  pushCb({ x: 0, y: 0, width: 800, height: 600 });        // OS says: window here → show
  pushCb({ x: 40, y: 0, width: 800, height: 600 });        // moved → move
  pushCb({ x: 40, y: 0, width: 800, height: 600 });        // same → nothing
  pushCb(null);                                            // minimized → hide
  assert.deepEqual(calls.map(c => c[0]), ["show", "move", "hide"]);
  c.stop();
  assert.equal(pushCb, null, "unsubscribed on stop");
});

test("createOverlayHost: material opts into native vibrancy / Mica", () => {
  const { BW, instances } = fakeBrowserWindow();
  const mac = createOverlayHost({ BrowserWindow: BW, platform: "darwin", material: "hud" });
  mac.show({ x: 0, y: 0, width: 10, height: 10 });
  assert.equal(instances[0].opts.vibrancy, "hud");
  assert.equal(instances[0].opts.transparent, true, "still transparent so the app shows through");

  const win = createOverlayHost({ BrowserWindow: BW, platform: "win32", material: "mica" });
  win.show({ x: 0, y: 0, width: 10, height: 10 });
  assert.equal(instances[1].opts.backgroundMaterial, "mica");

  const plain = createOverlayHost({ BrowserWindow: BW, platform: "darwin" });
  plain.show({ x: 0, y: 0, width: 10, height: 10 });
  assert.equal(instances[2].opts.vibrancy, undefined, "no material by default");
});

test("OverlayController: onGone fires while the window is absent", () => {
  let gone = 0;
  const host = { show() {}, move() {}, hide() {}, destroy() {} };
  const c = new OverlayController({ host, bounds: () => null, onGone: () => gone++ });
  c.tick(); c.tick();
  assert.equal(gone, 2);
});

// A BrowserWindow stub recording the calls the host makes.
function fakeBrowserWindow() {
  const instances = [];
  class BW {
    constructor(opts) { this.opts = opts; this.calls = []; this._destroyed = false; this._visible = false; instances.push(this); }
    removeMenu() {}
    setAlwaysOnTop(...a) { this.calls.push(["alwaysOnTop", ...a]); }
    setVisibleOnAllWorkspaces(...a) { this.calls.push(["allWorkspaces", ...a]); }
    setIgnoreMouseEvents(...a) { this.calls.push(["ignoreMouse", ...a]); }
    loadURL(u) { this.url = u; }
    setBounds(b) { this.bounds = b; this.calls.push(["setBounds", b]); }
    showInactive() { this._visible = true; this.calls.push(["showInactive"]); }
    isVisible() { return this._visible; }
    hide() { this._visible = false; this.calls.push(["hide"]); }
    isDestroyed() { return this._destroyed; }
    destroy() { this._destroyed = true; this.calls.push(["destroy"]); }
  }
  return { BW, instances };
}

test("createOverlayHost: transparent, always-on-top, click-through; positions and tears down", () => {
  const { BW, instances } = fakeBrowserWindow();
  const ipc = { handlers: {}, on(ch, fn) { this.handlers[ch] = fn; }, removeListener(ch) { delete this.handlers[ch]; } };
  const host = createOverlayHost({ BrowserWindow: BW, ipcMain: ipc });

  const region = { x: 10, y: 20, width: 400, height: 56 };
  host.show(region);
  const w = instances[0];
  assert.equal(w.opts.transparent, true);
  assert.equal(w.opts.frame, false);
  assert.equal(w.url, "morse-app://ui/overlay.html");
  assert.ok(w.calls.some(c => c[0] === "alwaysOnTop" && c[2] === "screen-saver"));
  assert.ok(w.calls.some(c => c[0] === "ignoreMouse" && c[1] === true), "created click-through");
  assert.deepEqual(w.bounds, region);
  assert.ok(w.isVisible());

  host.move({ x: 11, y: 20, width: 400, height: 56 });
  assert.deepEqual(w.bounds, { x: 11, y: 20, width: 400, height: 56 });

  // The page's interactive toggle flows through ipcMain.
  ipc.handlers["morse-overlay:interactive"](null, true);
  assert.ok(w.calls.some(c => c[0] === "ignoreMouse" && c[1] === false), "bar became interactive");

  host.hide();
  assert.ok(!w.isVisible());

  host.destroy();
  assert.ok(w.isDestroyed());
  assert.equal(ipc.handlers["morse-overlay:interactive"], undefined, "ipc listener removed on destroy");
});
