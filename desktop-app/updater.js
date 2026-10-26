// Morse Desktop updates itself from the preview release, which every push to
// main rebuilds (.github/workflows/preview.yml). Electron's own updater needs a
// signed app on macOS, and Morse isn't signed yet, so this does it plainly:
//
//   1. at start, every 4 hours, and when Settings' Check for updates is pressed,
//      read the release's build.json; a different commit than this build's
//      (build-info.json) is an update
//   2. download this computer's file, and check it against SHA256SUMS
//   3. when no app is connected, or when Morse quits: put the new copy in
//      place of this one and start it
//
// The button reports the same check: up to date, an update (then the download
// above), or that the preview release could not be read. A copy that isn't
// packaged reports the result and does not download.
//
// macOS: the .zip, unpacked with ditto, replaces the Morse.app bundle. A file
// Node downloads gets no quarantine flag, so the new copy opens without
// Gatekeeper asking again. Windows: the installer runs silently (/S) and
// starts Morse again (--force-run). Linux: the AppImage file is replaced.
// Only packaged builds update; MORSE_NO_UPDATE=1 turns it off.
import { createHash } from "node:crypto";
import { promises as fs, readFileSync, writeFileSync, readdirSync, existsSync, renameSync, rmSync, mkdirSync, accessSync, constants } from "node:fs";
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

