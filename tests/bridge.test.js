// The Morse helper (`morse serve`, daemon/bridge.js): pairing, bearer auth,
// origin and host checks, NDJSON completions through a (fake) Claude Code, and
// aborting the model when the client disconnects.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { installFakeClis } from "./fake-clis.js";
import { waitFor } from "./helpers/wait.js";

const EXT = "chrome-extension://" + "a".repeat(32);
let tmp, bridge, port, startPairing, updateConfig;

before(async () => {
  tmp = tempDir("morse-bridge-");
  await installFakeClis(path.join(tmp, "bin"));
  process.env.PATH = `${path.join(tmp, "bin")}${path.delimiter}${process.env.PATH}`;
  process.env.MORSE_HOME = path.join(tmp, "home");
  process.env.FAKE_LOG = tmp;
  delete process.env.OPENAI_API_KEY;
  await fs.mkdir(process.env.MORSE_HOME, { recursive: true });
  await fs.writeFile(path.join(process.env.MORSE_HOME, "config.json"), JSON.stringify({ provider: "claude-code", models: { "claude-code": "haiku" } }));
  const b = await import("../daemon/bridge.js");
  startPairing = b.startPairing;
  ({ updateConfig } = await import("../daemon/store.js"));
  bridge = b.createBridge({ port: 0, timeoutMs: 20000 });
  port = await bridge.listen();
});
after(async () => { await bridge?.close(); await fs.rm(tmp, { recursive: true, force: true }); });

// Raw http.request so tests control Host and Origin exactly.
function req(method, p, { body, headers = {}, onResponse } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...(data && { "Content-Type": "application/json", "Content-Length": data.length }), ...headers } }, res => {
      if (onResponse) return onResponse(res, r, resolve);
      let text = "";
      res.setEncoding("utf8");
      res.on("data", d => (text += d));
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on("error", reject);
    r.end(data);
  });
}

async function pair(origin = EXT) {
  const { code } = await startPairing();
  const r = await req("POST", "/v1/pair", { body: { code: code.toLowerCase() }, headers: { Origin: origin } });
  assert.equal(r.status, 200, r.text);
  return r.json.token;
}

const MESSAGES = [{ role: "system", content: "sys" }, { role: "user", content: "make buttons bigger" }];

test("health needs no token, shows the model, never the keys", async () => {
  await updateConfig(cfg => { cfg.keys = { anthropic: "sk-ant-secret" }; });
  const r = await req("GET", "/v1/health", { headers: { Origin: EXT } });
  assert.equal(r.status, 200);
  assert.equal(r.json.provider, "claude-code");
  assert.equal(r.json.label, "Claude Code · haiku");
  assert.equal(r.json.paired, false);
  assert.equal(r.headers["access-control-allow-origin"], EXT);
  assert.doesNotMatch(r.text, /sk-ant-secret/);
});

