// Voice transcription providers against a fake OpenAI server and fake
// whisper binaries on PATH; the helper's HTTP route; stopping a generation.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { transcribe, transcribeOpenAI, transcribeWhisper, voiceStatus, findWhisper } from "../core/transcribe.js";
import { Generations } from "../core/cancel.js";
import { runMorse } from "../core/engine.js";
import { waitFor } from "./helpers/wait.js";

const AUDIO = Buffer.from("RIFF fake webm bytes for the test").toString("base64");
let server, base, calls = [], respond = null, tmp, binDir;

before(async () => {
  tmp = tempDir("morse-voice-test-");
  binDir = path.join(tmp, "bin");
  await fs.mkdir(binDir);
  // openai-whisper's CLI shape: writes <output_dir>/<input name>.txt
  await fs.writeFile(path.join(binDir, "whisper"), `#!/usr/bin/env node
const a = process.argv.slice(2), fs = require("fs"), path = require("path");
const out = a[a.indexOf("--output_dir") + 1], input = a[0];
if (!fs.existsSync(input) || a[a.indexOf("--output_format") + 1] !== "txt") process.exit(3);
fs.writeFileSync(path.join(out, path.basename(input).replace(/\\.[^.]+$/, ".txt")), " hello from whisper [BLANK_AUDIO]\\n");
`, { mode: 0o755 });
  // whisper.cpp's CLI shape: -m model -f file.wav, text on stdout
  const cppDir = path.join(tmp, "cpp");
  await fs.mkdir(cppDir);
  await fs.writeFile(path.join(cppDir, "whisper-cli"), `#!/usr/bin/env node
const a = process.argv.slice(2);
if (!a.includes("-m") || !a[a.indexOf("-f") + 1].endsWith(".wav")) process.exit(4);
process.stdout.write("\\n hello from whisper.cpp\\n");
`, { mode: 0o755 });
  await fs.writeFile(path.join(tmp, "ggml-base.en.bin"), "model");

  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] || "" } }).formData();
    const file = form.get("file");
    calls.push({ url: req.url, auth: req.headers.authorization, model: form.get("model"), name: file?.name, type: file?.type, size: file?.size });
    if (respond) return respond(res);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text: " make the toolbar airier " }));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("OpenAI: multipart upload with the transcribe model and the user's key", async () => {
  calls = [];
  const r = await transcribeOpenAI({ audio: AUDIO, mime: "audio/webm;codecs=opus", apiKey: "sk-test", baseUrl: base });
  assert.deepEqual(r, { text: "make the toolbar airier", provider: "openai" });
  assert.equal(calls[0].url, "/v1/audio/transcriptions");
  assert.equal(calls[0].auth, "Bearer sk-test");
  assert.equal(calls[0].model, "gpt-4o-mini-transcribe");
  assert.equal(calls[0].name, "speech.webm");
  assert.equal(calls[0].type, "audio/webm");
  assert.equal(calls[0].size, Buffer.from(AUDIO, "base64").length);
});

test("OpenAI: a rejected key says so", async () => {
  respond = res => res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
  try { await assert.rejects(transcribeOpenAI({ audio: AUDIO, apiKey: "sk-bad", baseUrl: base }), /OpenAI key was rejected/); }
  finally { respond = null; }
});

test("finds whisper on PATH and reads its output", async () => {
  const env = { PATH: binDir };
  assert.equal(await findWhisper(env), path.join(binDir, "whisper"));
  const r = await transcribeWhisper({ audio: AUDIO, mime: "audio/webm", env });
  assert.deepEqual(r, { text: "hello from whisper", provider: "whisper" });
});

test("whisper.cpp gets a WAV and a model, text comes from stdout", async () => {
  const env = { PATH: path.join(tmp, "cpp"), MORSE_WHISPER_MODEL: path.join(tmp, "ggml-base.en.bin") };
  const r = await transcribeWhisper({ audio: AUDIO, mime: "audio/wav", env });
  assert.equal(r.text, "hello from whisper.cpp");
  await assert.rejects(transcribeWhisper({ audio: AUDIO, mime: "audio/wav", env: { PATH: path.join(tmp, "cpp"), MORSE_HOME: tmp + "/none", HOME: tmp } }), /needs a model/);
});

test("status: nothing set up explains how to enable voice", async () => {
  const st = await voiceStatus({ env: { PATH: path.join(tmp, "empty") } });
  assert.equal(st.transcribe, false);
  assert.match(st.hint, /OPENAI_API_KEY|whisper/);
  await assert.rejects(transcribe({ audio: AUDIO, env: { PATH: "" } }), /OPENAI_API_KEY/);
});

test("OpenAI first when there's a key; an outage falls back to local whisper", async () => {
  const opts = { openaiKey: "sk-test", openaiBaseUrl: base, env: { PATH: binDir } };
  assert.deepEqual((await voiceStatus(opts)).providers, ["openai", "whisper"]);
  assert.equal((await transcribe({ audio: AUDIO, mime: "audio/webm", ...opts })).provider, "openai");
  respond = res => res.writeHead(503).end("{}");
  try { assert.equal((await transcribe({ audio: AUDIO, mime: "audio/webm", ...opts })).provider, "whisper"); }
  finally { respond = null; }
  assert.deepEqual((await voiceStatus({ ...opts, provider: "whisper" })).providers, ["whisper"]);
});

test("the helper route serves /v1/voice and /v1/transcribe", async () => {
  process.env.MORSE_HOME = path.join(tmp, "home");
  const saved = { key: process.env.OPENAI_API_KEY, url: process.env.MORSE_OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = "sk-env";
  process.env.MORSE_OPENAI_BASE_URL = base;
  const { handleVoice } = await import("../daemon/voice.js");
  const app = http.createServer(async (req, res) => { if (!(await handleVoice(req, res))) res.writeHead(404).end(); });
  await new Promise(r => app.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.address().port}`;
  try {
    const st = await (await fetch(`${url}/v1/voice`)).json();
    assert.equal(st.transcribe, true);
    assert.equal(st.provider, "openai");
    calls = [];
    const r = await fetch(`${url}/v1/transcribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: AUDIO, mime: "audio/webm" }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).text, "make the toolbar airier");
    assert.equal(calls[0].auth, "Bearer sk-env");
    assert.equal((await fetch(`${url}/v1/transcribe`)).status, 405);
    assert.equal((await fetch(`${url}/other`)).status, 404);
  } finally {
    app.close();
    process.env.OPENAI_API_KEY = saved.key ?? "";
    if (saved.url === undefined) delete process.env.MORSE_OPENAI_BASE_URL;
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
  }
});

test("generate.cancel aborts the model mid-stream and never runs the JS", async () => {
  const gens = new Generations();
  let execs = 0, tokens = 0;
  const p = gens.run("g1", signal => runMorse({
    settings: { provider: "demo" }, request: "add a sleep timer", context: { url: "https://x/", outline: "" },
    exec: async () => { execs++; return { ok: true }; }, emit: e => { if (e.type === "token") tokens++; }, signal,
  }));
  await waitFor(() => tokens > 0, { what: "the first tokens" }); // mid-stream
  assert.equal(gens.cancel("g1"), true);
  const res = await p;
  assert.deepEqual(res, { ok: false, cancelled: true, error: "Stopped" });
  assert.equal(execs, 0);
  assert.ok(tokens > 0);
  assert.equal(gens.size, 0);
  assert.equal(gens.cancel("g1"), false, "nothing left to cancel");
});
