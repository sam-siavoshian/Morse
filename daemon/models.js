// Which model Morse uses on this computer. ~/.morse/config.json:
//   provider   "claude-code" | "codex" | "anthropic" | "openai" (unset: auto-detect)
//   models     { [provider]: model }    keys { anthropic, openai }    baseUrls { openai, anthropic }
// Auto-detect order: Claude Code on PATH, Codex on PATH, Anthropic key, OpenAI key.

import { loadConfig } from "./store.js";
import { detectHarnesses } from "./harness.js"; // also registers the harness providers
import { PROVIDERS, USER_PROVIDERS, settingsLabel } from "../core/providers.js";

export { settingsLabel };

export function keysFrom(cfg, env = process.env) {
  return {
    anthropic: cfg.keys?.anthropic || env.ANTHROPIC_API_KEY || "",
    openai: cfg.keys?.openai || env.OPENAI_API_KEY || "",
  };
}

export function settingsFromConfig(cfg, overrides = {}, { env = process.env, harnesses = detectHarnesses() } = {}) {
  const keys = keysFrom(cfg, env);
  let provider = overrides.provider || cfg.provider || env.MORSE_PROVIDER || "";
  let detected = false;
  if (!provider) {
    detected = true;
    provider = harnesses.claude.found ? "claude-code"
      : harnesses.codex.found ? "codex"
      : keys.anthropic ? "anthropic"
      : keys.openai ? "openai"
      : "none";
  }
  const model = overrides.model || cfg.models?.[provider] || PROVIDERS[provider]?.defaultModel || "";
  const apiKey = provider === "anthropic" ? keys.anthropic : provider === "openai" ? keys.openai : "";
  const baseUrl = overrides.baseUrl || cfg.baseUrls?.[provider] || (provider === "openai" ? env.OPENAI_BASE_URL || "" : "");
  return { provider, model, apiKey, baseUrl, detected };
}

export async function currentSettings(overrides) {
  return settingsFromConfig(await loadConfig(), overrides);
}

export function assertProvider(p) {
  if (!USER_PROVIDERS.includes(p)) throw new Error(`Unknown provider "${p}". Use one of: ${USER_PROVIDERS.join(", ")}`);
}

export const mask = k => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : "");
