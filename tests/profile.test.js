// App profiles (daemon/profile.js, core/profile.js, docs/dev/rea.md): what
// Morse reads about how a desktop app works inside, read only, and the slice
// of it the prompt gets.
//   - the code scan on real-looking minified snippets (VS Code, Obsidian,
//     Joplin shapes) and on demo/electron-app, unpacked and packed as app.asar
//   - the app's files are byte-for-byte the same afterwards (hashes)
//   - the cache in ~/.morse/profiles, per app and code version
//   - the prompt: only requests about behavior get it, with the commands
//     that fit; a draft that runs a command the app doesn't have is repaired
//   - the runtime pass in a real Chromium: a command runner found from the
//     globals and one found only through an event listener's closure, the
//     handle mods use (morse.app.command), and morse.on with an app's emitter
//   - the real Tunes app (Electron, skipped without a runtime or a display):
//     morse launch builds the profile in the background and a mod runs the
//     app's own command
import { home, tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import { promises as fs, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { scanCode, profileSlice, needsLogic, mergeScans } from "../core/profile.js";
import { buildMessages } from "../core/prompt.js";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { KIT_SOURCE, wrapModCode } from "../core/kit.js";
import * as P from "../daemon/profile.js";
import { packAsar, findElectron, buildTunes } from "../demo/electron-app/build.mjs";
import { noBrowser, launchBrowser } from "./helpers/browser.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP = path.join(root, "demo", "electron-app");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

// Every file under dir: path -> sha256, size and modification time.
function hashTree(dir) {
  const out = {};
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { const st = statSync(p); out[path.relative(dir, p)] = `${createHash("sha256").update(readFileSync(p)).digest("hex")} ${st.size} ${st.mtimeMs}`; }
    }
  };
  walk(dir);
  return out;
}

// The Tunes app's code laid out the way build.mjs ships it: <resources>/app/
// (unpacked, like VS Code) or <resources>/app.asar (packed, like most apps).
async function tunesResources({ asar = false } = {}) {
  const res = path.join(tempDir("morse-profile-app-"), "resources");
  const app = path.join(res, "app");
  await fs.mkdir(path.join(app, "ui"), { recursive: true });
  for (const f of ["package.json", "main.js", "preload.js", "renderer.js", "mini.html"]) await fs.copyFile(path.join(APP, f), path.join(app, f));
  await fs.copyFile(path.join(root, "demo", "sites", "tunes", "index.html"), path.join(app, "ui", "index.html"));
  // Electron's own archive sits next to the app's; it is not the app's code.
  await fs.writeFile(path.join(res, "default_app.asar"), "not the app");
  if (asar) { await packAsar(app, path.join(res, "app.asar")); await fs.rm(app, { recursive: true }); }
  return res;
}

// ---------------------------------------------------------------- the code scan

test("scanCode: IPC channels (also through minified aliases), contextBridge APIs, menu keys, windows and preloads", () => {
  const preload = `const{contextBridge:u,ipcRenderer:r}=require("electron");u.exposeInMainWorld("api",{info:()=>r.invoke("app:info"),open(x){r.send("app:open",x)},onTick:f=>r.on("app:tick",f)});`;
  const s = scanCode(preload, { role: "preload" });
  assert.deepEqual(s.bridge, [{ name: "api", keys: ["info", "open", "onTick"] }]);
  assert.deepEqual(s.ipc.map(c => `${c.side} ${c.op} ${c.channel}`), ["renderer invoke app:info", "renderer send app:open", "renderer on app:tick"]);
  const main = `ipcMain.handle("app:info",()=>1);ipcMain.on("app:open",f);win.webContents.send("app:tick",1);
    new BrowserWindow({webPreferences:{preload:path.join(__dirname,"preload.js")}}).loadURL("app://x/index.html");
    Menu.buildFromTemplate([{label:"Mini Player",accelerator:"CmdOrCtrl+Shift+M",click:openMini}])`;
  const m = scanCode(main, { role: "main" });
  assert.deepEqual(m.ipc.map(c => `${c.side} ${c.op} ${c.channel}`), ["main handle app:info", "main on app:open", "to-renderer send app:tick"]);
  assert.deepEqual(m.windows, ["app://x/index.html"]);
  assert.deepEqual(m.preloads, ["preload.js"]);
  assert.deepEqual(m.keys, [["CmdOrCtrl+Shift+M", "Mini Player"]]);
});

