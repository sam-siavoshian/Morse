// Concurrent updates to Morse's storage keep every change: the daemon's files
// in ~/.morse and the extension's chrome.storage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serialQueue } from "../core/serial.js";
import { createMod } from "../core/mod.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let home, store;

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "morse-store-"));
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

// ---- extension: background.js + bar-host.js against a chrome.storage whose
// reads and writes take a random few ms, as the real one does.

function fakeArea() {
  const data = {};
  const tick = () => new Promise(r => setTimeout(r, Math.random() * 4));
  return {
    data,
    async get(k) { await tick(); const keys = typeof k === "string" ? [k] : k == null ? Object.keys(data) : k; return Object.fromEntries(keys.filter(x => x in data).map(x => [x, structuredClone(data[x])])); },
    async set(o) { await tick(); Object.assign(data, structuredClone(o)); },
  };
}
const event = () => { const fns = []; return { fns, addListener: f => fns.push(f), removeListener() {} }; };

async function loadExtension() {
  // The layout of dist/extension: the extension's files plus core/.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morse-ext-"));
  await fs.mkdir(path.join(dir, "core"));
  for (const f of await fs.readdir(path.join(root, "extension"))) if (f.endsWith(".js")) await fs.copyFile(path.join(root, "extension", f), path.join(dir, f));
  for (const f of await fs.readdir(path.join(root, "core"))) await fs.copyFile(path.join(root, "core", f), path.join(dir, "core", f));
  await fs.writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  const chrome = globalThis.chrome = {
    storage: { local: fakeArea(), sync: fakeArea() },
    runtime: { onConnect: event(), onMessage: event() },
    commands: { onCommand: event() },
    tabs: {}, userScripts: undefined,
  };
  await import(path.join(dir, "background.js"));
  return { chrome, dir };
}

function fakePort(url) {
  const port = { name: "morse", sender: { tab: { id: 1, windowId: 1 }, frameId: 0, documentId: "doc1", url }, onMessage: event(), onDisconnect: event(), replies: new Map() };
  port.postMessage = m => { if (m.reply != null) port.replies.get(m.reply)?.(m); };
  port.request = msg => new Promise(resolve => { port.replies.set(msg.id, resolve); port.onMessage.fns.forEach(f => f(msg)); });
  return port;
}

test("extension: 20 concurrent adds each keep 20 (mods, history, clipboard)", async () => {
  const { chrome, dir } = await loadExtension();
  try {
    const port = fakePort("https://a.com/");
    chrome.runtime.onConnect.fns.forEach(f => f(port));
    let id = 0;
    const many = make => Promise.all(Array.from({ length: 20 }, (_, i) => port.request({ id: ++id, url: "https://a.com/", ...make(i) })));
    const saved = await many(i => ({ type: "mods.save", mod: createMod({ prompt: `p${i}`, url: "https://a.com/" }) }));
    assert.ok(saved.every(r => !r.error), saved.find(r => r.error)?.error);
    assert.equal(Object.keys(chrome.storage.local.data.mods).length, 20);

    await many(i => ({ type: "history.add", text: `prompt ${i}` }));
    assert.equal(chrome.storage.local.data["morse.history"]["a.com"].length, 20);

    await many(i => ({ type: "clipboard.put", item: { id: `c${i}`, kind: "element", title: `item ${i}`, html: "<b>x</b>" } }));
    assert.equal(chrome.storage.local.data.clipboard.length, 20);

    const ids = Object.keys(chrome.storage.local.data.mods).slice(0, 5);
    await Promise.all(ids.map(modId => port.request({ id: ++id, url: "https://a.com/", type: "mods.delete", modId })));
    assert.equal(Object.keys(chrome.storage.local.data.mods).length, 15);

    await Promise.all([
      port.request({ id: ++id, type: "settings.set", settings: { hotkeys: { open: "Alt+KeyJ" } } }),
      port.request({ id: ++id, type: "settings.set", settings: { theme: "dark" } }),
      port.request({ id: ++id, type: "settings.set", settings: { barPosition: "top" } }),
    ]);
    const prefs = chrome.storage.sync.data["morse.settings"];
    assert.deepEqual([prefs.hotkeys.open, prefs.theme, prefs.barPosition], ["Alt+KeyJ", "dark", "top"]);
  } finally {
    delete globalThis.chrome;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
