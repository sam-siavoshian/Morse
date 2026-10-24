// Records the launch video, the social clips and their poster frames from real
// runs of the Chrome extension on the demo apps, and of `morse launch` on a
// real Electron app. Playwright plays the user (a drawn cursor that moves at
// human speed, typing with small random delays); each browser scene is a CDP
// screencast (Page.startScreencast) at 1.5x. The desktop scene is an X screen
// of its own: ffmpeg grabs it while `morse launch` is typed into a terminal
// (xdotool) and the app starts, then a screencast of the app's page under
// its real menu bar (see recordX). ffmpeg folds the waits, zooms in on the
// change, and joins the scenes with title cards rendered as PNGs.
//
//   npm run build
//   DISPLAY=:99 node demo/record-launch.js            → docs/launch/
//
// Two cuts (CUT=v2 is the default):
//   v2  morse-demo-v2.mp4: a sleep timer, Show me once, a mod fixed after a
//       site update, the same in a desktop app, the gallery. Clips:
//       show-once (and a GIF), self-heal, desktop-app.
//   v1  morse-demo.mp4: sleep timer, word count, Edit tools, Page tools,
//       share. Clips: sleep-timer (and a GIF), page-tools, direct-edit.
//   (The launch video v3, on real apps only, is demo/record-social.js.)
//   x   morse-social-16x9/4x5/9x16.mp4: the short cut for social media. A
//       real app (VSCodium, from its .deb) restyled and given a feature, then
//       Show me once, Fix it and the off switch; captions burned in, no title
//       cards. Needs the v2 showonce and heal recordings in the same WORK:
//         CUT=v2 ONLY=showonce,heal WORK=w node demo/record-launch.js
//         CUT=x ONLY=codium WORK=w node demo/record-launch.js
//
// The model is real: by default the Morse helper runs Claude Code with sonnet
// (MORSE_PROVIDER / MORSE_MODEL change it; MORSE_PROVIDER=demo replays
// core/demo.js). Waiting for the model is sped up in the video and labelled
// "sped up N×"; the bar still shows the real time it took. Other waits that
// are sped up (Morse checking a page, an app starting) are labelled the same
// way. If a generation fails or adds nothing visible, the scene is recorded
// again (up to TRIES).
//
// The demo apps get made-up addresses (tunes.example, postbox.example, …):
// Playwright serves demo/sites/ for them, so no ports are used. The gallery
// list is this checkout's site/mods/, served on a free port with the demo
// apps' usual addresses (127.0.0.1:8787-8789) changed to those.
//
// The Morse helper runs on MORSE_HELPER_PORT (default: a free port; the
// extension is copied into WORK and pointed at it, since a built extension
// talks to 7457). The desktop scene starts its own Xvfb on a free display
// (or DESKTOP_DISPLAY), builds the Tunes app (demo/electron-app) into WORK
// and types `morse launch` into a real xterm there.
//
// Env: OUT (default docs/launch), CUT (v2), TRIES (3), WORK (where raw frames
// are kept), ONLY=heal,desktop (record just these scenes into an existing
// WORK), REUSE=<WORK> (record nothing, rebuild the videos from saved frames),
// CRF. Needs Xvfb, xterm, xdotool, ffmpeg, Playwright (global), the Electron
// runtime (demo/electron-app/build.mjs says where it looks), and the Inter
// font for the cards.

