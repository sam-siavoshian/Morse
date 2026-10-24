// `morse setup`: choose what writes your changes (Claude Code, Codex, an API
// key) by looking at what's installed, check that it answers, and save it to
// ~/.morse/config.json (provider, keys: the shape daemon/models.js reads).
// Also the three-line getting started that a bare `morse` prints while
// nothing is set up.
//
// daemon/cli.js reaches this through one line: maybeRun(cmd, args).
// Detection takes its probes as arguments so tests can fake the machine.
//
//   morse setup                          interactive
//   morse setup --use claude-code|codex|api-key|demo [--key <key>]
//   morse setup --pair <code>            first run from Chrome: the welcome page
//                                        shows this command with its own code;
//                                        setup then starts the Morse helper with
//                                        that code waiting, and the page pairs
//                                        by itself (nothing to type back)

import { spawn } from "node:child_process";
import { promises as fs, constants as FS } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { loadConfig, saveConfig, HOME, savePrefs as savePrefsFile } from "./store.js";
import { resolveTiers } from "../core/route.js"; // models: fast and strong
import { defaultHotkeys, formatCombo, detectPlatform } from "../core/hotkeys.js";
import { t } from "../core/i18n.js"; // daemon/cli.js sets the language from LANG / LC_ALL
import { paint } from "./colors.js";
import { commandFor } from "./platform.js";

const { g: G, d: D, b: B, r: R } = paint;
const LOGO = `${G("▪▪▫")}\n${G("▫▪▪")} ${B("morse")} ${D("· setup")}\n${G("▪▫▪")}`;
// fileURLToPath, not URL.pathname: that gives /C:/… on Windows and %20 for spaces.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXTENSION_DIR = path.join(ROOT, "dist", "extension");
const tilde = p => (process.env.HOME && p.startsWith(process.env.HOME) ? "~" + p.slice(process.env.HOME.length) : p);
// The extension folder as the user can type it: relative inside the repo, else from ~.
const extDir = () => (path.relative(process.cwd(), EXTENSION_DIR).startsWith("..") ? tilde(EXTENSION_DIR) : path.relative(process.cwd(), EXTENSION_DIR));

// What each choice is, how to get it, and what it writes to config.json's
// "model". The provider ids are core/providers.js's; keep them in step.
export const BACKENDS = [
  { id: "claude-code", name: "Claude Code", bin: "claude", get why() { return t("setup.why.claude"); }, install: "npm install -g @anthropic-ai/claude-code" },
  { id: "codex", name: "Codex", bin: "codex", get why() { return t("setup.why.codex"); }, install: "npm install -g @openai/codex" },
  { id: "api-key", get name() { return t("setup.name.key"); }, get why() { return t("setup.why.key"); }, get install() { return t("setup.install.key"); } },
];
const KEY_ENVS = [["ANTHROPIC_API_KEY", "anthropic"], ["OPENAI_API_KEY", "openai"]];

// What a choice writes into config.json: { provider, keys? }. A key from the
// environment is never written; daemon/models.js reads the environment itself.
export function configFor(id, { key = "", vendor = "" } = {}) {
  switch (id) {
    case "claude-code": return { provider: "claude-code" };
    case "codex": return { provider: "codex" };
    case "demo": return { provider: "demo" };
    case "api-key": {
      const v = vendor || keyVendor(key);
      return { provider: v, ...(key ? { keys: { [v]: key } } : {}) };
    }
  }
  throw new Error(t("setup.unknown", { id, list: `${BACKENDS.map(b => b.id).join(", ")}, demo` }));
}
export const keyVendor = key => (/^sk-ant-/.test(String(key)) ? "anthropic" : "openai");

