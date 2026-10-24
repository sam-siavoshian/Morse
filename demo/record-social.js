// The launch video, version 3: a 34-second cut for X, TikTok and Instagram,
// made only of real apps and real websites, every change written live by
// Claude Code with Opus (MORSE_MODEL=sonnet works too; haiku is refused).
//
//   1. VS Code (Microsoft's own build, /usr/share/code) gets a whole new look
//   2. nodejs.org gets a dark reading mode
//   3. Obsidian gets a feature it doesn't have: a focus panel
//   4. Docker Hub: Show me once on nginx's tags, then the button Morse made
//      does it on redis's
//   5. Your style: said once in Obsidian (no model), already there in Logseq
//      when it opens next
//
//   node scripts/build.js
//   node demo/record-social.js                 → docs/launch/morse-v3-*.mp4
//
// Recording. Each app runs as a normal user (`ubuntu`, so no "[Superuser]"
// in its title bar) with a debugging port, on an X screen of this script's
// own (Xvfb, 1920×1200), and Morse connects with a real `morse attach`. The
// websites are a real Chromium with the built extension, through the
// machine's proxy. Every scene is a CDP screencast of the page (1920×1200);
// the mouse and keys go to the page as input events (CDP), the way
// Playwright drives a page. What the person does is logged: each move as an
// eased curve (start, end, bend, overshoot), each press and release, each
// key; the cursor is drawn from that log afterwards, at 30 fps, so it glides
// even when the machine paints the page a few times a second. A generation
// that fails or adds nothing visible is thrown away and recorded again.
//
// The edit (build). Scenes are cut to the beat of the music (122 BPM): every
// cut lands on a beat, the first change lands on the track's drop, and the
// music stops for a beat before the end card. Waiting for the model is
// folded and labelled on screen ("sped up N×"); pauses where the person did
// nothing are shortened. The camera eases in and out (cubic), arriving on
// the change as it lands. demo/compose-social.py draws each frame (the
// crop, the cursor, the click ripple, the captions) and pipes it to ffmpeg.
// Three formats (16:9, 4:5, 9:16), each with and without music, a poster,
// and a GIF of the hook. docs/launch/MUSIC.md says what the music is.
//
// Env: WORK (keep raw recordings there; the apps' folders go in it too, so
// somewhere the app user can read, not a private temp folder), REUSE=<WORK>
// (record nothing, edit again), ONLY=vscode,nodejs (record just these;
// scenes: vscode, obsidian, style, nodejs, docker), TRIES (3), MORSE_MODEL
// (opus), MUSIC (path to the track; docs/launch/MUSIC.md), OUT, SEGS
// (preview just these scenes), VSCODE_ASK (another request for VS Code).
// Needs: Xvfb, xdotool, ffmpeg, Playwright, python3 with Pillow, VS Code
// (`code`), the Obsidian and Logseq AppImages (OBSIDIAN, LOGSEQ; unpacked
// into WORK), a user named `ubuntu` (APP_USER), Claude Code signed in, and
// network access to nodejs.org and hub.docker.com.

import { spawn, execFileSync } from "node:child_process";
import { promises as fs, existsSync, statSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createRequire } from "node:module";
import { startHelper, pairExtension, routeHelper, seasonExtension, SEASONED } from "./helper.js";
import { CDPSession, listTargets } from "../daemon/cdp.js";
import { pathAt } from "./social-edit.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.OUT || path.join("docs", "launch"));
const EXT = path.join(root, "dist", "extension");
const MODEL = process.env.MORSE_MODEL || "opus";
if (/haiku/i.test(MODEL)) throw new Error("This cut uses Sonnet or Opus (MORSE_MODEL=opus or sonnet), never haiku.");
process.env.MORSE_PROVIDER = "claude-code";
process.env.MORSE_MODEL = MODEL;
const MODEL_LABEL = `Claude Code (${MODEL[0].toUpperCase()}${MODEL.slice(1)})`;
const APP_USER = process.env.APP_USER || "ubuntu";
const OBSIDIAN = process.env.OBSIDIAN || path.join(os.homedir(), "Applications", "Obsidian-1.14.5.AppImage");
const CODE = process.env.VSCODE || "/usr/share/code/code";
const MUSIC = process.env.MUSIC || "";
const TRIES = Number(process.env.TRIES || 3);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const W = 1280, H = 800, S = 1.5, FPS = 30; // the page in CSS pixels; frames are W*S × H*S
const SW = W * S, SH = H * S;
const OPEN = "Control+Shift+Space"; // Morse's default on Linux (core/hotkeys.js)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const now = () => Date.now() / 1000;
const log = (...a) => console.log("  ·", ...a);
const mb = f => (statSync(f).size / 1e6).toFixed(2) + " MB";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
async function until(fn, ms, what = String(fn)) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(100); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

// Everything this script starts, stopped when it ends (apps by process group).
const kids = new Set();
const track = p => { kids.add(p); p.on("exit", () => kids.delete(p)); return p; };
const killAll = () => { for (const k of kids) { try { process.kill(-k.pid, "SIGKILL"); } catch {} try { k.kill("SIGKILL"); } catch {} } };
process.on("exit", killAll);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

