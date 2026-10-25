// The desktop connector in a process of its own, so its memory is its own:
// demo/soak/desktop.js and mods.js start it with --expose-gc and drive it over
// IPC ("start", "stop", "stats"). Counts the CDP sessions it opens and closes.
import { promises as fs } from "node:fs";
import path from "node:path";
import { CDPSession } from "../../daemon/cdp.js";

let open = 0, opened = 0;
const connect = CDPSession.connect;
CDPSession.connect = async url => {
  const s = await connect.call(CDPSession, url);
  open++; opened++;
  s.ws.addEventListener("close", () => open--, { once: true });
  return s;
};
// SOAK_NO_CLIP=1: no screencast while the bar is open (to see what recording clips costs)
if (process.env.SOAK_NO_CLIP === "1") {
  const { Recorder } = await import("../../daemon/record.js");
  Recorder.prototype.start = async function () {};
  Recorder.prototype.stop = function () { this.stopped = true; };
}
const { Connector } = await import("../../daemon/connector.js");
const { HOME } = await import("../../daemon/store.js");

let conn = null, running = null, logs = { total: 0, crashes: 0, couldnt: 0, last: [] };
const log = l => {
  logs.total++;
  if (/stopped working/.test(l)) logs.crashes++;
  if (/Couldn't connect|didn't connect/.test(l)) logs.couldnt++;
  logs.last.push(String(l).trim());
  if (logs.last.length > 20) logs.last.shift();
};

async function dirStats(dir) {
  let files = 0, bytes = 0;
  async function walk(d) {
    let list = [];
    try { list = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { files++; try { bytes += (await fs.stat(p)).size; } catch {} }
    }
  }
  await walk(dir);
  return { files, kb: Math.round(bytes / 1024) };
}

process.on("message", async m => {
  const reply = (data = {}) => process.send({ re: m.id, ...data });
  try {
    if (m.type === "start") {
      conn = new Connector({ port: m.port, app: null, settings: { provider: "demo", model: "demo", ...(m.demoMs != null ? { demoMs: m.demoMs } : {}) }, log, interval: m.interval || 500 });
      running = conn.run();
      reply();
    } else if (m.type === "stop") {
      await conn?.stop();
      await running;
      conn = null;
      reply();
    } else if (m.type === "stats") {
      global.gc?.();
      const mem = process.memoryUsage();
      const ws = conn ? [...conn.windows.values()] : [];
      const sum = f => ws.reduce((a, w) => a + (f(w) || 0), 0);
      reply({
        stats: {
          rssMB: +(mem.rss / 1048576).toFixed(1), heapMB: +(mem.heapUsed / 1048576).toFixed(2), externalMB: +(mem.external / 1048576).toFixed(2),
          cdpOpen: open, cdpOpened: opened, windows: conn?.windows.size ?? 0, pages: conn?.pages.size ?? 0,
          retry: conn?.retry.size ?? 0, recentSaves: conn?.recentSaves.size ?? 0, gens: conn?.gens.size ?? 0, granted: conn?.granted?.size ?? 0,
          hangLast: sum(w => w.session?.hang?.last?.size), hangStopped: sum(w => w.session?.hang?.stopped?.size),
          frames: sum(w => w.frames?.size), handlers: sum(w => [...(w.session?.handlers?.values() || [])].reduce((a, l) => a + l.length, 0)),
          pendingCdp: sum(w => w.session?.pending?.size),
          recorderFrames: conn?.recorder?.frames?.length ?? 0,
          handles: process._getActiveHandles?.().length ?? null,
          clips: await dirStats(path.join(HOME, "clips")),
          logs: { total: logs.total, crashes: logs.crashes, couldnt: logs.couldnt },
        },
        state: conn?.state || "stopped",
        lastLogs: logs.last,
      });
    } else if (m.type === "exit") {
      await conn?.stop().catch(() => {});
      reply();
      process.exit(0);
    }
  } catch (e) { reply({ error: e.message }); }
});
process.send({ ready: true });
