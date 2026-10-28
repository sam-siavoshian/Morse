// Morse Desktop updates itself from the preview release, which every push to
// main rebuilds (.github/workflows/preview.yml). Electron's own updater needs a
// signed app on macOS, and Morse isn't signed yet, so this does it plainly:
//
//   1. at start, every 4 hours, and when Settings' Check for updates is pressed,
//      read the release's build.json; a different commit than this build's
//      (build-info.json) is an update
//   2. download this computer's file, and check it against SHA256SUMS
//   3. when no change is in progress, or when Morse quits: put the new copy in
//      place of this one and start it
//
// Check for updates reports the same check: up to date, an update, or that the
// preview release could not be read. Install update (the button next to an
// available update) downloads this computer's file, checks it, replaces this
// copy and starts it. It does not open a download page. A copy that isn't
// packaged does not download until that button is pressed. A computer with no
// published file is told so, and nothing is installed.
//
// macOS: the .zip, unpacked with ditto, replaces the Morse.app bundle. A file
// Node downloads gets no quarantine flag, so the new copy opens without
// Gatekeeper asking again. Windows: the installer runs silently (/S) and
// starts Morse again (--force-run). Linux: the AppImage file is replaced.
// Only packaged builds update; MORSE_NO_UPDATE=1 turns it off.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs, readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, renameSync, rmSync, mkdirSync, accessSync, constants } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo was renamed RRAA → Morse. GitHub still redirects the old address,
// and a client that stops at that redirect reads an HTML page as the build
// and reports that the check failed.
export const RELEASE = "https://github.com/sam-siavoshian/Morse/releases/download/preview";

// Where this file lives. fileURLToPath decodes spaces (%20); URL.pathname
// does not, so a copy installed under "Program Files" could not read
// build-info.json and treated every check as a new download.
export function moduleDir(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}
const EVERY = 4 * 60 * 60 * 1000;

// This computer's file in the release, or null where Morse can't update itself.
export function assetFor(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return arch === "arm64" ? "Morse-mac-arm64.zip" : "Morse-mac-x64.zip";
  if (platform === "win32") return arch === "arm64" ? "Morse-Setup-arm64.exe" : "Morse-Setup.exe";
  if (platform === "linux" && arch === "x64") return "Morse-linux-x86_64.AppImage";
  return null;
}

// "<sha256>  <name>" lines, as sha256sum writes them.
export function parseSums(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

// A version string safe to show. Anything else is left out, never printed.
export function versionOf(info) {
  const v = String(info?.version ?? "").trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]{1,32})?$/.test(v) ? v : "";
}

// A newer build is a different commit, made later than this one.
export function isNewer(remote, local) {
  if (!remote?.commit || !/^[0-9a-f]{7,40}$/i.test(remote.commit)) return false;
  if (!local?.commit) return true; // a build that doesn't know its commit takes the release's
  if (remote.commit === local.commit) return false;
  const r = Date.parse(remote.builtAt), l = Date.parse(local.builtAt);
  return !(r && l) || r > l;
}

// The .app bundle this process runs from (…/Morse.app/Contents/MacOS/Morse).
export function bundleOf(exe) {
  const i = exe.indexOf(".app/Contents/MacOS/");
  return i < 0 ? null : exe.slice(0, i + 4);
}

