// `morse setup`: choose what writes your changes (Claude Code, Codex, an API
// key) by looking at what's installed, and save
// it to ~/.morse/config.json. Also the three-line getting started that a bare
// `morse` prints while nothing is set up.
//
// daemon/cli.js reaches this through one line: maybeRun(cmd, args).
// Detection takes its probes as arguments so tests can fake the machine.
//
//   morse setup                          interactive
//   morse setup --use claude-code|codex|api-key|demo [--key <key>]

import { spawn } from "node:child_process";
import { promises as fs, constants as FS } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { loadConfig, saveConfig, HOME } from "./store.js";
import { defaultHotkeys, formatCombo, detectPlatform } from "../core/hotkeys.js";

const G = s => `\x1b[32m${s}\x1b[0m`, D = s => `\x1b[2m${s}\x1b[0m`, B = s => `\x1b[1m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`;
const LOGO = `${G("▪▪▫")}\n${G("▫▪▪")} ${B("morse")} ${D("· setup")}\n${G("▪▫▪")}`;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXTENSION_DIR = path.join(ROOT, "dist", "extension");
const tilde = p => (process.env.HOME && p.startsWith(process.env.HOME) ? "~" + p.slice(process.env.HOME.length) : p);
// The extension folder as the user can type it: relative inside the repo, else from ~.
const extDir = () => (path.relative(process.cwd(), EXTENSION_DIR).startsWith("..") ? tilde(EXTENSION_DIR) : path.relative(process.cwd(), EXTENSION_DIR));

// What each choice is, how to get it, and what it writes to config.json's
// "model". The provider ids are core/providers.js's; keep them in step.
export const BACKENDS = [
  { id: "claude-code", name: "Claude Code", bin: "claude", why: "uses your Claude subscription", install: "npm install -g @anthropic-ai/claude-code" },
  { id: "codex", name: "Codex", bin: "codex", why: "uses your ChatGPT plan", install: "npm install -g @openai/codex" },
  { id: "api-key", name: "API key", why: "Anthropic or OpenAI, paid per use", install: "create one at console.anthropic.com or platform.openai.com" },
];
const KEY_ENVS = [["ANTHROPIC_API_KEY", "anthropic"], ["OPENAI_API_KEY", "openai"]];

export function configFor(id, { key = "", keyEnv = "", vendor = "" } = {}) {
  switch (id) {
    case "claude-code": return { provider: "claude-code" };
    case "codex": return { provider: "codex" };
    case "demo": return { provider: "demo" };
    case "api-key": {
      const v = vendor || keyVendor(key);
      const m = v === "anthropic" ? { provider: "anthropic" } : { provider: "openai", baseUrl: "https://api.openai.com" };
      return { ...m, ...(key ? { apiKey: key } : { apiKeyEnv: keyEnv }) };
    }
  }
  throw new Error(`Unknown choice “${id}”. Use one of: ${BACKENDS.map(b => b.id).join(", ")}, demo`);
}
export const keyVendor = key => (/^sk-ant-/.test(String(key)) ? "anthropic" : "openai");

// Something is set up once config.json names a provider (morse setup or morse model).
export const isSetUp = cfg => !!(cfg && cfg.model && cfg.model.provider && cfg.model.provider !== "auto");

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
    try { child = spawn(file, ["--version"], { stdio: ["ignore", "pipe", "pipe"] }); } catch { return resolve(""); }
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
  if (row.id === "api-key") return row.found ? `${row.keyEnv} is set` : "none in ANTHROPIC_API_KEY or OPENAI_API_KEY";
  return row.found ? [row.version, row.path && tilde(row.path)].filter(Boolean).join("  ") : "not installed";
}

// First found, in BACKENDS order.
export function recommend(rows) {
  return rows.find(r => r.found) || null;
}

export function gettingStarted({ platform = detectPlatform({ platform: process.platform }) } = {}) {
  const key = formatCombo(defaultHotkeys(platform).open, platform);
  return [
    `${G("▦")} Welcome to Morse. First, run ${B("morse setup")} to choose what writes your changes: Claude Code, Codex or an API key.`,
    `${G("▦")} Then, for websites, load ${B(extDir())} in chrome://extensions (Developer mode, Load unpacked). For apps: ${B("morse launch spotify")}.`,
    `${G("▦")} Press ${B(key)} on any page, point at something and say what to change. ${D("morse help lists every command.")}`,
  ].join("\n");
}

