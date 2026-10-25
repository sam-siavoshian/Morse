// What the install line (install.sh, install.ps1) put on this computer, read
// from the record it leaves in the Morse folder (~/.morse/install.txt):
//
//   app=<folder>         Morse itself (~/.morse/app)
//   extension=<folder>   older installs only: the Chrome extension's folder
//                        (~/.morse/chrome-extension), which Morse no longer has
//   shim=<file>          the `morse` command it added
//   path_added=<folder>  Windows only: the folder it added to your PATH, if any
//
// `morse uninstall` removes exactly what is listed, nothing else: your mods and settings stay
// unless you say --all. A Morse from npm or from a clone has no record.

import { promises as fs, existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOME } from "./store.js";

export const RECEIPT = path.join(HOME, "install.txt");
// The first line of every file the install line writes. Only a file that
// says so is removed.
export const MARK = "Morse: added by the install line";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseReceipt(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function readReceipt(file = RECEIPT) {
  try { return parseReceipt(readFileSync(file, "utf8")); } catch { return null; }
}

const real = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
const inside = (dir, p) => { const r = path.relative(real(dir), real(p)); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

// This Morse was put here by the install line (and not, say, a clone that
// happens to share the Morse folder).
export function installedHere(receipt = readReceipt(), root = ROOT) {
  return !!(receipt?.app && real(receipt.app) === real(root));
}

// What `morse uninstall` would remove: [{ what, path }].
export function uninstallPlan({ receipt = readReceipt(), all = false, home = HOME } = {}) {
  if (!receipt) return null;
  const plan = [];
  if (receipt.shim && existsSync(receipt.shim) && isOurs(receipt.shim)) plan.push({ what: "the morse command", path: receipt.shim });
  for (const [key, what] of [["app", "Morse"], ["extension", "the Chrome extension folder"]]) {
    // Only folders inside the Morse folder, whatever the record says.
    if (receipt[key] && existsSync(receipt[key]) && inside(home, receipt[key])) plan.push({ what, path: receipt[key] });
  }
  if (receipt.path_added) plan.push({ what: "its folder in your PATH", path: receipt.path_added, pathEntry: true });
  if (all) plan.push({ what: "your mods and settings (the whole Morse folder)", path: home });
  else plan.push({ what: "the install record", path: path.join(home, "install.txt") });
  return plan;
}

function isOurs(file) {
  try { return readFileSync(file, "utf8").slice(0, 400).includes(MARK); } catch { return false; }
}

// Windows: take the folder back out of the user's PATH (the install line added it).
function removeFromUserPath(dir) {
  const script = "$d=$env:MORSE_DIR; $p=[Environment]::GetEnvironmentVariable('Path','User'); if ($p) { $n=($p -split ';' | Where-Object { $_ -and ($_.TrimEnd('\\') -ne $d.TrimEnd('\\')) }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$n,'User') }";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, MORSE_DIR: dir }, stdio: "ignore", windowsHide: true });
}

function removeLater(file) {
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", `ping -n 3 127.0.0.1 >nul & del /f /q "${file}"`],
    { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
  child.unref();
}

export async function removePlan(plan, { platform = process.platform } = {}) {
  const failed = [];
  for (const step of plan) {
    try {
      if (step.pathEntry) { if (platform === "win32") removeFromUserPath(step.path); continue; }
      // Windows runs `morse` through morse.cmd, which cmd.exe still reads after
      // node exits: deleting it now ends the command with "The batch file
      // cannot be found" and a failure. A hidden cmd deletes it a moment later.
      if (platform === "win32" && /\.cmd$/i.test(step.path)) { removeLater(step.path); continue; }
      await fs.rm(step.path, { recursive: true, force: true });
    } catch (e) { failed.push({ ...step, error: e.message }); }
  }
  return failed;
}

// `morse uninstall [--all] [--yes]`
export async function uninstallCli(f, { input = process.stdin, say = s => console.log(s) } = {}) {
  const receipt = readReceipt();
  if (!receipt) {
    const clone = existsSync(path.join(ROOT, ".git"));
    say(clone
      ? `This Morse runs from a folder you cloned (${ROOT}). Delete that folder to remove it.`
      : ROOT.split(path.sep).includes("node_modules")
        ? "This Morse came from npm. Remove it with: npm uninstall -g morse-cli"
        : "Morse wasn't installed with the install line, so there is nothing for this command to remove.");
    process.exitCode = 1;
    return;
  }
  const plan = uninstallPlan({ receipt, all: !!f.all });
  say("This removes:");
  for (const s of plan) say(`  ${s.what}: ${s.path}`);
  if (!f.all) say(`Your mods and settings stay in ${HOME}. To remove them too: morse uninstall --all`);
  if (!f.yes) {
    if (!input.isTTY) { say("Nothing removed. Add --yes to remove it without a question."); process.exitCode = 1; return; }
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input, output: process.stdout });
    const a = (await rl.question("Remove Morse? [y/N] ")).trim().toLowerCase();
    rl.close();
    if (a !== "y" && a !== "yes") { say("Nothing removed."); return; }
  }
  const failed = await removePlan(plan);
  for (const s of failed) say(`Couldn't remove ${s.path}: ${s.error}`);
  if (failed.length) { process.exitCode = 1; return; }
  say(receipt.extension ? "Morse is removed. If you added its old Chrome extension to Chrome, remove it there too: chrome://extensions, Morse, Remove." : "Morse is removed.");
}
