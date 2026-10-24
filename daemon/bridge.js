// The Morse helper: a local HTTP bridge so the browser extension can use
// models that need a process on this computer (Claude Code, Codex) or keys
// kept here. `morse serve` runs it on 127.0.0.1:7457.
//
//   GET  /v1/health    status (no auth, never includes keys)
//   POST /v1/pair      { code } -> { token }   one-time code printed by `morse serve` / `morse pair`
//   POST /v1/complete  { messages, model? }    Bearer token -> NDJSON {type: token|stage|done|error}
//   POST /v1/warm      { model? }               Bearer token: get the model ready (the bar opened)
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
import { streamChat, abortError, prewarm, HELPER_PORT } from "../core/providers.js";
import { handleVoice } from "./voice.js";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// The helper's port: 7457, or MORSE_HELPER_PORT (tests run several helpers at
// once, and point their extension at theirs with chrome.storage.local
// "morse.helperPort", core/providers.js HELPER_PORT_KEY).
export const helperPort = () => Number(process.env.MORSE_HELPER_PORT) || HELPER_PORT;
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

// A pairing code: six characters from CODE_ALPHABET (no 0/O, 1/I).
export const validPairingCode = c => typeof c === "string" && new RegExp(`^[${CODE_ALPHABET}]{6}$`).test(c);

// Creates a fresh pairing code (replacing any pending one) and stores it.
// `given`: a code the welcome page made and the user carried over in
// `morse setup --pair <code>` (first run), instead of a new one.
export async function startPairing(ttl = PAIR_TTL_MS, given = "") {
  if (given && !validPairingCode(given)) throw new Error("That pairing code doesn't look right. Copy the whole command from Morse's welcome page again.");
  const code = given || newPairingCode();
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
      if (size > MAX_BODY) { reject(Object.assign(new Error("This request is too large for the Morse helper."), { status: 413 })); req.destroy(); return; }
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
    x && ["system", "user", "assistant"].includes(x.role) && (typeof x.content === "string" ? x.content.length <= 200_000 : validBlocks(x)));
}
// Describe this image (core/a11y.js): a user message may be text and picture blocks.
const validBlocks = x => x.role === "user" && Array.isArray(x.content) && x.content.length <= 4 && x.content.every(b =>
  (b?.type === "text" && typeof b.text === "string" && b.text.length <= 200_000) ||
  (b?.type === "image" && b.source?.type === "base64" && /^image\/(png|jpeg|webp|gif)$/.test(b.source.media_type) && typeof b.source.data === "string"));

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
          harnesses: { claude: harnesses().claude.found, codex: harnesses().codex.found }, paired: !!rec && (!origin || !rec.origin || rec.origin === origin),
          pairing: !!cfg.bridge?.pairing && cfg.bridge.pairing.expires > Date.now(), // first run: a code is waiting (never the code itself)
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/pair") {
        const { code } = await readJson(req);
        let result;
        await updateConfig(cfg => {
          const p = cfg.bridge?.pairing;
          if (!p || p.expires < Date.now()) { result = [400, { error: "That code has expired. Run morse pair on your computer to get a new one." }]; if (p) delete cfg.bridge.pairing; return cfg; }
          if (typeof code !== "string" || !same(code.trim().toUpperCase(), p.code)) {
            p.attempts = (p.attempts || 0) + 1;
            if (p.attempts >= MAX_ATTEMPTS) delete cfg.bridge.pairing;
            result = [403, { error: p.attempts >= MAX_ATTEMPTS ? "Too many wrong codes. Run morse pair on your computer to get a new one." : "That code doesn't match. Check the code the Morse helper shows and try again." }];
            return cfg;
          }
          const token = crypto.randomBytes(32).toString("base64url");
          const tokens = [...(cfg.bridge.tokens || []), { id: crypto.randomBytes(4).toString("hex"), hash: sha(token), origin: origin || null, created: new Date().toISOString() }];
          cfg.bridge = { ...cfg.bridge, tokens: tokens.slice(-MAX_TOKENS) };
          delete cfg.bridge.pairing;
          result = [200, { token }];
          return cfg;
        });
        if (result[0] === 200) log(origin ? "  ✓ Paired with Morse in Chrome. Changes you ask for there come through here." : "  ✓ Paired a local client"); // first-run hook: plain words
        return send(...result);
      }

      // Everything below needs a paired token.
      const cfg = await loadConfig();
      const rec = tokenRecord(cfg, bearer(req));
      if (!rec) return send(401, { error: "This browser isn't paired yet. Type the code from morse pair into Morse's settings." });
      if (origin && rec.origin && rec.origin !== origin) return send(403, { error: "This pairing belongs to a different copy of Morse. Pair this browser again." });

      if (await handleVoice(req, res)) return;

      // speed: the bar opened, so a request is likely soon (core/providers.js prewarm).
      if (req.method === "POST" && url.pathname === "/v1/warm") {
        const body = await readJson(req).catch(() => ({}));
        const model = typeof body?.model === "string" && validModel(body.model) ? body.model : undefined;
        const settings = settingsFromConfig(cfg, model ? { model } : {}, { harnesses: harnesses() });
        if (settings.provider !== "none") prewarm(settings);
        return send(200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/v1/complete") {
        const body = await readJson(req);
        if (!validMessages(body.messages)) return send(400, { error: "Expected { messages: [{ role, content }] }" });
        if (body.model !== undefined && (typeof body.model !== "string" || !validModel(body.model))) return send(400, { error: "That model name isn't one Morse can use. Check the spelling in Morse's settings." });
        const settings = settingsFromConfig(cfg, body.model ? { model: body.model } : {}, { harnesses: harnesses() });
        if (settings.provider === "none") return send(503, { error: "No model is set up on this computer. Run morse doctor there to set one up." });

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
          const text = await streamChat({ ...settings, timeoutMs }, body.messages, { signal: ac.signal, onToken: t => write({ type: "token", text: t }), onStage: st => write({ type: "stage", stage: st.stage }) });
          write({ type: "done", text });
          log(`  ✓ ${settingsLabel(settings)} · ${text.length} chars · ${Date.now() - t0}ms`);
        } catch (e) {
          if (ac.signal.aborted && ac.signal.reason?.name === "AbortError") log(`  · cancelled after ${Date.now() - t0}ms`);
          else {
            const message = ac.signal.aborted ? `The model took longer than ${Math.round(timeoutMs / 1000)}s, so Morse stopped it. Try a smaller change.` : e.message || String(e);
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
