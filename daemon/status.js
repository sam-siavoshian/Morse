// What Morse is attached to right now. Every `morse launch` / `morse attach`
// process keeps a small file in ~/.morse/sessions/<app>.json up to date;
// `morse status` reads them and `morse stop <app>` asks one to detach.

import { promises as fs, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { HOME, modsFor, renameOver } from "./store.js";
import { describeTarget } from "./targets.js";
import { matchApp } from "./apps.js";
import { paint, shown } from "./colors.js";

const DIR = () => path.join(HOME, "sessions");
const file = id => path.join(DIR(), `${String(id).replace(/[^a-z0-9_-]/gi, "")}.json`);
const stopFile = id => file(id).replace(/\.json$/, ".stop");

export const isAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export async function writeSession(s) {
  await fs.mkdir(DIR(), { recursive: true });
  const tmp = `${file(s.id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...s, updated: new Date().toISOString() }, null, 2));
  await renameOver(tmp, file(s.id)); // Windows: retries while a reader has it open
}

export function removeSession(id) {
  for (const f of [file(id), stopFile(id)]) { try { rmSync(f, { force: true }); } catch {} }
}

// Sessions whose Morse process is still running. Leftovers from a crash are removed.
export async function readSessions() {
  let names = [];
  try { names = await fs.readdir(DIR()); } catch { return []; }
  const out = [];
  for (const n of names.filter(n => n.endsWith(".json"))) {
    let s;
    try { s = JSON.parse(await fs.readFile(path.join(DIR(), n), "utf8")); } catch { continue; }
    if (!s?.pid || !isAlive(s.pid)) { removeSession(n.replace(/\.json$/, "")); continue; }
    out.push(s);
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function stopRequested(id) { return existsSync(stopFile(id)); }

// Keeps the session file in step with a Connector.
export function publishSession(connector, info) {
  let timer = null, writing = Promise.resolve(), closed = false;
  const snapshot = () => ({
    ...info,
    pid: process.pid,
    port: connector.port,
    state: connector.state,
    watch: !!connector.watch,
    windows: [...connector.windows.values()].map(w => ({
      id: w.id, type: w.type, kind: w.kind, url: w.url, since: w.since,
      title: w.title && w.title !== w.url ? w.title : w.docTitle || w.title,
    })),
  });
  // Nothing is written once closed: a window that detaches late (Morse Desktop
  // keeps running after a disconnect) must not bring the file back.
  const flush = () => { if (!closed) writing = writing.then(() => (closed ? null : writeSession(snapshot()))).catch(() => {}); return writing; };
  const schedule = () => { if (closed) return; clearTimeout(timer); timer = setTimeout(flush, 150); };
  const beat = setInterval(flush, 5000);
  beat.unref?.();
  return {
    changed: schedule,
    flush,
    async close() { closed = true; clearInterval(beat); clearTimeout(timer); await writing; removeSession(info.id); },
  };
}

// `morse stop <app>`: ask the session to detach, wait, and if it doesn't, end it.
export async function stopSession(query, { wait = 6000 } = {}) {
  const sessions = await readSessions();
  if (!sessions.length) return { stopped: [], message: "Morse isn't connected to any app." };
  let pick = sessions;
  if (query && query !== "all" && query !== "--all") {
    const m = matchApp(query, sessions.map(s => ({ ...s, aliases: s.aliases || [] })));
    if (m.ambiguous) return { stopped: [], message: `"${query}" could be ${m.ambiguous.map(a => a.name).join(" or ")}. Say which one.` };
    if (!m.app) return { stopped: [], message: `Morse isn't connected to "${query}". Connected: ${sessions.map(s => s.name).join(", ")}.` };
    pick = [m.app];
  } else if (!query && sessions.length > 1) {
    return { stopped: [], message: `Morse is connected to ${sessions.map(s => s.name).join(", ")}. Say which one, or morse stop all.` };
  }
  const stopped = [];
  for (const s of pick) {
    await fs.mkdir(DIR(), { recursive: true });
    await fs.writeFile(stopFile(s.id), String(Date.now()));
    const end = Date.now() + wait;
    while (Date.now() < end && isAlive(s.pid) && existsSync(file(s.id))) await new Promise(r => setTimeout(r, 150));
    if (isAlive(s.pid) && existsSync(file(s.id))) { try { process.kill(s.pid, "SIGTERM"); } catch {} removeSession(s.id); }
    stopped.push(s);
  }
  return { stopped };
}

// ---------------------------------------------------------------- output
const C = paint;
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
const ago = iso => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};

// Mods that apply to each window, as the runtime there sees them.
export async function withMods(sessions) {
  for (const s of sessions) for (const w of s.windows || []) {
    const app = "modsApp" in s ? s.modsApp : s.id;
    w.mods = (await modsFor({ url: w.url, app }).catch(() => [])).filter(m => m.enabled).map(m => m.title);
  }
  return sessions;
}

export function formatStatus(sessions) {
  if (!sessions.length) return `Morse isn't connected to any app. Start one with ${C.b("morse launch <app>")} (see ${C.b("morse apps")}).`;
  const out = [];
  for (const s of sessions) {
    const where = `port ${s.port} ${C.d("(this computer only)")}`;
    const state = s.state === "attached" ? C.g("● connected") : s.state === "waiting" ? C.d(`○ waiting for ${s.name} to open again`) : C.d(`○ ${s.state}`);
    out.push(`${C.b(s.name)}  ${state} · ${where}${s.started ? C.d(` · ${ago(s.started)}`) : ""}`);
    if (s.browser) out.push(C.d(`  ${String(s.browser).replace("/", " ")}${s.electron ? ` · Electron ${s.electron}` : ""}${s.watch ? " · --watch" : ""}`));
    const wins = s.windows || [];
    if (s.state === "attached" && !wins.length) out.push(C.d("  no windows yet"));
    for (const w of wins) {
      const { kind, title } = describeTarget(w);
      // A window's title is the app's page's to set, and a mod's title the mod's.
      out.push(`  ${C.d(pad(kind, 8))}${pad(shown(title), 34)}${C.d(shown(shortUrl(w.url)))}`);
      out.push(`  ${" ".repeat(8)}${w.mods?.length ? `${C.g("mods on:")} ${w.mods.map(shown).join(", ")}` : C.d("no mods here yet")}`);
    }
    out.push("");
  }
  out.push(C.d(`morse stop <app> disconnects · morse launch <app> --watch connects again after the app restarts`));
  return out.join("\n");
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    const s = x.protocol.startsWith("http") ? x.host + x.pathname : `${x.protocol}//${x.host}${x.pathname}`;
    return s.length > 48 ? s.slice(0, 47) + "…" : s;
  } catch { return u || ""; }
}
