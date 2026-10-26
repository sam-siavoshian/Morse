// The open chord as an OS shortcut (desktop-app/shortcut.js), and the one-time
// move off the old Mac Option+Space default (daemon/store.js).
import { home } from "./helpers/home.js"; // first: a MORSE_HOME of its own
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { acceleratorFor, createOpenShortcut, pickShortcutTarget, parseForegroundPid, foregroundCommand } from "../desktop-app/shortcut.js";
import { defaultHotkeys } from "../core/hotkeys.js";

const { stampOpenHotkey, savePrefs, loadPrefs } = await import("../daemon/store.js");
const { resolveHotkeys } = await import("../core/hotkeys.js");
const { bundleBoot } = await import("../runtime/bundle.js");

test("the default chord is Ctrl+Alt+Space, and Electron registers it as Control+Alt+Space", () => {
  for (const platform of ["mac", "win", "linux"]) {
    assert.equal(defaultHotkeys(platform).open, "Ctrl+Alt+Space", platform);
    assert.equal(acceleratorFor(defaultHotkeys(platform).open, platform), "Control+Alt+Space", platform);
  }
  assert.equal(acceleratorFor("Alt+Shift+KeyK", "mac"), "Alt+Shift+K");
  assert.equal(acceleratorFor("Meta+Shift+KeyK", "mac"), "Shift+Command+K");
  assert.equal(acceleratorFor("Meta+Shift+KeyK", "win"), "Shift+Super+K");
  assert.equal(acceleratorFor("Meta+Shift+KeyK", "linux"), "Shift+Super+K");
  assert.equal(acceleratorFor("", "mac"), "");
  assert.equal(acceleratorFor("none", "mac"), "");
});

test("a press toggles once, a repeat is ignored, and a chord the OS keeps is not retried", () => {
  const map = new Map();
  const gs = {
    register(accel, fn) {
      if (accel === "BAD") return false;
      map.set(accel, fn);
      return true;
    },
    unregister(accel) { map.delete(accel); },
  };
  let fires = 0;
  let t = 1000;
  const opener = createOpenShortcut({ globalShortcut: gs, onFire: () => { fires++; }, now: () => t, gap: 350 });
  assert.deepEqual(opener.register("Control+Alt+Space"), { ok: true, accelerator: "Control+Alt+Space" });
  assert.deepEqual(opener.register("Control+Alt+Space"), { ok: true, accelerator: "Control+Alt+Space" });
  assert.equal(map.size, 1);
  map.get("Control+Alt+Space")();
  assert.equal(fires, 1);
  t += 10;
  map.get("Control+Alt+Space")();
  assert.equal(fires, 1, "holding the keys does not toggle again");
  t += 400;
  map.get("Control+Alt+Space")();
  assert.equal(fires, 2);
  assert.deepEqual(opener.register("Alt+Shift+K"), { ok: true, accelerator: "Alt+Shift+K" });
  assert.equal(map.has("Control+Alt+Space"), false);
  assert.equal(map.has("Alt+Shift+K"), true);
  assert.deepEqual(opener.register("BAD"), { ok: false, accelerator: "" });
  assert.equal(map.has("BAD"), false);
  assert.deepEqual(opener.register("BAD"), { ok: false, accelerator: "" }, "the same refusal is not registered again");
  opener.unregister();
  assert.equal(map.size, 0);
});

test("the press goes to the app in front, not to some other connected app", () => {
  const sessions = [{ id: "a", pids: [10] }, { id: "b", pids: [20, 21] }];
  assert.equal(pickShortcutTarget(sessions, { pid: 21, selfPid: 1 }), "b");
  assert.equal(pickShortcutTarget(sessions, { pid: 99, selfPid: 1 }), null);
  assert.equal(pickShortcutTarget(sessions, { pid: 99, selfPid: 1, focused: new Set(["a"]) }), "a");
  assert.equal(pickShortcutTarget([{ id: "only", pids: [5] }], { pid: 0, selfPid: 7 }), "only");
  assert.equal(pickShortcutTarget([{ id: "only", pids: [5] }], { pid: 7, selfPid: 7 }), "only", "Morse itself in front, one app connected");
  assert.equal(pickShortcutTarget(sessions, { pid: 0, selfPid: 1 }), null);
  assert.equal(pickShortcutTarget([], { pid: 10 }), null);
});