// Writes a choice into config.json the way daemon/models.js reads it:
// "provider", plus the key under "keys" when one was pasted. A key from the
// environment is never written; models.js reads the environment itself.
// Takes either shape of a choice: { provider, keys } (configFor) or
// { provider, apiKey, baseUrl }. The record an older `morse setup` wrote
// ("model": { provider, apiKey }), which nothing read, is dropped, and its key
// carried over when there is no other.
export function applyChoice(cfg, choice) {
  const next = { ...cfg, provider: choice.provider };
  const old = cfg.model && typeof cfg.model === "object" ? cfg.model : null;
  delete next.model; // pre-0.2 shape, and what early `morse setup` wrote
  const keys = { ...(choice.keys || {}) };
  if (choice.apiKey) keys[choice.provider] = choice.apiKey;
  if (old?.apiKey && (old.provider === "anthropic" || old.provider === "openai") && !cfg.keys?.[old.provider] && !keys[old.provider]) keys[old.provider] = old.apiKey;
  if (Object.keys(keys).length) next.keys = { ...cfg.keys, ...keys };
  const baseUrl = choice.baseUrls?.openai || (choice.provider === "openai" ? choice.baseUrl : "");
  if (baseUrl && baseUrl !== "https://api.openai.com" && !cfg.baseUrls?.openai) next.baseUrls = { ...cfg.baseUrls, openai: baseUrl };
  return next;
}

// Something is set up once config.json names a provider (morse setup or morse config).
export const isSetUp = cfg => !!(cfg && ((cfg.provider && cfg.provider !== "auto") || (cfg.model?.provider && cfg.model.provider !== "auto")));

// ---- probes (real ones; tests pass fakes)
export async function whichBin(name, { env = process.env, platform = process.platform } = {}) {
  const exts = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext.toLowerCase());
      try { await fs.access(p, FS.X_OK); if ((await fs.stat(p)).isFile()) return p; } catch {}
    }
  }
  return "";
}
export function binVersion(file, ms = 4000) {
  return new Promise(resolve => {
    let out = "";
    let child;
    // Windows starts claude.cmd / codex.cmd only through cmd.exe, quoted (platform.js).
    try { const c = commandFor(file, ["--version"]); child = spawn(c.file, c.args, { stdio: ["ignore", "pipe", "pipe"], shell: c.shell, windowsHide: true }); } catch { return resolve(""); }
    const t = setTimeout(() => { child.kill(); resolve(""); }, ms);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (out += d));
    child.on("error", () => { clearTimeout(t); resolve(""); });
    child.on("close", () => { clearTimeout(t); resolve((String(out).match(/\d+\.\d+(\.\d+)?/) || [""])[0]); });
  });
}

// What's on this machine: one row per BACKENDS entry.
//   { id, name, found, detail, version?, path?, keyEnv?, vendor?, models? }
export async function detectBackends({ env = process.env, which = name => whichBin(name, { env }), version = binVersion } = {}) {
  const rows = [];
  for (const b of BACKENDS) {
    const row = { id: b.id, name: b.name, found: false, detail: "" };
    if (b.bin) {
      const p = await which(b.bin);
      if (p) Object.assign(row, { found: true, path: p, version: await version(p) });
    }
    if (b.id === "api-key") {
      const hit = KEY_ENVS.find(([k]) => env[k]);
      if (hit) Object.assign(row, { found: true, keyEnv: hit[0], vendor: hit[1] });
    }
    row.detail = describe(row, b);
    rows.push(row);
  }
  return rows;
}
function describe(row, b) {
  if (row.id === "api-key") return row.found ? t("setup.keySet", { env: row.keyEnv }) : t("setup.noKeyEnv");
  return row.found ? [row.version, row.path && tilde(row.path)].filter(Boolean).join("  ") : t("setup.notInstalled");
}

// First found, in BACKENDS order.
export function recommend(rows) {
  return rows.find(r => r.found) || null;
}

export function gettingStarted({ platform = detectPlatform({ platform: process.platform }) } = {}) {
  const key = formatCombo(defaultHotkeys(platform).open, platform);
  return [
    `${G("▦")} ${t("setup.start1", { cmd: B("morse setup") })}`,
    `${G("▦")} ${t("setup.start2", { dir: B(extDir()), cmd: B("morse launch spotify") })}`,
    `${G("▦")} ${t("setup.start3", { key: B(key) })} ${D(t("setup.start3.help"))}`,
  ].join("\n");
}

