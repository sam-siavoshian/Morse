// Fast mode: the provider's own faster, more expensive mode of the same model.
// A provider with no such mode hides the switch. Fast mode never swaps in a
// smaller model (Haiku, gpt-5-mini, a local mini).
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { installFakeClis } from "./fake-clis.js";

let tmp, bin, streamChat, fastModeChoice, fastModelOf, fastModeExtra, applyFastMode, PROVIDERS, planRoute, resolveTiers;
let settingsFromConfig, settleFastMode, currentSettings, savePrefs, loadConfig, updateConfig;
let connectChoice, notedLocalModels, applyChoice, createService;

const none = { claude: { found: false }, codex: { found: false } };
const root = path.join(import.meta.dirname, "..");
const HI = [{ role: "user", content: "hi" }];
// A swap to any of these is the rejected downgrade.
const DOWNGRADE = new Set(["haiku", "claude-haiku-5-5", "gpt-5-mini", "phi-mini", "qwen-mini", "llama3", "qwen2.5:7b"]);

before(async () => {
  tmp = tempDir("morse-fast-");
  bin = path.join(tmp, "bin");
  await installFakeClis(bin);
  process.env.MORSE_HOME = path.join(tmp, "home");
  process.env.FAKE_LOG = tmp;
  process.env.FAKE_MODE = "ok";
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  ({ streamChat, fastModeChoice, fastModelOf, fastModeExtra, applyFastMode, PROVIDERS } = await import("../core/providers.js"));
  ({ planRoute, resolveTiers } = await import("../core/route.js"));
  ({ settingsFromConfig, settleFastMode, currentSettings } = await import("../daemon/models.js"));
  ({ savePrefs, loadConfig, updateConfig } = await import("../daemon/store.js"));
  ({ connectChoice, notedLocalModels } = await import("../daemon/connect.js"));
  ({ applyChoice } = await import("../daemon/setup.js"));
  ({ createService } = await import("../desktop-app/service.js"));
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

const argvOf = async name => JSON.parse(await fs.readFile(path.join(tmp, `${name}.json`), "utf8")).argv;
const flagArg = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

function assertSameModel(before, after) {
  assert.equal(after.model, before.model);
  assert.equal(after.pinned, before.pinned);
  assert.equal(after.effort, before.effort);
  if (!DOWNGRADE.has(before.model)) assert.equal(DOWNGRADE.has(after.model), false, `${before.provider} swapped ${before.model} for ${after.model}`);
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(r => server.close(r)),
    }));
  });
}

function sse(res, { model, text = ["ok"] }) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (const t of text) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
  ev("message_stop", {});
  res.end();
}

test("the switch is the provider's fast mode, never a smaller model id", () => {
  assert.deepEqual(fastModeChoice("claude-code"), { fastMode: true });
  assert.deepEqual(fastModeChoice("anthropic"), { speed: "fast" });
  assert.deepEqual(fastModeChoice("openai"), { service_tier: "fast" });
  assert.equal(fastModeChoice("codex"), null);
  assert.equal(fastModeChoice("local"), null);
  assert.equal(fastModeChoice("demo"), null);
  for (const id of Object.keys(PROVIDERS)) {
    assert.equal(PROVIDERS[id].fast, undefined, `${id} has no downgrade model`);
    const marker = fastModelOf(id, ["llama3", "llama3:70b", "phi-mini", "qwen-mini", "only-haiku"]);
    if (fastModeChoice(id)) assert.equal(marker, "fast");
    else assert.equal(marker, "");
    assert.equal(DOWNGRADE.has(marker), false);
    assert.equal((PROVIDERS[id].models || []).includes(marker), false);
  }
});

test("a local list never becomes a fast model", () => {
  for (const listed of [
    ["llama3", "llama3:70b"],
    ["qwen2.5:7b", "qwen2.5:32b"],
    ["phi", "phi-mini"],
    ["qwen", "qwen-mini"],
    ["mistral", "qwen"],
    ["only-haiku"],
    [],
  ]) assert.equal(fastModelOf("local", listed), "");
});

