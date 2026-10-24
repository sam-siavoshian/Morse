import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseModResponse, completeCssPrefix } from "../core/parse.js";
import { createMod, encodeShare, decodeShare, toUserscript, modMatches } from "../core/mod.js";
import { streamChat, resolveSettings } from "../core/providers.js";
import { runMorph } from "../core/engine.js";
import { buildMessages } from "../core/prompt.js";
import { readFuseWire, fuseVerdict } from "../daemon/fuses.js";

test("parses title, css and js from a full reply", () => {
  const r = parseModResponse("TITLE: Big buttons\n```css\nbutton{font-size:20px}\n```\n```js\nmorph.toast('hi')\n```");
  assert.equal(r.title, "Big buttons");
  assert.equal(r.css.trim(), "button{font-size:20px}");
  assert.equal(r.js.trim(), "morph.toast('hi')");
  assert.ok(r.cssComplete && r.jsComplete);
});

test("parses a reply that is still streaming", () => {
  const r = parseModResponse("TITLE: X\n```css\na{color:red}\nb{col");
  assert.equal(r.cssComplete, false);
  assert.equal(completeCssPrefix(r.css), "a{color:red}");
});

test("css prefix ignores braces in strings and comments, keeps nested at-rules whole", () => {
  assert.equal(completeCssPrefix('a::after{content:"}"} /* } */ b{x:1'), 'a::after{content:"}"}');
  assert.equal(completeCssPrefix("@media (x){a{b:c}}d{"), "@media (x){a{b:c}}");
  assert.equal(completeCssPrefix("@media (x){a{b:c}"), "");
});

test("share links round-trip and drop local state", async () => {
  const mod = createMod({ title: "T", prompt: "make it pop", css: "a{}", js: "1;", url: "https://app.example.com/x" });
  const link = await encodeShare(mod);
  assert.match(link, /install\.html#m=/);
  const back = await decodeShare(link);
  assert.equal(back.prompt, "make it pop");
  assert.equal(back.enabled, undefined);
  assert.deepEqual(back.match.hosts, ["app.example.com"]);
});

test("rejects links that aren't mods", async () => {
  await assert.rejects(decodeShare("https://x/install.html"), /Not a Morph share link/);
});

test("matching by host and by app", () => {
  const web = createMod({ prompt: "p", url: "https://www.youtube.com/watch" });
  assert.ok(modMatches(web, { url: "https://www.youtube.com/", app: null }));
  assert.ok(!modMatches(web, { url: "https://example.com/", app: null }));
  const desk = createMod({ prompt: "p", url: "https://open.spotify.com/", app: "spotify" });
  assert.ok(modMatches(desk, { url: "https://open.spotify.com/", app: "spotify" }));
  assert.ok(!modMatches(desk, { url: "https://open.spotify.com/", app: null }));
});

test("userscript export is valid JS with a Tampermonkey header", () => {
  const mod = createMod({ title: "Hi", prompt: "say hi", css: "a{}", js: "morph.toast('hi');", url: "https://example.com/" });
  const us = toUserscript(mod);
  assert.match(us, /\/\/ @match {8}\*:\/\/example\.com\/\*/);
  assert.doesNotThrow(() => new Function(us));
});

test("prompt includes target, request, and previous error on retry", () => {
  const msgs = buildMessages({ request: "hide it", context: { url: "u", title: "t", target: { selector: "#a", html: "<div id=a>", path: "body" } }, previous: { raw: "x", error: "boom" } });
  assert.equal(msgs.length, 4);
  assert.match(msgs[1].content, /Best selector: #a/);
  assert.match(msgs[3].content, /boom/);
});

function serve(handler) {
  return new Promise(r => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => r(s)); });
}

test("ollama provider streams NDJSON tokens", async () => {
  let body;
  const s = await serve((req, res) => {
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.2" }, { name: "qwen2.5-coder:7b" }] }));
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      body = JSON.parse(b);
      res.write(JSON.stringify({ message: { content: "TITLE: A\n" } }) + "\n");
      res.write(JSON.stringify({ message: { content: "```css\na{}\n```" } }) + "\n");
      res.end(JSON.stringify({ done: true }) + "\n");
    });
  });
  const baseUrl = `http://127.0.0.1:${s.address().port}`;
  const resolved = await resolveSettings({ provider: "auto", baseUrl, model: "nope" });
  assert.equal(resolved.provider, "ollama");
  assert.equal(resolved.model, "qwen2.5-coder:7b");
  const toks = [];
  const text = await streamChat(resolved, [{ role: "user", content: "x" }], { onToken: t => toks.push(t) });
  assert.equal(toks.length, 2);
  assert.equal(parseModResponse(text).css.trim(), "a{}");
  assert.equal(body.stream, true);
  s.close();
});

test("openai-compatible provider streams SSE tokens", async () => {
  const s = await serve((req, res) => {
    assert.equal(req.headers.authorization, "Bearer k");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "TITLE: B" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  const text = await streamChat({ provider: "openai", baseUrl: `http://127.0.0.1:${s.address().port}`, model: "m", apiKey: "k" }, []);
  assert.equal(text, "TITLE: B");
  s.close();
});

test("auto falls back to demo when no model is running", async () => {
  const s = await resolveSettings({ provider: "auto", baseUrl: "http://127.0.0.1:9" });
  assert.equal(s.provider, "demo");
});

test("engine streams css, runs js, and repairs a failing first attempt", async () => {
  const events = [];
  let runs = 0;
  const res = await runMorph({
    settings: { provider: "demo" },
    request: "add a sleep timer",
    context: { url: "app://tunes", title: "Tunes" },
    emit: e => events.push(e),
    exec: async js => { runs++; return /player\.dataset/.test(js) ? { ok: false, error: "ReferenceError: player is not defined" } : { ok: true }; },
  });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.equal(runs, 2);
  assert.ok(events.some(e => e.type === "phase" && e.phase === "fixing"));
  assert.ok(events.some(e => e.type === "css" && e.css.includes(".morph-sleep")));
});

test("reads an Electron fuse wire", () => {
  const buf = Buffer.concat([Buffer.alloc(100), Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"), Buffer.from([1, 9]), Buffer.from("101010rr0"), Buffer.alloc(50)]);
  const w = readFuseWire(buf);
  assert.equal(w.length, 9);
  assert.equal(w.fuses.RunAsNode, "enabled");
  assert.equal(w.fuses.EnableNodeCliInspectArguments, "disabled");
  assert.equal(w.fuses.EnableEmbeddedAsarIntegrityValidation, "enabled");
  assert.equal(w.fuses.LoadBrowserProcessSpecificV8Snapshot, "removed");
  assert.equal(fuseVerdict({ electron: true, ...w }).length, 3);
  assert.equal(readFuseWire(Buffer.from("no fuses here")), null);
});