// `pairing`: Chrome is being connected right now (connectBrowser says so).
function nextSteps(platform, { pairing = false } = {}) {
  const key = formatCombo(defaultHotkeys(platform).open, platform);
  const label = id => D(t(id).padEnd(8));
  return `  ${B(t("setup.next"))}
${pairing ? "" : `    ${label("setup.next.websites")}  ${t("setup.next.load", { dir: extDir(), how: D(t("setup.next.how")) })}\n`}    ${label("setup.next.apps")}  morse launch spotify ${D(t("setup.next.or"))}${pairing ? D(t("setup.next.another")) : ""}
    ${label("setup.next.then")}  ${t("setup.next.press", { key: B(key) })}`;
}

// What to do when the model didn't answer the check, per choice.
function fixFor(choice, vendor) {
  if (choice === "claude-code") return t("setup.fix.signIn", { cmd: B("claude"), setup: B("morse setup") });
  if (choice === "codex") return t("setup.fix.signIn", { cmd: B("codex"), setup: B("morse setup") });
  if (choice === "api-key") return t("setup.fix.key", { site: vendor === "anthropic" ? "console.anthropic.com" : "platform.openai.com", setup: B("morse setup") });
  return t("setup.fix.doctor", { cmd: B("morse doctor") });
}

export const SETUP_HELP = `morse setup: choose what writes your changes.

  morse setup                      asks which to use, and finds what is installed
  morse setup --use claude-code    use Claude Code (your Claude subscription)
  morse setup --use codex          use Codex (your ChatGPT plan)
  morse setup --use api-key        use ANTHROPIC_API_KEY or OPENAI_API_KEY from your environment
  morse setup --use api-key --key <key>
                                   use this Anthropic or OpenAI key (saved in ${tilde(HOME)}/config.json)
  morse setup --pair <code>        also connect Chrome: the code comes from Morse's welcome page
  morse setup --model-mode auto|fast|best
                                   Automatic (recommended): the fast model for small tweaks, the best
                                   one for new features and restyles. Or always one of them
  morse setup --fast-model <name> --best-model <name>
                                   the two models (Claude Code: sonnet and opus)

Setup checks that the model answers. Run it again any time to switch; morse doctor checks again.`;

