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

test("looks hard: small tweaks (looks, hiding, layout, text) stay on the first model", () => {
  for (const r of ["make the album covers bigger", "hide the ads", "make the play button green", "add a border to the cards",
    "keep this bar at the top when I scroll", "rename this to Create note", "I can't read this, make it bigger", "add some space between the rows",
    "hide the DEBUG lines", "make the high priority tasks stand out in orange", "show the sidebar again", "highlight the cities with more than a million people"]) {
    assert.equal(looksHard(r, { notes: "" }).hard, false, r);
  }
});

test("looks hard: new UI, new behavior and restyles start on the strong model, each on its own", () => {
  for (const [r, why] of [["add a sleep timer", "adds behavior"], ["add a summary panel above the orders", "new UI"],
    ["show a word count under the message box", "new UI"], ["put a little badge on unread emails", "new UI"],
    ["show how many tasks are left next to the sprint title", "new UI"], ["dark mode please", "a restyle"],
    ["make it dark, my eyes hurt", "a restyle"], ["restyle the cards so they look native", "a restyle"], ["make this less cluttered", "a restyle"]]) {
    const h = looksHard(r, { notes: "" });
    assert.equal(h.hard, true, r);
    assert.ok(h.why.includes(why), `${r}: ${h.why}`);
  }
});

test("looks hard: why, and the weaker signals (data, several steps, a canvas, a changing list) in pairs", () => {
  assert.deepEqual(looksHard("add a button that sorts the products by price, lowest first", {}).why, ["adds behavior", "new UI", "works with the data"]);
  assert.equal(looksHard("add a button to save my drawing as a PNG", {}).hard, true);
  assert.equal(looksHard("add a dark mode toggle, then remember it", {}).hard, true);
  // The page notes count: the same words on a page that re-renders are harder.
  const rerenders = { notes: "- This page re-renders: lately the app replaced what is inside main (3×)." };
  assert.equal(looksHard("make the total in each row bold", {}).hard, false);
  assert.equal(looksHard("make the total in each row bold", rerenders).hard, true);
  const virtual = { notes: "- #log is a virtualized list: 37 row elements stand in for about 5,000 items." };
  assert.equal(looksHard("add a copy button to each line", virtual).hard, true);
  assert.equal(looksHard("highlight the error lines in red", virtual).hard, false, "looks on a changing page are fine");
  assert.equal(looksHard("add a button that turns every device off", { notes: "- Web components with open shadow roots: <device-card> ×6." }).hard, true);
});

// ---- the plan

test("plan: fast then strong; hard requests start strong; Always fast / best; a pinned model never changes", () => {
  // A step is its model and how long it thinks: by default the same strong model, briefly then longer.
  const models = p => p.steps.map(s => (s.effort ? `${s.model}/${s.effort}` : s.model));
  assert.deepEqual(models(planRoute(CC, "make the covers bigger", {})), ["opus/low", "opus/high"]);
  const hard = planRoute(CC, "add a button that sorts the products by price", {});
  assert.deepEqual([models(hard), hard.hard], [["opus/high"], true]);
  assert.deepEqual(models(planRoute(CC, "add a reading progress bar at the top", {})), ["opus/high"], "new UI starts on the strong tier");
  assert.deepEqual(models(planRoute({ ...CC, mode: "fast" }, "add a button that sorts by price", {})), ["opus/low"]);
  assert.deepEqual(models(planRoute({ ...CC, mode: "best" }, "make it bigger", {})), ["opus/high"]);
  assert.deepEqual(models(planRoute({ ...CC, model: "opus", pinned: true }, "make it bigger", {})), ["opus"]);
  assert.deepEqual(models(planRoute({ provider: "demo" }, "make it bigger", {})), [undefined], "no tiers: the settings as they are");
  assert.deepEqual(models(planRoute({ ...CC, mode: "nonsense" }, "make it bigger", {})), ["opus/low", "opus/high"], "unknown mode means Automatic");
  // The same model and effort twice: one step.
  assert.deepEqual(models(planRoute({ ...CC, tiers: resolveTiers("claude-code", { fast: { model: "opus", effort: "high" } }) }, "x", {})), ["opus/high"]);
  // Someone who chose haiku keeps it.
  assert.deepEqual(models(planRoute({ ...CC, tiers: resolveTiers("claude-code", { fast: "haiku" }) }, "make it bigger", {})), ["haiku", "opus/high"]);
});

