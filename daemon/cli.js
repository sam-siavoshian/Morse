#!/usr/bin/env node
// morse: change any app in your own words.

import { execFile } from "node:child_process";
import { resolveApp } from "./apps.js";
import { inspectFuses, formatFuses } from "./fuses.js";
import { appsCommand, launchCommand, attachCommand, statusCommand, stopCommand } from "./desktop.js";
import { listMods, deleteMod, saveMod, loadConfig, updateConfig, writeExport, CONFIG_PATH } from "./store.js";
import { currentSettings, settingsFromConfig, settingsLabel, keysFrom, assertProvider, mask, migrateLegacy } from "./models.js";
import { detectHarnesses, validModel } from "./harness.js";
import { createBridge, startPairing, VERSION } from "./bridge.js";
import { streamChat, HELPER_PORT as DEFAULT_HELPER_PORT } from "../core/providers.js";
// MORSE_HELPER_PORT moves `morse serve` and its health check off 7457 (tests run
// several helpers at once); the extension always talks to 7457.
const HELPER_PORT = Number(process.env.MORSE_HELPER_PORT) || DEFAULT_HELPER_PORT;
import { toUserscript, decodeShare, encodeShare } from "../core/mod.js";
import { plainError } from "../core/onboarding.js";
import { pauseCli, resumeCli, exportAllCli, importCli, codeCli } from "./control.js"; // user control
import { configuredHotkeys } from "./store.js";

// The hotkeys as set in ~/.morse/settings.json (platform defaults otherwise).
const KEYS = await configuredHotkeys().catch(() => ({}));
const openKey = KEYS.open || "the Open Morse shortcut";

const W = s => `\x1b[97m${s}\x1b[0m`, D = s => `\x1b[2m${s}\x1b[0m`, B = s => `\x1b[1m${s}\x1b[0m`;
const WARN = s => `\x1b[33m${s}\x1b[0m`, ERR = s => `\x1b[31m${s}\x1b[0m`;
const LOGO = `${W("▪▪▫")}\n${W("▫▪▪")} ${B("morse")} ${D("· change any app in your own words")}\n${W("▪▫▪")}`;

function flags(argv) {
  const out = { _: [], rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out.rest = argv.slice(i + 1); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const v = eq < 0 ? undefined : a.slice(eq + 1);
      out[k] = v ?? (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true);
    } else out._.push(a);
  }
  return out;
}

async function settingsFrom(f) {
  if (f.provider) assertProvider(f.provider);
  const s = await currentSettings({ ...(f.provider && { provider: f.provider }), ...(f.model && { model: f.model }) });
  if (s.provider === "none") console.log(`${WARN("!")} No model is connected. Run ${B("morse setup")} to choose one.`);
  return s;
}

const MODEL_FLAGS = ["provider", "model", "anthropic-key", "openai-key", "base-url"];

async function configure(f) {
  if (f.provider && f.provider !== "auto") assertProvider(f.provider);
  if (typeof f.model === "string" && !validModel(f.model)) throw new Error(`"${f.model}" isn't a model name Morse can use. Check the spelling.`);
  await updateConfig(cfg => {
    migrateLegacy(cfg); // first-run hook: keep what an older morse setup chose
    if (f.provider === "auto") delete cfg.provider;
    else if (typeof f.provider === "string") cfg.provider = f.provider;
    for (const [flag, k] of [["anthropic-key", "anthropic"], ["openai-key", "openai"]]) {
      if (typeof f[flag] !== "string") continue;
      cfg.keys = { ...cfg.keys };
      if (f[flag]) cfg.keys[k] = f[flag]; else delete cfg.keys[k];
    }
    const target = settingsFromConfig(cfg).provider;
    if (typeof f.model === "string") {
      cfg.models = { ...cfg.models };
      if (f.model) cfg.models[target] = f.model; else delete cfg.models[target];
    }
    if (typeof f["base-url"] === "string") {
      const p = target === "anthropic" ? "anthropic" : "openai";
      cfg.baseUrls = { ...cfg.baseUrls };
      if (f["base-url"]) cfg.baseUrls[p] = f["base-url"]; else delete cfg.baseUrls[p];
    }
    delete cfg.model; // pre-0.2 shape (local-model era)
    return cfg;
  });
}

async function showModel() {
  const cfg = await loadConfig();
  const s = settingsFromConfig(cfg);
  const keys = keysFrom(cfg);
  console.log(`${B(settingsLabel(s))}${s.detected && s.provider !== "none" ? D("  (auto-detected)") : ""}`);
  console.log(D(`provider ${s.provider}${s.model ? ` · model ${s.model}` : ""}${s.baseUrl ? ` · ${s.baseUrl}` : ""}`));
  console.log(D(`keys     anthropic ${keys.anthropic ? "set" : "-"} · openai ${keys.openai ? "set" : "-"}`));
  console.log(D(`config   ${CONFIG_PATH}`));
}

