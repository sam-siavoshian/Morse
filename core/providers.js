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

export const PROVIDERS = {
  "claude-code": { name: "Claude Code", models: ["opus", "sonnet", "haiku"], defaultModel: "" },
  codex: { name: "Codex", models: [], defaultModel: "" },
  anthropic: { name: "Anthropic API", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], defaultModel: "claude-opus-5-5" },
  openai: { name: "OpenAI API", models: ["gpt-5", "gpt-5-mini"], defaultModel: "gpt-5" },
};
export const USER_PROVIDERS = Object.keys(PROVIDERS);
export const HELPER_URL = "http://127.0.0.1:7457";
export const HELPER_PORT = 7457;

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

export function registerProvider(id, fn) { impls[id] = fn; }

export async function streamChat(settings, messages, { onToken, signal, maxTokens } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const impl = impls[s.provider];
  if (!s.provider || s.provider === "none") throw new NoModelError();
  if (!impl) throw new Error(`Morse doesn't know the model "${s.provider}". Choose another in Morse's settings.`);
  if (signal?.aborted) throw abortError();
  return impl(s, messages, { onToken, signal, maxTokens });
}

export function settingsLabel(s) {
  const model = s.model || PROVIDERS[s.provider]?.defaultModel || "";
  switch (s.provider) {
    case "claude-code": return model ? `Claude Code · ${model}` : "Claude Code";
    case "codex": return model ? `Codex · ${model}` : "Codex";
    case "anthropic": return `${model} · API`;
    case "openai": {
      let host = "";
      try { host = s.baseUrl ? new URL(s.baseUrl).host : ""; } catch {}
      return !host || host === "api.openai.com" ? `${model} · API` : `${model} · ${host}`;
    }
    case "helper": return s.label || "Morse helper";
    case "demo": return "demo replay";
    default: return "Connect a model";
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
  if (rest.length === 1) return { system, prompt: rest[0].content };
  const prompt = rest.map(m => m.role === "assistant"
    ? `<your_previous_reply>\n${m.content}\n</your_previous_reply>`
    : m.content).join("\n\n");
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

async function anthropicStream(s, messages, { onToken, signal, maxTokens }) {
  if (!s.apiKey) throw new NoModelError("Add your Anthropic API key in Morse's settings.");
  const Anthropic = await loadAnthropic();
  const client = new Anthropic({ apiKey: s.apiKey, baseURL: s.baseUrl || undefined, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const { system, rest } = splitSystem(messages);
  const model = s.model || PROVIDERS.anthropic.defaultModel;
  const params = {
    model,
    max_tokens: maxTokens || 8000,
    ...(system && { system }),
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
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      const cat = final.stop_details?.category;
      throw new Error(`Claude declined this request${cat ? ` (${cat} safeguard)` : ""}. Try saying it another way.`);
    }
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key (401). Check it in Morse's settings.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Too many requests to Anthropic right now (429). Try again in a minute.");
    if (e instanceof Anthropic.APIError && e.status) throw new Error(`Anthropic couldn't answer (error ${e.status}): ${e.error?.error?.message || e.message}`);
    throw e;
  }
  return text;
}

// OpenAI chat completions over SSE: api.openai.com or any compatible server
// (llama.cpp, LM Studio, vLLM, OpenRouter...). No temperature: current OpenAI
// reasoning models reject non-default values.
async function openaiStream(s, messages, { onToken, signal, maxTokens }) {
  const base = (s.baseUrl || "https://api.openai.com").replace(/\/$/, "").replace(/\/v1$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) },
    body: JSON.stringify({ model: s.model || PROVIDERS.openai.defaultModel, messages, stream: true, ...(maxTokens && { max_completion_tokens: maxTokens }) }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch {}
    throw new Error(`The model server couldn't answer (error ${res.status})${detail ? `: ${detail}` : ". Check the model settings."}`);
  }
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

// The extension's client for the Morse helper: POST /v1/complete returns
// NDJSON {type: token|done|error}. Aborting the fetch closes the connection,
// and the helper kills the harness process.
async function helperStream(s, messages, { onToken, signal }) {
  let res;
  try {
    res = await fetch(`${s.baseUrl || HELPER_URL}/v1/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token || ""}` },
      body: JSON.stringify({ messages, ...(s.model && { model: s.model }) }),
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