// ---------------------------------------------------------------- the person
// Every move, press and key, on the wall clock, in the page's CSS pixels.
// A move is logged as what it is (from, to, bend, overshoot, when it started
// and ended) and drawn from that, so the drawn cursor follows the same curve
// the input events took, at any frame rate.
const LOG = [];
// io: move(x, y), down(), up(), char(ch), key(name). Positions in CSS pixels.
function human(io, at = [W * 0.6, H * 0.45]) {
  let [cx, cy] = at;
  LOG.push({ t: now(), x: cx, y: cy });
  const me = {
    at: () => [cx, cy],
    async move(x, y, ms, { direct = false } = {}) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 0.5) return;
      ms ??= Math.min(600, Math.max(260, 240 + d * 0.42));
      const m = { x0: cx, y0: cy, x1: x, y1: y, bend: (Math.random() < 0.5 ? -1 : 1) * Math.min(36, d * 0.09), over: Math.min(7, d * 0.022) };
      const t0 = now(), steps = Math.max(5, Math.round(ms / 35));
      for (let i = 1; i <= steps; i++) {
        const [px, py] = pathAt(m, i / steps);
        if (!direct || i === steps) await io.move(px, py);
        const wait = t0 + (i / steps) * ms / 1000 - now();
        if (wait > 0) await sleep(wait * 1000);
      }
      LOG.push({ ...m, t0, t1: now() });
      cx = x; cy = y;
    },
    async down() { LOG.push({ t: now(), down: true }); await io.down(); },
    async up() { LOG.push({ t: now(), down: false }); await io.up(); },
    async click(x, y) {
      if (x !== undefined) await me.move(x, y);
      await sleep(rand(70, 120));
      await me.down(); await sleep(rand(60, 90)); await me.up();
      await sleep(rand(100, 160));
    },
    async key(name) { LOG.push({ t: now(), key: name }); await io.key(name); },
    async type(text, { fast = true } = {}) {
      for (const ch of text) {
        LOG.push({ t: now(), key: ch });
        await io.char(ch);
        let ms = fast ? rand(18, 45) : rand(40, 100);
        if (ch === " " && Math.random() < 0.15) ms += rand(30, 90);
        await sleep(ms);
      }
    },
  };
  return me;
}

// Keys by name, as CDP key events (modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8).
const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  [OPEN]: { key: " ", code: "Space", windowsVirtualKeyCode: 32, modifiers: 2 | 8 },
  "Control+a": { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 },
};
function cdpInput(s) {
  let px = 0, py = 0, buttons = 0;
  const mouse = (type, extra = {}) => s.send("Input.dispatchMouseEvent", { type, x: px, y: py, button: "left", buttons, clickCount: 1, ...extra });
  return {
    move: async (x, y) => { px = x; py = y; await mouse("mouseMoved", buttons ? {} : { button: "none" }); },
    down: async () => { buttons = 1; await mouse("mousePressed"); },
    up: async () => { buttons = 0; await mouse("mouseReleased"); },
    wheel: async (dy) => s.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: px, y: py, deltaX: 0, deltaY: dy }),
    char: async ch => {
      await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    },
    key: async name => {
      const k = KEYS[name];
      if (!k) throw new Error(`no key ${name}`);
      await s.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...k });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, text: undefined });
    },
  };
}

// ---------------------------------------------------------------- recording
// One screencast of a page (an app's window or a browser tab): frames on disk
// with wall-clock times, plus the marks, rectangles and waits the scene notes.
async function recordCast(s, out, body) {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const frames = [], offsets = [], writes = [];
  let n = 0;
  const onFrame = p => {
    const file = `f${String(n++).padStart(5, "0")}.jpg`;
    offsets.push(now() - p.metadata.timestamp);
    frames.push({ file, t: p.metadata.timestamp });
    writes.push(fs.writeFile(path.join(out, file), Buffer.from(p.data, "base64")));
    s.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  };
  s.on("Page.screencastFrame", onFrame);
  await s.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: SW, maxHeight: SH, everyNthFrame: 1 });
  await sleep(500);
  const marks = {}, rects = {}, waits = [];
  const rec = {
    mark: k => { marks[k] = now(); },
    rect: (k, r) => { if (r) rects[k] = { x: r.x, y: r.y, w: r.width ?? r.w, h: r.height ?? r.h }; },
    wait: (from, to, label) => waits.push({ from, to, label }),
  };
  rec.mark("start");
  const l0 = LOG.length;
  let result;
  try { result = await body(rec); }
  finally {
    rec.mark("end");
    await sleep(300);
    await s.send("Page.stopScreencast").catch(() => {});
    s.off?.("Page.screencastFrame", onFrame);
    await Promise.all(writes);
  }
  offsets.sort((a, b) => a - b);
  const off = offsets[Math.floor(offsets.length / 2)] || 0; // wall clock minus the compositor's
  frames.forEach(f => { f.t += off; });
  frames.sort((a, b) => a.t - b.t);
  const last = LOG.slice(0, l0).reverse().find(e => e.x !== undefined && e.x0 === undefined);
  const meta = { name: path.basename(out), frames, marks, rects, waits, log: [...(last ? [{ ...last, t: marks.start }] : []), ...LOG.slice(l0)], result };
  await fs.writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 1));
  log(`${meta.name}: ${frames.length} frames, ${(marks.end - marks.start).toFixed(1)}s, ${(frames.length / (marks.end - marks.start)).toFixed(0)} fps`);
  return result;
}

// Morse's state, from the page (MORSE_DEBUG / morse:debug).
const STATUS = `JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")`;
const rectJs = expr => `(() => { const e = ${expr}; const r = e && e.getBoundingClientRect(); return r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`;
const inBar = sel => `document.querySelector("[data-morse-ui][data-status]")?.shadowRoot.querySelector(${JSON.stringify(sel)})`;

