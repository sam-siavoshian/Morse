// Morse Desktop for real: the Electron app (desktop-app/) driven with
// Playwright's _electron, opening Tunes (demo/electron-app, packaged on the
// same Electron runtime) the way a person would: the first-run screen offers
// Tunes and the model it found, the window lists Tunes,
// Open with Morse connects it (Morse's code shows up in Tunes), Disconnect
// takes Morse off while Tunes keeps running, Connect attaches to it again,
// an app that is already open asks "Tunes is open. Restart it with Morse?", and
// closing the window keeps Morse running in the tray. Also: the page
// sees window.morse and nothing else, and can't navigate anywhere.
//
// Needs an Electron runtime, Playwright and a display; skips otherwise:
//   npm install --prefix ~/.cache/morse/electron electron
//   DISPLAY=:99 node --test tests/desktop-app-ui.test.js
// The app list is only Tunes (MORSE_DESKTOP_SCAN=0 and desktop.json "apps"),
// so what is installed on this machine doesn't matter. Always open with Morse
// is off here, so Tunes started by hand stays as it is (tests/desktop-app.test.js
// covers it).
import { tempDir } from "./helpers/home.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { waitFor } from "./helpers/wait.js";
import { electronExe, tunesApp } from "./helpers/tunes.js";

let _electron = null;
try { ({ _electron } = createRequire(import.meta.url)("playwright")); } catch {}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skip = !electronExe ? "no Electron runtime (npm install --prefix ~/.cache/morse/electron electron)"
  : !_electron ? "playwright not installed"
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
  // Quit Morse (Playwright's close() can wait forever while an app is connected), then make sure.
  if (electronApp) { const pid = electronApp.process().pid; await Promise.race([electronApp.evaluate(({ app }) => app.quit()).catch(() => {}), new Promise(r => setTimeout(r, 5000))]); await new Promise(r => setTimeout(r, 3000)); try { process.kill(pid, "SIGKILL"); } catch {} }
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

test("Morse Desktop: first run, opens Tunes with Morse, disconnects, connects again, asks before restarting it, stays in the tray", { skip, timeout: 300000 }, async () => {
  const { exe } = await tunesApp();
  const profile = path.join(home, "tunes-profile");
  await fs.writeFile(path.join(home, "desktop.json"), JSON.stringify({ autoOpen: false, apps: [exe], appArgs: { tunes: [`--user-data-dir=${profile}`, ...ROOT] } }));

  electronApp = await _electron.launch({
    executablePath: electronExe,
    args: [path.join(root, "desktop-app"), ...ROOT],
    // MORSE_PIPE=0: Tunes on a debugging port (the fallback), so this test can
    // look inside it. The private pipe, the default, is the next test.
    env: { ...process.env, MORSE_HOME: home, MORSE_DESKTOP_SCAN: "0", MORSE_PROVIDER: "demo", ELECTRON_RUN_AS_NODE: "", MORSE_PIPE: "0" },
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
  assert.deepEqual(globals.morse, ["state", "refreshApps", "openApp", "openBar", "disconnectApp", "addApp", "modelChoices", "chooseModel", "checkModel", "setModOn", "deleteMod", "undeleteMod", "setAllModsOff", "runChecks", "setStartAtLogin", "setAutoOpen", "openLink", "finishWelcome", "installUpdate", "updateLater", "onChange"]);
  assert.equal(globals.frozen, true);
  for (const k of ["require", "process", "ipc", "electron", "Buffer"]) assert.equal(globals[k], "undefined", k);
  const prefs = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  // Fetching anything from the page is refused by the CSP (connect-src 'none').
  assert.equal(await w.evaluate(() => fetch("https://example.com/").then(() => "fetched", () => "refused")), "refused");

  // The first run: the name forms out of dots, then Begin; the AI Morse found
  // by itself; how it works; then an app to open. Tunes is offered.
  await w.locator("#first").waitFor({ timeout: 30000 });
  assert.equal(await w.locator(".app").isVisible(), false, "nothing else until the first app is opened");
  await w.waitForFunction(() => ["formed", "still"].includes(document.getElementById("first").dataset.phase), null, { timeout: 30000 });
  await w.click("#ob-begin");
  assert.match(await w.locator("#first-model").innerText(), /Morse will use Demo model/);
  await w.click("#ob-next");
  assert.match(await w.locator('.ob-step[data-ob="how"]').innerText(), /Open Morse[\s\S]*Point at something[\s\S]*Say what you want/);
  await w.keyboard.press("Enter"); // Enter goes on, as Continue does
  const first = w.locator('li[data-first-app="tunes"]');
  await first.waitFor({ timeout: 30000 });
  // Open with Morse, from the first screen: Tunes starts with Morse connected,
  // and the main window takes over for good.
  await first.getByRole("button", { name: "Open with Morse" }).click();
  await w.locator(".app").waitFor({ timeout: 90000 });
  assert.equal(await w.locator("#first").isVisible(), false);
  const row = w.locator('li[data-app="tunes"]');
  await rowState("connected", 90000);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, "desktop.json"), "utf8")).welcomed, true);
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