test("only chrome-extension origins (or none) and loopback hosts are served", async () => {
  for (const origin of ["https://evil.example", "http://127.0.0.1:8080", "null", "chrome-extension://short"]) {
    const r = await req("GET", "/v1/health", { headers: { Origin: origin } });
    assert.equal(r.status, 403, origin);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  }
  assert.equal((await req("GET", "/v1/health")).status, 200); // curl / CLI
  assert.equal((await req("GET", "/v1/health", { headers: { Host: "evil.example:7457" } })).status, 403); // DNS rebinding
  const pre = await req("OPTIONS", "/v1/complete", { headers: { Origin: EXT, "Access-Control-Request-Method": "POST" } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers["access-control-allow-headers"], /Authorization/);
});

test("pairing: a one-time code gives a token; wrong codes are limited", async () => {
  const { code } = await startPairing();
  const wrong = await req("POST", "/v1/pair", { body: { code: "ZZZZZZ" }, headers: { Origin: EXT } });
  assert.equal(wrong.status, 403);
  const ok = await req("POST", "/v1/pair", { body: { code }, headers: { Origin: EXT } });
  assert.equal(ok.status, 200);
  assert.match(ok.json.token, /^[\w-]{40,}$/);
  const again = await req("POST", "/v1/pair", { body: { code }, headers: { Origin: EXT } });
  assert.equal(again.status, 400, "codes are single-use");
  // Five wrong guesses burn the code.
  const fresh = await startPairing();
  for (let i = 0; i < 5; i++) await req("POST", "/v1/pair", { body: { code: "AAAAAA" } });
  assert.notEqual((await req("POST", "/v1/pair", { body: { code: fresh.code } })).status, 200);
  // The token is stored hashed.
  const cfg = await fs.readFile(path.join(process.env.MORSE_HOME, "config.json"), "utf8");
  assert.ok(!cfg.includes(ok.json.token));
  const health = await req("GET", "/v1/health", { headers: { Origin: EXT, Authorization: `Bearer ${ok.json.token}` } });
  assert.equal(health.json.paired, true);
});

test("complete needs a valid token from the same extension", async () => {
  assert.equal((await req("POST", "/v1/complete", { body: { messages: MESSAGES }, headers: { Origin: EXT } })).status, 401);
  assert.equal((await req("POST", "/v1/complete", { body: { messages: MESSAGES }, headers: { Origin: EXT, Authorization: "Bearer nope" } })).status, 401);
  const token = await pair();
  const other = "chrome-extension://" + "b".repeat(32);
  assert.equal((await req("POST", "/v1/complete", { body: { messages: MESSAGES }, headers: { Origin: other, Authorization: `Bearer ${token}` } })).status, 403);
  assert.equal((await req("POST", "/v1/complete", { body: { messages: "hi" }, headers: { Authorization: `Bearer ${token}` } })).status, 400);
  assert.equal((await req("POST", "/v1/complete", { body: { messages: MESSAGES, model: "--bad flag" }, headers: { Authorization: `Bearer ${token}` } })).status, 400);
});

test("complete streams NDJSON tokens from Claude Code, then done", async () => {
  process.env.FAKE_MODE = "ok";
  const token = await pair();
  const r = await req("POST", "/v1/complete", { body: { messages: MESSAGES }, headers: { Origin: EXT, Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /ndjson/);
  const events = r.text.trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(events.filter(e => e.type === "token").map(e => e.text), ["TITLE: Big\n", "```css\nbutton{font-size:20px}\n```"]);
  assert.deepEqual(events.at(-1), { type: "done", text: "TITLE: Big\n```css\nbutton{font-size:20px}\n```" });
  const { argv, input } = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.equal(argv[argv.indexOf("--model") + 1], "haiku");
  assert.equal(JSON.parse(input).message.content, "make buttons bigger");
  assert.deepEqual(events.filter(e => e.type === "stage"), [{ type: "stage", stage: "ready" }], "the model started (speed: real progress in the bar)");
});

test("warm starts Claude Code ahead of time, behind the same auth", async () => {
  process.env.FAKE_MODE = "ok";
  const token = await pair();
  const starts = async () => (await fs.readFile(path.join(tmp, "claude-starts.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).length;
  assert.equal((await req("POST", "/v1/warm", { body: {} })).status, 401);
  // A process from an earlier request may already be waiting; a changed
  // environment means it can't be used, so this warm must start a new one.
  process.env.FAKE_WARM_TAG = String(Date.now());
  const before = await starts();
  const r = await req("POST", "/v1/warm", { body: {}, headers: { Origin: EXT, Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  await waitFor(async () => (await starts()) > before, { what: "a claude process to start" });
});

test("model errors arrive as an error event", async () => {
  process.env.FAKE_MODE = "fail";
  const token = await pair();
  const r = await req("POST", "/v1/complete", { body: { messages: MESSAGES }, headers: { Authorization: `Bearer ${token}` } });
  const last = JSON.parse(r.text.trim().split("\n").at(-1));
  assert.equal(last.type, "error");
  assert.match(last.message, /Invalid API key/);
});

test("closing the connection kills the Claude Code process", async () => {
  process.env.FAKE_MODE = "slow";
  const token = await pair();
  await fs.rm(path.join(tmp, "claude.json"), { force: true });
  await req("POST", "/v1/complete", {
    body: { messages: MESSAGES }, headers: { Authorization: `Bearer ${token}` },
    onResponse(res, r, resolve) {
      res.setEncoding("utf8");
      let seen = "";
      res.on("data", d => {
        seen += d;
        if (!seen.split("\n").filter(Boolean).some(l => JSON.parse(l).type === "token")) return; // a "stage" line may come first
        r.destroy();
        resolve();
      });
    },
  });
  const { pid } = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await waitFor(() => !alive(), { what: "claude to exit after the disconnect" });
});

test("voice routes are mounted behind the same auth", async () => {
  assert.equal((await req("GET", "/v1/voice", { headers: { Origin: EXT } })).status, 401);
  const token = await pair();
  const r = await req("GET", "/v1/voice", { headers: { Origin: EXT, Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.transcribe, "boolean");
  assert.equal((await req("GET", "/v1/nope", { headers: { Authorization: `Bearer ${token}` } })).status, 404);
});

// Your style, shared with Chrome (core/style-sync.js): the desktop's copy in
// ~/.morse/style.json, read and replaced behind the same auth.
test("style: Chrome reads and replaces the desktop's style, only against the copy it read", async () => {
  const { Style, STYLE_FILE, onStyleChange } = await import("../daemon/style.js");
  const { existsSync, readFileSync } = await import("node:fs");
  assert.equal((await req("GET", "/v1/style", { headers: { Origin: EXT } })).status, 401);
  const token = await pair();
  const auth = { Origin: EXT, Authorization: `Bearer ${token}` };
  assert.deepEqual((await req("GET", "/v1/style", { headers: auth })).json, { style: null });
  // Said in an app: Chrome reads it.
  await Style.handle({ type: "style.save", add: "underline links everywhere" }, { url: "", app: "notes" });
  const mine = (await req("GET", "/v1/style", { headers: auth })).json.style;
  assert.equal(mine.blocks.underline, true);
  // Said in Chrome: it replaces the desktop's, and open windows hear of it.
  let heard = 0;
  const stop = onStyleChange(() => heard++);
  try {
    const chrome = { ...mine, words: "Georgia font everywhere", blocks: { ...mine.blocks, font: "Georgia" }, updated: new Date(Date.now() + 1000).toISOString() };
    const ok = await req("POST", "/v1/style", { body: { style: chrome, was: mine.updated }, headers: auth });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(JSON.parse(readFileSync(STYLE_FILE, "utf8")).blocks.font, "Georgia");
    assert.equal(heard, 1);
    // Sent against a copy that has changed since: refused, with the copy as it is now.
    const stale = await req("POST", "/v1/style", { body: { style: { ...chrome, words: "dark pages everywhere", blocks: { dark: true } }, was: mine.updated }, headers: auth });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.style.blocks.font, "Georgia");
    // Not a style: refused.
    assert.equal((await req("POST", "/v1/style", { body: { style: { blocks: {} }, was: chrome.updated }, headers: auth })).status, 400);
    assert.equal((await req("POST", "/v1/style", { body: { style: "x", was: chrome.updated }, headers: auth })).status, 400);
    // Reset in Chrome: the desktop's goes too.
    const reset = await req("POST", "/v1/style", { body: { style: null, was: chrome.updated }, headers: auth });
    assert.equal(reset.status, 200);
    assert.ok(!existsSync(STYLE_FILE));
  } finally { stop(); }
});

test("unpair revokes tokens", async () => {
  const token = await pair();
  await updateConfig(cfg => { cfg.bridge.tokens = []; });
  assert.equal((await req("POST", "/v1/complete", { body: { messages: MESSAGES }, headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

// onboarding v2: one-click pairing. Chrome asks; a person on this computer
// answers (Morse Desktop's dialog, or y in `morse serve`'s terminal).
test("one-click pairing: only an extension may ask, a person's Allow hands that extension a token once, Deny gives nothing", async () => {
  const { createBridge, askWords } = await import("../daemon/bridge.js");
  const asked = [];
  let answer = null;
  const b = createBridge({ port: 0, app: "desktop", ask: q => new Promise(r => { asked.push(q); answer = r; }) });
  const p = await b.listen();
  const call = (method, path, origin) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: p, method, path, headers: origin ? { Origin: origin } : {} }, res => {
      let text = ""; res.on("data", d => (text += d)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text || "null") }));
    });
    r.on("error", reject); r.end();
  });
  const answered = async id => waitFor(async () => { const x = await call("POST", `/v1/pair/ask/${id}`, EXT); return x.json.state !== "waiting" && x; }, { what: "the answer" });
  try {
    const health = (await call("GET", "/v1/health", EXT)).json;
    assert.equal(health.app, "desktop");
    assert.equal(health.ask, true);
    assert.ok("signedIn" in health);
    // No Origin (a local program) can't ask; a web page is refused like everywhere else.
    assert.equal((await call("POST", "/v1/pair/ask")).status, 403);
    assert.equal((await call("POST", "/v1/pair/ask", "https://evil.example")).status, 403);

    const r = await call("POST", "/v1/pair/ask", EXT);
    assert.equal(r.status, 202);
    assert.match(r.json.id, /^[A-Za-z0-9_-]{22}$/);
    await waitFor(() => asked.length === 1, { what: "the question" });
    assert.equal(asked[0].origin, EXT);
    assert.match(asked[0].words.message, /^Allow Chrome to use your Claude Code.*\?$/);
    assert.deepEqual([asked[0].words.allow, asked[0].words.deny], ["Allow", "Deny"]);
    // Asking again while waiting is the same question, not a second one.
    assert.equal((await call("POST", "/v1/pair/ask", EXT)).json.id, r.json.id);
    assert.equal(asked.length, 1);
    // Another extension can't read this one's answer.
    assert.equal((await call("POST", `/v1/pair/ask/${r.json.id}`, "chrome-extension://" + "b".repeat(32))).status, 403);
    assert.deepEqual((await call("POST", `/v1/pair/ask/${r.json.id}`, EXT)).json, { state: "waiting" });

    answer(true);
    const got = await answered(r.json.id);
    assert.equal(got.json.state, "allowed");
    assert.ok(got.json.token.length > 30);
    assert.equal((await call("POST", `/v1/pair/ask/${r.json.id}`, EXT)).status, 404, "handed out once");
    const ok = await req("GET", "/v1/health", { headers: { Origin: EXT, Authorization: `Bearer ${got.json.token}` } });
    assert.equal(ok.json.paired, true, "the token works with the helper");

    // Deny: nothing, and no new question right away.
    const d = await call("POST", "/v1/pair/ask", EXT);
    await waitFor(() => asked.length === 2, { what: "the second question" });
    answer(false);
    assert.deepEqual((await answered(d.json.id)).json, { state: "denied" });
    assert.equal((await call("POST", "/v1/pair/ask", EXT)).status, 429);
    assert.match(askWords("Codex").detail, /If you didn't click Connect in Chrome a moment ago, choose Deny/);
  } finally { await b.close(); }
  // A helper with nobody to ask says so: Chrome types a code instead.
  const quiet = await req("POST", "/v1/pair/ask", { headers: { Origin: EXT } });
  assert.equal(quiet.status, 404);
  assert.equal(quiet.json.code, "no-ask");
});
