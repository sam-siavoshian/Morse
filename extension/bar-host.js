// Extension-side handlers for the command bar: stop a generation, settings,
// prompt history and voice transcription. background.js routes these message
// types here (BAR_REQUESTS) so its own dispatch stays small.
//
//   settings  chrome.storage.sync "morse.settings" (follows the user's Chrome profile)
//   history   chrome.storage.local "morse.history" { [site]: [prompt, ...] }
//   voice     the Morse helper (http://127.0.0.1:7457/v1/transcribe) when it's
//             running and paired, else OpenAI with the user's key

import { normalizePrefs, mergePrefs, pushHistory } from "../core/prefs.js";
import { transcribeOpenAI, OPENAI_TRANSCRIBE_MODEL } from "../core/transcribe.js";
import { Generations } from "../core/cancel.js";
import { hostOf } from "../core/mod.js";

export const gens = new Generations();
export const BAR_REQUESTS = new Set(["generate.cancel", "settings.get", "settings.set", "history.get", "history.add", "transcribe"]);

const HELPER = "http://127.0.0.1:7457";
const PREFS_KEY = "morse.settings", HISTORY_KEY = "morse.history";

const local = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
// sync can be unavailable (signed out, policy); local keeps working.
async function syncGet(k) {
  try { const v = (await chrome.storage.sync.get(k))[k]; if (v !== undefined) return v; } catch {}
  return local(k, undefined);
}
async function syncSet(k, v) {
  try { await chrome.storage.sync.set({ [k]: v }); } catch { await chrome.storage.local.set({ [k]: v }); }
}

export async function getPrefs() { return normalizePrefs(await syncGet(PREFS_KEY)); }
export async function setPrefs(patch) {
  const next = mergePrefs(await getPrefs(), patch);
  await syncSet(PREFS_KEY, next);
  return next;
}

async function history(scope, text) {
  const all = await local(HISTORY_KEY, {});
  if (text === undefined) return all[scope] || [];
  all[scope] = pushHistory(all[scope], text);
  await chrome.storage.local.set({ [HISTORY_KEY]: all });
  return all[scope];
}

// ---- voice

// The pairing record the helper's pairing flow leaves in storage.local.
async function pairing() {
  for (const k of ["helper", "bridge", "pairing"]) {
    const v = await local(k, null);
    if (v && typeof v === "object" && (v.token || v.paired)) return { url: v.url || (v.port ? `http://127.0.0.1:${v.port}` : HELPER), token: v.token || "" };
  }
  return null;
}
const auth = p => (p?.token ? { Authorization: `Bearer ${p.token}` } : {});

let helperSeen = null, helperAt = 0;
async function helperVoice() {
  const p = await pairing();
  if (!p) return null;
  if (helperSeen !== null && Date.now() - helperAt < 15000) return helperSeen ? p : null;
  try {
    const r = await fetch(`${p.url}/v1/voice`, { headers: auth(p), signal: AbortSignal.timeout(600) });
    helperSeen = r.ok && !!(await r.json()).transcribe;
  } catch { helperSeen = false; }
  helperAt = Date.now();
  return helperSeen ? p : null;
}

async function openaiKey() {
  const v = await local("voice", {});
  if (v?.openaiKey) return { apiKey: v.openaiKey, baseUrl: v.openaiBaseUrl };
  const m = await local("settings", {});
  if (m?.provider === "openai" && m.apiKey && /(^|\.)openai\.com$/.test(hostOf(m.baseUrl || ""))) return { apiKey: m.apiKey };
  return null;
}

export async function voiceInfo() {
  if (await helperVoice()) return { transcribe: true, provider: "helper", label: "the Morse helper on this computer", hint: "" };
  if (await openaiKey()) return { transcribe: true, provider: "openai", label: `OpenAI ${OPENAI_TRANSCRIBE_MODEL}`, hint: "" };
  return { transcribe: false, provider: null, label: "", hint: "Voice: add an OpenAI key in the Morse popup, or run the Morse helper" };
}

async function transcribe(msg) {
  const p = await helperVoice();
  if (p) {
    const r = await fetch(`${p.url}/v1/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json", ...auth(p) },
      body: JSON.stringify({ audio: msg.audio, mime: msg.mime }), signal: AbortSignal.timeout(120000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `The Morse helper returned ${r.status}`);
    return body;
  }
  const key = await openaiKey();
  if (!key) throw new Error((await voiceInfo()).hint);
  return transcribeOpenAI({ audio: msg.audio, mime: msg.mime, ...key, signal: AbortSignal.timeout(120000) });
}

export async function handleBarRequest(msg) {
  const scope = String(msg.scope || hostOf(msg.url || "") || "page");
  switch (msg.type) {
    case "generate.cancel": return gens.cancel(msg.genId);
    case "settings.get": return getPrefs();
    case "settings.set": return setPrefs(msg.settings);
    case "history.get": return history(scope);
    case "history.add": return history(scope, String(msg.text || ""));
    case "transcribe": return transcribe(msg);
  }
  throw new Error(`Unknown request ${msg.type}`);
}
