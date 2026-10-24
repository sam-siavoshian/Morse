#!/usr/bin/env node
// morse: customize any app in one sentence.

import { resolveApp } from "./apps.js";
import { inspectFuses, fuseVerdict } from "./fuses.js";
import { appsCommand, launchCommand, attachCommand, statusCommand, stopCommand } from "./desktop.js";
import { listMods, deleteMod, saveMod, loadConfig, saveConfig, writeExport, HOME } from "./store.js";
import { resolveSettings, settingsLabel, DEFAULT_SETTINGS } from "../core/providers.js";
import { toUserscript, decodeShare, encodeShare } from "../core/mod.js";

const G = s => `\x1b[32m${s}\x1b[0m`, D = s => `\x1b[2m${s}\x1b[0m`, B = s => `\x1b[1m${s}\x1b[0m`;
const LOGO = `${G("▪▪▫")}\n${G("▫▪▪")} ${B("morse")} ${D("· customize any app in one sentence")}\n${G("▪▫▪")}`;

function flags(argv) {
  const out = { _: [], rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out.rest = argv.slice(i + 1); break; }
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
    } else out._.push(a);
  }
  return out;
}

async function settingsFrom(f) {
  const cfg = await loadConfig();
  const s = { ...DEFAULT_SETTINGS, ...cfg.model };
  if (f.model) s.model = f.model;
  if (f.provider) s.provider = f.provider;
  if (f["base-url"]) s.baseUrl = f["base-url"];
  if (f["api-key"]) s.apiKey = f["api-key"];
  return resolveSettings(s);
}

const HELP = `${LOGO}

${B("Desktop apps")} (Electron / Chromium)
  morse apps                list the apps Morse found and whether it can attach
  morse launch <app|path>   relaunch an app with Morse attached (partial names work: code, spot)
      --restart             quit the app first if it's open (remembered per app; --no-restart forgets)
      --watch               keep waiting when the app quits, attach again when it's back
      --name <name>         name mods are filed under (defaults to the app)
      --port <n>            debugging port (default: a free one from 9333)
      -- <args>             extra arguments for the app
  morse attach --port <n>   attach to an app already started with --remote-debugging-port
  morse status              apps Morse is attached to, their windows and mods
  morse stop <app>          detach from an app (it keeps running)
  morse fuses <app|path>    show the app's Electron fuses and what they mean for Morse

${B("Mods")}
  morse mods                list installed mods
  morse rm <id>             delete a mod
  morse export <id>         write .morse.json, .user.js and a share link
  morse install <link|file> install a shared mod

${B("Model")}
  morse model               show the model Morse will use
  morse model --provider ollama|openai|demo --model <name> [--base-url <url>] [--api-key <key>]

In any attached window: ${B("Alt+Space")} to morse · ${B("Alt+Shift+M")} for your mods.
Websites: load the browser extension (npm run build, then load dist/extension).`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
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
      console.log(JSON.stringify(info, null, 2));
      for (const line of fuseVerdict(info)) console.log("- " + line);
      break;
    }
    case "mods": {
      const mods = await listMods();
      if (!mods.length) return console.log(D("No mods yet. Press Alt+Space in an attached app."));
      for (const m of mods) {
        const where = m.match.app || m.match.hosts.join(",");
        console.log(`${m.enabled ? G("●") : D("○")} ${B(m.title)} ${D(m.id)}  ${where}\n    ${D("“" + m.prompt + "”")}`);
      }
      break;
    }
    case "rm":
      await deleteMod(f._[0]);
      console.log("Deleted " + f._[0]);
      break;
    case "export": {
      const mod = (await listMods()).find(m => m.id === f._[0]);
      if (!mod) throw new Error("No mod " + f._[0]);
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
    case "model": {
      if (f.provider || f.model || f["base-url"] || f["api-key"]) {
        const cfg = await loadConfig();
        cfg.model = { ...cfg.model, ...(f.provider && { provider: f.provider }), ...(f.model && { model: f.model }), ...(f["base-url"] && { baseUrl: f["base-url"] }), ...(f["api-key"] && { apiKey: f["api-key"] }) };
        await saveConfig(cfg);
      }
      const s = await settingsFrom({});
      console.log(`${settingsLabel(s)}${s.available ? D(`\navailable: ${s.available.join(", ")}`) : ""}\n${D(`config: ${HOME}/config.json`)}`);
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch(e => { console.error(`\x1b[31m✗\x1b[0m ${e.message}`); process.exit(1); });