test("the frontmost process id, per platform", () => {
  assert.equal(parseForegroundPid("darwin", 'ASN:0x0-0x1001 "pid"=123\n'), 123);
  assert.equal(parseForegroundPid("linux", "456\n"), 456);
  assert.equal(parseForegroundPid("win32", " 789 "), 789);
  assert.equal(parseForegroundPid("linux", ""), 0);
  assert.equal(foregroundCommand("darwin").file, "/bin/sh");
  assert.equal(foregroundCommand("win32").file, "powershell.exe");
  assert.equal(foregroundCommand("linux").file, "xdotool");
  assert.equal(foregroundCommand("freebsd"), null);
});

test("a saved custom chord is kept, and a Mac Option+Space that was the old default is not", async () => {
  const saved = await savePrefs({ theme: "light", welcome: false, hotkeys: { open: "Alt+Shift+KeyK", talk: "Alt+KeyT" } });
  assert.equal(saved.hotkeys.open, "Alt+Shift+KeyK");
  assert.equal(saved.hotkeys.talk, "Alt+KeyT");
  const disk = JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8"));
  assert.equal(disk.hotkeyEpoch, 2);
  assert.equal(disk.hotkeys.open, "Alt+Shift+KeyK");
  assert.equal(disk.theme, "light");
  const again = await loadPrefs();
  assert.equal(again.hotkeys.open, "Alt+Shift+KeyK");
  assert.equal(resolveHotkeys(again.hotkeys, "linux").open, "Alt+Shift+KeyK");

  const custom = stampOpenHotkey({ theme: "dark", extra: 1, hotkeys: { open: "Alt+KeyJ", talk: "Alt+KeyT" } }, "win");
  assert.equal(custom.hotkeys.open, "Alt+KeyJ");
  assert.equal(custom.hotkeys.talk, "Alt+KeyT");
  assert.equal(custom.theme, "dark");
  assert.equal(custom.extra, 1);
  assert.equal(custom.hotkeyEpoch, 2);

  const mac = stampOpenHotkey({ theme: "dark", welcome: true, hotkeys: { open: "Alt+Space", talk: "Alt+KeyT" } }, "mac");
  assert.equal(mac.hotkeys.open, "");
  assert.equal(mac.hotkeys.talk, "Alt+KeyT");
  assert.equal(mac.theme, "dark");
  assert.equal(mac.welcome, true);
  assert.equal(stampOpenHotkey({ hotkeys: { open: "⌥Space" } }, "mac").hotkeys.open, "");
  assert.equal(stampOpenHotkey({ hotkeys: { open: "Alt+Space" } }, "linux").hotkeys.open, "Alt+Space");
  assert.equal(stampOpenHotkey({ hotkeys: { open: "Ctrl+Shift+Space" } }, "win").hotkeys.open, "Ctrl+Shift+Space");
  assert.equal(stampOpenHotkey({ hotkeyEpoch: 2, hotkeys: { open: "Alt+Space" } }, "mac"), null, "a later choice of Option+Space stays");

  writeFileSync(path.join(home, "settings.json"), JSON.stringify(mac));
  const loaded = await loadPrefs();
  assert.equal(loaded.hotkeys.open, "");
  assert.equal(loaded.theme, "dark");
  assert.equal(resolveHotkeys(loaded.hotkeys, "mac").open, "Ctrl+Alt+Space");
  assert.equal(resolveHotkeys(loaded.hotkeys, "win").open, "Ctrl+Alt+Space");
});

test("the per-page boot script stays under 54KB and does not own the global shortcut", () => {
  const boot = bundleBoot();
  assert.ok(boot.length < 54_000, `boot is ${boot.length} bytes`);
  assert.equal(boot.includes("migrateStoredOpen"), false);
  assert.equal(boot.includes("globalShortcut"), false);
  assert.match(boot, /Ctrl\+Alt\+Space/);
});