export function createUpdater({ app, getAppImage = () => "", busy = () => false, log = () => {}, onStatus = () => {}, fetchImpl = globalThis.fetch, env = process.env, here = moduleDir(import.meta.url), beforeExit = async () => {}, install = installUpdate, assetName } = {}) {
  const asset = assetName === undefined ? assetFor() : assetName;
  let local = null;
  try { local = JSON.parse(readFileSync(path.join(here, "build-info.json"), "utf8")); } catch {}
  let ready = null; // { file, remote } downloaded and checked, waiting for a quiet moment
  let timer = null, startup = null, idleTimer = null, installTimer = null, later = false, flight = null, stopped = false;
  // What the window shows (a dialog while it downloads and installs).
  let status = { phase: "idle" };
  const set = next => { status = next; try { onStatus(status); } catch {} };
  const enabled = () => app.isPackaged && !!asset && env.MORSE_NO_UPDATE !== "1";
  const dir = path.join(app.getPath("userData"), "updates");
  const report = log;
  log = message => {
    try { mkdirSync(dir, { recursive: true }); appendFileSync(path.join(dir, "updater.log"), `${new Date().toISOString()} ${message}\n`); } catch {}
    try { report(message); } catch {}
  };

  async function get(name, as = "text", progress = null) {
    // Follow redirects here. redirect:"follow" stops at the repo rename on
    // some runtimes, and the HTML it returns is not a build.
    let url = `${RELEASE}/${name}`;
    let r;
    for (let hop = 0; ; hop++) {
      r = await fetchImpl(url, { redirect: "manual", cache: "no-store" });
      const loc = r.headers?.get?.("location");
      if (r.status >= 300 && r.status < 400 && loc && hop < 5) { url = new URL(loc, url).href; continue; }
      break;
    }
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    if (as !== "buffer") return r.text();
    const total = +r.headers?.get?.("content-length") || 0;
    // No length (a redirect hop, or a host that omits it): still move the bar.
    if (!progress || !r.body?.getReader) return Buffer.from(await r.arrayBuffer());
    const reader = r.body.getReader(), parts = [];
    let got = 0, shown = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Copy now. A reader may reuse the same bytes for the next chunk;
      // copying later hashes the wrong file and the check says it failed.
      const chunk = Buffer.from(value);
      parts.push(chunk); got += chunk.length;
      const pct = total ? Math.min(99, Math.floor(got * 100 / total)) : Math.min(99, Math.floor(got / (2 * 1024 * 1024)));
      if (pct !== shown) { shown = pct; progress(pct); }
    }
    return Buffer.concat(parts);
  }

  // A check that started on its own says nothing when this copy is current.
  // A click that waited for it still needs a sentence.
  function reveal(result) {
    if (status.phase !== "idle" && status.phase !== "checking") return;
    if (result === "current") set({ phase: "current", version: versionOf(local) });
    else if (result === "off") set({ phase: "off" });
    else if (result === "available") set({ phase: "available", version: status.version || "", action: "install" });
    else set({ phase: "error" });
  }

  // user: Settings asked. Otherwise this is the check at start and every 4 hours.
  async function check(opts = {}) {
    const user = !!opts?.user;
    if (applying) return "installing";
    if (flight) {
      const result = await flight;
      if (user) reveal(result);
      return result;
    }
    if (!ready && enabled()) await restoreDownload();
    if (flight) {
      const result = await flight;
      if (user) reveal(result);
      return result;
    }
    if (ready) {
      if (user) later = false;
      scheduleInstall({ force: user });
      if (user) set({ phase: later ? "later" : "ready", commit: ready.remote.commit, version: versionOf(ready.remote) });
      return "ready";
    }
    if (!user && !enabled()) return "off";
    if (user && env.MORSE_NO_UPDATE === "1") { set({ phase: "off" }); return "off"; }
    flight = runCheck(user).finally(() => { flight = null; });
    return flight;
  }

  // The Install update button: download (if this computer has a file), check
  // it, replace this copy and start it. No page to open.
  async function downloadUpdate() {
    if (applying) return "installing";
    if (env.MORSE_NO_UPDATE === "1") { set({ phase: "off" }); return "off"; }
    if (!asset) { set({ phase: "error", reason: "unsupported", action: "install" }); return "unsupported"; }
    if (flight) await flight;
    if (!ready) await restoreDownload();
    if (!ready) {
      flight = runCheck(true, { force: true }).finally(() => { flight = null; });
      const result = await flight;
      if (result !== "ready") return result;
    }
    later = false;
    const ok = await apply({ relaunch: true });
    return ok ? "installing" : "failed";
  }

  async function runCheck(user, { force = false } = {}) {
    if (user) set({ phase: "checking" });
    try {
      const remote = JSON.parse(await get("build.json"));
      const version = versionOf(remote);
      // No commit we can compare: that is not "up to date".
      if (!/^[0-9a-f]{7,40}$/i.test(remote?.commit || "")) {
        if (user) set({ phase: "error" });
        return user ? "error" : "current";
      }
      if (!isNewer(remote, local)) {
        try { rmSync(path.join(dir, "attempt.json"), { force: true }); } catch {}
        if (user) set({ phase: "current", version: versionOf(local) || version });
        return "current";
      }
      // The last try at this exact build quit and came back as the same copy.
      // Downloading it again would loop. A click can try once more.
      if (!user && sameAttempt(remote)) {
        set({ phase: "failed" });
        return "failed";
      }
      // No file for this computer: say so. Never hand back an address to open.
      if (!asset) {
        if (user || force) set({ phase: "error", reason: "unsupported", version, action: "install" });
        return "unsupported";
      }
      // A clone reports the update and waits for Install update. A packaged app
      // downloads on this check. Either way the next step is install, not a page.
      if (!force && !app.isPackaged) {
        if (user) set({ phase: "available", version, commit: remote.commit, action: "install" });
        return "available";
      }
      const sums = parseSums(await get("SHA256SUMS"));
      const want = sums[asset];
      if (!want) { if (user || force) set({ phase: "error", ...(force ? { reason: "download" } : {}) }); return "missing"; }
      set({ phase: "downloading", percent: 0, commit: remote.commit, version, action: "install" });
      const data = await get(asset, "buffer", percent => set({ phase: "downloading", percent, commit: remote.commit, version, action: "install" }));
      const got = createHash("sha256").update(data).digest("hex");
      // A release being replaced can show the new SUMS beside an old file for a
      // minute: a mismatch is tried again at the next check, never installed.
      if (got !== want) { log(`update: ${asset} doesn't match SHA256SUMS yet; trying later`); set(user || force ? { phase: "error", reason: "mismatch", action: "install" } : { phase: "idle" }); return "mismatch"; }
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, asset);
      await fs.writeFile(file, data, { mode: 0o755 });
      ready = { file, remote: { ...remote, version }, sha256: want };
      await fs.writeFile(path.join(dir, "pending.json"), JSON.stringify({ remote: ready.remote, sha256: want }));
      log(`update: ${remote.commit.slice(0, 7)} downloaded`);
      set({ phase: later && !force ? "later" : "ready", commit: remote.commit, version, action: "install" });
      if (!force) scheduleInstall();
      return "ready";
    } catch (e) {
      log(`update: ${e.message}`);
      if (user || force) set({ phase: "error", ...(force || status.phase === "downloading" ? { reason: "download", action: "install" } : {}) });
      else if (status.phase === "downloading") set({ phase: "idle" });
      return "error";
    }
  }

  // The last install of this commit didn't stick: we came back as the old copy.
  function sameAttempt(remote) {
    try {
      const a = JSON.parse(readFileSync(path.join(dir, "attempt.json"), "utf8"));
      return a.commit === remote.commit && a.commit !== local?.commit && Date.now() - a.at < 30 * 60 * 1000;
    } catch { return false; }
  }

  // A verified download survives a restart; never trust the cache without hashing it.
  async function restoreDownload() {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(dir, "pending.json"), "utf8"));
      if (!isNewer(saved.remote, local)) {
        // The new build is running: remove staged app/archive copies, keeping logs.
        for (const name of [asset, "new", "pending.json", "attempt.json"]) await fs.rm(path.join(dir, name), { recursive: true, force: true });
        return;
      }
      const file = path.join(dir, asset);
      const sum = createHash("sha256").update(await fs.readFile(file)).digest("hex");
      if (sum !== saved.sha256) return;
      ready = { file, remote: saved.remote, sha256: sum };
      set({ phase: sameAttempt(saved.remote) ? "failed" : "ready", commit: saved.remote.commit, version: versionOf(saved.remote) });
    } catch {} // no cached download, or an incomplete write
  }

  // One countdown, even when window status updates repeatedly call idle().
  // Recheck activity at the deadline: a change may have started meanwhile.
  function scheduleInstall({ force = false, relaunch = true } = {}) {
    if (!ready || applying || installTimer || stopped || (!force && (later || sameAttempt(ready.remote)))) return false;
    installTimer = setTimeout(async () => {
      installTimer = null;
      if (!ready || applying || stopped || (!force && later)) return;
      try {
        if (await busy()) return;
        if (!ready || applying || stopped || (!force && later)) return;
        await apply({ relaunch });
      } catch (e) { log(`update: waiting for activity check (${e.message})`); }
    }, 1500);
    installTimer.unref?.();
    return true;
  }

  let applying = false;
  async function apply({ relaunch = true } = {}) {
    if (!ready || applying) return false;
    applying = true;
    clearTimeout(installTimer); installTimer = null;
    const update = ready;
    set({ phase: "installing", version: versionOf(update.remote), commit: update.remote.commit });
    try {
      // app.exit bypasses Electron's quit events. Run cleanup explicitly first.
      writeFileSync(path.join(dir, "attempt.json"), JSON.stringify({ commit: update.remote.commit, at: Date.now() }));
      await install({ app, file: update.file, dir, getAppImage, relaunch });
      await beforeExit();
      log(`update: installing ${update.remote.commit.slice(0, 7)}`);
      try { app.releaseSingleInstanceLock?.(); } catch {}
      app.exit(0);
      return true;
    } catch (e) {
      log(`update: couldn't install (${e.message}); keeping this version`);
      applying = false;
      const permanent = /not running from|has no app in it/i.test(String(e.message || ""));
      set({ phase: "failed", reason: permanent ? "notInstalled" : "install", error: e.message, action: "install" });
      return false;
    }
  }

  return {
    start() {
      if (!enabled() || timer) return;
      stopped = false;
      startup = setTimeout(() => { startup = null; check(); }, 5_000);
      startup.unref?.();
      timer = setInterval(check, EVERY);
      timer.unref?.();
      // Completion of a generation need not cause a window refresh.
      idleTimer = setInterval(() => scheduleInstall(), 5_000);
      idleTimer.unref?.();
    },
    stop() {
      stopped = true;
      clearTimeout(startup); clearTimeout(installTimer);
      clearInterval(timer); clearInterval(idleTimer);
      startup = installTimer = timer = idleTimer = null;
    },
    check,
    downloadUpdate,
    onQuit() {
      if (applying) return true;
      if (!ready) return false;
      void apply({ relaunch: false }).then(ok => { if (!ok) app.quit(); });
      return true;
    },
    idle: () => scheduleInstall(),
    installNow() {
      if (!ready) return false;
      later = false;
      return scheduleInstall({ force: true });
    },
    later() {
      later = true;
      clearTimeout(installTimer); installTimer = null;
      if (ready && !applying) set({ phase: "later", commit: ready.remote.commit, version: versionOf(ready.remote) });
      return true;
    },
    get status() { return status; },
    get ready() { return !!ready; },
    get local() { return local; },
  };
}

