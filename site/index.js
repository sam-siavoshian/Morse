import { initPage, modCard, highlight, slugOf } from "./common.js";
import { radar } from "./radar.js";
import { encodeShare, stripLocal } from "../core/mod.js";

initPage();
radar(document.getElementById("step-px"), { size: 48 });

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================================
// The demo: a pure CSS/JS simulation of Morse's core loop. Nothing here talks
// to a model; the "tokens" are a fixed string streamed at a model-like pace.
// ============================================================================
const $ = id => document.getElementById(id);
const win = document.querySelector(".win");
const target = $("demo-target");
const hl = $("demo-hl");
const fx = $("demo-fx");
const cursor = $("demo-cursor");
const typed = $("demo-typed");
const codeEl = $("demo-code");
const timeEl = $("demo-time");
const leftEl = $("demo-left");
const enter = $("demo-enter");

const REQUEST = "add a sleep timer";
const CODE = `TITLE: Sleep timer \`\`\`css .morse-sleep { background: none; border: 0; color: inherit; cursor: pointer; } .morse-sleep.on { color: var(--accent); } .morse-sleep span { position: absolute; bottom: 22px; font: 600 10px/1 monospace; } \`\`\` \`\`\`js morse.watch('[data-testid="control-button-repeat"]', repeat => { const label = morse.el("span"); const btn = morse.el("button", { class: "morse-sleep", title: "Sleep timer", on: { click() { left = next() * 60; render(); morse.toast("Pausing in 15 minutes"); } } }); morse.every(1000, tick); repeat.after(btn); }); \`\`\``;