test("scanCode: commands the way real apps register them, with their names", () => {
  // VS Code: an action with an id, a localized label and a run method.
  const vscode = `class x extends Ze{constructor(){super({id:"editor.action.formatDocument",label:O(1210,"Format Document"),precondition:T.and(a,b),kbOpts:{primary:1572}})}run(e){}}
    Ke.registerCommand("workbench.action.files.save",function(){});e.executeCommand("editor.action.formatSelection")`;
  // Obsidian: addCommand with a name from its translations.
  const obsidian = `this.addCommand({id:"editor:toggle-bold",name:db.commands.toggleBold(),hotkeys:[],editorCallback:function(e){}})`;
  // Joplin: a declaration whose label is a function (esbuild keeps names: o(fn, "label")).
  const joplin = `M1.declaration={name:"newNote",label:o(()=>(0,eMl._)("New note"),"label"),iconName:"fa-file"};Rxn.default.instance().execute("newFolder")`;
  // A registry like the Tunes sample app's.
  const registry = `app.register("player:next","Next song",()=>p.next());`;
  const ids = Object.fromEntries([vscode, obsidian, joplin, registry].flatMap(t => scanCode(t).commands).map(([id, l]) => [id, l || ""]));
  assert.equal(ids["editor.action.formatDocument"], "Format Document");
  assert.equal(ids["workbench.action.files.save"], "");
  assert.ok("editor.action.formatSelection" in ids);
  assert.equal(ids["editor:toggle-bold"], "toggle bold", "named from the translation key");
  assert.equal(ids.newNote, "New note");
  assert.ok("newFolder" in ids);
  assert.equal(ids["player:next"], "Next song");
  // Not commands: addresses, file names, and ids of objects that don't run anything.
  const none = scanCode(`x={id:"https://a.b/c"};y={id:"main.js",run(){}};z={id:"user.name",color:"red"}`).commands;
  assert.deepEqual(none, []);
});

test("scanCode: store actions, routes, the app's own events, exports and bundlers", () => {
  const s = scanCode(`dispatch({type:"NOTE_SELECT",id:1});case"FOLDER_DELETE":;x={type:"TAG_UPDATE_ONE"};
    const routes=[{path:"/settings",element:a},{path:"/notes/:id",element:b}];navigate("/x");
    vault.on("modify",f);workspace.on("file-open",g);el.on("click",h);__webpack_require__(1);n.d(t,{createNote:()=>c,deleteNote:()=>d});`);
  assert.deepEqual(s.actions.sort(), ["NOTE_SELECT", "TAG_UPDATE_ONE"]);
  assert.deepEqual(s.routes, ["/settings", "/notes/:id"]);
  assert.deepEqual(s.events, ["modify", "file-open"], "DOM events like click are not the app's");
  assert.equal(s.bundler, "webpack");
  assert.deepEqual(s.exports, ["createNote", "deleteNote"]);
  assert.equal(scanCode(`"use strict";(()=>{var a=__toESM(b)})()`).bundler, "esbuild");
});

test("scanCode on a 20 MB bundle takes well under a few seconds", () => {
  const chunk = `function f(a){return a+1}var x={id:"my.command.run",label:"Run",run(){}};ipcRenderer.send("ch:a");`;
  const big = chunk.repeat(Math.ceil((20 << 20) / chunk.length));
  const t0 = Date.now();
  const s = scanCode(big);
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(s.commands, [["my.command.run", "Run"]]);
});

// ---------------------------------------------------------------- the sample app, read only

for (const asar of [false, true]) {
  test(`the static profile of demo/electron-app (${asar ? "packed as app.asar" : "unpacked in resources/app"}), and its files stay the same`, async () => {
    const res = await tunesResources({ asar });
    const before = hashTree(res);
    const roots = P.codeRoots(res);
    assert.deepEqual(roots.map(r => r.kind), [asar ? "asar" : "dir"], "Electron's default_app.asar is not the app's code");
    // In the worker, the way Morse runs it, and in this thread.
    const p = await P.staticProfile(roots, { scripts: ["app://tunes/renderer.js"] });
    const q = P.scanApp(roots);
    for (const prof of [p, q]) {
      assert.deepEqual(prof.files.map(f => `${f.role} ${f.file.split("/").pop()}`).sort(), ["main main.js", "preload preload.js", "renderer renderer.js"]);
      const channels = new Set(prof.ipc.map(c => c.channel));
      for (const c of ["tunes:info", "tunes:mini", "tunes:command", "tunes:queue", "tunes:like"]) assert.ok(channels.has(c), `IPC channel ${c}`);
      assert.ok(prof.ipc.some(c => c.side === "main" && c.op === "handle" && c.channel === "tunes:queue"));
      assert.deepEqual(prof.bridge, [{ name: "tunes", keys: ["info", "openMiniPlayer", "command", "onCommand", "queue", "like"] }]);
      const cmds = Object.fromEntries(prof.commands);
      assert.equal(cmds["player:next"], "Next song");
      assert.equal(cmds["player:shuffle"], "Shuffle the queue");
      assert.equal(cmds["app:open-mini-player"], "Open the mini player");
      assert.ok(prof.keys.some(([k, l]) => k === "CmdOrCtrl+Shift+M" && l === "Mini Player"));
      assert.deepEqual(prof.windows, ["app://tunes/index.html"]);
      assert.match(prof.stamp, /^[0-9a-f]{10}$/);
    }
    assert.deepEqual(hashTree(res), before, "the app's files are byte-for-byte the same, with the same times");
  });
}

