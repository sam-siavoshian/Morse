// Model providers. Every provider streams tokens through onToken and resolves
// with the full text. This file runs in Node and in the browser (the site's Try
// it here, the demo playgrounds). Providers that need a child
// process (Claude Code, Codex) live in daemon/harness.js and register here.
//
//   claude-code  the `claude` CLI, on the user's Claude subscription (daemon)
//   codex        the `codex` CLI (daemon)
//   anthropic    Anthropic API key, through the official SDK
//   openai       OpenAI API key, or any OpenAI-compatible server
//   demo         internal test fixture: replays canned replies (never offered to users)

// Loaded on first use, so code that never calls the Anthropic API (the demo
// playground running this file in a browser) doesn't need the SDK.
let AnthropicSDK = null;
const loadAnthropic = async () => (AnthropicSDK ||= (await import("@anthropic-ai/sdk")).default);
import { demoResponse } from "./demo.js";
import { SYSTEM_PROMPT } from "./prompt.js"; // speed: what prewarm caches
import { warmSettings, routable, modeOf } from "./route.js"; // models: fast and strong (docs/models.md)
import { t } from "./i18n.js"; // the labels people read (the host sets the language)

export const PROVIDERS = {
  // fastMode: the provider's own faster, more expensive mode of the same model.
  //   settings      Claude Code `--settings {"fastMode":true}` (Opus only)
  //   speed         Anthropic Messages `speed: "fast"` (Opus only)
  //   service_tier  OpenAI `service_tier: "fast"` (Astra, gpt-5, and the other models OpenAI lists)
  // Codex and a local server have no such mode, so the switch stays hidden.
  "claude-code": { name: "Claude Code", models: ["opus", "sonnet", "haiku"], defaultModel: "", fastMode: "settings" },
  codex: { name: "Codex", models: [], defaultModel: "" },
  anthropic: { name: "Anthropic API", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", fastMode: "speed" },
  openai: { name: "OpenAI API", models: ["gpt-5", "gpt-5-mini"], defaultModel: "gpt-5", fastMode: "service_tier" },
  // A model server on this computer that speaks the OpenAI chat API (Ollama, LM Studio, llama.cpp).
  local: { name: "Local model", models: [], defaultModel: "" },
};
export const USER_PROVIDERS = Object.keys(PROVIDERS);
export const DEFAULT_SETTINGS = { provider: "", model: "", apiKey: "", baseUrl: "" };

// "fast" when this provider offers that mode, or "". Never a model id: Fast
// mode does not swap in a smaller model. A local list is ignored.
export function fastModelOf(provider) {
  return PROVIDERS[provider]?.fastMode ? "fast" : "";
}

// The provider's fast-mode parameter, or null when the switch stays hidden.
// Claude Code: `--settings {"fastMode":true}`. Anthropic: `speed: "fast"`.
// OpenAI (Astra and the other models that have it): `service_tier: "fast"`.
export function fastModeChoice(provider) {
  switch (PROVIDERS[provider]?.fastMode) {
    case "settings": return { fastMode: true };
    case "speed": return { speed: "fast" };
    case "service_tier": return { service_tier: "fast" };
    default: return null;
  }
}

// Opus models that have a fast mode of themselves (platform.claude.com fast mode).
// Opus 5.5 takes `speed: "fast"` with no beta header. Opus 5 and Opus 4.8 need
// the `fast-mode-2026-02-01` beta. Sonnet, Haiku, and older Opus do not have it.
function anthropicFast(model) {
  const id = String(model || "");
  if (/^claude-opus-5-5(?:$|[-@])/.test(id)) return { speed: "fast" };
  if (/^claude-opus-4-8(?:$|[-@])/.test(id)) return { speed: "fast", beta: "fast-mode-2026-02-01" };
  if (/^claude-opus-5(?:$|@|-20\d{2})/.test(id)) return { speed: "fast", beta: "fast-mode-2026-02-01" };
  return null;
}

// OpenAI Fast mode (formerly Priority) is `service_tier: "fast"` on the same
// model, at a higher price. The ids are the ones on OpenAI's Fast pricing
// table, including gpt-6-astra. A dated snapshot of one of those counts too.
const OPENAI_FAST_MODELS = new Set([
  "gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-sol",
  "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
  "gpt-5.5", "gpt-5.4", "gpt-5.4-mini",
  "gpt-5.2", "gpt-5.1", "gpt-5.1-codex",
  "gpt-5", "gpt-5-mini", "gpt-5-codex",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4o", "gpt-4o-mini",
  "o3", "o4-mini",
]);
function openaiFastModel(model) {
  const id = String(model || "").trim();
  if (OPENAI_FAST_MODELS.has(id)) return true;
  const dated = id.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return dated !== id && OPENAI_FAST_MODELS.has(dated);
}
function openaiOfficial(s) {
  const raw = String(s?.baseUrl || "").trim();
  if (!raw) return true;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "api.openai.com";
  } catch { return false; }
}

