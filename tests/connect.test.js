// Connecting a model: Claude Code, Codex, an API key, and a model server on
// this computer. Nothing here talks to a live account. CLIs and HTTP are fakes.
import { tempDir } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { connectionChoices, connectChoice, probeLocalRuntime, cliAuth, probeApiKey, loopbackOrigin } from "../daemon/connect.js";
import { applyChoice, runSetup } from "../daemon/setup.js";
import { settingsFromConfig } from "../daemon/models.js";
import { streamChat } from "../core/providers.js";
import { plainError } from "../core/onboarding.js";
import { createService } from "../desktop-app/service.js";

const none = { claude: { found: false }, codex: { found: false } };
const read = cfg => settingsFromConfig(cfg, {}, { env: {}, harnesses: none });

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(r => server.close(r)),
    }));
  });
}

const modelsJson = (ids, extra = {}) => (req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: ids.map(id => ({ id })), ...extra }));
    return;
  }
  res.writeHead(404);
  res.end();
};

test("a loopback address is the only one a local model may use", () => {
  assert.equal(loopbackOrigin("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.equal(loopbackOrigin("http://localhost:1234/v1"), "http://localhost:1234");
  assert.equal(loopbackOrigin("http://[::1]:8080"), "http://[::1]:8080");
  assert.equal(loopbackOrigin("http://example.com"), "");
  assert.equal(loopbackOrigin("http://127.0.0.1:11434?x=1"), "");
  assert.equal(loopbackOrigin("file:///etc/passwd"), "");
});

test("Claude Code and Codex: missing, not signed in, and signed in", async () => {
  const home = tempDir("morse-cli-auth-");
  const detect = async () => [
    { id: "claude-code", found: false, path: "", detail: "not installed" },
    { id: "codex", found: true, path: "/bin/codex", version: "0.1.0", detail: "" },
    { id: "api-key", found: false },
  ];
  const missing = await connectChoice("claude-code", "", { detectBackends: detect, env: {}, run: async () => { throw new Error("should not run"); } });
  assert.equal(missing.status, "missing");
  assert.match(missing.error, /isn't installed/);
  assert.equal(missing.config, undefined);

  const signedOut = await cliAuth({ id: "codex", bin: "/bin/codex", env: {}, home, run: async () => ({ code: 1, out: "Not logged in", err: "" }), readFile: async () => { throw new Error("no file"); } });
  assert.deepEqual(signedOut, { signedIn: false, status: "signed-out" });
  const refused = await connectChoice("codex", "", {
    detectBackends: detect, env: {}, home,
    run: async () => ({ code: 1, out: "Not logged in", err: "" }),
    readFile: async () => { throw new Error("no file"); },
  });
  assert.equal(refused.status, "signed-out");
  assert.match(refused.error, /not signed in/);
  assert.equal(refused.config, undefined);

  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  await fs.writeFile(path.join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "secret-token" } }));
  const signed = await connectChoice("claude-code", "", {
    detectBackends: async () => [{ id: "claude-code", found: true, path: "/bin/claude", version: "2.0.0" }],
    env: {}, home,
    run: async () => ({ code: 0, out: "", err: "", timeout: true }),
  });
  assert.equal(signed.status, "ready");
  assert.deepEqual(signed.config, { provider: "claude-code" });
  assert.equal(JSON.stringify(signed).includes("secret-token"), false);
});

