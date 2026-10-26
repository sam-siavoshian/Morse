// An app opened from Finder, the Dock or a desktop launcher gets the system's
// bare PATH (/usr/bin:/bin:/usr/sbin:/sbin on macOS), not the one a terminal
// sets up. Claude Code and Codex live in folders only that one has (Homebrew,
// npm, nvm, ~/.local/bin, ~/.claude/local), and both need `node` from there
// too. The packaged app keeps the last login-shell PATH it read and merges
// that (plus the usual install folders) as soon as it starts, then asks the
// login shell again in the background. It does not spawn a shell while this
// module is loading.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARK = "__MORSE_PATH__";

const shellArgs = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
const shellEnv = env => ({ ...env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTARTED: "true", TERM: "dumb" });
const shellOf = shell => shell || process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
const markedPath = out => { const m = String(out ?? "").split(MARK); return m.length >= 3 ? m[1].trim() : ""; };

// The PATH an interactive login shell would have, or "" if it can't be read.
// Synchronous: a packaged start must not call this while the module is loading
// (it can take the whole timeout). startShellPath probes in the background.
export function loginShellPath({ shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), timeout = 4000, env = process.env } = {}) {
  try {
    const out = execFileSync(shellOf(shell), ["-ilc", `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      ...shellArgs, timeout, env: shellEnv(env),
    });
    return markedPath(out);
  } catch { return ""; }
}

// The same probe, without blocking the caller. "" if the shell can't be read.
export function loginShellPathAsync({ shell, timeout = 4000, env = process.env } = {}) {
  return new Promise(resolve => {
    execFile(shellOf(shell), ["-ilc", `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      ...shellArgs, timeout, env: shellEnv(env),
    }, (err, out) => resolve(err ? "" : markedPath(out)));
  });
}

// The last login-shell PATH Morse wrote (userData/shell-path.json), or "".
export function readPathCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return typeof data?.path === "string" ? data.path : "";
  } catch { return ""; }
}

export function writePathCache(file, shellPath) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ path: shellPath, at: Date.now() }) + "\n");
  } catch { /* the next start probes again */ }
}

// Where Claude Code, Codex and Node usually are, newest nvm Node first.
export function commonBinDirs(home = os.homedir()) {
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local/bin"), path.join(home, ".claude/local"),
    path.join(home, ".npm-global/bin"), path.join(home, ".volta/bin"), path.join(home, ".bun/bin"), path.join(home, "Library/pnpm"),
    path.join(home, ".local/share/pnpm"), path.join(home, ".asdf/shims"), path.join(home, ".local/share/mise/shims")];
  try {
    const nvm = path.join(home, ".nvm/versions/node");
    const versions = readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) dirs.push(path.join(nvm, v, "bin"));
  } catch {}
  return dirs.filter(d => existsSync(d));
}

// The current PATH first (what Morse was started with wins), then a login
// shell's PATH when one was passed, then the common folders, each folder once.
// shellPath defaults to nothing: calling this must not spawn a login shell.
export function fullPath({ current = process.env.PATH || "", shellPath = "", extra = commonBinDirs() } = {}) {
  const seen = new Set(), out = [];
  for (const d of [...current.split(path.delimiter), ...String(shellPath || "").split(path.delimiter), ...extra]) {
    if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out.join(path.delimiter);
}

// Packaged Mac/Linux: merge a cached login PATH (or just the usual folders)
// into env.PATH now, and refresh the login shell in the background. The
// returned promise waits for that probe only when there was no cache, so
// model detection can wait instead of looking on the bare PATH. Windows and
// an unpackaged run (a terminal already has the PATH) do nothing.
export function startShellPath({
  packaged = false, platform = process.platform, cacheFile = "", env = process.env,
  probe = loginShellPathAsync, extra = null,
} = {}) {
  if (!packaged || platform === "win32") return Promise.resolve();
  const current = env.PATH || "";
  const bins = extra || commonBinDirs();
  const cached = cacheFile ? readPathCache(cacheFile) : "";
  env.PATH = fullPath({ current, shellPath: cached, extra: bins });
  const pending = Promise.resolve()
    .then(() => probe({ env: { ...env, PATH: current } }))
    .then(shellPath => {
      if (!shellPath) return;
      env.PATH = fullPath({ current, shellPath, extra: bins });
      if (cacheFile) writePathCache(cacheFile, shellPath);
    })
    .catch(() => {});
  return cached ? Promise.resolve() : pending;
}
