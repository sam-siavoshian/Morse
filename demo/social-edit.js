// The edit for demo/record-social.js: takes the raw scene recordings in WORK
// and makes docs/launch/morse-v3-{16x9,4x5,9x16}[-nomusic].mp4, the poster
// and the hook GIF.
//
// - Cut to the beat. The music is 122 BPM; every segment is a whole number
//   of beats long, so every cut lands on a beat. The first change lands on
//   the track's drop (MUSIC_DROP), the others on a beat of their own.
//   The music drops out for one beat before the end card and comes back on
//   its downbeat.
// - Honest speed. Waiting for the model is folded to under a second or two
//   and labelled "sped up N×" in the picture; pauses where the person did
//   nothing are shortened (never within 0.6 s of a click or key, or within
//   1.8 s of a change landing). Everything else plays at its real speed.
// - Camera. Shots are rectangles of the page; the camera eases between them
//   (cubic in-out on position and on the log of the size) and arrives on a
//   change as it lands. Each format frames the same shots at its own shape.
// - Cursor. Drawn from the logged moves (record-social.js pathAt): eased,
//   slightly arced, a small overshoot and settle; pressed while the button
//   is down, with a soft ripple on each click.
// demo/compose-social.py renders the frames; ffmpeg encodes them.

import { spawn, execFileSync } from "node:child_process";
import { promises as fs, statSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// ---------------------------------------------------------------- the cursor's path
export const ease3 = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2); // cubic in-out
const easeOut3 = u => 1 - Math.pow(1 - u, 3);
const SETTLE = 0.8; // the move ends a little past the target at this point, then settles back
export function pathAt(m, u) {
  u = Math.min(1, Math.max(0, u));
  const dx = m.x1 - m.x0, dy = m.y1 - m.y0, d = Math.hypot(dx, dy) || 1;
  const ox = m.x1 + (dx / d) * m.over, oy = m.y1 + (dy / d) * m.over;
  if (u < SETTLE) {
    const e = ease3(u / SETTLE);
    // A quadratic curve bent to one side: a hand moves in an arc, not a line.
    const kx = (m.x0 + ox) / 2 - (dy / d) * m.bend, ky = (m.y0 + oy) / 2 + (dx / d) * m.bend;
    return [(1 - e) ** 2 * m.x0 + 2 * (1 - e) * e * kx + e * e * ox, (1 - e) ** 2 * m.y0 + 2 * (1 - e) * e * ky + e * e * oy];
  }
  const e = easeOut3((u - SETTLE) / (1 - SETTLE));
  return [ox + (m.x1 - ox) * e, oy + (m.y1 - oy) * e];
}

// ---------------------------------------------------------------- the cut
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const W = 1280, H = 800, S = 1.5, SW = W * S, SH = H * S, FPS = 30;
const BPM = Number(process.env.MUSIC_BPM || 122), BEAT = 60 / BPM;
const DROP = Number(process.env.MUSIC_DROP || 79.166); // seconds into the track: the downbeat after the riser
const log = (...a) => console.log("  ·", ...a);
const mb = f => (statSync(f).size / 1e6).toFixed(2) + " MB";
const r2 = r => r && { x: r.x * S, y: r.y * S, w: r.w * S, h: r.h * S }; // CSS px → frame px
const pad = (r, p) => r && { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
const union = (...rs) => { rs = rs.filter(Boolean); const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y)); return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }; };
const FULL = null;

