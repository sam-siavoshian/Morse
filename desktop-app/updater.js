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
import { promises as fs, readFileSync, readdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";

export const RELEASE = "https://github.com/sam-siavoshian/RRAA/releases/download/preview";
const EVERY = 4 * 60 * 60 * 1000;

// This computer's file in the release, or null where Morse can't update itself.
export function assetFor(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return arch === "arm64" ? "Morse-mac-arm64.zip" : "Morse-mac-x64.zip";
  if (platform === "win32") return "Morse-Setup.exe";
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

export function createUpdater({ app, getAppImage = () => "", busy = () => false, log = () => {}, onStatus = () => {}, fetchImpl = globalThis.fetch, env = process.env, here = path.dirname(new URL(import.meta.url).pathname), wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
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
    const r = await fetchImpl(`${RELEASE}/${name}`, { redirect: "follow", cache: "no-store" });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    if (as !== "buffer") return r.text();
    const total = +r.headers?.get?.("content-length") || 0;
    if (!progress || !r.body?.getReader || !total) return Buffer.from(await r.arrayBuffer());
    const reader = r.body.getReader(), parts = [];
    let got = 0, shown = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      const pct = Math.min(99, Math.floor(got * 100 / total));
      if (pct !== shown) { shown = pct; progress(pct); }
    }
    return Buffer.concat(parts.map(p => Buffer.from(p)));
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
        if (user) set({ phase: "current", version: versionOf(local) || version });
        return "current";
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

  // Put the new copy in place and start it. Runs once; Morse quits after.
  let applying = false;
  function apply({ relaunch = true } = {}) {
    if (!ready || applying) return false;
    applying = true;
    const pid = process.pid;
    try {
      if (process.platform === "darwin") {
        const bundle = bundleOf(process.execPath);
        if (!bundle) throw new Error("not running from an app bundle");
        const unpacked = path.join(dir, "new");
        execFileSync("ditto", ["-x", "-k", ready.file, unpacked]);
        const fresh = readdirApps(unpacked)[0];
        if (!fresh) throw new Error("the update has no app in it");
        // A small script waits for this Morse to quit, swaps the bundle, opens the new one.
        const script = `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
rm -rf "${bundle}.old" && mv "${bundle}" "${bundle}.old" && mv "${fresh}" "${bundle}" && rm -rf "${bundle}.old" || { [ -d "${bundle}" ] || mv "${bundle}.old" "${bundle}"; }
${relaunch ? `open "${bundle}" --args --updated` : ""}`;
        spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "win32") {
        // The NSIS installer waits for Morse to close, installs over it, and with --force-run starts it.
        spawn(ready.file, ["/S", ...(relaunch ? ["--force-run"] : [])], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      } else {
        const target = getAppImage();
        if (!target) throw new Error("not running from an AppImage");
        const script = `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
mv -f "${ready.file}" "${target}" && chmod +x "${target}"
${relaunch ? `"${target}" --updated >/dev/null 2>&1 &` : ""}`;
        spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
      }
      log(`update: installing ${ready.remote.commit.slice(0, 7)}`);
      app.exit(0);
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
    onQuit() { return ready ? apply({ relaunch: false }) : false; },
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
  try { return readdirSync(dir).filter(n => n.endsWith(".app")).map(n => path.join(dir, n)); } catch { return []; }
}
