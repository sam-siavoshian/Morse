// The model backends against fakes that speak their real wire formats:
//   - fake `claude` and `codex` executables on PATH (stream-json / JSONL)
//   - a fake Anthropic Messages API (SSE) reached through the SDK's baseURL
// plus model selection from ~/.morse/config.json.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { installFakeClis } from "./fake-clis.js";
import { waitFor } from "./helpers/wait.js";

let tmp, bin, streamChat, settingsFromConfig, detectHarnesses, runMorse, Generations;

const MESSAGES = [
  { role: "system", content: "You write Morse mods." },
  { role: "user", content: "make buttons bigger" },
];

before(async () => {
  tmp = tempDir("morse-providers-");
  bin = path.join(tmp, "bin");
  await installFakeClis(bin);
  process.env.MORSE_HOME = path.join(tmp, "home");
  process.env.FAKE_LOG = tmp;
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  ({ streamChat } = await import("../core/providers.js"));
  ({ settingsFromConfig } = await import("../daemon/models.js")); // registers claude-code / codex
  ({ detectHarnesses } = await import("../daemon/harness.js"));
  ({ runMorse } = await import("../core/engine.js"));
  ({ Generations } = await import("../core/cancel.js"));
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

const log = async name => JSON.parse(await fs.readFile(path.join(tmp, `${name}.json`), "utf8"));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---- Claude Code

test("claude-code: streams text deltas with every tool off, prompt on stdin, in an empty dir", async () => {
  process.env.FAKE_MODE = "ok";
  const toks = [];
  const text = await streamChat({ provider: "claude-code", model: "haiku" }, MESSAGES, { onToken: t => toks.push(t) });
  assert.equal(text, "TITLE: Big\n```css\nbutton{font-size:20px}\n```");
  assert.deepEqual(toks, ["TITLE: Big\n", "```css\nbutton{font-size:20px}\n```"]);
  const { argv, cwd, input, env } = await log("claude");
  // One stream-json user message, then stdin closes: one request per process.
  assert.deepEqual(JSON.parse(input), { type: "user", message: { role: "user", content: "make buttons bigger" } });
  for (const flag of ["-p", "--verbose", "--include-partial-messages", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json");
  assert.equal(argv[argv.indexOf("--input-format") + 1], "stream-json");
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1", "no update checks or turn summaries");
  assert.equal(argv[argv.indexOf("--tools") + 1], "", "no tools");
  assert.equal(argv[argv.indexOf("--model") + 1], "haiku");
  assert.ok(!argv.some(a => /dangerously|bypass/i.test(a)));
  assert.ok(cwd.startsWith(path.join(process.env.MORSE_HOME, "run")), cwd);
  assert.deepEqual(await fs.readdir(cwd).catch(() => []), []); // empty (and removed afterwards)
  // The system prompt reaches the CLI unchanged.
  const sysIdx = argv.findIndex(a => a === "--system-prompt" || a === "--system-prompt-file");
  assert.ok(sysIdx >= 0);
});

test("claude-code: a failed run surfaces the CLI's own message", async () => {
  process.env.FAKE_MODE = "fail";
  await assert.rejects(streamChat({ provider: "claude-code" }, MESSAGES), /Claude Code: Invalid API key/);
});

test("claude-code: aborting kills the process", async () => {
  process.env.FAKE_MODE = "slow";
  const ac = new AbortController();
  const p = streamChat({ provider: "claude-code" }, MESSAGES, { signal: ac.signal, onToken: () => ac.abort() });
  await assert.rejects(p, e => e.name === "AbortError");
  const { pid } = await log("claude");
  await waitFor(() => !alive(pid), { what: "the claude process to exit" });
});

test("claude-code: generate.cancel stops the engine and the process", async () => {
  process.env.FAKE_MODE = "slow";
  const gens = new Generations();
  let ran = 0;
  const p = gens.run("g1", signal => runMorse({
    settings: { provider: "claude-code" }, request: "x", context: { url: "https://a.example/" }, signal,
    emit: ev => { if (ev.type === "token" || ev.type === "css" || ev.type === "phase") setTimeout(() => gens.cancel("g1"), 50); },
    exec: async () => { ran++; return { ok: true }; },
  }));
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(ran, 0);
  const { pid } = await log("claude");
  await waitFor(() => !alive(pid), { what: "the claude process to exit" });
});

// ---- speed: the answer is done at message_stop, and the next process starts ahead of time

test("claude-code: the answer returns at message_stop, not after the CLI's wrap-up", async () => {
  process.env.FAKE_MODE = "wrapup";
  const t0 = Date.now();
  const text = await streamChat({ provider: "claude-code" }, MESSAGES);
  assert.equal(text, "TITLE: Big\n```css\nbutton{font-size:20px}\n```");
  assert.ok(Date.now() - t0 < 4500, `took ${Date.now() - t0}ms`);
  const { pid } = await log("claude");
  await waitFor(() => !alive(pid), { what: "the finished process to be stopped", timeout: 8000 });
});

test("claude-code: a process started ahead of time takes the next request, then exits; settings changes start fresh", async () => {
  process.env.FAKE_MODE = "ok";
  const { prewarmClaudeCode } = await import("../daemon/harness.js");
  const { SYSTEM_PROMPT } = await import("../core/prompt.js");
  const MSGS = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "make buttons bigger" }];
  const starts = async () => (await fs.readFile(path.join(tmp, "claude-starts.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).map(Number);
  const s = { provider: "claude-code", model: "haiku" };
  process.env.FAKE_WARM_TAG = String(Date.now()); // nothing from an earlier test matches
  const before = (await starts()).length;
  assert.equal(prewarmClaudeCode(s), true);
  await waitFor(async () => (await starts()).length > before, { what: "the process to start" });
  const warmPid = (await starts()).at(-1);
  assert.equal(await streamChat(s, MSGS), "TITLE: Big\n```css\nbutton{font-size:20px}\n```");
  assert.equal((await log("claude")).pid, warmPid, "the started process answered");
  await waitFor(() => !alive(warmPid), { what: "the used process to exit" });
  // After a request the next one is already starting; a different model doesn't use it.
  await waitFor(async () => (await starts()).length > before + 1, { what: "the next process to start" });
  const next = (await starts()).at(-1);
  await streamChat({ ...s, model: "sonnet" }, MSGS);
  const served = await log("claude");
  assert.notEqual(served.pid, next);
  assert.equal(served.argv[served.argv.indexOf("--model") + 1], "sonnet");
  await waitFor(() => !alive(next), { what: "the unusable process to be stopped" });
});

test("claude-code: rejects model names that could smuggle flags", async () => {
  await assert.rejects(streamChat({ provider: "claude-code", model: "--dangerously-skip-permissions" }, MESSAGES), /isn't a model name Morse can use/);
});

// ---- Codex

test("codex: item.completed agent_message, read-only sandbox, prompt on stdin", async () => {
  process.env.FAKE_MODE = "ok";
  const toks = [];
  const text = await streamChat({ provider: "codex", model: "gpt-5-codex" }, MESSAGES, { onToken: t => toks.push(t) });
  assert.equal(text, "TITLE: New\n```css\nb{}\n```");
  assert.ok(toks.length >= 1);
  const { argv, input } = await log("codex");
  assert.equal(argv[0], "exec");
  for (const flag of ["--json", "--skip-git-repo-check"]) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf("--sandbox") + 1], "read-only");
  assert.equal(argv[argv.indexOf("-m") + 1], "gpt-5-codex");
  assert.ok(argv[argv.indexOf("-C") + 1].startsWith(path.join(process.env.MORSE_HOME, "run")));
  assert.equal(argv.at(-1), "-");
  assert.match(input, /You write Morse mods\./);
  assert.match(input, /make buttons bigger/);
  assert.doesNotMatch(text, /thinking about css/);
});

test("codex: older msg.agent_message_delta JSONL", async () => {
  process.env.FAKE_MODE = "old";
  const toks = [];
  const text = await streamChat({ provider: "codex" }, MESSAGES, { onToken: t => toks.push(t) });
  assert.equal(text, "TITLE: Old\n```css\na{}\n```");
  assert.deepEqual(toks, ["TITLE: Old", "\n```css\na{}\n```"]);
});

test("codex: a failed turn surfaces its message", async () => {
  process.env.FAKE_MODE = "fail";
  await assert.rejects(streamChat({ provider: "codex" }, MESSAGES), /Codex: You've hit your usage limit/);
});

// ---- Anthropic API (SDK against a fake server)

function fakeAnthropic(handler) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    const body = JSON.parse(b || "{}");
    seen.push({ url: req.url, headers: req.headers, body });
    handler(req, res, body);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

function sse(res, { model, text = [], stop = "end_turn", stopDetails = null, hang = false }) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (const t of text) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } });
  if (hang) return;
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null, ...(stopDetails && { stop_details: stopDetails }) }, usage: { output_tokens: 5 } });
  ev("message_stop", {});
  res.end();
}

