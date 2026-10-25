// Model providers. Every provider streams tokens through onToken and resolves
// with the full text. This file runs unchanged in Node and in the extension
// service worker (bundled by scripts/build.js). Providers that need a child
// process (Claude Code, Codex) live in daemon/harness.js and register here.
//
//   claude-code  the `claude` CLI, on the user's Claude subscription (daemon)
//   codex        the `codex` CLI (daemon)
//   anthropic    Anthropic API key, through the official SDK
//   openai       OpenAI API key, or any OpenAI-compatible server
//   helper       the extension's client for the Morse helper (`morse serve`)
//   demo         internal test fixture: replays canned replies (never offered to users)

// Loaded on first use, so code that never calls the Anthropic API (the helper,
// the demo playground running this file in a browser) doesn't need the SDK.
let AnthropicSDK = null;
const loadAnthropic = async () => (AnthropicSDK ||= (await import("@anthropic-ai/sdk")).default);
import { demoResponse } from "./demo.js";
import { SYSTEM_PROMPT } from "./prompt.js"; // speed: what prewarm caches
import { warmSettings, routable, modeOf } from "./route.js"; // models: fast and strong (docs/models.md)
import { t } from "./i18n.js"; // the labels people read (the host sets the language)

export const PROVIDERS = {
  "claude-code": { name: "Claude Code", models: ["opus", "sonnet", "haiku"], defaultModel: "" },
  codex: { name: "Codex", models: [], defaultModel: "" },
  anthropic: { name: "Anthropic API", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5" },
  openai: { name: "OpenAI API", models: ["gpt-5", "gpt-5-mini"], defaultModel: "gpt-5" },
};
export const USER_PROVIDERS = Object.keys(PROVIDERS);
export const HELPER_PORT = 7457;
export const HELPER_URL = `http://127.0.0.1:${HELPER_PORT}`;
// Tests only: chrome.storage.local "morse.helperPort" moves the extension's
// helper off 7457, so several test runs (each with its own `morse serve` on
// MORSE_HELPER_PORT) can run at once. Only the service worker reads it, and
// only the extension's own pages and worker can write it (background.js
// keeps chrome.storage.local away from content scripts; no message sets it).
// The helper is always on 127.0.0.1; anything but a whole number in
// 1024-65535 means the default.
export const HELPER_PORT_KEY = "morse.helperPort";
export const validHelperPort = v => (Number.isInteger(v) && v >= 1024 && v <= 65535 ? v : null);
export const helperUrlFor = port => `http://127.0.0.1:${validHelperPort(port) ?? HELPER_PORT}`;

export const DEFAULT_SETTINGS = { provider: "", model: "", apiKey: "", baseUrl: "" };

// Server-side refusal fallback is only valid on these models.
const FALLBACK_MODELS = /^claude-(opus|sonnet)-5-5\b/;

export class NoModelError extends Error {
  constructor(msg = "No model is connected. Run morse serve, or add an API key in Morse's settings.") {
    super(msg);
    this.code = "no_model";
  }
}

const impls = {
  demo: (s, messages, o) => demoStream(messages, { ...o, ms: s.demoMs }),
  openai: openaiStream,
  anthropic: anthropicStream,
  helper: helperStream,
};

export function registerProvider(id, fn, { warm } = {}) { impls[id] = fn; if (warm) warmers[id] = warm; }

// ---- speed: get ready before the request exists. Hosts call this when the
// bar opens: Claude Code starts its next process (daemon/harness.js), the
// Anthropic API reads the instructions into its cache, the helper passes it on.
// Never throws; returns quickly and does the work in the background.
const warmers = {
  anthropic: anthropicWarm,
  helper: s => fetch(`${s.baseUrl || HELPER_URL}/v1/warm`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token || ""}` }, body: JSON.stringify({ ...(s.model && { model: s.model }), ...(s.effort && { effort: s.effort }) }),
  }).catch(() => {}),
};
// request (optional): what the person has typed so far, not sent yet. Under
// Automatic, the model that request would start on gets ready (the strong one
// for new UI and features, core/route.js warmSettings).
export function prewarm(settings, request) {
  const s = warmSettings({ ...DEFAULT_SETTINGS, ...settings }, request); // models: the model the next request starts on
  try { return Promise.resolve(warmers[s.provider]?.(s)).catch(() => {}); } catch { return Promise.resolve(); }
}

// ---- Pictures (Easier to use: Describe this image, core/a11y.js). A message's
// content may be a list of blocks in the Anthropic format, { type: "text", text }
// and { type: "image", source: { type: "base64", media_type, data } }. The
// Anthropic API takes them as they are; OpenAI and Claude Code convert them
// (toOpenAI, daemon/harness.js); Codex here only reads text.
export const imageBlocks = messages => messages.flatMap(m => (Array.isArray(m.content) ? m.content.filter(b => b?.type === "image") : []));
export const textOf = content => (Array.isArray(content) ? content.filter(b => b?.type === "text").map(b => b.text).join("\n\n") : String(content ?? ""));
const SEES_IMAGES = new Set(["anthropic", "openai", "claude-code", "helper", "demo"]);
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
  const s = { ...DEFAULT_SETTINGS, ...settings };
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
  const name = PROVIDERS[s.provider === "helper" ? s.backend : s.provider]?.name;
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
    case "helper": return s.label || "Morse helper";
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
async function openaiStream(s, messages, { onToken, signal, maxTokens, onStage }) {
  const base = (s.baseUrl || "https://api.openai.com").replace(/\/$/, "").replace(/\/v1$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) },
    body: JSON.stringify({ model: s.model || PROVIDERS.openai.defaultModel, messages: messages.map(toOpenAI), stream: true, ...(maxTokens && { max_completion_tokens: maxTokens }), ...reasoningEffort(s, s.model || PROVIDERS.openai.defaultModel) }),
    signal,
  });
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

// models: after an escalated request, the helper keeps the model the next
// request starts on warm, not the strong one it just used.
function nextWarm(s) {
  if (!routable(s)) return {};
  const w = warmSettings(s);
  return { next: { model: w.model || "", ...(w.effort && { effort: w.effort }) } };
}

// The extension's client for the Morse helper: POST /v1/complete returns
// NDJSON {type: token|done|error}. Aborting the fetch closes the connection,
// and the helper kills the harness process.
async function helperStream(s, messages, { onToken, signal, onStage }) {
  let res;
  try {
    res = await fetch(`${s.baseUrl || HELPER_URL}/v1/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token || ""}` },
      body: JSON.stringify({ messages, ...(s.model && { model: s.model }), ...(s.effort && { effort: s.effort }), ...nextWarm(s) }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw new NoModelError("Can't reach the Morse helper. Run morse serve on this computer.");
  }
  if (res.status === 401) throw new NoModelError("The Morse helper doesn't recognize this browser. Pair again in Morse's settings.");
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).error || ""; } catch {}
    throw new Error(`The Morse helper couldn't answer (error ${res.status})${msg ? `: ${msg}` : ". Try again."}`);
  }
  let text = "";
  for await (const line of lines(res.body)) {
    const ev = JSON.parse(line);
    if (ev.type === "token") { text += ev.text; onToken?.(ev.text); }
    else if (ev.type === "stage") onStage?.(ev); // speed: the model started, or is thinking
    else if (ev.type === "error") throw new Error(ev.message);
    else if (ev.type === "done") return typeof ev.text === "string" ? ev.text : text;
  }
  if (signal?.aborted) throw abortError();
  throw new Error("The Morse helper stopped before the change was done. Try again.");
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
