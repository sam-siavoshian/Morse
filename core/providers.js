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
  // fast: the smaller model this provider already lists. It has to be one of
  // `models`. Codex names none. A local server's list is separate (fastFromList).
  "claude-code": { name: "Claude Code", models: ["opus", "sonnet", "haiku"], defaultModel: "", fast: "haiku" },
  codex: { name: "Codex", models: [], defaultModel: "" },
  anthropic: { name: "Anthropic API", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5", fast: "claude-haiku-5-5" },
  openai: { name: "OpenAI API", models: ["gpt-5", "gpt-5-mini"], defaultModel: "gpt-5", fast: "gpt-5-mini" },
  // A model server on this computer that speaks the OpenAI chat API (Ollama, LM Studio, llama.cpp).
  local: { name: "Local model", models: [], defaultModel: "" },
};
export const USER_PROVIDERS = Object.keys(PROVIDERS);
export const DEFAULT_SETTINGS = { provider: "", model: "", apiKey: "", baseUrl: "" };

// Words and sizes that mark a smaller model in a server's own list.
const SMALL_WORD = /(?:^|[^a-z0-9])(haiku|mini|nano|tiny|small|lite|fast)(?:[^a-z0-9]|$)/i;
const SIZE_WORD = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?:[^a-z0-9]|$)/i;
const BIGGER_TAIL = /(?:^|[^a-z0-9])(?:opus|large|xlarge|xl|pro|big|medium|\d+(?:\.\d+)?b)(?:[^a-z0-9]|$)/i;

function modelIds(listed) {
  const out = [];
  for (const m of listed || []) {
    const id = String(typeof m === "string" ? m : m?.id || "").trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// The smaller model in a server's list, or "" when there is nothing to tell
// them apart. One model is never a choice. The id is always one the list named.
export function fastFromList(listed) {
  const ids = modelIds(listed);
  if (ids.length < 2) return "";
  const hinted = ids.filter(id => SMALL_WORD.test(id));
  if (hinted.length) {
    const rank = id => {
      const s = id.toLowerCase();
      if (/(?:^|[^a-z0-9])(?:nano|tiny|haiku)(?:[^a-z0-9]|$)/.test(s)) return 0;
      if (/(?:^|[^a-z0-9])mini(?:[^a-z0-9]|$)/.test(s)) return 1;
      return 2;
    };
    return hinted.slice().sort((a, b) => rank(a) - rank(b) || a.length - b.length || (a < b ? -1 : 1))[0];
  }
  const sized = [];
  for (const id of ids) {
    const m = id.toLowerCase().match(SIZE_WORD);
    if (m) sized.push({ id, n: Number(m[1]) });
  }
  if (sized.length >= 2 && new Set(sized.map(s => s.n)).size >= 2) {
    sized.sort((a, b) => a.n - b.n || a.id.length - b.id.length);
    return sized[0].id;
  }
  const shorts = ids.filter(id => ids.some(other => {
    if (other === id || !other.startsWith(id) || other.length === id.length) return false;
    return BIGGER_TAIL.test(other.slice(id.length)) && !BIGGER_TAIL.test(id);
  }));
  return shorts.length === 1 ? shorts[0] : "";
}

// The fast model for a provider. `listed` is a local server's own models.
// Without it, only a `fast` id that is already in that provider's `models`.
export function fastModelOf(provider, listed) {
  if (Array.isArray(listed)) return fastFromList(listed);
  const spec = PROVIDERS[provider];
  if (!spec?.fast || !(spec.models || []).includes(spec.fast)) return "";
  return spec.fast;
}

// { id } when Fast mode can be shown, or null when the switch stays hidden.
export function fastModeChoice(provider, listed) {
  const id = fastModelOf(provider, listed);
  return id ? { id } : null;
}

// Fast mode on a copy of the request settings. The saved model id is left
// alone (chosenModel keeps it). Routing stays off for this request, so the
// strong model does not take back over.
export function applyFastMode(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  if (!s.fastMode) return s;
  const listed = s.provider === "local" ? s.listedModels : undefined;
  const id = fastModelOf(s.provider, listed);
  if (!id) return { ...s, fastMode: false };
  const next = { ...s, model: id, fastMode: true, pinned: true, chosenModel: s.chosenModel || s.model || "" };
  delete next.effort;
  delete next.tier;
  return next;
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
  const params = {
    model,
    max_tokens: maxTokens || 8000,
    ...(system && { system: cachedSystem(system) }),
    messages: rest,
    output_config: { effort: s.effort || "low" },
    // On a safety-classifier decline, the API re-runs the request on its
    // recommended fallback model inside the same stream.
    ...(FALLBACK_MODELS.test(model) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
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
  const id = `${s.baseUrl || ""}\u0000${model}\u0000${s.effort || "low"}`;
  if (Date.now() - (warmedAt.get(id) || 0) < WARM_EVERY_MS) return;
  warmedAt.set(id, Date.now());
  const { client } = await anthropicFor(s);
  try {
    await client.messages.create({ model, max_tokens: 0, system: cachedSystem(system), messages: [{ role: "user", content: "warmup" }], output_config: { effort: s.effort || "low" } });
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