test("Fast mode keeps the chosen model and sends that provider's fast option", async () => {
  const opus = { provider: "claude-code", model: "opus", fastMode: true, pinned: true, effort: "high", tier: "best" };
  const on = applyFastMode(opus);
  assertSameModel(opus, on);
  assert.equal(on.fastMode, true);
  assert.deepEqual(fastModeExtra(on), { settings: { fastMode: true } });
  await streamChat(opus, HI);
  const claudeOn = await argvOf("claude");
  assert.equal(flagArg(claudeOn, "--model"), "opus");
  assert.deepEqual(JSON.parse(flagArg(claudeOn, "--settings")), { fastMode: true });
  assert.equal(claudeOn.includes("haiku"), false);

  const sonnet = { provider: "claude-code", model: "sonnet", fastMode: true, pinned: true, effort: "high" };
  assertSameModel(sonnet, applyFastMode(sonnet));
  assert.equal(fastModeExtra(sonnet), null, "Sonnet has no fast mode, so the request stays on Sonnet");
  await streamChat(sonnet, HI);
  const claudeSonnet = await argvOf("claude");
  assert.equal(flagArg(claudeSonnet, "--model"), "sonnet");
  assert.equal(claudeSonnet.includes("--settings"), false);
  assert.equal(claudeSonnet.includes("haiku"), false);

  const tiers = resolveTiers("claude-code");
  const routed = applyFastMode({ provider: "claude-code", model: "opus", fastMode: true, pinned: false, mode: "auto", tiers });
  for (const step of planRoute(routed, "add a sleep timer", {}).steps) {
    assert.equal(step.model, "opus");
    assert.equal(step.fastMode, true);
    assert.equal(DOWNGRADE.has(step.model), false);
  }
  const offSettings = { provider: "claude-code", model: "sonnet", pinned: true, mode: "auto", tiers, fastMode: false };
  assert.equal(applyFastMode(offSettings), offSettings);
  assert.equal(planRoute(offSettings, "add a sleep timer", {}).steps[0].model, "sonnet");

  const codex = applyFastMode({ provider: "codex", model: "gpt-5", fastMode: true, pinned: true });
  assert.equal(codex.model, "gpt-5");
  assert.equal(codex.fastMode, false);
  assert.equal(fastModeExtra({ provider: "codex", model: "gpt-5", fastMode: true }), null);
  await streamChat({ provider: "codex", model: "gpt-5", fastMode: true }, HI);
  const codexArgv = await argvOf("codex");
  assert.equal(flagArg(codexArgv, "-m"), "gpt-5");
  assert.equal(codexArgv.includes("--settings"), false);
  assert.equal(codexArgv.join(" ").includes("service_tier"), false);
});

test("Anthropic fast mode is speed:fast on the same Opus", async () => {
  const seen = [];
  const api = await listen(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    const body = JSON.parse(b || "{}");
    seen.push({ headers: req.headers, body });
    sse(res, { model: body.model });
  });
  try {
    const opus = { provider: "anthropic", model: "claude-opus-5-5", apiKey: "k", baseUrl: api.url, fastMode: true, effort: "high", pinned: true };
    assertSameModel(opus, applyFastMode(opus));
    await streamChat(opus, HI);
    assert.equal(seen[0].body.model, "claude-opus-5-5");
    assert.equal(seen[0].body.speed, "fast");
    assert.doesNotMatch(seen[0].headers["anthropic-beta"] || "", /fast-mode/);
    assert.equal(DOWNGRADE.has(seen[0].body.model), false);

    const older = { ...opus, model: "claude-opus-4-8" };
    await streamChat(older, HI);
    assert.equal(seen[1].body.model, "claude-opus-4-8");
    assert.equal(seen[1].body.speed, "fast");
    assert.match(seen[1].headers["anthropic-beta"] || "", /fast-mode-2026-02-01/);

    const sonnet = { ...opus, model: "claude-sonnet-5-5" };
    await streamChat(sonnet, HI);
    assert.equal(seen[2].body.model, "claude-sonnet-5-5");
    assert.equal(seen[2].body.speed, undefined);

    const haiku = { ...opus, model: "claude-haiku-5-5" };
    await streamChat(haiku, HI);
    assert.equal(seen[3].body.model, "claude-haiku-5-5");
    assert.equal(seen[3].body.speed, undefined);

    await streamChat({ ...opus, fastMode: false }, HI);
    assert.equal(seen[4].body.model, "claude-opus-5-5");
    assert.equal(seen[4].body.speed, undefined);
  } finally { await api.close(); }
});