// What this request adds for Fast mode, or null. The model id is not part of
// it. A model with no fast mode of its own (Sonnet, Haiku, a local name) gets
// nothing: Morse does not switch to a different model to turn the mode on.
export function fastModeExtra(s) {
  if (!s?.fastMode || !PROVIDERS[s.provider]?.fastMode) return null;
  const model = s.model || PROVIDERS[s.provider]?.defaultModel || "";
  if (s.provider === "claude-code") {
    if (model === "opus" || anthropicFast(model)) return { settings: { fastMode: true } };
    return null;
  }
  if (s.provider === "anthropic") return anthropicFast(model);
  if (s.provider === "openai" && openaiOfficial(s) && openaiFastModel(model)) return { service_tier: "fast" };
  return null;
}

// Fast mode on the request settings. The saved model id, the pin, and the
// effort stay as they are. A provider with no fast mode turns the flag off
// for this request only.
export function applyFastMode(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  if (!s.fastMode) return s;
  if (!fastModeChoice(s.provider)) return { ...s, fastMode: false };
  return s;
}

// A model chosen in the bar (prefs.modelPick). "auto" lets routing choose.
// Anything else is used for the whole request, the way `morse config --model`
// pins one name. Unknown names are ignored so a saved pref can't point the
// next request at a model this provider doesn't have.
const MODEL_PICK_RE = /^[A-Za-z0-9][\w.:/\[\]-]{0,80}$/;
function addModelId(ids, id) {
  if (typeof id !== "string" || !id || id === "auto" || !MODEL_PICK_RE.test(id) || ids.includes(id)) return;
  ids.push(id);
}
export function knownModelIds(settings) {
  const s = settings || {};
  if (!s.provider || s.provider === "none" || s.provider === "demo") return [];
  const ids = [];
  for (const id of PROVIDERS[s.provider]?.models || []) addModelId(ids, id);
  for (const id of s.listedModels || []) addModelId(ids, id);
  addModelId(ids, s.tiers?.fast?.model);
  addModelId(ids, s.tiers?.best?.model);
  if (s.pinned) addModelId(ids, s.model);
  return ids;
}
export function applyModelPick(settings, pick) {
  const s = settings && typeof settings === "object" ? settings : {};
  if (pick === "auto") return s.pinned ? { ...s, pinned: false } : s;
  if (!pick || !MODEL_PICK_RE.test(pick) || !knownModelIds(s).includes(pick)) return s;
  if (s.model === pick && s.pinned) return s;
  return { ...s, model: pick, pinned: true };
}
// What the bar's selector lists. null: this provider has no named models
// (Codex uses the plan's own model). current is the name the next request
// would start from, or "auto".
export function modelChoicesFor(settings, pick) {
  const ids = knownModelIds(settings);
  if (!ids.length) return null;
  let current = "auto";
  if (pick && pick !== "auto" && ids.includes(pick)) current = pick;
  else if (settings?.pinned && ids.includes(settings.model)) current = settings.model;
  return { ids, current };
}

// Server-side refusal fallback is only valid on these models.
const FALLBACK_MODELS = /^claude-(opus|sonnet)-5-5\b/;

export class NoModelError extends Error {
  constructor(msg = "No model is connected. Choose one in the Morse app, or run morse setup.") {
    super(msg);
    this.code = "no_model";
  }
}

const impls = {
  demo: (s, messages, o) => demoStream(messages, { ...o, ms: s.demoMs }),
  openai: openaiStream,
  anthropic: anthropicStream,
  local: openaiStream,
};

