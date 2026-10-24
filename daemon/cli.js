#!/usr/bin/env node
// morse: change any app in your own words.

import { execFile } from "node:child_process";
import { Connector } from "./connector.js";
import { resolveApp, launchApp, quitApp, KNOWN_APPS } from "./apps.js";
import { inspectFuses, fuseVerdict, electronBinaryFor } from "./fuses.js";
import { waitForEndpoint } from "./cdp.js";
import { listMods, deleteMod, saveMod, loadConfig, updateConfig, writeExport, CONFIG_PATH } from "./store.js";
import { currentSettings, settingsFromConfig, settingsLabel, keysFrom, assertProvider, mask } from "./models.js";
import { detectHarnesses, validModel } from "./harness.js";
import { createBridge, startPairing, VERSION } from "./bridge.js";
import { streamChat, HELPER_PORT } from "../core/providers.js";
import { toUserscript, decodeShare, encodeShare } from "../core/mod.js";

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
  if (s.provider === "none") console.log(`${WARN("!")} No model is connected. Run ${B("morse doctor")} to set one up.`);
  return s;
}

const MODEL_FLAGS = ["provider", "model", "anthropic-key", "openai-key", "base-url"];

async function configure(f) {
  if (f.provider && f.provider !== "auto") assertProvider(f.provider);
  if (typeof f.model === "string" && !validModel(f.model)) throw new Error(`"${f.model}" isn't a model name Morse can use. Check the spelling.`);
  await updateConfig(cfg => {
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

${B("Desktop apps")} (Electron / Chromium)
  morse launch <app|path>   open an app with Morse connected
                            apps: ${Object.keys(KNOWN_APPS).join(", ")}
      --restart             quit the app first if it's open
      --name <name>         name to save mods under (default: the app)
      --port <n>            debugging port (default 9333)
      -- <args>             pass extra arguments to the app
  morse attach --port <n>   connect to an app already started with --remote-debugging-port
  morse fuses <app|path>    check whether Morse can work with a desktop app

${B("Websites")} (the Chrome extension uses this helper to reach your model)
  morse serve               start the Morse helper and show a pairing code
  morse pair                show a new pairing code for the running helper
  morse unpair              sign out every paired browser

${B("Model")} (bring your own: Claude Code, Codex, or an API key)
  morse model               show which model Morse uses
  morse config --provider claude-code|codex|anthropic|openai|auto
      --model <name>        for example opus · sonnet · haiku · claude-opus-5-5 · gpt-5
      --anthropic-key <key> --openai-key <key> --base-url <url>   (leave empty to remove)
  morse doctor              show what's installed and check that the model answers

${B("Mods")}
  morse mods                list your mods
  morse rm <id>             delete a mod
  morse export <id>         save a mod file, a Tampermonkey file and a share link
  morse install <link|file> install a mod from a share link or file

In a connected app, press ${B("Alt+Space")} to open Morse and ${B("Alt+Shift+M")} to see your mods.
For websites: run npm run build, load dist/extension in Chrome, then run ${B("morse serve")} and type the code into Morse.`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  switch (cmd) {
    case "launch": {
      if (!f._[0]) throw new Error("Name an app to open, for example: morse launch spotify");
      const app = resolveApp(f._[0]);
      if (f.name) Object.assign(app, { id: String(f.name).toLowerCase(), name: f.name });
      const port = Number(f.port || 9333);
      const settings = await settingsFrom(f);
      console.log(LOGO + "\n");
      console.log(`  app     ${B(app.name)} ${D(app.path)}`);
      try {
        const info = await inspectFuses(await electronBinaryFor(app.path));
        if (info.electron) {
          console.log(`  fuses   ${Object.entries(info.fuses).filter(([k]) => /Inspect|Asar|RunAsNode/.test(k)).map(([k, v]) => `${k}=${v}`).join("  ")}`);
          for (const line of fuseVerdict(info)) console.log(D(`          ${line}`));
        }
      } catch {}
      console.log(`  model   ${settingsLabel(settings)}`);
      if (f.restart) { quitApp(app); await new Promise(r => setTimeout(r, 1500)); }
      launchApp(app, port, f.rest);
      await waitForEndpoint(port).catch(e => {
        throw new Error(`${e.message}\n  If ${app.name} was already open, quit it first or add --restart.`);
      });
      console.log(`  port    ${port}\n`);
      await new Connector({ port, app: app.browser ? null : app, settings }).run();
      break;
    }
    case "attach": {
      const port = Number(f.port || 9222);
      const settings = await settingsFrom(f);
      await waitForEndpoint(port, 3000);
      console.log(LOGO + `\n\n  connected on port ${port} · model ${settingsLabel(settings)}\n`);
      await new Connector({ port, app: f.app ? { id: f.app, name: f.app } : null, settings }).run();
      break;
    }
    case "fuses": {
      const app = resolveApp(f._[0]);
      const info = await inspectFuses(app.path);
      console.log(JSON.stringify(info, null, 2));
      for (const line of fuseVerdict(info)) console.log("- " + line);
      break;
    }
    case "mods": {
      const mods = await listMods();
      if (!mods.length) return console.log(D("No mods yet. Open an app with morse launch, then press Alt+Space."));
      for (const m of mods) {
        const where = m.match.app || m.match.hosts.join(",");
        console.log(`${m.enabled ? W("●") : D("○")} ${B(m.title)} ${D(m.id)}  ${where}\n    ${D("“" + m.prompt + "”")}`);
      }
      break;
    }
    case "rm":
      await deleteMod(f._[0]);
      console.log("Deleted " + f._[0]);
      break;
    case "export": {
      const mod = (await listMods()).find(m => m.id === f._[0]);
      if (!mod) throw new Error(`No mod with the id ${f._[0]}. Run morse mods to see them.`);
      const slug = mod.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      console.log(await writeExport(`${slug}.morse.json`, JSON.stringify(mod, null, 2)));
      console.log(await writeExport(`${slug}.user.js`, toUserscript(mod)));
      console.log(await encodeShare(mod));
      break;
    }
    case "install": {
      const src = f._[0];
      const { readFile } = await import("node:fs/promises");
      const mod = src.includes("#m=") ? await decodeShare(src) : JSON.parse(await readFile(src, "utf8"));
      await saveMod({ ...mod, enabled: true, imported: true });
      console.log(`Installed ${B(mod.title)} for ${mod.match.app || mod.match.hosts.join(", ")}`);
      break;
    }
    case "model":
    case "config": {
      if (f["api-key"] !== undefined) throw new Error("--api-key is gone. Use --anthropic-key or --openai-key instead.");
      if (MODEL_FLAGS.some(k => f[k] !== undefined)) await configure(f);
      await showModel();
      break;
    }
    case "serve": {
      const port = Number(f.port || HELPER_PORT);
      const bridge = createBridge({ port, log: console.log });
      await bridge.listen().catch(e => {
        throw new Error(e.code === "EADDRINUSE" ? `Port ${port} is already in use, probably by a Morse helper that is already running. Run morse pair to get a new code for it.` : e.message);
      });
      const s = await currentSettings();
      const { code } = await startPairing();
      console.log(LOGO + "\n");
      console.log(`  helper  http://127.0.0.1:${port}  ${D("v" + VERSION)}`);
      console.log(`  model   ${s.provider === "none" ? `${WARN("none")} ${D("(run morse doctor to set one up)")}` : settingsLabel(s)}`);
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
        console.log(`\n  No model is connected. Install Claude Code (claude.com/claude-code) or Codex,\n  or add an API key: morse config --provider anthropic --anthropic-key sk-ant-…`);
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

main().catch(e => { console.error(`${ERR("✗")} ${e.message}`); process.exit(1); });