// A page to work with, over CDP: evaluate, status, rectangles.
function pageTools(getS, fresh = async () => {}) {
  const ev = async expr => {
    await fresh();
    // A page that doesn't answer in 20 s is stuck (a mod that never lets go of
    // the page): the take is thrown away.
    const r = await Promise.race([getS().send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }),
      sleep(30000).then(() => { throw new Error("the page stopped answering"); })]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  // Morse's bar lives in a shadow root that is closed unless the page is in
  // debug mode (runtime/boot.js); DevTools can still see in, so find the
  // part there: match the last simple selector (.class, [attr=value]).
  const barRect = async sel => {
    const open = await ev(rectJs(inBar(sel))).catch(() => null);
    if (open) return open;
    const s = getS();
    const want = sel.trim().split(/\s+/).pop();
    const cls = [...want.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    const attrs = [...want.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)].map(m => [m[1], m[2]]);
    const tag = (want.match(/^[a-z]+/i) || [""])[0].toUpperCase();
    const doc = await s.send("DOM.getDocument", { depth: 0 });
    const host = await s.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "[data-morse-ui][data-status]" });
    if (!host.nodeId) return null;
    const { node } = await s.send("DOM.describeNode", { nodeId: host.nodeId, depth: -1, pierce: true });
    const hits = [];
    const walk = n => {
      const a = {};
      for (let i = 0; i < (n.attributes || []).length; i += 2) a[n.attributes[i]] = n.attributes[i + 1];
      const classes = (a.class || "").split(/\s+/);
      if (n.nodeType === 1 && (!tag || n.nodeName === tag) && cls.every(c => classes.includes(c)) && attrs.every(([k, v]) => k in a && (v === undefined || a[k] === v))) hits.push(n.backendNodeId);
      for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) walk(c);
    };
    walk(node);
    for (const id of hits) {
      try {
        const { model } = await s.send("DOM.getBoxModel", { backendNodeId: id });
        const q = model.border, xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
        const r = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        if (r.width > 0 && r.height > 0) return r;
      } catch {}
    }
    return null;
  };
  return { ev, st: () => ev(STATUS), rect: expr => ev(rectJs(expr)), barRect };
}

// Ask: open the bar, type, Enter, wait for the model; the wait is noted.
async function ask(P, me, rec, text, n, { point = null } = {}) {
  for (let i = 0; i < 4 && !(await P.st().catch(() => null))?.open; i++) {
    await me.key(OPEN);
    await until(async () => (await P.st())?.open, 3000, "the bar").catch(() => {});
  }
  await sleep(400);
  if (point) {
    const [x, y] = point;
    await me.move(x, y);
    await sleep(500);
    await me.click();
    await sleep(400);
  }
  rec.mark(`ask${n}`);
  rec.rect(`bar${n}`, await P.barRect(".bar"));
  await me.type(text);
  await sleep(350);
  rec.mark(`enter${n}`);
  await me.key("Enter");
  const t0 = now();
  await until(async () => ["working", "result", "error"].includes((await P.st())?.phase), 15000, "the model to start");
  const done = await until(async () => { const v = await P.st(); return ["result", "error"].includes(v?.phase) && v; }, 300000, "a result");
  const t1 = now();
  rec.wait(t0 + 0.3, t1 - 0.2, "Waiting for the model");
  rec.mark(`result${n}`);
  rec.rect(`bar${n}r`, await P.barRect(".bar"));
  return { phase: done.phase, hint: done.hint, secs: +(t1 - t0).toFixed(1) };
}
async function save(P, me, rec, n) {
  const b = await P.barRect(".actions [data-a=keep]");
  if (b) await me.click(b.x + b.width / 2, b.y + b.height / 2);
  else await me.key("Enter");
  rec.mark(`saved${n}`);
  await until(async () => (await P.st())?.phase !== "result", 5000, "saved").catch(() => {});
}

// ---------------------------------------------------------------- apps
let DISPLAY = null;
async function startXvfb() {
  let n = 160;
  while (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`)) n++;
  // -ac: the apps run as another user; -nolisten tcp keeps it on this machine.
  track(spawn("Xvfb", [`:${n}`, "-screen", "0", `${SW}x${SH}x24`, "-nolisten", "tcp", "-ac", "-r"], { stdio: "ignore", detached: true }));
  await until(() => existsSync(`/tmp/.X11-unix/X${n}`), 10000, "Xvfb");
  DISPLAY = `:${n}`;
  process.on("exit", () => { for (const f of [`/tmp/.X11-unix/X${n}`, `/tmp/.X${n}-lock`]) try { rmSync(f, { force: true }); } catch {} });
  try { execFileSync("xsetroot", ["-solid", "#16161a"], { env: { ...process.env, DISPLAY } }); } catch {}
  return DISPLAY;
}
const xdo = (...args) => execFileSync("xdotool", args, { env: { ...process.env, DISPLAY }, encoding: "utf8" }).trim();
// Fill the screen with every window there is (no window manager to maximize them).
function fillScreen() {
  let ids = [];
  try { ids = xdo("search", "--onlyvisible", "--name", ".").split("\n").filter(Boolean); } catch { return 0; }
  for (const id of ids) try { xdo("windowmove", id, "0", "0"); xdo("windowsize", id, String(SW), String(SH)); } catch {}
  return ids.length;
}

// An app, started by its user, with a debugging port; Morse attaches to it.
async function startApp({ name, bin, args = [], home, morseHome, window: re }) {
  const port = await freePort();
  await fs.mkdir(home, { recursive: true });
  execFileSync("chown", ["-R", `${APP_USER}:${APP_USER}`, home]);
  const logFile = openSync(path.join(path.dirname(home), `${path.basename(home)}.log`), "a");
  const app = track(spawn("runuser", ["-u", APP_USER, "--", "env", `HOME=${home}`, `DISPLAY=${DISPLAY}`, "LANG=en_US.UTF-8",
    bin, `--remote-debugging-port=${port}`, `--force-device-scale-factor=${S}`, "--no-sandbox", "--enable-automation", ...args], { stdio: ["ignore", logFile, logFile], detached: true }));
  let morse = null, s = null;
  const kill = () => { try { s?.close(); } catch {} for (const p of [morse, app]) { if (p) try { process.kill(-p.pid, "SIGKILL"); } catch {} } };
  try {
  const target = await until(async () => (await listTargets(port)).find(t => t.type === "page" && re.test(t.url)), 150000, `the ${name} window`)
    .catch(async e => { log(`${name} targets: ${JSON.stringify(await listTargets(port).catch(err => err.message))}`.slice(0, 600)); throw e; });
  await until(() => fillScreen() > 0, 20000, "a window").catch(() => {});
  await sleep(1500);
  fillScreen();
  // morse attach, as this user, with its own Morse home.
  const out = { text: "" };
  morse = track(spawn(process.execPath, [path.join(root, "daemon/cli.js"), "attach", "--port", String(port), "--app", name, "--model", MODEL],
    { env: { ...process.env, MORSE_HOME: morseHome, MORSE_DEBUG: "1", FORCE_COLOR: "0", MORSE_TRACE: path.join(morseHome, "trace.log") }, stdio: ["ignore", "pipe", "pipe"], detached: true }));
  morse.stdout.on("data", d => { out.text += d; });
  morse.stderr.on("data", d => { out.text += d; });
  await until(() => /connected on port/i.test(out.text) || morse.exitCode != null, 30000, "morse attach");
  if (morse.exitCode != null) throw new Error("morse attach ended: " + out.text.slice(-300));
  // Morse may reload the window as it connects: talk to whichever page is there now.
  const connect = async () => {
    const t = await until(async () => (await listTargets(port)).find(t => t.type === "page" && re.test(t.url)), 30000, `the ${name} window`);
    s = await CDPSession.connect(t.webSocketDebuggerUrl);
    const mine = s;
    s.on("close", () => log(`${name}: the window's CDP connection closed${mine === s ? "" : " (an old one)"}`));
  };
  await connect();
  const P = pageTools(() => s, async () => { if (s.closed) await connect(); });
  const ready = async () => { if (s.closed) await connect(); return (await P.st())?.ready; };
  await until(ready, 150000, `Morse in ${name}`);
  // Morse's bar in debug mode (an open shadow root, to find its buttons): set
  // in the page and reloaded, as Morse's own tests do (runtime/src/10-dom.js).
  await P.ev(`localStorage.setItem("morse:debug", "1"), location.reload()`).catch(() => {});
  await sleep(2500);
  await until(ready, 180000, `Morse in ${name}, after the reload`);
  await sleep(1500);
  if (s.closed) await connect();
  void target;
  return {
    port, get s() { return s; }, P, app, morse, out,
    stop: async () => { kill(); await sleep(800); },
  };
  } catch (e) { kill(); throw e; }
}
async function morseHome(dir, { barPosition = "bottom" } = {}) {
  await fs.rm(dir, { recursive: true, force: true }); // a fresh Morse every take
  await fs.mkdir(path.join(dir, "mods"), { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ models: { "claude-code": MODEL } }));
  await fs.writeFile(path.join(dir, "onboarding.json"), JSON.stringify(SEASONED));
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ barPosition }));
  return dir;
}

