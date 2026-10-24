// Minimal Chrome DevTools Protocol client on Node's built-in WebSocket.

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
  return res.json();
}

export async function waitForEndpoint(port, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).json(); }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error(`Morse couldn't connect to the app on port ${port}. The app may not allow it (it blocks --remote-debugging-port).`);
}

export class CDPSession {
  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const s = new CDPSession(ws);
      ws.addEventListener("open", () => resolve(s), { once: true });
      ws.addEventListener("error", () => reject(new Error(`Could not connect to ${wsUrl}`)), { once: true });
    });
  }
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    ws.addEventListener("message", e => this.#onMessage(JSON.parse(e.data)));
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error("CDP session closed"));
      this.pending.clear();
      this.handlers.get("close")?.forEach(fn => fn());
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session closed"));
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  off(event, fn) {
    const list = this.handlers.get(event);
    if (list) this.handlers.set(event, list.filter(f => f !== fn));
  }
  close() { try { this.ws.close(); } catch {} }
  #onMessage(msg) {
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
    } else this.handlers.get(msg.method)?.forEach(fn => fn(msg.params));
  }
}
