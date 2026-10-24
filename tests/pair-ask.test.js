// One-click pairing (daemon/pair-ask.js, docs/dev/pairing.md) on a real
// Morse helper: the Morse extension asks, a person allows or denies in Morse
// Desktop, and only then does the extension get a token, once, bound to its
// origin. Web pages, other addresses and `morse serve` (nobody to ask) can't.
import { home } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { createBridge } = await import("../daemon/bridge.js");
const { pairAsks } = await import("../daemon/pair-ask.js");
const { loadConfig } = await import("../daemon/store.js");

const EXT = "chrome-extension://" + "abcdefghijklmnopabcdefghijklmnop";
const OTHER = "chrome-extension://" + "ponmlkjihgfedcbaponmlkjihgfedcba";
const bridges = [];
after(async () => { for (const b of bridges) await b.close(); });

// A request with the headers a browser would send (fetch can't set Origin).
function call(port, method, path, { origin, host = `127.0.0.1:${port}`, token, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: {
      Host: host, ...(origin && { Origin: origin }), ...(token && { Authorization: `Bearer ${token}` }), ...(body && { "Content-Type": "application/json" }),
    } }, res => {
      let data = "";
      res.on("data", d => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function helper({ ask = true } = {}) {
  const seen = [];
  const asks = ask ? pairAsks({ onAsk: list => seen.push(list) }) : null;
  const bridge = createBridge({ port: 0, ask: asks });
  bridges.push(bridge);
  const port = await bridge.listen();
  return { port, asks, seen };
}

test("ask, Allow, and the extension gets a token once, bound to its origin", async () => {
  const { port, asks, seen } = await helper();
  assert.equal((await call(port, "GET", "/v1/health")).body.ask, true, "health says it can ask");
  const r = await call(port, "POST", "/v1/pair/ask", { origin: EXT, body: {} });
  assert.equal(r.status, 202);
  assert.equal(r.body.status, "waiting");
  assert.match(r.body.id, /^[\w-]{20,}$/);
  assert.deepEqual(seen.at(-1).map(a => [a.id, a.origin, a.extension]), [[r.body.id, EXT, EXT.slice(19)]], "Morse Desktop is told who asks");
  // Asking again while waiting is the same request, not a second prompt.
  assert.equal((await call(port, "POST", "/v1/pair/ask", { origin: EXT })).body.id, r.body.id);
  assert.deepEqual((await call(port, "GET", `/v1/pair/ask/${r.body.id}`, { origin: EXT })).body.status, "waiting");
  // Nobody else can read the answer.
  assert.equal((await call(port, "GET", `/v1/pair/ask/${r.body.id}`, { origin: OTHER })).status, 404);
  const tokensBefore = ((await loadConfig()).bridge?.tokens || []).length;
  assert.equal(await asks.answer(r.body.id, true), true);
  const got = await call(port, "GET", `/v1/pair/ask/${r.body.id}`, { origin: EXT });
  assert.equal(got.body.status, "allowed");
  assert.match(got.body.token, /^[\w-]{40,}$/);
  assert.equal((await call(port, "GET", `/v1/pair/ask/${r.body.id}`, { origin: EXT })).status, 404, "the token is handed out once");
  const tokens = (await loadConfig()).bridge.tokens;
  assert.equal(tokens.length, tokensBefore + 1);
  assert.equal(tokens.at(-1).origin, EXT);
  assert.ok(!JSON.stringify(tokens).includes(got.body.token), "stored hashed");
  assert.equal((await call(port, "GET", "/v1/health", { origin: EXT, token: got.body.token })).body.paired, true);
  assert.equal((await call(port, "POST", "/v1/warm", { origin: OTHER, token: got.body.token, body: {} })).status, 403, "bound to the extension that asked");
  assert.deepEqual(seen.at(-1), [], "nothing waits any more");
});

test("Deny answers denied, and no token is made", async () => {
  const { port, asks } = await helper();
  const before = ((await loadConfig()).bridge?.tokens || []).length;
  const { body } = await call(port, "POST", "/v1/pair/ask", { origin: EXT });
  await asks.answer(body.id, false);
  assert.deepEqual((await call(port, "GET", `/v1/pair/ask/${body.id}`, { origin: EXT })).body, { status: "denied" });
  assert.equal(((await loadConfig()).bridge?.tokens || []).length, before);
  assert.equal(await asks.answer(body.id, true), false, "an answered request can't be allowed later");
});

test("the extension can stop asking; answers to it then do nothing", async () => {
  const { port, asks, seen } = await helper();
  const { body } = await call(port, "POST", "/v1/pair/ask", { origin: EXT });
  assert.equal((await call(port, "DELETE", `/v1/pair/ask/${body.id}`, { origin: EXT })).body.status, "cancelled");
  assert.deepEqual(seen.at(-1), []);
  assert.equal(await asks.answer(body.id, true), false);
});

test("only the extension may ask: no Origin, a web page, a foreign Host, or too many at once are refused", async () => {
  const { port } = await helper();
  assert.equal((await call(port, "POST", "/v1/pair/ask")).status, 403, "curl or a script, with no Origin");
  assert.equal((await call(port, "POST", "/v1/pair/ask", { origin: "https://evil.example" })).status, 403, "a web page");
  assert.equal((await call(port, "POST", "/v1/pair/ask", { origin: EXT, host: "evil.example" })).status, 403, "DNS rebinding");
  const ids = [];
  for (const id of ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccc"]) ids.push((await call(port, "POST", "/v1/pair/ask", { origin: `chrome-extension://${id}` })).status);
  assert.deepEqual(ids, [202, 202, 202]);
  assert.equal((await call(port, "POST", "/v1/pair/ask", { origin: `chrome-extension://${"d".repeat(32)}` })).status, 429, "three waiting at most");
});

test("morse serve (nobody to ask) doesn't offer it", async () => {
  const { port } = await helper({ ask: false });
  assert.equal((await call(port, "GET", "/v1/health")).body.ask, false);
  assert.equal((await call(port, "POST", "/v1/pair/ask", { origin: EXT })).status, 401, "falls through to the paired-only part");
  assert.ok(home);
});

test("an unanswered request ends after its time", async () => {
  let t = 1000;
  const seen = [];
  const asks = pairAsks({ onAsk: l => seen.push(l), ttl: 50, now: () => t });
  const bridge = createBridge({ port: 0, ask: asks });
  bridges.push(bridge);
  const port = await bridge.listen();
  const { body } = await call(port, "POST", "/v1/pair/ask", { origin: EXT });
  t += 100;
  assert.equal((await call(port, "GET", `/v1/pair/ask/${body.id}`, { origin: EXT })).status, 404);
  assert.deepEqual(seen.at(-1), []);
  assert.equal(await asks.answer(body.id, true), false);
});