export function createUpdater({ app, getAppImage = () => "", busy = () => false, log = () => {}, onStatus = () => {}, fetchImpl = globalThis.fetch, env = process.env, here = moduleDir(import.meta.url), wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const asset = assetFor();
  let local = null;
  try { local = JSON.parse(readFileSync(path.join(here, "build-info.json"), "utf8")); } catch {}
  let ready = null; // { file, remote } downloaded and checked, waiting for a quiet moment
  let timer = null, later = false, flight = null;
  // What the window shows (a dialog while it downloads and installs).
  let status = { phase: "idle" };
  const set = next => { status = next; try { onStatus(status); } catch {} };
  const enabled = () => app.isPackaged && !!asset && env.MORSE_NO_UPDATE !== "1";
  const dir = path.join(app.getPath("userData"), "updates");

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
    else if (result === "available") set({ phase: "available", version: "" });
    else set({ phase: "error" });
  }

  // user: Settings asked. Otherwise this is the check at start and every 4 hours.
  async function check(opts = {}) {
    const user = !!opts?.user;
    if (flight) {
      const result = await flight;
      if (user) reveal(result);
      return result;
    }
    if (ready) {
      if (user) set({ phase: later ? "later" : "ready", commit: ready.remote.commit, version: versionOf(ready.remote) });
      return "ready";
    }
    if (!user && !enabled()) return "off";
    if (user && env.MORSE_NO_UPDATE === "1") { set({ phase: "off" }); return "off"; }
    flight = runCheck(user).finally(() => { flight = null; });
    return flight;
  }

  async function runCheck(user) {
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
      // A clone, or a computer with no installer: say a newer one is published.
      // Only a packaged app downloads it.
      if (!enabled()) {
        if (user) set({ phase: "available", version, commit: remote.commit });
        return "available";
      }
      const sums = parseSums(await get("SHA256SUMS"));
      const want = sums[asset];
      if (!want) { if (user) set({ phase: "error" }); return "missing"; }
      set({ phase: "downloading", percent: 0, commit: remote.commit, version });
      const data = await get(asset, "buffer", percent => set({ phase: "downloading", percent, commit: remote.commit, version }));
      const got = createHash("sha256").update(data).digest("hex");
      // A release being replaced can show the new SUMS beside an old file for a
      // minute: a mismatch is tried again at the next check, never installed.
      if (got !== want) { log(`update: ${asset} doesn't match SHA256SUMS yet; trying later`); set({ phase: user ? "error" : "idle" }); return "mismatch"; }
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, asset);
      await fs.writeFile(file, data, { mode: 0o755 });
      ready = { file, remote: { ...remote, version } };
      log(`update: ${remote.commit.slice(0, 7)} downloaded`);
      // Nothing connected: install now. Apps connected: ask (they lose their
      // mods until they are opened with Morse again), or install at quit.
      if (!busy()) { set({ phase: "installing", version }); await wait(1500); apply(); }
      else set({ phase: later ? "later" : "ready", commit: remote.commit, version });
      return "ready";
    } catch (e) {
      log(`update: ${e.message}`);
      if (user) set({ phase: "error" });
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

  // Put the new copy in place and start it. Runs once; Morse quits after.
  // The swap happens in this process, before quit. A helper that only opens
  // the new copy used to do the swap, and it died with Morse, so the old
  // copy opened again and the download started over.
  let applying = false;
  function apply({ relaunch = true } = {}) {
    if (!ready || applying) return false;
    applying = true;
    const pid = String(process.pid);
    try {
      try { writeFileSync(path.join(dir, "attempt.json"), JSON.stringify({ commit: ready.remote.commit, at: Date.now() })); } catch {}
      if (process.platform === "darwin") {
        const bundle = bundleOf(process.execPath);
        if (!bundle) throw new Error("not running from an app bundle");
        const unpacked = path.join(dir, "new");
        execFileSync("ditto", ["-x", "-k", ready.file, unpacked]);
        const fresh = readdirApps(unpacked)[0];
        if (!fresh) throw new Error("the update has no app in it");
        const home = app.getPath("home");
        const placed = placeMac(dir, fresh, installDest(bundle, home), "cancel-app");
        // The helper is waiting before the swap. If moving the running app
        // kills this process, the helper still finishes and opens the new one.
        wake(dir, macRelaunchScript, { MORSE_PID: pid, MORSE_DEST: placed.dest, MORSE_NEXT: placed.next, MORSE_OLD: placed.old, MORSE_CANCEL: placed.cancel, MORSE_RELAUNCH: relaunch ? "1" : "0" });
        try { swapInPlace(placed.dest, placed.next); }
        catch (err) {
          writeFileSync(placed.cancel, "1");
          const fallback = path.join(home, "Applications", "Morse.app");
          if (path.resolve(placed.dest) === path.resolve(fallback)) throw err;
          const again = placeMac(dir, fresh, fallback, "cancel-home");
          wake(dir, macRelaunchScript, { MORSE_PID: pid, MORSE_DEST: again.dest, MORSE_NEXT: again.next, MORSE_OLD: again.old, MORSE_CANCEL: again.cancel, MORSE_RELAUNCH: relaunch ? "1" : "0" });
          try { swapInPlace(again.dest, again.next); }
          catch (e2) { writeFileSync(again.cancel, "1"); throw e2; }
        }
      } else if (process.platform === "win32") {
        // The NSIS installer waits for Morse to close, installs over it, and with --force-run starts it.
        spawn(ready.file, ["/S", ...(relaunch ? ["--force-run"] : [])], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      } else {
        const target = getAppImage();
        if (!target) throw new Error("not running from an AppImage");
        wake(dir, linuxSwapScript, { MORSE_PID: pid, MORSE_FRESH: ready.file, MORSE_TARGET: target, MORSE_RELAUNCH: relaunch ? "1" : "0" });
      }
      log(`update: installing ${ready.remote.commit.slice(0, 7)}`);
      // Let the helper detach, then quit. exit skips the quit handler, which
      // would start a second install.
      setTimeout(() => { try { app.releaseSingleInstanceLock?.(); } catch {} app.exit(0); }, 700);
      return true;
    } catch (e) {
      log(`update: couldn't install (${e.message}); keeping this version`);
      ready = null; applying = false;
      set({ phase: "failed", error: e.message });
      return false;
    }
  }

  return {
    start() {
      if (!enabled()) return;
      setTimeout(check, 5_000).unref?.();
      timer = setInterval(() => { if (ready && !busy()) apply(); else check(); }, EVERY);
      timer.unref?.();
    },
    stop() { clearInterval(timer); },
    check,
    // Morse is quitting: install now, without opening it again.
    // Already installing: say so, so quit doesn't start a second copy.
    onQuit() { if (applying) return true; return ready ? apply({ relaunch: false }) : false; },
    // An app was disconnected: if nothing else is connected, now is a good time.
    idle() { if (ready && !applying && !busy()) { set({ phase: "installing" }); setTimeout(() => apply(), 1500); } },
    // The window's buttons: Restart now, or Later (installs when Morse quits).
    installNow() { if (!ready) return false; set({ phase: "installing" }); setTimeout(() => apply(), 800); return true; },
    later() { later = true; if (ready) set({ phase: "later", commit: ready.remote.commit, version: versionOf(ready.remote) }); return true; },
    get status() { return status; },
    get ready() { return !!ready; },
    get local() { return local; },
  };
}

function readdirApps(dir) {
  try {
    const apps = readdirSync(dir).filter(n => n.endsWith(".app")).map(n => path.join(dir, n));
    // The zip also carries helper apps inside the real one. Only the top
    // Morse.app is the update. Prefer that name if several are unpacked.
    return apps.sort((a, b) => (path.basename(a) === "Morse.app" ? 0 : 1) - (path.basename(b) === "Morse.app" ? 0 : 1));
  } catch { return []; }
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
  const cancel = path.join(folder, cancelName);
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
  exit 0
fi
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
  exit 0
fi
while kill -0 "$MORSE_PID" 2>/dev/null; do sleep 0.2; done
sleep 0.5
mv -f "$MORSE_FRESH" "$MORSE_TARGET" && chmod +x "$MORSE_TARGET" || exit 1
if [ "$MORSE_RELAUNCH" = 1 ]; then
  "$MORSE_TARGET" --updated >/dev/null 2>&1 &
fi
`;

function wake(folder, script, env) {
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "install.sh");
  writeFileSync(file, script, { mode: 0o755 });
  const child = spawn("/bin/bash", [file], {
    detached: true,
    stdio: "ignore",
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
      TMPDIR: process.env.TMPDIR || "/tmp",
      MORSE_LOG: path.join(folder, "install.log"),
      ...env,
    },
  });
  child.unref();
}