// A small, real-looking project for VS Code.
const PROJECT = {
  "README.md": "# weather-station\n\nReads the sensors every minute and posts a summary to the team channel.\n",
  "src/station.ts": `import { readSensors, type Reading } from "./sensors";
import { post } from "./chat";

// Every minute: read the sensors, post a short summary.
const EVERY_MINUTE = 60_000;

export async function tick(): Promise<void> {
  const r: Reading = await readSensors();
  const temp = r.temperature.toFixed(1);
  const wind = Math.round(r.wind);
  const rain = r.rain > 0.2 ? "rain likely" : "dry";
  await post(\`Now \${temp}°C, wind \${wind} km/h, \${rain}\`);
}

export function start() {
  console.log("weather-station: posting every minute");
  return setInterval(() => tick().catch(console.error), EVERY_MINUTE);
}

if (process.env.NODE_ENV !== "test") start();
`,
  "src/sensors.ts": "export interface Reading { temperature: number; wind: number; rain: number }\n\nexport async function readSensors(): Promise<Reading> {\n  return { temperature: 18.4, wind: 12.6, rain: 0.1 };\n}\n",
  "src/chat.ts": "export async function post(text: string) {\n  await fetch(process.env.CHAT_URL!, { method: \"POST\", body: text });\n}\n",
  "package.json": '{\n  "name": "weather-station",\n  "version": "1.2.0",\n  "type": "module"\n}\n',
};
const VSCODE_SETTINGS = {
  "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "update.mode": "none", "telemetry.telemetryLevel": "off",
  "workbench.tips.enabled": false, "editor.fontSize": 15, "chat.commandCenter.enabled": false, "workbench.enableExperiments": false,
  "editor.minimap.enabled": false, "window.commandCenter": false, "chat.disableAIFeatures": true, "workbench.secondarySideBar.defaultVisibility": "hidden",
  "extensions.ignoreRecommendations": true, "workbench.welcomePage.walkthroughs.openOnInstall": false, "git.openRepositoryInParentFolders": "never",
  "typescript.disableAutomaticTypeAcquisition": true, "workbench.layoutControl.enabled": false,
};
async function startCode(dir, morse, { file = "src/station.ts" } = {}) {
  const proj = path.join(dir, "weather-station");
  for (const [p, text] of Object.entries(PROJECT)) { await fs.mkdir(path.dirname(path.join(proj, p)), { recursive: true }); await fs.writeFile(path.join(proj, p), text); }
  await fs.mkdir(path.join(dir, "profile", "User"), { recursive: true });
  await fs.writeFile(path.join(dir, "profile", "User", "settings.json"), JSON.stringify(VSCODE_SETTINGS, null, 1));
  const a = await startApp({ name: "VS Code", bin: CODE, home: dir, morseHome: morse, window: /workbench\.html/,
    args: [`--user-data-dir=${path.join(dir, "profile")}`, `--extensions-dir=${path.join(dir, "ext")}`, "--disable-workspace-trust", proj, path.join(proj, file)] });
  await until(() => a.P.ev(`!!document.querySelector(".part.sidebar .monaco-list-row") && !!document.querySelector(".monaco-editor .view-lines .view-line")`), 120000, "VS Code's editor").catch(async e => { await a.stop(); throw e; });
  await sleep(4000); // notifications settle
  await a.P.ev(`document.querySelectorAll(".notifications-toasts .codicon-notifications-clear, .notification-toast .codicon-close").forEach(b => b.click())`).catch(() => {});
  return a;
}