test("an API key is accepted or rejected, and the key is not in the error", async () => {
  const secret = "sk-ant-test-secret";
  const bad = await listen((req, res) => { res.writeHead(401); res.end('{"error":"no"}'); });
  try {
    const r = await probeApiKey({ vendor: "anthropic", key: secret, baseUrl: bad.url, timeoutMs: 2000 });
    assert.equal(r.status, "bad-key");
    assert.match(r.error, /rejected this API key/);
    assert.equal(r.error.includes(secret), false);
    const decided = await connectChoice("anthropic", secret, { fetch: (url, opts) => fetch(url, opts), apiBase: { anthropic: bad.url }, env: {}, timeoutMs: 2000 });
    assert.equal(decided.status, "bad-key");
    assert.equal(decided.config, undefined);
    assert.equal(JSON.stringify(decided).includes(secret), false);
  } finally { await bad.close(); }

  const good = await listen((req, res) => {
    assert.equal(req.headers["x-api-key"], "sk-ant-ok");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"data":[{"id":"claude"}]}');
  });
  try {
    const r = await connectChoice("anthropic", "sk-ant-ok", { apiBase: { anthropic: good.url }, env: {}, timeoutMs: 2000 });
    assert.equal(r.status, "ready");
    assert.deepEqual(r.config, { provider: "anthropic", keys: { anthropic: "sk-ant-ok" } });
  } finally { await good.close(); }

  const openai = await connectChoice("openai", "sk-ant-nope", { env: {}, fetch: async () => { throw new Error("should not fetch"); } });
  assert.equal(openai.status, "bad-key");
  assert.match(openai.error, /doesn't look like an OpenAI API key/);
});

