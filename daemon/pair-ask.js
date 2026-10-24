// One-click pairing: the Morse extension asks the Morse helper to connect, and
// a person allows or denies it in Morse Desktop ("Allow Chrome to use your
// Claude Code?"). No code to type. Only a helper with someone to ask offers
// it (Morse Desktop); `morse serve` in a terminal keeps codes.
// The protocol is in docs/dev/pairing.md.
//
//   POST   /v1/pair/ask        -> 202 { id, status: "waiting", expires }
//   GET    /v1/pair/ask/<id>   -> { status: "waiting" | "denied" } or { status: "allowed", token } (once)
//   DELETE /v1/pair/ask/<id>   -> { status: "cancelled" }   the extension gave up waiting
//
// Rules: the request must come from 127.0.0.1 (or ::1) with an Origin of
// chrome-extension://<id>; only that origin can read the answer; the token is
// made only when the person clicks Allow, stored hashed and bound to that
// origin (like a code-paired token), handed out once, and forgotten after
// `ttl`. At most one waiting request per extension and three in all.

import crypto from "node:crypto";
import { updateConfig } from "./store.js";

export const ASK_TTL_MS = 2 * 60_000;
const EXT_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const LOOPBACK_ADDR = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const MAX_WAITING = 3, MAX_TOKENS = 20;
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

// onAsk(asks): the waiting requests changed ([{ id, origin, extension, at }]).
export function pairAsks({ onAsk = () => {}, ttl = ASK_TTL_MS, now = () => Date.now(), log = () => {} } = {}) {
  const asks = new Map(); // id -> { id, origin, at, status, token? }
  const waiting = () => [...asks.values()].filter(a => a.status === "waiting");
  const changed = () => { try { onAsk(list()); } catch {} };
  const prune = () => {
    let gone = false;
    for (const a of asks.values()) if (now() - a.at > ttl) { asks.delete(a.id); gone ||= a.status === "waiting"; }
    if (gone) changed();
  };
  const list = () => waiting().map(a => ({ id: a.id, origin: a.origin, extension: a.origin.slice("chrome-extension://".length), at: a.at }));

  // The person's answer, from Morse Desktop.
  async function answer(id, allow) {
    prune();
    const a = asks.get(id);
    if (!a || a.status !== "waiting") return false;
    if (allow) {
      const token = crypto.randomBytes(32).toString("base64url");
      await updateConfig(cfg => {
        const tokens = [...(cfg.bridge?.tokens || []), { id: crypto.randomBytes(4).toString("hex"), hash: sha(token), origin: a.origin, created: new Date(now()).toISOString(), via: "ask" }];
        cfg.bridge = { ...cfg.bridge, tokens: tokens.slice(-MAX_TOKENS) };
        return cfg;
      });
      Object.assign(a, { status: "allowed", token });
      log("  ✓ Allowed Morse in Chrome to use this computer's model.");
    } else a.status = "denied";
    changed();
    return true;
  }

  // The HTTP side. Returns true when it answered the request.
  async function handle(req, url, send) {
    if (!url.pathname.startsWith("/v1/pair/ask")) return false;
    const origin = req.headers.origin;
    if (!origin || !EXT_ORIGIN.test(origin)) { send(403, { error: "Only the Morse extension can ask to connect." }); return true; }
    if (!LOOPBACK_ADDR.test(req.socket.remoteAddress || "")) { send(403, { error: "Forbidden address" }); return true; }
    prune();
    if (url.pathname === "/v1/pair/ask" && req.method === "POST") {
      let a = waiting().find(x => x.origin === origin);
      if (!a) {
        if (waiting().length >= MAX_WAITING) { send(429, { error: "Morse is already asking. Answer it in Morse Desktop first." }); return true; }
        a = { id: crypto.randomBytes(16).toString("base64url"), origin, at: now(), status: "waiting" };
        asks.set(a.id, a);
        changed();
      }
      send(202, { id: a.id, status: "waiting", expires: a.at + ttl });
      return true;
    }
    const m = /^\/v1\/pair\/ask\/([\w-]{10,64})$/.exec(url.pathname);
    const a = m && asks.get(m[1]);
    if (!a || a.origin !== origin) { send(404, { status: "gone", error: "That request has ended. Ask again." }); return true; }
    if (req.method === "DELETE") {
      if (a.status === "waiting") { asks.delete(a.id); changed(); }
      send(200, { status: "cancelled" });
      return true;
    }
    if (req.method !== "GET") { send(405, { error: "Not allowed" }); return true; }
    if (a.status === "allowed") { asks.delete(a.id); send(200, { status: "allowed", token: a.token }); return true; }
    if (a.status === "denied") { asks.delete(a.id); send(200, { status: "denied" }); return true; }
    send(200, { status: "waiting", expires: a.at + ttl });
    return true;
  }

  const timer = setInterval(prune, 5000);
  timer.unref?.();
  return { handle, answer, list, close: () => clearInterval(timer) };
}
