// Minimal Chrome DevTools Protocol client, over two transports:
//
//   - a debugging port (--remote-debugging-port): HTTP for the target list,
//     one WebSocket per target. Any local program can use a port, so Morse
//     only uses one to reach an app it didn't start (morse attach, an app
//     already open with a port) and apps the pipe doesn't work for.
//   - a private pipe (--remote-debugging-pipe, Electron 10 and later): CDP as
//     JSON messages ending in a null byte, written to the app's file
//     descriptor 3 and read from its descriptor 4. Only the process that
//     started the app holds the other ends, so nothing else on the computer
//     can connect. One connection carries every target (Target.attachToTarget
//     with flatten: true and a sessionId on each message).
//
// The connector sees the same thing either way: a "browser" with
// listTargets() (entries shaped like /json/list) and connect(target), which
// resolves a session with send / on / off / close and a "close" event.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

// ---------------------------------------------------------------- a debugging port

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) }).catch(e => { throw appTimeout(e, port); });
  return res.json();
}

// A busy or still-starting app that doesn't answer its debugging port in time
// says so in plain words. Left alone, "The operation was aborted due to
// timeout" reads as the model being slow (core/onboarding.js plainError).
export function appTimeout(e, port) {
  if (e?.name !== "TimeoutError") return e;
  return Object.assign(new Error(`The app didn't answer Morse in time (port ${port}). It may still be starting, or the computer is busy: try again.`), { plain: true, cause: e });
}

export async function waitForEndpoint(port, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).json(); }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error(`Morse couldn't connect to the app on port ${port}. The app may not allow it (it blocks --remote-debugging-port).`);
}

// What sessions share: numbered requests and their answers, events by name,
// and a "close" event once (every request still waiting is rejected).
class Session {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session closed"));
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try { this.write({ id, method, params }); } catch (e) { this.pending.delete(id); reject(e); }
    });
  }
  nextId() { return ++this.seq; }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  off(event, fn) {
    const list = this.handlers.get(event);
    if (list) this.handlers.set(event, list.filter(f => f !== fn));
  }
  emit(event, params) { for (const fn of this.handlers.get(event) || []) { try { fn(params); } catch {} } }
  dispatch(msg) {
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
    } else if (msg.method) this.emit(msg.method, msg.params);
  }
  ended() {
    if (this.over) return;
    this.over = this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error("CDP session closed"));
    this.pending.clear();
    this.emit("close");
  }
}

// One target over its own WebSocket (a debugging port).
export class CDPSession extends Session {
  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const s = new CDPSession(ws);
      ws.addEventListener("open", () => resolve(s), { once: true });
      ws.addEventListener("error", () => reject(new Error(`Could not connect to ${wsUrl}`)), { once: true });
    });
  }
  constructor(ws) {
    super();
    this.ws = ws;
    ws.addEventListener("message", e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.dispatch(m); });
    ws.addEventListener("close", () => this.ended());
  }
  write(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { try { this.ws.close(); } catch {} }
}

// The connector's view of an app on a debugging port.
export function portBrowser(port) {
  return {
    kind: "port",
    port,
    listTargets: () => listTargets(port),
    connect: target => CDPSession.connect(target.webSocketDebuggerUrl),
    close() {},
  };
}

// ---------------------------------------------------------------- a private pipe

// Chromium's pipe format: one JSON message, then a null byte.
export const frame = msg => JSON.stringify(msg) + "\0";

// Splits what comes out of the pipe back into messages. Chunks can end in
// the middle of a message, or of a character.
export class Unframer {
  constructor() { this.text = ""; this.decoder = new StringDecoder("utf8"); }
  push(chunk) {
    this.text += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const out = [];
    let i;
    while ((i = this.text.indexOf("\0")) >= 0) {
      const one = this.text.slice(0, i);
      this.text = this.text.slice(i + 1);
      try { out.push(JSON.parse(one)); } catch {}
    }
    return out;
  }
}

// One target over the pipe: Target.attachToTarget's flat session.
class PipeSession extends Session {
  constructor(conn, sessionId) { super(); this.conn = conn; this.sessionId = sessionId; }
  nextId() { return this.conn.nextId(); } // ids are unique on the whole connection
  write(msg) { this.conn.write({ ...msg, sessionId: this.sessionId }); }
  // Detach from this target; the app and its other targets carry on.
  close() {
    if (this.closed) return;
    if (!this.conn.closed) this.conn.root.send("Target.detachFromTarget", { sessionId: this.sessionId }).catch(() => {});
    this.conn.sessions.delete(this.sessionId);
    this.ended();
  }
}