function version(bin) {
  return new Promise(r => execFile(bin, ["--version"], { timeout: 8000, windowsHide: true, shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(bin) },
    (e, out) => r(e ? "" : String(out).trim().split("\n")[0])));
}

async function helperHealth() {
  try { return await (await fetch(`http://127.0.0.1:${HELPER_PORT}/v1/health`, { signal: AbortSignal.timeout(800) })).json(); } catch { return null; }
}

const HELP = `${LOGO}

${B("Desktop apps")} (Spotify, Slack, Discord, VS Code and other apps built on Electron)
  morse apps                list the apps Morse found and whether it can connect to them
  morse launch <app|path>   reopen an app with Morse connected (partial names work: code, spot)
      --restart             quit the app first if it's open (remembered per app; --no-restart forgets)
      --watch               keep waiting when the app quits, connect again when it's back
      --name <name>         name mods are filed under (defaults to the app)
      --port <n>            debugging port (default: a free one from 9333)
      -- <args>             extra arguments for the app
  morse attach --port <n>   connect to an app already started with --remote-debugging-port
  morse status              apps Morse is connected to, their windows and mods
  morse stop <app>          disconnect from an app (it keeps running)
  morse fuses <app|path>    check whether an app lets Morse connect to it

${B("Websites")} (the Chrome extension uses the Morse helper to reach your model)
  morse extension           show the Chrome extension folder and how to add it
  morse serve               start the Morse helper and show a pairing code
  morse pair                show a new pairing code for the running helper
  morse unpair              sign out every paired browser

${B("Model")} (bring your own: Claude Code, Codex, or an API key)
  morse setup               choose Claude Code, Codex or an API key (finds what is installed)
  morse model               show which model Morse uses
  morse config --provider claude-code|codex|anthropic|openai|auto
      --model <name>        for example opus · sonnet · haiku · claude-opus-5-5 · gpt-5
      --anthropic-key <key> --openai-key <key> --base-url <url>   (leave empty to remove)
  morse doctor              show what's installed and check that the model answers

${B("Mods")}
  morse mods                list your mods
  morse rm <id>             delete a mod
  morse export <id>         save a mod file, a Tampermonkey file and a share link
  morse install <link|file> install from a share link, a mod file or a backup
                            (says what each mod does and asks first; --yes to skip asking)
  morse code <id>           what a mod does, in plain words, and its code
  morse export --all        back up every mod to one file  [--out <file>]

${B("Pause")}
  morse pause [site|app]    stop every mod everywhere, or on one site or app (they stay saved)
  morse resume [site|app]   start them again  [--all also resumes every single site]

In a connected app, press ${B(openKey)} to open Morse.${KEYS.mods ? ` Press ${B(KEYS.mods)} to see your mods.` : ""}${KEYS.off ? `
Press ${B(KEYS.off)} to turn all your mods off (press it again to turn them back on).` : ""}
For websites: run ${B("morse extension")} to find the Chrome extension, then ${B("morse serve")} and type its code into the Morse popup.
morse --version shows the version.`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  if (["--version", "-v", "version"].includes(cmd)) return console.log(VERSION);
  if (["--help", "-h", "help"].includes(cmd)) return console.log(HELP);
  if (await (await import("./setup.js")).maybeRun(cmd, rest)) return; // onboarding hook: morse setup, and getting started while nothing is set up
  switch (cmd) {
    case "apps":
      return appsCommand(f);
    case "launch":
      return launchCommand(f, { settingsFrom, logo: LOGO });
    case "attach":
      return attachCommand(f, { settingsFrom, logo: LOGO });
    case "status":
      return statusCommand(f);
    case "stop":
      return stopCommand(f);
    case "fuses": {
      const app = resolveApp(f._.join(" "));
      const info = await inspectFuses(app.path);
      if (f.json) return console.log(JSON.stringify(info, null, 2));
      // A native app has no fuses, and Morse can't connect to it anyway: say that.
      if (app.canAttach === false) return console.log(`${app.name}  ${app.path}\n  Morse can't connect: it's a ${app.why}.`);
      console.log(formatFuses(info, app.name));
      break;
    }
    case "mods": {
      const mods = await listMods();
      if (!mods.length) return console.log(D(`No mods yet. Open an app with morse launch <app>, then press ${openKey} in it.`));
      for (const m of mods) {
        const where = m.match.app || m.match.hosts.join(",");
        console.log(`${m.enabled ? W("●") : D("○")} ${B(m.title)} ${D(m.id)}  ${where}\n    ${D("“" + m.prompt + "”")}`);
      }
      break;
    }
    case "rm":
      await deleteMod(f._[0]);
      console.log(`Deleted ${f._[0]}.`);
      break;
    case "export": {
      if (f.all) return exportAllCli(f); // user control: back up everything
      const mod = (await listMods()).find(m => m.id === f._[0]);
      if (!mod) throw new Error(`There's no mod called ${f._[0]}. Run morse mods to see your mods.`);
      const slug = mod.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      console.log(await writeExport(`${slug}.morse.json`, JSON.stringify(mod, null, 2)));
      console.log(await writeExport(`${slug}.user.js`, toUserscript(mod)));
      console.log(await encodeShare(mod));
      break;
    }
    case "install": // user control (control.js): says what it does, then asks
    case "import": await importCli(f); break;
    case "pause": await pauseCli(f); break;
    case "resume": await resumeCli(f); break;
    case "code": await codeCli(f); break;
    case "model":
    case "config": {
      if (f["api-key"] !== undefined) throw new Error("--api-key is gone. Use --anthropic-key or --openai-key instead.");
      if (MODEL_FLAGS.some(k => f[k] !== undefined)) await configure(f);
      await showModel();
      break;
    }
    case "extension": {
      const { EXTENSION_DIR } = await import("./setup.js");
      const { existsSync } = await import("node:fs");
      if (!existsSync(EXTENSION_DIR)) throw new Error(`The extension isn't built yet. Run npm run build in ${EXTENSION_DIR.replace(/[\\/]dist[\\/]extension$/, "")} first.`);
      console.log(EXTENSION_DIR);
      console.log(D(`In Chrome, open chrome://extensions, turn on Developer mode, click Load unpacked and choose this folder.\nThen run morse serve and type its code into Morse.`));
      break;
    }
    case "serve": {
      const port = Number(f.port || HELPER_PORT);
      const bridge = createBridge({ port, log: console.log });
      await bridge.listen().catch(e => {
        throw new Error(e.code === "EADDRINUSE" ? `Port ${port} is already in use, probably by a Morse helper that is already running. Run morse pair to get a new code for it.` : e.message);
      });
      const s = await currentSettings();
      const { code } = await startPairing(undefined, typeof f.pair === "string" ? f.pair.trim().toUpperCase() : ""); // first-run hook: --pair <code from the welcome page>
      console.log(LOGO + "\n");
      console.log(`  helper  http://127.0.0.1:${port}  ${D("v" + VERSION)}`);
      console.log(`  model   ${s.provider === "none" ? `${WARN("none")} ${D("(run morse setup to choose one)")}` : settingsLabel(s)}`);
      console.log(`  pair    ${B(code)}  ${D("type it into the Morse extension · works for 10 minutes · morse pair for a new one")}\n`);
      const stop = async () => { await bridge.close(); process.exit(0); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      break;
    }
    case "pair": {
      const { code } = await startPairing();
      console.log(`Pairing code ${B(code)} ${D("(works once, for 10 minutes)")}`);
      if (!(await helperHealth())) console.log(D(`The Morse helper isn't running. Start it with morse serve.`));
      break;
    }
    case "unpair": {
      let n = 0;
      await updateConfig(cfg => { n = cfg.bridge?.tokens?.length || 0; if (cfg.bridge) cfg.bridge.tokens = []; });
      console.log(`Signed out ${n} paired browser${n === 1 ? "" : "s"}.`);
      break;
    }
    case "doctor": {
      if (f.provider) assertProvider(f.provider);
      const cfg = await loadConfig();
      const h = detectHarnesses();
      const keys = keysFrom(cfg);
      const row = (k, v) => console.log(`  ${k.padEnd(9)} ${v}`);
      console.log(LOGO + "\n");
      row("node", process.version);
      row("config", CONFIG_PATH);
      for (const name of ["claude", "codex"]) {
        const p = h[name].path;
        row(name, p ? `${p} ${D(await version(p))}` : D("not found"));
      }
      row("keys", `anthropic ${keys.anthropic ? mask(keys.anthropic) : D("-")} · openai ${keys.openai ? mask(keys.openai) : D("-")}`);
      const health = await helperHealth();
      row("helper", health ? `running on 127.0.0.1:${HELPER_PORT} ${D(`v${health.version} · ${health.label}`)}` : D("not running (start it with morse serve)"));
      const s = settingsFromConfig(cfg, { ...(f.provider && { provider: f.provider }), ...(f.model && { model: f.model }) });
      row("model", s.provider === "none" ? WARN("none") : `${B(settingsLabel(s))}${s.detected ? D("  (auto-detected)") : ""}`);
      if (s.provider === "none") {
        console.log(`\n  No model is connected. Run morse setup to choose Claude Code, Codex or an API key.`);
        process.exitCode = 1;
        break;
      }
      const t0 = Date.now();
      try {
        const reply = await streamChat(s, [
          { role: "system", content: "You are a connectivity check. Reply with exactly: OK" },
          { role: "user", content: "ping" },
        ], { maxTokens: 200 });
        row("test", `${W("✓")} replied ${JSON.stringify(reply.trim().slice(0, 40))} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (e) {
        row("test", `${ERR("✗")} ${e.message}`);
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch(e => {
  const plain = plainError(e);
  console.error(`${ERR("✗")} ${plain}${plain !== e.message && e.message ? D(`  (${e.message})`) : ""}`);
  process.exit(1);
});
