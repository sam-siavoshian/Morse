// First run without a browser: `morse setup` detection and choices, the
// getting started a bare `morse` prints, and the shared onboarding rules
// (state, unsupported pages, errors in plain words).
import { tempDir } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectBackends, recommend, configFor, applyChoice, isSetUp, runSetup, whichBin, gettingStarted } from "../daemon/setup.js";
import { settingsFromConfig, migrateLegacy } from "../daemon/models.js";
import { pageSupport, explainError, plainError, mergeOnboarding, normalizeOnboarding, modelMissing, setHelperPort } from "../core/onboarding.js";

const plain = s => s.replace(/\x1b\[\d+m/g, "");
const CLI = new URL("../daemon/cli.js", import.meta.url).pathname;

// A fake machine: which binaries exist, their versions, env.
function machine({ bins = {}, env = {} } = {}) {
  return {
    env,
    which: async name => (bins[name] ? `/usr/local/bin/${name}` : ""),
    version: async p => bins[path.basename(p)] || "",
  };
}

test("detects Claude Code, Codex and API keys, and recommends in that order", async () => {
  const rows = await detectBackends(machine({ bins: { claude: "2.1.3", codex: "0.46.0" }, env: { OPENAI_API_KEY: "sk-x" } }));
  assert.deepEqual(rows.map(r => [r.id, r.found]), [["claude-code", true], ["codex", true], ["api-key", true]]);
  assert.equal(rows[0].version, "2.1.3");
  assert.match(rows[0].detail, /2\.1\.3 {2}\/usr\/local\/bin\/claude/);
  assert.equal(rows[2].keyEnv, "OPENAI_API_KEY");
  assert.equal(rows[2].vendor, "openai");
  assert.equal(recommend(rows).id, "claude-code");

  const onlyCodex = await detectBackends(machine({ bins: { codex: "0.46.0" } }));
  assert.equal(recommend(onlyCodex).id, "codex");
  const anthropic = await detectBackends(machine({ env: { ANTHROPIC_API_KEY: "sk-ant-x", OPENAI_API_KEY: "sk-y" } }));
  assert.equal(anthropic[2].keyEnv, "ANTHROPIC_API_KEY", "Anthropic's key wins when both are set");
  assert.equal(recommend(anthropic).id, "api-key");
});

test("nothing installed: nothing to recommend", async () => {
  assert.equal(recommend(await detectBackends(machine())), null);
});

test("whichBin finds executables on PATH and skips plain files", async () => {
  const dir = tempDir("morse-path-");
  await fs.writeFile(path.join(dir, "codex"), "#!/bin/sh\necho codex-cli 0.46.0\n", { mode: 0o755 });
  await fs.writeFile(path.join(dir, "claude"), "not executable", { mode: 0o644 });
  try {
    assert.equal(await whichBin("codex", { env: { PATH: dir }, platform: "linux" }), path.join(dir, "codex"));
    if (process.platform !== "win32") assert.equal(await whichBin("claude", { env: { PATH: dir }, platform: "linux" }), "");
    const rows = await detectBackends({ env: { PATH: dir } });
    assert.equal(rows[1].found, true);
    if (process.platform !== "win32") assert.equal(rows[1].version, "0.46.0", "reads the version from --version");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("config for each choice, in the shape the model settings read", () => {
  assert.deepEqual(configFor("claude-code"), { provider: "claude-code" });
  assert.deepEqual(configFor("codex"), { provider: "codex" });
  assert.deepEqual(configFor("api-key", { key: "sk-ant-abc" }), { provider: "anthropic", keys: { anthropic: "sk-ant-abc" } });
  assert.deepEqual(configFor("api-key", { key: "sk-proj-abc" }), { provider: "openai", keys: { openai: "sk-proj-abc" } });
  assert.deepEqual(configFor("api-key", { vendor: "anthropic" }), { provider: "anthropic" }, "a key from the environment is not written");
  assert.throws(() => configFor("gpt"), /doesn't know “gpt”/);
  assert.equal(isSetUp({}), false);
  assert.equal(isSetUp({ model: { provider: "auto" } }), false);
  assert.equal(isSetUp({ model: { provider: "codex" } }), true);
  assert.equal(isSetUp({ provider: "codex" }), true);

  // What setup saves is what Morse then uses (it used to write a "model"
  // record nothing read: a pasted key was lost, and Codex lost to Claude Code).
  const none = { claude: { found: true }, codex: { found: true } };
  const read = cfg => settingsFromConfig(cfg, {}, { env: {}, harnesses: none });
  assert.equal(read(applyChoice({}, configFor("codex"))).provider, "codex");
  const keyed = read(applyChoice({ keys: { openai: "sk-o" } }, configFor("api-key", { key: "sk-ant-abc" })));
  assert.deepEqual([keyed.provider, keyed.apiKey], ["anthropic", "sk-ant-abc"]);
  // An older setup's record still counts, and survives `morse config`.
  assert.equal(read({ model: { provider: "codex" } }).provider, "codex");
  assert.deepEqual([read({ model: { provider: "anthropic", apiKey: "sk-ant-old" } }).apiKey], ["sk-ant-old"]);
  assert.deepEqual(migrateLegacy({ model: { provider: "openai", apiKey: "sk-x" } }), { model: { provider: "openai", apiKey: "sk-x" }, provider: "openai", keys: { openai: "sk-x" } });
  assert.equal(applyChoice({ model: { provider: "codex" }, keep: 1 }, configFor("claude-code")).model, undefined, "the old record is dropped");
});

// Runs `morse setup` against a fake machine with piped answers.
async function setup(answers, { args = [], ...m } = {}) {
  const input = new PassThrough(), output = new PassThrough();
  let text = "";
  output.on("data", d => (text += d));
  let saved = null;
  const run = runSetup(args, { input, output, deps: machine(m), load: async () => ({ keep: 1 }), save: async c => { saved = c; }, platform: "mac" });
  for (const a of answers) input.write(a + "\n");
  input.end();
  const res = await run;
  return { res, saved, out: plain(text) };
}

test("setup: Enter takes the recommendation and saves it", async () => {
  const { res, saved, out } = await setup([""], { bins: { claude: "2.1.3" } });
  assert.equal(res.saved, true);
  assert.equal(saved.provider, "claude-code", "written where daemon/models.js reads it");
  assert.equal(saved.model, undefined);
  assert.equal(saved.keep, 1, "keeps the rest of config.json");
  assert.equal(saved.setup.backend, "claude-code");
  assert.match(out, /✓ Claude Code {2}2\.1\.3/);
  assert.match(out, /Claude Code {2}uses your Claude subscription {2}recommended/);
  assert.match(out, /Morse will use Claude Code/);
  assert.match(out, /press ⌥Space, point at something/);
});

test("setup: an API key is pasted, or taken from the environment", async () => {
  const pasted = await setup(["3", "sk-ant-secret"]);
  assert.equal(pasted.saved.provider, "anthropic");
  assert.deepEqual(pasted.saved.keys, { anthropic: "sk-ant-secret" });
  const fromEnv = await setup(["3"], { env: { OPENAI_API_KEY: "sk-env" } });
  assert.equal(fromEnv.saved.provider, "openai");
  assert.equal(fromEnv.saved.keys, undefined);
  assert.equal(fromEnv.saved.baseUrls, undefined);
  assert.match(fromEnv.out, /with OPENAI_API_KEY from your environment/);
  assert.ok(!JSON.stringify(fromEnv.saved).includes("sk-env"), "a key from the environment is never written to disk");
});

test("setup: choosing something that isn't installed says how to install it and saves nothing", async () => {
  const { res, saved, out } = await setup(["2"], { bins: { claude: "2.1.3" } });
  assert.equal(res.saved, false);
  assert.equal(saved, null);
  assert.match(out, /Codex isn't installed yet\. Install it with npm install -g @openai\/codex, then run morse setup again\./);
  const bad = await setup(["9"]);
  assert.equal(bad.res.saved, false);
  assert.match(bad.out, /isn't one of the choices/);
});

test("setup: --use picks without questions; no answer saves nothing", async () => {
  const { saved } = await setup([], { args: ["--use", "codex"], bins: { codex: "0.46.0" } });
  assert.equal(saved.provider, "codex");
  const none = await setup([]);
  assert.equal(none.res.saved, false);
  assert.match(none.out, /Run morse setup --use api-key to pick without questions/);
});

test("setup checks that the model answers, and says exactly what to do when it doesn't", async () => {
  const run = async (check, answers = [""], m = { bins: { claude: "2.1.3" } }) => {
    const input = new PassThrough(), output = new PassThrough();
    let text = "";
    output.on("data", d => (text += d));
    const p = runSetup([], { input, output, deps: machine(m), load: async () => ({}), save: async () => {}, check, platform: "mac" });
    for (const a of answers) input.write(a + "\n");
    input.end();
    return { res: await p, out: plain(text) };
  };
  const ok = await run(async () => ({ ok: true, ms: 5800 }));
  assert.match(ok.out, /✓ Claude Code answered in 5\.8s\./);
  const bad = await run(async () => ({ ok: false, error: "The model didn't accept the sign-in or API key. Check it in model settings." }));
  assert.equal(bad.res.saved, true, "the choice is still saved");
  assert.match(bad.out, /✗ Claude Code didn't answer: .*\n\s+Run claude once in a terminal and sign in, then run morse setup again\./);
  const key = await run(async () => { throw new Error("401"); }, ["3", "sk-ant-x"], {});
  assert.match(key.out, /Check the key at console\.anthropic\.com, then run morse setup again\./);
});

test("setup --pair: a bad code says what to do; the helper takes the welcome page's code", async () => {
  const bad = spawnSync(process.execPath, [CLI, "setup", "--pair", "oops"], { env: { ...process.env, MORSE_HOME: os.tmpdir() }, encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(plain(bad.stderr), /That pairing code doesn't look right\. Copy the whole command from Morse's welcome page again\./);
  // In a child process: daemon/store.js reads MORSE_HOME once, when first imported.
  const home = tempDir("morse-pair-");
  try {
    const bridge = new URL("../daemon/bridge.js", import.meta.url).href;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const { startPairing, validPairingCode } = await import(${JSON.stringify(bridge)});
      const bad = await startPairing(undefined, "abc").then(() => "", e => e.message);
      const { code } = await startPairing(undefined, "K7P2QX");
      console.log(JSON.stringify({ ok: validPairingCode("K7P2QX"), zero: validPairingCode("K7P2Q0"), bad, code }));`], { env: { ...process.env, MORSE_HOME: home }, encoding: "utf8" });
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.zero, false, "no zero: it reads like O");
    assert.match(out.bad, /doesn't look right/);
    assert.equal(out.code, "K7P2QX");
    const cfg = JSON.parse(await fs.readFile(path.join(home, "config.json"), "utf8"));
    assert.equal(cfg.bridge.pairing.code, "K7P2QX");
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test("bare `morse` prints a three-line getting started until something is set up", async () => {
  const lines = plain(gettingStarted({ platform: "win" })).split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /run morse setup/);
  assert.match(lines[2], /Press Ctrl\+Shift\+Space/);

  const home = tempDir("morse-home-");
  try {
    const env = { ...process.env, MORSE_HOME: home };
    const first = spawnSync(process.execPath, [CLI], { env, encoding: "utf8" });
    assert.equal(first.status, 0);
    assert.equal(plain(first.stdout).trim().split("\n").length, 3);
    assert.match(first.stdout, /Welcome to Morse/);
    await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ model: { provider: "codex" } }));
    const later = spawnSync(process.execPath, [CLI], { env, encoding: "utf8" });
    assert.match(later.stdout, /morse setup {15}choose Claude Code, Codex/, "the help lists setup");
    assert.doesNotMatch(later.stdout, /Welcome to Morse/);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test("onboarding state merges one level deep and drops unknown keys", () => {
  assert.deepEqual(normalizeOnboarding(null), { coach: "", tips: { saved: false, share: false }, dismissed: { model: false, userScripts: false } });
  const a = mergeOnboarding({ tips: { share: true } }, { coach: "done", tips: { saved: true }, junk: 1 });
  assert.deepEqual(a, { coach: "done", tips: { saved: true, share: true }, dismissed: { model: false, userScripts: false } });
  assert.equal(mergeOnboarding(a, { coach: "" }).coach, "", "the tour can be shown again");
});

test("unsupported pages are explained in one sentence, with what to do", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";
  const cases = [
    ["chrome://settings", "browser", "practice"],
    ["chrome://newtab/", "newtab", "practice"],
    ["about:blank", "newtab", "practice"],
    ["edge://flags", "browser", "practice"],
    ["view-source:https://example.com", "browser", "practice"],
    ["https://chromewebstore.google.com/detail/x", "webstore", "practice"],
    ["https://chrome.google.com/webstore/category", "webstore", "practice"],
    ["chrome-extension://otherotherotherotherotherotherot/page.html", "extension", "practice"],
    ["https://example.com/report.PDF", "pdf", undefined],
    ["data:text/html,hi", "other", undefined],
  ];
  for (const [url, want, action] of cases) {
    const r = pageSupport(url, { extensionId: id });
    assert.equal(r?.id, want, url);
    assert.equal(r.action, action, url);
    assert.ok(r.text.length < 120 && /\.$/.test(r.text), `one sentence: ${r.text}`);
  }
  assert.equal(pageSupport("file:///home/me/a.html", { fileAccess: false }).action, "extension-settings");
  assert.equal(pageSupport("file:///home/me/a.html", { fileAccess: true }), null);
  assert.equal(pageSupport("https://example.com/"), null);
  assert.equal(pageSupport("https://chrome.google.com/search"), null);
  assert.equal(pageSupport(`chrome-extension://${id}/welcome.html`, { extensionId: id }), null, "the welcome page has a practice area");
});

test("generation errors in plain words, each with something to do", () => {
  const cases = [
    ["This site blocks injected scripts. Turn on “Allow User Scripts” for Morse in chrome://extensions.", "userscripts"],
    ["Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source", "userscripts"],
    ["fetch failed: connect ECONNREFUSED 127.0.0.1:7457", "model"], // the Morse app isn't open: connect to it (or, on the desktop, open it)
    ["spawn claude ENOENT", "model"],
    ["Model server returned 401", "model"],
    ["Invalid API key provided", "model"],
    ["Failed to fetch", "model"],
    ["model 'gpt-9-turbo' not found", "model"],
    ["Model server returned 503", ""],
    ["It ran, but nothing on the page changed. These selectors match no element: .x", ""],
    ["Model server returned 429", ""],
    ["The reply had no ```css or ```js block.", ""],
    ["TypeError: Cannot read properties of null (reading 'append')", ""],
  ];
  for (const [msg, action] of cases) {
    const r = explainError(msg);
    assert.ok(r, msg);
    assert.equal(r.action, action, msg);
    assert.doesNotMatch(r.text, /ECONN|TypeError|401|403|429|```/, "no jargon in the sentence");
  }
  assert.equal(explainError("Stopped"), null);
  assert.equal(explainError("something nobody has seen before"), null, "unknown errors keep their own words");
  assert.equal(modelMissing({}, "demo model · no model found"), true);
  assert.equal(modelMissing({ model: { connected: true } }, "demo model"), false, "the host's answer wins over the label");
  assert.equal(modelMissing({}, "Claude Code · haiku"), false);
});

test("the helper not running reads the same on any port the helper was moved to", () => {
  const refused = port => explainError(`fetch failed: connect ECONNREFUSED 127.0.0.1:${port}`)?.id;
  assert.equal(refused(7457), "err.helper");
  assert.notEqual(refused(41234), "err.helper", "another local server isn't the helper");
  setHelperPort(41234); // MORSE_HELPER_PORT=41234 (daemon/cli.js)
  try {
    assert.equal(refused(41234), "err.helper");
    assert.equal(refused(7457), "err.helper");
    assert.notEqual(refused(412345), "err.helper");
    assert.notEqual(refused(11434), "err.helper");
  } finally { setHelperPort(7457); }
});

test("plainError: plain words for a person, never raw jargon", () => {
  // Morse's own sentences pass through as they are.
  assert.equal(plainError("No mod with that name."), "No mod with that name.");
  assert.equal(plainError(new Error("Paste a share link first.")), "Paste a share link first.");
  // Known errors get their sentence.
  assert.match(plainError(new Error("Failed to fetch")), /^Morse couldn't reach the model\./);
  // Raw technical messages nobody can act on become one plain line.
  for (const raw of [
    "Uncaught DOMException: The operation is insecure.",
    "RangeError: Maximum call stack size exceeded",
    "EPIPE: broken pipe",
    "400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\"}}",
    "x => y",
    "status 418 from helper",
  ]) assert.equal(plainError(raw), "Something went wrong. Try again.", raw);
  // Morse's own sentences may show a command to type.
  assert.equal(plainError("Morse isn't connected to any app. Start one with morse launch <app>."), "Morse isn't connected to any app. Start one with morse launch <app>.");
  assert.equal(plainError(""), "Something went wrong. Try again.");
  assert.equal(plainError("AbortError: signal is aborted without reason"), "Stopped. Nothing was changed.");
});
