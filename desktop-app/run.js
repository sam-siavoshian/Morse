// Starts Morse Desktop from a clone: `npm run desktop` (or node desktop-app/run.js).
// The Electron runtime comes from where demo/electron-app/build.mjs looks
// ($MORSE_ELECTRON, the electron npm package, ~/.cache/morse/electron).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findElectron } from "../demo/electron-app/build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = findElectron();
if (!dist) {
  console.error("No Electron runtime found. Install one with: npm install --prefix ~/.cache/morse/electron electron");
  process.exit(1);
}
const exe = path.join(dist, { win32: "electron.exe", darwin: "Electron.app/Contents/MacOS/Electron" }[process.platform] || "electron");
// Chromium won't start as root with its sandbox on (containers, CI).
const root = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [here, ...root, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", code => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
