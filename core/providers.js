// Model providers. All stream tokens through onToken and resolve with the full
// text. Plain fetch + ReadableStream, so this runs unchanged in Node 18+ and in
// an extension service worker.

import { demoResponse } from "./demo.js";

export const DEFAULT_SETTINGS = {
  provider: "auto",            // auto | ollama | openai | demo
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen2.5-coder:7b",
  apiKey: "",
};

export async function streamChat(settings, messages, { onToken, signal } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (s.provider === "demo") return demoStream(messages, onToken, signal);
  if (s.provider === "openai") return openaiStream(s, messages, onToken, signal);
  return ollamaStream(s, messages, onToken, signal);
}

// Resolves "auto" into a concrete provider by probing for a local Ollama.
export async function resolveSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (s.provider !== "auto") return s;
  try {
    const res = await fetch(`${s.baseUrl}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) throw new Error(String(res.status));
    const { models = [] } = await res.json();
    const names = models.map(m => m.name);
    const model = names.includes(s.model) ? s.model : pickCoder(names) || s.model;
    return { ...s, provider: "ollama", model, available: names };
  } catch {
    return { ...s, provider: "demo", model: "demo" };
  }
}

function pickCoder(names) {
  return names.find(n => /coder/i.test(n)) || names.find(n => /qwen|llama|mistral|gemma|phi/i.test(n)) || names[0];
}

export function settingsLabel(s) {
  if (s.provider === "demo") return "demo model · no local model found";
  if (s.provider === "openai") return `${s.model} · ${new URL(s.baseUrl).host}`;
  return `${s.model} · local`;
}

async function* lines(res) {
  const reader = res.body.getReader();
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

async function ollamaStream(s, messages, onToken, signal) {
  const res = await fetch(`${s.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: s.model, messages, stream: true, options: { temperature: 0.2, num_ctx: 8192 } }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}${res.status === 403 ? " (set OLLAMA_ORIGINS to allow this origin)" : ""}`);
  let text = "";
  for await (const line of lines(res)) {
    const msg = JSON.parse(line);
    if (msg.error) throw new Error(msg.error);
    const tok = msg.message?.content || "";
    if (tok) { text += tok; onToken?.(tok); }
    if (msg.done) break;
  }
  return text;
}

async function openaiStream(s, messages, onToken, signal) {
  const res = await fetch(`${s.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) },
    body: JSON.stringify({ model: s.model, messages, stream: true, temperature: 0.2 }),
    signal,
  });
  if (!res.ok) throw new Error(`Model server returned ${res.status}`);
  let text = "";
  for await (const line of lines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    const tok = JSON.parse(data).choices?.[0]?.delta?.content || "";
    if (tok) { text += tok; onToken?.(tok); }
  }
  return text;
}

// Demo mode: replays pre-written responses at a local-model-like pace so the
// whole product can be tried without a model installed.
async function demoStream(messages, onToken, signal) {
  const full = demoResponse(messages);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(220);
  let text = "";
  for (let i = 0; i < full.length;) {
    if (signal?.aborted) throw new Error("aborted");
    const n = 2 + Math.floor(Math.random() * 4);
    const tok = full.slice(i, i + n);
    i += n;
    text += tok;
    onToken?.(tok);
    await sleep(14);
  }
  return text;
}
