// Records the launch video, the social clips and their poster frames from real
// runs of the Chrome extension on the demo apps. Playwright plays the user (a
// drawn cursor that moves at human speed, typing with small random delays);
// each scene is a CDP screencast (Page.startScreencast) at 2x; ffmpeg folds
// the model wait, zooms in on the change, and joins the scenes with title
// cards rendered as PNGs.
//
//   npm run build
//   DISPLAY=:99 node demo/record-launch.js            → docs/launch/
//
// The model is real: by default the Morse helper runs Claude Code with haiku
// (MORSE_PROVIDER / MORSE_MODEL change it; MORSE_PROVIDER=demo replays
// core/demo.js). Waiting for the model is sped up in the video and labelled
// "sped up N×"; the bar still shows the real time it took. If a generation
// fails or adds nothing visible, the scene is recorded again (up to TRIES).
//
// Env: OUT (default docs/launch), MORSE_DEMO_PORT (default 9877; the script
// starts demo/serve.js itself), TRIES (3), WORK (where raw frames are kept),
// ONLY=edit,tools (record just these scenes into an existing WORK),
// REUSE=<WORK> (record nothing, rebuild the videos from saved frames), CRF.
// Needs Xvfb, ffmpeg, Playwright (global), and the Inter font for the cards.

import { spawn } from "node:child_process";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { startHelper, pairExtension } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.OUT || path.join("docs", "launch"));
const EXT = path.join(root, "dist", "extension");
const BASE = Number(process.env.MORSE_DEMO_PORT || 9877);
const SITE = {
  parley: `http://127.0.0.1:${BASE}/demo/sites/parley/`,
  byte: `http://127.0.0.1:${BASE + 1}/demo/sites/byte/`,
  tunes: `http://127.0.0.1:${BASE + 2}/demo/sites/tunes/`,
};
process.env.MORSE_PROVIDER ||= "claude-code";
if (process.env.MORSE_PROVIDER === "claude-code") process.env.MORSE_MODEL ||= "haiku";
const TRIES = Number(process.env.TRIES || 3);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const W = 1280, H = 800, DPR = Number(process.env.DPR || 1.5), FPS = 30, CAP = 64; // video size; caption band under the clips
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const log = (...a) => console.log("  ·", ...a);
const mb = f => (statSync(f).size / 1e6).toFixed(2) + " MB";

// ---------------------------------------------------------------- the words
// One short plain line per card (docs/WRITING.md: no hype, no emoji).
const CARDS = {
  open: { big: "morse", line: "Change any app or website in your own words.", foot: "Recorded from real runs. Claude Code (haiku) wrote the changes." },
  tunes: { line: "Point at something. Say what you want." },
  parley: { line: "Ask for what an app is missing." },
  edit: { line: "Or change it by hand. No model needed." },
  tools: { line: "Page tools change the whole page in one click." },
  share: { line: "Every change is a mod you can share with a link." },
  end: { big: "morse", line: "Open source. Uses Claude Code, Codex or your own API key.", foot: "github.com/sam-siavoshian/RRAA" },
};
const CLIPS = {
  "sleep-timer": { scene: "tunes", caption: "“add a sleep timer”, and the player has one." },
  "page-tools": { scene: "tools", caption: "Hide ads, then dark mode. Two clicks, no model." },
  "direct-edit": { scene: "edit", caption: "Rename a headline, move a pop-up. No model, just edit." },
};
const GIF_OF = "sleep-timer";
const ORDER = [["card", "open", 2.4], ["card", "tunes", 1.3], ["scene", "tunes"], ["card", "parley", 1.3], ["scene", "parley"],
  ["card", "edit", 1.3], ["scene", "edit"], ["card", "tools", 1.3], ["scene", "tools"], ["card", "share", 1.3], ["scene", "share"], ["card", "end", 2.8]];
const WAIT = 1.8; // seconds the model wait is folded into

