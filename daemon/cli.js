#!/usr/bin/env node
// morse: change any app in your own words.

import { execFile } from "node:child_process";
import { setLanguage, languageFromEnv, t } from "../core/i18n.js";
import { resolveApp } from "./apps.js";
import { inspectFuses, formatFuses } from "./fuses.js";
import { appsCommand, launchCommand, attachCommand, statusCommand, stopCommand } from "./desktop.js";
import { listMods, deleteMod, saveMod, loadConfig, updateConfig, writeExport, CONFIG_PATH, HOME, savePrefs } from "./store.js";
import { startLabel, modelNames } from "../core/route.js"; // models: fast and strong
import { commandFor, platformChecks, formatChecks } from "./platform.js";
import { currentSettings, settingsFromConfig, settingsLabel, keysFrom, assertProvider, mask, migrateLegacy } from "./models.js";
import { detectHarnesses, validModel } from "./harness.js";
import { createBridge, startPairing, VERSION, helperPort } from "./bridge.js";
import { streamChat } from "../core/providers.js";
// MORSE_HELPER_PORT moves `morse serve`, `morse setup --pair` and the health
// check off 7457 (tests run several helpers at once; their extension follows
// with chrome.storage.local "morse.helperPort", docs/dev/testing.md).
const HELPER_PORT = helperPort();
import { toUserscript, decodeShare, encodeShare } from "../core/mod.js";
import { plainError, setHelperPort } from "../core/onboarding.js";
setHelperPort(HELPER_PORT); // "can't reach 127.0.0.1:<port>" reads as "the helper isn't running"
import { pauseCli, resumeCli, exportAllCli, importCli, codeCli } from "./control.js"; // user control
import { configuredHotkeys } from "./store.js";
import { paint, shown } from "./colors.js";

// The hotkeys as set in ~/.morse/settings.json (platform defaults otherwise).
// The terminal's language (LANG, LC_ALL; MORSE_LANG overrides): what people
// read is in it, `morse help` too. doctor and model output stay English (developers).
setLanguage(languageFromEnv(process.env));
const KEYS = await configuredHotkeys().catch(() => ({}));
const openKey = KEYS.open || t("cli.openKey");

const { w: W, d: D, b: B, y: WARN, r: ERR } = paint; // plain text when piped, NO_COLOR (colors.js)
const LOGO = `${W("▪▪▫")}\n${W("▫▪▪")} ${B("morse")} ${D(`· ${t("card.tagline")}`)}\n${W("▪▫▪")}`;

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
  if (s.provider === "none") console.log(`${WARN("!")} ${t("cli.noModel", { cmd: B("morse setup") })}`);
  return s;
}

const MODEL_FLAGS = ["provider", "model", "anthropic-key", "openai-key", "base-url", "model-mode", "fast-model", "best-model"];

async function configure(f) {
  if (f.provider && f.provider !== "auto") assertProvider(f.provider);
  for (const k of ["model", "fast-model", "best-model"]) if (typeof f[k] === "string" && f[k] !== "auto" && !validModel(f[k])) throw new Error(t("cli.badModel", { model: f[k] }));
  // models: Automatic / Always fast / Always best is a bar setting (settings.json)
  if (f["model-mode"] !== undefined) {
    const mode = { automatic: "auto", auto: "auto", fast: "fast", best: "best" }[String(f["model-mode"]).toLowerCase()];
    if (!mode) throw new Error(t("cli.badModelMode"));
    await savePrefs({ modelMode: mode });
  }
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
      // --model auto (or empty): no fixed model, Morse chooses (core/route.js)
      if (f.model && f.model !== "auto") cfg.models[target] = f.model; else delete cfg.models[target];
    }
    for (const [flag, tier] of [["fast-model", "fast"], ["best-model", "best"]]) { // models: the two names Automatic uses
      if (typeof f[flag] !== "string") continue;
      cfg.tiers = { ...cfg.tiers, [target]: { ...cfg.tiers?.[target] } };
      if (f[flag]) cfg.tiers[target][tier] = f[flag]; else delete cfg.tiers[target][tier];
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
  const s = await currentSettings();
  const keys = keysFrom(cfg);
  console.log(`${B(startLabel(s, settingsLabel))}${s.detected && s.provider !== "none" ? D("  (auto-detected)") : ""}`);
  console.log(D(`provider ${s.provider}${s.pinned && s.model ? ` · model ${s.model}` : ""}${s.baseUrl ? ` · ${s.baseUrl}` : ""}`));
  const names = s.provider === "none" ? null : modelNames(s, settingsLabel); // models
  if (names?.fast) console.log(D(`models   ${t(`settings.model.${["fast", "best"].includes(s.mode) ? s.mode : "auto"}`)} · fast ${names.fast} · best ${names.best}`));
  console.log(D(`keys     anthropic ${keys.anthropic ? "set" : "-"} · openai ${keys.openai ? "set" : "-"}`));
  console.log(D(`config   ${CONFIG_PATH}`));
}