test("OpenAI fast mode is service_tier fast on the same model, including Astra", async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  try {
    for (const model of ["gpt-6-astra", "gpt-5"]) {
      const chosen = { provider: "openai", model, apiKey: "k", fastMode: true, pinned: true, effort: "high" };
      assertSameModel(chosen, applyFastMode(chosen));
      assert.deepEqual(fastModeExtra(chosen), { service_tier: "fast" });
      await streamChat(chosen, HI);
      const body = seen.at(-1).body;
      assert.equal(body.model, model);
      assert.equal(body.service_tier, "fast");
      assert.equal(body.model === "gpt-5-mini", false);
    }
    await streamChat({ provider: "openai", model: "gpt-5", apiKey: "k", fastMode: false }, HI);
    assert.equal(seen.at(-1).body.model, "gpt-5");
    assert.equal(seen.at(-1).body.service_tier, undefined);
  } finally { globalThis.fetch = orig; }

  const bodies = [];
  const srv = await listen(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    bodies.push(JSON.parse(b || "{}"));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`);
  });
  try {
    await streamChat({ provider: "openai", model: "gpt-5", apiKey: "k", baseUrl: srv.url, fastMode: true }, HI);
    assert.equal(bodies[0].model, "gpt-5");
    assert.equal(bodies[0].service_tier, undefined, "a non-OpenAI host does not get Astra's service tier");
    assert.notEqual(bodies[0].model, "gpt-5-mini");
  } finally { await srv.close(); }
});

test("the switch is saved with the other model settings and does not change the saved model", async () => {
  await updateConfig(() => ({ provider: "claude-code", models: { "claude-code": "opus" } }));
  await savePrefs({ fastMode: true });
  const cur = await currentSettings();
  assert.equal(cur.model, "opus");
  assert.equal(cur.fastMode, true);
  assert.equal(applyFastMode(cur).model, "opus");
  assert.equal((await loadConfig()).models["claude-code"], "opus");
  await settleFastMode("codex");
  assert.equal((await currentSettings()).fastMode, false);
  assert.equal((await loadConfig()).models["claude-code"], "opus");
  await savePrefs({ fastMode: true });
  await settleFastMode("claude-code");
  assert.equal((await currentSettings()).fastMode, true);
  await settleFastMode("local", ["llama3", "llama3:70b"]);
  assert.equal((await currentSettings()).fastMode, false);
  await savePrefs({ fastMode: true });
  await settleFastMode("openai");
  assert.equal((await currentSettings()).fastMode, true);
});

test("a provider with a fast mode shows the switch; Codex and local servers do not", async () => {
  let prefs = { fastMode: true, modelMode: "auto", hotkeys: {} };
  let cfg = { provider: "claude-code", models: { "claude-code": "opus" } };
  const svc = createService({
    daemon: {
      HOME: "",
      loadConfig: async () => cfg,
      settingsFromConfig: c => settingsFromConfig(c, {}, { env: {}, harnesses: none }),
      settingsLabel: s => s.provider,
      loadPrefs: async () => prefs,
      savePrefs: async patch => { prefs = { ...prefs, ...patch }; return prefs; },
      connectionChoices: async () => [
        { id: "claude-code", name: "Claude Code", kind: "cli", status: "ready", found: true, models: [] },
        { id: "codex", name: "Codex", kind: "cli", status: "ready", found: true, models: [] },
        { id: "anthropic", name: "Anthropic", kind: "api", status: "ready", found: true, vendor: "anthropic", models: [] },
        { id: "openai", name: "OpenAI", kind: "api", status: "ready", found: true, vendor: "openai", models: [] },
        { id: "ollama", name: "Ollama", kind: "local", status: "ready", found: true, models: [{ id: "llama3" }, { id: "llama3:70b" }] },
        { id: "lmstudio", name: "LM Studio", kind: "local", status: "ready", found: true, models: [{ id: "mistral" }, { id: "qwen" }] },
        { id: "llama", name: "llama.cpp", kind: "local", status: "server-down", found: false, models: [] },
        { id: "one", name: "One", kind: "local", status: "ready", found: true, models: [{ id: "only-haiku" }] },
      ],
      connectChoice: async choice => ({ backend: choice, config: { provider: choice } }),
      saveChoice: async (_choice, model) => { cfg = applyChoice(cfg, model); return cfg; },
      checkModel: async () => ({ ok: true, ms: 1 }),
      plainError: e => e.message,
      configuredHotkeys: async () => ({}),
    },
    scan: false,
  });
  const rows = await svc.modelChoices();
  const row = id => rows.find(r => r.id === id);
  assert.equal(row("claude-code").fastModel, "fast");
  assert.equal(row("claude-code").fastKnown, true);
  assert.equal(row("anthropic").fastModel, "fast");
  assert.equal(row("openai").fastModel, "fast");
  assert.equal(row("codex").fastModel, "");
  assert.equal(row("codex").fastKnown, true);
  assert.equal(row("ollama").fastModel, "");
  assert.equal(row("ollama").fastKnown, true);
  assert.equal(row("lmstudio").fastModel, "");
  assert.equal(row("llama").fastKnown, true);
  assert.equal(row("one").fastModel, "");
  for (const r of rows) assert.equal(DOWNGRADE.has(r.fastModel), false, r.id);

  const m = await svc.model();
  assert.equal(m.model, "opus");
  assert.equal(m.fastModel, "fast");
  assert.equal(m.fastMode, true);
  await svc.setFastMode(false);
  assert.equal(prefs.fastMode, false);
  assert.equal((await svc.model()).model, "opus");
  await svc.setFastMode(true);
  await svc.chooseModel("codex");
  assert.equal(prefs.fastMode, false, "Codex has no fast mode, so the switch turns off");
  assert.equal(cfg.models["claude-code"], "opus");

  const html = readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8");
  const app = readFileSync(path.join(root, "desktop-app/ui/app.js"), "utf8");
  const bar = readFileSync(path.join(root, "runtime/src/56-settings.js"), "utf8");
  assert.match(html, /id="fast-mode"/);
  assert.match(html, /data-i18n="desk\.model\.fastMode"/);
  assert.match(html, /Faster responses at a higher usage cost/);
  assert.doesNotMatch(html, /faster model/i);
  assert.match(app, /row\.hidden = !id/);
  assert.match(bar, /if \(!S\.fastModel\) return ""/);
  assert.match(bar, /settings\.fastMode/);
  const fastCopy = file => {
    const text = readFileSync(path.join(root, "core/locales", file), "utf8");
    return ["desk.model.fastMode.d", "settings.fastMode.help"].map(k => {
      const m = text.match(new RegExp(`"${k}": "([^"]*)"`));
      assert.ok(m, `${file} ${k}`);
      return m[1];
    }).join("\n");
  };
  const en = fastCopy("en.js");
  assert.match(en, /Uses the faster, more expensive mode\. The model you chose stays the same\./);
  assert.doesNotMatch(en, /faster model/i);
  for (const file of ["ar.js", "de.js", "es.js", "fa.js", "fr.js", "ja.js", "pt-BR.js", "zh-CN.js", "en.js"]) {
    assert.doesNotMatch(fastCopy(file), /faster model|schnellere Modell|modèle le plus rapide|modelo más rápido|modelo mais rápido|更快的模型|النموذج الأسرع|مدل سریع‌تر|速いモデル/);
  }
  const boot = app.slice(app.lastIndexOf("st = await morse.state();"));
  assert.match(boot, /render\(\);\nloadChoices\(\);/);
  assert.doesNotMatch(boot, /await morse\.modelChoices|await morse\.setFastMode/);
});

test("connecting a local server keeps the chosen model when Fast mode is on", async () => {
  const srv = await listen((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: ["llama3", "llama3:70b"].map(id => ({ id })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const decided = await connectChoice("local", "llama3:70b", { address: srv.url });
    assert.equal(decided.status, "ready");
    assert.deepEqual(decided.config.listed.map(m => m.id), ["llama3", "llama3:70b"]);
    assert.deepEqual(notedLocalModels(srv.url), ["llama3", "llama3:70b"]);
    const cfg = applyChoice({}, decided.config);
    const s = settingsFromConfig(cfg, {}, { env: {}, harnesses: none });
    assert.equal(s.model, "llama3:70b");
    assert.deepEqual(s.listedModels, ["llama3", "llama3:70b"]);
    const on = applyFastMode({ ...s, fastMode: true });
    assert.equal(on.model, "llama3:70b");
    assert.equal(on.fastMode, false, "a local server has no fast mode");
    assert.equal(s.model, "llama3:70b");
    assert.equal(fastModeExtra(on), null);
    const off = applyFastMode({ ...s, fastMode: false });
    assert.equal(off.model, "llama3:70b");
  } finally {
    await srv.close();
  }
});
