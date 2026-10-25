// The shortcut that opens Morse, on disk with the other settings, and pushed
// to an app that is already connected.
import { home } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { savePrefs, loadPrefs, watchPrefs } = await import("../daemon/store.js");
const { resolveHotkeys, defaultHotkeys } = await import("../core/hotkeys.js");
const { Connector } = await import("../daemon/connector.js");

test("the open shortcut is stored with the other settings, and a change on disk is seen", async () => {
  const saved = await savePrefs({ theme: "dark", hotkeys: { open: "Alt+KeyJ" } });
  assert.equal(saved.theme, "dark");
  assert.equal(saved.hotkeys.open, "Alt+KeyJ");
  const disk = JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8"));
  assert.equal(disk.hotkeys.open, "Alt+KeyJ");
  assert.equal(disk.theme, "dark");
  const again = await loadPrefs();
  assert.equal(again.hotkeys.open, "Alt+KeyJ");
  assert.equal(again.theme, "dark");

  const seen = [];
  const watch = watchPrefs(prefs => seen.push(prefs.hotkeys.open));
  await watch.ready;
  await savePrefs({ hotkeys: { open: "Alt+Shift+KeyK" } });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !seen.includes("Alt+Shift+KeyK")) await new Promise(r => setTimeout(r, 50));
  watch.close();
  assert.ok(seen.includes("Alt+Shift+KeyK"), "the watcher saw the new shortcut");

  const reset = await savePrefs({ hotkeys: { open: "" } });
  assert.equal(reset.hotkeys.open, "");
  assert.equal(reset.theme, "dark", "resetting the shortcut leaves the other settings");
  assert.equal(resolveHotkeys(reset.hotkeys, "linux").open, defaultHotkeys("linux").open);
  assert.equal(resolveHotkeys(reset.hotkeys, "mac").open, defaultHotkeys("mac").open);
  assert.equal(resolveHotkeys(reset.hotkeys, "win").open, defaultHotkeys("win").open);
});

test("a connected window is told when the shortcut changes", () => {
  const c = new Connector({ port: 1, browser: { port: 1, kind: "port", close() {} }, log() {} });
  const sent = [];
  const send = (method, params) => { sent.push({ method, params }); return Promise.resolve(); };
  c.windows.set("page", { frameId: "f", frames: new Map([["f", { world: 4 }]]), session: { send } });
  c.windows.set("early", { frameId: "f", frames: new Map([["f", { world: null }]]), session: { send } });
  const prefs = { hotkeys: { open: "Alt+KeyJ" }, theme: "dark" };
  c.applySettings(prefs);
  assert.equal(sent.length, 1, "a window with no Morse world is skipped");
  assert.equal(sent[0].method, "Runtime.evaluate");
  assert.equal(sent[0].params.contextId, 4);
  const msg = sent[0].params.expression;
  assert.match(msg, /__morseHostReceive/);
  assert.match(msg, /settings\.changed/);
  assert.match(msg, /Alt\+KeyJ/);
  c.applySettings(null);
  assert.equal(sent.length, 1);
});
