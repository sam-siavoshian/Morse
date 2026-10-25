// Screenshots of the Morse app (desktop-app/) for docs/desktop-app.md, taken
// from the real app with the real apps this machine has, each with its own
// icon: Microsoft's Visual Studio Code opened with Morse for real; VSCodium,
// Obsidian, Joplin and Logseq listed (MORSE_SHOT_APPS: more app paths to
// list); Claude Code (sonnet) checked for real when it's installed (the demo
// model otherwise). "Use Morse in Chrome" copies the extension to
// ~/Morse for Chrome (removed afterwards); Chrome itself isn't started
// (MORSE_CHROME=true), so the window's picture is what shows.
//
//   DISPLAY=:99 node demo/shoot-desktop-app.js [outDir]   (default docs/screenshots)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronExe } from "../tests/helpers/tunes.js";
import { createMod } from "../core/mod.js";

const { _electron } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.resolve(process.argv[2] || path.join(root, "docs", "screenshots"));
const ROOT = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const home = mkdtempSync(path.join(os.tmpdir(), "morse-shoot-desktop-"));
const kids = [];

// The app opened with Morse: Microsoft's VS Code on a small real project
// (Morse's own core/), without its first-run sign-in screen.
const exe = "/usr/share/code/code", APP = "visual-studio-code";
if (!existsSync(exe)) throw new Error("Install Visual Studio Code (code.visualstudio.com) first.");
const profile = path.join(home, "vscode-profile");
const project = path.join(home, "morse-core");
await fs.mkdir(path.join(profile, "User"), { recursive: true });
await fs.writeFile(path.join(profile, "User", "settings.json"), JSON.stringify({ "chat.disableAIFeatures": true, "workbench.startupEditor": "none", "workbench.tips.enabled": false, "security.workspace.trust.enabled": false, "telemetry.telemetryLevel": "off", "update.mode": "none", "workbench.secondarySideBar.defaultVisibility": "hidden" }));
await fs.cp(path.join(root, "core"), project, { recursive: true });
const appArgs = [...ROOT, `--user-data-dir=${profile}`, project, path.join(project, "engine.js")];
// Apps on this machine, by their files, so the list doesn't depend on what else is running.
const extra = ["/usr/share/codium/codium", path.join(os.homedir(), "Applications/Obsidian-1.14.5.AppImage"), path.join(os.homedir(), ".joplin/Joplin.AppImage"),
  "/root/morse-real-apps/logseq/Logseq-linux-x64-0.10.9.AppImage",
  ...(process.env.MORSE_SHOT_APPS || "").split(":")].filter(p => p && existsSync(p));
await fs.writeFile(path.join(home, "desktop.json"), JSON.stringify({ helper: true, apps: [exe, ...extra], appArgs: { [APP]: appArgs } }));
const claude = !!process.env.PATH.split(":").find(d => existsSync(path.join(d, "claude")));
await fs.writeFile(path.join(home, "config.json"), JSON.stringify(claude ? { provider: "claude-code", models: { "claude-code": "sonnet" } } : { provider: "demo" }), { mode: 0o600 });
await fs.mkdir(path.join(home, "mods"), { recursive: true });
const mod = (app, url, title, prompt, enabled = true) => ({ ...createMod({ title, prompt, css: "/* … */", url, app }), enabled });
// The mods real runs made in these apps (docs/desktop.md, Tested on).
for (const m of [
  mod(APP, "vscode-file://vscode-app/workbench.html", "Warm Paper Notebook Theme", "make the whole editor look like a warm paper notebook: cream backgrounds, dark brown text, and a serif font in the sidebar and the tabs"),
  mod(APP, "vscode-file://vscode-app/workbench.html", "Bigger status bar", "make the status bar bigger", false),
  mod("vscodium", "vscode-file://vscode-app/workbench.html", "Taller status bar", "make the status bar bigger"),
  mod("obsidian", "app://obsidian.md/index.html", "No ribbon", "hide this ribbon"),
  mod("joplin", "file:///joplin/index.html", "Hide Synchronize", "hide this button, I don't use sync"),
]) await fs.writeFile(path.join(home, "mods", `${m.id}.json`), JSON.stringify(m, null, 2));

const chromeFolder = path.join(os.homedir(), "Morse for Chrome");
const hadChromeFolder = existsSync(chromeFolder);
const env = { ...process.env, MORSE_HOME: home, MORSE_DESKTOP_SCAN: "0", MORSE_HELPER_PORT: String(17000 + Math.floor(Math.random() * 2000)), ELECTRON_RUN_AS_NODE: "",
  MORSE_COPY_EXTENSION: "1", MORSE_CHROME_FOLDER: chromeFolder, MORSE_CHROME: "/bin/true" };
async function launch(theme) {
  const app = await _electron.launch({ executablePath: electronExe, args: [path.join(root, "desktop-app"), ...ROOT], env: { ...env, MORSE_DESKTOP_THEME: theme }, colorScheme: theme, timeout: 60000 });
  const w = await app.firstWindow();
  await w.waitForSelector("html[data-ready]", { timeout: 30000 });
  await sleep(600);
  return { app, w };
}
const shot = async (w, name) => { await sleep(400); await w.screenshot({ path: path.join(out, name) }); console.log(`saved ${name}`); };
console.log("home", home);
// Quit Morse (it takes Morse off VS Code first); force it if it takes too long.
async function quit(app) {
  const pid = app.process().pid;
  await Promise.race([app.close().catch(() => {}), sleep(15000)]);
  try { process.kill(pid, "SIGKILL"); } catch {}
  console.log("quit Morse");
}
const tab = async (w, name) => { await w.click(`nav button[data-tab="${name}"]`); await sleep(300); };

