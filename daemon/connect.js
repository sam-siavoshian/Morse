// Whether a model can be connected, without saving anything and without a
// live Claude or Codex account. Desktop calls this when the person opens
// Choose, not while the window is first painting.
//
// A choice the window can show:
//   { id, name, kind: "cli"|"api"|"local", status, logo, found, detail,
//     signedIn, models, recommended, why, install, keyEnv }
// status is one of: ready, missing, signed-out, bad-key, server-down.
// A missing program, a rejected key, or a server that isn't running is not
// ready, and connectChoice refuses to save it.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCAL_IDS, LOCAL_RUNTIMES, runtimeById } from "./local-runtimes.js";
import { BACKENDS, configFor, detectBackends, keyVendor } from "./setup.js";
import { keysFrom } from "./models.js";

const LOGO = {
  "claude-code": "claude", codex: "openai", "api-key": "anthropic",
  anthropic: "anthropic", openai: "openai",
  ollama: "ollama", lmstudio: "lmstudio", llama: "llamacpp", llamacpp: "llamacpp", local: "local",
};

export function kindFor(s) {
  if (!s?.provider || s.provider === "none" || s.provider === "demo") return "";
  if (s.provider === "local") return "local";
  if (s.provider === "claude-code" || s.provider === "codex") return "cli";
  if (s.provider === "anthropic" || s.provider === "openai") return "api";
  return "";
}

export function logoFor(s) {
  if (s?.provider === "local") return LOGO[s.runtime] || "local";
  return LOGO[s?.provider] || "";
}

const signOut = {
  "claude-code": "Claude Code is installed, but you're not signed in. Run claude in a terminal and sign in.",
  codex: "Codex is installed, but you're not signed in. Run codex in a terminal and sign in.",
};

export function loopbackOrigin(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return ""; }
  if (u.username || u.password || u.search || u.hash) return "";
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return "";
  return u.origin;
}

export function modelsFromBody(body) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const out = [];
  for (const m of rows) {
    const id = typeof m === "string" ? m : String(m?.id || m?.name || m?.model || "");
    if (!id) continue;
    const name = typeof m === "object" && m ? String(m.name || m.id || id) : id;
    if (!out.some(x => x.id === id)) out.push({ id, name });
  }
  return out;
}

function netFailed(e) {
  const code = e?.cause?.code || e?.code || "";
  const msg = `${e?.name || ""} ${e?.message || ""} ${code}`;
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|fetch failed|network|AbortError|TimeoutError|timedout|aborted/i.test(msg);
}

// One local server. Connection refused or a timeout is "server-down", never ready.
export async function probeLocalRuntime(runtime, { fetch: doFetch = globalThis.fetch, timeoutMs = 800 } = {}) {
  const name = runtime?.name || "The local model";
  const root = String(runtime?.baseUrl || "").replace(/\/$/, "");
  const row = {
    id: runtime?.id || "local", name, kind: "local", logo: runtime?.logo || LOGO[runtime?.id] || "local",
    why: runtime?.why || "a model running on this computer", install: runtime?.install || "",
    found: false, signedIn: false, keyEnv: "", models: [], baseUrl: root, recommended: false,
  };
  if (!root) return { ...row, status: "missing", detail: "Add the address of a model running on this computer." };
  const fetchModels = async (pathname) => {
    const res = await doFetch(`${root}${pathname}`, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  };
  try {
    let res = await fetchModels("/v1/models");
    if (res.status === 404) res = await fetchModels("/api/tags");
    if (res.status === 401 || res.status === 403) return { ...row, status: "bad-key", detail: `${name} rejected the key.` };
    if (res.status < 200 || res.status >= 300) return { ...row, status: "server-down", detail: `${name} isn't running.` };
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text.slice(0, 1_000_000)); } catch { body = {}; }
    const models = modelsFromBody(body);
    if (!models.length) return { ...row, status: "missing", detail: `${name} is running, but no model is loaded.` };
    return { ...row, status: "ready", found: true, detail: "Running.", models };
  } catch (e) {
    if (netFailed(e)) return { ...row, status: "server-down", detail: `${name} isn't running.` };
    return { ...row, status: "server-down", detail: `${name} isn't running.` };
  }
}