const NOTE = `Notes from Cal Newport's book, and what I want to try this month.

## The idea

Deep work is focused, uninterrupted time on a hard problem. It is rare, and it is valuable. Shallow work (email, chat, meetings) feels productive but rarely moves anything forward.

## Rules I'm trying

- **Work in blocks.** Two 90-minute blocks every morning, phone in another room.
- **Embrace boredom.** Don't reach for the phone in every queue.
- **Quit social media for 30 days** and see what I miss.
- **Drain the shallows.** Batch email at 11:30 and 16:30.

## Why it matters

The ability to concentrate is becoming rare at exactly the moment it is becoming more valuable. People who cultivate it will thrive.

> "Clarity about what matters provides clarity about what does not."

## This week

1. Block 8:30 to 10:00 on the calendar.
2. Write the draft of chapter two before opening Slack.
3. Track hours of deep work on a tally sheet.
`;
async function obsidianBin(WORK) {
  const dir = path.join(WORK, "obsidian-app");
  const bin = path.join(dir, "squashfs-root", "obsidian");
  if (!existsSync(bin)) {
    await fs.mkdir(dir, { recursive: true });
    execFileSync(OBSIDIAN, ["--appimage-extract"], { cwd: dir, stdio: "ignore" }); // no FUSE here; unpack once
    execFileSync("chmod", ["-R", "a+rX", dir]);
  }
  return bin;
}
async function startObsidian(WORK, dir, morse) {
  const vault = path.join(dir, "Notes");
  await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await fs.writeFile(path.join(vault, "Deep Work.md"), NOTE);
  await fs.writeFile(path.join(vault, "Reading list.md"), "- Deep Work\n- Four Thousand Weeks\n- The Shallows\n");
  await fs.writeFile(path.join(vault, "Ideas.md"), "Things to try.\n");
  await fs.writeFile(path.join(vault, ".obsidian", "workspace.json"), JSON.stringify({
    main: { id: "m", type: "split", children: [{ id: "t", type: "tabs", children: [{ id: "l", type: "leaf", state: { type: "markdown", state: { file: "Deep Work.md", mode: "preview" } } }] }], direction: "vertical" },
    active: "l", lastOpenFiles: ["Deep Work.md"],
  }));
  await fs.mkdir(path.join(dir, ".config", "obsidian"), { recursive: true });
  await fs.writeFile(path.join(dir, ".config", "obsidian", "obsidian.json"), JSON.stringify({ vaults: { "5f1d0c2b9a7e4c11": { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }));
  const a = await startApp({ name: "Obsidian", bin: await obsidianBin(WORK), home: dir, morseHome: morse, window: /obsidian\.md\/index\.html/ });
  await until(() => a.P.ev(`[...document.querySelectorAll(".workspace-leaf-content h2, .workspace-leaf-content .cm-header-2")].some(e => /The idea/.test(e.textContent))`), 150000, "the note").catch(async e => { await a.stop(); throw e; });
  await sleep(2500);
  return a;
}

// ---------------------------------------------------------------- scenes
const results = {};
const ASK = {
  vscode: process.env.VSCODE_ASK || "make VS Code look like Synthwave '84: deep purple editor, side bar, tabs, title bar and status bar, hot pink keywords, cyan strings, yellow functions",
  obsidian: "add a focus panel on the right with this note's reading time and a 25 minute pomodoro timer",
  nodejs: "turn this into a calm dark reading mode: hide both sidebars and the light gradient, one centered column, serif text",
  docker: "add a button next to the filter that does these steps",
  style: "Caladea font, bigger text and dark pages everywhere",
};

// A color, as [r, g, b].
const rgb = c => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const far = (a, b) => Math.hypot(...a.map((v, i) => v - b[i])) > 14;

async function sceneVscode(WORK) {
  const dir = path.join(WORK, "apps", "vscode"), morse = await morseHome(path.join(WORK, "morse-vscode"));
  await fs.rm(dir, { recursive: true, force: true });
  const a = await startCode(dir, morse);
  const io = cdpInput(a.s), me = human(io, [W * 0.62, H * 0.42]);
  const colors = () => a.P.ev(`(() => { const e = document.querySelector(".monaco-editor .monaco-editor-background") || document.querySelector(".monaco-editor"); const sb = document.querySelector(".part.sidebar"); const tok = document.querySelector(".monaco-editor .view-line span span"); return [getComputedStyle(e).backgroundColor, getComputedStyle(sb).backgroundColor, tok ? getComputedStyle(tok).color : ""]; })()`);
  const before = await colors();
  try {
    return await recordCast(a.s, path.join(WORK, "vscode"), async rec => {
      rec.rect("editor", await a.P.rect(`document.querySelector(".part.editor")`));
      rec.rect("sidebar", await a.P.rect(`document.querySelector(".part.sidebar")`));
      await me.move(W * 0.55, H * 0.38, 500);
      const r = await ask(a.P, me, rec, ASK.vscode, 1);
      const after = await colors();
      if (r.phase !== "result" || !far(rgb(before[0]), rgb(after[0])) || !far(rgb(before[1]), rgb(after[1])) || !far(rgb(before[2]), rgb(after[2]))) return { ok: false, r, before, after, miss: "the editor, side bar or code colors look the same" };
      await sleep(1600);
      await save(a.P, me, rec, 1);
      await sleep(900);
      // Open another file from the side bar: the new look is everywhere.
      const row = await a.P.rect(`[...document.querySelectorAll(".part.sidebar .monaco-list-row")].find(r => /sensors/.test(r.textContent))`);
      if (row) { await me.click(row.x + 60, row.y + row.height / 2); rec.mark("opened"); }
      await sleep(1600);
      await me.move(W * 0.66, H * 0.5, 560);
      await sleep(900);
      return { ok: true, r, before, after };
    });
  } finally { await a.stop(); }
}

let obsidianState = null; // the style scene goes on in the same Obsidian
async function sceneObsidian(WORK, { keep = false } = {}) {
  const dir = path.join(WORK, "apps", "obsidian"), morse = await morseHome(path.join(WORK, "morse-notes"));
  await fs.rm(dir, { recursive: true, force: true });
  const a = await startObsidian(WORK, dir, morse);
  const io = cdpInput(a.s), me = human(io, [W * 0.6, H * 0.4]);
  const timerJs = `[...document.querySelectorAll("body *")].find(e => e.getRootNode() === document && !e.closest("[data-morse-ui]") && /^\\s*25:00\\s*$/.test(e.textContent) && e.getClientRects().length)`;
  let ok = false;
  try {
    const res = await recordCast(a.s, path.join(WORK, "obsidian"), async rec => {
      rec.rect("note", await a.P.rect(`document.querySelector(".markdown-reading-view")`));
      await me.move(W * 0.5, H * 0.36, 500);
      const r = await ask(a.P, me, rec, ASK.obsidian, 1);
      const timer = r.phase === "result" && await a.P.rect(timerJs);
      if (!timer) return { ok: false, r, miss: "no 25:00 on screen" };
      const panel = await a.P.rect(`(${timerJs}).closest("[data-morse]") || (${timerJs}).parentElement.parentElement`);
      rec.rect("panel", panel);
      const readingTime = await a.P.ev(`/\\d+\\s*min/i.test(document.querySelector("[data-morse]")?.closest("body")?.innerText || "")`);
      await sleep(1500);
      await save(a.P, me, rec, 1);
      await sleep(700);
      const startJs = `[...document.querySelectorAll("button, [role=button]")].find(e => e.getRootNode() === document && !e.closest("[data-morse-ui]") && /start/i.test(e.textContent + (e.getAttribute("aria-label") || "")) && e.getClientRects().length)`;
      const start = await a.P.rect(startJs);
      if (!start) return { ok: false, r, miss: "no start button" };
      await me.click(start.x + start.width / 2, start.y + start.height / 2);
      rec.mark("start1");
      await sleep(2600);
      const ticking = !(await a.P.rect(timerJs));
      rec.mark("ticking");
      rec.rect("panel2", await a.P.rect(`(${startJs})?.closest("[data-morse]")`) || panel);
      await me.move(W * 0.5, H * 0.55, 560);
      await sleep(700);
      ok = ticking;
      return { ok: ticking, r, readingTime, ticking };
    });
    if (ok && keep) { obsidianState = { a, me, dir, morse }; return res; }
    return res;
  } finally { if (!(ok && keep)) await a.stop(); }
}

// Logseq (its AppImage, from its GitHub releases): it opens on today's
// journal in its demo graph; a few lines are typed into it before recording.
const LOGSEQ = process.env.LOGSEQ || path.join(os.homedir(), "morse-real-apps", "logseq", "Logseq-linux-x64-0.10.9.AppImage");
async function startLogseq(WORK, dir, morse) {
  const appDir = path.join(WORK, "logseq-app"), bin = path.join(appDir, "squashfs-root", "Logseq");
  if (!existsSync(bin)) {
    await fs.mkdir(appDir, { recursive: true });
    execFileSync(LOGSEQ, ["--appimage-extract"], { cwd: appDir, stdio: "ignore" });
    execFileSync("chmod", ["-R", "a+rX", appDir]);
  }
  const a = await startApp({ name: "Logseq", bin, home: dir, morseHome: morse, window: /electron\.html/ });
  try {
    await until(() => a.P.ev(`!!document.querySelector(".journal .ls-block, .ls-page-blocks .ls-block, .page-blocks-inner")`), 120000, "Logseq's journal");
    await sleep(1500);
    const io = cdpInput(a.s);
    const blk = await a.P.rect(`document.querySelector(".journal .ls-block .block-content, .ls-block .block-content-wrapper, .ls-block")`);
    if (blk) { await io.move(blk.x + 40, blk.y + blk.height / 2); await io.down(); await io.up(); }
    await sleep(800);
    for (const [i, line] of ["Plan the launch video", "Book flights to Lisbon", "Read 20 pages of Deep Work"].entries()) {
      if (i) { await io.key("Enter"); await sleep(500); }
      await a.s.send("Input.insertText", { text: line });
      await sleep(400);
    }
    await io.key("Escape");
    await sleep(800);
    await io.move(W * 0.8, H * 0.8);
    await sleep(1000);
  } catch (e) { await a.stop(); throw e; }
  return a;
}

async function sceneStyle(WORK) {
  if (!obsidianState) throw new Error("the style scene needs the Obsidian scene first");
  const { a, me, morse } = obsidianState;
  const fontOf = P => P.ev(`getComputedStyle(document.querySelector(".markdown-preview-view p, .ls-block .block-content, body")).fontFamily`);
  let lq = null;
  const ldir = path.join(WORK, "apps", "logseq");
  try {
    // Logseq's first start sets itself up (an empty journal); the start
    // after the style is saved is the one in the video.
    await fs.rm(ldir, { recursive: true, force: true });
    lq = await startLogseq(WORK, ldir, morse);
    const zero = { ok: true, font: await fontOf(lq.P) };
    await lq.stop(); lq = null;
    const one = await recordCast(a.s, path.join(WORK, "style1"), async rec => {
      await me.move(W * 0.45, H * 0.3, 500);
      for (let i = 0; i < 4 && !(await a.P.st())?.open; i++) { await me.key(OPEN); await until(async () => (await a.P.st())?.open, 3000).catch(() => {}); }
      await sleep(400);
      rec.mark("ask1");
      await me.type(ASK.style);
      await sleep(350);
      rec.mark("enter1");
      await me.key("Enter");
      await until(async () => /Caladea/.test(await fontOf(a.P)), 15000, "the style in Obsidian");
      rec.mark("result1");
      await sleep(1500);
      await save(a.P, me, rec, 1);
      await sleep(4000); // a busy machine can paint the new look seconds late
      return { ok: true, font: await fontOf(a.P) };
    });
    if (!one.ok) return one;
    // Logseq, opened again afterwards, with the same Morse: it has the style already.
    lq = await startLogseq(WORK, ldir, morse);
    const io = cdpInput(lq.s), me2 = human(io, [W * 0.62, H * 0.6]);
    const two = await recordCast(lq.s, path.join(WORK, "style2"), async rec => {
      await sleep(500);
      await me2.move(W * 0.45, H * 0.45, 520);
      await sleep(1600);
      const font = await fontOf(lq.P);
      const bg = await lq.P.ev(`getComputedStyle(document.body).backgroundColor + " " + getComputedStyle(document.documentElement).filter`);
      return { ok: /Caladea/.test(font), font, bg };
    });
    return { ok: zero.ok && one.ok && two.ok, zero, one, two };
  } finally { await lq?.stop(); await a.stop(); obsidianState = null; }
}

// ---------------------------------------------------------------- the browser
async function browser(WORK) {
  const helper = await startHelper(path.join(WORK, "helper-home"));
  const profile = path.join(WORK, "chromium");
  await fs.rm(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: { width: W, height: H }, deviceScaleFactor: S, env: { ...process.env, DISPLAY },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--hide-scrollbars", "--window-size=1300,900", `--force-device-scale-factor=${S}`,
      ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])],
  });
  ctx.setDefaultTimeout(120000); // a busy machine
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const setup = await ctx.newPage();
  await setup.goto(`chrome://extensions/?id=${id}`, { timeout: 180000 });
  await setup.locator("#allow-user-scripts").click({ timeout: 120000 });
  await sleep(400);
  await seasonExtension(sw);
  // The bar stays at the top, so the cursor can reach its buttons (Settings → bar position).
  await sw.evaluate(() => Promise.all([chrome.storage.sync.set({ "morse.settings": { barPosition: "top" } }).catch(() => {}), chrome.storage.local.set({ "morse.settings": { barPosition: "top" } })]));
  await routeHelper(ctx, helper);
  await pairExtension(ctx, id, helper.code);
  for (const p of ctx.pages()) if (p !== setup && /options\.html|welcome\.html/.test(p.url())) await p.close();
  async function open(url, prep) {
    const page = await ctx.newPage();
    page.dialogs = 0;
    page.on("dialog", d => { page.dialogs++; d.dismiss().catch(() => {}); });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.bringToFront();
    await sleep(3500);
    if (prep) await prep(page);
    const s = await ctx.newCDPSession(page);
    const P = pageTools(() => s);
    await until(async () => (await P.st())?.ready, 30000, "Morse in the page");
    return { page, s, P };
  }
  // Mouse and keys: the page's own (Playwright), logged like the apps'.
  const ioFor = page => ({
    move: (x, y) => page.mouse.move(x, y), down: () => page.mouse.down(), up: () => page.mouse.up(),
    char: ch => page.keyboard.type(ch), key: name => page.keyboard.press(name),
    wheel: dy => page.mouse.wheel(0, dy),
  });
  return { ctx, sw, helper, open, ioFor, close: async () => { await ctx.close().catch(() => {}); helper.stop(); } };
}