test("anthropic: opus-5-5 by default, low effort, server-side fallback, no temperature or thinking", async () => {
  const api = await fakeAnthropic((req, res, body) => sse(res, { model: body.model, text: ["TITLE: A", "\n```css\na{}\n```"] }));
  try {
    const toks = [];
    const text = await streamChat({ provider: "anthropic", apiKey: "sk-ant-test", baseUrl: api.url }, MESSAGES, { onToken: t => toks.push(t) });
    assert.equal(text, "TITLE: A\n```css\na{}\n```");
    assert.deepEqual(toks, ["TITLE: A", "\n```css\na{}\n```"]);
    const [{ url, headers, body }] = api.seen;
    assert.match(url, /^\/v1\/messages/);
    assert.ok(headers["x-api-key"] === "sk-ant-test" || headers.authorization === "Bearer sk-ant-test", "key sent");
    assert.match(headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.stream, true);
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.equal(body.fallbacks, "default");
    // speed: the instructions are cached; the page and the request after them never are
    assert.deepEqual(body.system, [{ type: "text", text: "You write Morse mods.", cache_control: { type: "ephemeral" } }]);
    assert.equal(body.cache_control, undefined, "no automatic breakpoint after the one-off request");
    assert.deepEqual(body.messages, [{ role: "user", content: "make buttons bigger" }]);
    for (const k of ["temperature", "top_p", "top_k", "thinking", "betas"]) assert.equal(body[k], undefined, k);
  } finally { api.server.close(); }
});

