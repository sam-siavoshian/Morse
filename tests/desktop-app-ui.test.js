// Morse Desktop for real: the Electron app (desktop-app/) driven with
// Playwright's _electron, opening Tunes (demo/electron-app, packaged on the
// same Electron runtime) the way a person would: the window lists Tunes,
// Open with Morse connects it (Morse's code shows up in Tunes), Disconnect
// takes Morse off while Tunes keeps running, Connect attaches to it again,
// an app that is already open asks "Tunes is open. Restart it with Morse?",
// and closing the window keeps Morse running in the tray. Also: the page
// sees window.morse and nothing else, and can't navigate anywhere.
//
// Needs an Electron runtime, Playwright and a display; skips otherwise:
//   npm install --prefix ~/.cache/morse/electron electron
//   DISPLAY=:99 node --test tests/desktop-app-ui.test.js
// The app list is only Tunes (MORSE_DESKTOP_SCAN=0 and desktop.json "apps"),
// so what is installed on this machine doesn't matter.
import { tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { waitFor } from "./helpers/wait.js";
import { freePort } from "./helpers/net.js";
import { electronExe, tunesApp } from "./helpers/tunes.js";

let _electron = null;
try { ({ _electron } = createRequire(import.meta.url)("playwright")); } catch {}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skip = !electronExe ? "no Electron runtime (npm install --prefix ~/.cache/morse/electron electron)"
  : !_electron ? "playwright not installed"
  : process.platform === "darwin" ? "Tunes is packaged for Linux and Windows only"
  : process.platform === "linux" && !process.env.DISPLAY ? "Electron needs a display. Run with DISPLAY=:99 (Xvfb)"
  : false;
if (skip) console.log(`desktop-app-ui.test.js: skipping: ${skip}`);

const ROOT = process.getuid?.() === 0 ? ["--no-sandbox"] : []; // Chromium won't start as root with its sandbox on
const until = (fn, ms, what) => waitFor(fn, { timeout: ms, interval: 150, what });
const { CDPSession, listTargets } = await import("../daemon/cdp.js");
const apps = await import("../daemon/apps.js");

const home = tempDir("morse-desktop-ui-");
const kids = [];
let electronApp = null;
after(async () => {
  try { await electronApp?.close(); } catch {}
  for (const k of kids) try { k.kill("SIGKILL"); } catch {}
  for (const p of apps.listProcesses()) if (p.cmd.includes(home)) try { process.kill(p.pid, "SIGKILL"); } catch {}
});

const session = async () => JSON.parse(await fs.readFile(path.join(home, "sessions", "tunes.json"), "utf8"));
async function inTunes(port, expr) {
  const t = await until(async () => (await listTargets(port)).find(t => t.type === "page" && t.url === "app://tunes/index.html"), 15000, "Tunes' window");
  const s = await CDPSession.connect(t.webSocketDebuggerUrl);
  try { return (await s.send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.value; } finally { s.close(); }
}
async function quitTunes(port) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const b = await CDPSession.connect(v.webSocketDebuggerUrl);
  await b.send("Browser.close").catch(() => {});
  b.close();
}

test("Morse Desktop opens Tunes with Morse, disconnects, connects again, asks before restarting it, and stays in the tray", { skip, timeout: 300000 }, async () => {
  const { exe } = await tunesApp();
  const profile = path.join(home, "tunes-profile");
  await fs.writeFile(path.join(home, "desktop.json"), JSON.stringify({ helper: false, apps: [exe], appArgs: { tunes: [`--user-data-dir=${profile}`, ...ROOT] } }));

  electronApp = await _electron.launch({
    executablePath: electronExe,
    args: [path.join(root, "desktop-app"), ...ROOT],
    env: { ...process.env, MORSE_HOME: home, MORSE_DESKTOP_SCAN: "0", MORSE_PROVIDER: "demo", MORSE_HELPER_PORT: String(await freePort()), ELECTRON_RUN_AS_NODE: "" },
    timeout: 60000,
  });
  const logs = [];
  for (const s of [electronApp.process().stdout, electronApp.process().stderr]) s?.on("data", d => logs.push(String(d)));
  const w = await electronApp.firstWindow();
  // Tunes' row reaching a state; on a timeout, says what the window and Morse said.
  const rowState = async (state, timeout) => {
    try { await w.locator(`li[data-app="tunes"].${state}`).waitFor({ timeout }); }
    catch (e) {
      const seen = await w.evaluate(() => [document.querySelector('li[data-app="tunes"]')?.className, document.querySelector('li[data-app="tunes"]')?.innerText, document.getElementById("apps-error")?.innerText]).catch(() => []);
      throw new Error(`Tunes' row never became "${state}". Row: ${JSON.stringify(seen)}\nMorse said:\n${logs.join("").split("\n").filter(l => /\[morse\]/.test(l)).slice(-30).join("\n")}`, { cause: e });
    }
  };
  await w.waitForSelector("html[data-ready]", { timeout: 30000 });

  // The page: window.morse, and nothing from Node or Electron.
  const globals = await w.evaluate(() => ({
    morse: Object.keys(window.morse), frozen: Object.isFrozen(window.morse),
    require: typeof window.require, process: typeof window.process, ipc: typeof window.ipcRenderer, electron: typeof window.electron, Buffer: typeof window.Buffer,
  }));
  assert.deepEqual(globals.morse, ["state", "refreshApps", "openApp", "disconnectApp", "addApp", "modelChoices", "chooseModel", "checkModel", "setHelper", "newPairingCode", "answerPairLink", "signOutBrowsers", "showExtensionFolder", "setModOn", "setAllModsOff", "runChecks", "setStartAtLogin", "openLink", "onChange"]);
  assert.equal(globals.frozen, true);
  for (const k of ["require", "process", "ipc", "electron", "Buffer"]) assert.equal(globals[k], "undefined", k);
  const prefs = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  // Fetching anything from the page is refused by the CSP (connect-src 'none').
  assert.equal(await w.evaluate(() => fetch("https://example.com/").then(() => "fetched", () => "refused")), "refused");

  // Tunes is listed.
  const row = w.locator('li[data-app="tunes"]');
  await row.waitFor({ timeout: 30000 });
  assert.match(await row.innerText(), /Tunes/);

  // Open with Morse: Tunes starts with Morse connected.
  await row.getByRole("button", { name: "Open with Morse" }).click();
  await rowState("connected", 90000);
  assert.match(await row.innerText(), /Connected/);
  const s1 = await until(async () => { const s = await session(); return s.state === "attached" && s.windows?.length && s; }, 30000, "the session file to show Tunes' windows");
  assert.equal(s1.pid, electronApp.process().pid, "Morse Desktop holds the session itself");
  await until(() => inTunes(s1.port, `!!document.querySelector("[data-morse-ui]")`), 30000, "Morse in Tunes' window");

  // Disconnect: Morse comes off, Tunes keeps running and can be connected again.
  await row.getByRole("button", { name: "Disconnect" }).click();
  await rowState("open-connectable", 30000);
  await until(async () => !(await inTunes(s1.port, `!!document.querySelector("[data-morse-ui]")`)), 15000, "Morse to leave Tunes");
  await row.getByRole("button", { name: "Connect" }).click();
  await rowState("connected", 60000);
  assert.equal((await session()).port, s1.port, "connected to the same Tunes, not a new one");
  await row.getByRole("button", { name: "Disconnect" }).click();
  await rowState("open-connectable", 30000);
  await quitTunes(s1.port);
  await rowState("closed", 30000);

  // Already open without Morse: it asks first, like `morse launch` does.
  const plain = spawn(exe, [`--user-data-dir=${profile}`, ...ROOT], { stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  kids.push(plain);
  await rowState("open", 60000);
  assert.match(await row.innerText(), /Open without Morse/);
  await row.getByRole("button", { name: "Open with Morse" }).click();
  const dialog = w.locator("dialog#ask-restart[open]");
  await dialog.waitFor({ timeout: 30000 });
  assert.equal(await dialog.locator("h2").innerText(), "Tunes is open. Restart it with Morse?");
  await dialog.getByRole("button", { name: "Restart" }).click();
  await rowState("connected", 90000);
  await until(() => plain.exitCode !== null || plain.signalCode !== null, 15000, "the Tunes started without Morse to have quit");
  const s2 = await session();

  // Last, since Playwright then waits for a navigation that never comes: the
  // page can't go anywhere else, or open windows.
  const home0 = w.url();
  await w.evaluate(() => { location.href = "https://example.com/"; }).catch(() => {});
  await w.evaluate(() => window.open("https://example.com/")).catch(() => {});
  await new Promise(r => setTimeout(r, 500));
  assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()), home0, "navigation is refused");
  assert.equal(electronApp.windows().length, 1, "no new windows");

  // Closing the window keeps Morse running (in the tray).
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await new Promise(r => setTimeout(r, 500));
  const still = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(b => ({ visible: b.isVisible(), destroyed: b.isDestroyed() })));
  assert.deepEqual(still, [{ visible: false, destroyed: false }]);
  assert.equal(electronApp.process().exitCode, null, "still running");

  // Quit Morse (the tray's Quit Morse) while Tunes is connected: Morse leaves
  // Tunes, which keeps running, and its session goes away.
  const proc = electronApp.process();
  const exited = new Promise(r => proc.once("exit", r));
  await electronApp.evaluate(({ app }) => { app.quit(); }).catch(() => {});
  await Promise.race([exited, new Promise((_, no) => setTimeout(() => no(new Error("Morse didn't quit within 15 s")), 15000))]);
  electronApp = null;
  await until(async () => !(await fs.stat(path.join(home, "sessions", "tunes.json")).catch(() => null)), 10000, "Tunes' session file to go");
  assert.equal(await inTunes(s2.port, `!!document.querySelector("[data-morse-ui]")`), false, "Morse is off Tunes");
  await quitTunes(s2.port);
});