test("an asar's unpacked files are read from <name>.asar.unpacked, and a broken archive is refused", async () => {
  const dir = tempDir("morse-asar-unpacked-");
  const src = path.join(dir, "src");
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(path.join(src, "a.js"), "ipcRenderer.send('x:y')");
  await packAsar(src, path.join(dir, "app.asar"));
  const a = new P.Asar(path.join(dir, "app.asar"));
  assert.equal(a.read("a.js").toString(), "ipcRenderer.send('x:y')");
  assert.deepEqual(a.list(), [{ path: "a.js", size: 23, unpacked: false }]);
  await fs.writeFile(path.join(dir, "bad.asar"), Buffer.from([4, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 127]));
  assert.throws(() => new P.Asar(path.join(dir, "bad.asar")), /not an asar/);
});

// ---------------------------------------------------------------- the cache

test("profiles are cached per app and code version in ~/.morse/profiles, and an update makes a new one", async () => {
  const res = await tunesResources({ asar: true });
  const roots = P.codeRoots(res);
  const stamp = P.codeStamp(roots);
  assert.equal(P.PROFILES, path.join(home, "profiles"));
  assert.equal(await P.loadProfile("tunes", stamp), null);
  const p = { version: 1, app: "tunes", stamp, static: P.scanApp(roots), runtime: { commands: [["player:next", "Next song"]], runner: { path: "window.tunesApp.commands", method: "execute", global: true } } };
  const file = await P.saveProfile(p);
  assert.equal(path.dirname(file), path.join(home, "profiles"));
  assert.deepEqual((await P.loadProfile("tunes", stamp)).runtime, p.runtime);
  // A profiler for that app finds it without building anything.
  const prof = new P.AppProfiler({ app: { id: "tunes", name: "Tunes" }, resources: res });
  assert.equal((await prof.loadCached())?.stamp, stamp);
  // The app updates: new code, new stamp, and the old profile goes when the new one is saved.
  await sleep(20);
  await packAsar(path.join(APP), path.join(res, "app.asar"));
  const stamp2 = P.codeStamp(roots);
  assert.notEqual(stamp2, stamp);
  assert.equal(await P.loadProfile("tunes", stamp2), null);
  await P.saveProfile({ ...p, stamp: stamp2 });
  assert.deepEqual((await fs.readdir(P.PROFILES)).filter(f => f.startsWith("tunes-")), [`tunes-${stamp2}.json`]);
});

// ---------------------------------------------------------------- the prompt

const PROFILE = {
  static: {
    commands: [["editor.action.formatDocument", "Format Document"], ["workbench.action.files.save", "Save"], ["workbench.action.toggleSidebarVisibility", "Toggle Primary Side Bar Visibility"]],
    ipc: [{ side: "renderer", op: "invoke", channel: "app:info" }], bridge: [{ name: "vscode", keys: ["ipcRenderer", "process"] }],
    keys: [["CmdOrCtrl+S", "Save"]], events: ["did-save"], actions: [],
  },
  runtime: {
    runner: { path: "_commandService", method: "executeCommand", global: false },
    commands: [["editor.action.formatDocument", ""], ["workbench.action.files.save", ""], ["workbench.action.toggleSidebarVisibility", ""], ["git.commit", "Commit"]],
    globals: [{ name: "app", methods: ["getVersion"], children: { workspace: ["getActiveFile", "openFile"] }, app: true }, { name: "moment", methods: ["format", "utc"], children: {}, app: false }],
  },
};