function nextSteps(platform) {
  const key = formatCombo(defaultHotkeys(platform).open, platform);
  return `  ${B("Next")}
    ${D("websites")}  load ${extDir()} in chrome://extensions ${D("(Developer mode, Load unpacked)")}
    ${D("apps    ")}  morse launch spotify ${D("(or slack, discord, vscode, notion, obsidian)")}
    ${D("then    ")}  press ${B(key)}, point at something, say what to change`;
}

// ---- the interactive walk-through
export async function runSetup(args = [], { input = process.stdin, output = process.stdout, deps = {}, save = saveConfig, load = loadConfig, platform = detectPlatform({ platform: process.platform }) } = {}) {
  const say = s => output.write(s + "\n");
  const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined; };
  const isTTY = !!input.isTTY;
  say(LOGO + "\n");
  say(`  Looking for something that can write your changes…\n`);
  const rows = await detectBackends(deps);
  for (const r of rows) say(`  ${r.found ? G("✓") : D("✗")} ${r.name.padEnd(12)} ${r.found ? r.detail : D(r.detail)}`);
  say("");
  const best = recommend(rows);

  let choice = flag("use");
  const lines = lineReader(input, output);
  if (!choice) {
    say(`  Which should Morse use?`);
    BACKENDS.forEach((b, i) => {
      const r = rows[i];
      const note = r.found ? b.why : b.id === "api-key" ? "paste an Anthropic or OpenAI key" : `not installed: ${b.short || b.install}`;
      say(`    ${B(String(i + 1))}  ${b.name.padEnd(12)} ${D(note)}${best?.id === b.id ? `  ${G("recommended")}` : ""}`);
    });
    const def = best ? BACKENDS.findIndex(b => b.id === best.id) + 1 : 3;
    const answer = await lines.ask(`  Choose 1-${BACKENDS.length} [${def}]: `);
    if (answer === null) {
      lines.close();
      say(`\n  Nothing chosen. Run ${B("morse setup --use " + (best?.id || "api-key"))} to pick without questions.`);
      return { saved: false, rows };
    }
    const n = Number(answer.trim() || def);
    choice = BACKENDS[n - 1]?.id || BACKENDS.find(b => b.id === answer.trim())?.id;
    if (!choice) { lines.close(); say(R(`  “${answer.trim()}” isn't one of the choices. Run morse setup again.`)); return { saved: false, rows }; }
  }

  const row = rows.find(r => r.id === choice);
  const backend = BACKENDS.find(b => b.id === choice);
  let model;
  try {
    if (choice === "api-key") {
      let key = typeof flag("key") === "string" ? flag("key") : "";
      if (!key && !row?.found) key = (await lines.ask(`  Paste your API key (it stays in ${tilde(HOME)}/config.json): `, { secret: isTTY })) || "";
      key = key.trim();
      if (!key && !row?.found) { lines.close(); say(R(`\n  No key given, nothing changed.`)); return { saved: false, rows }; }
      model = key ? configFor("api-key", { key }) : configFor("api-key", { keyEnv: row.keyEnv, vendor: row.vendor });
    } else model = configFor(choice);
  } catch (e) { lines.close(); say(R(`  ${e.message}`)); return { saved: false, rows }; }
  lines.close();

  if (backend && row && !row.found && choice !== "api-key") {
    say(`\n  ${backend.name} isn't installed yet. Install it with ${B(backend.install)}, then run ${B("morse setup")} again.`);
    return { saved: false, rows };
  }
  const cfg = await load();
  cfg.model = model;
  cfg.setup = { backend: choice, at: new Date().toISOString() };
  await save(cfg);
  const label = backend?.name || "the demo model";
  say(`\n  ${G("✓")} Morse will use ${B(label)}${model.apiKeyEnv ? ` with ${model.apiKeyEnv} from your environment` : ""}. ${D(`Saved in ${tilde(HOME)}/config.json`)}\n`);
  say(nextSteps(platform));
  return { saved: true, rows, choice, model };
}

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

// The one entry point daemon/cli.js calls. Returns true when it handled the command.
export async function maybeRun(cmd, args = []) {
  if (cmd === "setup") { await runSetup(args); return true; }
  if (!cmd && !isSetUp(await loadConfig())) {
    console.log(gettingStarted());
    return true;
  }
  return false;
}