// ---- the interactive walk-through
// `check(cfg)`: does the chosen model answer? Resolves { ok, ms } or
// { ok: false, error } (plain words). Left out, nothing is checked (tests).
export async function runSetup(args = [], { input = process.stdin, output = process.stdout, deps = {}, save = saveConfig, load = loadConfig, savePrefs = savePrefsFile, check = null, platform = detectPlatform({ platform: process.platform }) } = {}) {
  const say = s => output.write(s + "\n");
  const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined; };
  const isTTY = !!input.isTTY;
  say(LOGO + "\n");
  say(`  ${t("setup.looking")}\n`);
  const rows = await detectBackends(deps);
  for (const r of rows) say(`  ${r.found ? G("✓") : D("✗")} ${r.name.padEnd(12)} ${r.found ? r.detail : D(r.detail)}`);
  say("");
  const best = recommend(rows);

  let choice = flag("use");
  const lines = lineReader(input, output);
  if (!choice) {
    say(`  ${t("setup.which")}`);
    BACKENDS.forEach((b, i) => {
      const r = rows[i];
      const note = r.found ? b.why : b.id === "api-key" ? t("setup.pasteKey") : t("setup.notInstalledHow", { how: b.short || b.install });
      say(`    ${B(String(i + 1))}  ${b.name.padEnd(12)} ${D(note)}${best?.id === b.id ? `  ${G(t("setup.recommended"))}` : ""}`);
    });
    const def = best ? BACKENDS.findIndex(b => b.id === best.id) + 1 : 3;
    const answer = await lines.ask(`  ${t("setup.choose", { n: BACKENDS.length, def })} `);
    if (answer === null) {
      lines.close();
      say(`\n  ${t("setup.nothing", { cmd: B("morse setup --use " + (best?.id || "api-key")) })}`);
      return { saved: false, rows };
    }
    const n = Number(answer.trim() || def);
    choice = BACKENDS[n - 1]?.id || BACKENDS.find(b => b.id === answer.trim())?.id;
    if (!choice) { lines.close(); say(R(`  ${t("setup.badChoice", { answer: answer.trim() })}`)); return { saved: false, rows }; }
  }

  const row = rows.find(r => r.id === choice);
  const backend = BACKENDS.find(b => b.id === choice);
  let model;
  try {
    if (choice === "api-key") {
      let key = typeof flag("key") === "string" ? flag("key") : "";
      if (!key && !row?.found) key = (await lines.ask(`  ${t("setup.pasteKeyAsk", { path: `${tilde(HOME)}/config.json` })} `, { secret: isTTY })) || "";
      key = key.trim();
      if (!key && !row?.found) { lines.close(); say(R(`\n  ${t("setup.noKey")}`)); return { saved: false, rows }; }
      model = key ? configFor("api-key", { key }) : configFor("api-key", { vendor: row.vendor });
    } else model = configFor(choice);
  } catch (e) { lines.close(); say(R(`  ${e.message}`)); return { saved: false, rows }; }
  // models: Automatic / Always fast / Always best, and the two names (core/route.js)
  const tiers = resolveTiers(model.provider, { fast: str(flag("fast-model")), best: str(flag("best-model")) });
  let mode = MODES[String(flag("model-mode") || "").toLowerCase()] || "";
  if (!mode && tiers && isTTY && !flag("use")) {
    const names = { fast: tierName(tiers.fast), best: tierName(tiers.best) };
    say(`\n  ${t("setup.model.which")}`);
    say(`    ${B("1")}  ${t("settings.model.auto").padEnd(12)}  ${D(t("setup.model.autoWhy", names))}  ${G(t("setup.recommended"))}`);
    say(`    ${B("2")}  ${t("settings.model.fast").padEnd(12)}  ${D(t("setup.model.fastWhy", names))}`);
    say(`    ${B("3")}  ${t("settings.model.best").padEnd(12)}  ${D(t("setup.model.bestWhy", names))}`);
    mode = ["auto", "fast", "best"][Number((await lines.ask(`  ${t("setup.model.choose")} `) || "1").trim()) - 1] || "auto";
  }
  lines.close();

  if (backend && row && !row.found && choice !== "api-key") {
    say(`\n  ${t("setup.notYet", { name: backend.name, cmd: B(backend.install), setup: B("morse setup") })}`);
    return { saved: false, rows };
  }
  const cfg = applyChoice(await load(), model);
  cfg.setup = { backend: choice, at: new Date().toISOString() };
  for (const k of ["fast", "best"]) { // models: names given with --fast-model / --best-model
    const v = str(flag(`${k}-model`));
    if (v) cfg.tiers = { ...cfg.tiers, [model.provider]: { ...cfg.tiers?.[model.provider], [k]: v } };
  }
  await save(cfg);
  if (mode) await savePrefs({ modelMode: mode });
  const label = backend?.name || t("setup.demo");
  const fromEnv = choice === "api-key" && !model.keys ? row?.keyEnv : "";
  say(`\n  ${G("✓")} ${t("setup.willUse", { label: B(label), env: fromEnv ? t("setup.fromEnv", { env: fromEnv }) : "" })} ${D(t("setup.savedIn", { path: `${tilde(HOME)}/config.json` }))}`);
  if (tiers) say(`  ${D(mode === "fast" || mode === "best" ? t("setup.model.always", { model: tierName(tiers[mode]) }) : t("setup.model.now", { fast: tierName(tiers.fast), best: tierName(tiers.best) }))} ${D(t("setup.model.change"))}`);
  let checked = null;
  if (check) {
    output.write(`  ${D(t("setup.checking", { label }))}`);
    checked = await check(cfg).catch(e => ({ ok: false, error: e.message || String(e) }));
    output.write(output.isTTY ? "\r\x1b[2K" : "\n");
    if (checked.ok) say(`  ${G("✓")} ${t("setup.answered", { label, secs: (checked.ms / 1000).toFixed(1) })}`);
    else say(`  ${R("✗")} ${t("setup.noAnswer", { label, error: checked.error })}\n    ${fixFor(choice, model.provider)}`);
  }
  say("");
  if (!flag("pair")) say(nextSteps(platform)); // with --pair, connectBrowser says what's next
  return { saved: true, rows, choice, model, checked, next: () => nextSteps(platform, { pairing: true }) };
}

