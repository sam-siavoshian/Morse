// Screenshots of Morse Desktop (desktop-app/) for docs/desktop-app.md, taken
// from the real app: Tunes (demo/electron-app) opened with Morse for real,
// Claude Code checked for real when it's installed (the demo model otherwise),
// and the apps this machine has (MORSE_SHOT_APPS: more app paths to list).
//
//   DISPLAY=:99 node demo/shoot-desktop-app.js [outDir]   (default docs/screenshots)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronExe, tunesApp } from "../tests/helpers/tunes.js";
import { createMod } from "../core/mod.js";

const { _electron } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.resolve(process.argv[2] || path.join(root, "docs", "screenshots"));
const ROOT = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const home = mkdtempSync(path.join(os.tmpdir(), "morse-shoot-desktop-"));
const kids = [];

const { exe } = await tunesApp();
const profile = path.join(home, "tunes-profile");
// Apps on this machine, by their files, so the list doesn't depend on what else is running.
const extra = ["/usr/share/codium/codium", path.join(os.homedir(), "Applications/Obsidian-1.14.5.AppImage"), path.join(os.homedir(), ".joplin/Joplin.AppImage"),
  ...(process.env.MORSE_SHOT_APPS || "").split(":")].filter(p => p && existsSync(p));
await fs.writeFile(path.join(home, "desktop.json"), JSON.stringify({ helper: true, apps: [exe, ...extra], appArgs: { tunes: [`--user-data-dir=${profile}`, ...ROOT] } }));
const claude = !!process.env.PATH.split(":").find(d => existsSync(path.join(d, "claude")));
await fs.writeFile(path.join(home, "config.json"), JSON.stringify(claude ? { provider: "claude-code", models: { "claude-code": "haiku" } } : { provider: "demo" }), { mode: 0o600 });
await fs.mkdir(path.join(home, "mods"), { recursive: true });
const mod = (app, url, title, prompt, enabled = true) => ({ ...createMod({ title, prompt, css: "/* … */", url, app }), enabled });
for (const m of [
  mod("tunes", "app://tunes/index.html", "Sleep timer", "add a sleep timer that pauses the music after a while"),
  mod("tunes", "app://tunes/index.html", "Bigger album art", "make the album art twice as big"),
  mod("tunes", "app://tunes/index.html", "Hide the shop", "hide the shop banner", false),
  mod("vscodium", "vscode-file://vscode-app/index.html", "Status bar back", "put the status bar back at the bottom"),
  mod("obsidian", "app://obsidian.md/index.html", "No ribbon", "hide the ribbon on the left"),
]) await fs.writeFile(path.join(home, "mods", `${m.id}.json`), JSON.stringify(m, null, 2));

const env = { ...process.env, MORSE_HOME: home, MORSE_DESKTOP_SCAN: "0", MORSE_HELPER_PORT: String(17000 + Math.floor(Math.random() * 2000)), ELECTRON_RUN_AS_NODE: "" };
async function launch(theme) {
  const app = await _electron.launch({ executablePath: electronExe, args: [path.join(root, "desktop-app"), ...ROOT], env: { ...env, MORSE_DESKTOP_THEME: theme }, colorScheme: theme, timeout: 60000 });
  const w = await app.firstWindow();
  await w.waitForSelector("html[data-ready]", { timeout: 30000 });
  await sleep(600);
  return { app, w };
}
const shot = async (w, name) => { await sleep(400); await w.screenshot({ path: path.join(out, name) }); console.log(`saved ${name}`); };
console.log("home", home);
// Quit Morse (it takes Morse off Tunes first); force it if it takes too long.
async function quit(app) {
  const pid = app.process().pid;
  await Promise.race([app.close().catch(() => {}), sleep(15000)]);
  try { process.kill(pid, "SIGKILL"); } catch {}
  console.log("quit Morse");
}
const tab = async (w, name) => { await w.click(`nav button[data-tab="${name}"]`); await sleep(300); };

try {
  let { app, w } = await launch("dark");
  const row = w.locator('li[data-app="tunes"]');
  await row.waitFor();
  // 1. Your apps, Tunes connected.
  await row.getByRole("button", { name: "Open with Morse" }).click();
  await w.locator('li[data-app="tunes"].connected').waitFor({ timeout: 90000 });
  await w.mouse.move(5, 500);
  await shot(w, "167-desktop-app-apps.png");

  // 2. Already open: the question before restarting it.
  await row.getByRole("button", { name: "Disconnect" }).click();
  await w.locator('li[data-app="tunes"].open-connectable').waitFor({ timeout: 30000 });
  const port = JSON.parse(await fs.readFile(path.join(home, "apps.json"), "utf8")).tunes.port;
  await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()).then(async v => {
    const { CDPSession } = await import("../daemon/cdp.js");
    const b = await CDPSession.connect(v.webSocketDebuggerUrl); await b.send("Browser.close").catch(() => {}); b.close();
  });
  await w.locator('li[data-app="tunes"].closed').waitFor({ timeout: 30000 });
  kids.push(spawn(exe, [`--user-data-dir=${profile}`, ...ROOT], { stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } }));
  await w.locator('li[data-app="tunes"].open').waitFor({ timeout: 60000 });
  await row.getByRole("button", { name: "Open with Morse" }).click();
  await w.locator("dialog#ask-restart[open]").waitFor();
  await shot(w, "168-desktop-app-restart.png");
  await w.getByRole("button", { name: "Restart" }).click();
  await w.locator('li[data-app="tunes"].connected').waitFor({ timeout: 90000 });

  // 3. Model: checked, and the choices.
  await tab(w, "model");
  await w.click("#check-model");
  await w.waitForFunction(() => !document.querySelector("#model-live .radar"), null, { timeout: 120000 });
  await w.click("#change-model");
  await w.waitForSelector("#choice-list .choice");
  await w.mouse.move(5, 500);
  await shot(w, "169-desktop-app-model.png");
  await w.click("#cancel-choice");

  // 4. Chrome: the helper on, and a code to type.
  await tab(w, "chrome");
  await w.click("#new-code");
  await w.waitForSelector("#pair-code:not([hidden])");
  await shot(w, "170-desktop-app-chrome.png");

  // 5. Chrome's welcome page asked to connect (a morse:// link, handed over by a second start).
  const second = spawn(electronExe, [path.join(root, "desktop-app"), ...ROOT, "morse://pair?code=K7QM2X"], { stdio: "ignore", env });
  kids.push(second);
  await w.waitForSelector("dialog#ask-pair[open]", { timeout: 30000 });
  await shot(w, "171-desktop-app-pair.png");
  await w.click("#pair-no");

  // 6. Mods, per app, with switches.
  await tab(w, "mods");
  await shot(w, "172-desktop-app-mods.png");

  // 7. Checks.
  await tab(w, "checks");
  await w.click("#run-checks");
  await w.waitForFunction(() => !document.querySelector("#run-checks").disabled, null, { timeout: 120000 });
  await shot(w, "173-desktop-app-checks.png");

  // 8. The same window in light mode.
  await tab(w, "apps");
  await quit(app);
  ({ app, w } = await launch("light"));
  await w.locator('li[data-app="tunes"]').waitFor();
  await w.mouse.move(5, 500);
  await shot(w, "174-desktop-app-light.png");
  await quit(app);
} finally {
  for (const k of kids) try { k.kill("SIGKILL"); } catch {}
  const { listProcesses } = await import("../daemon/apps.js");
  for (const p of listProcesses()) if (p.cmd.includes(home)) try { process.kill(p.pid, "SIGKILL"); } catch {}
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
}