test("anthropic: opening the bar reads the instructions into the cache (max_tokens 0), at most every 4 minutes", async () => {
  const api = await fakeAnthropic((req, res, body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "msg_w", type: "message", role: "assistant", model: body.model, content: [], stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 900 } }));
  });
  try {
    const { prewarm } = await import("../core/providers.js");
    const { SYSTEM_PROMPT } = await import("../core/prompt.js");
    const s = { provider: "anthropic", apiKey: "k", baseUrl: api.url, model: "claude-haiku-5-5" };
    await prewarm(s);
    await prewarm(s); // too soon: nothing sent
    assert.equal(api.seen.length, 1);
    const { body } = api.seen[0];
    assert.equal(body.max_tokens, 0);
    assert.equal(body.stream, undefined);
    assert.equal(body.model, "claude-haiku-5-5");
    assert.deepEqual(body.output_config, { effort: "low" }, "same effort as real requests");
    assert.deepEqual(body.system, [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    await prewarm({ provider: "openai" }); // no-op, never throws
  } finally { api.server.close(); }
});

test("anthropic: sonnet-5-5 also gets fallbacks, haiku-5-5 does not", async () => {
  const api = await fakeAnthropic((req, res, body) => sse(res, { model: body.model, text: ["ok"] }));
  try {
    await streamChat({ provider: "anthropic", apiKey: "k", baseUrl: api.url, model: "claude-sonnet-5-5" }, MESSAGES);
    await streamChat({ provider: "anthropic", apiKey: "k", baseUrl: api.url, model: "claude-haiku-5-5" }, MESSAGES);
    assert.equal(api.seen[0].body.fallbacks, "default");
    assert.match(api.seen[0].headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
    assert.equal(api.seen[1].body.model, "claude-haiku-5-5");
    assert.equal(api.seen[1].body.fallbacks, undefined);
    assert.doesNotMatch(api.seen[1].headers["anthropic-beta"] || "", /server-side-fallback/);
    assert.deepEqual(api.seen[1].body.output_config, { effort: "low" });
  } finally { api.server.close(); }
});

test("anthropic: a refusal becomes a clear error", async () => {
  const api = await fakeAnthropic((req, res, body) => sse(res, { model: body.model, text: [], stop: "refusal", stopDetails: { type: "refusal", category: "cyber", explanation: null } }));
  try {
    await assert.rejects(streamChat({ provider: "anthropic", apiKey: "k", baseUrl: api.url }, MESSAGES), /declined.*cyber/);
  } finally { api.server.close(); }
});

test("anthropic: a bad key says so", async () => {
  const api = await fakeAnthropic((req, res) => res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })));
  try {
    await assert.rejects(streamChat({ provider: "anthropic", apiKey: "bad", baseUrl: api.url }, MESSAGES), /rejected the API key/);
  } finally { api.server.close(); }
});