// Each segment: a stretch of one scene. beats: its length. from: where it
// starts (scene time, seconds). anchor: a mark that lands on a given beat of
// the segment (the wait before it is folded to make it so). shots: where the
// camera is ({ at: scene time it arrives, rect: page rect in CSS px or FULL,
// ease: seconds }). caption: the words over it; same: keep the last caption
// on screen (one caption over a split scene).
export function segments(MODEL_LABEL) {
  const STRIP = { x: 300, y: 8, w: 680, h: 130 }; // the bar, at the top
  return [
    { scene: "vscode", beats: 11, from: m => m.marks.enter1 - 0.5, anchor: { mark: "result1", beat: 3 }, bar: "bottom",
      caption: "“Make VS Code look like Synthwave ’84”", note: `Real VS Code · ${MODEL_LABEL} wrote it live`,
      shots: m => [{ at: m.marks.start, rect: FULL }, { at: m.marks.result1 + 2.6, rect: { x: 250, y: 30, w: 760, h: 450 }, ease: 1.1 }] },
    { scene: "nodejs", beats: 7, from: m => m.marks.enter1 - 0.45, anchor: { mark: "result1", beat: 2 }, bar: "top",
      caption: "A dark reading mode for nodejs.org", note: "The real site · one sentence",
      shots: m => [{ at: m.marks.start, rect: FULL }, { at: m.marks.result1 + 1.7, rect: m.rects.column ? pad(m.rects.column, 30) : { x: 240, y: 60, w: 800, h: 600 }, ease: 1.0 }] },
    { scene: "obsidian", beats: 18, from: m => m.marks.enter1 - 0.5, anchor: { mark: "result1", beat: 3 }, bar: "bottom",
      caption: "Obsidian has no focus timer. Now it does.", note: `Real Obsidian · ${MODEL_LABEL}`,
      shots: m => [{ at: m.marks.start, rect: FULL }, { at: m.marks.result1 + 0.1, rect: m.rects.panel ? pad(union(m.rects.panel, m.rects.panel2), 110) : FULL, ease: 0.8, max: 1.7 }] },
    { scene: "docker", beats: 6, from: m => m.marks.watching - 0.2, to: m => m.marks.stopped + 0.5, bar: "top",
      caption: "Do a chore once…", note: "Show me once · hub.docker.com",
      shots: m => [{ at: m.marks.start, rect: FULL }] },
    { scene: "docker", beats: 7, from: m => m.marks.enter1 - 0.5, anchor: { mark: "result1", beat: 2 }, bar: "top",
      caption: "…and Morse makes it a button.", note: `Show me once · ${MODEL_LABEL}`,
      shots: m => [{ at: m.marks.enter1 - 0.5, rect: m.rects.filter ? pad(union(m.rects.filter, m.rects.bar1 || STRIP), 40) : FULL },
        { at: m.marks.result1 + 0.1, rect: m.rects.button ? pad(union(m.rects.button, m.rects.filter), 130) : FULL, ease: 0.8 }] },
    { scene: "docker2", beats: 5, from: m => m.marks.press - 0.9, bar: "top",
      caption: "It works on every image.", note: "hub.docker.com/_/redis",
      shots: m => [{ at: m.marks.start, rect: m.rects.button ? pad(union(m.rects.button, m.rects.filter), 150) : FULL }] },
    { scene: "style1", beats: 5, from: m => m.marks.enter1 - 0.6, anchor: { mark: m => (m.marks.shown ? "shown" : "result1"), beat: 2 }, bar: "bottom",
      caption: "Say your style once, in Obsidian…", note: "Your style · no model needed",
      shots: m => [{ at: m.marks.start, rect: FULL }] },
    { scene: "style2", beats: 4, from: m => m.marks.start + 0.2, bar: "bottom",
      caption: "…and Logseq has it too.", note: "Real Logseq, opened after",
      shots: m => [{ at: m.marks.start, rect: FULL }, { at: m.marks.start + 2.0, rect: { x: 10, y: 80, w: 1000, h: 560 }, ease: 1.6 }] },
  ];
}
const END_BEATS = 6;
const END = { line: "Morse: hack your apps in your own words", chip: "Open source", url: "github.com/sam-siavoshian/Morse" };

