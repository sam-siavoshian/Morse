// Turns soak results (the JSON files the scenarios write with --out) into the
// markdown in docs/perf/soak.md, and says what grew.
//   node demo/soak/report.js after.json [before.json]
import { promises as fs } from "node:fs";
import { growth, drift, table, stepTable } from "./lib.js";

// What each scenario watches, and how much a series may move before it
// counts as growing (noise: GC timing, a toast, a mod being saved).
export const SERIES = {
  extension: {
    series: ["parley.heapMB", "parley.nodes", "parley.listeners", "parley.winListeners", "parley.docListeners", "parley.worlds.runtime.mo", "parley.worlds.runtime.detached",
      "parley.worlds.mods.mo", "byte.heapMB", "byte.nodes", "tunes.heapMB", "tunes.nodes", "sw.heapMB", "sw.storageKB", "sw.mods"],
    tolerance: { "*": 0, "parley.heapMB": 1.5, "byte.heapMB": 1.5, "tunes.heapMB": 1.5, "parley.nodes": 400, "byte.nodes": 400, "tunes.nodes": 400, "parley.listeners": 30,
      "parley.winListeners": 2, "parley.docListeners": 2, "parley.worlds.runtime.mo": 6, "parley.worlds.runtime.detached": 60, "parley.worlds.mods.mo": 4, "sw.heapMB": 1, "sw.storageKB": 40, "sw.mods": 12 },
  },
  desktop: {
    series: ["main.heapMB", "main.nodes", "main.listeners", "main.winListeners", "main.worlds.runtime.mo", "main.worlds.runtime.detached", "second.heapMB", "second.nodes",
      "daemon.rssMB", "daemon.heapMB", "daemon.cdpOpen", "daemon.windows", "daemon.pendingCdp", "daemon.hangLast", "daemon.handles", "daemon.clips.files", "daemon.clips.kb"],
    tolerance: { "*": 0, "main.heapMB": 1.5, "second.heapMB": 1.5, "main.nodes": 400, "second.nodes": 400, "main.listeners": 30, "main.winListeners": 2, "main.worlds.runtime.mo": 6,
      "main.worlds.runtime.detached": 60, "daemon.rssMB": 25, "daemon.heapMB": 4, "daemon.pendingCdp": 3, "daemon.hangLast": 4, "daemon.handles": 4, "daemon.clips.files": 60, "daemon.clips.kb": 12000, "daemon.cdpOpen": 1, "daemon.windows": 1 },
  },
  "mods at scale": {
    series: ["page.heapMB", "page.nodes", "page.listeners", "page.main.mo", "page.main.detached", "page.worlds.runtime.mo", "page.worlds.runtime.detached", "kit.paused", "kit.errors", "pulse.lagMs", "daemon.rssMB", "daemon.heapMB"],
    tolerance: { "*": 0, "page.heapMB": 1.5, "page.nodes": 300, "page.listeners": 40, "page.main.mo": 40, "page.main.detached": 60, "page.worlds.runtime.mo": 4, "page.worlds.runtime.detached": 40, "pulse.lagMs": 80, "daemon.rssMB": 25, "daemon.heapMB": 4 },
  },
};
SERIES["extension + service worker restarts"] = SERIES.extension;

export function verdict(r) {
  const spec = SERIES[r.name];
  const g = growth(r.samples, spec.series, spec.tolerance);
  const d = drift(r.iterations);
  const grows = Object.entries(g).filter(([, v]) => v.grows).map(([k]) => k);
  return { growth: g, drift: d, grows, wedged: (r.meta?.maxFailStreak || 0) >= 3 };
}

function errorSummary(errors) {
  const by = new Map();
  for (const e of errors) { const k = `${e.where} · ${e.world} · ${e.kind}: ${e.text}`; by.set(k, (by.get(k) || 0) + 1); }
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

export function section(r, label) {
  const v = verdict(r);
  const mins = ((r.ended - r.started) / 60000).toFixed(1);
  const lines = [`#### ${label}: ${r.iterations.length} iterations in ${mins} minutes`, ""];
  lines.push(table(r.samples, SERIES[r.name].series, v.growth), "");
  if (v.drift) lines.push(`Iteration time (median): first third ${v.drift.first} ms, last third ${v.drift.last} ms${v.drift.drifts ? " **drifts**" : ""}.`, "");
  lines.push(`Grows without bound: ${v.grows.length ? v.grows.map(k => `\`${k}\``).join(", ") : "nothing"}. Longest run of failing iterations: ${r.meta?.maxFailStreak ?? 0}${v.wedged ? " (wedged)" : ""}.`, "");
  if (r.steps) lines.push("<details><summary>Steps</summary>", "", stepTable(r.steps, r.fails), "", "</details>", "");
  const errs = errorSummary(r.errors || []);
  lines.push(errs.length ? `Console errors and unhandled rejections (${r.errors.length}):\n\n${errs.map(([k, n]) => `- ${n}× ${k.replace(/\|/g, "\\|")}`).join("\n")}` : "Console errors and unhandled rejections: none.", "");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of process.argv.slice(2)) {
    const r = JSON.parse(await fs.readFile(f, "utf8"));
    console.log(section(r, `${r.name} (${f.split("/").pop()})`));
  }
}
