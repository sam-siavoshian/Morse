// The Morse helper: a local HTTP bridge so the browser extension can use
// models that need a process on this computer (Claude Code, Codex) or keys
// kept here. `morse serve` runs it on 127.0.0.1:7457.
//
//   GET  /v1/health    status (no auth, never includes keys)
//   POST /v1/pair      { code } -> { token }   one-time code printed by `morse serve` / `morse pair`
//   POST /v1/pair/ask              -> { id }   onboarding v2: Chrome asks to connect, a person here
//   POST /v1/pair/ask/<id>         -> { state: waiting|allowed|denied|expired, token? }   answers Allow or Deny
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
// extension's origin. A one-click pairing (/v1/pair/ask) issues the same
// token, only after a person on this computer clicked Allow (Morse Desktop's
// question, or y in the terminal running `morse serve`), and hands it once to
// the extension that asked.

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig, updateConfig } from "./store.js";
import { settingsFromConfig, settingsLabel } from "./models.js";
import { detectHarnesses, validModel, TIMEOUT_MS } from "./harness.js";
import { streamChat, abortError, prewarm, HELPER_PORT } from "../core/providers.js";
import { handleVoice } from "./voice.js";
import { execFile } from "node:child_process"; // onboarding v2: is Claude Code / Codex signed in?
import { t } from "../core/i18n.js"; // onboarding v2: the Allow question, in the person's language

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

// A new token for an extension (or a local client): stored hashed in cfg, bound to its origin.
function addToken(cfg, origin) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokens = [...(cfg.bridge?.tokens || []), { id: crypto.randomBytes(4).toString("hex"), hash: sha(token), origin: origin || null, created: new Date().toISOString() }];
  cfg.bridge = { ...cfg.bridge, tokens: tokens.slice(-MAX_TOKENS) };
  return token;
}

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

// ---- onboarding v2: one-click pairing
// The question a person answers when Chrome asks to connect, in one place so
// Morse Desktop's dialog and the terminal say the same thing.
//   label: what Chrome will use, like "Claude Code" (settingsLabel)
export function askWords(label) {
  const what = label || t("pair.ask.yourModel");
  return { message: t("pair.ask.q", { label: what }), detail: t("pair.ask.detail", { label: what }), allow: t("pair.ask.allow"), deny: t("pair.ask.deny") };
}
// The question in a terminal (`morse serve`): "Allow Chrome to use your
// Claude Code? (y/n)", answered with a line on `input`. One question at a time.
export function terminalAsk({ input = process.stdin, output = process.stdout } = {}) {
  let buf = "", waiting = null;
  input.setEncoding?.("utf8");
  input.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (waiting) { const w = waiting; waiting = null; w(line); } }
  });
  input.on("end", () => { if (waiting) { const w = waiting; waiting = null; w(""); } });
  return ({ words, signal }) => new Promise(resolve => {
    output.write(`\n  ${words.message} ${words.detail}\n  ${t("pair.ask.keys")} `);
    waiting = line => resolve(/^(y|yes|a|allow)$/i.test(line));
    signal?.addEventListener("abort", () => { if (waiting) { waiting = null; output.write(`\n  ${t("pair.ask.gone")}\n`); resolve(false); } });
  });
}
export const ASK_TTL_MS = 2 * 60_000;     // a question nobody answers goes away
const DENY_PAUSE_MS = 20_000;             // after Deny, that extension can't ask again at once (no question spam)

// Whether Claude Code and Codex are signed in, not just installed:
// `claude auth status` prints { loggedIn }, `codex login status` exits 0 when
// signed in. null while unknown; checked in the background, at most every few minutes.
const SIGNED_IN_EVERY = 5 * 60_000;
function signedInProbe() {
  let known = { claude: null, codex: null }, at = 0, running = false;
  const run = (bin, args) => new Promise(resolve => {
    if (!bin) return resolve(null);
    try {
      execFile(bin, args, { timeout: 8000, windowsHide: true, shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(bin) }, (err, stdout) => {
        if (args[0] === "auth") { try { return resolve(JSON.parse(stdout).loggedIn === true); } catch { return resolve(null); } }
        resolve(err ? (err.killed || err.code === "ENOENT" ? null : false) : true);
      });
    } catch { resolve(null); }
  });
  return (h) => {
    if (!running && Date.now() - at > SIGNED_IN_EVERY) {
      running = true;
      Promise.all([h.claude.found ? run(h.claude.path, ["auth", "status"]) : null, h.codex.found ? run(h.codex.path, ["login", "status"]) : null])
        .then(([claude, codex]) => { known = { claude, codex }; at = Date.now(); }).finally(() => { running = false; });
    }
    return known;
  };
}

// models: Chrome asks for the fast or the strong tier by name and effort (core/route.js).
const effortOf = body => (["low", "medium", "high", "xhigh", "max"].includes(body?.effort) ? { effort: body.effort } : {});

