// The Morse helper: a local HTTP bridge so the browser extension can use
// models that need a process on this computer (Claude Code, Codex) or keys
// kept here. `morse serve` runs it on 127.0.0.1:7457.
//
//   GET  /v1/health    status (no auth, never includes keys)
//   POST /v1/pair      { code } -> { token }   one-time code printed by `morse serve` / `morse pair`
//   POST /v1/complete  { messages, model? }    Bearer token -> NDJSON {type: token|done|error}
//   GET  /v1/voice, POST /v1/transcribe        Bearer token, see daemon/voice.js
//
// The extension runs core/engine.js itself (it has to execute mod JS in the
// page and retry), so the helper only streams text. Closing the connection
// aborts the generation and kills the harness process.
//
// Security: loopback only; requests with an Origin other than
// chrome-extension://<id> are refused (no Origin = curl/CLI); the Host header
// must be a loopback name (DNS rebinding); /v1/complete needs a token that was
// issued against a pairing code, stored hashed, and bound to the pairing
// extension's origin.

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig, updateConfig } from "./store.js";
import { settingsFromConfig, settingsLabel } from "./models.js";
import { detectHarnesses, validModel, TIMEOUT_MS } from "./harness.js";
import { streamChat, abortError } from "../core/providers.js";
import { handleVoice } from "./voice.js";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const PAIR_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5, MAX_TOKENS = 20, MAX_BODY = 1 << 20;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EXT_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function newPairingCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

// Creates a fresh pairing code (replacing any pending one) and stores it.
export async function startPairing(ttl = PAIR_TTL_MS) {
  const code = newPairingCode();
  await updateConfig(cfg => { cfg.bridge = { ...cfg.bridge, pairing: { code, expires: Date.now() + ttl, attempts: 0 } }; });
  return { code, expires: Date.now() + ttl };
}

function tokenRecord(cfg, token) {
  if (!token) return null;
  const h = sha(token);
  return (cfg.bridge?.tokens || []).find(t => same(t.hash, h)) || null;
}

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
  return m ? m[1] : "";
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function validMessages(m) {
  return Array.isArray(m) && m.length > 0 && m.length <= 20 && m.every(x =>
    x && ["system", "user", "assistant"].includes(x.role) && typeof x.content === "string" && x.content.length <= 200_000);
}

export function createBridge({ port = 7457, host = "127.0.0.1", log = () => {}, timeoutMs = TIMEOUT_MS } = {}) {
  let harnessCache = null, harnessAt = 0;
  const harnesses = () => {
    if (!harnessCache || Date.now() - harnessAt > 5000) { harnessCache = detectHarnesses(); harnessAt = Date.now(); }
    return harnessCache;
  };
  const active = new Set();

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const send = (status, body) => {
      if (res.headersSent) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    try {
      if (!LOOPBACK_HOST.test(req.headers.host || "")) return send(403, { error: "Forbidden host" });
      if (origin !== undefined && !EXT_ORIGIN.test(origin)) return send(403, { error: "Forbidden origin" });
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/v1/health") {
        const cfg = await loadConfig();
        const s = settingsFromConfig(cfg, {}, { harnesses: harnesses() });
        const rec = tokenRecord(cfg, bearer(req));
        return send(200, {
          ok: true, version: VERSION, provider: s.provider, model: s.model, label: settingsLabel(s),
          harnesses: harnesses(), paired: !!rec && (!origin || !rec.origin || rec.origin === origin),
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/pair") {
        const { code } = await readJson(req);
        let result;
        await updateConfig(cfg => {
          const p = cfg.bridge?.pairing;
          if (!p || p.expires < Date.now()) { result = [400, { error: "No pairing code is active. Run `morse pair` to get one." }]; if (p) delete cfg.bridge.pairing; return cfg; }
          if (typeof code !== "string" || !same(code.trim().toUpperCase(), p.code)) {
            p.attempts = (p.attempts || 0) + 1;
            if (p.attempts >= MAX_ATTEMPTS) delete cfg.bridge.pairing;
            result = [403, { error: p.attempts >= MAX_ATTEMPTS ? "Too many wrong codes. Run `morse pair` for a new one." : "Wrong pairing code." }];
            return cfg;
          }
          const token = crypto.randomBytes(32).toString("base64url");
          const tokens = [...(cfg.bridge.tokens || []), { id: crypto.randomBytes(4).toString("hex"), hash: sha(token), origin: origin || null, created: new Date().toISOString() }];
          cfg.bridge = { ...cfg.bridge, tokens: tokens.slice(-MAX_TOKENS) };
          delete cfg.bridge.pairing;
          result = [200, { token }];
          return cfg;
        });
        if (result[0] === 200) log(`  ✓ paired ${origin || "a local client"}`);
        return send(...result);
      }

      // Everything below needs a paired token.
      const cfg = await loadConfig();
      const rec = tokenRecord(cfg, bearer(req));
      if (!rec) return send(401, { error: "Not paired. Enter the code from `morse pair` in Morse's settings." });
      if (origin && rec.origin && rec.origin !== origin) return send(403, { error: "This token was issued to a different extension." });

      if (await handleVoice(req, res)) return;

      if (req.method === "POST" && url.pathname === "/v1/complete") {
        const body = await readJson(req);
        if (!validMessages(body.messages)) return send(400, { error: "Expected { messages: [{ role, content }] }" });
        if (body.model !== undefined && (typeof body.model !== "string" || !validModel(body.model))) return send(400, { error: "Invalid model name" });
        const settings = settingsFromConfig(cfg, body.model ? { model: body.model } : {}, { harnesses: harnesses() });
        if (settings.provider === "none") return send(503, { error: "No model configured on this computer. Run `morse config --provider claude-code` (or codex / anthropic / openai)." });

        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.flushHeaders();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs + 5000);
        let finished = false;
        res.on("close", () => { if (!finished) ac.abort(abortError()); });
        const write = ev => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(ev) + "\n"); };
        const t0 = Date.now();
        active.add(ac);
        try {
          const text = await streamChat({ ...settings, timeoutMs }, body.messages, { signal: ac.signal, onToken: t => write({ type: "token", text: t }) });
          write({ type: "done", text });
          log(`  ✓ ${settingsLabel(settings)} · ${text.length} chars · ${Date.now() - t0}ms`);
        } catch (e) {
          if (ac.signal.aborted && ac.signal.reason?.name === "AbortError") log(`  · cancelled after ${Date.now() - t0}ms`);
          else {
            const message = ac.signal.aborted ? `The model took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.` : e.message || String(e);
            write({ type: "error", message });
            log(`  ✗ ${message}`);
          }
        } finally {
          finished = true;
          clearTimeout(timer);
          active.delete(ac);
          res.end();
        }
        return;
      }
      send(404, { error: "Not found" });
    } catch (e) {
      send(e.status || 500, { error: e.message || "Internal error" });
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.off("error", reject); resolve(server.address().port); });
    }),
    close: () => new Promise(r => { for (const ac of active) ac.abort(abortError()); server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