try {
  let { app, w } = await launch("dark");
  // 0. The first run: the model found by itself (checked for real), and the apps.
  await w.locator("#first").waitFor();
  await w.waitForFunction(() => !document.querySelector("#first-model .radar.live") && /answered|didn't answer/.test(document.querySelector("#first-model").textContent), null, { timeout: 120000 });
  await w.mouse.move(5, 600);
  await shot(w, "175-desktop-app-first-run.png");
  // 0b. Use Morse in Chrome too: the folder, Chrome's extensions page, and the picture of where to click.
  await w.click("#first-chrome");
  await w.locator("dialog#chrome-guide[open]").waitFor();
  await shot(w, "176-desktop-app-chrome-guide.png");
  await w.click("#guide-done");
  await w.click("#first-skip");
  const row = w.locator(`li[data-app="${APP}"]`);
  await row.waitFor();
  // 1. Your apps, VS Code connected.
  await row.getByRole("button", { name: "Open with Morse" }).click();
  await w.locator(`li[data-app="${APP}"].connected`).waitFor({ timeout: 90000 });
  await w.mouse.move(5, 500);
  await shot(w, "167-desktop-app-apps.png");

  // 2. Already open: the question before restarting it.
  await row.getByRole("button", { name: "Disconnect" }).click();
  await w.locator(`li[data-app="${APP}"].open-connectable`).waitFor({ timeout: 30000 });
  // Quit it (Morse connects over a private pipe now, so there's no port to
  // ask): the processes with this run's own profile.
  const { listProcesses } = await import("../daemon/apps.js");
  for (const p of listProcesses()) if (p.cmd.includes(profile)) try { process.kill(p.pid, "SIGTERM"); } catch {}
  // VS Code sometimes stays after SIGTERM (it was disconnected, not asked to quit): then it is killed.
  await w.locator(`li[data-app="${APP}"].closed`).waitFor({ timeout: 10000 }).catch(async () => {
    for (const p of listProcesses()) if (p.cmd.includes(profile)) try { process.kill(p.pid, "SIGKILL"); } catch {}
    await w.locator(`li[data-app="${APP}"].closed`).waitFor({ timeout: 30000 });
  });
  kids.push(spawn(exe, appArgs, { stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } }));
  await w.locator(`li[data-app="${APP}"].open`).waitFor({ timeout: 60000 });
  await row.getByRole("button", { name: "Open with Morse" }).click();
  await w.locator("dialog#ask-restart[open]").waitFor();
  await shot(w, "168-desktop-app-restart.png");
  await w.getByRole("button", { name: "Restart" }).click();
  await w.locator(`li[data-app="${APP}"].connected`).waitFor({ timeout: 90000 });

  // 3. Model: checked, and the choices.
  await tab(w, "model");
  await w.click("#check-model");
  await w.waitForFunction(() => !document.querySelector("#model-live .radar.live"), null, { timeout: 120000 });
  await w.click("#change-model");
  await w.waitForSelector("#choice-list .choice");
  await w.mouse.move(5, 500);
  await shot(w, "169-desktop-app-model.png");
  await w.click("#cancel-choice");

  // 4. Chrome: Use Morse in Chrome, Let Chrome use Morse, and (under Advanced) a code.
  await tab(w, "chrome");
  await w.mouse.move(5, 500);
  await shot(w, "170-desktop-app-chrome.png");

  // 5. The Morse extension asks to connect (the request it makes, docs/dev/pairing.md).
  // Only a helper that can ask (onboarding v2's daemon/bridge.js) answers it.
  const helperSays = await fetch(`http://127.0.0.1:${env.MORSE_HELPER_PORT}/v1/health`).then(r => r.json(), () => ({}));
  if (helperSays.ask) {
    await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: Number(env.MORSE_HELPER_PORT), method: "POST", path: "/v1/pair/ask", headers: { Origin: `chrome-extension://${"lkbmdfnoigeajfhc".repeat(2)}`, "Content-Type": "application/json" } }, res => { res.resume(); res.on("end", resolve); });
      req.on("error", reject);
      req.end("{}");
    });
    await w.waitForSelector("dialog#ask-pair[open]", { timeout: 30000 });
    await shot(w, "171-desktop-app-allow-chrome.png");
    await w.click("#pair-no");
  } else console.log("skipped 171-desktop-app-allow-chrome.png: this Morse helper can't ask yet");

  // 6. Mods, per app, with switches.
  await tab(w, "mods");
  await shot(w, "172-desktop-app-mods.png");

  // 7. Checks (a card under Model).
  await tab(w, "model");
  await w.click("#run-checks");
  await w.waitForFunction(() => !document.querySelector("#run-checks").disabled, null, { timeout: 120000 });
  await w.locator("#checks").scrollIntoViewIfNeeded();
  await shot(w, "173-desktop-app-checks.png");

  // 8. The same window in light mode.
  await tab(w, "apps");
  await quit(app);
  ({ app, w } = await launch("light"));
  await w.locator(`li[data-app="${APP}"]`).waitFor();
  await w.mouse.move(5, 500);
  await shot(w, "174-desktop-app-light.png");
  await quit(app);
} finally {
  for (const k of kids) try { k.kill("SIGKILL"); } catch {}
  const { listProcesses } = await import("../daemon/apps.js");
  for (const p of listProcesses()) if (p.cmd.includes(home)) try { process.kill(p.pid, "SIGKILL"); } catch {}
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
  if (!hadChromeFolder) await fs.rm(chromeFolder, { recursive: true, force: true }).catch(() => {});
}