// Platform handoff, separate from scheduling so it can be exercised on fixture apps.
export async function installUpdate({ app, file, dir, getAppImage = () => "", relaunch = true, platform = process.platform, executable = process.execPath }) {
  const pid = String(process.pid);
  if (platform === "darwin") {
    const home = app.getPath("home");
    // A packaged app is replaced in place. Any other Mac copy (the Install
    // update button) lands in the home Applications folder, then opens.
    const dest = macInstallTarget(executable, home);
    const unpacked = path.join(dir, "new");
    rmSync(unpacked, { recursive: true, force: true });
    execFileSync("ditto", ["-x", "-k", file, unpacked]);
    const fresh = readdirApps(unpacked)[0];
    if (!fresh) throw new Error("the update has no app in it");
    const placed = placeMac(dir, fresh, dest, "cancel-app");
    // The helper is waiting before the swap. If moving the running app
    // kills this process, the helper still finishes and opens the new one.
    await wake(dir, macRelaunchScript, { MORSE_PID: pid, MORSE_DEST: placed.dest, MORSE_NEXT: placed.next, MORSE_OLD: placed.old, MORSE_CANCEL: placed.cancel, MORSE_RELAUNCH: relaunch ? "1" : "0" });
    try { swapInPlace(placed.dest, placed.next); }
    catch (err) {
      writeFileSync(placed.cancel, "1");
      const fallback = path.join(home, "Applications", "Morse.app");
      if (path.resolve(placed.dest) === path.resolve(fallback)) throw err;
      const again = placeMac(dir, fresh, fallback, "cancel-home");
      await wake(dir, macRelaunchScript, { MORSE_PID: pid, MORSE_DEST: again.dest, MORSE_NEXT: again.next, MORSE_OLD: again.old, MORSE_CANCEL: again.cancel, MORSE_RELAUNCH: relaunch ? "1" : "0" });
      try { swapInPlace(again.dest, again.next); }
      catch (e2) { writeFileSync(again.cancel, "1"); throw e2; }
    }
  } else if (platform === "win32") {
    // The NSIS installer waits for Morse to close, installs over it, and with --force-run starts it.
    await launchDetached(file, ["/S", ...(relaunch ? ["--force-run"] : [])], { detached: true, stdio: "ignore", windowsHide: true });
  } else {
    const target = getAppImage();
    if (!target) throw new Error("not running from an AppImage");
    await wake(dir, linuxSwapScript, { MORSE_PID: pid, MORSE_FRESH: file, MORSE_TARGET: target, MORSE_RELAUNCH: relaunch ? "1" : "0" });
  }
}