let rect = { x: 0, y: 0, w: 0, h: 0 };
function place() {
  const w = win.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  rect = { x: r.left - w.left - 1, y: r.top - w.top - 1, w: r.width, h: r.height };
  for (const el of [hl, fx]) Object.assign(el.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px" });
  const dpr = Math.min(devicePixelRatio || 1, 2);
  fx.width = Math.round(rect.w * dpr);
  fx.height = Math.round(rect.h * dpr);
  fx.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}
function moveCursor(x, y) { cursor.style.transform = `translate(${x}px, ${y}px)`; }
function setState(s) { win.dataset.state = s; }

// ---- pixel effect: the target dissolves into a grid; tokens fall through it as glyphs
const CELL = 10, GAP = 2;
let cells = [], glyphs = [], sweepX = -1, raf = 0;
function buildCells() {
  cells = [];
  const cols = Math.ceil(rect.w / CELL), rows = Math.ceil(rect.h / CELL);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    cells.push({ x: c * CELL, y: r * CELL, phase: Math.random() * Math.PI * 2, speed: 1.5 + Math.random() * 2.5, base: Math.random() });
  }
}
function colors() {
  const cs = getComputedStyle(win);
  return { bg: cs.getPropertyValue("--m-surface").trim() || "#111", px: cs.getPropertyValue("--m-text").trim() || "#eee" };
}
function frame(t) {
  const ctx = fx.getContext("2d");
  const { bg, px } = colors();
  ctx.clearRect(0, 0, rect.w, rect.h);
  const from = Math.max(0, sweepX);
  ctx.fillStyle = bg;
  ctx.fillRect(from, 0, rect.w - from, rect.h);
  ctx.fillStyle = px;
  for (const c of cells) {
    if (c.x + CELL <= sweepX) continue;
    const a = 0.08 + 0.3 * (0.5 + 0.5 * Math.sin(t / 1000 * c.speed + c.phase)) * (0.4 + c.base * 0.6);
    ctx.globalAlpha = a;
    roundRect(ctx, c.x + GAP / 2, c.y + GAP / 2, CELL - GAP, CELL - GAP, 2);
  }
  ctx.font = `600 9px ${getComputedStyle(document.body).getPropertyValue("--m-mono")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  glyphs = glyphs.filter(g => t - g.born < 900);
  for (const g of glyphs) {
    if (g.x <= sweepX) continue;
    const age = (t - g.born) / 900;
    ctx.globalAlpha = Math.max(0, 1 - age) * 0.95;
    ctx.fillText(g.ch, g.x + CELL / 2, g.y + CELL / 2 + age * 6);
  }
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fill();
}
function startFx() { cancelAnimationFrame(raf); buildCells(); glyphs = []; sweepX = -1; raf = requestAnimationFrame(frame); }
function stopFx() { cancelAnimationFrame(raf); raf = 0; fx.getContext("2d").clearRect(0, 0, rect.w, rect.h); }
function dropGlyphs(text) {
  for (const ch of text) {
    if (!ch.trim() || !cells.length) continue;
    const c = cells[(Math.random() * cells.length) | 0];
    glyphs.push({ ch, x: c.x, y: c.y, born: performance.now() });
  }
}

// ---- timeline
let run = 0, visible = true, countdown = 0;
const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
io.observe(win);
const waitVisible = async alive => { while (alive() && (!visible || document.hidden)) await sleep(300); };

function reset() {
  clearInterval(countdown);
  stopFx();
  setState("idle");
  win.classList.remove("has-sleep", "toast", "sweeping");
  typed.textContent = "";
  codeEl.textContent = "";
  timeEl.textContent = "0.0s";
  leftEl.textContent = "15:00";
  enter.classList.remove("press");
  place();
  moveCursor(win.clientWidth * 0.66, win.clientHeight * 0.34);
}

function showDone() {
  setState("done");
  win.classList.add("has-sleep");
  let left = 15 * 60;
  clearInterval(countdown);
  countdown = setInterval(() => {
    left--;
    leftEl.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
  }, 1000);
}

async function play({ loop = !reduced } = {}) {
  const id = ++run;
  const alive = () => id === run;
  reset();
  await waitVisible(alive);
  await sleep(700);
  if (!alive()) return;

  // 1. point
  place();
  moveCursor(rect.x + rect.w * 0.62, rect.y + rect.h * 0.55);
  await sleep(1000); if (!alive()) return;
  setState("point");
  await sleep(800); if (!alive()) return;

  // 2. say it
  cursor.classList.remove("click"); void cursor.offsetWidth; cursor.classList.add("click");
  setState("type");
  await sleep(450);
  for (const ch of REQUEST) {
    if (!alive()) return;
    typed.textContent += ch;
    await sleep(42 + Math.random() * 60);
  }
  await sleep(420); if (!alive()) return;
  enter.classList.add("press");
  await sleep(180);

  // 3. the model streams; the target dissolves into the grid
  setState("work");
  place();
  startFx();
  const t0 = performance.now();
  let i = 0;
  while (i < CODE.length) {
    if (!alive()) { stopFx(); return; }
    const n = 2 + ((Math.random() * 5) | 0);
    const chunk = CODE.slice(i, i + n);
    i += n;
    dropGlyphs(chunk);
    const max = Math.max(12, Math.floor(codeEl.clientWidth / 6.6));
    codeEl.textContent = CODE.slice(Math.max(0, i - max), i);
    timeEl.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s";
    await sleep(34);
  }
  // 4. the grid sweeps away to reveal the change
  win.classList.add("has-sleep");
  win.classList.add("sweeping");
  const s0 = performance.now();
  while (sweepX < rect.w) {
    if (!alive()) { stopFx(); return; }
    sweepX = ((performance.now() - s0) / 520) * rect.w;
    await sleep(16);
  }
  stopFx();
  win.classList.remove("sweeping");
  showDone();
  await sleep(500); if (!alive()) return;
  win.classList.add("toast");
  await sleep(2400);
  win.classList.remove("toast");
  if (!loop) return;
  await sleep(3000); if (!alive()) return;
  setState("idle");
  await sleep(1800); if (!alive()) return;
  play();
}

$("demo-replay").addEventListener("click", () => play({ loop: !reduced }));
addEventListener("resize", () => { if (win.dataset.state !== "work") place(); });

if (reduced) {
  // Show the end state; the Replay button runs the animation on request.
  reset();
  showDone();
  clearInterval(countdown);
} else {
  play();
}

// ============================================================================
// Sharing section: a real share fragment and the mod it carries.
// Featured gallery cards.
// ============================================================================
(async () => {
  try {
    const index = await (await fetch("mods/index.json")).json();
    const featured = ["youtube-hide-shorts", "chatgpt-word-count", "notion-focus-mode"];
    const box = $("featured");
    for (const slug of featured) {
      const entry = index.find(e => slugOf(e) === slug);
      if (entry) box.append(modCard(entry, { href: `gallery.html#${slug}` }));
    }

    const mod = await (await fetch("mods/spotify-sleep-timer.morse.json")).json();
    const link = await encodeShare(mod);
    $("share-frag").textContent = link.split("#m=")[1];
    const cut = s => s.length > 56 ? s.slice(0, 56) + "…" : s;
    const shown = { ...stripLocal(mod), css: cut(mod.css), js: cut(mod.js) };
    delete shown.updated;
    $("share-json").innerHTML = highlight(JSON.stringify(shown, null, 2), "json");
  } catch (e) {
    console.warn("[morse site]", e);
  }
})();
