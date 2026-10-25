// An app opened from Finder, the Dock or a desktop launcher gets the system's
// bare PATH (/usr/bin:/bin:/usr/sbin:/sbin on macOS), not the one a terminal
// sets up. Claude Code and Codex live in folders only that one has (Homebrew,
// npm, nvm, ~/.local/bin, ~/.claude/local), and both need `node` from there
// too. So the packaged app asks the person's login shell for its PATH once at
// start, and adds the usual install folders after it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARK = "__MORSE_PATH__";

// The PATH an interactive login shell would have, or "" if it can't be read.
export function loginShellPath({ shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), timeout = 4000 } = {}) {
  try {
    const out = execFileSync(shell, ["-ilc", `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"],
      // Keep shell start-up quiet and quick: no update prompts, no tmux.
      env: { ...process.env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTARTED: "true", TERM: "dumb" },
    });
    const m = out.split(MARK);
    return m.length >= 3 ? m[1].trim() : "";
  } catch { return ""; }
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

// The current PATH first (what Morse was started with wins), then the login
// shell's, then the common folders, each folder once.
export function fullPath({ current = process.env.PATH || "", shellPath = loginShellPath(), extra = commonBinDirs() } = {}) {
  const seen = new Set(), out = [];
  for (const d of [...current.split(path.delimiter), ...shellPath.split(path.delimiter), ...extra]) {
    if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out.join(path.delimiter);
}