function readdirApps(dir) {
  try {
    const apps = readdirSync(dir).filter(n => n.endsWith(".app")).map(n => path.join(dir, n));
    // The zip also carries helper apps inside the real one. Only the top
    // Morse.app is the update. Prefer that name if several are unpacked.
    return apps.sort((a, b) => (path.basename(a) === "Morse.app" ? 0 : 1) - (path.basename(b) === "Morse.app" ? 0 : 1));
  } catch { return []; }
}

// Where the new Mac app should land. A running bundle that this user can
// change is replaced in place. Anything else (a disk image, a folder that
// can't be changed, or a copy that isn't the app) goes to the home Applications.
export function macInstallTarget(executable, home) {
  const bundle = bundleOf(executable);
  if (!bundle) return path.join(home, "Applications", "Morse.app");
  return installDest(bundle, home);
}

// A running copy opened from a disk image, or from a folder this user can't
// change, can't be replaced in place. Put the new one in the home Applications.
export function installDest(bundle, home) {
  let writable = false;
  try { accessSync(path.dirname(bundle), constants.W_OK); writable = true; } catch {}
  if (!bundle || bundle.includes("/AppTranslocation/") || !writable) return path.join(home, "Applications", "Morse.app");
  return bundle;
}

// Where the new app will land, the staged copy beside it, and a file the
// helper reads so a failed try is not opened.
function placeMac(folder, fresh, dest, cancelName) {
  const next = stageCopy(dest, fresh);
  const cancel = path.join(folder, `${cancelName}-${randomUUID()}`);
  rmSync(cancel, { force: true });
  return { dest, next, old: `${dest}.old`, cancel };
}