function version(bin) {
  // claude.cmd in "C:\Program Files\nodejs" has to be quoted for cmd.exe (platform.js).
  const c = commandFor(bin, ["--version"]);
  return new Promise(r => execFile(c.file, c.args, { timeout: 8000, windowsHide: true, shell: c.shell },
    (e, out) => r(e ? "" : String(out).trim().split(/\r?\n/)[0])));
}

async function helperHealth() {
  try { return await (await fetch(`http://127.0.0.1:${HELPER_PORT}/v1/health`, { signal: AbortSignal.timeout(800) })).json(); } catch { return null; }
}

const h = (id, v) => t(`help.${id}`, v); // the commands and flags stay as typed
const HELP = `${LOGO}

${B(h("desktop"))} ${h("desktop.note")}
  morse apps                ${h("apps")}
  morse launch <app|path>   ${h("launch")}
      --restart             ${h("launch.restart")}
      --watch               ${h("launch.watch")}
      --name <name>         ${h("launch.name")}
      --port <n>            ${h("launch.port")}
      -- <args>             ${h("launch.args")}
  morse attach --port <n>   ${h("attach")}
  morse status              ${h("status")}
  morse stop <app>          ${h("stop")}
  morse fuses <app|path>    ${h("fuses")}

${B(h("web"))} ${h("web.note")}
  morse extension           ${h("extension")}
  morse serve               ${h("serve")}
  morse pair                ${h("pair")}
  morse unpair              ${h("unpair")}

${B(t("settings.model"))} ${h("model.note")}
  morse setup               ${h("setup")}
  morse model               ${h("modelCmd")}
  morse config --provider claude-code|codex|anthropic|openai|auto
      --model-mode auto|fast|best   ${h("config.mode")}
      --fast-model <name> --best-model <name>   ${h("config.tiers")}
      --model <name>        ${h("config.model")}
                            ${h("config.auto")}
      --anthropic-key <key> --openai-key <key> --base-url <url>   ${h("config.keys")}
  morse doctor              ${h("doctor")}

${B(h("mods"))}
  morse mods                ${h("modsCmd")}
  morse rm <id>             ${h("rm")}
  morse export <id>         ${h("export")}
  morse install <link|file> ${h("install")}
                            ${h("install.more")}
  morse code <id>           ${h("code")}
  morse export --all        ${h("exportAll")}  [--out <file>]

${B(h("packs"))} ${h("packs.note")}
  morse pack make <ids…> --name <name>   ${h("pk.make")}  [--note <text>] [--out <file>]
  morse pack install <file|link|address> ${h("pk.install")}  [--yes] [--replace]
      --subscribe           ${h("pk.subscribe")}
  morse pack list           ${h("pk.list")}  [--check]
  morse pack unsubscribe <name>  ${h("pk.unsub")}

${B(h("pause"))}
  morse pause [site|app]    ${h("pauseCmd")}
  morse resume [site|app]   ${h("resume")}  [${h("resume.all")}]

${h("foot.open", { key: B(openKey) })}${KEYS.mods ? ` ${h("foot.mods", { key: B(KEYS.mods) })}` : ""}${KEYS.off ? `
${h("foot.off", { key: B(KEYS.off) })}` : ""}
${h("foot.web", { ext: B("morse extension"), serve: B("morse serve") })}
${h("foot.version", { cmd: "morse --version" })}`;

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
      if (app.canAttach === false) return console.log(`${app.name}  ${app.path}\n  ${t("cli.cantConnect", { why: app.why })}`);
      console.log(formatFuses(info, app.name));
      break;
    }
    case "mods": {
      const mods = await listMods();
      if (!mods.length) return console.log(D(t("cli.mods.none", { key: openKey })));
      for (const m of mods) {
        const where = shown(m.match.app || m.match.hosts.join(","));
        console.log(`${m.enabled ? W("●") : D("○")} ${B(shown(m.title))} ${D(m.id)}  ${where}\n    ${D("“" + shown(m.prompt) + "”")}`);
      }
      break;
    }
    case "rm":
      await deleteMod(f._[0]);
      console.log(t("cli.deleted", { id: f._[0] }));
      break;
    case "export": {
      if (f.all) return exportAllCli(f); // user control: back up everything
      const mod = (await listMods()).find(m => m.id === f._[0]);
      if (!mod) throw new Error(t("cli.noMod", { id: f._[0] }));
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
    case "pack": await (await import("./packs.js")).packCli(f); break; // packs hook: morse pack make | install | list | unsubscribe
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
      if (!existsSync(EXTENSION_DIR)) throw new Error(t("cli.extension.notBuilt", { dir: EXTENSION_DIR.replace(/[\\/]dist[\\/]extension$/, "") }));
      console.log(EXTENSION_DIR);
      console.log(D(t("cli.extension.how")));
      break;
    }
    case "serve": {
      const port = Number(f.port || HELPER_PORT);
      const bridge = createBridge({ port, log: console.log });
      await bridge.listen().catch(e => {
        throw new Error(e.code === "EADDRINUSE" ? t("cli.serve.inUse", { port }) : e.message);
      });
      const s = await currentSettings();
      const { code } = await startPairing(undefined, typeof f.pair === "string" ? f.pair.trim().toUpperCase() : ""); // first-run hook: --pair <code from the welcome page>
      console.log(LOGO + "\n");
      console.log(`  helper  http://127.0.0.1:${port}  ${D("v" + VERSION)}`);
      console.log(`  model   ${s.provider === "none" ? `${WARN("none")} ${D(t("cli.serve.noModel"))}` : settingsLabel(s)}`);
      console.log(`  pair    ${B(code)}  ${D(t("cli.serve.pair"))}\n`);
      const stop = async () => { await bridge.close(); process.exit(0); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      break;
    }
    case "pair": {
      const { code } = await startPairing();
      console.log(`${t("cli.pair.code")} ${B(code)} ${D(t("cli.pair.once"))}`);
      if (!(await helperHealth())) console.log(D(t("cli.pair.noHelper")));
      break;
    }
    case "unpair": {
      let n = 0;
      await updateConfig(cfg => { n = cfg.bridge?.tokens?.length || 0; if (cfg.bridge) cfg.bridge.tokens = []; });
      console.log(t("cli.unpaired", { n }));
      break;
    }
    case "doctor": {
      if (f.provider) assertProvider(f.provider);
      const cfg = await loadConfig();
      const h = detectHarnesses();
      const keys = keysFrom(cfg);
      const row = (k, v) => console.log(`  ${k.padEnd(9)} ${v}`);
      // Is a newer morse-cli on npm? At most once a day; MORSE_NO_UPDATE_CHECK=1 turns it off (docs/privacy.md).
      const update = (await import("./update-check.js")).checkForUpdate(VERSION).catch(() => ({ state: "unknown" }));
      console.log(LOGO + "\n");
      const u = await update;
      // "unpublished": morse-cli isn't on npm (yet), so there is nothing to compare with.
      const note = { newer: () => WARN(t("cli.update.newer", { latest: u.latest, cmd: B("npm install -g morse-cli") })), current: () => D(t("cli.update.current")), off: () => D(t("cli.update.off")), unknown: () => D(t("cli.update.unknown")) }[u.state];
      row("morse", `${VERSION}${note ? `  ${note()}` : ""}`);
      row("node", process.version);
      row("config", CONFIG_PATH);
      // This computer: system, the Morse folder's permissions, shortcut, colors, platform specifics.
      console.log(formatChecks(await platformChecks({ home: HOME, shortcut: KEYS.open }), { paint }));
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
  const details = e?.details || (plain !== e?.message && e?.message) || "";
  console.error(`${ERR("✗")} ${plain}${details ? D(`  (${details})`) : ""}`);
  process.exit(1);
});