// Scene time → output time, for one segment: model waits folded (the
// anchor's to land it on its beat), idle stretches shortened.
const IDLE = 0.5, IDLE_TO = 0.3, AFTER = 0.6, AFTER_RESULT = 1.8, MIN_FOLD = 0.35, FOLD = 0.9;
function busy(m, a, b) {
  const out = [];
  for (const e of m.log) {
    if (e.t0 !== undefined) out.push([e.t0, e.t1]);
    else if (e.down !== undefined || e.key) out.push([e.t, e.t + AFTER]);
  }
  for (const w of m.waits) out.push([w.from, w.to + AFTER_RESULT]);
  for (const [k, t] of Object.entries(m.marks)) if (/^(result|shown|press|start1|scroll)/.test(k)) out.push([t, t + AFTER_RESULT]);
  for (const [k, t] of Object.entries(m.marks)) if (/^saved/.test(k)) out.push([t, t + AFTER]);
  return out.filter(([x, y]) => y > a && x < b).sort((p, q) => p[0] - q[0]);
}
function pieces(m, from, to, fold) {
  const ps = [];
  const waits = m.waits.filter(w => w.to > from && w.from < to).map(w => ({ a: Math.max(w.from, from), b: Math.min(w.to, to), label: w.label }));
  // Idle: gaps between busy intervals, outside waits.
  const bs = busy(m, from, to);
  let cur = from;
  const idle = [];
  for (const [x, y] of bs) {
    if (x - cur > IDLE) idle.push({ a: cur + 0.1, b: x - 0.05 });
    cur = Math.max(cur, y);
  }
  if (to - cur > IDLE + 0.5) idle.push({ a: cur + 0.1, b: to }); // a still tail: compressed too
  for (const w of waits) ps.push({ ...w, k: Math.max(1, (w.b - w.a) / (fold(w) ?? FOLD)), wait: true });
  // A move the busy machine stretched (its input events queued up) plays at
  // the speed it was meant to: the drawn cursor follows the same curve.
  for (const e of m.log) {
    if (e.t0 === undefined || e.t1 - e.t0 < 0.8 || e.t1 < from || e.t0 > to) continue;
    if (waits.some(w => w.b > e.t0 && w.a < e.t1)) continue;
    ps.push({ a: e.t0, b: e.t1, k: (e.t1 - e.t0) / 0.55 });
  }
  for (const i of idle) if (!waits.some(w => w.b > i.a && w.a < i.b) && i.b - i.a > 0.15) ps.push({ ...i, k: (i.b - i.a) / Math.min(IDLE_TO, i.b - i.a) });
  ps.sort((p, q) => p.a - q.a);
  return ps;
}
function mapper(from, ps) {
  const at = t => { let o = t - from; for (const p of ps) if (t > p.a) o -= (Math.min(t, p.b) - p.a) * (1 - 1 / p.k); return o; };
  const src = o => { // inverse
    let t = from, acc = 0;
    for (const p of ps) {
      if (p.a > t) { const span = p.a - t; if (acc + span >= o) return t + (o - acc); acc += span; t = p.a; }
      const span = (p.b - p.a) / p.k;
      if (acc + span >= o) return p.a + (o - acc) * p.k;
      acc += span; t = p.b;
    }
    return t + (o - acc);
  };
  return { at, src };
}
export function plan(m, seg) {
  const D = seg.beats * BEAT;
  let from = seg.from(m), fold = FOLD;
  const end = m.marks.end;
  let anchorWait = null;
  for (let pass = 0; pass < 8; pass++) {
    const ps = pieces(m, from, end, w => (w === anchorWait || (anchorWait && w.a === anchorWait.a) ? fold : FOLD));
    if (!seg.anchor) return finish(from, ps);
    const t = m.marks[typeof seg.anchor.mark === "function" ? seg.anchor.mark(m) : seg.anchor.mark];
    const w = ps.filter(p => p.wait && p.b <= t + 0.5).pop();
    anchorWait = w;
    const target = seg.anchor.beat * BEAT;
    if (!w) { from = t - target; continue; }
    const base = mapper(from, ps).at(t) - (w.b - w.a) / w.k; // everything but the wait
    fold = target - base;
    if (fold < MIN_FOLD) { from += (MIN_FOLD - fold) * 3 + 0.02; fold = MIN_FOLD; continue; }
    if (fold > 2.4) { from -= fold - 2.4; fold = 2.4; continue; }
    const ps2 = pieces(m, from, end, p => (p.a === w.a ? fold : FOLD));
    return finish(from, ps2);
  }
  return finish(from, pieces(m, from, end, p => (anchorWait && p.a === anchorWait.a ? Math.max(MIN_FOLD, fold) : FOLD)));
  function finish(f, ps) {
    const mp = mapper(f, ps);
    const stop = seg.to ? seg.to(m) : end;
    return { from: f, ps, D, ...mp, last: Math.min(stop, end), windows: ps.filter(p => p.wait).map(p => ({ a: mp.at(p.a), b: mp.at(p.b), factor: Math.max(2, Math.round(p.k)), label: p.label })) };
  }
}

