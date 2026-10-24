import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseModResponse, completeCssPrefix } from "../core/parse.js";
import { createMod, encodeShare, decodeShare, toUserscript, modMatches } from "../core/mod.js";
import { streamChat, registerProvider } from "../core/providers.js";
import { runMorse, selectorsIn } from "../core/engine.js";
import { buildMessages } from "../core/prompt.js";
import { readFuseWire, fuseVerdict } from "../daemon/fuses.js";

test("parses title, css and js from a full reply", () => {
  const r = parseModResponse("TITLE: Big buttons\n```css\nbutton{font-size:20px}\n```\n```js\nmorse.toast('hi')\n```");
  assert.equal(r.title, "Big buttons");
  assert.equal(r.css.trim(), "button{font-size:20px}");
  assert.equal(r.js.trim(), "morse.toast('hi')");
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
  await assert.rejects(decodeShare("https://x/install.html"), /isn't a Morse share link/);
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
  const mod = createMod({ title: "Hi", prompt: "say hi", css: "a{}", js: "morse.toast('hi');", url: "https://example.com/" });
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

test("openai-compatible provider streams SSE tokens", async () => {
  let body;
  const s = await serve(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer k");
    assert.equal(req.url, "/v1/chat/completions");
    let b = ""; for await (const d of req) b += d;
    body = JSON.parse(b);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "TITLE: B" } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  const text = await streamChat({ provider: "openai", baseUrl: `http://127.0.0.1:${s.address().port}`, model: "m", apiKey: "k" }, []);
  assert.equal(text, "TITLE: B");
  assert.equal(body.stream, true);
  assert.equal(body.temperature, undefined);
  s.close();
});

test("engine streams css, runs js, and repairs a failing first attempt", async () => {
  const events = [];
  let runs = 0;
  const res = await runMorse({
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
  assert.ok(events.some(e => e.type === "css" && e.css.includes(".morse-sleep")));
});

test("finds the selectors a draft relies on", () => {
  const sels = selectorsIn({
    css: "/* x */ @media (max-width: 600px) { .a img, .b:hover::after { color: red } }\n@keyframes k { from { opacity: 0 } 50% { opacity: 1 } }\n:root { --x: 1 }\n[data-testid=\"grid\"] > .cv { width: 2px }",
    js: "morse.watch('section[aria-label=\"Message\\\\ list\"] > div.tb', tb => {}); document.querySelector(`#x-${id}`); el.querySelectorAll(\"tr, td\");",
  });
  assert.deepEqual(sels, [".a img", ".b", "[data-testid=\"grid\"] > .cv", "section[aria-label=\"Message\\ list\"] > div.tb", "tr", "td"]);
});

test("a change with no visible effect gets a repair round naming the dead selectors", async () => {
  const replies = ["TITLE: Big\n```css\n.covers img { width: 300px }\n```", "TITLE: Big\n```css\n.cv { width: 300px }\n```"];
  const prompts = [];
  registerProvider("script", async (s, messages, { onToken }) => { prompts.push(messages.at(-1).content); const r = replies.shift(); onToken(r); return r; });
  let css = "";
  const res = await runMorse({
    settings: { provider: "script" }, request: "make the covers bigger", context: { url: "x", title: "x" },
    emit: e => { if (e.type === "css") css = e.css; }, exec: async () => ({ ok: true }),
    probe: async sels => ({ fp: css.includes(".cv") ? "changed" : "same", unmatched: sels.filter(s => s.includes("img")) }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 2);
  assert.match(prompts[1], /nothing on the page changed/);
  assert.match(prompts[1], /`\.covers img`/);
});

test("behavior-only JS (selectors all match, nothing visible yet) is not sent back", async () => {
  registerProvider("script", async (s, m, { onToken }) => { const r = "TITLE: Keys\n```js\nmorse.on(document, 'keydown', () => {});\n```"; onToken(r); return r; });
  const res = await runMorse({
    settings: { provider: "script" }, request: "space to play", context: { url: "x", title: "x" },
    emit: () => {}, exec: async () => ({ ok: true }), probe: async () => ({ fp: "same", unmatched: [] }),
  });
  assert.equal(res.attempts, 1);
});

test("CSS for state that appears on interaction doesn't count as a miss when the JS found its targets", async () => {
  registerProvider("script", async (s, m, { onToken }) => {
    const r = "TITLE: Sort\n```css\nth[data-sort=asc]::after { content: '▲' }\n```\n```js\nmorse.watch('th.am', th => morse.on(th, 'click', () => {}));\n```";
    onToken(r); return r;
  });
  const res = await runMorse({
    settings: { provider: "script" }, request: "sort by this", context: { url: "x", title: "x" },
    emit: () => {}, exec: async () => ({ ok: true }),
    probe: async sels => ({ fp: "same", unmatched: sels.filter(s => s.includes("data-sort")) }),
  });
  assert.equal(res.attempts, 1);
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

