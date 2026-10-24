// Smart model routing (core/route.js, docs/models.md "Fast and strong models"):
// the heuristic, the plan, escalation in the engine with fake models, the
// warm process, the setting and where it is saved.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installFakeClis } from "./fake-clis.js";
import { waitFor } from "./helpers/wait.js";
import { looksHard, planRoute, resolveTiers, shouldEscalate, warmSettings, startLabel, modelNames, TIERS } from "../core/route.js";
import { normalizePrefs, mergePrefs, DEFAULT_PREFS } from "../core/prefs.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "daemon", "cli.js");
let tmp, providers, runMorse, models, store;

before(async () => {
  tmp = tempDir("morse-routing-");
  const bin = path.join(tmp, "bin");
  await installFakeClis(bin);
  process.env.MORSE_HOME = path.join(tmp, "home");
  process.env.FAKE_LOG = tmp;
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  providers = await import("../core/providers.js");
  ({ runMorse } = await import("../core/engine.js"));
  models = await import("../daemon/models.js"); // registers the real claude-code and codex providers
  store = await import("../daemon/store.js");
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

const CC = { provider: "claude-code", model: "", tiers: resolveTiers("claude-code"), mode: "auto" };

// ---- the heuristic

test("looks hard: plain looks, hiding, layout and text stay on the fast model", () => {
  for (const r of ["make the album covers bigger", "hide the ads", "make the play button green", "dark mode please",
    "keep this bar at the top when I scroll", "rename this to Create note", "I can't read this, make it bigger",
    "hide the DEBUG lines", "make the high priority tasks stand out in orange", "add a sleep timer", "show a word count under the message box"]) {
    assert.equal(looksHard(r, { notes: "" }).hard, false, r);
  }
});

test("looks hard: new behavior with data, several steps, a canvas, every item of a changing list", () => {
  assert.deepEqual(looksHard("add a button that sorts the products by price, lowest first", {}).why, ["adds behavior", "works with the data"]);
  assert.equal(looksHard("add a button to save my drawing as a PNG", {}).hard, true);
  assert.equal(looksHard("add a dark mode toggle, then remember it", {}).hard, true);
  // The page notes count: the same words on a page that re-renders are harder.
  const rerenders = { notes: "- This page re-renders: lately the app replaced what is inside main (3×)." };
  assert.equal(looksHard("show how many tasks are left next to the sprint title", {}).hard, false);
  assert.equal(looksHard("show how many tasks are left next to the sprint title", rerenders).hard, true);
  const virtual = { notes: "- #log is a virtualized list: 37 row elements stand in for about 5,000 items." };
  assert.equal(looksHard("add a copy button to each line", virtual).hard, true);
  assert.equal(looksHard("highlight the error lines in red", virtual).hard, false, "looks on a changing page are fine");
  assert.equal(looksHard("add a button that turns every device off", { notes: "- Web components with open shadow roots: <device-card> ×6." }).hard, true);
});

// ---- the plan

test("plan: fast then strong; hard requests start strong; Always fast / best; a pinned model never changes", () => {
  const models = p => p.steps.map(s => s.model);
  assert.deepEqual(models(planRoute(CC, "make the covers bigger", {})), ["haiku", "sonnet"]);
  const hard = planRoute(CC, "add a button that sorts the products by price", {});
  assert.deepEqual([models(hard), hard.hard], [["sonnet"], true]);
  assert.deepEqual(models(planRoute({ ...CC, mode: "fast" }, "add a button that sorts by price", {})), ["haiku"]);
  assert.deepEqual(models(planRoute({ ...CC, mode: "best" }, "make it bigger", {})), ["sonnet"]);
  assert.deepEqual(models(planRoute({ ...CC, model: "opus", pinned: true }, "make it bigger", {})), ["opus"]);
  assert.deepEqual(models(planRoute({ provider: "demo" }, "make it bigger", {})), [undefined], "no tiers: the settings as they are");
  assert.deepEqual(models(planRoute({ ...CC, mode: "nonsense" }, "make it bigger", {})), ["haiku", "sonnet"], "unknown mode means Automatic");
  // Same name twice: one step.
  assert.deepEqual(models(planRoute({ ...CC, tiers: resolveTiers("claude-code", { fast: "sonnet" }) }, "x", {})), ["sonnet"]);
});

test("tiers stay within the chosen backend; names from config.json win", () => {
  assert.deepEqual(resolveTiers("claude-code"), { fast: { model: "haiku" }, best: { model: "sonnet" } });
  assert.deepEqual(resolveTiers("anthropic"), { fast: { model: "claude-haiku-5-5" }, best: { model: "claude-opus-5-5" } });
  assert.deepEqual(resolveTiers("codex"), { fast: { model: "", effort: "low" }, best: { model: "", effort: "high" } }, "Codex: the plan's model, thinking longer");
  assert.deepEqual(resolveTiers("claude-code", { fast: "claude-haiku-4-5", best: "opus" }), { fast: { model: "claude-haiku-4-5" }, best: { model: "opus" } });
  assert.equal(resolveTiers("openai", {}, { baseUrl: "http://localhost:11434" }), null, "another server: its own names, or none");
  assert.deepEqual(resolveTiers("openai", { fast: "small", best: "big" }, { baseUrl: "http://localhost:11434" }).best, { model: "big" });
  assert.equal(resolveTiers("demo"), null);
  for (const [p, t] of Object.entries(TIERS)) for (const s of planRoute({ provider: p, tiers: resolveTiers(p), mode: "auto" }, "x", {}).steps) assert.equal(s.provider, p, "never another backend");
});

test("escalation rule: a JS error gets the fast model's own repair first; everything else goes up now", () => {
  assert.equal(shouldEscalate("exec", 1), false);
  assert.equal(shouldEscalate("exec", 2), true);
  for (const k of ["effect", "guard", "empty", "model"]) assert.equal(shouldEscalate(k, 1), true, k);
});

test("labels: Automatic until a model answers; the warm model is the first one", () => {
  const { settingsLabel } = providers;
  assert.equal(startLabel(CC, settingsLabel), "Claude Code · Automatic");
  assert.equal(startLabel({ ...CC, mode: "best" }, settingsLabel), "Claude Code · sonnet");
  assert.equal(startLabel({ provider: "claude-code", model: "opus", pinned: true, tiers: CC.tiers }, settingsLabel), "Claude Code · opus");
  assert.equal(startLabel({ provider: "helper", backend: "claude-code", tiers: CC.tiers, mode: "fast", label: "x" }, settingsLabel), "Claude Code · haiku");
  assert.equal(startLabel({ provider: "codex", tiers: resolveTiers("codex"), mode: "best" }, settingsLabel), "Codex · high effort");
  assert.equal(settingsLabel({ provider: "anthropic", tiers: resolveTiers("anthropic"), mode: "auto" }), "Anthropic API · Automatic");
  assert.equal(warmSettings(CC).model, "haiku");
  assert.equal(warmSettings({ ...CC, mode: "best" }).model, "sonnet");
  assert.deepEqual(modelNames(CC, settingsLabel), { fast: "haiku", best: "sonnet" });
  assert.deepEqual(modelNames({ ...CC, model: "opus", pinned: true }, settingsLabel), { pinned: "Claude Code · opus" });
});

// ---- the engine, with fake models

// A fake backend: each model name has a list of replies, used in order.
function fakeModels(replies) {
  const calls = [];
  providers.registerProvider("fake-route", async (s, messages, { onToken }) => {
    calls.push({ model: s.model, prompt: messages.map(m => (typeof m.content === "string" ? m.content : "")).join("\n") });
    const r = replies[s.model]?.shift();
    if (r instanceof Error) throw r;
    if (r == null) throw new Error(`no reply left for ${s.model}`);
    onToken?.(r);
    return r;
  });
  return calls;
}
const FAKE = { provider: "fake-route", model: "", tiers: { fast: { model: "fast" }, best: { model: "strong" } }, mode: "auto" };
const GOOD = "TITLE: Big\n```css\n.cover{width:200px}\n```";
const NOTHING = "TITLE: Big\n```css\n.no-such-thing{width:200px}\n```";
// The effect check (runtime effectProbe): the page changes only when .cover is styled.
function fakePage() {
  let css = "";
  return {
    emit: ev => { if (ev.type === "css") css = ev.css; },
    probe: async sels => ({ fp: css.includes(".cover") ? "changed" : "same", unmatched: sels.filter(s => s !== ".cover") }),
  };
}
const run = (settings, request, extra = {}) => {
  const page = fakePage(), events = [];
  return runMorse({ settings, request, context: { url: "http://x/", title: "x" }, exec: async () => ({ ok: true }),
    emit: ev => { events.push(ev); page.emit(ev); }, probe: page.probe, ...extra }).then(res => ({ res, events }));
};

test("engine: the fast model's draft changes nothing, so the strong model gets it, with what was wrong", async () => {
  const calls = fakeModels({ fast: [NOTHING], strong: [GOOD] });
  const { res, events } = await run(FAKE, "make the covers bigger");
  assert.equal(res.ok, true);
  assert.deepEqual(calls.map(c => c.model), ["fast", "strong"]);
  assert.match(calls[1].prompt, /match no element: `\.no-such-thing`/, "the strong model sees the failed draft's problem");
  assert.equal(res.escalated, true);
  assert.equal(res.attempts, 2);
  assert.equal(res.css.trim(), ".cover{width:200px}");
  assert.ok(events.some(e => e.type === "phase" && e.stronger), "the bar says a stronger model is trying");
  assert.deepEqual(events.filter(e => e.type === "model").map(e => e.tier), ["fast", "best"]);
});

test("engine: an easy request the fast model gets right never touches the strong one", async () => {
  const calls = fakeModels({ fast: [GOOD], strong: [] });
  const { res } = await run(FAKE, "make the covers bigger");
  assert.deepEqual([res.ok, res.escalated, res.tier, calls.length], [true, false, "fast", 1]);
});

test("engine: a JS error gets the fast model's repair round, then the strong model", async () => {
  const JS = "TITLE: Btn\n```js\nmorse.watch('.cover', el => el.append('x'))\n```";
  const calls = fakeModels({ fast: [JS, JS], strong: [JS] });
  let n = 0;
  const { res } = await run(FAKE, "make the covers bigger", { exec: async js => (js && ++n < 3 ? { ok: false, error: "TypeError: boom" } : { ok: true }) });
  assert.deepEqual(calls.map(c => c.model), ["fast", "fast", "strong"]);
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 3);
});

test("engine: a guard hit goes straight to the strong model", async () => {
  const calls = fakeModels({ fast: ["TITLE: X\n```css\nbody{display:none !important}\n```"], strong: [GOOD] });
  const { res } = await run(FAKE, "make the covers bigger");
  assert.deepEqual(calls.map(c => c.model), ["fast", "strong"]);
  assert.equal(res.ok, true);
});

test("engine: class names the page notes call generated go to the strong model (they'd break with the app's next release)", async () => {
  const { generatedNames } = await import("../core/engine.js");
  const notes = { notes: "- Class names here are generated (css-1q2w3e, Header_cart__k3J9x) and change with every release of the app." };
  assert.match(generatedNames({ css: "main div.css-1nsad8 { font-weight: 700 }" }, notes), /\.css-1nsad8/);
  assert.equal(generatedNames({ css: '#__next > main > div:nth-of-type(2), [class*="Header_cart__"] { x: 1 }', js: "" }, notes), null, "structure and the readable start are fine");
  assert.equal(generatedNames({ css: ".css-1nsad8 { x: 1 }" }, { notes: "" }), null, "only where the notes say so");
  const calls = fakeModels({ fast: ["TITLE: X\n```css\n.cover.css-1nsad8{width:200px}\n```"], strong: [GOOD] });
  const page = fakePage();
  const res = await runMorse({ settings: FAKE, request: "make the covers bigger", context: { url: "http://x/", title: "x", ...notes },
    exec: async () => ({ ok: true }), emit: page.emit, probe: page.probe });
  assert.deepEqual([calls.map(c => c.model), res.ok, res.css.trim()], [["fast", "strong"], true, ".cover{width:200px}"]);
  assert.match(calls[1].prompt, /class names the app generates/);
});

test("engine: the fast model failing outright (an error, not a draft) also goes to the strong model", async () => {
  const calls = fakeModels({ fast: [new Error("Claude Code: model not available")], strong: [GOOD] });
  const { res } = await run(FAKE, "make the covers bigger");
  assert.deepEqual([calls.map(c => c.model), res.ok, res.escalated], [["fast", "strong"], true, true]);
  // ...but Stop is Stop.
  const stop = new AbortController(); stop.abort();
  fakeModels({ fast: [Object.assign(new Error("aborted"), { name: "AbortError" })], strong: [GOOD] });
  await assert.rejects(run(FAKE, "make the covers bigger", { signal: stop.signal }), /aborted/);
});

test("engine: a hard request starts on the strong model; Always fast and a pinned model never move", async () => {
  let calls = fakeModels({ strong: [GOOD] });
  let { res } = await run(FAKE, "add a button that sorts the products by price");
  assert.deepEqual([calls.map(c => c.model), res.hard, res.escalated], [["strong"], true, false]);
  calls = fakeModels({ fast: [NOTHING, NOTHING], strong: [GOOD] });
  ({ res } = await run({ ...FAKE, mode: "fast" }, "make the covers bigger"));
  assert.deepEqual([calls.map(c => c.model), res.escalated], [["fast", "fast"], false], "its own repair round only");
  calls = fakeModels({ only: [NOTHING, NOTHING], strong: [GOOD] });
  ({ res } = await run({ ...FAKE, model: "only", pinned: true }, "make the covers bigger"));
  assert.deepEqual(calls.map(c => c.model), ["only", "only"], "one repair round, as before");
});

test("engine: both models wrong means one more try on the strong model, and no more", async () => {
  const calls = fakeModels({ fast: [NOTHING], strong: [NOTHING, NOTHING] });
  const { res } = await run(FAKE, "make the covers bigger");
  assert.deepEqual(calls.map(c => c.model), ["fast", "strong", "strong"]);
  assert.equal(res.attempts, 3);
});

// ---- the warm process (speed): the first model stays warm

test("prewarm warms the model requests start on", async () => {
  const seen = [];
  providers.registerProvider("fake-warm", async () => GOOD, { warm: s => seen.push(s.model) });
  const s = { provider: "fake-warm", tiers: { fast: { model: "fast" }, best: { model: "strong" } } };
  await providers.prewarm({ ...s, mode: "auto" });
  await providers.prewarm({ ...s, mode: "best" });
  await providers.prewarm({ ...s, model: "pinned", pinned: true, mode: "auto" });
  assert.deepEqual(seen, ["fast", "strong", "pinned"]);
});

test("claude-code: after a request on the strong model, haiku is the one kept warm", async () => {
  process.env.FAKE_MODE = "ok";
  process.env.FAKE_WARM_TAG = String(Date.now());
  const { SYSTEM_PROMPT } = await import("../core/prompt.js");
  const MSGS = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "add a button" }];
  const starts = async () => (await fs.readFile(path.join(tmp, "claude-starts.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).map(Number);
  const strong = planRoute(CC, "make it bigger", {}).steps[1];
  assert.equal(strong.model, "sonnet");
  const n = (await starts()).length;
  await providers.streamChat(strong, MSGS);
  const served = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.equal(served.argv[served.argv.indexOf("--model") + 1], "sonnet");
  await waitFor(async () => (await starts()).length > n + 1, { what: "the next process to start" });
  const next = (await starts()).at(-1);
  await providers.streamChat(planRoute(CC, "make it bigger", {}).steps[0], MSGS);
  const fast = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.equal(fast.pid, next, "the process started ahead of time answered");
  assert.equal(fast.argv[fast.argv.indexOf("--model") + 1], "haiku");
});

test("codex: the strong tier thinks longer through model_reasoning_effort", async () => {
  process.env.FAKE_MODE = "ok";
  const best = planRoute({ provider: "codex", tiers: resolveTiers("codex"), mode: "best" }, "x", {}).steps[0];
  await providers.streamChat(best, [{ role: "system", content: "s" }, { role: "user", content: "x" }]);
  const { argv } = JSON.parse(await fs.readFile(path.join(tmp, "codex.json"), "utf8"));
  assert.equal(argv[argv.indexOf("-c", argv.indexOf("features.web_search_request=false")) + 1], "model_reasoning_effort=high");
  assert.ok(!argv.includes("-m"), "the plan's own model");
});

// ---- the setting and where it is saved

test("prefs: Model is Automatic unless set; only the three choices are kept", () => {
  assert.equal(DEFAULT_PREFS.modelMode, "auto");
  assert.equal(normalizePrefs({}).modelMode, "auto");
  assert.equal(normalizePrefs({ modelMode: "best" }).modelMode, "best");
  assert.equal(normalizePrefs({ modelMode: "opus" }).modelMode, "auto");
  assert.equal(mergePrefs({ modelMode: "fast", theme: "dark" }, { theme: "light" }).modelMode, "fast", "other settings keep it");
});

test("settings: the bar's Model setting is saved and read back; config.json holds the names and a pinned model", async () => {
  await store.savePrefs({ modelMode: "best" });
  assert.equal((await store.loadPrefs()).modelMode, "best");
  await store.saveConfig({ provider: "claude-code", tiers: { "claude-code": { fast: "claude-haiku-4-5" } } });
  let s = await models.currentSettings();
  assert.deepEqual([s.mode, s.pinned, s.tiers.fast.model, s.tiers.best.model], ["best", false, "claude-haiku-4-5", "sonnet"]);
  assert.equal((await models.currentSettings({}, { env: { MORSE_MODEL_MODE: "fast" } })).mode, "fast");
  s = models.settingsFromConfig({ provider: "claude-code", models: { "claude-code": "opus" } }, {}, { env: {}, harnesses: { claude: { found: true }, codex: {} } });
  assert.deepEqual([s.model, s.pinned], ["opus", true], "a model named in config.json is used for everything");
  await store.savePrefs({ modelMode: "auto" });
});

test("morse config: --model-mode, --fast-model and --best-model are saved; --model auto lets Morse choose again", async () => {
  const env = { ...process.env, NO_COLOR: "1" };
  const cli = (...args) => spawnSync(process.execPath, [CLI, "config", ...args], { env, encoding: "utf8" });
  let r = cli("--provider", "claude-code", "--model-mode", "fast", "--fast-model", "claude-haiku-4-5", "--best-model", "opus");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Claude Code · claude-haiku-4-5/);
  assert.match(r.stdout, /always fast · fast claude-haiku-4-5 · best opus/);
  assert.equal((await store.loadPrefs()).modelMode, "fast");
  assert.deepEqual((await store.loadConfig()).tiers["claude-code"], { fast: "claude-haiku-4-5", best: "opus" });
  r = cli("--model", "sonnet");
  assert.match(r.stdout, /^Claude Code · sonnet/m);
  r = cli("--model", "auto", "--model-mode", "auto");
  assert.match(r.stdout, /^Claude Code · Automatic/m);
  assert.equal((await store.loadConfig()).models?.["claude-code"], undefined);
  assert.notEqual(cli("--model-mode", "smart").status, 0);
});
