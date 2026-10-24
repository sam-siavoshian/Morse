// The whole desktop flow on a real Electron app (demo/electron-app, "Tunes"),
// driven the way a person would, and screenshotted from the X display so the
// app's own native menu bar is in the picture:
//
//   morse launch → the real hotkey (xdotool, real X key events) → point at the
//   player controls → describe a change → watch it work → Save → quit the app
//   from its own menu shortcut (Ctrl+Q) → morse launch again: the mod is back
//   → morse status → morse stop (the app keeps running, the mod comes off)
//   → morse fuses on the real binary.
//
//   DISPLAY=:97 node demo/shoot-electron.js
//     TUNES=/opt/Tunes/tunes     use an already packaged app (default: build one in a temp dir)
//     MORSE_PROVIDER=claude-code MORSE_MODEL=haiku   a real model instead of the demo replay
//     SHOTS=docs/screenshots  FIRST=120               where the pictures go, and their first number
//     NO_SHOTS=1                                      drive it without writing pictures
//
// Needs xdotool and ImageMagick's `import` for real input and screenshots;
// a display of its own is best (another program's windows on top spoil both).
// Running as root adds --no-sandbox for the app: Chromium refuses to start as
// root with its sandbox on (docs/desktop.md).

import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CDPSession, listTargets } from "../daemon/cdp.js";
import { listProcesses } from "../daemon/apps.js";
import { buildTunes } from "./electron-app/build.mjs";
import { defaultHotkeys } from "../core/hotkeys.js";
import { seasonHome } from "./helper.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PROVIDER = process.env.MORSE_PROVIDER || "demo";
const REAL = PROVIDER !== "demo";
const T = REAL ? 240000 : 20000;
const OUT = path.resolve(root, process.env.SHOTS || "docs/screenshots");
let n = Number(process.env.FIRST || 120);
const HOME = process.env.MORSE_HOME || await fs.mkdtemp(path.join(os.tmpdir(), "morse-electron-"));
// MORSE_DEBUG: the bar reports its status, for waiting on it (a real app has no navigator.webdriver)
const ENV = { ...process.env, MORSE_HOME: HOME, MORSE_PROVIDER: PROVIDER, FORCE_COLOR: "0", MORSE_DEBUG: "1" };
// Someone who has used Morse before: no first-run coach, no gallery list, no welcome toast.
await seasonHome(HOME);
await fs.writeFile(path.join(HOME, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(`· ${s}`);
const x = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();
// The platform's Open Morse key (Ctrl+Shift+Space on Linux) in xdotool's syntax.
const OPEN_X = defaultHotkeys("linux").open.toLowerCase();

const tunes = process.env.TUNES || (await buildTunes(path.join(HOME, "Tunes"))).exe;
const profile = path.join(HOME, "tunes-profile");
const appArgs = ["--", `--user-data-dir=${profile}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])];
const modelArgs = process.env.MORSE_MODEL ? ["--model", process.env.MORSE_MODEL] : [];

// On the way out, failed or not: no morse and no Tunes left running.
const children = [];
const cleanup = () => {
  for (const c of children) try { c.kill(); } catch {}
  for (const p of listProcesses()) if (p.cmd.includes(profile)) try { process.kill(p.pid); } catch {}
};
process.on("uncaughtException", e => { console.error(e); cleanup(); process.exit(1); });
process.on("unhandledRejection", e => { console.error(e); cleanup(); process.exit(1); });

function morse(...args) {
  const p = spawn("node", [path.join(root, "daemon/cli.js"), ...args], { env: ENV });
  p.out = "";
  p.stdout.on("data", d => { p.out += d; process.stdout.write(d); });
  p.stderr.on("data", d => { p.out += d; process.stderr.write(d); });
  p.done = new Promise(r => p.on("exit", code => r(code)));
  children.push(p);
  return p;
}
const morseSync = (...args) => execFileSync("node", [path.join(root, "daemon/cli.js"), ...args], { env: ENV, encoding: "utf8" });

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

// The main window, over CDP: read state and positions, never to click or type.
async function mainWindow(port) {
  const t = await until(async () => (await listTargets(port)).find(t => t.type === "page" && t.url.startsWith("app://tunes/")), 20000, "the Tunes window");
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  const ev = async expr => (await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  return { s, ev, status: async () => JSON.parse((await ev(`document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"`)) || "null") };
}

// Whether a part of Morse's UI is showing (<tag class=cls> without hidden).
// The bar's shadow root is closed in a real app (no navigator.webdriver);
// DevTools can still read it.
async function uiShowing(w, tag, cls) {
  const { root } = await w.s.send("DOM.getDocument", { depth: -1, pierce: true });
  const find = n => {
    const a = n.attributes || [];
    const c = a.includes("class") ? a[a.indexOf("class") + 1] : "";
    if (n.localName === tag && c.split(" ").includes(cls) && !a.includes("hidden")) return true;
    return [...(n.children || []), ...(n.shadowRoots || [])].some(find);
  };
  return find(root);
}

// The X window of the app's main window, and where its web content starts
// (below the native menu bar).
async function xWindow(w) {
  const id = await until(() => x("search", "--onlyvisible", "--name", "^Tunes$").split("\n").find(id => {
    const g = x("getwindowgeometry", "--shell", id);
    return Number(g.match(/WIDTH=(\d+)/)?.[1]) > 600;
  }), 15000, "the Tunes X window");
  const geo = Object.fromEntries(x("getwindowgeometry", "--shell", id).split("\n").map(l => l.split("=")).map(([k, v]) => [k, Number(v)]));
  const inner = await w.ev("innerHeight");
  return { id, x: geo.X, y: geo.Y, w: geo.WIDTH, h: geo.HEIGHT, top: geo.Y + geo.HEIGHT - inner };
}
async function centerOf(w, win, selector) {
  const r = await w.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  return [Math.round(win.x + r[0]), Math.round(win.top + r[1])];
}
// Without a window manager a click is what gives a window the keyboard:
// click a quiet spot (the empty space right of the heading) before a shortcut.
async function focusApp(win) {
  x("windowfocus", "--sync", win.id);
  x("mousemove", "--sync", String(win.x + 900), String(win.top + 40));
  x("click", "1");
  await sleep(300);
}
async function shot(win, name) {
  if (process.env.NO_SHOTS) return;
  const file = path.join(OUT, `${n++}-${name}.png`);
  execFileSync("import", ["-window", "root", "-crop", `${win.w}x${win.h}+${win.x}+${win.y}`, "+repage", file]);
  console.log(`  📸 ${path.relative(root, file)}`);
}

await fs.mkdir(OUT, { recursive: true });
say(`Morse home ${HOME} · app ${tunes} · model ${PROVIDER}${process.env.MORSE_MODEL ? " " + process.env.MORSE_MODEL : ""}`);

// ---- 1. morse launch
const m1 = morse("launch", tunes, ...modelArgs, ...appArgs);
await until(() => /connected to Tunes/i.test(m1.out), 40000, "morse launch to connect");
const port = Number(m1.out.match(/port\s+(\d+)/)[1]);
let w = await mainWindow(port);
await w.ev(`localStorage.setItem("morse:debug", "1"), location.reload()`);
await sleep(500);
w.s.close();
w = await mainWindow(port);
await until(w.status, 15000, "the runtime to start");
let win = await xWindow(w);
x("windowfocus", "--sync", win.id);

// ---- 2. the real hotkey, from the X server
await focusApp(win);
x("mousemove", String(win.x + 700), String(win.top + 300));
x("key", OPEN_X);
await until(async () => (await w.status())?.open, 15000, `the bar to open on ${OPEN_X}`);
say(`the bar opened from a real ${OPEN_X}`);

// ---- 3. point at the player controls, pick them, describe the change
// On a busy machine the app can miss a quick hover or click: wait for the
// outline before the picture, and for the pick before typing.
const [cx, cy] = await centerOf(w, win, '[data-testid="player-controls"] .btns');
let shotPoint = false;
const picked = async () => !/^Point at anything/.test((await w.status())?.hint || "Point at anything");
for (let i = 0; i < 4 && !(await picked()); i++) {
  x("mousemove", "--sync", String(cx - 30), String(cy));
  await sleep(300);
  x("mousemove", "--sync", String(cx), String(cy));
  const outlined = await until(() => uiShowing(w, "div", "hl"), 5000, "the outline").catch(() => false);
  await sleep(300);
  if (outlined && !shotPoint) { await shot(win, "electron-point"); shotPoint = true; }
  x("click", "1");
  await until(async () => (await picked()) || null, 4000, "the pick").catch(() => {});
}
if (!(await picked()) || !shotPoint) throw new Error("couldn't point at the player controls");
x("type", "--delay", "15", "add a sleep timer that pauses the music after a while");
await until(async () => /after a while$/.test((await w.status())?.input || ""), 15000, "the request in the bar");
await sleep(300);
await shot(win, "electron-bar");
x("key", "Return");
await until(async () => (await w.status())?.ticker.length > 40, T, "the model to start writing");
await sleep(REAL ? 1500 : 500);
await shot(win, "electron-working");
const done = await until(async () => { const s = await w.status(); return ["result", "error"].includes(s?.phase) && s; }, T, "a result");
if (done.phase === "error") throw new Error("generation failed: " + done.hint);
await sleep(500);
await shot(win, "electron-result");
say(`result: ${done.hint}`);

// ---- 4. keep it
x("key", "Return");
const modsDir = path.join(HOME, "mods");
const file = await until(async () => (await fs.readdir(modsDir).catch(() => [])).find(f => f.endsWith(".json")), 10000, "the mod to be saved");
const mod = JSON.parse(await fs.readFile(path.join(modsDir, file), "utf8"));
console.log(morseSync("mods"));
say(`saved "${mod.title}" for app ${mod.match.app} on ${mod.match.hosts.join(", ")}`);

// ---- 5. quit from the app's own menu shortcut; morse notices
x("windowfocus", "--sync", win.id);
x("key", "Escape"); // close the bar, so the app has the keyboard
await until(async () => !(await w.status())?.open, 5000, "the bar to close");
await focusApp(win);
x("key", "ctrl+q");
// (morse launch then exits, after it finishes encoding the share clip if one is still going)
await until(() => /closed, so Morse stopped/.test(m1.out), 60000, "morse to notice the app quit"); // it finishes the share clip first
say(`Tunes quit from its menu shortcut; morse said "${m1.out.trim().split("\n").pop()}"`);

// ---- 6. launch again: the mod comes back by itself
const m2 = morse("launch", tunes, ...modelArgs, ...appArgs);
await until(() => /connected to Tunes/i.test(m2.out), 40000, "the second morse launch");
const port2 = Number(m2.out.match(/port\s+(\d+)/)[1]);
w = await mainWindow(port2);
// The mod is running again: its code is loaded and what it watches is found
// (a real model may write no CSS, so its style tag isn't proof).
const running = `(() => { const s = globalThis.morse?.__stats?.(${JSON.stringify(mod.id)}); return !!s && !s.errors && s.watches.every(w => w.total > 0); })()`;
await until(() => w.ev(`${running}${REAL ? "" : ` && !!document.querySelector(".morse-sleep")`}`), 15000, "the saved mod to run again after relaunch");
await sleep(800);
win = await xWindow(w);
await shot(win, "electron-mod-back");
say("after relaunch the mod is back: it runs again and finds its elements" + (REAL ? "" : ", and the ☾ button is in the player"));

// ---- 6b. the Mods panel hotkey (Alt+Shift+M) works with the native menu bar there
await focusApp(win);
x("key", "alt+shift+m");
const panelOpen = () => uiShowing(w, "aside", "panel");
await until(panelOpen, 15000, "the Mods panel on Alt+Shift+M");
say("the Mods panel opened from a real Alt+Shift+M");
await sleep(400);
await shot(win, "electron-mods-panel");
x("key", "Escape");
await focusApp(win);

// ---- 6c. a second window from the app's menu shortcut gets Morse too
x("key", "ctrl+shift+m");
const miniT = await until(async () => (await listTargets(port2)).find(t => t.url.endsWith("/mini.html")), 10000, "the Mini Player window to open on Ctrl+Shift+M");
const mini = await CDPSession.connect(miniT.webSocketDebuggerUrl);
const miniHas = async () => (await mini.send("Runtime.evaluate", { expression: `!!document.querySelector("[data-morse-ui]")`, returnByValue: true })).result.value;
await until(miniHas, 10000, "the runtime in the Mini Player");
say(`the Mini Player (${miniT.url.slice(0, 7)}… second window) has Morse in it`);
mini.close();

// ---- 7. status, stop
const status = morseSync("status");
console.log(status);
if (!/Tunes/.test(status)) throw new Error("morse status doesn't list Tunes");
console.log(morseSync("stop", "tunes"));
await Promise.race([m2.done, sleep(8000)]);
await until(async () => !(await w.ev(`!!document.querySelector("style[data-morse-css], [data-morse-ui]")`)), 8000, "the mod and bar to come off after morse stop");
const still = (await listTargets(port2)).some(t => t.url.startsWith("app://tunes/"));
say(`after morse stop: mod and bar removed, app still running: ${still}`);
w.s.close();
await focusApp(win);
x("key", "ctrl+q");

// ---- 8. fuses on the real binary
console.log(morseSync("fuses", tunes));
say("done");
cleanup();
process.exit(0);