test("tiers stay within the chosen backend; names from config.json win", () => {
  // The defaults are strong models: no small model unless the person names one.
  assert.deepEqual(resolveTiers("claude-code"), { fast: { model: "opus", effort: "low" }, best: { model: "opus", effort: "high" } });
  assert.deepEqual(resolveTiers("anthropic"), { fast: { model: "claude-opus-5-5", effort: "low" }, best: { model: "claude-opus-5-5", effort: "high" } });
  assert.deepEqual(resolveTiers("openai"), { fast: { model: "gpt-5" }, best: { model: "gpt-5", effort: "high" } }, "OpenAI: gpt-5, reasoning longer");
  assert.deepEqual(resolveTiers("codex"), { fast: { model: "", effort: "medium" }, best: { model: "", effort: "high" } }, "Codex: the plan's model, thinking longer");
  for (const t of Object.values(TIERS)) assert.ok(!/haiku|mini/.test(t.fast.model + t.best.model), "never a small model by default");
  assert.deepEqual(resolveTiers("openai", { best: "gpt-4.1" }).best, { model: "gpt-4.1" }, "another model doesn't inherit gpt-5's effort");
  assert.deepEqual(resolveTiers("claude-code", { fast: "claude-haiku-4-5", best: "opus" }), { fast: { model: "claude-haiku-4-5" }, best: { model: "opus", effort: "high" } });
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
  assert.equal(startLabel({ ...CC, mode: "best" }, settingsLabel), "Claude Code · opus, high effort");
  assert.equal(startLabel({ provider: "claude-code", model: "opus", pinned: true, tiers: CC.tiers }, settingsLabel), "Claude Code · opus");
  assert.equal(startLabel({ provider: "codex", tiers: resolveTiers("codex"), mode: "best" }, settingsLabel), "Codex · high effort");
  assert.equal(settingsLabel({ provider: "anthropic", tiers: resolveTiers("anthropic"), mode: "auto" }), "Anthropic API · Automatic");
  assert.equal(startLabel({ provider: "openai", tiers: resolveTiers("openai"), mode: "best" }, settingsLabel), "gpt-5, high effort · API");
  assert.equal(warmSettings(CC).effort, "low");
  assert.equal(warmSettings({ ...CC, mode: "best" }).effort, "high");
  // While the person types: the model those words would start on.
  assert.equal(warmSettings(CC, "add a summary panel at the top").effort, "high");
  assert.equal(warmSettings(CC, "hide the ads").effort, "low");
  assert.equal(warmSettings({ ...CC, mode: "fast" }, "add a summary panel at the top").effort, "low", "Always fast stays fast");
  assert.deepEqual(modelNames(CC, settingsLabel), { fast: "opus, low effort", best: "opus, high effort" });
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
  let { res } = await run(FAKE, "add a summary panel above the orders");
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

test("prewarm warms the model requests start on; while typing, the one the words start on", async () => {
  const seen = [];
  providers.registerProvider("fake-warm", async () => GOOD, { warm: s => seen.push(s.model) });
  const s = { provider: "fake-warm", tiers: { fast: { model: "fast" }, best: { model: "strong" } } };
  await providers.prewarm({ ...s, mode: "auto" });
  await providers.prewarm({ ...s, mode: "best" });
  await providers.prewarm({ ...s, model: "pinned", pinned: true, mode: "auto" });
  await providers.prewarm({ ...s, mode: "auto" }, "add a button that copies the conversation");
  await providers.prewarm({ ...s, mode: "auto" }, "hide the ads");
  await providers.prewarm({ ...s, model: "pinned", pinned: true, mode: "auto" }, "add a button that copies the conversation");
  assert.deepEqual(seen, ["fast", "strong", "pinned", "strong", "fast", "pinned"]);
});

// perf: the bar warms on opening and again on each pause in typing (500 ms,
// runtime/src/50-bar.js warmAsYouType). Words only ever turn a request hard,
// so a typed request starts at most one more process; pauses that keep the
// same model start none (docs/perf/report.md).
test("warm while typing: one process when the bar opens, one more when the words turn hard, none on other pauses", async () => {
  process.env.FAKE_MODE = "ok";
  process.env.FAKE_WARM_TAG = `typing-${Date.now()}`;
  const starts = async () => (await fs.readFile(path.join(tmp, "claude-starts.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).map(Number);
  const n = (await starts()).length;
  await providers.prewarm(CC); // the bar opens
  await waitFor(async () => (await starts()).length >= n + 1, { what: "sonnet" }); // (a process stopped before it ran never logs)
  const words = "add a dark mode toggle to the header".split(" ");
  for (let i = 1; i <= words.length; i++) {
    const so = words.slice(0, i).join(" ");
    await providers.prewarm(CC, so); // a pause after every word
    await providers.prewarm(CC, so); // and the same words again (the bar sends each once; the extension's helper may repeat)
  }
  await waitFor(async () => (await starts()).length >= n + 2, { what: "sonnet, then opus" });
  await new Promise(r => setTimeout(r, 1500));
  assert.equal((await starts()).length - n, 2, "processes started for one typed request");
  // Requests that stay easy keep the first model's process.
  const m = (await starts()).length;
  process.env.FAKE_WARM_TAG = `typing-easy-${Date.now()}`;
  await providers.prewarm(CC);
  for (const so of ["make", "make the", "make the header", "make the header blue"]) await providers.prewarm(CC, so);
  await waitFor(async () => (await starts()).length >= m + 1, { what: "sonnet" });
  await new Promise(r => setTimeout(r, 1500));
  assert.equal((await starts()).length - m, 1, "processes started for an easy request");
});

test("claude-code: after a request on the strong tier, the first one (opus, low effort) is the one kept warm", async () => {
  process.env.FAKE_MODE = "ok";
  process.env.FAKE_WARM_TAG = String(Date.now());
  const { SYSTEM_PROMPT } = await import("../core/prompt.js");
  const MSGS = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "add a button" }];
  const starts = async () => (await fs.readFile(path.join(tmp, "claude-starts.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).map(Number);
  const strong = planRoute(CC, "make it bigger", {}).steps[1];
  assert.equal(strong.model, "opus");
  const n = (await starts()).length;
  await providers.streamChat(strong, MSGS);
  const served = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.equal(served.argv[served.argv.indexOf("--model") + 1], "opus");
  await waitFor(async () => (await starts()).length > n + 1, { what: "the next process to start" });
  const next = (await starts()).at(-1);
  await providers.streamChat(planRoute(CC, "make it bigger", {}).steps[0], MSGS);
  const fast = JSON.parse(await fs.readFile(path.join(tmp, "claude.json"), "utf8"));
  assert.equal(fast.pid, next, "the process started ahead of time answered");
  assert.equal(fast.argv[fast.argv.indexOf("--model") + 1], "opus");
  assert.equal(fast.argv[fast.argv.indexOf("--effort") + 1], "low");
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
  assert.equal(DEFAULT_PREFS.modelPick, "");
  assert.equal(normalizePrefs({ modelPick: "sonnet" }).modelPick, "sonnet");
  assert.equal(normalizePrefs({ modelPick: "auto" }).modelPick, "auto");
  assert.equal(normalizePrefs({ modelPick: "../etc/passwd" }).modelPick, "");
  assert.equal(mergePrefs({ modelPick: "haiku", theme: "dark" }, { theme: "light" }).modelPick, "haiku");
});

test("a model chosen in the bar is the one the next request uses", () => {
  const { applyModelPick, modelChoicesFor } = providers;
  const claude = { provider: "claude-code", model: "", pinned: false, tiers: resolveTiers("claude-code"), mode: "auto" };
  assert.deepEqual(modelChoicesFor(claude, "").ids, ["opus", "sonnet", "haiku"]);
  assert.equal(modelChoicesFor(claude, "").current, "auto");
  assert.equal(modelChoicesFor({ provider: "codex", tiers: resolveTiers("codex") }, ""), null, "Codex has no named models");
  const picked = applyModelPick(claude, "haiku");
  assert.equal(picked.pinned, true);
  const hard = planRoute(picked, "add a button that copies the title", {});
  assert.deepEqual([hard.mode, hard.steps.length, hard.steps[0].model], ["single", 1, "haiku"], "routing stays off once a model is chosen");
  assert.equal(warmSettings(picked, "add a panel").model, "haiku");
  assert.equal(applyModelPick(claude, "gpt-9").model, "", "a model this provider doesn't have is ignored");
  const pinned = { ...claude, model: "opus", pinned: true };
  assert.equal(modelChoicesFor(pinned, "").current, "opus");
  const back = applyModelPick(pinned, "auto");
  assert.equal(back.pinned, false);
  assert.equal(planRoute(back, "hide the sidebar", {}).steps[0].model, "opus");
  const openai = { provider: "openai", model: "gpt-5", pinned: false, tiers: resolveTiers("openai"), mode: "auto" };
  assert.equal(applyModelPick(openai, "gpt-5-mini").model, "gpt-5-mini");
});

test("settings: the bar's Model setting is saved and read back; config.json holds the names and a pinned model", async () => {
  await store.savePrefs({ modelMode: "best" });
  assert.equal((await store.loadPrefs()).modelMode, "best");
  await store.saveConfig({ provider: "claude-code", tiers: { "claude-code": { fast: "claude-haiku-4-5" } } });
  let s = await models.currentSettings();
  assert.deepEqual([s.mode, s.pinned, s.tiers.fast.model, s.tiers.best.model], ["best", false, "claude-haiku-4-5", "opus"], "a haiku chosen in config.json is kept");
  // An older config.json with no names gets the current defaults.
  await store.saveConfig({ provider: "claude-code" });
  s = await models.currentSettings();
  assert.deepEqual([s.tiers.fast.model, s.tiers.best.model], ["opus", "opus"]);
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
  assert.match(r.stdout, /Always fast · fast claude-haiku-4-5 · best opus/);
  assert.equal((await store.loadPrefs()).modelMode, "fast");
  assert.deepEqual((await store.loadConfig()).tiers["claude-code"], { fast: "claude-haiku-4-5", best: "opus" });
  r = cli("--model", "sonnet");
  assert.match(r.stdout, /^Claude Code · sonnet/m);
  r = cli("--model", "auto", "--model-mode", "auto");
  assert.match(r.stdout, /^Claude Code · Automatic/m);
  assert.equal((await store.loadConfig()).models?.["claude-code"], undefined);
  assert.notEqual(cli("--model-mode", "smart").status, 0);
});