// The default: Morse Desktop opens Tunes on the private pipe
// (--remote-debugging-pipe), so Tunes has no debugging port at all. Without a
// port this test can't look inside Tunes (that is the point); what Morse does
// in the page over the pipe is in tests/electron.test.js. Here: no port,
// Disconnect then Connect reuses the pipe (same Tunes, no restart), and
// quitting Morse leaves Tunes running.
test("Morse Desktop on the private pipe: no debugging port, Connect again without a restart, Tunes outlives Morse", { skip, timeout: 300000 }, async () => {
  const home2 = tempDir("morse-desktop-pipe-");
  const { exe } = await tunesApp();
  const profile = path.join(home2, "tunes-profile");
  await fs.writeFile(path.join(home2, "desktop.json"), JSON.stringify({ autoOpen: false, welcomed: true, apps: [exe], appArgs: { tunes: [`--user-data-dir=${profile}`, ...ROOT] } }));
  const env = { ...process.env, MORSE_HOME: home2, MORSE_DESKTOP_SCAN: "0", MORSE_PROVIDER: "demo", ELECTRON_RUN_AS_NODE: "" };
  delete env.MORSE_PIPE;
  electronApp = await _electron.launch({ executablePath: electronExe, args: [path.join(root, "desktop-app"), ...ROOT], env, timeout: 60000 });
  const logs = [];
  for (const s of [electronApp.process().stdout, electronApp.process().stderr]) s?.on("data", d => logs.push(String(d)));
  const w = await electronApp.firstWindow();
  const row = w.locator('li[data-app="tunes"]');
  const rowState = async (state, timeout) => {
    try { await w.locator(`li[data-app="tunes"].${state}`).waitFor({ timeout }); }
    catch (e) { throw new Error(`Tunes' row never became "${state}". Morse said:\n${logs.join("").split("\n").filter(l => /\[morse\]/.test(l)).slice(-30).join("\n")}`, { cause: e }); }
  };
  const sessionFile = path.join(home2, "sessions", "tunes.json");
  const readSession = async () => JSON.parse(await fs.readFile(sessionFile, "utf8"));
  // Tunes' main process: the one with this profile and no --type=.
  const tunesPids = () => apps.listProcesses().filter(p => p.cmd.includes(profile) && !/\s--type=/.test(p.cmd) && /tunes/i.test(p.cmd.split(/\s/)[0])).map(p => p.pid);

  await w.waitForSelector("html[data-ready]", { timeout: 30000 });
  await rowState("closed", 30000);
  await row.getByRole("button", { name: "Open with Morse" }).click();
  await rowState("connected", 90000);
  const s1 = await until(async () => { const s = await readSession(); return s.state === "attached" && s.windows?.length && s; }, 30000, "the session file to show Tunes' windows");
  assert.equal(s1.transport, "pipe");
  assert.equal(s1.port, null, "no debugging port");
  const [pid] = tunesPids();
  assert.ok(pid, "Tunes is running");
  const cmd = apps.listProcesses().find(p => p.pid === pid).cmd;
  assert.match(cmd, /--remote-debugging-pipe/);
  assert.doesNotMatch(cmd, /--remote-debugging-port/);

  // Disconnect, then Connect: over the pipe Morse kept, to the same Tunes.
  await row.getByRole("button", { name: "Disconnect" }).click();
  await rowState("open-connectable", 30000);
  await until(async () => !(await fs.stat(sessionFile).catch(() => null)), 10000, "the session file to go");
  await row.getByRole("button", { name: "Connect" }).click();
  await rowState("connected", 60000);
  await until(async () => { const s = await readSession().catch(() => null); return s?.state === "attached" && s.windows?.length; }, 30000, "Tunes' windows again");
  assert.deepEqual(tunesPids(), [pid], "the same Tunes, not restarted");

  // Quit Morse while connected: Tunes keeps running, without Morse.
  const proc = electronApp.process();
  const exited = new Promise(r => proc.once("exit", r));
  await electronApp.evaluate(({ app }) => { app.quit(); }).catch(() => {});
  await Promise.race([exited, new Promise((_, no) => setTimeout(() => no(new Error("Morse didn't quit within 15 s")), 15000))]);
  electronApp = null;
  await until(async () => !(await fs.stat(sessionFile).catch(() => null)), 10000, "Tunes' session file to go");
  await new Promise(r => setTimeout(r, 3000));
  assert.deepEqual(tunesPids(), [pid], "Tunes is still running after Morse quit");
  for (const p of apps.listProcesses()) if (p.cmd.includes(home2)) try { process.kill(p.pid, "SIGKILL"); } catch {}
});