// ---------------------------------------------------------------- the cursor
// Drawn into every page (Chromium doesn't put the OS cursor in a screencast).
// Marked data-morse-ui so Morse ignores it, and hidden while Morse hides its
// own UI to take the before/after shots for the share card.
const CURSOR = () => {
  if (window.top !== window) return;
  window.__demoHidden = [];
  const ARROW = `<svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:-3px;top:-2px;overflow:visible;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));transition:transform .09s;transform-origin:3px 2px"><path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L16.8 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  let d, svg, ring, x = -100, y = -100, hiddenAt = 0, moves = 0;
  const place = () => { if (d) d.style.transform = `translate(${x}px,${y}px)`; };
  const make = () => {
    d = document.createElement("div");
    d.setAttribute("data-morse-ui", "");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;display:block;";
    d.innerHTML = `<i style="position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;background:rgba(160,160,168,.45);transform:scale(.2);opacity:0;transition:transform .28s,opacity .4s"></i>${ARROW}`;
    ring = d.firstChild; svg = d.lastChild;
    place();
  };
  const loop = () => {
    const de = document.documentElement;
    if (de) {
      if (!d) make();
      if (d.parentNode !== de || (de.lastElementChild !== d && moves < 400)) { de.appendChild(d); moves++; }
      const host = document.querySelector("[data-morse-ui][data-status]");
      const hide = !!host && host.style.visibility === "hidden";
      if (hide && !hiddenAt) { hiddenAt = Date.now(); d.style.visibility = "hidden"; }
      if (!hide && hiddenAt) { window.__demoHidden.push([hiddenAt, Date.now()]); hiddenAt = 0; d.style.visibility = ""; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener("mousemove", e => { x = e.clientX; y = e.clientY; place(); }, true);
  addEventListener("mousedown", () => {
    if (!svg) return;
    svg.style.transform = "scale(.86)";
    ring.style.transition = "none"; ring.style.transform = "scale(.2)"; ring.style.opacity = "1";
    requestAnimationFrame(() => { ring.style.transition = "transform .32s, opacity .45s"; ring.style.transform = "scale(1)"; ring.style.opacity = "0"; });
  }, true);
  addEventListener("mouseup", () => { if (svg) svg.style.transform = ""; }, true);
};

// A person, not a script: eased, slightly curved moves; uneven typing.
function human(page) {
  let cx = W / 2, cy = H / 2;
  const me = {
    at: () => [cx, cy],
    async move(x, y, ms) {
      const dist = Math.hypot(x - cx, y - cy);
      ms ??= Math.min(1000, Math.max(260, 240 + dist * 0.7));
      const x0 = cx, y0 = cy, bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(60, dist * 0.12);
      const nx = dist ? -(y - y0) / dist : 0, ny = dist ? (x - x0) / dist : 0;
      const kx = (x0 + x) / 2 + nx * bend, ky = (y0 + y) / 2 + ny * bend;
      const t0 = Date.now();
      for (;;) {
        const u = Math.min(1, (Date.now() - t0) / ms);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const px = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * kx + e * e * x, py = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * ky + e * e * y;
        await page.mouse.move(px, py);
        cx = px; cy = py;
        if (u >= 1) break;
        await sleep(14);
      }
    },
    async click(x, y) {
      if (x !== undefined) await me.move(x, y);
      await sleep(rand(80, 140));
      await page.mouse.down(); await sleep(rand(60, 100)); await page.mouse.up();
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
        await page.keyboard.type(ch);
        let ms = fast ? rand(22, 60) : rand(40, 105);
        if (ch === " " && Math.random() < 0.2) ms += rand(50, 140);
        if (/[,.?]/.test(ch)) ms += rand(80, 160);
        await sleep(ms);
      }
    },
  };
  return me;
}

// ---------------------------------------------------------------- recording
// One screencast per scene. Frames go to disk as they arrive, with the
// compositor's timestamp; marks are wall-clock and converted to that clock
// with the measured offset.
async function recordScene(ctx, page, name, dir, body) {
  const out = path.join(dir, name);
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [], offsets = [], marks = {}, speeds = [], zooms = [];
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
  const now = () => Date.now() / 1000;
  let zoomOpen = null;
  const rec = {
    now,
    mark: k => { marks[k] = now(); },
    speed: (from, to) => speeds.push({ from, to }),
    // Zoom in on a CSS-pixel rect from now until unzoom() (or the end).
    async zoom(target, { max = 2, pad = 40 } = {}) {
      const r = typeof target.boundingBox === "function" ? await target.first().boundingBox() : target;
      if (zoomOpen) rec.unzoom();
      zoomOpen = { from: now(), rect: { x: r.x - pad, y: r.y - pad, w: r.width + 2 * pad, h: r.height + 2 * pad }, max };
    },
    unzoom() { if (zoomOpen) { zooms.push({ ...zoomOpen, to: now() }); zoomOpen = null; } },
  };
  rec.mark("start");
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
    name, frames, offset: off,
    marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v - off])),
    speeds: speeds.map(s => ({ from: s.from - off, to: s.to - off })),
    zooms: zooms.map(z => ({ ...z, from: z.from - off, to: z.to - off })),
    hidden: hidden.map(([a, b]) => [a / 1000 - off - 0.05, b / 1000 - off + 0.05]),
    result,
  };
  await fs.writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 1));
  log(`${name}: ${frames.length} frames, ${(meta.marks.end - meta.marks.start).toFixed(1)}s raw`);
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

// Open the bar, point at `target`, describe, wait for the model (sped up).
async function ask(page, me, rec, target, request, { fx = 0.5, fy = 0.5 } = {}) {
  await page.keyboard.press("Alt+Space");
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
  const t0 = rec.now();
  await waitFor(page, s => s.phase === "working", 5000);
  const s = await waitFor(page, s => s.phase === "result" || s.phase === "error", 240000);
  const t1 = rec.now();
  if (t1 - t0 > 3.5) rec.speed(t0 + 0.9, t1 - 0.4);
  rec.mark("result");
  return { phase: s.phase, hint: s.hint, secs: +(t1 - t0).toFixed(1) };
}
const visibleAdded = page => page.evaluate(() => [...document.querySelectorAll("[data-morse]")].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map(e => ({ tag: e.tagName, text: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 60) })));

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
    await sleep(1000);
    await me.clickOn(ui(page, ".actions [data-a=keep]"));
    await sleep(300);
    // Use it: whatever was added (a button and maybe a menu, or a select).
    const bits = page.locator('[data-morse] button, button[data-morse], [data-morse][role=button], [data-morse] select, select[data-morse], button[class*="sleep" i], button[id*="sleep" i], button[aria-label*="sleep" i], button[title*="sleep" i]').filter({ visible: true });
    const used = [];
    const boxes = [await controls.boundingBox()];
    if (await bits.count()) boxes.push(await bits.first().boundingBox());
    await rec.zoom(union(boxes), { max: 2.2, pad: 50 });
    await sleep(550);
    if (await bits.count()) {
      const el = bits.first();
      const tag = await el.evaluate(e => e.tagName);
      if (tag === "SELECT") {
        // A native select's popup isn't part of the page picture, so pick with the keyboard.
        const b = await me.box(el);
        await me.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
        await sleep(250);
        await el.focus();
        const n = await el.evaluate(e => e.options.length);
        await sleep(300);
        await page.keyboard.press("ArrowDown");
        used.push(await el.evaluate(e => e.options[e.selectedIndex]?.text));
        await sleep(n > 1 ? 2200 : 1000);
      } else {
        await me.clickOn(el);
        used.push(await el.evaluate(e => (e.innerText || e.getAttribute("aria-label") || e.title || e.tagName).trim().slice(0, 40)).catch(() => "?"));
        await sleep(1000);
        // A menu of times? Pick 15 (or another short one).
        const opt = page.locator('[data-morse] button, [data-morse] [role=menuitem], [data-morse] li').filter({ visible: true }).filter({ hasText: /\b(15|10|5|30)\b/ });
        if (await opt.count()) {
          await me.clickOn(opt.first());
          used.push(await opt.first().innerText().catch(() => "?"));
        }
        await sleep(2400);
      }
    } else await sleep(2000);
    const [cx, cy] = me.at();
    await me.move(cx + 120, cy - 60, 500);
    await sleep(500);
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
    await page.keyboard.press("Alt+Space");
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
    await page.mouse.down();
    await sleep(150);
    await me.move(sx - 300, sy + 4, 650);
    await me.move(sx - 868, sy + 2, 850);
    await sleep(200);
    await page.mouse.up();
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
    if (!(await ui(page, ".bar:not([hidden])").count())) await page.keyboard.press("Alt+Space");
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
};

// ---------------------------------------------------------------- record
async function recordAll(WORK) {
  const want = name => !ONLY || ONLY.includes(name);
  const server = spawn("node", [path.join(root, "demo/serve.js")], { env: { ...process.env, MORSE_DEMO_PORT: String(BASE) }, stdio: "ignore" });
  process.on("exit", () => server.kill());
  await sleep(800);
  const profile = await fs.mkdtemp(path.join(WORK, "profile-"));
  const helper = await startHelper(path.join(profile, "helper-home"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: { width: W, height: H }, deviceScaleFactor: DPR,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--hide-scrollbars", "--window-size=1300,900"],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const setup = await ctx.newPage();
  await setup.goto(`chrome://extensions/?id=${id}`);
  await setup.locator("#allow-user-scripts").click();
  await sleep(400);
  // First run is over in this profile: no coach, no tips, no welcome toast
  // (runtime/src/59-onboarding.js, extension/onboarding-host.js).
  await sw.evaluate(() => chrome.storage.local.set({
    "morse.onboarding": { coach: "done", tips: { saved: true, share: true }, dismissed: { model: true, userScripts: true } },
    welcomed: true,
  }));
  await pairExtension(ctx, id, helper.code);
  for (const p of ctx.pages()) if (p !== setup && /options\.html|welcome\.html/.test(p.url())) await p.close();
  await ctx.addInitScript(CURSOR);

  async function open(url) {
    const page = await ctx.newPage();
    // A mod that opens alert()/prompt() can't be shown: those dialogs aren't
    // part of the page picture. Dismiss them and count the run as a miss.
    page.dialogs = 0;
    page.on("dialog", d => { page.dialogs++; d.dismiss().catch(() => {}); });
    await page.goto(url);
    await page.evaluate(() => localStorage.setItem("morse:debug", "1"));
    await page.reload();
    await page.bringToFront();
    await sleep(1500);
    await page.mouse.move(W / 2, H / 2);
    return page;
  }
  const resultsFile = path.join(WORK, "results.json");
  const results = JSON.parse(await fs.readFile(resultsFile, "utf8").catch(() => "{}"));
  const run = async (name, page, me) => {
    const meta = await recordScene(ctx, page, name, WORK, rec => SCENES[name](ctx, page, me, rec));
    log(name, JSON.stringify(meta.result));
    return meta.result;
  };
  // Model scenes: on a miss, throw the change away and record again on a fresh page.
  async function modelScene(name, url) {
    for (let i = 1; i <= TRIES; i++) {
      const page = await open(url);
      const res = await run(name, page, human(page));
      results[name] = { attempt: i, ...res };
      if (res?.ok) return page;
      log(`${name}: attempt ${i} missed, recording again`);
      if ((await status(page))?.phase === "result") await ui(page, ".actions [data-a=undo]").click().catch(() => {});
      await sw.evaluate(host => chrome.storage.local.get("mods").then(({ mods = {} }) => {
        for (const [k, m] of Object.entries(mods)) if (JSON.stringify(m).includes(host)) delete mods[k];
        return chrome.storage.local.set({ mods });
      }), new URL(url).host).catch(() => {});
      await page.close();
    }
    throw new Error(`${name}: no usable generation after ${TRIES} tries`);
  }

  let tunes = null;
  if (want("tunes") || want("share")) tunes = await modelScene("tunes", SITE.tunes);
  if (want("parley")) await modelScene("parley", SITE.parley);
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
  const { mods } = await sw.evaluate(() => chrome.storage.local.get("mods"));
  await fs.writeFile(path.join(WORK, `mods-${path.basename(profile)}.json`), JSON.stringify(mods, null, 1));
  await fs.writeFile(resultsFile, JSON.stringify({ ...results, provider: process.env.MORSE_PROVIDER, model: process.env.MORSE_MODEL || "" }, null, 1));
  await ctx.close();
  helper.stop();
  server.kill();
}