test("the prompt gets the profile only for requests about behavior, with the commands that fit first", () => {
  assert.equal(needsLogic("make the status bar taller"), false);
  assert.equal(needsLogic("hide this ribbon"), false);
  for (const r of ["add a button that formats the document", "when I save, also copy the file name", "add a keyboard shortcut for the terminal", "make shuffle actually random", "insert today's date"])
    assert.equal(needsLogic(r), true, r);
  assert.equal(profileSlice(PROFILE, "make the status bar taller"), "");
  const s = profileSlice(PROFILE, "add a button in the status bar that formats the document");
  assert.match(s, /await morse\.app\.command\(id, \.\.\.args\)/);
  const lines = s.split("\n");
  const first = lines.findIndex(l => /^\s{4}\S/.test(l));
  assert.equal(lines[first].trim(), "editor.action.formatDocument", "the best fit first (its name, \"Format Document\", says nothing more)");
  assert.ok(!s.includes("git.commit"), "commands that don't fit stay out");
  assert.ok(s.includes("window.app"), "the app's own object");
  assert.ok(!profileSlice(PROFILE, "add a button that toggles the side bar").includes("moment"), "a library only when the request is about what it does");
  assert.match(s, /window\.moment/, "(here it is: moment formats dates)");
  assert.ok(s.length < 2500, `compact: ${s.length} characters`);
  // The pointed-at part's handlers, from the running app.
  const t = profileSlice(PROFILE, "make shuffle actually random", { target: { listeners: [{ where: "button “Shuffle”", type: "click", source: '()=>app.execute("player:shuffle")' }] } });
  assert.match(t, /button “Shuffle” on click: \(\)=>app\.execute\("player:shuffle"\)/);
  // In the messages, before the request.
  const msgs = buildMessages({ request: "format it", context: { url: "x", title: "x", appLogic: s } });
  const user = msgs.at(-1).content;
  assert.ok(user.indexOf("How this app works inside") > 0 && user.indexOf("How this app works inside") < user.indexOf("Request: format it"));
  assert.ok(!buildMessages({ request: "x", context: { url: "x", title: "x" } }).at(-1).content.includes("How this app works inside"));
});

test("a draft that runs a command the app doesn't have gets a repair round with the close ones", async () => {
  const prof = new P.AppProfiler({ app: { id: "x" } });
  prof.profile = PROFILE;
  assert.equal(prof.vet({ js: `morse.app.command("editor.action.formatDocument")` }), null);
  assert.match(prof.vet({ js: `await morse.app.command("editor.action.formatDoc")` }), /no command "editor\.action\.formatDoc".*editor\.action\.formatDocument/);
  prof.profile = { runtime: { runner: null }, static: {} };
  assert.match(prof.vet({ js: `morse.app.command("x.y")` }), /found no command runner/);
  // In the engine: the second draft, with the right id, is the one that runs.
  const replies = [
    "TITLE: Format\n```js\nmorse.el('button', { text: 'F', on: { click: () => morse.app.command('editor.action.formatDoc') } });\n```",
    "TITLE: Format\n```js\ndocument.body.append(morse.el('button', { text: 'F', on: { click: () => morse.app.command('editor.action.formatDocument') } }));\n```",
  ];
  const prompts = [];
  registerProvider("script", async (s, messages, { onToken }) => { prompts.push(messages.at(-1).content); const r = replies.shift(); onToken(r); return r; });
  prof.profile = PROFILE;
  const ran = [];
  const res = await runMorse({ settings: { provider: "script" }, request: "a button that formats", context: { url: "x", title: "x" }, emit: () => {}, exec: async js => { ran.push(js); return { ok: true }; }, vet: d => prof.vet(d) });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.equal(ran.length, 1, "the draft with the wrong command never ran");
  assert.match(prompts[1], /no command "editor\.action\.formatDoc"/);
});

// ---------------------------------------------------------------- the running app (Chromium)