test("anthropic: aborting closes the stream", async () => {
  let closed;
  const gone = new Promise(r => (closed = r));
  const api = await fakeAnthropic((req, res, body) => { res.on("close", closed); sse(res, { model: body.model, text: ["TITLE: slow"], hang: true }); });
  try {
    const ac = new AbortController();
    const p = streamChat({ provider: "anthropic", apiKey: "k", baseUrl: api.url }, MESSAGES, { signal: ac.signal, onToken: () => ac.abort() });
    await assert.rejects(p, e => e.name === "AbortError");
    await gone;
  } finally { api.server.close(); }
});

test("no model connected is a clear error, not a demo", async () => {
  await assert.rejects(streamChat({ provider: "none" }, MESSAGES), e => e.code === "no_model");
  await assert.rejects(streamChat({}, MESSAGES), e => e.code === "no_model");
});

// ---- choosing the model

test("auto-detect order: Claude Code, Codex, Anthropic key, OpenAI key", () => {
  const none = { claude: { found: false }, codex: { found: false } };
  const env = {};
  assert.equal(settingsFromConfig({}, {}, { env, harnesses: detectHarnesses() }).provider, "claude-code");
  assert.equal(settingsFromConfig({}, {}, { env, harnesses: { ...none, codex: { found: true } } }).provider, "codex");
  const a = settingsFromConfig({ keys: { anthropic: "sk-ant" } }, {}, { env, harnesses: none });
  assert.deepEqual([a.provider, a.model, a.apiKey], ["anthropic", "claude-opus-5-5", "sk-ant"]);
  assert.equal(settingsFromConfig({}, {}, { env: { OPENAI_API_KEY: "sk" }, harnesses: none }).provider, "openai");
  assert.equal(settingsFromConfig({}, {}, { env, harnesses: none }).provider, "none");
  // An explicit choice wins, with its per-provider model.
  const s = settingsFromConfig({ provider: "claude-code", models: { "claude-code": "haiku" } }, {}, { env, harnesses: none });
  assert.deepEqual([s.provider, s.model, s.detected], ["claude-code", "haiku", false]);
  assert.equal(settingsFromConfig({ provider: "anthropic" }, { model: "claude-haiku-5-5" }, { env, harnesses: none }).model, "claude-haiku-5-5");
});