// onboarding v2:
//   app   who runs this helper: "cli" (`morse serve`, `morse setup --pair`) or "desktop" (Morse Desktop)
//   denyPauseMs  after Deny, how long that extension waits to ask again (tests shorten it)
//   ask   async ({ origin, label, words, signal }) => true (Allow) | false (Deny): asks a person on
//         this computer whether Chrome may connect. Without it, Chrome pairs with a code only.
export function createBridge({ port = 7457, host = "127.0.0.1", log = () => {}, timeoutMs = TIMEOUT_MS, app = "cli", ask = null, denyPauseMs = DENY_PAUSE_MS } = {}) {
  let harnessCache = null, harnessAt = 0;
  const harnesses = () => {
    if (!harnessCache || Date.now() - harnessAt > 5000) { harnessCache = detectHarnesses(); harnessAt = Date.now(); }
    return harnessCache;
  };
  const active = new Set();
  const signedIn = signedInProbe(); // onboarding v2
  const asks = new Map(), deniedAt = new Map(); // onboarding v2: id -> { origin, state, token, expires, ac }
  const prune = () => { for (const [id, a] of asks) if (a.expires < Date.now() && a.state !== "allowed") { a.ac.abort(); asks.delete(id); } };

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
          tiers: s.tiers, pinned: s.pinned, // models: what Chrome's Automatic chooses between (core/route.js)
          harnesses: { claude: harnesses().claude.found, codex: harnesses().codex.found }, paired: !!rec && (!origin || !rec.origin || rec.origin === origin),
          pairing: !!cfg.bridge?.pairing && cfg.bridge.pairing.expires > Date.now(), // first run: a code is waiting (never the code itself)
          app, ask: !!ask, signedIn: signedIn(harnesses()), // onboarding v2: Morse Desktop or the terminal; one-click pairing; signed in
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
          const token = addToken(cfg, origin);
          delete cfg.bridge.pairing;
          result = [200, { token }];
          return cfg;
        });
        if (result[0] === 200) log(origin ? "  ✓ Paired with Morse in Chrome. Changes you ask for there come through here." : "  ✓ Paired a local client"); // first-run hook: plain words
        return send(...result);
      }

      // onboarding v2: one-click pairing. Only an extension may ask, one
      // question at a time, and only a person here can answer it.
      const askPath = /^\/v1\/pair\/ask(?:\/([A-Za-z0-9_-]{22}))?$/.exec(url.pathname);
      if (askPath) {
        prune();
        if (!origin) return send(403, { error: "Only Morse in Chrome can ask to connect." });
        if (req.method === "POST" && !askPath[1]) {
          if (!ask) return send(404, { error: "This Morse helper connects with a code. Type the code it shows.", code: "no-ask" });
          if (Date.now() - (deniedAt.get(origin) || 0) < denyPauseMs) return send(429, { error: "You clicked Deny a moment ago. Wait a few seconds, then try again." });
          const mine = [...asks.entries()].find(([, a]) => a.origin === origin && a.state === "waiting");
          if (mine) return send(202, { id: mine[0], expires: mine[1].expires });
          if ([...asks.values()].some(a => a.state === "waiting")) return send(409, { error: "Morse is already asking about another browser. Answer that first." });
          const cfg = await loadConfig();
          const label = settingsLabel(settingsFromConfig(cfg, {}, { harnesses: harnesses() }));
          const id = crypto.randomBytes(16).toString("base64url");
          const a = { origin, state: "waiting", token: "", expires: Date.now() + ASK_TTL_MS, ac: new AbortController() };
          asks.set(id, a);
          setTimeout(() => { if (a.state === "waiting") { a.state = "expired"; a.ac.abort(); } }, ASK_TTL_MS).unref?.();
          Promise.resolve().then(() => ask({ origin, label, words: askWords(label), signal: a.ac.signal })).then(async yes => {
            if (a.state !== "waiting") return;
            if (yes === true) {
              let token = "";
              await updateConfig(c => { token = addToken(c, origin); return c; });
              a.token = token; a.state = "allowed"; a.expires = Date.now() + ASK_TTL_MS;
              log("  ✓ Paired with Morse in Chrome. Changes you ask for there come through here.");
            } else { a.state = "denied"; deniedAt.set(origin, Date.now()); log("  · Chrome asked to connect. You said no."); }
          }, () => { if (a.state === "waiting") { a.state = "denied"; deniedAt.set(origin, Date.now()); } });
          return send(202, { id, expires: a.expires });
        }
        if (req.method === "POST" && askPath[1]) { // POST: Chrome sends an extension's Origin on POST, not on GET
          const a = asks.get(askPath[1]);
          if (!a || a.state === "expired") { asks.delete(askPath[1]); return send(404, { state: "expired" }); }
          if (a.origin !== origin) return send(403, { error: "Forbidden origin" });
          if (a.state === "waiting") return send(200, { state: "waiting" });
          asks.delete(askPath[1]); // the answer is handed out once
          return send(200, a.state === "allowed" ? { state: "allowed", token: a.token } : { state: "denied" });
        }
        return send(404, { error: "Not found" });
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
        if (settings.provider !== "none") prewarm({ ...settings, ...effortOf(body) });
        return send(200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/v1/complete") {
        const body = await readJson(req);
        if (!validMessages(body.messages)) return send(400, { error: "Expected { messages: [{ role, content }] }" });
        if (body.model !== undefined && (typeof body.model !== "string" || !validModel(body.model))) return send(400, { error: "That model name isn't one Morse can use. Check the spelling in Morse's settings." });
        if (body.effort !== undefined && !effortOf(body).effort) return send(400, { error: "Expected effort to be one of low, medium, high, xhigh, max" });
        const settings = { ...settingsFromConfig(cfg, body.model ? { model: body.model } : {}, { harnesses: harnesses() }), ...effortOf(body) };
        // models: the model to keep warm for the next request (the fast one, after an escalation)
        if (body.next && typeof body.next === "object" && typeof body.next.model === "string" && validModel(body.next.model))
          settings.warmAs = { ...settingsFromConfig(cfg, body.next.model ? { model: body.next.model } : {}, { harnesses: harnesses() }), ...effortOf(body.next) };
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
    close: () => new Promise(r => { for (const ac of active) ac.abort(abortError()); for (const a of asks.values()) a.ac.abort(); /* onboarding v2 */ server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
