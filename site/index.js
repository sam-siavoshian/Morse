import { initPage, highlight } from "./common.js";
import { radar } from "./radar.js";
import { encodeShare, stripLocal } from "../core/mod.js";

initPage();
radar(document.getElementById("step-px"), { size: 48 });

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);

// ============================================================================
// Sharing section: a real share fragment and the mod it carries.
// ============================================================================
(async () => {
  try {
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

// ============================================================================
// Voice: a radar-pixel level meter and a transcript that arrives word by word.
// ============================================================================
(() => {
  const meter = $("voice-meter"), said = $("voice-said");
  if (!meter || !said) return;
  const px = [];
  for (let i = 0; i < 25; i++) px.push(meter.appendChild(document.createElement("i")));
  const LINES = ["hide the trending sidebar", "make the reading column narrower", "add a word count under the composer"];
  let on = false;
  new IntersectionObserver(([e]) => { on = e.isIntersecting; }).observe(meter);
  const draw = level => {
    for (let c = 0; c < 5; c++) {
      const h = Math.max(1, Math.round(level * (c === 2 ? 5 : c % 2 ? 4 : 3) * (0.6 + Math.random() * 0.4)));
      for (let r = 0; r < 5; r++) px[r * 5 + c].style.opacity = 4 - r < h ? (r === 4 ? 1 : 0.85 - (4 - r) * 0.12) : 0.12;
    }
  };
  if (reduced) { said.textContent = LINES[0]; draw(0.7); return; }
  let level = 0, talking = false;
  setInterval(() => {
    if (!on) return;
    level += ((talking ? 0.35 + Math.random() * 0.65 : 0.05) - level) * 0.5;
    draw(level);
  }, 90);
  (async () => {
    for (let n = 0; ; n++) {
      while (!on) await sleep(400);
      said.textContent = "";
      talking = true;
      for (const w of LINES[n % LINES.length].split(" ")) {
        said.textContent += (said.textContent ? " " : "") + w;
        await sleep(260 + Math.random() * 260);
      }
      talking = false;
      await sleep(2200);
    }
  })();
})();