import { spawn, execFileSync } from "node:child_process";
import { promises as fs, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { createRequire } from "node:module";
import { startHelper, pairExtension } from "./helper.js";
import { CDPSession, listTargets } from "../daemon/cdp.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.OUT || path.join("docs", "launch"));
const EXT = path.join(root, "dist", "extension");
// Each demo app has its own address, like real apps (mods are kept per address).
const SITE = { parley: "http://parley.example/", byte: "http://byte.example/", tunes: "http://tunes.example/", mail: "http://postbox.example/" };
const SITE_DIRS = { "parley.example": "parley", "byte.example": "byte", "tunes.example": "tunes", "postbox.example": "mail" };
const GALLERY_HOSTS = { "127.0.0.1:8787": "parley.example", "127.0.0.1:8788": "byte.example", "127.0.0.1:8789": "tunes.example" };
process.env.MORSE_PROVIDER ||= "claude-code";
if (process.env.MORSE_PROVIDER === "claude-code") process.env.MORSE_MODEL ||= "sonnet";
const MODEL_NAME = process.env.MORSE_PROVIDER === "claude-code" ? `Claude Code (${process.env.MORSE_MODEL})` : process.env.MORSE_PROVIDER; // named on the cards: the model that really wrote the changes
const TRIES = Number(process.env.TRIES || 3);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const OPEN_KEY = "Control+Shift+Space"; // Morse's default on Linux (core/hotkeys.js)
const W = 1280, H = 800, DPR = Number(process.env.DPR || 1.5), FPS = 30, CAP = 64; // video size; caption band under the clips
const DS = Number(process.env.DESKTOP_SCALE || 1); // the desktop scene's screen: 1280×800 at this scale (1: cheap enough for a busy machine)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const log = (...a) => console.log("  ·", ...a);
const mb = f => (statSync(f).size / 1e6).toFixed(2) + " MB";
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
async function until(fn, ms, what = String(fn)) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(80); }
  throw new Error(`timed out waiting for ${what}; last: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

// ---------------------------------------------------------------- the words
// One short plain line per card (docs/WRITING.md: no hype, no emoji).
const CARDS = {
  open: { big: "morse", line: "Change any app or website in your own words.", foot: `Recorded from real runs. ${MODEL_NAME} wrote the changes.` },
  tunes: { line: "Point at something. Say what you want." },
  parley: { line: "Ask for what an app is missing." },
  edit: { line: "Or change it by hand. No model needed." },
  tools: { line: "Page tools change the whole page in one click." },
  share: { line: "Every change is a mod you can share with a link." },
  end: { big: "morse", line: "Open source. Uses Claude Code, Codex or your own API key.", foot: "github.com/sam-siavoshian/RRAA" },
  // v2
  open2: { big: "morse", line: "Your apps, your way. Change any website or desktop app in your own words.", foot: `Recorded from real runs, with ${MODEL_NAME} as the model.` },
  showonce: { line: "Do a chore once. Morse turns it into a button." },
  heal: { line: "When a site changes and a mod stops working, Morse can fix it." },
  desktop: { line: "The same works in desktop apps." },
  gallery: { line: "Try mods other people made. Save the ones you like." },
};
const CUTS = {
  v1: {
    video: "morse-demo.mp4",
    poster: { file: "poster-demo.png", scene: "tunes", caption: "Morse: change any app in your own words" },
    order: [["card", "open", 2.4], ["card", "tunes", 1.3], ["scene", "tunes"], ["card", "parley", 1.3], ["scene", "parley"],
      ["card", "edit", 1.3], ["scene", "edit"], ["card", "tools", 1.3], ["scene", "tools"], ["card", "share", 1.3], ["scene", "share"], ["card", "end", 2.8]],
    clips: {
      "sleep-timer": { scene: "tunes", caption: "“add a sleep timer”, and the player has one." },
      "page-tools": { scene: "tools", caption: "Hide ads, then dark mode. Two clicks, no model." },
      "direct-edit": { scene: "edit", caption: "Rename a headline, move a pop-up. No model, just edit." },
    },
    gif: "sleep-timer",
  },
  v2: {
    video: "morse-demo-v2.mp4",
    poster: { file: "poster-demo-v2.png", scene: "showonce", mark: "result", after: 0.8, caption: "Morse: your apps, your way" },
    order: [["card", "open2", 2.4], ["card", "tunes", 1.3], ["scene", "tunes"], ["card", "showonce", 1.4], ["scene", "showonce"],
      ["card", "heal", 1.6], ["scene", "heal"], ["card", "desktop", 1.3], ["scene", "desktop"], ["card", "gallery", 1.4], ["scene", "gallery"], ["card", "end", 2.8]],
    clips: {
      "show-once": { scene: "showonce", caption: "Archive one email by hand. Morse makes a button that does it for every unread one." },
      "self-heal": { scene: "heal", caption: "The site changed and a mod stopped working. Fix it, and it works again." },
      "desktop-app": { scene: "desktop", caption: "The same in a desktop app: point, say what you want, save." },
    },
    gif: "show-once",
  },
};
// x: the social cut (25-40 s, no title cards, captions burned in, 16:9, 4:5
// and 9:16). Its first scene is a real app, VSCodium (VS Code without
// Microsoft's branding), installed from its .deb; the quick cuts reuse the v2
// recordings of Show me once and Fix it (record them into the same WORK with
// CUT=v2 ONLY=showonce,heal, or REUSE a v2 work dir and add ONLY=codium).
CUTS.x = {
  social: true,
  order: [["scene", "codium"], ["scene", "showonce"], ["scene", "heal"]],
  clips: {},
};
const SOCIAL = [
  // The hook: the change lands in the first two seconds. The model wait is
  // folded from right after Enter, still labelled.
  { scene: "codium", from: m => m.marks.enter1 - 0.5, to: m => m.marks.saved1 + 0.5, wait: 0.9,
    adjust: m => { m.speeds = m.speeds.map(w => (w.from > m.marks.enter1 && w.from < m.marks.result1 ? { ...w, from: m.marks.enter1 + 0.3 } : w)); },
    caption: "I asked VS Code to look like a retro terminal.", note: `VSCodium (VS Code) · ${MODEL_NAME} · recorded live` },
  { scene: "codium", from: m => m.marks.enter2 - 1.6, to: m => m.marks.timer + 0.3, cx: 1, caption: "Then for a feature it doesn't have." },
  // Zoomed on the bar while it lists the steps and the request is typed.
  { scene: "showonce", from: m => clicks(m)[3] - 0.4, to: m => m.marks.clipEnd ?? m.marks.end, cx: 0.45,
    adjust: m => {
      const stop = clicks(m)[3], enter = (m.cursor.find(e => e.key === "Enter" && e.t > stop) || {}).t ?? stop + 3;
      m.zooms = [...m.zooms, { from: stop + 0.4, to: enter + 0.4, rect: { x: 290, y: 0, w: 700, h: 300 }, max: 1.8 }];
    },
    caption: "Do a chore once. Morse makes it a button." },
  { scene: "heal", from: m => m.zooms[0].from - 0.2, to: m => m.marks.result + 1.4, cx: 0.6, caption: "A site update broke a mod? Fix it." },
  { scene: "codium", from: m => m.marks.off - 0.4, to: m => m.marks.end, cx: 0, caption: "One key turns every change off. And back on." },
];
const SOCIAL_END = { line: "Morse: change any app in your own words", sub: "Open source · github.com/sam-siavoshian/RRAA", secs: 2.6 };
// Each format: the canvas, where the picture goes, where the caption goes.
const FORMATS = {
  "16x9": { w: 1920, h: 1080, pic: { x: 192, y: 0, w: 1536, h: 960 }, cap: { y: 966, h: 114, size: 40, note: 20 }, mark: null },
  "4x5": { w: 1080, h: 1350, crop: 4 / 3, pic: { x: 0, y: 176, w: 1080, h: 810 }, cap: { y: 1004, h: 300, size: 54, note: 26 }, mark: { y: 60 } },
  "9x16": { w: 1080, h: 1920, crop: 4 / 3, pic: { x: 0, y: 500, w: 1080, h: 810 }, cap: { y: 1360, h: 360, size: 58, note: 28 }, mark: { y: 300 } },
};
const CUT = CUTS[process.env.CUT || "v2"];
if (!CUT) throw new Error(`CUT must be one of ${Object.keys(CUTS).join(", ")}`);
const NEEDED = [...new Set([...CUT.order.filter(o => o[0] === "scene").map(o => o[1]), ...Object.values(CUT.clips).map(c => c.scene)])];
const OWN_RECORDERS = ["desktop", "codium"]; // scenes with their own X screen, not the browser
const WAIT = 1.8, CLIP_WAIT = 1.2; // seconds a model wait is folded into (in the video, in the clips)
const MODEL_WAIT = "Waiting for the model";

// ---------------------------------------------------------------- the cursor
// Screen recordings don't include the pointer, so the video draws one. Its
// path (every move, press and release, as the script makes them) is logged
// here and drawn over the frames in post at 30 fps (cursorTrack,
// encodeScene): on a busy machine the page itself may only paint a few
// frames a second, and a cursor drawn into the page would move as jerkily.
// The same log has the person's keys and page loads, for cutting dead air (timeline).
const CURSOR_LOG = [];
const noteKey = key => CURSOR_LOG.push({ t: Date.now() / 1000, key });
// A page whose key presses are logged too.
function logKeys(page) {
  const press = page.keyboard.press.bind(page.keyboard), goto = page.goto.bind(page);
  page.keyboard.press = (k, o) => { noteKey(k); return press(k, o); };
  page.goto = (u, o) => { CURSOR_LOG.push({ t: Date.now() / 1000, nav: true }); return goto(u, o); };
  return page;
}

// In every page: notes when Morse hides its own UI to take the before/after
// shots for the share card (those frames are left out of the video).
const HIDDEN_TRACKER = () => {
  if (window.top !== window || window.__demoTracker) return;
  window.__demoTracker = true;
  window.__demoHidden = [];
  let hiddenAt = 0;
  const loop = () => {
    const host = document.querySelector("[data-morse-ui][data-status]");
    const hide = !!host && host.style.visibility === "hidden";
    if (hide && !hiddenAt) hiddenAt = Date.now();
    if (!hide && hiddenAt) { window.__demoHidden.push([hiddenAt, Date.now()]); hiddenAt = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

// A person, not a script: eased, slightly curved moves; uneven typing.
// `io` moves the pointer, presses the button and types one character: the
// page's own mouse and keyboard (Playwright), or another (xdotool, CDP).
// Positions are logged in the video's 1280×800 space (screen pixels / scale);
// `hidden` keeps the cursor out of the picture until the first move.
function human(io, { at = [W / 2, H / 2], scale = 1, hidden = false } = {}) {
  if (io.mouse) {
    const page = io;
    io = { move: (x, y) => page.mouse.move(x, y), down: () => page.mouse.down(), up: () => page.mouse.up(), char: ch => page.keyboard.type(ch) };
  }
  let [cx, cy] = at;
  const note = e => CURSOR_LOG.push({ t: Date.now() / 1000, ...e });
  note(hidden ? { hide: true } : { x: cx / scale, y: cy / scale });
  const me = {
    at: () => [cx, cy],
    async move(x, y, ms) {
      const dist = Math.hypot(x - cx, y - cy);
      ms ??= Math.min(800, Math.max(220, 200 + dist * 0.5));
      const x0 = cx, y0 = cy, bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(60, dist * 0.12);
      const nx = dist ? -(y - y0) / dist : 0, ny = dist ? (x - x0) / dist : 0;
      const kx = (x0 + x) / 2 + nx * bend, ky = (y0 + y) / 2 + ny * bend;
      const t0 = Date.now();
      for (;;) {
        const u = Math.min(1, (Date.now() - t0) / ms);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const px = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * kx + e * e * x, py = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * ky + e * e * y;
        note({ x: px / scale, y: py / scale });
        await io.move(px, py);
        cx = px; cy = py;
        if (u >= 1) break;
        await sleep(14);
      }
    },
    async down() { note({ down: true }); await io.down(); },
    async up() { note({ down: false }); await io.up(); },
    async click(x, y) {
      if (x !== undefined) await me.move(x, y);
      await sleep(rand(80, 140));
      await me.down(); await sleep(rand(60, 100)); await me.up();
      await sleep(rand(110, 180));
    },
    async box(locator) {
      const l = locator.first();
      await l.waitFor({ state: "visible", timeout: 10000 });
      return l.boundingBox();
    },
    async clickOn(locator, fx = 0.5, fy = 0.5) {
      const b = await me.box(locator);
      await me.click(b.x + b.width * fx + rand(-2, 2), b.y + b.height * fy + rand(-2, 2));
      return b;
    },
    async type(text, { fast = false } = {}) {
      for (const ch of text) {
        noteKey(ch);
        await io.char(ch);
        let ms = fast ? rand(22, 60) : rand(40, 105);
        if (ch === " " && Math.random() < 0.2) ms += rand(50, 140);
        if (/[,.?]/.test(ch)) ms += rand(80, 160);
        await sleep(ms);
      }
    },
  };
  return me;
}

// The cursor's log for a scene: from the last position before `i0`, on the frame clock.
function cursorSince(i0, off) {
  const last = CURSOR_LOG.slice(0, i0).reverse().find(e => e.x !== undefined || e.hide);
  return [...(last ? [{ ...last, t: 0 }] : []), ...CURSOR_LOG.slice(i0).map(e => ({ ...e, t: e.t - off }))];
}

// ---------------------------------------------------------------- recording
// One screencast per scene. Frames go to disk as they arrive, with the
// compositor's timestamp; marks are wall-clock and converted to that clock
// with the measured offset.
function marker() {
  const marks = {}, speeds = [], zooms = [];
  const now = () => Date.now() / 1000;
  let zoomOpen = null;
  const rec = {
    now,
    mark: k => { marks[k] = now(); },
    // Play [from, to] faster, with a label saying so ("<label>, sped up N×").
    speed: (from, to, label = MODEL_WAIT) => speeds.push({ from, to, label }),
    // Zoom in on a rect (in the video's 1280×800 space) from now until unzoom() (or the end).
    async zoom(target, { max = 2, pad = 40 } = {}) {
      const r = typeof target.boundingBox === "function" ? await target.first().boundingBox() : target;
      if (zoomOpen) rec.unzoom();
      zoomOpen = { from: now(), rect: { x: r.x - pad, y: r.y - pad, w: r.width + 2 * pad, h: r.height + 2 * pad }, max };
    },
    unzoom() { if (zoomOpen) { zooms.push({ ...zoomOpen, to: now() }); zoomOpen = null; } },
  };
  const meta = (off = 0) => ({
    marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v - off])),
    speeds: speeds.map(s => ({ ...s, from: s.from - off, to: s.to - off })),
    zooms: zooms.map(z => ({ ...z, from: z.from - off, to: z.to - off })),
  });
  return { rec, meta };
}

async function recordScene(ctx, page, name, dir, body) {
  const out = path.join(dir, name);
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [], offsets = [];
  const writes = [];
  let n = 0;
  cdp.on("Page.screencastFrame", p => {
    const t = p.metadata.timestamp, file = `f${String(n++).padStart(5, "0")}.jpg`;
    offsets.push(Date.now() / 1000 - t);
    frames.push({ file, t, w: Date.now() / 1000 });
    writes.push(fs.writeFile(path.join(out, file), Buffer.from(p.data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await page.evaluate(() => { window.__demoHidden = []; });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: Math.round(W * DPR), maxHeight: Math.round(H * DPR), everyNthFrame: 1 });
  await sleep(400);
  const { rec, meta: marksMeta } = marker();
  rec.mark("start");
  const c0 = CURSOR_LOG.length;
  let result;
  try { result = await body(rec); }
  finally {
    rec.unzoom();
    rec.mark("end");
    await sleep(250);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(writes);
    await cdp.detach().catch(() => {});
  }
  const hidden = await page.evaluate(() => window.__demoHidden || []).catch(() => []);
  offsets.sort((a, b) => a - b);
  frames.sort((a, b) => a.t - b.t);
  const off = offsets[Math.floor(offsets.length / 2)] || 0; // median: wall clock minus frame clock
  const meta = {
    name, frames, offset: off, ...marksMeta(off),
    hidden: hidden.map(([a, b]) => [a / 1000 - off - 0.05, b / 1000 - off + 0.05]),
    cursor: cursorSince(c0, off),
    result,
  };
  await fs.writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 1));
  log(`${name}: ${frames.length} frames, ${(meta.marks.end - meta.marks.start).toFixed(1)}s raw, ${(frames.length / (meta.marks.end - meta.marks.start)).toFixed(0)} fps`);
  return meta;
}

const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null")).catch(() => null);
async function waitFor(page, pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await status(page); if (s && pred(s)) return s; await sleep(50); }
  throw new Error("timed out; last status " + JSON.stringify(await status(page)));
}
const ui = (page, sel) => page.locator(`[data-morse-ui] >> ${sel}`);
const union = rs => {
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
  return { x, y, width: Math.max(...rs.map(r => r.x + r.width)) - x, height: Math.max(...rs.map(r => r.y + r.height)) - y };
};

// After Send: wait for the model (sped up in the video when it takes a while).
async function modelWait(page, rec) {
  const t0 = rec.now();
  await waitFor(page, s => s.phase === "working", 5000);
  const s = await waitFor(page, s => s.phase === "result" || s.phase === "error", 240000);
  const t1 = rec.now();
  if (t1 - t0 > 3.5) rec.speed(t0 + 0.9, t1 - 0.4);
  rec.mark("result");
  return { phase: s.phase, hint: s.hint, secs: +(t1 - t0).toFixed(1) };
}

// Open the bar, point at `target`, describe, wait for the model (sped up).
async function ask(page, me, rec, target, request, { fx = 0.5, fy = 0.5 } = {}) {
  await page.keyboard.press(OPEN_KEY);
  await sleep(rand(300, 400));
  const b = await me.box(target);
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  await me.move(x - 70, y - 40);
  await sleep(rand(200, 320));
  await me.move(x, y, 400);
  await sleep(rand(380, 480)); // let the highlight read
  await me.click();
  const typing = await page.evaluate(() => /INPUT|TEXTAREA/.test(document.querySelector("[data-morse-ui]")?.shadowRoot?.activeElement?.tagName || ""));
  if (!typing) await page.keyboard.press("a"); // edit toolbar has focus: A is "ask"
  await sleep(rand(200, 320));
  await me.type(request);
  await sleep(rand(300, 400));
  await page.keyboard.press("Enter");
  return modelWait(page, rec);
}
const visibleAdded = page => page.evaluate(() => [...document.querySelectorAll("[data-morse]")].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map(e => ({ tag: e.tagName, text: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 60) })));
const blur = page => page.evaluate(() => document.querySelector("[data-morse-ui]")?.shadowRoot?.activeElement?.blur());

// ---------------------------------------------------------------- scenes
const SCENES = {
  // (a) Music app: point at the player, "add a sleep timer", use it.
  async tunes(ctx, page, me, rec) {
    const controls = page.locator('[data-testid="player-controls"]');
    const r = await ask(page, me, rec, controls, "add a sleep timer", { fy: 0.3 });
    if (r.phase !== "result") return { ok: false, ...r };
    const added = await visibleAdded(page);
    const named = await page.evaluate(() =>
      [...document.querySelectorAll("button, [role=button], select, [aria-label]")].some(e => !e.closest("[data-morse-ui]") && /sleep|timer/i.test(e.className + " " + e.id + " " + (e.getAttribute("aria-label") || "") + " " + (e.title || "") + " " + e.textContent)));
    if (!added.length && !named) return { ok: false, ...r, miss: "nothing visible was added" };
    await sleep(800);
    await me.clickOn(ui(page, ".actions [data-a=keep]"));
    const savedAt = Date.now();
    await sleep(300);
    // Use it: whatever was added (a button and maybe a menu, or a select).
    const bits = page.locator('[data-morse] button, button[data-morse], [data-morse][role=button], [data-morse] select, select[data-morse], button[class*="sleep" i], button[id*="sleep" i], button[aria-label*="sleep" i], button[title*="sleep" i]').filter({ visible: true });
    const used = [];
    const boxes = [await controls.boundingBox()];
    if (await bits.count()) boxes.push(await bits.first().boundingBox());
    // Zoom in on the player once the "Saved" toast (bottom left, 2.8 s) is
    // almost gone, so the zoom doesn't cut it in half.
    const zoomIn = async (extra = []) => {
      await sleep(Math.max(0, savedAt + 2100 - Date.now()));
      await rec.zoom(union([...boxes, ...extra]), { max: 2.2, pad: 50 });
    };
    if (await bits.count()) {
      const el = bits.first();
      const tag = await el.evaluate(e => e.tagName);
      if (tag === "SELECT") {
        // A native select's popup isn't part of the page picture, so pick with the keyboard.
        const b = await me.box(el);
        await me.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
        await zoomIn();
        await sleep(450);
        await el.focus();
        const n = await el.evaluate(e => e.options.length);
        await sleep(300);
        await page.keyboard.press("ArrowDown");
        used.push(await el.evaluate(e => e.options[e.selectedIndex]?.text));
        await sleep(n > 1 ? 2200 : 1000);
      } else {
        await me.clickOn(el);
        used.push(await el.evaluate(e => (e.innerText || e.getAttribute("aria-label") || e.title || e.tagName).trim().slice(0, 40)).catch(() => "?"));
        await sleep(300);
        // A menu of times? Pick 15 (or another short one).
        const opt = page.locator('[data-morse] button, [data-morse] [role=menuitem], [data-morse] li').filter({ visible: true }).filter({ hasText: /\b(15|10|5|30)\b/ });
        const menu = (await opt.count()) ? [await opt.first().boundingBox()].filter(Boolean) : [];
        await zoomIn(menu);
        await sleep(600);
        if (await opt.count()) {
          await me.clickOn(opt.first());
          used.push(await opt.first().innerText().catch(() => "?"));
        }
        await sleep(1700);
      }
    } else { await zoomIn(); await sleep(1500); }
    const [cx, cy] = me.at();
    await me.move(cx + 120, cy - 60, 500);
    await sleep(300);
    if (page.dialogs) return { ok: false, ...r, added, used, miss: "it asks with a browser dialog, which a screencast can't show" };
    return { ok: true, ...r, added, used };
  },

  // (b) Chat app: "show a word count under the message box", then type.
  async parley(ctx, page, me, rec) {
    const box = page.locator('textarea[aria-label="Message Parley"]');
    const r = await ask(page, me, rec, box, "show a word count under the message box", { fx: 0.4 });
    if (r.phase !== "result") return { ok: false, ...r };
    const added = await visibleAdded(page);
    const words = await page.evaluate(() => [...document.querySelectorAll("body *")].some(e => !e.closest("[data-morse-ui]") && e.children.length === 0 && /\bwords?\b/i.test(e.textContent) && e.getClientRects().length));
    if (!added.length && !words) return { ok: false, ...r, miss: "no word count on the page" };
    await sleep(900);
    await me.clickOn(ui(page, ".actions [data-a=keep]"));
    await sleep(300);
    const comp = await page.locator("form, [class*=composer], footer").filter({ has: box }).first().boundingBox().catch(() => null);
    await rec.zoom(comp && comp.width < 1000 ? comp : await box.boundingBox(), { max: 1.9, pad: 36 });
    await sleep(400);
    await me.clickOn(box, 0.3, 0.5);
    rec.mark("clipStart");
    await me.move(me.at()[0] + 90, me.at()[1] + 60, 450); // out of the way of the text
    await me.type("Can we move the launch to Thursday? One more pass on the captions.", { fast: true });
    await sleep(1200);
    const count = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(e => !e.closest("[data-morse-ui]") && e.children.length === 0 && /\d+\s*words?/i.test(e.textContent) && e.getClientRects().length).map(e => e.textContent.trim().slice(0, 60)));
    return { ok: count.length > 0 && !page.dialogs, ...r, added, count };
  },

  // (d) Direct edits on a news site: rename the headline, move the pop-up.
  async edit(ctx, page, me, rec) {
    await page.keyboard.press(OPEN_KEY);
    await sleep(350);
    const h1 = page.locator("article h1");
    const hb = await me.box(h1);
    await me.move(hb.x + hb.width * 0.32 - 50, hb.y + 40);
    await me.move(hb.x + hb.width * 0.32, hb.y + hb.height * 0.5, 380);
    await sleep(450);
    await me.click();
    await sleep(350);
    await page.keyboard.press("Control+e"); // focus the edit tools (the bar's input has it after pointing)
    await sleep(350);
    rec.mark("clipStart");
    await rec.zoom({ x: hb.x - 20, y: hb.y - 70, width: Math.max(hb.width, 820) + 40, height: hb.height + 150 }, { max: 1.7, pad: 30 });
    await page.keyboard.press("t");
    await sleep(450);
    await me.move(hb.x + hb.width * 0.8, hb.y + hb.height + 50, 500);
    await me.type("Every app you use is secretly a web page");
    await sleep(400);
    await page.keyboard.press("Enter");
    await sleep(700);
    rec.unzoom();
    const pop = page.locator(".pop");
    const pb = await me.box(pop);
    await me.move(pb.x + pb.width * 0.55, pb.y + 26);
    await sleep(300);
    await me.click();
    await sleep(300);
    await page.keyboard.press("Control+e");
    await sleep(150);
    await page.keyboard.press("m");
    await sleep(450);
    const [sx, sy] = me.at();
    await me.down();
    await sleep(150);
    await me.move(sx - 300, sy + 4, 650);
    await me.move(sx - 868, sy + 2, 850);
    await sleep(200);
    await me.up();
    await sleep(700);
    await page.keyboard.press("Escape");
    await sleep(250);
    await page.keyboard.press("Escape"); // closes the bar: the edits are saved as one mod
    await me.move(W * 0.62, H * 0.4, 550);
    await sleep(1000);
    const now = await page.evaluate(() => ({ h1: document.querySelector("article h1").textContent, pop: document.querySelector(".pop").getBoundingClientRect().x }));
    return { ok: /secretly a web page/.test(now.h1) && now.h1.startsWith("Every") && now.pop < 500, ...now };
  },

  // (c) Page tools on the same news site: hide ads, then dark mode.
  async tools(ctx, page, me, rec) {
    if (!(await ui(page, ".bar:not([hidden])").count())) await page.keyboard.press(OPEN_KEY);
    await sleep(500);
    const q = ui(page, ".gm-qbtn");
    // While pointing, the bar moves out of the cursor's way unless the cursor
    // comes in right next to the page tools button, so head straight for it.
    const openMenu = async () => {
      for (let i = 0; i < 3; i++) {
        const b = await me.box(q), bar = await ui(page, ".bar").first().boundingBox();
        const x = b.x + b.width / 2, y = b.y + b.height / 2, above = bar.y + bar.height / 2 > H / 2;
        await me.move(x, above ? bar.y - 70 : bar.y + bar.height + 70);
        await me.move(x, y, 380);
        await me.click();
        if (await ui(page, ".gm-menu:not([hidden])").count()) return;
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(400);
      }
      throw new Error("the page tools menu didn't open");
    };
    await openMenu();
    await sleep(450);
    rec.mark("clipStart");
    await me.clickOn(ui(page, ".gm-menu button[data-k=noads]"));
    await sleep(1400);
    await openMenu();
    await sleep(450);
    await me.clickOn(ui(page, ".gm-menu button[data-k=dark]"));
    await sleep(1000);
    await page.keyboard.press("Escape");
    await me.move(W * 0.55, H * 0.35, 700);
    await sleep(1400);
    const ads = await page.evaluate(() => [...document.querySelectorAll("[data-ad]")].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").length);
    return { ok: ads === 0, adsLeft: ads };
  },

  // (e) Back in the music app: share the sleep timer from the Mods panel.
  async share(ctx, page, me, rec) {
    await page.keyboard.press("Alt+Shift+KeyM");
    await sleep(800);
    const art = ui(page, ".panel article").filter({ hasText: /sleep|timer/i });
    const target = (await art.count()) ? art.first() : ui(page, ".panel article").first();
    await me.clickOn(target.locator("[data-a=share]"));
    await sleep(500);
    const card = await ui(page, "img.cardimg").count();
    const copy = ui(page, "[data-a=copy]");
    if (card) {
      await ui(page, "img.cardimg").first().waitFor({ state: "visible" });
      const boxes = [await ui(page, "img.cardimg").first().boundingBox()];
      if (await copy.count()) boxes.push(await copy.first().boundingBox());
      await rec.zoom(union(boxes), { max: 1.6, pad: 24 });
    }
    await sleep(1300);
    if (await copy.count()) { await me.clickOn(copy); await sleep(1300); }
    await me.move(me.at()[0] - 160, me.at()[1] - 90, 600);
    await sleep(500);
    return { ok: card > 0, card: card > 0 };
  },

  // (f) Mail: Show me once. Archive one email by hand, Stop, "Do it to every
  // unread email"; the model writes a button that does it; Save, press it.
  async showonce(ctx, page, me, rec) {
    const unread = () => page.evaluate(() => document.querySelectorAll('.r9[data-unread="true"]').length);
    const before = await unread();
    await page.keyboard.press(OPEN_KEY);
    await sleep(rand(450, 550));
    rec.mark("chip");
    await me.clickOn(ui(page, ".sugs .so-sug")); // the "Show me once" chip under the input
    await ui(page, ".so-strip").first().waitFor();
    await sleep(400);
    await me.clickOn(page.locator(".r9", { hasText: "Leo Martins" }), 0.35, 0.5);
    await sleep(500);
    await me.clickOn(page.locator(".rd .acts button", { hasText: "Archive" }));
    await sleep(800);
    await me.clickOn(ui(page, ".so-strip [data-so=stop]"));
    await sleep(600);
    await me.clickOn(ui(page, ".sugs .sug").filter({ hasText: "Do it to every" }));
    await sleep(rand(250, 350));
    await me.type("unread email");
    await sleep(rand(300, 400));
    await page.keyboard.press("Enter");
    const r = await modelWait(page, rec);
    if (r.phase !== "result") return { ok: false, ...r };
    rec.mark("made");
    // The button it made: something new on the page that says "archive".
    // (Playwright's locators see into Morse's own shadow root; leave that out,
    // and the open email's own Archive button.)
    const made = page.locator("button, [role=button], a").filter({ visible: true, hasText: /archive/i });
    const idx = await made.evaluateAll(els => els.map((e, i) => (e.getRootNode() === document && !e.closest(".rd .acts") ? i : -1)).filter(i => i >= 0));
    if (!idx.length) return { ok: false, ...r, miss: "no new button" };
    const button = made.nth(idx[0]);
    const label = (await button.innerText()).trim();
    if (/^archive$/i.test(label)) return { ok: false, ...r, miss: "only the email's own Archive button" };
    await sleep(700);
    await me.clickOn(ui(page, ".actions [data-a=keep]"));
    await sleep(500);
    const list = await page.locator(".lst").boundingBox();
    const bb = await button.boundingBox();
    await rec.zoom(union([bb, { x: list.x, y: bb.y, width: list.width, height: Math.min(360, list.y + list.height - bb.y) }]), { max: 1.6, pad: 30 });
    await sleep(500);
    await me.clickOn(button);
    await until(async () => (await unread()) === 0, 8000, "every unread email to be archived").catch(() => {});
    await sleep(1000);
    const left = await unread();
    await me.move(me.at()[0] + 140, me.at()[1] + 90, 500);
    rec.mark("clipEnd");
    await sleep(300);
    return { ok: left === 0 && before > 1 && !page.dialogs, ...r, button: label, unreadBefore: before, unreadAfter: left };
  },

  // (g) Tunes again: a mod from the gallery (bigger rounded covers) works
  // until the site is redesigned (?v2 renames the album grid). Morse notices,
  // Fix it asks the model for a version that fits the new page, Save.
  async heal(ctx, page, me, rec) {
    const artRadius = () => page.evaluate(() => { const a = document.querySelector('[data-testid$="-grid"] > div > div'); return a ? parseFloat(getComputedStyle(a).borderTopLeftRadius) : 0; });
    const before = await artRadius();
    await me.move(W * 0.6, H * 0.45, 600);
    await sleep(900);
    rec.mark("update");
    await page.goto(SITE.tunes + "?v2"); // the site's update
    await page.waitForFunction(() => document.querySelector("[data-morse-ui]")?.dataset.status, null, { timeout: 15000 });
    await page.mouse.move(...me.at());
    const broken = await artRadius();
    // Morse waits for the page to settle and checks twice before it says anything.
    const t0 = rec.now();
    await page.keyboard.press("Alt+Shift+KeyM");
    const row = ui(page, '.panel article[data-id="tunes-big-covers"]');
    const note = row.locator(".health");
    const noted = await until(() => note.count(), 60000, "the stopped-working note").catch(() => 0);
    if (!noted) return { ok: false, miss: "Morse didn't flag the mod (the page may never have gone quiet)" };
    const t1 = rec.now();
    if (t1 - t0 > 2.2) rec.speed(t0 + 0.6, t1 - 0.2, "Morse checks the page");
    await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector('.panel article[data-id="tunes-big-covers"] .health')?.scrollIntoView({ block: "center" }));
    await blur(page);
    await sleep(300);
    await rec.zoom(note, { max: 1.8, pad: 40 });
    await sleep(1500);
    await me.clickOn(note.locator("[data-a=fix]"));
    rec.unzoom();
    const r = await modelWait(page, rec);
    if (r.phase !== "result") return { ok: false, ...r, before, broken };
    const fixed = await artRadius();
    if (!(fixed > broken + 4)) return { ok: false, ...r, before, broken, fixed, miss: "the covers didn't change back" };
    await sleep(1100);
    await me.clickOn(ui(page, ".actions [data-a=keep]"));
    await ui(page, ".ctl-toast").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await me.move(me.at()[0] + 60, me.at()[1] + 160, 600);
    const toastBox = await ui(page, ".ctl-toast").first().boundingBox().catch(() => null);
    if (toastBox) await rec.zoom(toastBox, { max: 1.8, pad: 60 });
    await sleep(2000);
    const toast = await ui(page, ".ctl-toast").first().innerText().catch(() => "");
    return { ok: !page.dialogs, ...r, before, broken, fixed, toast: toast.replace(/\s+/g, " ").slice(0, 120) };
  },

  // (h) The Daily Byte: Mods for this site, Try it on someone's reading mode, Save.
  async gallery(ctx, page, me, rec) {
    await page.keyboard.press("Alt+Shift+KeyM");
    await sleep(700);
    if (!(await ui(page, ".panel .gl-site.open").count())) { await me.clickOn(ui(page, ".panel .gl-site .gl-head")); await sleep(500); }
    const item = ui(page, '.panel .gl-item[data-glid="byte-reading-mode"]');
    await item.first().waitFor();
    await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.querySelector('.panel .gl-item[data-glid="byte-reading-mode"]')?.scrollIntoView({ block: "center" }));
    await blur(page);
    await sleep(500);
    await me.move(...(b => [b.x + b.width * 0.4, b.y + b.height * 0.3])(await item.boundingBox()));
    await sleep(700);
    await me.clickOn(item.locator("[data-gl=try]"));
    await sleep(700);
    // The same review as Install…, then it runs without being saved.
    const go = ui(page, ".modal .card [data-a=install]");
    await go.first().waitFor();
    await sleep(900);
    await me.clickOn(go);
    await sleep(1800);
    // Save, in the "Trying “Reading mode”" bar at the top.
    await me.clickOn(ui(page, ".gl-trial [data-gl=keep]"));
    const saved = await until(async () => !(await ui(page, ".gl-trial [data-gl=keep]").isVisible().catch(() => false)), 5000, "the trial to be saved").then(() => true, () => false);
    await sleep(700);
    // Close the Mods panel: the whole page, in reading mode.
    await me.clickOn(ui(page, ".panel header [data-a=close]"));
    await me.move(W * 0.5, H * 0.45, 700);
    await sleep(1300);
    const ads = await page.evaluate(() => [...document.querySelectorAll("[data-ad]")].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").length);
    return { ok: ads === 0 && saved, adsLeft: ads, saved };
  },
};

// ---------------------------------------------------------------- the desktop scene
// A real X screen of its own: a terminal, `morse launch` typed into it, the
// Tunes app (a packaged Electron app) opening with Morse connected, then the
// hotkey, pointing and a request, all as real X input (xdotool). ffmpeg
// grabs the screen; the frames get the screen's own clock, like the marks.
async function recordDesktop(WORK) {
  const out = path.join(WORK, "desktop");
  const D = process.env.DESKTOP_DISPLAY || await startXvfb();
  const env = { ...process.env, DISPLAY: D };
  const x = (...args) => execFileSync("xdotool", args, { env, encoding: "utf8" }).trim();
  try { execFileSync("xsetroot", ["-solid", "#16161a"], { env }); } catch {}
  const apps = path.join(WORK, "apps");
  if (!existsSync(path.join(apps, "Tunes", "tunes"))) {
    const { buildTunes } = await import("./electron-app/build.mjs");
    await buildTunes(path.join(apps, "Tunes"));
  }
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    // A fresh home each time: Morse's settings and mods, and the app's profile.
    const home = path.join(WORK, `desktop-home-${attempt}`);
    await fs.rm(home, { recursive: true, force: true });
    const morseHome = path.join(home, ".morse");
    await fs.mkdir(path.join(morseHome, "mods"), { recursive: true });
    if (process.env.MORSE_MODEL) await fs.writeFile(path.join(morseHome, "config.json"), JSON.stringify({ models: { [process.env.MORSE_PROVIDER]: process.env.MORSE_MODEL } }));
    await fs.writeFile(path.join(morseHome, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
    // `morse` on the terminal's PATH: this checkout's CLI. The app gets
    // --no-sandbox (Chromium won't start as root without it), the screen's
    // scale (DESKTOP_SCALE), and --enable-automation (so the page shows Morse's state to
    // this script, as under Playwright: runtime/src/10-dom.js DEBUG);
    // everything else is what a person would get.
    const bin = path.join(home, "bin");
    await fs.mkdir(bin, { recursive: true });
    const logFile = path.join(home, "launch.log");
    await fs.writeFile(path.join(bin, "morse"), `#!/bin/sh\nnode ${JSON.stringify(path.join(root, "daemon/cli.js"))} "$@" -- --no-sandbox --force-device-scale-factor=${DS} --enable-automation 2>&1 | tee ${JSON.stringify(logFile)}\n`, { mode: 0o755 });
    await fs.writeFile(path.join(home, ".bashrc"), `PS1='\\[\\e[38;5;245m\\]~/Apps\\[\\e[0m\\] $ '\ncd ${JSON.stringify(apps)}\nclear\n`);
    const termEnv = { ...env, HOME: home, MORSE_HOME: morseHome, PATH: `${bin}:${process.env.PATH}`, FORCE_COLOR: "1", TERM: "xterm-256color", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
    const term = spawn("xterm", ["-u8", "-fa", "DejaVu Sans Mono", "-fs", String(Math.round(13 * DS)), "-geometry", "108x15+0+0", "-bg", "#0b0b0c", "-fg", "#d6d6da", "-cr", "#a0a0a8",
      "-xrm", `XTerm*internalBorder: ${Math.round(22 * DS)}`, "-xrm", "XTerm*scrollBar: false", "-xrm", "XTerm*cursorBlink: false", "-title", "Terminal", "-e", "bash", "-i"], { env: termEnv, stdio: ["ignore", "ignore", "pipe"] });
    term.err = "";
    term.stderr.on("data", d => { term.err += d; });
    const kids = [term];
    const cleanup = () => {
      for (const k of kids) try { k.kill("SIGKILL"); } catch {}
      // The app; `morse launch` stops by itself when it closes.
      try { execFileSync("pkill", ["-9", "-f", path.join(apps, "Tunes", "tunes")]); } catch {}
    };
    let result;
    try {
      await until(() => x("search", "--name", "^Terminal$"), 40000, "the terminal").catch(e => { throw new Error(`${e.message}; xterm: ${term.err.trim() || "no output"}`); });
      await sleep(1200);
      const termWin = x("search", "--name", "^Terminal$").split("\n")[0];
      // In the middle of the screen.
      const tg = Object.fromEntries(x("getwindowgeometry", "--shell", termWin).split("\n").map(l => l.split("=")).map(([k, v]) => [k, Number(v)]));
      x("windowmove", termWin, String(Math.max(0, Math.round((W * DS - tg.WIDTH) / 2))), String(Math.max(0, Math.round((H * DS - tg.HEIGHT) / 2))));
      await sleep(300);
      x("mousemove", String(W * DS / 2), String(H * DS / 2));
      try { x("windowfocus", "--sync", termWin); } catch {}
      result = await recordX(D, out, async (rec, me, io) => {
        await sleep(900);
        // Typed a word at a time: one xdotool per key is too slow on a busy machine.
        const words = "morse launch ./Tunes/tunes".split(" ");
        for (const [i, word] of words.entries()) {
          const keys = [...word + (i < words.length - 1 ? " " : "")].map(ch => KEYSYM[ch] || (/[A-Z]/.test(ch) ? `shift+${ch.toLowerCase()}` : ch));
          noteKey(word);
          x("key", "--clearmodifiers", "--delay", String(Math.round(rand(40, 70))), ...keys);
          await sleep(rand(60, 200));
        }
        await sleep(350);
        rec.mark("launch");
        noteKey("Return");
        x("key", "Return");
        const t0 = rec.now();
        await until(async () => /connected to tunes/i.test(await fs.readFile(logFile, "utf8").catch(() => "")), 60000, "morse launch to connect");
        const port = Number((await fs.readFile(logFile, "utf8")).match(/port\s+(\d+)/)[1]);
        // The main window, over CDP: to read state and positions, to draw
        // the cursor, and for the mouse and keys from here on (the same input
        // events Playwright sends in the browser scenes).
        // (Reconnects if the window's page is replaced while the app starts.)
        let s = null;
        const connect = async () => {
          const t = await until(async () => (await listTargets(port)).find(t => t.type === "page" && t.url.startsWith("app://tunes/")), 30000, "the Tunes window");
          s = await CDPSession.connect(t.webSocketDebuggerUrl);
        };
        await connect();
        const ev = async expr => {
          if (s.closed) await connect();
          return (await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
        };
        await until(() => ev(`!!document.querySelector("[data-morse-ui]")`), 40000, "Morse in the app");
        await ev(`localStorage.setItem("morse:debug", "1"), location.reload()`).catch(() => {}); // data-status, for waiting on the bar
        await sleep(600);
        await until(() => ev(`!!document.querySelector("[data-morse-ui][data-status]")`), 40000, "Morse after the reload");
        await sleep(500);
        if (s.closed) await connect();
        await s.send("Page.enable").catch(() => {});
        const st = async () => JSON.parse((await ev(`document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"`)) || "null");
        // The app's X window (it opens at 0,0, sized to the screen), and where
        // its page starts, under the app's own menu bar.
        const geoOf = id => Object.fromEntries(x("getwindowgeometry", "--shell", id).split("\n").map(l => l.split("=")).map(([k, v]) => [k, Number(v)]));
        const winId = await until(() => { try { return x("search", "--name", "^Tunes$").split("\n").find(id => geoOf(id).WIDTH > 600); } catch { return null; } }, 30000, "the Tunes X window").catch(() => null);
        const geo = winId ? geoOf(winId) : { X: 0, Y: 0, WIDTH: Math.round(W * DS), HEIGHT: Math.round(H * DS) };
        const inner = await ev("innerHeight"), scale = await ev("devicePixelRatio");
        const top = geo.Y + geo.HEIGHT - inner * scale; // below the app's own menu bar
        // Page CSS pixels → screen pixels, and → the video's 1280×800 space.
        const toScreen = (px, py) => [geo.X + px * scale, top + py * scale];
        const toVideo = r => ({ x: (geo.X + r.x * scale) / DS, y: (top + r.y * scale) / DS, width: r.width * scale / DS, height: r.height * scale / DS });
        const rectOf = sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
        const shadowRect = sel => ev(`(() => { const r = document.querySelector("[data-morse-ui]").shadowRoot.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
        if (winId) try { x("windowfocus", "--sync", winId); } catch {}
        io.use(cdpInput(s, (sx, sy) => [(sx - geo.X) / scale, (sy - top) / scale]));
        await io.screencast(s, top);
        await sleep(700);
        const t1 = rec.now();
        if (t1 - t0 > 2.5) rec.speed(t0 + 1.2, t1 - 0.3, "Opening the app");
        rec.mark("app");
        // The hotkey, then point at the album grid and ask.
        await me.move(...toScreen(900, 420), 500);
        await sleep(300);
        rec.mark("clipStart");
        for (let i = 0; i < 3 && !(await st().catch(() => null))?.open; i++) {
          await io.key({ key: " ", code: "Space", windowsVirtualKeyCode: 32, modifiers: 2 | 8 }); // Ctrl+Shift+Space
          await until(async () => (await st())?.open, 3000, "the bar to open").catch(() => {});
        }
        await until(async () => (await st())?.open, 2000, "the bar to open");
        await sleep(450);
        // The gap between the first two covers: that's the album grid itself.
        const c1 = await rectOf('[data-testid="album-grid"] > div:nth-child(1)'), c2 = await rectOf('[data-testid="album-grid"] > div:nth-child(2)');
        const gx = (c1.x + c1.width + c2.x) / 2, gy = c1.y + c1.height * 0.45;
        await me.move(...toScreen(gx - 80, gy + 60));
        await sleep(250);
        await me.move(...toScreen(gx, gy), 420);
        await sleep(500);
        await me.click();
        await sleep(400);
        await me.type("make the covers round", { fast: true });
        await sleep(350);
        await io.key(ENTER);
        const m0 = rec.now();
        await until(async () => (await st())?.phase === "working", 8000, "the model to start");
        const done = await until(async () => { const v = await st(); return ["result", "error"].includes(v?.phase) && v; }, 240000, "a result");
        const m1 = rec.now();
        if (m1 - m0 > 3.5) rec.speed(m0 + 0.9, m1 - 0.4);
        rec.mark("result");
        if (done.phase !== "result") return { ok: false, phase: done.phase, hint: done.hint, secs: +(m1 - m0).toFixed(1) };
        const radius = await ev(`(() => { const a = document.querySelector('[data-testid="album-grid"] > div > div'); return a ? getComputedStyle(a).borderTopLeftRadius : ""; })()`);
        const w = await ev(`document.querySelector('[data-testid="album-grid"] > div > div')?.getBoundingClientRect().width || 0`);
        const round = /%/.test(radius) ? parseFloat(radius) >= 40 : parseFloat(radius) >= w * 0.4;
        await sleep(900);
        await rec.zoom(toVideo(await rectOf('[data-testid="album-grid"]')), { max: 1.35, pad: 20 });
        await sleep(1300);
        rec.unzoom();
        const save = await shadowRect(".actions [data-a=keep]");
        if (save) await me.click(...toScreen(save.x + save.width / 2, save.y + save.height / 2));
        else await io.key(ENTER);
        await sleep(600);
        const modFile = await until(async () => (await fs.readdir(path.join(morseHome, "mods")).catch(() => [])).find(f => f.endsWith(".json")), 8000, "the mod to be saved").catch(() => null);
        await me.move(...toScreen(1000, 560), 600);
        await sleep(1500);
        s.close();
        return { ok: round && !!modFile, phase: done.phase, hint: done.hint, secs: +(m1 - m0).toFixed(1), radius, saved: modFile };
      }, { x, at: [W * DS / 2, H * DS / 2] });
    } catch (e) {
      result = { ok: false, miss: e.message.split("\n")[0] };
    } finally { cleanup(); }
    results.desktop = { attempt, ...result };
    log("desktop", JSON.stringify(result));
    if (result?.ok) break;
    log(`desktop: attempt ${attempt} missed, recording again`);
    await sleep(1500);
  }
  if (!process.env.DESKTOP_DISPLAY) xvfb?.kill();
}

// ---------------------------------------------------------------- a real app: VSCodium
// VSCodium as installed from its .deb (/usr/share/codium), opened with a real
// `morse launch codium` on an X screen of its own, a small project open in
// it. VS Code draws its own title bar, so the page's screencast is the whole
// window. Mouse and keys go to the page over CDP, as in the desktop scene.
// Three things, each checked: a restyle ("a retro green terminal"), a new
// feature (a focus timer, saved, then started), and the off switch (⌥⇧0 turns
// every change off; again, and they're back).
const APP_SCALE = Number(process.env.APP_SCALE || 1.5);
const CODIUM_ASK1 = "make it look like a retro green terminal: green glowing text on black";
const CODIUM_ASK2 = "add a floating 25 minute focus timer with a start button in the top right corner";
const PROJECT = {
  "README.md": "# Weather station\n\nReads the sensors every minute and posts a summary.\n",
  "src/station.js": 'import { readSensors } from "./sensors.js";\n\n// Every minute: read the sensors and post a summary.\nexport async function tick(post) {\n  const r = await readSensors();\n  const temp = r.temperature.toFixed(1);\n  const wind = Math.round(r.wind);\n  await post(`Now ${temp}°C, wind ${wind} km/h`);\n}\n\nsetInterval(() => tick(console.log), 60_000);\n',
  "src/sensors.js": "export async function readSensors() {\n  return { temperature: 18.4, wind: 12.6, humidity: 0.71 };\n}\n",
};
const CODIUM_SETTINGS = {
  "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "window.commandCenter": false,
  "workbench.tips.enabled": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "editor.fontSize": 15,
  "workbench.layoutControl.enabled": false, "chat.commandCenter.enabled": false, "workbench.enableExperiments": false,
  "editor.minimap.enabled": false,
};

// One screencast of a page reached over our own CDP session: recordScene for apps.
async function recordCdp(s, out, body) {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const frames = [], offsets = [], writes = [];
  let n = 0;
  const onFrame = p => {
    const file = `f${String(n++).padStart(5, "0")}.jpg`;
    offsets.push(Date.now() / 1000 - p.metadata.timestamp);
    frames.push({ file, t: p.metadata.timestamp });
    writes.push(fs.writeFile(path.join(out, file), Buffer.from(p.data, "base64")));
    s.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  };
  s.on("Page.screencastFrame", onFrame);
  await s.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: Math.round(W * DPR), maxHeight: Math.round(H * DPR), everyNthFrame: 1 });
  await sleep(400);
  const { rec, meta: marksMeta } = marker();
  rec.mark("start");
  const c0 = CURSOR_LOG.length;
  let result;
  try { result = await body(rec); }
  finally {
    rec.unzoom();
    rec.mark("end");
    await sleep(250);
    await s.send("Page.stopScreencast").catch(() => {});
    s.off("Page.screencastFrame", onFrame);
    await Promise.all(writes);
  }
  offsets.sort((a, b) => a - b);
  frames.sort((a, b) => a.t - b.t);
  const off = offsets[Math.floor(offsets.length / 2)] || 0;
  const meta = { name: path.basename(out), frames, offset: off, ...marksMeta(off), hidden: [], cursor: cursorSince(c0, off), result };
  await fs.writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 1));
  log(`${meta.name}: ${frames.length} frames, ${(meta.marks.end - meta.marks.start).toFixed(1)}s raw, ${(frames.length / (meta.marks.end - meta.marks.start)).toFixed(0)} fps`);
  return result;
}

async function recordCodium(WORK) {
  const D = process.env.APP_DISPLAY || await startXvfb(APP_SCALE);
  const env = { ...process.env, DISPLAY: D };
  const x = (...args) => execFileSync("xdotool", args, { env, encoding: "utf8" }).trim();
  try { execFileSync("xsetroot", ["-solid", "#16161a"], { env }); } catch {}
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const home = path.join(WORK, `codium-home-${attempt}`);
    await fs.rm(home, { recursive: true, force: true });
    const morseHome = path.join(home, ".morse"), profile = path.join(home, "codium"), proj = path.join(home, "weather-station");
    await fs.mkdir(path.join(morseHome, "mods"), { recursive: true });
    if (process.env.MORSE_MODEL) await fs.writeFile(path.join(morseHome, "config.json"), JSON.stringify({ models: { [process.env.MORSE_PROVIDER]: process.env.MORSE_MODEL } }));
    await fs.writeFile(path.join(morseHome, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } }));
    await fs.mkdir(path.join(profile, "User"), { recursive: true });
    await fs.writeFile(path.join(profile, "User", "settings.json"), JSON.stringify(CODIUM_SETTINGS, null, 1));
    for (const [p, text] of Object.entries(PROJECT)) { await fs.mkdir(path.dirname(path.join(proj, p)), { recursive: true }); await fs.writeFile(path.join(proj, p), text); }
    // MORSE_DEBUG: the page shows Morse's state to this script (runtime/src/10-dom.js).
    const launch = spawn("node", [path.join(root, "daemon/cli.js"), "launch", "codium", "--", "--no-sandbox", `--user-data-dir=${profile}`,
      `--force-device-scale-factor=${APP_SCALE}`, proj, path.join(proj, "src/station.js")],
      { env: { ...env, MORSE_HOME: morseHome, MORSE_DEBUG: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    launch.out = "";
    launch.stdout.on("data", d => { launch.out += d; });
    launch.stderr.on("data", d => { launch.out += d; });
    const cleanup = () => {
      try { launch.kill(); } catch {}
      try { execFileSync("pkill", ["-9", "-f", `user-data-dir=${profile}`]); } catch {}
    };
    let result;
    try {
      await until(() => /connected to/i.test(launch.out) || launch.exitCode != null, 120000, "morse launch to connect");
      if (launch.exitCode != null) throw new Error("morse launch ended: " + launch.out.slice(-300));
      const port = Number(launch.out.match(/port\s+(\d+)/)[1]);
      let s = null;
      const connect = async () => {
        const t = await until(async () => (await listTargets(port)).find(t => t.type === "page" && /workbench\.html/.test(t.url)), 60000, "the VSCodium window");
        s = await CDPSession.connect(t.webSocketDebuggerUrl);
      };
      await connect();
      const ev = async expr => {
        if (s.closed) await connect();
        const r = await s.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result?.value;
      };
      const st = async () => JSON.parse((await ev(`document.querySelector("[data-morse-ui][data-status]")?.dataset.status || "null"`)) || "null");
      await until(async () => (await st())?.ready && await ev(`!!document.querySelector(".part.sidebar .monaco-list-row") && !!document.querySelector(".monaco-editor .view-lines")`), 90000, "VSCodium with Morse in it");
      // The window fills the screen (there's no window manager to maximize it).
      const win = await until(() => { try { return x("search", "--name", "VSCodium").split("\n").find(Boolean); } catch { return null; } }, 20000, "the VSCodium X window").catch(() => null);
      if (win) { try { x("windowmove", win, "0", "0"); x("windowsize", win, String(Math.round(W * APP_SCALE)), String(Math.round(H * APP_SCALE))); } catch {} }
      await sleep(3500); // the "Morse is ready" note goes, the editor settles
      const io = cdpInput(s, (px, py) => [px, py]);
      const keyed = k => { noteKey(k.key); return io.key(k); };
      const me = human(io, { at: [W * 0.62, H * 0.45] });
      const rectOf = expr => ev(`(() => { const e = ${expr}; const r = e?.getBoundingClientRect(); return r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
      const inBar = sel => rectOf(`document.querySelector("[data-morse-ui][data-status]")?.shadowRoot.querySelector(${JSON.stringify(sel)})`);
      const green = () => ev(`(() => { const e = document.querySelector(".monaco-editor .view-line span span") || document.querySelector(".monaco-editor .view-line"); const c = getComputedStyle(e).color.match(/\\d+/g).map(Number); return c[1] > c[0] + 60 && c[1] > c[2] + 60; })()`);
      result = await recordCdp(s, path.join(WORK, "codium"), async rec => {
        const ask = async (text, n) => {
          for (let i = 0; i < 3 && !(await st().catch(() => null))?.open; i++) {
            await keyed({ key: " ", code: "Space", windowsVirtualKeyCode: 32, modifiers: 2 | 8 }); // Ctrl+Shift+Space
            await until(async () => (await st())?.open, 3000, "the bar to open").catch(() => {});
          }
          await sleep(350);
          rec.mark(`ask${n}`);
          await me.type(text, { fast: true });
          await sleep(300);
          rec.mark(`enter${n}`);
          await keyed(ENTER);
          const t0 = rec.now();
          await until(async () => (await st())?.phase === "working", 8000, "the model to start");
          const done = await until(async () => { const v = await st(); return ["result", "error"].includes(v?.phase) && v; }, 240000, "a result");
          const t1 = rec.now();
          if (t1 - t0 > 3.5) rec.speed(t0 + 1.2, t1 - 0.4);
          rec.mark(`result${n}`);
          return { phase: done.phase, hint: done.hint, secs: +(t1 - t0).toFixed(1) };
        };
        const save = async n => {
          const b = await inBar(".actions [data-a=keep]");
          if (b) await me.click(b.x + b.width / 2, b.y + b.height / 2);
          else await keyed(ENTER); // Enter saves too
          rec.mark(`saved${n}`);
        };
        await me.move(W * 0.55, H * 0.4, 500);
        // 1. the restyle
        const r1 = await ask(CODIUM_ASK1, 1);
        if (r1.phase !== "result" || !(await green())) return { ok: false, r1, miss: "not green" };
        await sleep(1100);
        await save(1);
        await sleep(900);
        // 2. a feature
        await me.move(W * 0.5, H * 0.35, 500);
        const r2 = await ask(CODIUM_ASK2, 2);
        const timerExpr = `[...document.querySelectorAll("body *")].find(e => e.getRootNode() === document && !e.closest("[data-morse-ui]") && /\\b25:00\\b/.test(e.textContent) && e.children.length <= 3 && e.getClientRects().length)`;
        const timer = r2.phase === "result" && await rectOf(timerExpr);
        if (!timer) return { ok: false, r1, r2, miss: "no timer on screen" };
        await sleep(800);
        await save(2);
        await sleep(500);
        const startExpr = `[...document.querySelectorAll("button, [role=button]")].find(e => e.getRootNode() === document && !e.closest("[data-morse-ui]") && /start/i.test(e.textContent + (e.getAttribute("aria-label") || "")) && e.getClientRects().length)`;
        const start = await rectOf(startExpr);
        await rec.zoom({ x: timer.x - 40, y: timer.y - 20, width: Math.max(timer.width, 260) + 80, height: timer.height + 60 }, { max: 2.2, pad: 30 });
        await sleep(600);
        if (start) await me.click(start.x + start.width / 2, start.y + start.height / 2);
        await sleep(1900);
        const ticking = await ev(`(() => { const e = ${timerExpr}; return !e; })()`); // 25:00 has become 24:5x
        rec.mark("timer");
        rec.unzoom();
        await me.move(W * 0.62, H * 0.55, 600);
        await sleep(500);
        // 3. the off switch, and back
        rec.mark("off");
        await keyed({ key: "0", code: "Digit0", windowsVirtualKeyCode: 48, modifiers: 1 | 8 }); // Alt+Shift+0
        const off = await until(async () => !(await green()), 5000, "every change off").then(() => true, () => false);
        await sleep(1500);
        rec.mark("on");
        await keyed({ key: "0", code: "Digit0", windowsVirtualKeyCode: 48, modifiers: 1 | 8 });
        const on = await until(() => green(), 5000, "the changes back").then(() => true, () => false);
        await sleep(1600);
        return { ok: off && on && !!start, r1, r2, timer: !!timer, started: ticking, off, on };
      });
    } catch (e) {
      result = { ok: false, miss: e.message.split("\n")[0] };
    } finally { cleanup(); }
    results.codium = { attempt, ...result };
    log("codium", JSON.stringify(result));
    if (result?.ok) break;
    log(`codium: attempt ${attempt} missed, recording again`);
    await sleep(2000);
  }
  if (!process.env.APP_DISPLAY) xvfb?.kill();
}

let xvfb = null;
async function startXvfb(scale = DS) {
  let n = 60;
  while (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`)) n++;
  // -r: no key repeat (xset can't turn it off on Xvfb); on a busy machine a key
  // held a few hundred ms too long would type twice.
  xvfb = spawn("Xvfb", [`:${n}`, "-screen", "0", `${Math.round(W * scale)}x${Math.round(H * scale)}x24`, "-nolisten", "tcp", "-r", "-ardelay", "60000"], { stdio: "ignore" });
  process.on("exit", () => xvfb?.kill());
  await until(() => existsSync(`/tmp/.X11-unix/X${n}`), 10000, "Xvfb");
  return `:${n}`;
}

// Mouse and keys for a page over CDP (the events Playwright sends), with
// screen positions turned into the page's own. key(): one key press.
const ENTER = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
function cdpInput(s, toPage) {
  let px = 0, py = 0, buttons = 0;
  const mouse = (type, extra = {}) => s.send("Input.dispatchMouseEvent", { type, x: px, y: py, button: "left", buttons, clickCount: 1, ...extra });
  return {
    move: async (sx, sy) => { [px, py] = toPage(sx, sy); await mouse("mouseMoved", buttons ? {} : { button: "none" }); },
    down: async () => { buttons = 1; await mouse("mousePressed"); },
    up: async () => { buttons = 0; await mouse("mouseReleased"); },
    char: async ch => {
      await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    },
    key: async k => {
      await s.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...k });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", ...k, text: undefined });
    },
  };
}

const KEYSYM = { " ": "space", ".": "period", "/": "slash", ",": "comma", "-": "minus", "?": "shift+slash", "'": "apostrophe", ":": "shift+semicolon" };

// The X-screen counterpart of recordScene. ffmpeg grabs the whole screen with
// wall-clock timestamps (x11grab's own clock) while the terminal and the
// app's start are on it. Once the app is up, io.screencast() hands over to a
// CDP screencast of the app's page (a busy machine can't encode the whole
// screen at 30 fps), under the app's own menu bar as grabbed from the screen
// at that moment (nothing in the menu bar changes during the scene). The
// frames become JPEGs like a screencast's.
async function recordX(display, out, body, { x, at }) {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const cap = path.join(out, "screen.nut");
  const IW = Math.round(W * DS), IH = Math.round(H * DS);
  const ff = spawn("nice", ["-n", "-15", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-thread_queue_size", "1024", "-f", "x11grab", "-draw_mouse", "0",
    "-framerate", String(FPS), "-video_size", `${IW}x${IH}`, "-i", display, "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "10",
    "-pix_fmt", "yuv420p", "-copyts", "-f", "nut", cap], { stdio: ["pipe", "ignore", "inherit"] });
  const stopped = new Promise(r => ff.on("exit", r));
  const stopGrab = async () => {
    if (ff.exitCode === null) ff.stdin.write("q");
    await Promise.race([stopped, sleep(20000).then(() => ff.kill("SIGINT"))]);
    await stopped;
  };
  await sleep(700);
  const xInput = {
    move: (px, py) => { x("mousemove", String(Math.round(px)), String(Math.round(py))); },
    down: () => { x("mousedown", "1"); },
    up: () => { x("mouseup", "1"); },
    char: ch => { x("key", "--clearmodifiers", KEYSYM[ch] || (/[A-Z]/.test(ch) ? `shift+${ch.toLowerCase()}` : ch)); },
  };
  let impl = xInput, cast = null;
  const io = {
    move: (a, b) => impl.move(a, b), down: () => impl.down(), up: () => impl.up(), char: ch => impl.char(ch), key: k => { noteKey(k.key); return impl.key(k); },
    use: next => { impl = next; },
    // From now on: the page's screencast under the menu bar (the top `top` pixels of the screen).
    async screencast(s, top) {
      const strip = path.join(out, "menubar.png");
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", `${IW}x${Math.round(top)}`, "-i", `${display}+0,0`, "-frames:v", "1", strip]);
      cast = { strip, top: Math.round(top), frames: [], offsets: [], writes: [], n: 0 };
      s.on("Page.screencastFrame", p => {
        const file = `s${String(cast.n++).padStart(5, "0")}.jpg`;
        cast.offsets.push(Date.now() / 1000 - p.metadata.timestamp);
        cast.frames.push({ file, t: p.metadata.timestamp });
        cast.writes.push(fs.writeFile(path.join(out, file), Buffer.from(p.data, "base64")));
        s.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      });
      await s.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: IW, maxHeight: IH - cast.top, everyNthFrame: 1 });
      await until(() => cast.frames.length > 0, 15000, "the app's screencast"); // a still page sends one frame
      cast.from = Date.now() / 1000;
      cast.s = s;
      await stopGrab();
    },
  };
  const c0 = CURSOR_LOG.length;
  const me = human(io, { at, scale: DS, hidden: true }); // no cursor over the terminal
  const { rec, meta: marksMeta } = marker();
  rec.mark("start");
  let result;
  try { result = await body(rec, me, io); }
  finally {
    rec.unzoom();
    rec.mark("end");
    await sleep(300);
    if (cast?.s) await cast.s.send("Page.stopScreencast").catch(() => {});
    await stopGrab();
    if (cast) await Promise.all(cast.writes);
  }
  // Every frame as a JPEG, with its time (wall clock).
  const times = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", cap], { encoding: "utf8", maxBuffer: 1 << 26 })
    .trim().split("\n").map(Number);
  await ffmpeg(["-i", cap, "-fps_mode", "passthrough", "-q:v", "2", path.join(out, "f%05d.jpg")]);
  let frames = times.map((t, i) => ({ file: `f${String(i + 1).padStart(5, "0")}.jpg`, t }));
  if (cast?.frames.length) {
    // Screencast times are the compositor's clock: move them to the wall clock.
    const off = cast.offsets.sort((a, b) => a - b)[Math.floor(cast.offsets.length / 2)];
    cast.frames.forEach(f => { f.t += off; });
    // The menu bar on top of each frame of the page.
    await ffmpeg(["-i", path.join(out, "s%05d.jpg"), "-i", cast.strip, "-filter_complex",
      `[0:v]scale=${IW}:${IH - cast.top},format=rgb24[p];[1:v]scale=${IW}:${cast.top},format=rgb24[m];[m][p]vstack,format=yuvj420p`, "-fps_mode", "passthrough", "-q:v", "2", path.join(out, "g%05d.jpg")]); // stacked in RGB (the menu bar can be an odd number of pixels tall), stored 4:2:0 like the screen frames: a format change mid-list makes ffmpeg drop time
    const cf = cast.frames.map((f, i) => ({ file: `g${String(i + 1).padStart(5, "0")}.jpg`, t: f.t })).sort((a, b) => a.t - b.t).filter(f => f.t >= cast.from - 0.05);
    frames = [...frames.filter(f => f.t < (cf[0]?.t ?? Infinity)), ...cf];
  }
  const existing = new Set(await fs.readdir(out));
  const meta = { name: path.basename(out), frames: frames.filter(f => existing.has(f.file)), offset: 0, ...marksMeta(0), hidden: [], cursor: cursorSince(c0, 0), result };
  await fs.writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 1));
  await fs.rm(cap, { force: true });
  log(`${meta.name}: ${meta.frames.length} frames, ${(meta.marks.end - meta.marks.start).toFixed(1)}s raw, ${(meta.frames.length / (meta.marks.end - meta.marks.start)).toFixed(0)} fps`);
  return result;
}

// ---------------------------------------------------------------- record
const results = {};
async function recordAll(WORK) {
  const want = name => NEEDED.includes(name) && (!ONLY || ONLY.includes(name));
  const resultsFile = path.join(WORK, "results.json");
  Object.assign(results, JSON.parse(await fs.readFile(resultsFile, "utf8").catch(() => "{}")));
  const browserScenes = NEEDED.filter(n => !OWN_RECORDERS.includes(n) && want(n));
  if (browserScenes.length) await recordBrowser(WORK, want);
  if (want("desktop")) await recordDesktop(WORK);
  if (want("codium")) await recordCodium(WORK);
  await fs.writeFile(resultsFile, JSON.stringify({ ...results, provider: process.env.MORSE_PROVIDER, model: process.env.MORSE_MODEL || "" }, null, 1));
}

// The gallery list, as this checkout has it, with the demo apps' addresses.
async function serveGallery() {
  const server = http.createServer(async (req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (!/^\/site\/mods\/[\w.-]+\.json$/.test(p)) { res.writeHead(404).end(); return; }
    try {
      let text = await fs.readFile(path.join(root, p), "utf8");
      for (const [a, b] of Object.entries(GALLERY_HOSTS)) text = text.split(a).join(b);
      res.writeHead(200, { "Content-Type": "application/json" }).end(text);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/site/mods/index.json`, close: () => server.close() };
}

// The built extension talks to the helper on 7457; this copy talks to ours.
async function extensionFor(WORK, port) {
  const dir = path.join(WORK, "extension");
  await fs.rm(dir, { recursive: true, force: true });
  await fs.cp(EXT, dir, { recursive: true });
  const walk = async d => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|html)$/.test(e.name)) {
        const text = await fs.readFile(p, "utf8");
        const next = text.split("127.0.0.1:7457").join(`127.0.0.1:${port}`).replace(/HELPER_PORT = 7457\b/g, `HELPER_PORT = ${port}`);
        if (next !== text) await fs.writeFile(p, next);
      }
    }
  };
  await walk(dir);
  return dir;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

async function recordBrowser(WORK, want) {
  process.env.MORSE_HELPER_PORT ||= String(await freePort());
  const ext = await extensionFor(WORK, Number(process.env.MORSE_HELPER_PORT));
  const gallery = await serveGallery();
  const profile = await fs.mkdtemp(path.join(WORK, "profile-"));
  const helper = await startHelper(path.join(profile, "helper-home"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: { width: W, height: H }, deviceScaleFactor: DPR,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox", "--hide-scrollbars", "--window-size=1300,900"],
  });
  // The demo apps, straight from demo/sites/, at their made-up addresses.
  await ctx.route(/^http:\/\/[a-z]+\.example\//, async route => {
    const u = new URL(route.request().url());
    const dir = SITE_DIRS[u.host];
    const file = path.join(root, "demo", "sites", dir || "-", path.normalize(u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname));
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
    // Parley ships a strict CSP, like most real web apps (as in demo/serve.js).
    if (dir === "parley") headers["Content-Security-Policy"] = "script-src 'self'";
    try { await route.fulfill({ status: 200, headers, body: await fs.readFile(file) }); }
    catch { await route.fulfill({ status: 404, body: "not found" }); }
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const setup = await ctx.newPage();
  await setup.goto(`chrome://extensions/?id=${id}`);
  await setup.locator("#allow-user-scripts").click();
  await sleep(400);
  // First run is over in this profile: no coach, no tips, no welcome toast
  // (runtime/src/59-onboarding.js, extension/onboarding-host.js).
  await sw.evaluate(url => chrome.storage.local.set({
    "morse.onboarding": { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } },
    welcomed: true,
    "morse.gallery.url": url,
  }), gallery.url);
  // The bar stays at the top (Settings → bar position). On "auto" it hops
  // away from the cursor while pointing, so the drawn cursor can't reach the
  // bar's own chips (Show me once) without chasing it.
  if (CUT !== CUTS.v1) await sw.evaluate(() => Promise.all([chrome.storage.sync.set({ "morse.settings": { barPosition: "top" } }).catch(() => {}), chrome.storage.local.set({ "morse.settings": { barPosition: "top" } })]));
  await pairExtension(ctx, id, helper.code);
  for (const p of ctx.pages()) if (p !== setup && /options\.html|welcome\.html/.test(p.url())) await p.close();
  await ctx.addInitScript(HIDDEN_TRACKER);

  async function open(url) {
    const page = await ctx.newPage();
    // A mod that opens alert()/prompt() can't be shown: those dialogs aren't
    // part of the page picture. Dismiss them and count the run as a miss.
    page.dialogs = 0;
    page.on("dialog", d => { page.dialogs++; d.dismiss().catch(() => {}); });
    logKeys(page);
    await page.goto(url);
    await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await page.reload();
    page.loadedAt = Date.now();
    await page.bringToFront();
    await sleep(1500);
    await page.mouse.move(W / 2, H / 2);
    return page;
  }
  const run = async (name, page, me) => {
    const meta = await recordScene(ctx, page, name, WORK, rec => SCENES[name](ctx, page, me, rec));
    log(name, JSON.stringify(meta.result));
    return meta.result;
  };
  const mods = () => sw.evaluate(() => chrome.storage.local.get("mods").then(r => r.mods || {}));
  const forget = host => sw.evaluate(host => chrome.storage.local.get("mods").then(({ mods = {} }) => {
    for (const [k, m] of Object.entries(mods)) if (JSON.stringify(m.match || {}).includes(host)) delete mods[k];
    return chrome.storage.local.set({ mods });
  }), host).catch(() => {});
  // Model scenes: on a miss, throw the change away and record again on a fresh page.
  async function modelScene(name, url, { before, after } = {}) {
    for (let i = 1; i <= TRIES; i++) {
      if (before) await before();
      const page = await open(url);
      if (after) await after(page);
      const res = await run(name, page, human(page)).catch(e => ({ ok: false, miss: e.message.split("\n")[0] }));
      results[name] = { attempt: i, ...res };
      if (res?.ok) return page;
      log(`${name}: attempt ${i} missed, recording again`);
      if ((await status(page))?.phase === "result") await ui(page, ".actions [data-a=undo]").click().catch(() => {});
      if (!before) await forget(new URL(url).host);
      await page.close();
    }
    throw new Error(`${name}: no usable generation after ${TRIES} tries`);
  }

  let tunes = null;
  if (want("tunes") || want("share")) tunes = await modelScene("tunes", SITE.tunes);
  if (want("parley")) await modelScene("parley", SITE.parley);
  if (want("showonce")) await modelScene("showonce", SITE.mail);
  if (want("heal")) {
    // "Bigger rounded covers" from the gallery, installed last week, as the
    // gallery has it. It learns what it changes on its first visit.
    const covers = JSON.parse((await fs.readFile(path.join(root, "site/mods/tunes-big-covers.morse.json"), "utf8")).split("127.0.0.1:8789").join("tunes.example"));
    const week = new Date(Date.now() - 6 * 86400e3).toISOString();
    const seed = { ...covers, enabled: true, imported: true, importedFrom: "gallery", gallery: { id: "tunes-big-covers", version: 1 }, created: week, updated: week };
    await modelScene("heal", SITE.tunes, {
      before: () => sw.evaluate(m => chrome.storage.local.get("mods").then(({ mods = {} }) => chrome.storage.local.set({ mods: { ...mods, [m.id]: m } })), seed),
      after: async page => {
        await until(async () => (await mods())["tunes-big-covers"]?.fp, 30000, "the covers mod to learn what it changes");
        // Safe start holds a mod back when a page keeps reloading within seconds.
        await sleep(Math.max(0, page.loadedAt + 6500 - Date.now()));
      },
    });
  }
  if (want("gallery")) {
    const news = await open(SITE.byte);
    // The list arrives from the gallery in the background; have it before recording.
    await news.keyboard.press("Alt+Shift+KeyM");
    await ui(news, ".panel .gl-site").first().waitFor({ timeout: 20000 });
    await news.keyboard.press("Escape");
    await sleep(800);
    results.gallery = await run("gallery", news, human(news));
  }
  if (want("edit") || want("tools")) {
    const news = await open(SITE.byte);
    const me = human(news);
    if (want("edit")) results.edit = await run("edit", news, me);
    if (want("tools")) results.tools = await run("tools", news, me);
  }
  if (want("share")) {
    await tunes.bringToFront();
    await sleep(800);
    const me = human(tunes);
    await tunes.mouse.move(W / 2, H / 2);
    results.share = await run("share", tunes, me);
  }
  await fs.writeFile(path.join(WORK, `mods-${path.basename(profile)}.json`), JSON.stringify(await mods(), null, 1));
  await ctx.close();
  helper.stop();
  gallery.close();
}

// ---------------------------------------------------------------- pictures
const RADAR = (size, color = "#a0a0a8") => {
  const op = [0, .3, .22, 0, .26, .95, .7, .32, .2, .8, 1, .24, 0, .3, .2, 0];
  const cells = op.map((o, i) => o ? `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx=".75" opacity="${o}"/>` : "").join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 15 15" fill="${color}">${cells}</svg>`;
};
const FONT = `font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const speedPng = (WORK, w) => path.join(WORK, `speed-${slug(w.label)}-${w.factor}.png`);

// The cursor, drawn the way it used to be drawn into the page, at the
// frames' scale: the arrow, the arrow pressed, and the ripple of a click.
const CUR_PAD = 6, RING = 8, RING_STEP = 2; // ripple: RING pictures, each held RING_STEP frames
const ARROW_SVG = (scale = 1) => `<svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:${CUR_PAD}px;top:${CUR_PAD}px;overflow:visible;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));transform:scale(${scale});transform-origin:3px 2px"><path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L16.8 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
async function renderCursor(WORK) {
  if (existsSync(path.join(WORK, `cur-ring-${RING - 1}.png`))) return;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 100, height: 100 }, deviceScaleFactor: DPR });
  const shot = async (html, size, file) => {
    await p.setContent(`<!doctype html><body style="margin:0;background:transparent"><div id="c" style="position:relative;width:${size}px;height:${size}px">${html}</div></body>`);
    await p.locator("#c").screenshot({ path: path.join(WORK, file), omitBackground: true });
  };
  await shot(ARROW_SVG(1), 24 + 2 * CUR_PAD, "cur-up.png");
  await shot(ARROW_SVG(0.86), 24 + 2 * CUR_PAD, "cur-down.png");
  const ease = u => u * u * (3 - 2 * u);
  for (let j = 0; j < RING; j++) {
    const t = (j * RING_STEP) / FPS, k = 0.2 + 0.8 * ease(Math.min(1, t / 0.32)), o = 1 - ease(Math.min(1, t / 0.45));
    await shot(`<i style="position:absolute;left:${CUR_PAD}px;top:${CUR_PAD}px;width:32px;height:32px;border-radius:50%;background:rgba(160,160,168,.45);transform:scale(${k});opacity:${o}"></i>`, 32 + 2 * CUR_PAD, `cur-ring-${j}.png`);
  }
  await b.close();
}