export function registerProvider(id, fn, { warm } = {}) { impls[id] = fn; if (warm) warmers[id] = warm; }

// ---- speed: get ready before the request exists. Hosts call this when the
// bar opens: Claude Code starts its next process (daemon/harness.js), the
// Anthropic API reads the instructions into its cache.
// Never throws; returns quickly and does the work in the background.
const warmers = {
  anthropic: anthropicWarm,
};
// request (optional): what the person has typed so far, not sent yet. Under
// Automatic, the model that request would start on gets ready (the strong one
// for new UI and features, core/route.js warmSettings).
export function prewarm(settings, request) {
  const s = warmSettings(applyFastMode({ ...DEFAULT_SETTINGS, ...settings }), request); // models: the model the next request starts on
  try { return Promise.resolve(warmers[s.provider]?.(s)).catch(() => {}); } catch { return Promise.resolve(); }
}

// ---- Pictures (Easier to use: Describe this image, core/a11y.js). A message's
// content may be a list of blocks in the Anthropic format, { type: "text", text }
// and { type: "image", source: { type: "base64", media_type, data } }. The
// Anthropic API takes them as they are; OpenAI and Claude Code convert them
// (toOpenAI, daemon/harness.js); Codex here only reads text.
export const imageBlocks = messages => messages.flatMap(m => (Array.isArray(m.content) ? m.content.filter(b => b?.type === "image") : []));
export const textOf = content => (Array.isArray(content) ? content.filter(b => b?.type === "text").map(b => b.text).join("\n\n") : String(content ?? ""));
const SEES_IMAGES = new Set(["anthropic", "openai", "claude-code", "demo"]);
export const seesImages = s => SEES_IMAGES.has(s?.provider);
function toOpenAI(m) {
  if (!Array.isArray(m.content)) return m;
  return { role: m.role, content: m.content.map(b => (b?.type === "image"
    ? { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
    : { type: "text", text: String(b?.text ?? "") })) };
}

// onStage({ spawnMs?, warm? }) (optional): the model has the request and is
// working on it (speed: timing, and the "Thinking" status in the bar).
export async function streamChat(settings, messages, { onToken, signal, maxTokens, onStage } = {}) {
  const s = applyFastMode({ ...DEFAULT_SETTINGS, ...settings });
  const impl = impls[s.provider];
  if (!s.provider || s.provider === "none") throw new NoModelError();
  if (!impl) throw new Error(`Morse doesn't know the model "${s.provider}". Choose another in Morse's settings.`);
  if (signal?.aborted) throw abortError();
  if (!SEES_IMAGES.has(s.provider) && imageBlocks(messages).length) throw new Error(`${PROVIDERS[s.provider]?.name || "This model"} can't look at pictures in Morse. Use Claude Code or an Anthropic API key for that.`); // Describe this image
  return impl(s, messages, { onToken, signal, maxTokens, onStage });
}

export function settingsLabel(s) {
  // models: "Automatic" until a model answers (then the bar shows which one did)
  const auto = s.mode && !s.tier && routable(s) && modeOf(s) === "auto";
  const name = PROVIDERS[s.provider]?.name;
  if (auto && name) return `${name} · ${t("settings.model.auto")}`;
  const model = s.model || PROVIDERS[s.provider]?.defaultModel || "";
  switch (s.provider) {
    case "claude-code": { const what = [model, s.effort && t("model.effort", { effort: s.effort })].filter(Boolean).join(", "); return what ? `Claude Code · ${what}` : "Claude Code"; } // models: both tiers are opus, thinking briefly or longer
    case "codex": { const what = [model, s.effort && t("model.effort", { effort: s.effort })].filter(Boolean).join(", "); return what ? `Codex · ${what}` : "Codex"; } // models: a tier may be only an effort
    case "anthropic": return `${model} · API`;
    case "openai": {
      let host = "";
      try { host = s.baseUrl ? new URL(s.baseUrl).host : ""; } catch {}
      const what = [model, s.effort && `${s.effort} effort`].filter(Boolean).join(", "); // models: the strong tier is gpt-5 thinking longer
      return !host || host === "api.openai.com" ? `${what} · API` : `${what} · ${host}`;
    }
    case "local": {
      const who = { ollama: "Ollama", lmstudio: "LM Studio", llama: "llama.cpp", llamacpp: "llama.cpp" }[s.runtime] || "Local";
      return s.model ? `${who} · ${s.model}` : who;
    }
    case "demo": return "demo replay";
    default: return t("welcome.model.b");
  }
}

// Splits chat messages into one system string and a user/assistant list.
export function splitSystem(messages) {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const rest = messages.filter(m => m.role !== "system").map(({ role, content }) => ({ role, content }));
  return { system, rest };
}

// For CLIs that take a single prompt: renders a multi-turn exchange as one
// user prompt (the engine's retry turn is "here's what you wrote, it failed").
export function flattenConversation(messages) {
  const { system, rest } = splitSystem(messages);
  if (rest.length === 1) return { system, prompt: textOf(rest[0].content) }; // textOf: pictures travel separately (harness.js)
  const prompt = rest.map(m => m.role === "assistant"
    ? `<your_previous_reply>\n${textOf(m.content)}\n</your_previous_reply>`
    : textOf(m.content)).join("\n\n");
  return { system, prompt };
}

export function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

export async function* lines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

// speed: one client per key and address, so requests reuse its connection.
let anthropicClient = null;
async function anthropicFor(s) {
  const Anthropic = await loadAnthropic();
  const id = `${s.apiKey}\u0000${s.baseUrl || ""}`;
  if (anthropicClient?.id !== id) anthropicClient = { id, client: new Anthropic({ apiKey: s.apiKey, baseURL: s.baseUrl || undefined, dangerouslyAllowBrowser: true, maxRetries: 1 }) };
  return { Anthropic, client: anthropicClient.client };
}
// speed: the instructions are the same for every request, so they go first and
// are cached (prompt caching: later requests read them instead of
// re-processing them). The page and the request vary, so they come after the
// breakpoint and are never written to the cache.
const cachedSystem = system => system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined;

async function anthropicStream(s, messages, { onToken, signal, maxTokens, onStage }) {
  if (!s.apiKey) throw new NoModelError("Add your Anthropic API key in Morse's settings.");
  const { Anthropic, client } = await anthropicFor(s);
  const { system, rest } = splitSystem(messages);
  const model = s.model || PROVIDERS.anthropic.defaultModel;
  const fast = fastModeExtra({ ...s, provider: "anthropic", model });
  const betas = [
    ...(FALLBACK_MODELS.test(model) ? ["server-side-fallback-2026-07-01"] : []),
    ...(fast?.beta ? [fast.beta] : []),
  ];
  const params = {
    model,
    max_tokens: maxTokens || 8000,
    ...(system && { system: cachedSystem(system) }),
    messages: rest,
    output_config: { effort: s.effort || "low" },
    // Fast mode: the same Opus, higher output speed, higher price (speed: "fast").
    ...(fast && { speed: "fast" }),
    // On a safety-classifier decline, the API re-runs the request on its
    // recommended fallback model inside the same stream.
    ...(betas.length && { betas }),
    ...(FALLBACK_MODELS.test(model) && { fallbacks: "default" }),
  };
  let text = "";
  try {
    const stream = client.beta.messages.stream(params, { signal });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        text += ev.delta.text;
        onToken?.(ev.delta.text);
      } else if (ev.type === "message_start") onStage?.({ stage: "ready" });
      else if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") onStage?.({ stage: "thinking" });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      const cat = final.stop_details?.category;
      throw new Error(`Claude declined this request${cat ? ` (${cat} safeguard)` : ""}. Try saying it another way.`);
    }
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key (error 401). Check it in Morse's settings.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Anthropic is busy right now (error 429). Try again in a minute.");
    if (e instanceof Anthropic.APIError && e.status) throw new Error(`Anthropic couldn't answer (error ${e.status}): ${e.error?.error?.message || e.message}`);
    throw e;
  }
  return text;
}

