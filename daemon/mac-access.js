// macOS App Management, the blue hand in Privacy & Security:
// "Morse" was prevented from modifying apps on your Mac.
//
// Morse opens a browser by running the program inside the app
// (daemon/apps.js). macOS then charges that browser's own updates to Morse.
// The first time, it shows the notification. The person allows it once.
//
// The allow applies to this program only. Two mistakes make it look like the
// allow never sticks:
//   - restarting before the allow is committed, or restarting as a different
//     unsigned program (a copy, a new ad hoc signature), so the next process
//     is not the one the person allowed
//   - reading "not yet determined" as "denied", so a grant (preflight 0) is
//     never treated as a grant and the privileged try runs again
//
// After one allow, the next open of that browser proceeds. It does not ask
// again and it does not restart again. If macOS still refuses, the next press
// of Open with Morse starts the app anyway: a banner in place of that start
// never opens it and never asks again. Nothing here writes the TCC database,
// turns off SIP, or grants the allow by itself.

import { spawn } from "node:child_process";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { HOME } from "./store.js";

export const GRANTED = "granted";
export const DENIED = "denied";
export const NOT_DETERMINED = "notDetermined";

// TCCAccessPreflight(kTCCServiceSystemPolicyAppBundles):
//   0 granted, 1 denied, 2 not determined.
// A grant is only 0. 2 is not a refusal, and it is not a grant.
export function statusFromPreflight(code) {
  if (code === 0 || code === GRANTED) return GRANTED;
  if (code === 1 || code === DENIED) return DENIED;
  if (code === 2 || code === NOT_DETERMINED) return NOT_DETERMINED;
  return null; // unreadable: don't invent a restart loop
}

export function sameProgram(a, b) {
  if (!a || !b || a.copy || b.copy) return false;
  return a.exe === b.exe && a.bundle === b.bundle && a.dev === b.dev;
}

// The only restart that keeps the allow: the bundle this process is already
// running, not a copy and not a translocated one (that path changes every open).
export function relaunchPlan(program) {
  if (!program || program.copy || !program.bundle || !program.exe) return null;
  if (!program.exe.startsWith(program.bundle + "/")) return null;
  if (/AppTranslocation|\/private\/var\/folders\//.test(program.bundle)) return null;
  return { bundle: program.bundle, exe: program.exe };
}

const WAITING = "macOS asked to let Morse modify the apps it opens. Allow it in the notification, then open the app with Morse again.";
const RESTARTING = "Morse is restarting so that allow can take effect. Open the app with Morse again.";
const REFUSED = "macOS is still blocking Morse from modifying other apps. Allow Morse in System Settings, under Privacy & Security, then App Management, and try once more.";

// What to do before Morse opens another app. `saved` is what survived the
// last restart: asked, pickedUp, told, recorded (the program the allow was for).
export function decideMacAccess({ status, program, saved = {} }) {
  const st = statusFromPreflight(status);
  if (st == null) return { action: "proceed" };

  if (st === GRANTED) {
    // The allow is visible for this process. Open, unless this is still the
    // process that was blocked: then restart the same program once, and only
    // now that the allow is committed.
    if (saved.asked && !saved.pickedUp) {
      const plan = relaunchPlan(program);
      if (plan) return { action: "restart", plan, message: RESTARTING, record: program, markPickedUp: true };
    }
    return { action: "proceed", record: program?.copy ? undefined : program };
  }

  if (st === DENIED) {
    // A refusal is not "not yet asked". Don't restart to ask again.
    // openPlan still starts the app: the press is the retry.
    return { action: "tell", message: REFUSED, markTold: !saved.told };
  }

  // Not determined. Not a refusal.
  if (saved.pickedUp) {
    // We already restarted after an allow and macOS still hasn't granted this
    // process. Don't ask again and don't restart again. The opener still
    // starts the app (openPlan).
    return { action: "tell", message: REFUSED, markTold: !saved.told };
  }
  if (!saved.asked) return { action: "request", markAsked: true };
  // Asked, and the allow is not visible yet. Don't restart. The opener still
  // starts the app: that press is the retry, and starting the app is the ask.
  return { action: "wait", message: WAITING };
}

// What Open with Morse does with a decision. A missing executable is that
// error, before anything is quit and before App Management is consulted.
// restart: the allow is committed and this process has not picked it up.
// Every other decision starts the app. Starting it is what makes macOS ask,
// so a wait or a denial must not be a banner that skips the start.
export function openPlan({ decision, missing = "" } = {}) {
  if (missing) return { launch: false, message: missing };
  if (decision?.action === "restart" && decision.plan) {
    return { launch: false, restart: true, plan: decision.plan, message: decision.message };
  }
  return { launch: true };
}

// One Open, in order. The restart question is not an ask. A missing binary
// is said first, so a running app is left running.
export function openSequence({ running = false, confirmed = false, missing = "", decision = null } = {}) {
  if (missing) return { step: "error", message: missing };
  if (running && !confirmed) return { step: "askRestart" };
  const plan = openPlan({ decision });
  if (plan.restart) return { step: "restartMorse", message: plan.message, plan: plan.plan };
  if (!plan.launch) return { step: "error", message: plan.message };
  return { step: running ? "quitAndLaunch" : "launch" };
}

// `decide` runs only when this press will start the app. The restart question
// and a missing binary do not record an ask.
export async function prepareAppOpen({ running = false, confirmed = false, missing = "", decide } = {}) {
  let decision = null;
  if (!missing && (!running || confirmed) && typeof decide === "function") decision = await decide();
  return openSequence({ running, confirmed, missing, decision });
}

export function memoryStore(initial = {}) {
  let data = { ...initial };
  return {
    async load() { return { ...data }; },
    async save(patch) { data = { ...data, ...patch }; return { ...data }; },
  };
}

export function fileStore(file) {
  return {
    async load() {
      try { return JSON.parse(await fs.readFile(file, "utf8")) || {}; } catch { return {}; }
    },
    async save(patch) {
      const next = { ...(await this.load()), ...patch };
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next));
      await fs.rename(tmp, file);
      return next;
    },
  };
}