async function renderPngs(WORK, { posters = [], speeds = [] }) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const shot = async (html, file, w, h, el) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">${html}</body>`);
    await p.evaluate(() => document.fonts.ready);
    await (el ? p.locator(el) : p).screenshot({ path: file, omitBackground: true });
  };
  for (const [k, c] of Object.entries(CARDS)) {
    await shot(`<div style="${FONT}width:${W}px;height:${H}px;background:#0b0b0c;color:#ededef;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">
      ${RADAR(c.big ? 64 : 40)}
      ${c.big ? `<div style="font-size:46px;font-weight:600;letter-spacing:-.03em;margin-top:22px">${esc(c.big)}</div>` : ""}
      <div style="font-size:${c.big ? 26 : 36}px;font-weight:500;letter-spacing:-.02em;margin-top:${c.big ? 12 : 30}px;color:${c.big ? "#a0a0a8" : "#ededef"};max-width:${c.big ? 760 : 1000}px;text-align:center;text-wrap:balance;line-height:1.3">${esc(c.line)}</div>
      ${c.foot ? `<div style="position:absolute;bottom:56px;font-size:17px;color:#86868e;${/github/.test(c.foot) ? "font-family:'Geist Mono',ui-monospace,monospace;" : ""}">${esc(c.foot)}</div>` : ""}
    </div>`, path.join(WORK, `card-${k}.png`), W, H);
  }
  for (const w of speeds) {
    await shot(`<div id="c" style="display:inline-block;padding:2px"><div style="${FONT}display:flex;align-items:center;gap:8px;white-space:nowrap;padding:7px 14px 7px 11px;border-radius:999px;background:rgba(11,11,12,.88);border:1px solid #2e2e33;color:#ededef;font-size:15px;font-weight:500">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="#a0a0a8"><path d="M2 3.5v9l6-4.5zM8 3.5v9l6-4.5z"/></svg>${esc(w.label)}, sped up ${w.factor}×</div></div>`, speedPng(WORK, w), 500, 60, "#c");
  }
  for (const [k, c] of Object.entries(CUT.clips)) {
    await shot(`<div style="${FONT}width:${W}px;height:${CAP}px;background:#0b0b0c;border-top:1px solid #232327;box-sizing:border-box;display:flex;align-items:center;gap:14px;padding:0 26px;color:#ededef">
      ${RADAR(20)}<span style="font-size:${c.caption.length > 70 ? 19 : 22}px;font-weight:500;letter-spacing:-.015em;flex:1">${esc(c.caption)}</span><span style="font-size:19px;font-weight:600;color:#86868e;letter-spacing:-.02em">morse</span></div>`, path.join(WORK, `caption-${k}.png`), W, CAP);
  }
  for (const [file, img, caption] of posters) {
    const data = (await fs.readFile(img)).toString("base64");
    await shot(`<div style="${FONT}width:1200px;height:675px;background:#0b0b0c;display:flex;flex-direction:column;align-items:center;padding-top:26px;box-sizing:border-box">
      <img src="data:image/png;base64,${data}" style="height:542px;border-radius:12px;border:1px solid #2e2e33;box-shadow:0 18px 50px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:center;gap:12px;margin-top:28px;color:#ededef;max-width:1120px">${RADAR(22)}<span style="font-size:${caption.length > 70 ? 21 : 26}px;font-weight:500;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(caption)}</span></div>
    </div>`, file, 1200, 675);
  }
  await b.close();
}