const APP_PAGE = `<!doctype html><title>Notes</title><button id="save" aria-label="Save">Save</button><div id="out"></div>
<script>
  // An app whose command service is only reachable through its listeners (like VS Code).
  (() => {
    const commands = new Map([["notes.save", { id: "notes.save", title: "Save note" }], ["notes.date", { id: "notes.date", title: "Insert date" }]]);
    const registry = { getCommands: () => commands, registerCommand() {} };
    class Service { constructor() { this.ran = []; } executeCommand(id, ...a) { if (!commands.has(id)) throw new Error("no " + id); this.ran.push(id); document.getElementById("out").textContent = id + (a.length ? ":" + a.join(",") : ""); return id; } }
    const keys = { _commandService: new Service(), _registry: registry };
    window.addEventListener("keydown", e => { if (e.key === "s" && e.ctrlKey) keys._commandService.executeCommand("notes.save"); });
    document.getElementById("save").addEventListener("click", () => keys._commandService.executeCommand("notes.save"));
  })();
</script>`;
const GLOBAL_PAGE = `<!doctype html><title>Tunes</title><button aria-label="Next">⏭</button><b id="np">A</b>
<script>
  const list = ["A", "B", "C"]; let i = 0;
  const cmds = { "player:next": { id: "player:next", name: "Next song", run: () => { i = (i + 1) % 3; document.getElementById("np").textContent = list[i]; } } };
  window.tunesApp = { commands: { execute(id) { if (!cmds[id]) return false; cmds[id].run(); return true; }, listCommands: () => Object.values(cmds) },
    player: { next() {}, previous() {} }, vault: { on(e, f) { (this.l ||= []).push([e, f]); return { e, f }; }, offref(r) { this.l = this.l.filter(x => x[1] !== r.f); }, emit(e, x) { for (const [n, f] of this.l || []) if (n === e) f(x); } } };
</script>`;

test("runtime: the command runner from the app's globals, its commands, its buttons, and the handle mods use", { skip: noBrowser }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto("data:text/html," + encodeURIComponent(GLOBAL_PAGE));
    const s = await page.context().newCDPSession(page);
    const rt = await P.runtimeProfile(s, { url: "app://tunes/index.html" });
    assert.deepEqual(rt.runner, { path: "window.tunesApp.commands", method: "execute", global: true });
    assert.deepEqual(rt.recipe.root, { kind: "window" });
    assert.deepEqual(rt.commands, [["player:next", "Next song"]]);
    assert.ok(rt.globals.find(g => g.name === "tunesApp")?.app, "the object the commands hang off is the app's");
    assert.ok(rt.listeners.length === 0 || rt.listeners.every(l => l.where), "listeners are named by what they are on");
    assert.equal(rt.installed, true);
    // A mod runs the app's own command through the handle.
    await page.evaluate(KIT_SOURCE);
    const r = await page.evaluate(wrapModCode("m1", `morse.app.command("player:next");`));
    assert.equal(r.ok, true);
    assert.equal(await page.textContent("#np"), "B");
    assert.deepEqual(await page.evaluate(() => morse.__errors("m1")), []);
    // A command the app doesn't have (it answers false) is the mod's error.
    await page.evaluate(wrapModCode("m2", `morse.app.command("player:nope");`));
    await sleep(100);
    assert.match((await page.evaluate(() => morse.__errors("m2")))[0], /didn't run it/);
    // morse.on with the app's own emitter: let go when the mod is turned off.
    await page.evaluate(wrapModCode("m3", `morse.on(tunesApp.vault, "modify", f => document.title = "saved " + f);`));
    await page.evaluate(() => tunesApp.vault.emit("modify", "a.md"));
    assert.equal(await page.title(), "saved a.md");
    await page.evaluate(() => morse.__off("m3"));
    assert.equal(await page.evaluate(() => tunesApp.vault.l.length), 0);
    // A new document: the recipe puts the handle back.
    await page.goto("data:text/html," + encodeURIComponent(GLOBAL_PAGE));
    assert.equal(await page.evaluate(() => !!window[Symbol.for("morse.app")]), false);
    assert.equal(await P.installHandle(s, rt.recipe), true);
    assert.equal(await page.evaluate(() => window[Symbol.for("morse.app")].run("player:next")), true);
  } finally { await browser.close(); }
});

