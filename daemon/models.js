// Which model Morse uses on this computer. ~/.morse/config.json:
//   provider   "claude-code" | "codex" | "anthropic" | "openai" (unset: auto-detect)
//   models     { [provider]: model }    keys { anthropic, openai }    baseUrls { openai, anthropic }
//              (a model named here is used for every request: routing is off)
//   tiers      { [provider]: { fast, best } }   the two models Automatic chooses
//              between (core/route.js TIERS when unset)
// The choice "Automatic / Always fast / Always best" is a bar setting
// (~/.morse/settings.json "modelMode", core/prefs.js).
// Auto-detect order: Claude Code on PATH, Codex on PATH, Anthropic key, OpenAI key.

import { loadConfig, loadPrefs } from "./store.js";
import { detectHarnesses } from "./harness.js"; // also registers the harness providers
import { PROVIDERS, USER_PROVIDERS, settingsLabel } from "../core/providers.js";
import { resolveTiers, MODEL_MODES } from "../core/route.js";

export { settingsLabel };

// `morse setup` before 0.2.1 wrote its choice as config.json "model":
// { provider, apiKey? }, which nothing read. Honor it (first-run hook).
const legacy = cfg => (cfg.model && typeof cfg.model === "object" ? cfg.model : {});

// Moves that old "model" record into the shape above (before it is dropped).
export function migrateLegacy(cfg) {
  const old = legacy(cfg);
  if (old.provider && old.provider !== "auto" && !cfg.provider) cfg.provider = old.provider;
  if (old.apiKey && (old.provider === "anthropic" || old.provider === "openai")) cfg.keys = { [old.provider]: old.apiKey, ...cfg.keys };
  if (old.baseUrl && old.provider === "openai" && old.baseUrl !== "https://api.openai.com") cfg.baseUrls = { openai: old.baseUrl, ...cfg.baseUrls };
  return cfg;
}

export function keysFrom(cfg, env = process.env) {
  const old = legacy(cfg);
  return {
    anthropic: cfg.keys?.anthropic || (old.provider === "anthropic" && old.apiKey) || env.ANTHROPIC_API_KEY || "",
    openai: cfg.keys?.openai || (old.provider === "openai" && old.apiKey) || env.OPENAI_API_KEY || "",
  };
}

export function settingsFromConfig(cfg, overrides = {}, { env = process.env, harnesses = detectHarnesses() } = {}) {
  const keys = keysFrom(cfg, env);
  // MORSE_PROVIDER overrides the config for one run (scripts and tests; it is
  // also the only way to pick the internal "demo" replay fixture).
  let provider = overrides.provider || env.MORSE_PROVIDER || cfg.provider || legacy(cfg).provider || "";
  let detected = false;
  if (!provider) {
    detected = true;
    provider = harnesses.claude.found ? "claude-code"
      : harnesses.codex.found ? "codex"
      : keys.anthropic ? "anthropic"
      : keys.openai ? "openai"
      : "none";
  }
  const pinned = !!(overrides.model || cfg.models?.[provider]);
  const model = overrides.model || cfg.models?.[provider] || PROVIDERS[provider]?.defaultModel || "";
  const apiKey = provider === "anthropic" ? keys.anthropic : provider === "openai" ? keys.openai : "";
  const baseUrl = overrides.baseUrl || cfg.baseUrls?.[provider] || (provider === "openai" ? env.OPENAI_BASE_URL || "" : "");
  const tiers = resolveTiers(provider, cfg.tiers?.[provider], { baseUrl }); // models: fast and strong
  return { provider, model, apiKey, baseUrl, detected, pinned, tiers };
}

// With the bar's "Model" setting (Automatic, Always fast, Always best).
// MORSE_MODEL_MODE overrides it for one run.
export async function currentSettings(overrides = {}, { env = process.env } = {}) {
  const s = settingsFromConfig(await loadConfig(), overrides);
  const want = overrides.mode || env.MORSE_MODEL_MODE;
  return { ...s, mode: MODEL_MODES.includes(want) ? want : (await loadPrefs()).modelMode };
}

export function assertProvider(p) {
  if (!USER_PROVIDERS.includes(p)) throw new Error(`Morse doesn't know "${p}". Use one of: ${USER_PROVIDERS.join(", ")}.`);
}

export const mask = k => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : "");