// ---------------------------------------------------------------- video
function ffmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    let err = "";
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", d => { err += d; });
    p.on("error", reject);
    p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err}`))));
  });
}

// Scene time (frame clock) → output time, with each sped-up wait folded to
// ~WAIT seconds (and labelled in the picture), and dead air shortened.
//
// Dead air: on a busy machine each step of the script (finding the next
// thing to click, reading the page) can take a second or two, and the person
// on screen just stands still. Where the person did nothing (no move, click
// or key) for more than IDLE seconds, the pause is cut to IDLE_TO. Never
// inside a labelled wait, and never within AFTER seconds of a click, a key
// or a page load, so the app's own response is shown as it happened.
const IDLE = 0.45, IDLE_TO = 0.25, AFTER = 0.6;
function idleWindows(meta, from, to, ws) {
  const log = (meta.cursor || []).filter(e => e.t >= from && e.t <= to);
  const acts = log.filter(e => e.x !== undefined || e.down !== undefined || e.key || e.nav).map(e => e.t).sort((x, y) => x - y);
  const triggers = log.filter(e => e.down !== undefined || e.key || e.nav).map(e => e.t);
  const out = [];
  for (let i = 1; i < acts.length; i++) {
    let a = acts[i - 1];
    const b = acts[i];
    const last = triggers.filter(c => c <= a).pop();
    if (last !== undefined && a < last + AFTER) a = last + AFTER;
    if (b - a <= IDLE) continue;
    if (ws.some(w => w.to > a && w.from < b)) continue;
    out.push({ from: a, to: b, factor: (b - a) / IDLE_TO });
  }
  return out;
}
function timeline(meta, from, to, wait = WAIT) {
  const ws = meta.speeds.filter(s => s.to > from && s.from < to).map(s => ({ from: Math.max(s.from, from), to: Math.min(s.to, to), label: s.label || MODEL_WAIT }));
  ws.forEach(s => { s.factor = Math.max(1, Math.round((s.to - s.from) / wait)); });
  const idle = idleWindows(meta, from, to, ws);
  const all = [...ws, ...idle];
  const at = t => {
    let o = t - from;
    for (const s of all) if (t > s.from) o -= (Math.min(t, s.to) - s.from) * (1 - 1 / s.factor);
    return o;
  };
  return { at, idle: idle.reduce((n, w) => n + (w.to - w.from), 0), windows: ws.filter(s => s.factor > 1).map(s => ({ a: at(s.from), b: at(s.to), factor: s.factor, label: s.label })) };
}

// zoompan expressions for the zoom windows: eased in and out over R seconds.
function zoomExpr(zs, OW = W, OH = H) {
  const R = 0.7, IW = Math.round(W * DPR), IH = Math.round(H * DPR);
  if (!zs.length) return null;
  const s = z => { const u = `min(clip((it-${z.a.toFixed(3)})/${R},0,1),clip((${z.b.toFixed(3)}-it)/${R},0,1))`; return `(${u})*(${u})*(3-2*(${u}))`; };
  const parts = zs.map(z => {
    const r = z.rect, k = Math.min(z.max, W / r.w, H / r.h);
    const cx = Math.min(Math.max((r.x + r.w / 2) * DPR, IW / k / 2), IW - IW / k / 2), cy = Math.min(Math.max((r.y + r.h / 2) * DPR, IH / k / 2), IH - IH / k / 2);
    return { s: s(z), k, cx, cy };
  });
  const zoom = "1" + parts.map(p => `+${(p.k - 1).toFixed(4)}*${p.s}`).join("");
  const cx = `${IW / 2}` + parts.map(p => `+${(p.cx - IW / 2).toFixed(1)}*${p.s}`).join("");
  const cy = `${IH / 2}` + parts.map(p => `+${(p.cy - IH / 2).toFixed(1)}*${p.s}`).join("");
  return `zoompan=z='${zoom}':x='clip(${cx}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cy}-ih/zoom/2,0,ih-ih/zoom)':d=1:s=${OW}x${OH}:fps=${FPS}`;
}

// The cursor over [from, to] of a scene, frame by frame, as ffmpeg sendcmd
// commands that move the cursor's overlays (off the picture when unused).
function cursorTrack(meta, at, from, to, dur) {
  const ev = (meta.cursor || []).filter(e => e.t <= to).map(e => ({ ...e, o: e.t <= from ? -1 : at(e.t) })).sort((a, b) => a.o - b.o);
  if (!ev.length) return null;
  const OFF = -1000, cmds = [], last = {};
  const put = (tau, id, x, y) => {
    const v = `${Math.round(x)},${Math.round(y)}`;
    if (last[id] === v) return;
    last[id] = v;
    cmds.push([tau, `overlay@${id} x ${Math.round(x)}, overlay@${id} y ${Math.round(y)}`]);
  };
  let i = 0, pos = null, hide = false, down = false;
  const ripples = [];
  for (let k = 0; k <= Math.ceil(dur * FPS); k++) {
    const tau = k / FPS;
    while (i < ev.length && ev[i].o <= tau) {
      const e = ev[i++];
      if (e.hide) hide = true;
      if (e.x !== undefined) { pos = [e.x, e.y]; hide = false; }
      if (e.down === true) { down = true; if (pos) ripples.push({ o: e.o, x: pos[0], y: pos[1] }); }
      if (e.down === false) down = false;
    }
    // Between two samples of one move, in between.
    let p = pos;
    const n = ev[i];
    if (p && n && n.x !== undefined && i > 0 && ev[i - 1].x !== undefined && n.o - ev[i - 1].o < 0.25) {
      const u = (tau - ev[i - 1].o) / Math.max(1e-6, n.o - ev[i - 1].o);
      p = [p[0] + (n.x - p[0]) * u, p[1] + (n.y - p[1]) * u];
    }
    const show = p && !hide;
    const ax = show ? (p[0] - 3 - CUR_PAD) * DPR : OFF, ay = show ? (p[1] - 2 - CUR_PAD) * DPR : OFF;
    put(tau, "cu", down ? OFF : ax, down ? OFF : ay);
    put(tau, "cd", down ? ax : OFF, down ? ay : OFF);
    const r = ripples.filter(r => tau >= r.o && tau < r.o + (RING * RING_STEP) / FPS).pop();
    for (let j = 0; j < RING; j++) {
      const on = r && Math.floor((tau - r.o) * FPS / RING_STEP) === j;
      put(tau, `r${j}`, on ? (r.x - 16 - CUR_PAD) * DPR : OFF, on ? (r.y - 16 - CUR_PAD) * DPR : OFF);
    }
  }
  const byTime = new Map();
  for (const [tau, c] of cmds) byTime.set(tau, [...(byTime.get(tau) || []), c]);
  return [...byTime].map(([tau, cs]) => `${tau.toFixed(4)} ${cs.join(", ")};`).join("\n");
}

// Encodes [from, to] of a scene to a 30 fps H.264 file, with overlays.
async function encodeScene(WORK, meta, from, to, out, { fade = false, caption = null, crf = 14, wait = WAIT, full = false, pill = "bottom-left" } = {}) {
  // full: the frames' own size (1920×1200) instead of 1280×800, for the social formats.
  const OW = full ? Math.round(W * DPR) : W, OH = full ? Math.round(H * DPR) : H, K = OW / W;
  const dir = path.join(WORK, meta.name);
  const { at, windows, idle } = timeline(meta, from, to, wait);
  const hidden = t => meta.hidden.some(([a, b]) => t >= a && t <= b);
  const fr = meta.frames.filter(f => !hidden(f.t));
  let first = 0;
  for (let i = 0; i < fr.length; i++) if (fr[i].t <= from) first = i;
  const use = fr.slice(first).filter((f, i) => i === 0 || (f.t > from && f.t < to));
  const lines = [];
  for (let i = 0; i < use.length; i++) {
    const t = Math.max(use[i].t, from), next = i + 1 < use.length ? use[i + 1].t : to;
    lines.push(`file '${use[i].file}'`, `duration ${Math.max(0.001, at(next) - at(t)).toFixed(4)}`);
  }
  lines.push(`file '${use[use.length - 1].file}'`);
  const list = path.join(dir, `${path.basename(out)}.txt`);
  await fs.writeFile(list, lines.join("\n"));
  const dur = at(to);
  const zs = (meta.zooms || []).filter(z => z.to > from && z.from < to).map(z => ({ ...z, a: at(Math.max(z.from, from)), b: at(Math.min(z.to, to)) }));
  // A zoom already under way when a clip starts is fully in at frame one.
  zs.forEach(z => { if (z.from < from) z.a = -1; if (z.to >= to - 0.4) z.b = 1e4; }); // and one still on at the end stays in
  const inputs = ["-f", "concat", "-safe", "0", "-i", list];
  let graph = `[0:v]fps=${FPS},scale=${Math.round(W * DPR)}:${Math.round(H * DPR)}:flags=lanczos,setsar=1`;
  let n = 1;
  const track = cursorTrack(meta, at, from, to, dur);
  if (track) {
    // The cursor goes on before the zoom, so it zooms with the page.
    const cmdFile = path.join(dir, `${path.basename(out)}.cursor.txt`);
    await fs.writeFile(cmdFile, track);
    graph += `,sendcmd=f=${cmdFile}[c0]`;
    const ids = ["cu", "cd", ...Array.from({ length: RING }, (_, j) => `r${j}`)];
    const files = ["cur-up.png", "cur-down.png", ...Array.from({ length: RING }, (_, j) => `cur-ring-${j}.png`)];
    // Ripples under the arrow.
    const order = [...ids.keys()].sort((a, b) => (ids[a][0] === "r" ? 0 : 1) - (ids[b][0] === "r" ? 0 : 1));
    order.forEach((j, k) => {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-i", path.join(WORK, files[j]));
      graph += `;[c${k}][${n++}:v]overlay@${ids[j]}=x=-1000:y=-1000:eval=frame:shortest=1[c${k + 1}]`;
    });
    graph += `;[c${ids.length}]`;
  } else graph += ",";
  graph += zoomExpr(zs, OW, OH) || `scale=${OW}:${OH}:flags=lanczos`;
  if (fade) graph += `,fade=t=in:st=0:d=0.25,fade=t=out:st=${(dur - 0.3).toFixed(2)}:d=0.3`;
  graph += "[v0]";
  let last = "v0";
  for (const w of windows) {
    inputs.push("-i", speedPng(WORK, w));
    // The speed label: bottom left, or (pill: "top"/"bottom") centred, which is
    // inside every crop the social formats take, on the side away from the bar.
    const px = pill === "bottom-left" ? Math.round(20 * K) : "(W-w)/2", py = pill === "top" ? `${Math.round(20 * K)}` : `H-h-${Math.round(20 * K)}`;
    graph += `;[${n}:v]scale=iw*${K}:-1[s${n}];[${last}][s${n}]overlay=x=${px}:y=${py}:enable='between(t,${w.a.toFixed(2)},${w.b.toFixed(2)})'[v${n}]`;
    last = `v${n++}`;
  }
  if (caption) {
    inputs.push("-i", caption);
    graph += `;[${last}]pad=${W}:${H + CAP}:0:0:color=0x0b0b0c[p];[p][${n}:v]overlay=x=0:y=${H}[v${n}]`;
    last = `v${n++}`;
  }
  graph += `;[${last}]format=yuv420p[out]`;
  await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[out]", "-t", dur.toFixed(3), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", out]);
  return { dur, at, windows, idle };
}

async function cardSegment(WORK, key, secs, out) {
  await ffmpeg(["-loop", "1", "-framerate", String(FPS), "-t", String(secs), "-i", path.join(WORK, `card-${key}.png`),
    "-vf", `fade=t=in:st=0:d=0.3,fade=t=out:st=${(secs - 0.3).toFixed(2)}:d=0.3,format=yuv420p`,
    "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", out]);
}

// A still from an encoded file (so it has the zoom), as a PNG.
async function still(video, t, file) {
  for (const back of [0, 0.5, 1, 2]) {
    await fs.rm(file, { force: true });
    await ffmpeg(["-ss", Math.max(0, t - back).toFixed(2), "-i", video, "-frames:v", "1", "-update", "1", "-vf", `crop=${W}:${H}:0:0`, file]);
    if (existsSync(file)) return file;
  }
  throw new Error(`no frame at ${t}s in ${video}`);
}

// Where each clip starts and ends in its scene (frame clock).
const clicks = m => (m.cursor || []).filter(e => e.down === true).map(e => e.t);
function clipRange(m) {
  switch (m.name) {
    case "tunes": return [m.marks.result - 1.0, m.marks.end]; // as the change appears
    case "tools": return [m.marks.clipStart - 0.3, m.marks.end];
    case "heal": return [m.marks.update - 0.5, m.marks.end];
    // From the app on screen (its menu bar and "Electron" in the sidebar say
    // what it is) to just after Save.
    case "desktop": return [m.marks.app - 0.3, Math.min(m.marks.end, (clicks(m).pop() ?? m.marks.end) + 1.2)];
    // From the first step done by hand ("Show me once · Watching" is on screen).
    case "showonce": return [(clicks(m)[1] ?? m.marks.start) - 0.6, m.marks.clipEnd ?? m.marks.end];
    default: return [m.marks.clipStart, m.marks.end];
  }
}

async function build(WORK) {
  await fs.mkdir(OUT, { recursive: true });
  const metas = {};
  for (const name of NEEDED) metas[name] = JSON.parse(await fs.readFile(path.join(WORK, name, "meta.json"), "utf8"));
  const speeds = new Map();
  for (const m of Object.values(metas)) for (const w of timeline(m, m.marks.start, m.marks.end).windows) speeds.set(speedPng(WORK, w), w);
  for (const m of Object.values(metas)) for (const w of timeline(m, ...clipRange(m), CLIP_WAIT).windows) speeds.set(speedPng(WORK, w), w);
  await renderPngs(WORK, { speeds: [...speeds.values()] });
  await renderCursor(WORK);

  // The video: title cards between the scenes.
  const segs = [], at = {};
  let total = 0;
  for (const [i, [kind, key, secs]] of CUT.order.entries()) {
    const out = path.join(WORK, `seg-${String(i).padStart(2, "0")}.mp4`);
    if (kind === "card") { await cardSegment(WORK, key, secs, out); total += secs; }
    else {
      const m = metas[key];
      const r = await encodeScene(WORK, m, m.marks.start + 0.15, m.marks.end, out, { fade: true });
      log(`${key}: ${r.dur.toFixed(1)}s in the video${r.windows.length ? `, sped up: ${r.windows.map(w => `${w.label} ${w.factor}×`).join(", ")}` : ""}, dead air cut: ${r.idle.toFixed(1)}s`);
      at[key] = { file: out, dur: r.dur, at: r.at, marks: m.marks };
      total += r.dur;
    }
    segs.push(out);
  }
  await fs.writeFile(path.join(WORK, "segs.txt"), segs.map(s => `file '${s}'`).join("\n"));
  const video = path.join(OUT, CUT.video);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(WORK, "segs.txt"), "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", process.env.CRF || "20",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", video]);
  log(`${CUT.video}: ${total.toFixed(1)}s, ${mb(video)}`);

  // Clips: start on the change, caption under the picture.
  const P = CUT.poster, ps = at[P.scene];
  const posters = [[path.join(OUT, P.file), await still(ps.file, P.mark ? Math.min(ps.dur - 0.3, ps.at(ps.marks[P.mark]) + P.after) : ps.dur - 0.6, path.join(WORK, "pf-demo.png")), P.caption]];
  for (const [k, c] of Object.entries(CUT.clips)) {
    const m = metas[c.scene];
    const hq = path.join(WORK, `clip-${k}-hq.mp4`), out = path.join(OUT, `clip-${k}.mp4`);
    const r = await encodeScene(WORK, m, ...clipRange(m), hq, { caption: path.join(WORK, `caption-${k}.png`), crf: 12, wait: CLIP_WAIT });
    let crf = 22;
    for (;;) {
      await ffmpeg(["-i", hq, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out]);
      if (statSync(out).size <= 1.9e6 || crf >= 34) break;
      crf += 2;
    }
    log(`clip-${k}.mp4: ${r.dur.toFixed(1)}s, ${mb(out)} (crf ${crf})${r.dur > 15 ? "  ← longer than 15 s" : ""}`);
    posters.push([path.join(OUT, `poster-${k}.png`), await still(hq, r.dur - 0.5, path.join(WORK, `pf-${k}.png`)), c.caption]);
    if (k === CUT.gif) {
      const gif = path.join(OUT, `clip-${k}.gif`);
      for (const [w, fps, colors] of [[720, 15, 128], [640, 12, 96], [560, 10, 64], [480, 10, 48]]) {
        await ffmpeg(["-i", hq, "-vf", `fps=${fps},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif]);
        if (statSync(gif).size <= 3.9e6) break;
      }
      log(`clip-${k}.gif: ${mb(gif)}`);
    }
  }
  await renderPngs(WORK, { posters });
  for (const [f] of posters) log(`${path.basename(f)}: ${mb(f)}`);
}

