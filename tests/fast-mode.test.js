// Fast mode: the smaller model a provider already lists, as a switch on top
// of the model the person chose. A provider with no such model hides the switch.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { installFakeClis } from "./fake-clis.js";

let tmp, bin, streamChat, fastModeChoice, fastModelOf, applyFastMode, PROVIDERS, planRoute, resolveTiers;
let settingsFromConfig, settleFastMode, currentSettings, savePrefs, loadConfig, updateConfig;
let connectChoice, notedLocalModels, applyChoice, createService;

const none = { claude: { found: false }, codex: { found: false } };
const root = path.join(import.meta.dirname, "..");

before(async () => {
  tmp = tempDir("morse-fast-");
  bin = path.join(tmp, "bin");
  await installFakeClis(bin);
  process.env.MORSE_HOME = path.join(tmp, "home");
  process.env.FAKE_LOG = tmp;
  process.env.FAKE_MODE = "ok";
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  ({ streamChat, fastModeChoice, fastModelOf, applyFastMode, PROVIDERS } = await import("../core/providers.js"));
  ({ planRoute, resolveTiers } = await import("../core/route.js"));
  ({ settingsFromConfig, settleFastMode, currentSettings } = await import("../daemon/models.js"));
  ({ savePrefs, loadConfig, updateConfig } = await import("../daemon/store.js"));
  ({ connectChoice, notedLocalModels } = await import("../daemon/connect.js"));
  ({ applyChoice } = await import("../daemon/setup.js"));
  ({ createService } = await import("../desktop-app/service.js"));
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

const argvOf = async name => JSON.parse(await fs.readFile(path.join(tmp, `${name}.json`), "utf8")).argv;
const modelArg = (argv, flag) => argv[argv.indexOf(flag) + 1];

function listen(ids) {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: ids.map(id => ({ id })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(r => server.close(r)),
    }));
  });
}

test("only a model the provider already lists can be the fast one", () => {
  assert.deepEqual(fastModeChoice("claude-code"), { id: "haiku" });
  assert.deepEqual(fastModeChoice("anthropic"), { id: "claude-haiku-5-5" });
  assert.deepEqual(fastModeChoice("openai"), { id: "gpt-5-mini" });
  assert.equal(fastModeChoice("codex"), null);
  assert.equal(fastModeChoice("local"), null);
  for (const [id, spec] of Object.entries(PROVIDERS)) {
    if (!spec.fast) continue;
    assert.ok(spec.models.includes(spec.fast), `${id} fast id is one of its models`);
  }
  assert.equal(PROVIDERS.codex.fast, undefined);
  assert.equal(PROVIDERS.local.fast, undefined);
});

test("a local list shows a fast model only when one is the smaller one", () => {
  assert.equal(fastModelOf("local", ["llama3", "llama3:70b"]), "llama3");
  assert.equal(fastModelOf("local", ["qwen2.5:7b", "qwen2.5:32b"]), "qwen2.5:7b");
  assert.equal(fastModelOf("local", ["phi", "phi-mini"]), "phi-mini");
  assert.equal(fastModelOf("local", ["qwen", "qwen-mini"]), "qwen-mini");
  assert.equal(fastModelOf("local", ["mistral", "qwen"]), "");
  assert.equal(fastModelOf("local", ["only-haiku"]), "");
  assert.equal(fastModelOf("local", []), "");
});

test("a request uses the fast id when the switch is on and the chosen id when it is off", async () => {
  const chosen = { provider: "claude-code", model: "sonnet", fastMode: true, pinned: true, effort: "high", tier: "best" };
  const on = applyFastMode(chosen);
  assert.equal(chosen.model, "sonnet", "the saved model id is not rewritten");
  assert.notEqual(on, chosen);
  assert.equal(on.model, "haiku");
  assert.equal(on.chosenModel, "sonnet");
  assert.equal(on.pinned, true);
  assert.equal(on.effort, undefined);
  assert.equal(on.tier, undefined);

  const tiers = resolveTiers("claude-code");
  const held = planRoute(on, "add a sleep timer", {});
  assert.deepEqual(held.steps.map(s => s.model), ["haiku"]);
  const offSettings = { provider: "claude-code", model: "sonnet", pinned: true, mode: "auto", tiers, fastMode: false };
  assert.equal(applyFastMode(offSettings), offSettings);
  assert.equal(planRoute(offSettings, "add a sleep timer", {}).steps[0].model, "sonnet");

  await streamChat(chosen, [{ role: "user", content: "hi" }]);
  assert.equal(modelArg(await argvOf("claude"), "--model"), "haiku");
  await streamChat({ provider: "claude-code", model: "sonnet", fastMode: false, pinned: true }, [{ role: "user", content: "hi" }]);
  assert.equal(modelArg(await argvOf("claude"), "--model"), "sonnet");

  const codex = applyFastMode({ provider: "codex", model: "gpt-5", fastMode: true });
  assert.equal(codex.model, "gpt-5");
  assert.equal(codex.fastMode, false);
  await streamChat({ provider: "codex", model: "gpt-5", fastMode: true }, [{ role: "user", content: "hi" }]);
  assert.equal(modelArg(await argvOf("codex"), "-m"), "gpt-5");
});

