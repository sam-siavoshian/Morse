// Describe this image: pictures reach each model the way it takes them.
//   - Anthropic API: the image block as is (fake Messages API, through the SDK)
//   - OpenAI API: an image_url data URL (fake chat completions server)
//   - Claude Code: one stream-json user message on stdin (fake `claude`)
//   - Codex: refused with a clear message, nothing is run
//   - the Morse helper accepts picture messages from the extension
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { installFakeClis } from "./fake-clis.js";

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE = { type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL } };
const MESSAGES = [
  { role: "system", content: "You describe pictures." },
  { role: "user", content: [IMAGE, { type: "text", text: "Request: Describe this picture" }] },
];
let tmp, streamChat, createBridge, startPairing;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-a11y-model-"));
  await installFakeClis(path.join(tmp, "bin"));
  process.env.PATH = `${path.join(tmp, "bin")}${path.delimiter}${process.env.PATH}`;
  process.env.MORSE_HOME = path.join(tmp, "home");
  process.env.FAKE_LOG = tmp;
  await fs.mkdir(process.env.MORSE_HOME, { recursive: true });
  await fs.writeFile(path.join(process.env.MORSE_HOME, "config.json"), JSON.stringify({ provider: "claude-code" }));
  ({ streamChat } = await import("../core/providers.js"));
  await import("../daemon/models.js"); // registers claude-code and codex
  ({ createBridge, startPairing } = await import("../daemon/bridge.js"));
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

function server(handler) {
  const seen = [];
  const s = http.createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    seen.push(JSON.parse(b || "{}"));
    handler(req, res);
  });
  return new Promise(r => s.listen(0, "127.0.0.1", () => r({ s, seen, url: `http://127.0.0.1:${s.address().port}` })));
}

test("Anthropic API: the picture goes as an image block, untouched", async () => {
  const api = await server((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ANSWER: A single dot." } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } });
    ev("message_stop", {});
    res.end();
  });
  try {
    const text = await streamChat({ provider: "anthropic", apiKey: "k", baseUrl: api.url }, MESSAGES);
    assert.equal(text, "ANSWER: A single dot.");
    assert.equal(api.seen[0].system, "You describe pictures.");
    assert.deepEqual(api.seen[0].messages, [{ role: "user", content: [IMAGE, { type: "text", text: "Request: Describe this picture" }] }]);
  } finally { api.s.close(); }
});

test("OpenAI API: the picture goes as an image_url data URL", async () => {
  const api = await server((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ANSWER: A dot." } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  try {
    assert.equal(await streamChat({ provider: "openai", apiKey: "k", baseUrl: api.url }, MESSAGES), "ANSWER: A dot.");
    assert.deepEqual(api.seen[0].messages[1], { role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } },
      { type: "text", text: "Request: Describe this picture" },
    ] });
    assert.deepEqual(api.seen[0].messages[0], MESSAGES[0]);
  } finally { api.s.close(); }
});

test("Claude Code: the picture goes in as one stream-json user message; text-only requests are unchanged", async () => {
  await fs.rm(path.join(tmp, "claude.json"), { force: true });
  await streamChat({ provider: "claude-code" }, MESSAGES);
  const log = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.deepEqual(log.argv.slice(log.argv.indexOf("--input-format"), log.argv.indexOf("--input-format") + 2), ["--input-format", "stream-json"]);
  assert.ok(log.argv.includes("--tools") && log.argv[log.argv.indexOf("--tools") + 1] === "", "every tool still off");
  const line = JSON.parse(log.input.trim());
  assert.deepEqual(line, { type: "user", message: { role: "user", content: [IMAGE, { type: "text", text: "Request: Describe this picture" }] } });
  await streamChat({ provider: "claude-code" }, [{ role: "system", content: "s" }, { role: "user", content: "make it blue" }]);
  const plain = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.equal(plain.input, "make it blue");
  assert.ok(!plain.argv.includes("--input-format"));
});

test("Codex: says plainly it can't look at pictures, and runs nothing", async () => {
  await fs.rm(path.join(tmp, "codex.json"), { force: true });
  await assert.rejects(streamChat({ provider: "codex" }, MESSAGES), /^Error: Codex can't look at pictures in Morse\. Use Claude Code or an Anthropic API key for that\.$/);
  await assert.rejects(fs.access(path.join(tmp, "codex.json")));
});

test("Morse helper: takes picture messages from the extension, and only well-formed ones", async () => {
  const EXT = "chrome-extension://" + "b".repeat(32);
  const bridge = createBridge({ port: 0, timeoutMs: 20000 });
  const port = await bridge.listen();
  const post = (p, body, headers = {}) => new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = http.request({ host: "127.0.0.1", port, method: "POST", path: p, headers: { "Content-Type": "application/json", "Content-Length": data.length, Origin: EXT, ...headers } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", d => (text += d));
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    r.on("error", reject);
    r.end(data);
  });
  try {
    const { code } = await startPairing();
    const token = JSON.parse((await post("/v1/pair", { code })).text).token;
    const auth = { Authorization: `Bearer ${token}` };
    const ok = await post("/v1/complete", { messages: MESSAGES }, auth);
    assert.equal(ok.status, 200, ok.text);
    assert.match(ok.text, /"type":"done"/);
    const log = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
    assert.equal(JSON.parse(log.input.trim()).message.content[0].source.data, PIXEL);
    for (const bad of [
      [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x" } }] }],
      [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/svg+xml", data: "x" } }] }],
      [{ role: "assistant", content: [IMAGE] }],
      [{ role: "user", content: [{ type: "tool_use" }] }],
    ]) assert.equal((await post("/v1/complete", { messages: bad }, auth)).status, 400, JSON.stringify(bad));
  } finally { await bridge.close(); }
});