test("runtime: a command service reachable only through an event listener's closure (no globals), and nothing of the app's is changed", { skip: noBrowser }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto("data:text/html," + encodeURIComponent(APP_PAGE));
    const s = await page.context().newCDPSession(page);
    const keysBefore = await page.evaluate(() => Object.getOwnPropertyNames(window).sort().join(","));
    const rt = await P.runtimeProfile(s, { url: "file:///notes/index.html" });
    assert.equal(rt.runner?.method, "executeCommand");
    assert.equal(rt.runner.global, false);
    assert.equal(rt.recipe.root.kind, "listener");
    assert.deepEqual(rt.commands.sort(), [["notes.date", "Insert date"], ["notes.save", "Save note"]]);
    // What the Save button does, from its listener (never run to find out).
    const save = rt.listeners.find(l => /Save/.test(l.where) && l.type === "click");
    assert.match(save.source, /executeCommand\("notes\.save"\)/);
    assert.equal(await page.textContent("#out"), "", "no app command ran while looking");
    assert.equal(await page.evaluate(() => Object.getOwnPropertyNames(window).sort().join(",")), keysBefore, "no new names on the app's window (the handle is a symbol)");
    await page.evaluate(KIT_SOURCE);
    await page.evaluate(wrapModCode("m1", `morse.app.command("notes.date", "today");`));
    assert.equal(await page.textContent("#out"), "notes.date:today");
    // A reload: the recipe finds the service again through the listener.
    await page.reload();
    assert.equal(await P.installHandle(s, rt.recipe), true);
    assert.equal(await page.evaluate(() => window[Symbol.for("morse.app")].run("notes.save")), "notes.save");
    // Where Morse found no runner, morse.app.command says so plainly.
    const blank = await browser.newPage();
    await blank.setContent("<p>x</p>");
    await blank.evaluate(KIT_SOURCE);
    await blank.evaluate(wrapModCode("m1", `morse.app.command("x").catch(() => {});`));
    await sleep(100);
    assert.match((await blank.evaluate(() => morse.__errors("m1")))[0], /found no way to run this app's commands/);
  } finally { await browser.close(); }
});

// ---------------------------------------------------------------- the real Tunes app (Electron)

const dist = findElectron();
const skipElectron = !dist ? "no Electron runtime (see demo/electron-app/build.mjs)" : process.platform !== "linux" ? "Tunes is packaged for Linux here" : !process.env.DISPLAY ? "Electron needs a display (DISPLAY=:99)" : false;
const procs = [];
after(() => { for (const p of procs) try { p.kill("SIGKILL"); } catch {} });
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

test("real Electron: morse launch profiles Tunes in the background, a mod runs its own command, and its files stay the same", { skip: skipElectron, timeout: 240000 }, async () => {
  const out = path.join(tempDir("morse-profile-tunes-"), "Tunes");
  const { exe } = await buildTunes(out, { dist, asar: true });
  const before = hashTree(out);
  const port = await freePort();
  const env = { ...process.env, MORSE_HOME: home, MORSE_PROVIDER: "demo", FORCE_COLOR: "0", MORSE_TRACE: "1" };
  const m = spawn(process.execPath, [path.join(root, "daemon/cli.js"), "launch", exe, "--port", String(port), "--", `--user-data-dir=${path.join(home, "tunes-profile")}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])], { env });
  procs.push(m);
  m.out = "";
  m.stdout.on("data", d => { m.out += d; });
  m.stderr.on("data", d => { m.out += d; });
  await until(() => /Morse looked at how it works inside/.test(m.out) || m.exitCode != null, 120000, () => "the profile: " + m.out.slice(-600));
  assert.match(m.out, /Tunes: Morse looked at how it works inside \(6 commands, and how to run them\)/);
  const file = (await fs.readdir(path.join(home, "profiles"))).find(f => f.startsWith("tunes-"));
  const p = JSON.parse(await fs.readFile(path.join(home, "profiles", file), "utf8"));
  assert.equal(p.runtime.runner.path, "window.tunesApp.commands");
  assert.ok(p.static.ipc.some(c => c.channel === "tunes:queue"));
  assert.ok(p.static.files.some(f => f.role === "renderer" && f.file.endsWith("renderer.js")), "the window's own script, found from the running window");
  // A mod in the app's window runs the app's own command.
  const { CDPSession, listTargets } = await import("../daemon/cdp.js");
  const t = (await listTargets(port)).find(x => x.url === "app://tunes/index.html");
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  const ev = async e => (await s.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  await until(() => ev(`!!window[Symbol.for("morse.app")]`), 20000, "the command handle");
  const now = await ev(`document.querySelector(".np b").textContent`);
  assert.equal((await ev(wrapModCode("m1", `morse.app.command("player:next");`))).ok, true);
  assert.notEqual(await ev(`document.querySelector(".np b").textContent`), now);
  s.close();
  // Opened again: the saved profile is used, nothing is read again.
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const b = await CDPSession.connect(v.webSocketDebuggerUrl);
  await b.send("Browser.close").catch(() => {});
  b.close();
  await until(() => m.exitCode != null || /closed/.test(m.out), 30000, "morse to stop");
  m.kill();
  assert.deepEqual(hashTree(out), before, "the app's files are byte-for-byte the same after launching and profiling it");
});