test("the switch is saved with the other model settings and does not change the saved model", async () => {
  await updateConfig(() => ({ provider: "claude-code", models: { "claude-code": "sonnet" } }));
  await savePrefs({ fastMode: true });
  const cur = await currentSettings();
  assert.equal(cur.model, "sonnet");
  assert.equal(cur.fastMode, true);
  assert.equal(applyFastMode(cur).model, "haiku");
  assert.equal((await loadConfig()).models["claude-code"], "sonnet");
  await settleFastMode("codex");
  assert.equal((await currentSettings()).fastMode, false);
  assert.equal((await loadConfig()).models["claude-code"], "sonnet");
  await savePrefs({ fastMode: true });
  await settleFastMode("claude-code");
  assert.equal((await currentSettings()).fastMode, true);
});

test("a provider with a fast model shows the choice; one without does not", async () => {
  let prefs = { fastMode: true, modelMode: "auto", hotkeys: {} };
  let cfg = { provider: "claude-code", models: { "claude-code": "sonnet" } };
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
  assert.equal(row("claude-code").fastModel, "haiku");
  assert.equal(row("claude-code").fastKnown, true);
  assert.equal(row("anthropic").fastModel, "claude-haiku-5-5");
  assert.equal(row("openai").fastModel, "gpt-5-mini");
  assert.equal(row("codex").fastModel, "");
  assert.equal(row("codex").fastKnown, true);
  assert.equal(row("ollama").fastModel, "llama3");
  assert.equal(row("ollama").fastKnown, true);
  assert.equal(row("lmstudio").fastModel, "");
  assert.equal(row("lmstudio").fastKnown, true);
  assert.equal(row("llama").fastKnown, false);
  assert.equal(row("one").fastModel, "");
  assert.equal(row("one").fastKnown, true);

  const m = await svc.model();
  assert.equal(m.model, "sonnet");
  assert.equal(m.fastModel, "haiku");
  assert.equal(m.fastMode, true);
  await svc.setFastMode(false);
  assert.equal(prefs.fastMode, false);
  assert.equal((await svc.model()).model, "sonnet");
  await svc.setFastMode(true);
  await svc.chooseModel("codex");
  assert.equal(prefs.fastMode, false, "Codex has no fast model, so the switch turns off");
  assert.equal(cfg.models["claude-code"], "sonnet");

  const html = readFileSync(path.join(root, "desktop-app/ui/index.html"), "utf8");
  const app = readFileSync(path.join(root, "desktop-app/ui/app.js"), "utf8");
  const bar = readFileSync(path.join(root, "runtime/src/56-settings.js"), "utf8");
  assert.match(html, /id="fast-mode"/);
  assert.match(html, /data-i18n="desk\.model\.fastMode"/);
  assert.match(app, /row\.hidden = !id/);
  assert.match(bar, /if \(!S\.fastModel\) return ""/);
  assert.match(bar, /settings\.fastMode/);
  const boot = app.slice(app.lastIndexOf("st = await morse.state();"));
  assert.match(boot, /render\(\);\nrefreshChoices\(\);/);
  assert.doesNotMatch(boot, /await morse\.modelChoices|await morse\.setFastMode/);
});

test("connecting a local server keeps its list and uses the smaller model only while Fast mode is on", async () => {
  const srv = await listen(["llama3", "llama3:70b"]);
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
    assert.equal(on.model, "llama3");
    assert.equal(on.chosenModel, "llama3:70b");
    assert.equal(s.model, "llama3:70b");
    const off = applyFastMode({ ...s, fastMode: false });
    assert.equal(off.model, "llama3:70b");
  } finally {
    await srv.close();
  }
});