export function macAccessFile(home = HOME) {
  return path.join(home, "mac-access.json");
}

// The running Morse app, or null (the terminal, tests, Linux).
// dev is the file's identity: a copy or a rewritten binary is a different one.
// The packaged binary is Morse.app/Contents/MacOS/Morse (electron-builder executableName).
export function desktopProgram(exe = process.execPath, stat = statSync) {
  if (process.platform !== "darwin" || !/\/Morse$/.test(exe)) return null;
  const i = exe.indexOf(".app/Contents/MacOS/");
  if (i < 0) return null;
  const bundle = exe.slice(0, i + 4);
  let dev = "unknown", copy = /AppTranslocation|\/private\/var\/folders\//.test(bundle);
  try {
    const st = stat(exe);
    dev = `${st.dev}:${st.ino}:${st.size}`;
  } catch { copy = true; }
  return { bundle, exe, dev, copy };
}

export function createMacAccess({ program, readStatus, store }) {
  return {
    async beforeOpen() {
      const saved = await store.load();
      const status = await readStatus();
      const d = decideMacAccess({ status, program: program(), saved });
      const patch = {};
      if (d.markAsked) patch.asked = true;
      if (d.markTold) patch.told = true;
      if (d.markPickedUp) patch.pickedUp = true;
      if (d.record) patch.recorded = { exe: d.record.exe, bundle: d.record.bundle, dev: d.record.dev };
      if (d.action === "request" || d.action === "proceed") patch.told = false;
      if (Object.keys(patch).length) await store.save(patch);
      return d;
    },
  };
}

// Reads the allow. Null when it can't be read (don't guess). Cached briefly:
// opening an app checks once, not once per retry.
let cachedStatus = null;
export async function readAppManagementStatus({ run = runPreflight, now = () => Date.now(), ttl = 1500 } = {}) {
  if (cachedStatus && now() - cachedStatus.at < ttl) return cachedStatus.value;
  const value = await run().catch(() => null);
  cachedStatus = { at: now(), value };
  return value;
}
export function clearAppManagementCache() { cachedStatus = null; }

// The service name is the string macOS checks. Reading the exported symbol
// with assumingMemoryBound(to: CFString.self) does not load that string, so
// preflight stays "not determined" after the person has allowed Morse, and
// Open with Morse shows the waiting banner instead of starting the app.
export const APP_MANAGEMENT_SERVICE = "kTCCServiceSystemPolicyAppBundles";

// Prints the preflight result, or nothing when the symbol isn't there.
// 0 granted, 1 denied, 2 not determined.
export const PREFLIGHT_SWIFT = `import Foundation
let path = "/System/Library/PrivateFrameworks/TCC.framework/TCC"
guard let handle = dlopen(path, RTLD_LAZY),
      let preflightSym = dlsym(handle, "TCCAccessPreflight") else { exit(0) }
typealias Fn = @convention(c) (CFString, CFDictionary?) -> Int32
let preflight = unsafeBitCast(preflightSym, to: Fn.self)
print(preflight("${APP_MANAGEMENT_SERVICE}" as CFString, nil))
`;

function runPreflight() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise(resolve => {
    let child;
    try { child = spawn("swift", ["-"], { stdio: ["pipe", "pipe", "ignore"] }); }
    catch { resolve(null); return; }
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.stdout?.on("data", d => { out += d; });
    child.on("close", () => {
      clearTimeout(timer);
      const text = String(out).trim();
      // An empty failure is unreadable, not a grant. A grant is the digit 0.
      resolve(/^-?\d+$/.test(text) ? Number(text) : null);
    });
    child.stdin?.end(PREFLIGHT_SWIFT);
  });
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Quit this Morse and open the same bundle. The waiter starts the bundle only
// after this process is gone, so the new one is the program the person allowed.
export function relaunchDesktop(plan, { spawnImpl = spawn, pid = process.pid, quit = defaultQuit } = {}) {
  if (!plan?.bundle || !Number.isInteger(pid)) return Promise.resolve(false);
  const script = `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done\nopen ${shQuote(plan.bundle)}\n`;
  const child = spawnImpl("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" });
  child.unref?.();
  return Promise.resolve(quit()).then(() => true, () => true);
}

async function defaultQuit() {
  try {
    const { app } = await import("electron");
    app.quit();
  } catch {
    process.exit(0);
  }
}