export function runCommand(file, args, { timeoutMs = 4000, env = process.env } = {}) {
  return new Promise(resolve => {
    let out = "", err = "", done = false;
    const finish = (row) => { if (done) return; done = true; resolve(row); };
    let child;
    try { child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env }); }
    catch (e) { return finish({ code: 1, out: "", err: e.message || "" }); }
    const t = setTimeout(() => { try { child.kill(); } catch {} finish({ code: null, out, err, timeout: true }); }, timeoutMs);
    child.stdout?.on("data", d => { out = (out + d).slice(-4000); });
    child.stderr?.on("data", d => { err = (err + d).slice(-4000); });
    child.on("error", e => { clearTimeout(t); finish({ code: 1, out, err: e.message || "" }); });
    child.on("close", code => { clearTimeout(t); finish({ code, out, err }); });
  });
}

function jsonFrom(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function parseClaude(r) {
  if (!r || r.timeout) return null;
  const j = jsonFrom(r.out) || jsonFrom(r.err);
  if (j && typeof j.loggedIn === "boolean") return j.loggedIn ? "ready" : "signed-out";
  const text = `${r.out}\n${r.err}`;
  if (/not logged in|not signed in|please run \/login|run claude auth login/i.test(text)) return "signed-out";
  if (r.code === 0 && /logged in|signed in/i.test(text)) return "ready";
  return null;
}

function parseCodex(r) {
  if (!r || r.timeout) return null;
  const text = `${r.out}\n${r.err}`;
  if (/not logged in/i.test(text)) return "signed-out";
  if (r.code === 0 && /logged in/i.test(text)) return "ready";
  return null;
}

async function readText(readFile, p) {
  try { return String(await readFile(p) || "").slice(0, 65536); } catch { return ""; }
}

async function claudeFileSignedIn(home, readFile) {
  const cred = await readText(readFile, path.join(home, ".claude", ".credentials.json"));
  const dot = await readText(readFile, path.join(home, ".claude.json"));
  for (const raw of [cred, dot]) {
    if (!raw) continue;
    try {
      const j = JSON.parse(raw);
      const o = j?.claudeAiOauth;
      if (typeof o?.accessToken === "string" && o.accessToken) return true;
      if (typeof o?.refreshToken === "string" && o.refreshToken) return true;
      if (typeof j?.primaryApiKey === "string" && j.primaryApiKey) return true;
    } catch { /* not a credential file */ }
  }
  return false;
}

async function codexFileSignedIn(home, readFile) {
  const raw = await readText(readFile, path.join(home, ".codex", "auth.json"));
  if (!raw) return false;
  try {
    const j = JSON.parse(raw);
    const t = j?.tokens;
    if (typeof t?.access_token === "string" && t.access_token) return true;
    if (typeof t?.refresh_token === "string" && t.refresh_token) return true;
    if (typeof j?.OPENAI_API_KEY === "string" && j.OPENAI_API_KEY) return true;
  } catch { /* ignore */ }
  return false;
}

// Installed and signed in, or not. A missing binary is "missing" and is never signed in.
export async function cliAuth({ id, bin, run = runCommand, env = process.env, home = env.HOME || os.homedir(), readFile = p => fs.readFile(p, "utf8") }) {
  if (!bin) return { signedIn: false, status: "missing" };
  if (id === "claude-code" && env.ANTHROPIC_API_KEY) return { signedIn: true, status: "ready" };
  const ran = id === "claude-code"
    ? await run(bin, ["auth", "status"], { env, timeoutMs: 4000 })
    : await run(bin, ["login", "status"], { env, timeoutMs: 4000 });
  let status = id === "claude-code" ? parseClaude(ran) : parseCodex(ran);
  if (!status) {
    const file = id === "claude-code" ? await claudeFileSignedIn(home, readFile) : await codexFileSignedIn(home, readFile);
    if (file) status = "ready";
    else if (id === "codex" && env.OPENAI_API_KEY && ran?.timeout) status = "ready";
    else status = "signed-out";
  }
  return { signedIn: status === "ready", status };
}

export async function probeApiKey({ vendor, key, baseUrl = "", fetch: doFetch = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const name = vendor === "anthropic" ? "Anthropic" : "OpenAI";
  if (!key) return { ok: false, status: "missing", error: "Paste your API key first." };
  const root = String(baseUrl || (vendor === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com")).replace(/\/$/, "").replace(/\/v1$/, "");
  const headers = vendor === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${key}` };
  try {
    const res = await doFetch(`${root}/v1/models`, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401 || res.status === 403) return { ok: false, status: "bad-key", error: `${name} rejected this API key.` };
    if (res.status < 200 || res.status >= 300) return { ok: false, status: "error", error: `${name} couldn't be reached to check the key.` };
    return { ok: true, status: "ready" };
  } catch (e) {
    if (netFailed(e)) return { ok: false, status: "error", error: `${name} couldn't be reached to check the key.` };
    return { ok: false, status: "error", error: `${name} couldn't be reached to check the key.` };
  }
}

function cliRowBase(id) {
  const b = BACKENDS.find(x => x.id === id);
  return { id, name: b?.name || id, why: b?.why || "", install: b?.install || "", kind: "cli", logo: LOGO[id], models: [], keyEnv: "", recommended: false };
}

async function describeCli(id, detected, opts) {
  const row = detected.find(r => r.id === id) || {};
  if (!row.found || !row.path) return { ...cliRowBase(id), found: false, signedIn: false, status: "missing", detail: "Not installed." };
  const auth = await cliAuth({ id, bin: row.path, ...opts });
  const detail = auth.signedIn ? ["Signed in", row.version].filter(Boolean).join(" · ") : (signOut[id] || "Not signed in.");
  return { ...cliRowBase(id), found: true, signedIn: auth.signedIn, status: auth.status, detail, path: row.path || "", version: row.version || "" };
}

function legacyKeyRow(keys) {
  const b = BACKENDS.find(x => x.id === "api-key");
  const vendor = keys.anthropic ? "anthropic" : keys.openai ? "openai" : "";
  const keyEnv = vendor === "anthropic" ? "ANTHROPIC_API_KEY" : vendor === "openai" ? "OPENAI_API_KEY" : "";
  return {
    id: "api-key", name: b?.name || "API key", kind: "api", logo: vendor === "openai" ? "openai" : "anthropic",
    vendor, found: !!vendor, signedIn: false, models: [], recommended: false, install: b?.install || "",
    status: vendor ? "ready" : "missing", keyEnv, path: "", baseUrl: "",
    detail: vendor ? `${keyEnv} is set.` : "Paste an API key.",
    why: b?.why || "uses an API key",
  };
}

function apiRow(id, name, found, keyEnv) {
  return {
    id, name, kind: "api", logo: LOGO[id], vendor: id, found, signedIn: false, models: [], recommended: false, install: "",
    status: found ? "ready" : "missing",
    keyEnv: found ? keyEnv : "",
    detail: found ? `${keyEnv} is set.` : "Paste an API key.",
    why: id === "anthropic" ? "uses an Anthropic API key" : "uses an OpenAI API key",
    path: "", baseUrl: "",
  };
}

// One "Local" row for a typed address, plus the state of the servers Morse
// already knows. A server that isn't running says so. It is not "ready".
function localSummary(locals) {
  const up = locals.find(r => r.status === "ready");
  const base = {
    id: "local", name: "Local", kind: "local", logo: "local", signedIn: false, recommended: false,
    why: "a model running on this computer", install: "", keyEnv: "", path: "",
  };
  if (up) return { ...base, found: true, status: "ready", detail: "Running.", models: up.models, baseUrl: up.baseUrl || "" };
  const empty = locals.find(r => /no model is loaded/i.test(r.detail || ""));
  if (empty) return { ...base, found: false, status: "missing", detail: empty.detail, models: [], baseUrl: empty.baseUrl || "" };
  const down = locals.find(r => r.status === "server-down");
  if (down) return { ...base, found: false, status: "server-down", detail: down.detail, models: [], baseUrl: "" };
  return { ...base, found: false, status: "missing", detail: "Add the address of a model running on this computer.", models: [], baseUrl: "" };
}

// Every choice, with what is actually on this computer. Safe to call when
// the person opens Choose. Not part of the first paint.
export async function connectionChoices(opts = {}) {
  const env = opts.env || process.env;
  const detected = await (opts.detectBackends || detectBackends)({ ...opts, env });
  const runtimes = opts.runtimes || LOCAL_RUNTIMES;
  const [claude, codex, locals] = await Promise.all([
    describeCli("claude-code", detected, { ...opts, env }),
    describeCli("codex", detected, { ...opts, env }),
    Promise.all(runtimes.map(rt => probeLocalRuntime(rt, opts))),
  ]);
  const keys = keysFrom({}, env);
  const all = [
    claude, codex,
    apiRow("anthropic", "Anthropic", !!keys.anthropic, "ANTHROPIC_API_KEY"),
    apiRow("openai", "OpenAI", !!keys.openai, "OPENAI_API_KEY"),
    legacyKeyRow(keys),
    ...locals,
    localSummary(locals),
  ];
  const best = all.find(r => r.status === "ready" && r.kind !== "local") || all.find(r => r.status === "ready") || null;
  return all.map(r => ({ ...r, recommended: !!best && best.id === r.id }));
}

async function connectCli(id, opts) {
  const env = opts.env || process.env;
  const detected = await (opts.detectBackends || detectBackends)({ ...opts, env });
  const row = await describeCli(id, detected, { ...opts, env });
  if (row.status === "missing") return { error: `${row.name} isn't installed on this computer yet. Install it, then choose it here.`, status: "missing" };
  if (row.status !== "ready") return { error: row.detail, status: row.status };
  return { backend: id, config: configFor(id), status: "ready" };
}

async function connectApi(id, key, opts) {
  const env = opts.env || process.env;
  key = String(key || "").trim();
  let vendor = id === "anthropic" || id === "openai" ? id : "";
  if (key && vendor === "anthropic" && keyVendor(key) !== "anthropic") return { error: "That key doesn't look like an Anthropic API key.", status: "bad-key" };
  if (key && vendor === "openai" && keyVendor(key) === "anthropic") return { error: "That key doesn't look like an OpenAI API key.", status: "bad-key" };
  if (!vendor) vendor = key ? keyVendor(key) : "";
  const keys = keysFrom({}, env);
  if (!vendor) {
    const detected = await (opts.detectBackends || detectBackends)({ ...opts, env });
    vendor = detected.find(r => r.id === "api-key")?.vendor || (keys.anthropic ? "anthropic" : keys.openai ? "openai" : "");
  }
  const useKey = key || (vendor && keys[vendor]) || "";
  if (!useKey || !vendor) return { error: "Paste your API key first.", status: "missing" };
  const probe = await probeApiKey({ vendor, key: useKey, baseUrl: opts.apiBase?.[vendor] || "", fetch: opts.fetch, timeoutMs: opts.timeoutMs });
  if (!probe.ok) return { error: probe.error, status: probe.status === "bad-key" ? "bad-key" : probe.status };
  const config = key ? configFor("api-key", { key: useKey, vendor }) : configFor("api-key", { vendor });
  return { backend: id === "api-key" ? "api-key" : id, config, status: "ready" };
}

function pickedModel(rt, probed, key) {
  const model = String(key || "").trim() || probed.models[0]?.id || "";
  if (probed.status === "server-down") return { error: probed.detail, status: "server-down" };
  if (!model || !probed.models.length) return { error: probed.detail || `${rt.name} is running, but no model is loaded.`, status: probed.status === "ready" ? "missing" : probed.status };
  if (!probed.models.some(m => m.id === model)) return { error: `${rt.name} doesn't have that model. Choose one it lists.`, status: "missing" };
  return { model };
}

async function connectLocal(id, key, opts) {
  const runtimes = opts.runtimes || LOCAL_RUNTIMES;
  if (id === "llamacpp") id = "llama";
  let rt = runtimeById(id, runtimes);
  if (id === "local") {
    const typed = String(opts.address || "").trim();
    const origin = loopbackOrigin(typed);
    if (typed && !origin) return { error: "That address isn't on this computer.", status: "missing" };
    if (!origin) {
      const probed = await Promise.all(runtimes.map(r => probeLocalRuntime(r, opts)));
      const up = probed.find(p => p.status === "ready");
      if (!up) return { error: probed[0]?.detail || "Ollama isn't running.", status: probed[0]?.status || "server-down" };
      rt = runtimeById(up.id, runtimes) || { id: up.id, name: up.name, baseUrl: up.baseUrl };
      const pick = pickedModel(rt, up, key);
      if (pick.error) return pick;
      return { backend: up.id, config: configFor(up.id, { model: pick.model, baseUrl: up.baseUrl }), status: "ready" };
    }
    rt = { id: "local", name: "Local", logo: "local", kind: "local", baseUrl: origin, why: "a model running on this computer", install: "" };
  }
  if (!rt) return { error: "Choose a model running on this computer.", status: "missing" };
  const probed = await probeLocalRuntime(rt, opts);
  const pick = pickedModel(rt, probed, key);
  if (pick.error) return pick;
  return { backend: id, config: configFor(id, { model: pick.model, baseUrl: probed.baseUrl || rt.baseUrl }), status: "ready" };
}

// Save nothing here. The desktop service saves only when this returns config.
export async function connectChoice(choice, key = "", opts = {}) {
  const id = String(choice || "") === "llamacpp" ? "llama" : String(choice || "");
  if (id === "claude-code" || id === "codex") return connectCli(id, opts);
  if (id === "api-key" || id === "anthropic" || id === "openai") return connectApi(id, key, opts);
  if (LOCAL_IDS.has(id)) return connectLocal(id, key, opts);
  return { error: "Choose Claude Code, Codex, an API key, or a local model.", status: "missing" };
}