// The cursor at scene time t: { x, y } in CSS px, down, and click times.
function cursorAt(m, t) {
  let pos = null, down = false;
  const ev = m.log.map(e => ({ ...e, s: e.t0 ?? e.t })).sort((a, b) => a.s - b.s);
  for (const e of ev) {
    if (e.s > t) break;
    if (e.t0 !== undefined) { pos = t >= e.t1 ? [e.x1, e.y1] : pathAt(e, (t - e.t0) / Math.max(1e-3, e.t1 - e.t0)); continue; }
    if (e.x !== undefined) pos = [e.x, e.y];
    if (e.down !== undefined) down = e.down;
  }
  return pos && { x: pos[0], y: pos[1], down };
}

// The camera for one format: the smallest rect of its shape that holds the
// shot (with room around it), inside the frame.
function frameFor(rect, A, cx = 0.5, zmax = 2.4) {
  const wmax = A >= SW / SH ? SW : SH * A, hmax = wmax / A;
  if (!rect) return { x: Math.min(SW - wmax, Math.max(0, cx * SW - wmax / 2)), y: (SH - hmax) / 2, w: wmax, h: hmax };
  let w = Math.max(rect.w, rect.h * A);
  w = Math.min(wmax, Math.max(wmax / zmax, w));
  const h = w / A;
  const x = Math.min(SW - w, Math.max(0, rect.x + rect.w / 2 - w / 2)), y = Math.min(SH - h, Math.max(0, rect.y + rect.h / 2 - h / 2));
  return { x, y, w, h };
}
function camera(shotsOut, A, cx) {
  const fr = shotsOut.map(s => ({ ...s, f: frameFor(s.rect, A, cx, s.max) }));
  return o => {
    let cur = fr[0].f;
    for (let i = 1; i < fr.length; i++) {
      const s = fr[i], t1 = s.o, t0 = Math.max(fr[i - 1].o, t1 - (s.ease ?? 0.8));
      if (o >= t1) { cur = s.f; continue; }
      if (o > t0) {
        const u = ease3((o - t0) / Math.max(1e-3, t1 - t0)), a = cur, b = s.f;
        const lw = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * u);
        const cxa = a.x + a.w / 2, cya = a.y + a.h / 2, cxb = b.x + b.w / 2, cyb = b.y + b.h / 2;
        const ccx = cxa + (cxb - cxa) * u, ccy = cya + (cyb - cya) * u, lh = lw / A;
        return { x: ccx - lw / 2, y: ccy - lh / 2, w: lw, h: lh };
      }
      break;
    }
    return cur;
  };
}