// speed: when the bar opens, a request with max_tokens 0 reads the
// instructions into the cache (and opens the connection), so the real request
// starts with a cache hit. Same model and effort as real requests, since both
// are part of what is cached; at most once per 4 minutes (the cache keeps
// entries for 5).
const WARM_EVERY_MS = 4 * 60_000;
const warmedAt = new Map();
async function anthropicWarm(s, { system = SYSTEM_PROMPT } = {}) {
  if (!s.apiKey || !system) return;
  const model = s.model || PROVIDERS.anthropic.defaultModel;
  const fast = fastModeExtra({ ...s, provider: "anthropic", model });
  const id = `${s.baseUrl || ""}\u0000${model}\u0000${s.effort || "low"}\u0000${fast ? "fast" : ""}`;
  if (Date.now() - (warmedAt.get(id) || 0) < WARM_EVERY_MS) return;
  warmedAt.set(id, Date.now());
  const { client } = await anthropicFor(s);
  try {
    const warm = { model, max_tokens: 0, system: cachedSystem(system), messages: [{ role: "user", content: "warmup" }], output_config: { effort: s.effort || "low" }, ...(fast && { speed: "fast" }) };
    if (fast?.beta) await client.beta.messages.create({ ...warm, betas: [fast.beta] });
    else await client.messages.create(warm);
  } catch { warmedAt.delete(id); }
}

