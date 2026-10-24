#!/usr/bin/env node
// morph: customize any app in one sentence.

import { Connector } from "./connector.js";
import { resolveApp, launchApp, quitApp, KNOWN_APPS } from "./apps.js";
import { inspectFuses, fuseVerdict, electronBinaryFor } from "./fuses.js";
import { waitForEndpoint } from "./cdp.js";
import { listMods, deleteMod, saveMod, loadConfig, saveConfig, writeExport, HOME } from "./store.js";
import { resolveSettings, settingsLabel, DEFAULT_SETTINGS } from "../core/providers.js";
import { toUserscript, decodeShare, encodeShare } from "../core/mod.js";

const G = s => `\x1b[32m${s}\x1b[0m`, D = s => `\x1b[2m${s}\x1b[0m`, B = s => `\x1b[1m${s}\x1b[0m`;
const LOGO = `${G("▪▪▫")}\n${G("▫▪▪")} ${B("morph")} ${D("· customize any app in one sentence")}\n${G("▪▫▪")}`;

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
  morph launch <app|path>   relaunch an app with Morph attached
                            apps: ${Object.keys(KNOWN_APPS).join(", ")}
      --restart             quit the app first if it's running
      --name <name>         name mods are filed under (defaults to the app)
      --port <n>            debugging port (default 9333)
      -- <args>             extra arguments for the app
  morph attach --port <n>   attach to an app already started with --remote-debugging-port
  morph fuses <app|path>    show the app's Electron fuses and what they mean for Morph

${B("Mods")}
  morph mods                list installed mods
  morph rm <id>             delete a mod
  morph export <id>         write .morph.json, .user.js and a share link
  morph install <link|file> install a shared mod

${B("Model")}
  morph model               show the model Morph will use
  morph model --provider ollama|openai|demo --model <name> [--base-url <url>] [--api-key <key>]

In any attached window: ${B("Alt+Space")} to morph · ${B("Alt+Shift+M")} for your mods.
Websites: load the browser extension (npm run build, then load dist/extension).`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  switch (cmd) {
    case "launch": {
      if (!f._[0]) throw new Error("Which app? e.g. morph launch spotify");
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
        throw new Error(`${e.message}\n  If ${app.name} was already running, quit it or pass --restart.`);
      });
      console.log(`  port    ${port}\n`);
      await new Connector({ port, app: app.browser ? null : app, settings }).run();
      break;
    }
    case "attach": {
      const port = Number(f.port || 9222);
      const settings = await settingsFrom(f);
      await waitForEndpoint(port, 3000);
      console.log(LOGO + `\n\n  attached on port ${port} · model ${settingsLabel(settings)}\n`);
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
      console.log(await writeExport(`${slug}.morph.json`, JSON.stringify(mod, null, 2)));
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