async function sceneNodejs(B, WORK) {
  const url = "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs";
  const { page, s, P } = await B.open(url, async page => {
    await page.locator("button[aria-label*=close i], [class*=banner] button").first().click({ timeout: 3000 }).catch(() => {});
  });
  const io = B.ioFor(page), me = human(io, [W * 0.55, H * 0.5]);
  const look = () => page.evaluate(() => {
    const side = [...document.querySelectorAll("aside, nav[aria-label], [class*=sidebar i]")].filter(e => e.getClientRects().length && e.getBoundingClientRect().width > 120);
    const grads = [...document.querySelectorAll("main *, main")].filter(e => /gradient/.test(getComputedStyle(e).backgroundImage) && e.getBoundingClientRect().width * Math.min(innerHeight, e.getBoundingClientRect().height) > 100000).length;
    const top = document.querySelector("main h1")?.getBoundingClientRect().top ?? 0;
    return { grads, top, bg: getComputedStyle(document.body).backgroundColor, main: getComputedStyle(document.querySelector("main") || document.body).backgroundColor, sides: side.length, font: getComputedStyle(document.querySelector("main p") || document.body).fontFamily };
  });
  const before = await look();
  try {
    return await recordCast(s, path.join(WORK, "nodejs"), async rec => {
      rec.rect("article", await P.rect(`document.querySelector("main article, main")`));
      await me.move(W * 0.5, H * 0.45, 500);
      const r = await ask(P, me, rec, ASK.nodejs, 1);
      const after = await look();
      const dark = c => { const [r0, g, b] = rgb(c); return r0 + g + b < 200; };
      if (r.phase !== "result" || !(dark(after.bg) || dark(after.main)) || page.dialogs || after.grads || after.top > 320) return { ok: false, r, before, after, miss: "not dark, a gradient left, or the title pushed down" };
      await sleep(1400);
      await save(P, me, rec, 1);
      await sleep(900);
      rec.rect("column", await P.rect(`document.querySelector("main article") || document.querySelector("main")`));
      await me.move(W * 0.62, H * 0.6, 520);
      rec.mark("scroll");
      for (let i = 0; i < 14; i++) { await io.wheel(38); await sleep(45); }
      await sleep(1400);
      return { ok: true, r, before, after };
    });
  } finally { await page.close().catch(() => {}); }
}

