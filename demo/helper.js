// For the extension screenshot scripts: starts the Morse helper (`morse serve`)
// in a scratch MORSE_HOME and pairs the extension with it through the real
// popup. The helper replays core/demo.js unless MORSE_PROVIDER names a real
// model (e.g. MORSE_PROVIDER=claude-code MORSE_MODEL=haiku).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export async function startHelper(home) {
  await fs.mkdir(home, { recursive: true });
  const provider = process.env.MORSE_PROVIDER || "demo";
  if (process.env.MORSE_MODEL) {
    await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ models: { [provider]: process.env.MORSE_MODEL } }));
  }
  const child = spawn("node", [path.join(root, "daemon/cli.js"), "serve"], { env: { ...process.env, MORSE_HOME: home, MORSE_PROVIDER: provider } });
  let out = "";
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`morse serve didn't start:\n${out}`)), 10000);
    child.stdout.on("data", d => {
      out += d;
      const m = /pair\s+(?:\x1b\[[\d;]*m)*([A-Z0-9]{6})/.exec(out);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.stderr.on("data", d => { out += d; });
    child.on("exit", c => { clearTimeout(timer); reject(new Error(`morse serve exited (${c}):\n${out}`)); });
  });
  child.stdout.on("data", d => process.stdout.write(String(d).replace(/^(?=.)/gm, "  helper ")));
  process.on("exit", () => child.kill()); // even if the script crashes
  return { code, stop: () => child.kill() };
}

// Types the pairing code into the extension's popup, like a user would.
export async function pairExtension(ctx, id, code) {
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.locator("#code").fill(code);
  await pop.locator("#pair").click();
  await pop.locator("#unpair:not([hidden])").waitFor({ timeout: 10000 });
  await pop.close();
}