test("a local server lists its models, and a server that isn't running says so", async () => {
  const srv = await listen(modelsJson(["llama3", "mistral"]));
  const down = { id: "lmstudio", name: "LM Studio", logo: "lmstudio", kind: "local", baseUrl: "http://127.0.0.1:1", why: "", install: "" };
  const up = { id: "ollama", name: "Ollama", logo: "ollama", kind: "local", baseUrl: srv.url, why: "a model running on this computer", install: "Start Ollama" };
  try {
    const probed = await probeLocalRuntime(up, { timeoutMs: 2000 });
    assert.equal(probed.status, "ready");
    assert.deepEqual(probed.models.map(m => m.id), ["llama3", "mistral"]);
    const refused = await probeLocalRuntime(down, { timeoutMs: 500 });
    assert.equal(refused.status, "server-down");
    assert.match(refused.detail, /isn't running/);
    assert.equal(refused.found, false);

    const saved = await connectChoice("ollama", "mistral", { runtimes: [up, down], timeoutMs: 2000 });
    assert.equal(saved.status, "ready");
    assert.equal(saved.config.provider, "local");
    assert.equal(saved.config.runtime, "ollama");
    assert.equal(saved.config.model, "mistral");
    assert.equal(saved.config.baseUrl, srv.url);

    const unknown = await connectChoice("ollama", "missing-model", { runtimes: [up, down], timeoutMs: 2000 });
    assert.equal(unknown.status, "missing");
    assert.match(unknown.error, /doesn't have that model/);

    const off = await connectChoice("lmstudio", "", { runtimes: [up, down], timeoutMs: 500 });
    assert.equal(off.status, "server-down");
    assert.match(off.error, /isn't running/);
    assert.equal(off.config, undefined);

    const picked = await connectChoice("local", "", { runtimes: [down, up], timeoutMs: 2000 });
    assert.equal(picked.status, "ready");
    assert.equal(picked.config.model, "llama3");
    assert.equal(picked.config.runtime, "ollama");

    const elsewhere = await connectChoice("local", "llama3", { address: "http://example.com:11434", runtimes: [up] });
    assert.match(elsewhere.error, /isn't on this computer/);
    assert.equal(elsewhere.config, undefined);
  } finally { await srv.close(); }

  const empty = await listen((req, res) => {
    res.writeHead(req.url === "/v1/models" ? 200 : 404, { "Content-Type": "application/json" });
    res.end(req.url === "/v1/models" ? '{"data":[]}' : "");
  });
  try {
    const row = await probeLocalRuntime({ id: "llama", name: "llama.cpp", logo: "llamacpp", baseUrl: empty.url }, { timeoutMs: 2000 });
    assert.equal(row.status, "missing");
    assert.match(row.detail, /no model is loaded/);
  } finally { await empty.close(); }

  const tags = await listen((req, res) => {
    if (req.url === "/v1/models") { res.writeHead(404); res.end(); return; }
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen2.5" }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  try {
    const row = await probeLocalRuntime({ id: "ollama", name: "Ollama", logo: "ollama", baseUrl: tags.url }, { timeoutMs: 2000 });
    assert.equal(row.status, "ready");
    assert.equal(row.models[0].id, "qwen2.5");
  } finally { await tags.close(); }
});

test("choices say what is actually there, and the first paint does not ask", async () => {
  const srv = await listen(modelsJson(["llama3"]));
  const runtimes = [
    { id: "ollama", name: "Ollama", logo: "ollama", kind: "local", baseUrl: srv.url, why: "a model running on this computer", install: "Start Ollama" },
    { id: "lmstudio", name: "LM Studio", logo: "lmstudio", kind: "local", baseUrl: "http://127.0.0.1:1", why: "", install: "" },
    { id: "llama", name: "llama.cpp", logo: "llamacpp", kind: "local", baseUrl: "http://127.0.0.1:1", why: "", install: "" },
  ];
  try {
    const rows = await connectionChoices({
      env: { ANTHROPIC_API_KEY: "sk-ant-from-env" },
      runtimes,
      timeoutMs: 500,
      detectBackends: async () => [
        { id: "claude-code", found: true, path: "/bin/claude", version: "2.1.0" },
        { id: "codex", found: false },
        { id: "api-key", found: true, vendor: "anthropic", keyEnv: "ANTHROPIC_API_KEY" },
      ],
      run: async () => ({ code: 0, out: '{"loggedIn":true}', err: "" }),
      readFile: async () => "",
    });
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    assert.equal(by["claude-code"].status, "ready");
    assert.equal(by["claude-code"].signedIn, true);
    assert.equal(by["claude-code"].kind, "cli");
    assert.equal(by["claude-code"].logo, "claude");
    assert.equal(by["claude-code"].path, "/bin/claude");
    assert.match(by["claude-code"].detail, /Signed in/);
    assert.equal(by.codex.status, "missing");
    assert.equal(by.codex.found, false);
    assert.equal(by.anthropic.status, "ready");
    assert.equal(by.anthropic.vendor, "anthropic");
    assert.equal(by.anthropic.kind, "api");
    assert.equal(by.openai.status, "missing");
    assert.equal(by.ollama.status, "ready");
    assert.equal(by.ollama.logo, "ollama");
    assert.deepEqual(by.ollama.models.map(m => m.id), ["llama3"]);
    assert.equal(by.lmstudio.status, "server-down");
    assert.match(by.lmstudio.detail, /isn't running/);
    assert.equal(by.local.status, "ready");
    assert.equal(by.local.kind, "local");
    assert.equal(by.local.baseUrl, srv.url);
    assert.equal(by["claude-code"].recommended, true);
    assert.equal(JSON.stringify(rows).includes("sk-ant-from-env"), false);
  } finally { await srv.close(); }

  let probes = 0;
  const daemon = {
    HOME: tempDir("morse-connect-svc-"),
    loadConfig: async () => ({ provider: "claude-code" }),
    settingsFromConfig: () => ({ provider: "claude-code", model: "haiku", detected: false }),
    settingsLabel: () => "Claude Code",
    connectionChoices: async () => { probes += 1; return []; },
    plainError: e => e.message,
  };
  const svc = createService({ daemon, scan: false });
  const m = await svc.model();
  assert.equal(m.provider, "claude-code");
  assert.equal(m.kind, "cli");
  assert.equal(m.logo, "claude");
  assert.equal(probes, 0, "opening the window does not look for models");
});

test("a rejected key is not saved, and a local choice is what the model settings read", async () => {
  let saved = null;
  const saves = [];
  const srv = await listen(modelsJson(["llama3"]));
  const runtime = { id: "ollama", name: "Ollama", logo: "ollama", kind: "local", baseUrl: srv.url, why: "", install: "" };
  const daemon = {
    HOME: tempDir("morse-connect-save-"),
    loadConfig: async () => saved || {},
    settingsFromConfig: cfg => read(cfg),
    settingsLabel: s => s.provider,
    saveChoice: async (choice, model) => { saves.push(choice); saved = applyChoice(saved || {}, model); return saved; },
    checkModel: async () => ({ ok: false, error: "Ollama isn't running." }),
    connectChoice: (choice, key, extra) => connectChoice(choice, key, { address: extra, runtimes: [runtime], env: {}, timeoutMs: 2000, fetch: globalThis.fetch }),
    plainError: e => e.message,
  };
  const svc = createService({ daemon, scan: false });
  try {
    const bad = await svc.chooseModel("anthropic", "sk-ant-bad");
    assert.equal(bad.status, "bad-key");
    assert.equal(saves.length, 0);

    const ok = await svc.chooseModel("ollama", "llama3");
    assert.equal(saves[0], "ollama");
    assert.equal(ok.check.ok, false);
    assert.equal(ok.error, undefined, "a failed check still lets the window reload");
    const s = read(saved);
    assert.equal(s.provider, "local");
    assert.equal(s.runtime, "ollama");
    assert.equal(s.model, "llama3");
    assert.equal(s.baseUrl, srv.url);
    assert.equal(s.apiKey, "", "a local server does not receive an OpenAI key");
    assert.equal(settingsFromConfig(saved, {}, { env: { OPENAI_API_KEY: "sk-openai-env" }, harnesses: none }).apiKey, "");
    assert.equal(s.pinned, true);
  } finally { await srv.close(); }

  const auto = settingsFromConfig({}, {}, { env: { OPENAI_API_KEY: "sk-openai" }, harnesses: none });
  assert.equal(auto.provider, "openai");
  assert.notEqual(auto.provider, "local");
});

test("setup refuses a local server that isn't running, and saves one that lists a model", async () => {
  const out = new PassThrough();
  const down = await runSetup(["--use", "ollama"], {
    input: new PassThrough(), output: out, check: null,
    deps: { which: async () => "", version: async () => "", env: {}, runtimes: [{ id: "ollama", name: "Ollama", logo: "ollama", baseUrl: "http://127.0.0.1:1" }], timeoutMs: 400 },
    load: async () => ({}), save: async () => { throw new Error("should not save"); }, savePrefs: async () => {},
  });
  assert.equal(down.saved, false);

  const srv = await listen(modelsJson(["llama3"]));
  let stored = null;
  try {
    const up = await runSetup(["--use", "ollama", "--model", "llama3"], {
      input: new PassThrough(), output: new PassThrough(), check: null,
      deps: { which: async () => "", version: async () => "", env: {}, runtimes: [{ id: "ollama", name: "Ollama", logo: "ollama", baseUrl: srv.url }], timeoutMs: 2000 },
      load: async () => ({}), save: async cfg => { stored = cfg; }, savePrefs: async () => {},
    });
    assert.equal(up.saved, true);
    assert.equal(stored.provider, "local");
    assert.equal(stored.local.runtime, "ollama");
    assert.equal(stored.models.local, "llama3");
    assert.equal(stored.baseUrls.local, srv.url);
  } finally { await srv.close(); }
});

test("a local model speaks the chat API with max_tokens and no key", async () => {
  const seen = [];
  const srv = await listen(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || "{}") });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
  });
  try {
    const text = await streamChat({ provider: "local", runtime: "ollama", model: "llama3", baseUrl: srv.url, effort: "high" }, [{ role: "user", content: "ping" }], { maxTokens: 16 });
    assert.equal(text, "OK");
    assert.equal(seen[0].body.max_tokens, 16);
    assert.equal(seen[0].body.max_completion_tokens, undefined);
    assert.equal(seen[0].body.reasoning_effort, undefined);
    assert.equal(seen[0].body.model, "llama3");
    assert.equal(seen[0].headers.authorization, undefined);
  } finally { await srv.close(); }

  await assert.rejects(
    streamChat({ provider: "local", runtime: "ollama", model: "llama3", baseUrl: "http://127.0.0.1:1" }, [{ role: "user", content: "ping" }]),
    e => e.plain === true && /isn't running/.test(e.message),
  );
  const wrapped = Object.assign(new Error("Ollama isn't running."), { plain: true });
  assert.equal(plainError(wrapped), "Ollama isn't running.");
});