// A full copy of the new app, beside where it will land. ditto keeps the
// signature a plain copy would drop. The running app is not touched yet.
function stageCopy(dest, fresh) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const next = `${dest}.next`;
  rmSync(next, { recursive: true, force: true });
  execFileSync("ditto", [fresh, next]);
  return next;
}

// Move the current app aside and the staged copy into its place. A failure
// puts the current app back. Done in this process: a helper started as a
// child dies when Morse quits, which is what left the old copy in place.
export function swapInPlace(dest, next) {
  const old = `${dest}.old`;
  rmSync(old, { recursive: true, force: true });
  if (existsSync(dest)) renameSync(dest, old);
  try { renameSync(next, dest); }
  catch (e) {
    if (!existsSync(dest) && existsSync(old)) { try { renameSync(old, dest); } catch {} }
    throw e;
  }
  return old;
}

// Quitting Morse kills a child script. The outer shell starts the real work
// and exits; nohup keeps it. It only opens the app that is actually there.
export const macRelaunchScript = `#!/bin/bash
if [ "\${MORSE_UPDATE_INNER}" != 1 ]; then
  export MORSE_UPDATE_INNER=1
  nohup /bin/bash "$0" >>"\${MORSE_LOG:-/dev/null}" 2>&1 &
  if [ -n "$MORSE_STARTED" ]; then
    for ((i=0; i<100; i++)); do
      [ -f "$MORSE_STARTED" ] && exit 0
      sleep 0.05
    done
    exit 1
  fi
  exit 0
fi
[ -z "$MORSE_STARTED" ] || : > "$MORSE_STARTED"
while kill -0 "$MORSE_PID" 2>/dev/null; do sleep 0.2; done
sleep 0.5
if [ -f "$MORSE_CANCEL" ]; then exit 0; fi
# This process died before it could finish the swap. Finish it here.
if [ -n "$MORSE_NEXT" ] && [ -d "$MORSE_NEXT" ]; then
  rm -rf "$MORSE_OLD"
  if [ -d "$MORSE_DEST" ]; then mv "$MORSE_DEST" "$MORSE_OLD" || exit 1; fi
  mv "$MORSE_NEXT" "$MORSE_DEST" || { [ -d "$MORSE_DEST" ] || mv "$MORSE_OLD" "$MORSE_DEST"; exit 1; }
fi
if [ -n "$MORSE_OLD" ]; then rm -rf "$MORSE_OLD"; fi
if [ "$MORSE_RELAUNCH" = 1 ] && [ -d "$MORSE_DEST" ]; then
  open "$MORSE_DEST" --args --updated
fi
`;

