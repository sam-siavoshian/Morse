// Voice on the desktop side: where transcription settings come from. The
// connector (daemon/connector.js) answers the bar's voice requests with these.

import { transcribe, voiceStatus } from "../core/transcribe.js";
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