// The whole pipe: the browser-level session (`root`) and the targets' sessions.
//   input: where Morse writes (the app reads it as fd 3)
//   output: where Morse reads (the app writes it as fd 4)
export class PipeConnection {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.seq = 0;
    this.closed = false;
    this.sessions = new Map(); // sessionId -> PipeSession
    this.handlers = new Map();
    const conn = this;
    this.root = new (class extends Session { nextId() { return conn.nextId(); } write(m) { conn.write(m); } close() { conn.close(); } })();
    const unframe = new Unframer();
    output.on("data", chunk => { for (const m of unframe.push(chunk)) this.dispatch(m); });
    output.on("end", () => this.ended());
    output.on("close", () => this.ended());
    output.on("error", () => this.ended());
    input.on?.("error", () => {}); // the app went away while Morse was writing: "end" on the output says so
    // A target closed, or its renderer was swapped: its session is over.
    this.root.on("Target.detachedFromTarget", ({ sessionId }) => {
      const s = this.sessions.get(sessionId);
      if (s) { this.sessions.delete(sessionId); s.ended(); }
    });
  }
  nextId() { return ++this.seq; }
  write(msg) {
    if (this.closed) throw new Error("CDP session closed");
    this.input.write(frame(msg));
  }
  dispatch(msg) {
    if (msg.sessionId) this.sessions.get(msg.sessionId)?.dispatch(msg);
    else this.root.dispatch(msg);
  }
  session(sessionId) {
    let s = this.sessions.get(sessionId);
    if (!s) this.sessions.set(sessionId, s = new PipeSession(this, sessionId));
    return s;
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  // The app answers on the pipe: Browser.getVersion, sent once. Rejects
  // after `ms` without an answer (it may still come: ask again).
  version(ms = 30000) {
    if (!this.versionAsked) (this.versionAsked = this.root.send("Browser.getVersion")).catch(() => {}); // a later caller still sees the error
    let timer;
    return Promise.race([
      this.versionAsked,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("no answer on the pipe yet")), ms); timer.unref?.(); }),
    ]).finally(() => clearTimeout(timer));
  }
  ended() {
    if (this.closed) return;
    this.closed = true;
    for (const s of [...this.sessions.values()]) s.ended();
    this.sessions.clear();
    this.root.ended();
    for (const fn of this.handlers.get("close") || []) { try { fn(); } catch {} }
  }
  // Morse lets go of its ends, once what it wrote (detaching from targets)
  // has gone out. The app keeps running: it holds a copy of the end Morse
  // writes to (spawnWithPipe), so it never reads an end of file. Never
  // end() that socket: shutting it down would send the app one anyway.
  async close({ wait = 1000 } = {}) {
    const end = Date.now() + wait;
    while (!this.closed && this.input.writableLength > 0 && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    try { this.input.destroy(); } catch {}
    try { this.output.destroy(); } catch {}
    this.ended();
  }
}

// /json/list's shape, from Target.getTargets' TargetInfo. An iframe's parent
// is the frame it sits in; for a frame in a window that is the window's id.
export const listEntry = t => ({
  id: t.targetId, type: t.type, title: t.title, url: t.url,
  ...(t.parentId || t.parentFrameId ? { parentId: t.parentId || t.parentFrameId } : {}),
  ...(t.openerId ? { openerId: t.openerId } : {}),
  ...(t.browserContextId ? { browserContextId: t.browserContextId } : {}),
});

// The connector's view of an app on the pipe.
export function pipeBrowser(conn) {
  return {
    kind: "pipe",
    port: null,
    conn,
    get closed() { return conn.closed; },
    async listTargets() {
      // Like a port that stopped answering: the connector counts misses on this code.
      if (conn.closed) throw Object.assign(new Error("The app closed its end of the pipe"), { code: "ECONNRESET" });
      let timer;
      const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The app didn't answer")), 5000); timer.unref?.(); });
      const r = await Promise.race([conn.root.send("Target.getTargets"), late]).finally(() => clearTimeout(timer));
      return (r.targetInfos || []).map(listEntry);
    },
    async connect(target) {
      const { sessionId } = await conn.root.send("Target.attachToTarget", { targetId: target.id, flatten: true });
      return conn.session(sessionId);
    },
    close: () => conn.close(),
  };
}

// What answers on the pipe: { browser, userAgent, electron, pid }, like
// ports.js identify() does for a port.
export async function identifyPipe(conn, ms) {
  const v = await conn.version(ms);
  const info = await conn.root.send("SystemInfo.getProcessInfo").catch(() => null);
  return {
    browser: v.product || "",
    userAgent: v.userAgent || "",
    electron: (v.userAgent || "").match(/Electron\/([\d.]+)/)?.[1] || null,
    pid: info?.processInfo?.find(p => p.type === "browser")?.id ?? null,
  };
}

// Two connected sockets, made through a Unix socket in a new folder only this
// account can open (mkdtemp makes it 0700), removed right away. Node has no
// socketpair(); this is the same thing.
export async function socketPair({ tmp = os.tmpdir() } = {}) {
  const dir = await fs.mkdtemp(path.join(tmp, "morse-"));
  const where = path.join(dir, "p");
  const server = net.createServer({ pauseOnConnect: true });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(where, resolve); });
    const accepted = new Promise(r => server.once("connection", r));
    const mine = net.connect(where);
    await new Promise((resolve, reject) => { mine.once("connect", resolve); mine.once("error", reject); });
    return [mine, await accepted];
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Starts a program with --remote-debugging-pipe's descriptors in place:
//   fd 3  the app reads Morse's messages here
//   fd 4  the app writes its answers here
//   fd 5  a copy of the end Morse writes to. Electron 12 and later quit as
//         soon as fd 3 reads an end of file, which would happen the moment
//         Morse quits or crashes. Holding a writer itself, the app never
//         sees one: it keeps running without Morse, as it does on a port.
// Returns the child process, with child.cdp: the PipeConnection. onChild(child)
// runs right after the spawn, before its "error" event can fire.
export async function spawnWithPipe(file, args, options = {}, { pair = socketPair, onChild = () => {} } = {}) {
  const [mine, theirs] = await pair();
  let child;
  try {
    // Node sockets don't block, and that is shared with every copy of the
    // descriptor: Chromium's reader thread would get EAGAIN, take it for a
    // closed pipe and drop the connection at once. The app's copy blocks.
    if (typeof theirs._handle?.setBlocking !== "function" || theirs._handle.setBlocking(true) !== 0) throw new Error("Morse couldn't set up the pipe on this system");
    child = spawn(file, args, { ...options, stdio: ["ignore", "ignore", "ignore", theirs, "pipe", mine] });
    onChild(child);
  } catch (e) { mine.destroy(); throw e; }
  finally { theirs.destroy(); } // the app has its own copy; Morse must never read what is meant for the app
  child.cdp = new PipeConnection(mine, child.stdio[4]);
  return child;
}