export const linuxSwapScript = `#!/bin/bash
if [ "\${MORSE_UPDATE_INNER}" != 1 ]; then
  export MORSE_UPDATE_INNER=1
  nohup /bin/bash "$0" >>"\${MORSE_LOG:-/dev/null}" 2>&1 &
  if [ -n "$MORSE_STARTED" ]; then
    for ((i=0; i<100; i++)); do
      [ -f "$MORSE_STARTED" ] && exit 0
      sleep 0.05
    done
    exit 1
  fi
  exit 0
fi
[ -z "$MORSE_STARTED" ] || : > "$MORSE_STARTED"
while kill -0 "$MORSE_PID" 2>/dev/null; do sleep 0.2; done
sleep 0.5
next="$MORSE_TARGET.next"
old="$MORSE_TARGET.old"
cp "$MORSE_FRESH" "$next" && chmod +x "$next" || { rm -f "$next"; exit 1; }
if [ -e "$MORSE_TARGET" ]; then mv -f "$MORSE_TARGET" "$old" || exit 1; fi
mv -f "$next" "$MORSE_TARGET" || { [ -e "$MORSE_TARGET" ] || mv -f "$old" "$MORSE_TARGET"; exit 1; }
rm -f "$old" "$MORSE_FRESH"
if [ "$MORSE_RELAUNCH" = 1 ]; then
  "$MORSE_TARGET" --updated >/dev/null 2>&1 &
fi
`;

async function wake(folder, script, env) {
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `install-${path.basename(env.MORSE_CANCEL || "linux")}.sh`);
  const started = `${file}.started`;
  rmSync(started, { force: true });
  writeFileSync(file, script, { mode: 0o755 });
  await launchDetached("/bin/bash", [file], {
    detached: true,
    stdio: "ignore",
    env: {
      ...Object.fromEntries(["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY", "XDG_SESSION_TYPE", "LANG"].filter(k => process.env[k]).map(k => [k, process.env[k]])),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
      TMPDIR: process.env.TMPDIR || "/tmp",
      MORSE_LOG: path.join(folder, "install.log"),
      MORSE_STARTED: started,
      ...env,
    },
  }, true);
}

function launchDetached(file, args, options, waitForExit = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, options);
    child.once("error", reject);
    if (waitForExit) child.once("exit", code => {
      if (code === 0) { child.unref(); resolve(); }
      else reject(new Error(`Update helper exited with code ${code}`));
    });
    else child.once("spawn", () => { child.unref(); resolve(); });
  });
}