// ---------------------------------------------------------------- pictures
const RADAR = (size, color = "#a0a0a8") => {
  const op = [0, .3, .22, 0, .26, .95, .7, .32, .2, .8, 1, .24, 0, .3, .2, 0];
  const cells = op.map((o, i) => o ? `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx=".75" opacity="${o}"/>` : "").join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 15 15" fill="${color}">${cells}</svg>`;
};
const FONT = `font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
      <div style="font-size:${c.big ? 26 : 36}px;font-weight:500;letter-spacing:-.02em;margin-top:${c.big ? 12 : 30}px;color:${c.big ? "#a0a0a8" : "#ededef"};max-width:1060px;text-align:center">${esc(c.line)}</div>
      ${c.foot ? `<div style="position:absolute;bottom:56px;font-size:17px;color:#86868e;${/github/.test(c.foot) ? "font-family:'Geist Mono',ui-monospace,monospace;" : ""}">${esc(c.foot)}</div>` : ""}
    </div>`, path.join(WORK, `card-${k}.png`), W, H);
  }
  for (const f of speeds) {
    await shot(`<div id="c" style="display:inline-block;padding:2px"><div style="${FONT}display:flex;align-items:center;gap:8px;white-space:nowrap;padding:7px 14px 7px 11px;border-radius:999px;background:rgba(11,11,12,.88);border:1px solid #2e2e33;color:#ededef;font-size:15px;font-weight:500">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="#a0a0a8"><path d="M2 3.5v9l6-4.5zM8 3.5v9l6-4.5z"/></svg>Waiting for the model, sped up ${f}×</div></div>`, path.join(WORK, `speed-${f}.png`), 500, 60, "#c");
  }
  for (const [k, c] of Object.entries(CLIPS)) {
    await shot(`<div style="${FONT}width:${W}px;height:${CAP}px;background:#0b0b0c;border-top:1px solid #232327;box-sizing:border-box;display:flex;align-items:center;gap:14px;padding:0 26px;color:#ededef">
      ${RADAR(20)}<span style="font-size:22px;font-weight:500;letter-spacing:-.015em;flex:1">${esc(c.caption)}</span><span style="font-size:19px;font-weight:600;color:#86868e;letter-spacing:-.02em">morse</span></div>`, path.join(WORK, `caption-${k}.png`), W, CAP);
  }
  for (const [file, img, caption] of posters) {
    const data = (await fs.readFile(img)).toString("base64");
    await shot(`<div style="${FONT}width:1200px;height:675px;background:#0b0b0c;display:flex;flex-direction:column;align-items:center;padding-top:26px;box-sizing:border-box">
      <img src="data:image/png;base64,${data}" style="height:542px;border-radius:12px;border:1px solid #2e2e33;box-shadow:0 18px 50px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:center;gap:12px;margin-top:28px;color:#ededef">${RADAR(22)}<span style="font-size:26px;font-weight:500;letter-spacing:-.02em">${esc(caption)}</span></div>
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

// Scene time (frame clock) → output time, with the model wait folded to ~WAIT seconds.
function timeline(meta, from, to) {
  const ws = meta.speeds.filter(s => s.to > from && s.from < to).map(s => ({ from: Math.max(s.from, from), to: Math.min(s.to, to) }));
  ws.forEach(s => { s.factor = Math.max(1, Math.round((s.to - s.from) / WAIT)); });
  const at = t => {
    let o = t - from;
    for (const s of ws) if (t > s.from) o -= (Math.min(t, s.to) - s.from) * (1 - 1 / s.factor);
    return o;
  };
  return { at, windows: ws.filter(s => s.factor > 1).map(s => ({ a: at(s.from), b: at(s.to), factor: s.factor })) };
}

// zoompan expressions for the zoom windows: eased in and out over R seconds.
function zoomExpr(zs) {
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
  return `zoompan=z='${zoom}':x='clip(${cx}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cy}-ih/zoom/2,0,ih-ih/zoom)':d=1:s=${W}x${H}:fps=${FPS}`;
}

// Encodes [from, to] of a scene to a 30 fps H.264 file, with overlays.
async function encodeScene(WORK, meta, from, to, out, { fade = false, caption = null, crf = 14 } = {}) {
  const dir = path.join(WORK, meta.name);
  const { at, windows } = timeline(meta, from, to);
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
  let graph = `[0:v]fps=${FPS},scale=${Math.round(W * DPR)}:${Math.round(H * DPR)}:flags=lanczos,setsar=1,`;
  graph += zoomExpr(zs) || `scale=${W}:${H}:flags=lanczos`;
  if (fade) graph += `,fade=t=in:st=0:d=0.25,fade=t=out:st=${(dur - 0.3).toFixed(2)}:d=0.3`;
  graph += "[v0]";
  let last = "v0", n = 1;
  for (const w of windows) {
    inputs.push("-i", path.join(WORK, `speed-${w.factor}.png`));
    graph += `;[${last}][${n}:v]overlay=x=W-w-20:y=20:enable='between(t,${w.a.toFixed(2)},${w.b.toFixed(2)})'[v${n}]`;
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
  return { dur, at, windows };
}

async function cardSegment(WORK, key, secs, out) {
  await ffmpeg(["-loop", "1", "-framerate", String(FPS), "-t", String(secs), "-i", path.join(WORK, `card-${key}.png`),
    "-vf", `fade=t=in:st=0:d=0.3,fade=t=out:st=${(secs - 0.3).toFixed(2)}:d=0.3,format=yuv420p`,
    "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", out]);
}

// A still from an encoded file (so it has the zoom), as a PNG.
async function still(video, t, file) {
  await ffmpeg(["-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", `crop=${W}:${H}:0:0`, file]);
  return file;
}

async function build(WORK) {
  await fs.mkdir(OUT, { recursive: true });
  const metas = {};
  for (const name of Object.keys(SCENES)) metas[name] = JSON.parse(await fs.readFile(path.join(WORK, name, "meta.json"), "utf8"));
  // The sleep-timer clip starts as the change appears: the last moment of the
  // pixel effect, not the setup.
  metas.tunes.marks.clipStart = metas.tunes.marks.result - 1.0;
  metas.tools.marks.clipStart -= 0.3;
  const factors = new Set();
  for (const m of Object.values(metas)) for (const w of timeline(m, m.marks.start, m.marks.end).windows) factors.add(w.factor);
  await renderPngs(WORK, { speeds: [...factors] });

  // The video: title cards between the scenes.
  const segs = [], at = {};
  let total = 0;
  for (const [i, [kind, key, secs]] of ORDER.entries()) {
    const out = path.join(WORK, `seg-${String(i).padStart(2, "0")}.mp4`);
    if (kind === "card") { await cardSegment(WORK, key, secs, out); total += secs; }
    else {
      const m = metas[key];
      const r = await encodeScene(WORK, m, m.marks.start + 0.15, m.marks.end, out, { fade: true });
      log(`${key}: ${r.dur.toFixed(1)}s in the video${r.windows.length ? `, model wait sped up ${r.windows.map(w => w.factor + "×").join(", ")}` : ""}`);
      at[key] = { file: out, dur: r.dur };
      total += r.dur;
    }
    segs.push(out);
  }
  await fs.writeFile(path.join(WORK, "segs.txt"), segs.map(s => `file '${s}'`).join("\n"));
  const video = path.join(OUT, "morse-demo.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(WORK, "segs.txt"), "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", process.env.CRF || "20",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", video]);
  log(`morse-demo.mp4: ${total.toFixed(1)}s, ${mb(video)}`);

  // Clips: start on the change, caption under the picture.
  const posters = [[path.join(OUT, "poster-demo.png"), await still(at.tunes.file, at.tunes.dur - 0.5, path.join(WORK, "pf-demo.png")), "Morse: change any app in your own words"]];
  for (const [k, c] of Object.entries(CLIPS)) {
    const m = metas[c.scene];
    const hq = path.join(WORK, `clip-${k}-hq.mp4`), out = path.join(OUT, `clip-${k}.mp4`);
    const r = await encodeScene(WORK, m, m.marks.clipStart, m.marks.end, hq, { caption: path.join(WORK, `caption-${k}.png`), crf: 12 });
    let crf = 22;
    for (;;) {
      await ffmpeg(["-i", hq, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out]);
      if (statSync(out).size <= 3.9e6 || crf >= 34) break;
      crf += 2;
    }
    log(`clip-${k}.mp4: ${r.dur.toFixed(1)}s, ${mb(out)} (crf ${crf})`);
    posters.push([path.join(OUT, `poster-${k}.png`), await still(hq, r.dur - 0.4, path.join(WORK, `pf-${k}.png`)), c.caption]);
    if (k === GIF_OF) {
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

// ---------------------------------------------------------------- main
const WORK = path.resolve(process.env.REUSE || process.env.WORK || await fs.mkdtemp(path.join(os.tmpdir(), "morse-launch-")));
await fs.mkdir(WORK, { recursive: true });
console.log(`work dir ${WORK}`);
if (!process.env.REUSE) await recordAll(WORK);
const missing = [];
for (const name of Object.keys(SCENES)) await fs.access(path.join(WORK, name, "meta.json")).catch(() => missing.push(name));
if (missing.length) console.log(`not building: no recording yet for ${missing.join(", ")}`);
else { await build(WORK); console.log(`done → ${path.relative(root, OUT)}/`); }
process.exit(0);