// OpenAI chat completions over SSE: api.openai.com or any compatible server
// (OpenRouter, Azure and others). No temperature: current OpenAI
// reasoning models reject non-default values.
// models: a tier's effort becomes reasoning_effort (the strong OpenAI tier is
// gpt-5 at "high", core/route.js TIERS). Only for reasoning models (gpt-5…,
// o1/o3/o4…), since others reject the field; OpenAI's levels stop at "high".
const REASONING_MODEL = /^(gpt-5|o\d)/;
const reasoningEffort = (s, model) => (s.effort && REASONING_MODEL.test(model)
  ? { reasoning_effort: ["low", "medium", "high"].includes(s.effort) ? s.effort : "high" } : {});
const localWho = s => ({ ollama: "Ollama", lmstudio: "LM Studio", llama: "llama.cpp", llamacpp: "llama.cpp" }[s.runtime] || "The local model");
async function openaiStream(s, messages, { onToken, signal, maxTokens, onStage }) {
  const local = s.provider === "local";
  if (local && !s.baseUrl) throw Object.assign(new Error("Choose a model running on this computer."), { plain: true });
  const model = s.model || (local ? "" : PROVIDERS.openai.defaultModel);
  if (local && !model) throw Object.assign(new Error("Choose a model from the list."), { plain: true });
  // Fast mode: the same model on OpenAI's Fast service tier (Astra, gpt-5, …).
  // A different host (OpenRouter, a local server) does not get that field.
  const fastTier = !local && fastModeExtra({ ...s, provider: "openai", model });
  const base = (s.baseUrl || "https://api.openai.com").replace(/\/$/, "").replace(/\/v1$/, "");
  let res;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) },
      body: JSON.stringify({
        model, messages: messages.map(toOpenAI), stream: true,
        ...(maxTokens ? { [local ? "max_tokens" : "max_completion_tokens"]: maxTokens } : {}),
        ...(!local ? reasoningEffort(s, model) : {}),
        ...(fastTier ? { service_tier: "fast" } : {}),
      }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (local) throw Object.assign(new Error(`${localWho(s)} isn't running.`), { plain: true });
    throw e;
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch {}
    throw new Error(`The model server couldn't answer (error ${res.status})${detail ? `: ${detail}` : ". Check the model settings."}`);
  }
  onStage?.({ stage: "ready" });
  let text = "";
  for await (const line of lines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    const msg = JSON.parse(data);
    if (msg.error) throw new Error(msg.error.message || String(msg.error));
    const tok = msg.choices?.[0]?.delta?.content || "";
    if (tok) { text += tok; onToken?.(tok); }
  }
  return text;
}

// Internal test fixture: replays pre-written replies. Used by tests and the
// screenshot scripts; never offered in any UI.
// demoMs (tests only) slows the replay so Stop has time to land under load.
async function demoStream(messages, { onToken, signal, ms = 14 }) {
  const full = demoResponse(messages);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(220);
  let text = "";
  for (let i = 0; i < full.length;) {
    if (signal?.aborted) throw abortError();
    const n = 2 + Math.floor(Math.random() * 4);
    const tok = full.slice(i, i + n);
    i += n;
    text += tok;
    onToken?.(tok);
    await sleep(ms);
  }
  return text;
}
