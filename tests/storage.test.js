// Concurrent updates to Morse's storage keep every change: the daemon's files
// in ~/.morse and the extension's chrome.storage.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serialQueue } from "../core/serial.js";
import { createMod } from "../core/mod.js";

let home, store;

before(async () => {
  home = tempDir("morse-store-");
  process.env.MORSE_HOME = home;
  store = await import("../daemon/store.js");
});
after(() => fs.rm(home, { recursive: true, force: true }));

test("serialQueue runs jobs with the same key one at a time, in order", async () => {
  const run = serialQueue(), log = [];
  const job = (n, ms) => async () => { log.push(`start ${n}`); await new Promise(r => setTimeout(r, ms)); log.push(`end ${n}`); return n; };
  const results = await Promise.all([run("a", job(1, 20)), run("a", job(2, 1)), run("b", job(3, 1))]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.ok(log.indexOf("end 1") < log.indexOf("start 2"), "same key waits");
  assert.ok(log.indexOf("start 3") < log.indexOf("end 1"), "other keys don't wait");
  // A failing job rejects alone; the next one still runs.
  const failed = run("a", async () => { throw new Error("boom"); });
  await assert.rejects(failed, /boom/);
  assert.equal(await run("a", async () => "next"), "next");
});

test("daemon: 20 concurrent history adds keep 20", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.addHistory("app", `prompt ${i}`)));
  assert.equal((await store.loadHistory("app")).length, 20);
  const onDisk = JSON.parse(await fs.readFile(path.join(home, "history.json"), "utf8"));
  assert.equal(onDisk.app.length, 20);
});

test("daemon: 20 concurrent clipboard puts keep 20", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.putClipboard({ id: `c${i}`, kind: "element", title: `item ${i}`, html: "<b>x</b>" })));
  assert.equal((await store.readClipboard()).length, 20);
});

test("daemon: concurrent settings patches all land", async () => {
  await Promise.all([
    store.savePrefs({ hotkeys: { open: "Alt+KeyJ" } }),
    store.savePrefs({ hotkeys: { mods: "Alt+KeyK" } }),
    store.savePrefs({ theme: "dark" }),
    store.savePrefs({ voice: { autoSubmit: true } }),
  ]);
  const p = await store.loadPrefs();
  assert.equal(p.hotkeys.open, "Alt+KeyJ");
  assert.equal(p.hotkeys.mods, "Alt+KeyK");
  assert.equal(p.theme, "dark");
  assert.equal(p.voice.autoSubmit, true);
});

test("daemon: 20 concurrent mod saves keep 20, and no temp files are left", async () => {
  const mods = Array.from({ length: 20 }, (_, i) => createMod({ prompt: `p${i}`, url: "https://a.com/" }));
  await Promise.all(mods.map(m => store.saveMod(m)));
  assert.equal((await store.listMods()).length, 20);
  const left = (await fs.readdir(home)).concat(await fs.readdir(path.join(home, "mods"))).filter(f => f.endsWith(".tmp"));
  assert.deepEqual(left, []);
  await Promise.all(mods.slice(0, 5).map(m => store.deleteMod(m.id)));
  assert.equal((await store.listMods()).length, 15);
});
