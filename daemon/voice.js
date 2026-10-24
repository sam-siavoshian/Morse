// Voice on the desktop side: where transcription settings come from, and the
// HTTP routes the Morse helper (daemon/bridge.js) serves to the extension.
//
//   POST /v1/transcribe   { audio: base64, mime }  ->  { text, provider }
//   GET  /v1/voice        ->  { transcribe, provider, providers, label, hint }
//
// Mount in bridge.js with one line, after its own auth check:
//   if (await handleVoice(req, res)) return;

import { transcribe, voiceStatus, MAX_AUDIO_BYTES } from "../core/transcribe.js";
import { loadConfig } from "./store.js";

// ~/.morse/config.json { "voice": { "openaiKey", "openaiBaseUrl", "provider": "auto"|"openai"|"whisper",
//   "whisperBin", "whisperModel", "language" } }, then OPENAI_API_KEY, then the
// OpenAI key from `morse config`.
export async function voiceOptions(env = process.env) {
  const cfg = await loadConfig();
  const v = cfg.voice || {};
  // The model's OpenAI key (`morse config --openai-key`) works too, unless it
  // points at another OpenAI-compatible server.
  const modelKey = cfg.keys?.openai && (!cfg.baseUrls?.openai || /(^|\.)openai\.com$/.test(safeHost(cfg.baseUrls.openai))) ? cfg.keys.openai : "";
  return {
    provider: v.provider || "auto",
    openaiKey: v.openaiKey || env.OPENAI_API_KEY || modelKey || "",
    openaiBaseUrl: v.openaiBaseUrl || env.MORSE_OPENAI_BASE_URL || "https://api.openai.com",
    whisperBin: v.whisperBin || "",
    whisperModel: v.whisperModel || "",
    language: v.language || "",
    env,
  };
}
const safeHost = u => { try { return new URL(u).host; } catch { return ""; } };

let statusCache = null, statusAt = 0;
export async function cachedVoiceStatus() {
  if (statusCache && Date.now() - statusAt < 15000) return statusCache;
  statusCache = await voiceStatus(await voiceOptions());
  statusAt = Date.now();
  return statusCache;
}

export async function transcribeAudio({ audio, mime, signal }) {
  return transcribe({ audio, mime, signal, ...(await voiceOptions()) });
}

const MAX_BODY = Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 4096;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Recording too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("Bad JSON"), { status: 400 })); } });
    req.on("error", reject);
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

// Returns true when it handled the request.
export async function handleVoice(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/v1/voice" && req.method === "GET") {
    send(res, 200, await cachedVoiceStatus());
    return true;
  }
  if (pathname !== "/v1/transcribe") return false;
  if (req.method !== "POST") { send(res, 405, { error: "POST audio as JSON { audio, mime }" }); return true; }
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  try {
    const body = await readJson(req);
    send(res, 200, await transcribeAudio({ audio: body.audio, mime: body.mime, signal: ac.signal }));
  } catch (e) {
    if (!res.writableEnded) send(res, e.status || 502, { error: e.message || String(e) });
  }
  return true;
}