// ---------------------------------------------------------------- the social cut
// Segments of scenes at full size, each laid out per format with its caption
// burned in, hard cuts, then an end card. One file per format.
// The tall formats show a crop of the frame around the action (seg.cx, 0..1 across).
function cropFor(F, seg) {
  if (!F.crop) return "";
  const IW = Math.round(W * DPR), IH = Math.round(H * DPR), cw = Math.round(IH * F.crop);
  const x = Math.max(0, Math.min(IW - cw, Math.round((seg.cx ?? 0.5) * IW - cw / 2)));
  return `crop=${cw}:${IH}:${x}:0,`;
}
async function buildSocial(WORK) {
  await fs.mkdir(OUT, { recursive: true });
  const metas = {};
  for (const name of NEEDED) metas[name] = JSON.parse(await fs.readFile(path.join(WORK, name, "meta.json"), "utf8"));
  const speeds = new Map();
  for (const seg of SOCIAL) { const m = structuredClone(metas[seg.scene]); seg.adjust?.(m); for (const w of timeline(m, seg.from(m), seg.to(m), seg.wait ?? CLIP_WAIT).windows) speeds.set(speedPng(WORK, w), w); }
  await renderPngs(WORK, { speeds: [...speeds.values()] });
  await renderCursor(WORK);
  // The segments, at 1920×1200.
  const segs = [];
  for (const [i, seg] of SOCIAL.entries()) {
    const m = structuredClone(metas[seg.scene]), out = path.join(WORK, `social-${i}.mp4`);
    seg.adjust?.(m);
    // VSCodium's bar is at the bottom, the demo apps' at the top: the label goes the other way.
    const r = await encodeScene(WORK, m, seg.from(m), seg.to(m), out, { full: true, crf: 14, wait: seg.wait ?? CLIP_WAIT, pill: seg.scene === "codium" ? "top" : "bottom" });
    log(`social ${i} (${seg.scene}): ${r.dur.toFixed(1)}s${r.windows.length ? `, sped up: ${r.windows.map(w => `${w.label} ${w.factor}×`).join(", ")}` : ""}, dead air cut: ${r.idle.toFixed(1)}s`);
    segs.push({ ...seg, file: out, dur: r.dur });
  }
  // The words, per format: a transparent layer over each segment, and the end card.
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  const layer = async (F, html, file) => {
    await p.setViewportSize({ width: F.w, height: F.h });
    await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;${FONT}">${html}</body>`);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: file, omitBackground: true });
  };
  const mark = F => F.mark ? `<div style="position:absolute;top:${F.mark.y}px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:14px;color:#ededef">${RADAR(34)}<span style="font-size:40px;font-weight:600;letter-spacing:-.03em">morse</span></div>` : "";
  const outs = {};
  for (const [key, F] of Object.entries(FORMATS)) {
    const parts = [];
    for (const [i, seg] of segs.entries()) {
      const png = path.join(WORK, `social-${key}-${i}.png`);
      await layer(F, `${mark(F)}<div style="position:absolute;left:${Math.round(F.w * 0.06)}px;right:${Math.round(F.w * 0.06)}px;top:${F.cap.y}px;height:${F.cap.h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff">
        <div style="font-size:${F.cap.size}px;font-weight:600;letter-spacing:-.02em;line-height:1.18;text-wrap:balance">${esc(seg.caption)}</div>
        ${seg.note ? `<div style="margin-top:${Math.round(F.cap.note * 0.4)}px;font-size:${F.cap.note}px;color:#a0a0a8">${esc(seg.note)}</div>` : ""}</div>`, png);
      const part = path.join(WORK, `social-${key}-${i}.mp4`);
      await ffmpeg(["-i", seg.file, "-loop", "1", "-framerate", String(FPS), "-i", png, "-filter_complex",
        `color=c=0x0b0b0c:s=${F.w}x${F.h}:r=${FPS}[bg];[0:v]${cropFor(F, seg)}scale=${F.pic.w}:${F.pic.h}:flags=lanczos[pic];[bg][pic]overlay=${F.pic.x}:${F.pic.y}:shortest=1[a];[a][1:v]overlay=0:0:shortest=1,format=yuv420p[out]`,
        "-map", "[out]", "-t", seg.dur.toFixed(3), "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", part]);
      parts.push(part);
    }
    // The end card.
    const endPng = path.join(WORK, `social-${key}-end.png`);
    const big = Math.round(Math.min(F.w, F.h) * 0.06);
    await layer(F, `<div style="width:${F.w}px;height:${F.h}px;background:#0b0b0c;color:#ededef;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${Math.round(F.w * 0.08)}px;box-sizing:border-box">
      ${RADAR(Math.round(big * 1.6))}
      <div style="font-size:${big}px;font-weight:600;letter-spacing:-.025em;line-height:1.2;margin-top:${Math.round(big * 0.6)}px;text-wrap:balance">${esc(SOCIAL_END.line)}</div>
      <div style="font-size:${Math.round(big * 0.5)}px;color:#a0a0a8;margin-top:${Math.round(big * 0.5)}px;font-family:'Geist Mono',ui-monospace,monospace">${esc(SOCIAL_END.sub)}</div></div>`, endPng);
    const endMp4 = path.join(WORK, `social-${key}-end.mp4`);
    await ffmpeg(["-loop", "1", "-framerate", String(FPS), "-t", String(SOCIAL_END.secs), "-i", endPng, "-vf", "fade=t=in:st=0:d=0.2,format=yuv420p",
      "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", endMp4]);
    parts.push(endMp4);
    const list = path.join(WORK, `social-${key}.txt`);
    await fs.writeFile(list, parts.map(f => `file '${f}'`).join("\n"));
    const out = path.join(OUT, `morse-social-${key}.mp4`);
    for (let crf = 20; ; crf += 2) {
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out]);
      if (statSync(out).size <= 14e6 || crf >= 32) break;
    }
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }));
    log(`${path.basename(out)}: ${F.w}×${F.h}, ${dur.toFixed(1)}s, ${mb(out)}`);
    outs[key] = out;
  }
  await b.close();
  // A poster for the 16:9 file: the restyle, just done.
  const first = segs[0];
  const poster = path.join(OUT, "poster-social.png");
  await ffmpeg(["-ss", Math.max(0, first.dur - 0.8).toFixed(2), "-i", first.file, "-frames:v", "1", "-update", "1", "-vf", "scale=1200:-2:flags=lanczos", poster]);
  log(`poster-social.png: ${mb(poster)}`);
}

// ---------------------------------------------------------------- main
const WORK = path.resolve(process.env.REUSE || process.env.WORK || await fs.mkdtemp(path.join(os.tmpdir(), "morse-launch-")));
await fs.mkdir(WORK, { recursive: true });
console.log(`work dir ${WORK} · cut ${process.env.CUT || "v2"}`);
if (!process.env.REUSE) await recordAll(WORK);
const missing = [];
for (const name of NEEDED) await fs.access(path.join(WORK, name, "meta.json")).catch(() => missing.push(name));
if (missing.length) console.log(`not building: no recording yet for ${missing.join(", ")}`);
else { await (CUT.social ? buildSocial(WORK) : build(WORK)); console.log(`done → ${path.relative(root, OUT)}/`); }
process.exit(0);