// ---------------------------------------------------------------- formats
// pic: where the picture goes; A: its shape. cap: where the words go.
const FORMATS = {
  "16x9": { w: 1920, h: 1080, pic: { x: 192, y: 0, w: 1536, h: 960 }, strip: [960, 1080] },
  "4x5": { w: 1080, h: 1350, pic: { x: 0, y: 300, w: 1080, h: 900 }, band: { top: [40, 290], bottom: [1206, 1340] } },
  "9x16": { w: 1080, h: 1920, pic: { x: 0, y: 590, w: 1080, h: 1000 }, band: { top: [190, 570], bottom: [1600, 1700] } },
};
const FONT = `font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RADAR = (size, color = "#a0a0a8") => {
  const op = [0, .3, .22, 0, .26, .95, .7, .32, .2, .8, 1, .24, 0, .3, .2, 0];
  return `<svg width="${size}" height="${size}" viewBox="0 0 15 15" fill="${color}">${op.map((o, i) => o ? `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx=".75" opacity="${o}"/>` : "").join("")}</svg>`;
};
const MARK = (size = 30) => `<div style="display:flex;align-items:center;gap:${Math.round(size * 0.35)}px;color:#ededef">${RADAR(size)}<span style="font-size:${Math.round(size * 1.05)}px;font-weight:650;letter-spacing:-.03em">morse</span></div>`;

async function renderAssets(dir, segs) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  const shot = async (html, file, w, h, sel) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;${FONT}">${html}</body>`);
    await p.evaluate(() => document.fonts.ready);
    await (sel ? p.locator(sel) : p).screenshot({ path: file, omitBackground: true });
    return file;
  };
  const files = {};
  // The cursor, at 4× (scaled down per frame): the arrow, and the arrow pressed.
  const arrow = k => `<svg id="c" width="${24 * 4}" height="${24 * 4}" viewBox="0 0 24 24" style="display:block;overflow:visible;filter:drop-shadow(0 ${k}px ${k * 1.6}px rgba(0,0,0,.45))"><path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L16.8 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  files.cursor = await shot(`<div style="padding:12px;display:inline-block" id="w">${arrow(1.2)}</div>`, path.join(dir, "cursor.png"), 140, 140, "#w");
  for (const [key, F] of Object.entries(FORMATS)) {
    files[key] = { caps: [], pills: {}, end: null };
    for (const [i, seg] of segs.entries()) {
      const file = path.join(dir, `cap-${key}-${i}.png`);
      if (F.strip) {
        // 16:9: a strip under the picture (nothing of the app is covered).
        const [t0, t1] = F.strip;
        files[key].caps.push({ file: await shot(`<div style="position:absolute;left:0;right:0;top:${t0}px;height:${t1 - t0}px;display:flex;align-items:center;justify-content:center;text-align:center">
            <div style="position:absolute;left:40px;top:0;bottom:0;display:flex;align-items:center">${MARK(28)}</div>
            <div><div style="font-size:50px;font-weight:750;letter-spacing:-.03em;line-height:1.08;color:#fff">${esc(seg.caption)}</div>
            ${seg.note ? `<div style="margin-top:6px;font-size:22px;font-weight:500;color:#a8a8b0">${esc(seg.note)}</div>` : ""}</div></div>`, file, F.w, F.h), same: seg.same });
      } else {
        const [t0, t1] = F.band.top, [b0, b1] = F.band.bottom;
        files[key].caps.push({ file: await shot(`<div style="position:absolute;left:0;right:0;top:${t0}px;height:${t1 - t0}px;display:flex;flex-direction:column;align-items:center;justify-content:${key === "9x16" ? "flex-end" : "center"};padding:0 56px;box-sizing:border-box;text-align:center">
            ${key === "9x16" ? `<div style="margin-bottom:auto;padding-top:12px">${MARK(34)}</div>` : `<div style="position:absolute;top:0;left:0;right:0;display:flex;justify-content:center">${MARK(26)}</div>`}
            <div style="font-size:${key === "9x16" ? 70 : 60}px;font-weight:750;letter-spacing:-.03em;line-height:1.1;color:#fff;text-wrap:balance;${key === "4x5" ? "margin-top:34px" : "margin-bottom:22px"}">${esc(seg.caption)}</div></div>
          <div style="position:absolute;left:0;right:0;top:${b0}px;height:${b1 - b0}px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:500;color:#a8a8b0">${esc(seg.note || "")}</div>`, file, F.w, F.h), same: seg.same });
      }
    }
    // The end card.
    const big = key === "16x9" ? 76 : 74;
    files[key].end = await shot(`<div style="width:${F.w}px;height:${F.h}px;background:radial-gradient(ellipse at 50% 40%,#1b1b22 0%,#0b0b0c 70%);color:#ededef;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${Math.round(F.w * 0.08)}px;box-sizing:border-box">
      ${RADAR(Math.round(big * 1.5), "#d8d8de")}
      <div style="font-size:${big}px;font-weight:750;letter-spacing:-.035em;line-height:1.1;margin-top:${Math.round(big * 0.55)}px;text-wrap:balance;max-width:${key === "16x9" ? 1300 : 900}px">${esc(END.line)}</div>
      <div style="margin-top:${Math.round(big * 0.6)}px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:center">
        <span style="font-size:${Math.round(big * 0.4)}px;font-weight:600;padding:10px 22px;border-radius:999px;background:#ededef;color:#0b0b0c">${esc(END.chip)}</span>
        <span style="font-size:${Math.round(big * 0.4)}px;font-family:'Geist Mono','JetBrains Mono',ui-monospace,monospace;color:#c8c8d0">${esc(END.url)}</span></div></div>`, path.join(dir, `end-${key}.png`), F.w, F.h);
  }
  await b.close();
  return { files };
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    let err = "";
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", d => { err += d; });
    p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err}`))));
  });
}
const probe = f => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }));

