// Morse on a real, installed desktop app (VSCodium, Obsidian, Joplin…), driven
// the way a person would with real X input (xdotool), and timed:
//
//   morse launch → Ctrl+Shift+Space → point at something → describe a change
//   → the model writes it → Enter to save → quit the app → morse launch again
//   → is the change back?
//
//   DISPLAY=:93 MORSE_PROVIDER=claude-code MORSE_MODEL=haiku node demo/try-real-app.js \
//     --app codium --window 'workbench\.html' --point '.statusbar' \
//     --ask 'make the status bar taller with bigger text' \
//     --check '(document.querySelector(".statusbar")?.offsetHeight || 0) > 22' \
//     --shots docs/screenshots --first 130 --name vscodium -- --no-sandbox --user-data-dir=/tmp/codium
//
//   --app       what to pass to morse launch (a name or a path)
//   --window    regex for the main window's URL
//   --point     CSS selector of the thing to point at (optional: the whole page otherwise)
//   --ask       the request, typed into the bar
//   --check     JS (in the page) that is true once the change is there; checked
//               after the change and again after the app is opened a second time
//   --setup     JS run in the page once Morse is connected (open a view, close a dialog)
//   --port      debugging port (default: morse picks one)
//
// For changes to what the app does (app profiles, docs/dev/rea.md), the
// change is also used before it is checked:
//   --act       JS run in the page after the change, before --check (open a note, fill the clipboard)
//   --press     real keys after that, for xdotool key (ctrl+shift+k); spaces between presses
//   --type      real typing after that
//   --click     click the first part the change added ([data-morse]) with the real mouse (yes), or a CSS selector
//   --focus-act CSS selector clicked with the real mouse before the keys (the editor)
//   --wait      ms to wait after acting before checking (default 1500)
//   --profile   yes: wait for the app profile before asking; MORSE_PROFILE=off runs without one
//   --relaunch  no: stop after the check (no save, quit and reopen)
//   --shots     where pictures go (none unless given), --first their first number, --name their prefix
//   -- <args>   arguments for the app (as root: --no-sandbox)
//
// Prints one JSON line at the end: { ok, ms, persisted, title, ... }.

