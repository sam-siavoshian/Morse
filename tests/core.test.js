import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseModResponse, completeCssPrefix, liveCss } from "../core/parse.js";
import { createMod, encodeShare, decodeShare, toUserscript, modMatches } from "../core/mod.js";
import { streamChat, registerProvider } from "../core/providers.js";
import { runMorse, selectorsIn, deadHooks } from "../core/engine.js";
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

test("live css: each finished property goes on the page before its rule ends", () => {
  assert.equal(liveCss("a{color:red} b{margin:0;padding:4p"), "a{color:red} b{margin:0;}");
  assert.equal(liveCss("a{color:red} b{marg"), "a{color:red}");
  assert.equal(liveCss("a{color:red;"), "a{color:red;}");
  // a ";" inside url(...) or a string isn't the end of a property
  assert.equal(liveCss("a{background:url(data:image/png;base64,AA"), "");
  assert.equal(liveCss('a{content:"x;y'), "");
  assert.equal(liveCss('a{content:"x;y";b:1'), 'a{content:"x;y";}');
  // inside @media: finished rules, then finished properties, braces closed
  assert.equal(liveCss("@media (x){a{b:c}d{e:f;g"), "@media (x){a{b:c}d{e:f;}}");
  assert.equal(liveCss("@media (x){a{b:c}"), "@media (x){a{b:c}}");
  assert.equal(liveCss("@media (x){a{b:c}}"), "@media (x){a{b:c}}");
  // a half-written selector never goes on
  assert.equal(liveCss("a{b:c}\n.card:not(.x"), "a{b:c}");
  assert.equal(liveCss(""), "");
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
  assert.equal(body.reasoning_effort, undefined, "no effort, no field");
  s.close();
});

test("openai: the strong tier is gpt-5 reasoning longer; other models never get reasoning_effort", async () => {
  const bodies = [];
  const s = await serve(async (req, res) => {
    let b = ""; for await (const d of req) b += d;
    bodies.push(JSON.parse(b));
    res.end("data: [DONE]\n\n");
  });
  const base = { provider: "openai", baseUrl: `http://127.0.0.1:${s.address().port}`, apiKey: "k" };
  const { resolveTiers, planRoute } = await import("../core/route.js");
  const [best] = planRoute({ ...base, model: "", tiers: resolveTiers("openai"), mode: "best" }, "x", {}).steps;
  await streamChat(best, []);
  await streamChat({ ...base, model: "gpt-5", effort: "max" }, []);
  await streamChat({ ...base, model: "gpt-4.1", effort: "high" }, []);
  assert.deepEqual(bodies.map(b => [b.model, b.reasoning_effort]), [["gpt-5", "high"], ["gpt-5", "high"], ["gpt-4.1", undefined]]);
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

test("CSS rules that reach into a shadow root or frame move to the JS", () => {
  const d = parseModResponse("TITLE: x\n```css\n.a { color: red }\n#pv >>> .cookie, #pv >>> .x { display: none !important; }\n@media (max-width: 9px) { .b { color: blue } }\n```\n```js\nmorse.toast('hi');\n```");
  assert.equal(d.css, ".a { color: red }\n@media (max-width: 9px) { .b { color: blue } }\n");
  assert.equal(d.js, `morse.css("#pv >>> .cookie, #pv >>> .x { display: none !important; }");\nmorse.toast('hi');\n`);
  const plain = parseModResponse("TITLE: x\n```css\n.a{}\n```");
  assert.equal(plain.css, ".a{}\n");
  assert.equal(plain.js, "");
});

test("a class or CSS variable the JS sets that no CSS uses gets a repair round", async () => {
  const replies = [
    "TITLE: Hi\n```css\n.card .pri { color: orange }\n```\n```js\nmorse.watch('.card', c => c.classList.toggle('is-hot', /High/.test(c.textContent)));\n```",
    "TITLE: Hi\n```css\n.card.is-hot { background: orange }\n```\n```js\nmorse.watch('.card', c => c.classList.toggle('is-hot', /High/.test(c.textContent)));\n```",
  ];
  const prompts = [];
  registerProvider("script", async (s, messages, { onToken }) => { prompts.push(messages.at(-1).content); const r = replies.shift(); onToken(r); return r; });
  const res = await runMorse({ settings: { provider: "script" }, request: "high ones orange", context: { url: "x", title: "x" }, emit: () => {}, exec: async () => ({ ok: true }) });
  assert.equal(res.attempts, 2);
  assert.match(prompts[1], /adds the class "is-hot" and no CSS uses it/);
  // The page's own classes, and classes the JS reads back, are fine.
  assert.equal(deadHooks({ css: "", js: "el.classList.add('open')" }, { target: { html: '<div class="menu open">' } }), null);
  assert.equal(deadHooks({ css: "", js: "el.classList.toggle('x1'); if (el.classList.contains('x1')) go();" }, {}), null);
  assert.match(deadHooks({ css: ".bar { width: 10px }", js: "document.body.style.setProperty('--p', '50%')" }, {}), /CSS variable --p/);
  assert.equal(deadHooks({ css: ".bar { width: var(--p) }", js: "document.body.style.setProperty('--p', '50%')" }, {}), null);
  assert.match(deadHooks({ css: "/* none */", js: "morse.toast(`Turned ${n} off`);" }, {}), /only showed a notice/);
  assert.equal(deadHooks({ css: "", js: "morse.toast('hi'); morse.watch('a', a => a.remove());" }, {}), null);
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

test("a change that still does nothing after its repairs never says done: it comes off and says so", async () => {
  registerProvider("script", async (s, m, { onToken }) => { const r = "TITLE: One cover\n```css\n.covers > :nth-child(n+2) { display: none }\n```"; onToken(r); return r; });
  let css = "x", learned = null;
  const res = await runMorse({
    settings: { provider: "script" }, request: "show only one cover, not five", context: { url: "x", title: "x" },
    emit: e => { if (e.type === "css") css = e.css; }, exec: async () => ({ ok: true }),
    probe: async (sels, opts) => { if (!learned) learned = opts; return { fp: "same", unmatched: sels }; },
  });
  assert.deepEqual(learned, { learn: true }, "the look before the change learns what moves by itself");
  assert.equal(res.ok, false);
  assert.equal(res.noEffect, true);
  assert.match(res.error, /nothing on the screen changed/);
  assert.equal(css, "", "the change that did nothing is taken off the page");
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
  assert.equal(fuseVerdict({ electron: true, ...w }).length, 4, "connect, --inspect off, ASAR integrity, RunAsNode");
  assert.equal(readFuseWire(Buffer.from("no fuses here")), null);
});