export async function buildSocial({ WORK, OUT, MUSIC, MODEL_LABEL }) {
  await fs.mkdir(OUT, { recursive: true });
  const dir = path.join(WORK, "edit");
  await fs.mkdir(dir, { recursive: true });
  // SEGS=nodejs,docker: a preview of just those scenes.
  const segs = segments(MODEL_LABEL).filter(s => !process.env.SEGS || process.env.SEGS.split(",").includes(s.scene));
  const metas = {};
  for (const s of segs) metas[s.scene] ||= JSON.parse(await fs.readFile(path.join(WORK, s.scene, "meta.json"), "utf8"));

  // The timeline: each segment's plan and where it starts in the video.
  let T = 0;
  const plans = segs.map(seg => {
    const m = metas[seg.scene], p = plan(m, seg);
    const out = { seg, m, p, t0: T };
    log(`${seg.scene}: ${p.D.toFixed(2)}s (${seg.beats} beats) from ${(p.from - m.marks.start).toFixed(2)}s${p.windows.length ? `, ${p.windows.map(w => `${w.label} sped up ${w.factor}×`).join(", ")}` : ""}`);
    T += p.D;
    return out;
  });
  const endAt = T, total = T + END_BEATS * BEAT;
  log(`end card at ${endAt.toFixed(2)}s (beat ${Math.round(endAt / BEAT)}), total ${total.toFixed(2)}s`);

  // Pictures: captions, the end card, the cursor, the speed labels.
  const A = await renderAssets(dir, segs);
  const pills = {};
  {
    const { chromium } = createRequire(import.meta.url)("playwright");
    const b = await chromium.launch();
    const pg = await b.newPage({ deviceScaleFactor: 1 });
    for (const { p } of plans) for (const w of p.windows) for (const key of Object.keys(FORMATS)) {
      const text = `${w.label}, sped up ${w.factor}×`, file = path.join(dir, `pill-${key}-${w.factor}.png`);
      if (pills[`${key}|${text}`]) continue;
      await pg.setViewportSize({ width: 800, height: 90 });
      await pg.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;${FONT}"><div id="c" style="display:inline-block;padding:2px"><div style="display:flex;align-items:center;gap:9px;white-space:nowrap;padding:8px 16px 8px 13px;border-radius:999px;background:rgba(11,11,12,.86);border:1px solid rgba(255,255,255,.12);color:#ededef;font-size:${key === "16x9" ? 21 : 26}px;font-weight:500"><svg width="15" height="15" viewBox="0 0 16 16" fill="#a0a0a8"><path d="M2 3.5v9l6-4.5zM8 3.5v9l6-4.5z"/></svg>${esc(text)}</div></div></body>`);
      await pg.evaluate(() => document.fonts.ready);
      await pg.locator("#c").screenshot({ path: file, omitBackground: true });
      pills[`${key}|${text}`] = file;
    }
    await b.close();
  }

  const outs = {};
  for (const [key, F] of Object.entries(FORMATS)) {
    // KEEP=16x9,4x5: those formats are already drawn in OUT; only mix them again.
    const kept = path.join(OUT, `morse-v3-${key}-nomusic.mp4`);
    if ((process.env.KEEP || "").split(",").includes(key) && existsSync(kept)) { outs[key] = kept; continue; }
    const Asp = F.pic.w / F.pic.h;
    const frames = [];
    const N = Math.round(total * FPS);
    const cams = plans.map(({ seg, m, p }) => camera(seg.shots(m).map(s => ({ ...s, rect: r2(s.rect), o: Math.max(0, Math.min(p.D, p.at(s.at))) })).sort((a, b) => a.o - b.o), Asp, seg.cx ?? 0.5));
    for (let i = 0; i < N; i++) {
      const o = i / FPS;
      if (o >= endAt) {
        const age = o - endAt;
        frames.push({ ov: [[A.files[key].end, 0, 0, Math.min(1, age / 0.22), 1.035 - 0.035 * ease3(Math.min(1, age / 0.45))]] });
        continue;
      }
      const k = plans.findLastIndex(x => x.t0 <= o + 1e-6);
      const { seg, m, p, t0 } = plans[k];
      const lo = o - t0, ts = Math.min(p.src(lo), m.marks.end);
      const fr = m.frames.filter(f => f.t <= ts).pop() || m.frames[0];
      const cam = cams[k](lo);
      const c = cursorAt(m, Math.min(ts, p.last + 5));
      const rip = m.log.filter(e => e.down === true).map(e => { const at = cursorAt(m, e.t); return at && [at.x * S, at.y * S, lo - p.at(e.t)]; }).filter(r => r && r[2] >= 0 && r[2] < 0.55);
      const ov = [];
      const cap = A.files[key].caps[k];
      // The words pop in when a new caption starts.
      let capAge = lo;
      for (let j = k; j > 0 && segs[j].same; j--) capAge += plans[j - 1].p.D;
      ov.push([cap.file, 0, 0, Math.min(1, capAge / 0.16), 1.04 - 0.04 * ease3(Math.min(1, capAge / 0.3))]);
      for (const w of p.windows) if (lo >= w.a && lo < w.b) {
        const pf = pills[`${key}|${w.label}, sped up ${w.factor}×`];
        const fade = Math.min(1, (lo - w.a) / 0.12, (w.b - lo) / 0.12);
        // Centered, in the picture, away from Morse's bar and the caption.
        const ph = key === "16x9" ? 46 : 58;
        const y = seg.bar === "bottom" ? F.pic.y + 26 : F.pic.y + F.pic.h - ph - 26;
        ov.push([pf, "center", Math.round(y), fade, 1]);
      }
      frames.push({ src: path.join(WORK, seg.scene, fr.file), crop: [cam.x, cam.y, cam.w, cam.h], cur: c ? [c.x * S, c.y * S, c.down ? 1 : 0] : null, rip, ov });
    }
    const edl = path.join(dir, `edl-${key}.json`);
    await fs.writeFile(edl, JSON.stringify({ w: F.w, h: F.h, fps: FPS, bg: [11, 11, 12], pic: F.pic, cursor: A.files.cursor, crf: 19, frames }));
    const silent = path.join(OUT, `morse-v3-${key}-nomusic.mp4`);
    await new Promise((resolve, reject) => {
      const py = spawn("python3", ["-I", path.join(root, "demo", "compose-social.py"), edl, silent], { stdio: ["ignore", "inherit", "inherit"] });
      py.on("exit", c => (c === 0 ? resolve() : reject(new Error(`compose-social.py ${key}: ${c}`))));
    });
    outs[key] = silent;
    log(`${path.basename(silent)}: ${F.w}×${F.h}, ${probe(silent).toFixed(2)}s, ${mb(silent)}`);
  }

  // The music: the riser into the drop on the first change, cut on the
  // beat, one beat of silence, back for the end card, faded out.
  if (MUSIC && existsSync(MUSIC)) {
    const off = DROP - (plans[0].seg.anchor?.beat ?? 0) * BEAT; // track time at video 0
    const gapA = endAt - BEAT, wav = path.join(dir, "music.wav");
    await ffmpeg(["-i", MUSIC, "-filter_complex",
      `[0:a]atrim=start=${off.toFixed(3)}:duration=${gapA.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05,afade=t=out:st=${(gapA - 0.06).toFixed(3)}:d=0.06[a];` +
      `anullsrc=r=44100:cl=stereo,atrim=duration=${BEAT.toFixed(3)}[g];` +
      `[0:a]atrim=start=${(off + endAt).toFixed(3)}:duration=${(total - endAt).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${(total - endAt - 1.6).toFixed(3)}:d=1.6[e];` +
      `[a]aresample=44100,aformat=channel_layouts=stereo[a2];[e]aresample=44100,aformat=channel_layouts=stereo[e2];[a2][g][e2]concat=n=3:v=0:a=1,loudnorm=I=-14:TP=-1.5:LRA=11[out]`,
      "-map", "[out]", "-ar", "44100", wav]);
    for (const [key, silent] of Object.entries(outs)) {
      const out = path.join(OUT, `morse-v3-${key}.mp4`);
      await ffmpeg(["-i", silent, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out]);
      log(`${path.basename(out)}: ${probe(out).toFixed(2)}s, ${mb(out)}`);
    }
  } else log("no MUSIC: made the no-music versions only");

  // A poster (the new look, landed) and the hook as a GIF.
  const v = outs["16x9"];
  const posterAt = plans[0].p.at(plans[0].m.marks[plans[0].seg.anchor?.mark] ?? plans[0].m.marks.start) + 1.0;
  await ffmpeg(["-ss", posterAt.toFixed(2), "-i", v, "-frames:v", "1", "-update", "1", "-vf", "scale=1280:-2:flags=lanczos", path.join(OUT, "poster-v3.png")]);
  log(`poster-v3.png: ${mb(path.join(OUT, "poster-v3.png"))}`);
  const gif = path.join(OUT, "morse-v3-hook.gif");
  const gifLen = Math.min(8, plans[0].p.D + 1.2);
  for (const [w, fps, colors] of [[720, 15, 160], [640, 12, 128], [560, 12, 96], [480, 10, 64]]) {
    await ffmpeg(["-t", gifLen.toFixed(2), "-i", v, "-vf", `fps=${fps},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
    if (statSync(gif).size <= 4.9e6) break;
  }
  log(`morse-v3-hook.gif: ${gifLen.toFixed(1)}s, ${mb(gif)}`);
  await fs.writeFile(path.join(WORK, "edit-plan.json"), JSON.stringify(plans.map(({ seg, m, p, t0 }) => ({ scene: seg.scene, t0, dur: p.D, beats: seg.beats, from: p.from - m.marks.start, windows: p.windows })), null, 1));
}
