// A stand-in for an Electron app started with --remote-debugging-pipe:
// it reads CDP messages (JSON + a null byte) on fd 3 and answers on fd 4,
// with one window and one frame, and flat sessions (Target.attachToTarget).
// Anything else gets an empty result, which is enough for the connector.
// Writes what it sees to --fake-log=<file>, one line each:
//   flags <octal>     fd 3's file flags as the app got them (/proc, Linux)
//   got <method>      a message (with " @<sessionId>" for a target's)
//   eof               fd 3 read an end of file (Electron 12+ would quit here)
//   alive             still running, once a second
// --fake-mode=ignore never reads the pipe (like Electron 9); =die exits at once.
// Test.closeTarget makes it detach the window's session, as when a window closes.
import { appendFileSync, readFileSync } from "node:fs";
import net from "node:net";

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const logFile = arg("fake-log");
const log = line => { if (logFile) appendFileSync(logFile, line + "\n"); };
const mode = arg("fake-mode") || "answer";

if (mode === "die") process.exit(3);
setInterval(() => log("alive"), 1000);
if (mode === "ignore") log("ignoring the pipe");
else {
  // Before Node touches it (it makes its own sockets non-blocking).
  try { log(`flags ${/flags:\s*(\d+)/.exec(readFileSync("/proc/self/fdinfo/3", "utf8"))?.[1]}`); } catch {}
  const input = new net.Socket({ fd: 3, readable: true, writable: false });
  const output = new net.Socket({ fd: 4, readable: false, writable: true });
  output.on("error", () => log("write failed"));
  const send = msg => output.write(JSON.stringify(msg) + "\0");
  const WINDOW = { targetId: "W1", type: "page", title: "Fake window", url: "https://app.fake.test/", attached: false, browserContextId: "C1" };
  const FRAME = { targetId: "F1", type: "iframe", title: "", url: "https://files.fake.test/x", parentFrameId: "W1", attached: false, browserContextId: "C1" };
  const sessions = new Map(); // sessionId -> targetId
  let n = 0, text = "";
  const reply = m => {
    const r = (result) => send({ id: m.id, result, ...(m.sessionId && { sessionId: m.sessionId }) });
    switch (m.method) {
      case "Browser.getVersion": return r({ protocolVersion: "1.3", product: "Chrome/140.0.0.0", userAgent: "Mozilla/5.0 Fake/1.0 Chrome/140.0.0.0 Electron/40.1.0 Safari/537.36" });
      case "SystemInfo.getProcessInfo": return r({ processInfo: [{ type: "browser", id: process.pid, cpuTime: 0 }] });
      case "Target.getTargets": return r({ targetInfos: [WINDOW, FRAME] });
      case "Target.attachToTarget": {
        const sessionId = `S${++n}`;
        sessions.set(sessionId, m.params.targetId);
        send({ method: "Target.attachedToTarget", params: { sessionId, targetInfo: m.params.targetId === "F1" ? FRAME : WINDOW, waitingForDebugger: false } });
        return r({ sessionId });
      }
      case "Target.detachFromTarget": sessions.delete(m.params.sessionId); return r({});
      case "Test.closeTarget": {
        for (const [sessionId, t] of sessions) if (t === "W1") { sessions.delete(sessionId); send({ method: "Target.detachedFromTarget", params: { sessionId, targetId: t } }); }
        return r({});
      }
      case "Runtime.evaluate": return r({ result: { type: "string", value: `evaluated in ${sessions.get(m.sessionId) || "the browser"}: ${m.params.expression}` } });
      case "Page.getFrameTree": return r({ frameTree: { frame: { id: sessions.get(m.sessionId) || "W1" } } });
      default: return r({});
    }
  };
  input.on("data", d => {
    text += d;
    let i;
    while ((i = text.indexOf("\0")) >= 0) {
      const m = JSON.parse(text.slice(0, i));
      text = text.slice(i + 1);
      log(`got ${m.method}${m.sessionId ? ` @${m.sessionId}` : ""}`);
      reply(m);
    }
  });
  input.on("end", () => { log("eof"); process.exit(0); });
}