import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CDPSession, listTargets } from "../daemon/cdp.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const appArgs = dash < 0 ? [] : argv.slice(dash + 1);
const opt = {};
for (let i = 0; i < (dash < 0 ? argv.length : dash); i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
const HOME = process.env.MORSE_HOME || await fs.mkdtemp(path.join(os.tmpdir(), "morse-real-"));
// MORSE_DEBUG: the runtime's status attribute, read here to know what the bar shows.
const ENV = { ...process.env, MORSE_HOME: HOME, FORCE_COLOR: "0", MORSE_DEBUG: "1" };
const T = Number(opt.timeout || 300000);
const OUT = opt.shots ? path.resolve(root, opt.shots) : null;
let n = Number(opt.first || 130);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(`· ${s}`);
const x = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();
const modelArgs = process.env.MORSE_MODEL ? ["--model", process.env.MORSE_MODEL] : [];
const result = { app: opt.app, ask: opt.ask, profile: process.env.MORSE_PROFILE !== "off" };

const children = [];
const done = code => { for (const c of children) try { c.kill(); } catch {} console.log(JSON.stringify(result)); process.exit(code); };
process.on("uncaughtException", e => { console.error(e); result.error = e.message; done(1); });
process.on("unhandledRejection", e => { console.error(e); result.error = e.message; done(1); });

function morse(...args) {
  const p = spawn(process.execPath, [path.join(root, "daemon/cli.js"), ...args], { env: ENV });
  p.out = "";
  p.stdout.on("data", d => { p.out += d; process.stdout.write(d); });
  p.stderr.on("data", d => { p.out += d; process.stderr.write(d); });
  children.push(p);
  return p;
}
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

const re = new RegExp(opt.window || ".");
async function mainWindow(port) {
  const t = await until(async () => (await listTargets(port)).find(t => t.type === "page" && re.test(t.url)), 60000, "the main window");
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  const ev = async expr => {
    const r = await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  return { t, s, ev, status: async () => JSON.parse((await ev(`document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"`)) || "null") };
}

// Where the page's top-left corner is on the X screen.
async function geometry(w) {
  const g = await w.ev(`({ x: screenX, y: screenY, ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight, title: document.title })`);
  return { x: g.x, y: g.y, w: g.ow, h: g.oh, left: g.x + (g.ow - g.iw), top: g.y + (g.oh - g.ih), title: g.title };
}
async function centerOf(w, win, selector) {
  const r = await w.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  return [Math.round(win.left + r[0]), Math.round(win.top + r[1])];
}
async function shot(win, name) {
  if (!OUT) return;
  const file = path.join(OUT, `${n++}-${opt.name || "app"}-${name}.png`);
  execFileSync("import", ["-window", "root", "-crop", `${win.w}x${win.h}+${win.x}+${win.y}`, "+repage", file]);
  console.log(`  shot ${path.relative(root, file)}`);
}
const quit = async port => {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const b = await CDPSession.connect(v.webSocketDebuggerUrl);
  await b.send("Browser.close").catch(() => {});
  b.close();
};

async function launch() {
  const m = morse("launch", opt.app, ...modelArgs, ...(opt.port ? ["--port", opt.port] : []), "--", ...appArgs);
  await until(() => /✓ connected to/i.test(m.out) || m.exitCode != null, 120000, () => "morse launch to connect");
  if (m.exitCode != null) throw new Error("morse launch ended: " + m.out.slice(-400));
  const port = Number(m.out.match(/port\s+(\d+)/)[1]);
  return { m, port };
}

if (OUT) await fs.mkdir(OUT, { recursive: true });
say(`Morse home ${HOME} · ${opt.app} · model ${process.env.MORSE_PROVIDER || "(configured)"} ${process.env.MORSE_MODEL || ""}`);

// ---- 1. launch, wait for the runtime (no reloading: Joplin's window stays hidden after one)
let { m, port } = await launch();
let w = await mainWindow(port);
await until(w.status, 90000, "the runtime in the main window");
if (opt.setup) await until(() => w.ev(opt.setup), 30000, "the setup step");
await sleep(Number(opt.settle || 3000));
let win = await geometry(w);
say(`window "${win.title}" at ${win.x},${win.y} ${win.w}x${win.h}`);
await shot(win, "before");

// The app profile (daemon/profile.js) is built in the background; wait for it
// so the request is judged with it, not raced against it.
if (opt.profile === "yes" && result.profile) {
  await until(() => /Morse looked at how it works inside/.test(m.out), 120000, "the app profile");
  result.profileLine = m.out.match(/· .*Morse looked at how it works inside[^\n]*/)?.[0];
}

// ---- 2. the real hotkey
// Click somewhere in the window first (--focus: a selector; the middle otherwise).
const [fx, fy] = opt.focus ? await centerOf(w, win, opt.focus) : [win.left + Math.round(win.w / 2), win.top + Math.round(win.h / 2)];
x("mousemove", "--sync", String(fx), String(fy));
x("click", "1");
await sleep(300);
x("key", "ctrl+shift+space");
await until(async () => (await w.status())?.open, 8000, "the bar to open on Ctrl+Shift+Space");
say("the bar opened from a real Ctrl+Shift+Space");

// ---- 3. point, describe
if (opt.point) {
  const [cx, cy] = await centerOf(w, win, opt.point);
  x("mousemove", "--sync", String(cx - 20), String(cy));
  await sleep(200);
  x("mousemove", "--sync", String(cx), String(cy));
  await sleep(400);
  x("click", "1");
  await sleep(300);
}
x("type", "--delay", "15", opt.ask);
await sleep(300);
await shot(win, "ask");
const t0 = Date.now();
x("key", "Return");
await until(async () => (await w.status())?.ticker.length > 30, T, "the model to start writing");
await sleep(1500);
await shot(win, "working");
const res = await until(async () => { const s = await w.status(); return ["result", "error"].includes(s?.phase) && s; }, T, "a result");
result.ms = Date.now() - t0;
result.hint = res.hint;
if (res.phase === "error") { result.ok = false; await shot(win, "error"); throw new Error("the change failed: " + res.hint); }
await sleep(800);
await shot(win, "result");
// Use the change the way a person would: a click on what it added, keys, typing.
async function act() {
  if (opt.act) await w.ev(opt.act).catch(e => say("act threw: " + e.message));
  if (opt["focus-act"]) {
    const [ax, ay] = await centerOf(w, win, opt["focus-act"]);
    x("mousemove", "--sync", String(ax), String(ay));
    x("click", "1");
    await sleep(400);
  }
  if (opt.click) {
    const sel = opt.click === "yes" ? null : opt.click;
    const all = sel ? `[...document.querySelectorAll(${JSON.stringify(sel)})]` : `[...document.querySelectorAll("[data-morse]")].flatMap(e => [e, ...e.querySelectorAll("*")])`;
    const at = await w.ev(`(() => { const all = ${all}.filter(e => e.getClientRects().length && (e.matches("button,a,[role=button],[onclick]") || getComputedStyle(e).cursor === "pointer"));
      const e = all[0]; if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2, (e.textContent || e.title || e.getAttribute("aria-label") || "").trim().slice(0, 40)]; })()`);
    if (!at) say("nothing to click: the change added no button");
    else {
      x("mousemove", "--sync", String(Math.round(win.left + at[0])), String(Math.round(win.top + at[1])));
      await sleep(200);
      x("click", "1");
      result.clicked = at[2];
      say(`clicked “${at[2]}”`);
    }
    await sleep(500);
  }
  if (opt.press) for (const k of opt.press.split(" ")) { x("key", k); await sleep(250); }
  if (opt.type) x("type", "--delay", "40", opt.type);
  await sleep(Number(opt.wait || 1500));
}
const modsDir = path.join(HOME, "mods");
let mod = null;
async function save() {
  if (mod) return mod;
  x("key", "Return"); // the bar still has the focus: Enter saves
  const file = await until(async () => (await fs.readdir(modsDir).catch(() => [])).find(f => f.endsWith(".json")), 15000, "the mod on disk");
  mod = JSON.parse(await fs.readFile(path.join(modsDir, file), "utf8"));
  Object.assign(result, { title: mod.title, match: mod.match, css: (mod.css || "").length, js: (mod.js || "").length, code: mod.js || "", style: mod.css || "" });
  say(`saved "${mod.title}" for ${JSON.stringify(mod.match)}`);
  return mod;
}
if (opt.act || opt.click || opt.press || opt.type) { await save(); await sleep(600); await act(); await shot(win, "used"); }
result.applied = opt.check ? !!(await w.ev(opt.check).catch(e => (say("check threw: " + e.message), false))) : null;
say(`result in ${(result.ms / 1000).toFixed(1)}s: ${res.hint} · check ${result.applied}`);
result.prompted = /the prompt gets \d+ lines about how/.test(m.out); // MORSE_TRACE=1: the prompt had the profile's slice
if (opt.relaunch === "no") {
  await save().catch(e => say("not saved: " + e.message));
  w.s.close();
  await quit(port).catch(() => {});
  await sleep(1500);
  result.ok = !!result.applied;
  done(0);
}

// ---- 4. save
await save();

// ---- 5. quit, open again
w.s.close();
await quit(port);
await until(() => /closed, so Morse stopped/.test(m.out) || m.exitCode != null, 30000, "morse to notice the app quit");
await sleep(2000);
({ m, port } = await launch());
w = await mainWindow(port);
// Its CSS is in the page, or its JS is running without errors.
const running = `(() => { const id = ${JSON.stringify(mod.id)}; const s = globalThis.morse?.__stats?.(id);
  return ${mod.js?.trim() ? "!!s && !s.errors" : `!!document.querySelector('style[data-morse-css="' + id + '"]')`}; })()`;
const back = await until(() => w.ev(`${running}${opt.check ? ` && !!(${opt.check})` : ""}`), 90000, "the saved change after relaunch").catch(e => (say(e.message), false));
result.persisted = !!back;
if (opt.setup) await w.ev(opt.setup).catch(() => {});
await sleep(Number(opt.settle || 3000));
win = await geometry(w);
await shot(win, "after-relaunch");
say(`after relaunch: ${back ? "the change is back" : "the change is NOT back"}`);
w.s.close();
await quit(port).catch(() => {});
await sleep(1500);
result.ok = true;
done(0);