// models
const MODES = { auto: "auto", automatic: "auto", fast: "fast", best: "best" };
const str = v => (typeof v === "string" ? v.trim() : "");
const tierName = t => [t.model, t.effort && `${t.effort} effort`].filter(Boolean).join(", ") || "its usual model";

// Questions over readline. Piped answers are echoed so a log reads like the
// session did; a secret isn't echoed at all.
function lineReader(input, output) {
  let rl = null, buffered = [], ended = false, waiting = null;
  const start = () => {
    if (rl) return;
    rl = readline.createInterface({ input, output, terminal: !!input.isTTY });
    rl.on("line", l => (waiting ? (waiting(l), (waiting = null)) : buffered.push(l)));
    rl.on("close", () => { ended = true; if (waiting) { waiting(null); waiting = null; } });
  };
  return {
    ask(q, { secret = false } = {}) {
      start();
      output.write(q);
      if (secret && rl.output) rl._writeToOutput = () => {};
      return new Promise(resolve => {
        const done = l => {
          if (secret) { rl._writeToOutput = s => rl.output.write(s); output.write("\n"); }
          else if (!input.isTTY && l !== null) output.write(l + "\n");
          resolve(l);
        };
        if (buffered.length) done(buffered.shift());
        else if (ended) done(null);
        else waiting = done;
      });
    },
    close() { rl?.close(); },
  };
}

// The real model check: one short request, like `morse doctor`.
async function checkModel(cfg) {
  const [{ settingsFromConfig }, { streamChat }, { plainError }] = await Promise.all([import("./models.js"), import("../core/providers.js"), import("../core/onboarding.js")]);
  const s = settingsFromConfig(cfg);
  if (s.provider === "none") return { ok: false, error: t("setup.noModelSet") };
  const t0 = Date.now();
  try {
    await streamChat({ ...s, timeoutMs: 90_000 }, [
      { role: "system", content: "You are a connectivity check. Reply with exactly: OK" },
      { role: "user", content: "ping" },
    ], { maxTokens: 200, signal: AbortSignal.timeout(90_000) });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, error: plainError(e) }; }
}

// First run from Chrome (`morse setup --pair <code>`): the Morse helper starts
// here with the welcome page's code waiting, so the page pairs by itself. A
// helper that's already running just gets the code.
export async function connectBrowser(code, { say = s => console.log(s) } = {}) {
  const { createBridge, startPairing, helperPort } = await import("./bridge.js");
  const HELPER_PORT = helperPort();
  const up = await fetch(`http://127.0.0.1:${HELPER_PORT}/v1/health`, { signal: AbortSignal.timeout(800) }).then(r => r.ok, () => false);
  if (up) {
    await startPairing(undefined, code);
    say(`  ${G("✓")} ${t("setup.helperUp")}`);
    return null;
  }
  const bridge = createBridge({ port: HELPER_PORT, log: console.log });
  try { await bridge.listen(); }
  catch (e) { throw new Error(e.code === "EADDRINUSE" ? t("setup.portBusy", { port: HELPER_PORT }) : e.message); }
  await startPairing(undefined, code);
  say(`  ${G("✓")} ${t("setup.helperStarted")}`);
  say(D(`    ${t("setup.leaveOpen")}`));
  const stop = async () => { await bridge.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return bridge;
}

// The one entry point daemon/cli.js calls. Returns true when it handled the command.
export async function maybeRun(cmd, args = []) {
  if (cmd === "setup" && args.some(a => a === "--help" || a === "-h" || a === "help")) { console.log(SETUP_HELP); return true; }
  if (cmd === "setup") {
    const i = args.indexOf("--pair");
    const code = i >= 0 ? String(args[i + 1] || "").trim().toUpperCase() : "";
    const { validPairingCode } = await import("./bridge.js");
    if (i >= 0 && !validPairingCode(code)) throw new Error(t("setup.badCode"));
    const res = await runSetup(args, { check: process.env.MORSE_SETUP_CHECK === "0" ? null : checkModel });
    if (res.saved && code) { await connectBrowser(code); console.log("\n" + res.next()); }
    return true;
  }
  if (!cmd && !isSetUp(await loadConfig())) {
    console.log(gettingStarted());
    return true;
  }
  return false;
}