async function sceneDocker(B, WORK) {
  const url = "https://hub.docker.com/_/nginx/tags";
  const { page, s, P } = await B.open(url, async page => {
    await page.locator("#onetrust-accept-btn-handler, button:has-text('Accept All Cookies'), button:has-text('Accept all')").first().click({ timeout: 4000 }).catch(() => {});
  });
  const io = B.ioFor(page), me = human(io, [W * 0.6, H * 0.55]);
  const filter = page.locator("input[placeholder*='Filter' i]").first();
  const box = async l => { const b = await l.boundingBox(); return b && { x: b.x, y: b.y, width: b.width, height: b.height }; };
  try {
    const P2 = () => pageTools(() => s);
    const first = await recordCast(s, path.join(WORK, "docker"), async rec => {
      // Show me once: from the bar's chip.
      for (let i = 0; i < 4 && !(await P.st())?.open; i++) { await me.key(OPEN); await until(async () => (await P.st())?.open, 3000).catch(() => {}); }
      await sleep(500);
      const chip = await P.barRect(".so-sug");
      if (!chip) return { ok: false, miss: "no Show me once chip" };
      await me.click(chip.x + chip.width / 2, chip.y + chip.height / 2);
      rec.mark("watching");
      await sleep(700);
      const f = await box(filter);
      rec.rect("filter", f);
      await me.click(f.x + 60, f.y + f.height / 2);
      rec.mark("step1");
      await sleep(300);
      await me.type("alpine", { fast: false });
      rec.mark("typed");
      await sleep(1800); // the list filters
      rec.rect("list", await box(page.locator("[data-testid*=tag i], .MuiPaper-root").first()).catch(() => null));
      const stop = await P.barRect("[data-so=stop]");
      if (!stop) return { ok: false, miss: "no Stop" };
      // Only the end of this move reaches the page: on its way the pointer
      // would pass over page parts under the strip, and the strip steps aside.
      await me.move(stop.x + stop.width / 2, stop.y + stop.height / 2, undefined, { direct: true });
      await sleep(250);
      const again = await P.barRect("[data-so=stop]");
      if (!again || Math.abs(again.y - stop.y) > 4) return { ok: false, miss: "the strip moved" };
      await me.click();
      rec.mark("stopped");
      await sleep(900);
      const r = await ask(P, me, rec, ASK.docker, 1);
      const btn = await P.rect(`[...document.querySelectorAll("button, a, [role=button]")].find(e => (e.closest("[data-morse]") || e.hasAttribute("data-morse")) && !e.closest("[data-morse-ui]") && e.getClientRects().length)`);
      if (r.phase !== "result" || !btn) return { ok: false, r, miss: "no button" };
      rec.rect("button", btn);
      await sleep(1400);
      await save(P, me, rec, 1);
      await sleep(700);
      return { ok: true, r };
    });
    if (!first.ok) return first;
    // Another image's tags: the button is there too, and does the steps there.
    await page.goto("https://hub.docker.com/_/redis/tags", { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(4000);
    await until(async () => (await P2().st())?.ready, 30000, "Morse on the redis page");
    const btnJs = `[...document.querySelectorAll("button, a, [role=button]")].find(e => (e.closest("[data-morse]") || e.hasAttribute("data-morse")) && !e.closest("[data-morse-ui]") && e.getClientRects().length)`;
    await until(() => P2().rect(btnJs), 20000, "the new button on the redis page");
    const s2 = await B.ctx.newCDPSession(page);
    const Q = pageTools(() => s2);
    const second = await recordCast(s2, path.join(WORK, "docker2"), async rec => {
      rec.rect("filter", await box(filter));
      const b2 = await Q.rect(btnJs);
      rec.rect("button", b2);
      await sleep(500);
      await me.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
      await sleep(250);
      rec.mark("press");
      const before = page.url();
      await me.click();
      await sleep(1800); // the filter fills in; the mod says what it opens
      const value = await filter.inputValue({ timeout: 2000 }).catch(() => "");
      // It may open the tag it found: the page load is sped up, and says so.
      const t0 = now();
      const moved = await until(() => page.url() !== before, 6000, "a new page").then(() => true, () => false);
      if (moved) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await sleep(1200);
        if (now() - t0 > 1.2) rec.wait(t0 + 0.2, now() - 0.3, "Page loading");
      }
      rec.mark("loaded");
      await sleep(1600);
      const url = page.url();
      rec.mark("done");
      return { ok: (/alpine/i.test(value) || /alpine/i.test(url)) && !page.dialogs, value, url };
    });
    return { ok: first.ok && second.ok, first, second };
  } finally { await page.close().catch(() => {}); }
}

// ---------------------------------------------------------------- record
async function retry(name, fn) {
  for (let i = 1; i <= TRIES; i++) {
    let res;
    try { res = await fn(); } catch (e) { res = { ok: false, miss: e.message.split("\n")[0] }; console.log(e.stack); }
    results[name] = { attempt: i, ...res };
    log(name, JSON.stringify(res).slice(0, 600));
    if (res?.ok) return res;
    log(`${name}: attempt ${i} missed, recording again`);
  }
  throw new Error(`${name}: no usable take after ${TRIES} tries`);
}
async function recordAll(WORK) {
  const want = n => !ONLY || ONLY.includes(n);
  await startXvfb();
  const resultsFile = path.join(WORK, "results.json");
  Object.assign(results, JSON.parse(await fs.readFile(resultsFile, "utf8").catch(() => "{}")));
  const saveResults = () => fs.writeFile(resultsFile, JSON.stringify({ ...results, model: MODEL }, null, 1));
  try {
    if (want("vscode")) { await retry("vscode", () => sceneVscode(WORK)); await saveResults(); }
    if (want("obsidian") || want("style")) {
      await retry("obsidian", () => sceneObsidian(WORK, { keep: want("style") }));
      await saveResults();
      if (want("style")) { await retry("style", async () => { if (!obsidianState) await sceneObsidian(WORK, { keep: true }); return sceneStyle(WORK); }); await saveResults(); }
    }
    if (want("nodejs") || want("docker")) {
      const B = await browser(WORK);
      try {
        if (want("nodejs")) { await retry("nodejs", () => sceneNodejs(B, WORK)); await saveResults(); }
        if (want("docker")) { await retry("docker", () => sceneDocker(B, WORK)); await saveResults(); }
      } finally { await B.close(); }
    }
  } finally { killAll(); }
}

// ---------------------------------------------------------------- main
const WORK = path.resolve(process.env.REUSE || process.env.WORK || await fs.mkdtemp(path.join(os.tmpdir(), "morse-v3-")));
await fs.mkdir(path.join(WORK, "apps"), { recursive: true });
execFileSync("chmod", ["755", WORK]);
console.log(`work dir ${WORK} · model ${MODEL}`);
if (!process.env.REUSE) await recordAll(WORK);
if (!process.env.RECORD_ONLY) {
  const { buildSocial } = await import("./social-edit.js");
  await buildSocial({ WORK, OUT, MUSIC, MODEL_LABEL });
}
process.exit(0);
