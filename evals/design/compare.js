#!/usr/bin/env node
// Before and after pictures for the README: for each case, the part of the
// app the versions changed (the same area for all of them), before and after
// each arm, side by side with labels, as one JPEG in evals/design/shots/.
//
//   node evals/design/compare.js evals/design/results/<file>.json vsc-pomodoro,jop-pomodoro [--arms baseline,context,polish]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [file, ids, ...rest] = process.argv.slice(2);
const armsArg = rest[rest.indexOf("--arms") + 1];
const saved = JSON.parse(readFileSync(file, "utf8"));
const arms = rest.includes("--arms") ? armsArg.split(",") : saved.arms;
const out = path.join(HERE, "shots");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const id of ids.split(",")) {
  const recs = arms.map(a => saved.results.find(r => r.id === id && r.arm === a)).filter(Boolean);
  const as = recs.map(r => r.area).filter(Boolean);
  if (!as.length) continue;
  const x0 = Math.min(...as.map(a => a.x)), y0 = Math.min(...as.map(a => a.y));
  const area = { x: x0, y: y0, width: Math.max(...as.map(a => a.x + a.width)) - x0, height: Math.max(...as.map(a => a.y + a.height)) - y0 };
  const tiles = [["before", recs[0].shots.before], ...recs.map(r => [`${r.arm}${r.judge ? ` · ${r.judge.mean}` : ""}`, r.shots.after])].filter(([, f]) => f && existsSync(f));
  const data = tiles.map(([label, f]) => [label, `data:image/jpeg;base64,${readFileSync(f).toString("base64")}`]);
  const jpeg = await page.evaluate(async ([tiles, a]) => {
    const wide = a.width > a.height * 3; // a bar: one per row, bigger
    const k = Math.min(1, (wide ? 1100 : 640) / a.width, 420 / a.height), w = Math.round(a.width * k), h = Math.round(a.height * k), pad = 26;
    const cols = wide ? 1 : tiles.length > 4 ? 3 : 2, rows = Math.ceil(tiles.length / cols);
    const cv = document.createElement("canvas");
    cv.width = cols * w + (cols + 1) * 8; cv.height = rows * (h + pad) + (rows + 1) * 8;
    const g = cv.getContext("2d");
    g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, cv.width, cv.height);
    for (const [i, [label, src]] of tiles.entries()) {
      const img = new Image(); img.src = src; await img.decode();
      const cx = 8 + (i % cols) * (w + 8), cy = 8 + Math.floor(i / cols) * (h + pad + 8);
      g.fillStyle = "#222"; g.font = "600 15px sans-serif"; g.fillText(label, cx + 2, cy + 17);
      g.drawImage(img, a.x, a.y, a.width, a.height, cx, cy + pad, w, h);
      g.strokeStyle = "#bbb"; g.strokeRect(cx + 0.5, cy + pad + 0.5, w - 1, h - 1);
    }
    return cv.toDataURL("image/jpeg", 0.82).split(",")[1];
  }, [data, area]);
  writeFileSync(path.join(out, `${id}.jpg`), Buffer.from(jpeg, "base64"));
  console.log("wrote", path.join("evals/design/shots", `${id}.jpg`));
}
await browser.close();
