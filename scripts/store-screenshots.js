// The five Chrome Web Store screenshots (1280x800), taken by the existing
// demo scripts against the demo sites, with the real built extension:
//
//   npm run store:screenshots      (DISPLAY=:99 on a machine without a screen)
//
// Runs demo/serve.js, then demo/shoot-extension.js, demo/shoot-godmode.js and
// demo/shoot-gallery.js into a scratch folder, and copies the chosen frames to
// docs/store/screenshots/. docs/store/README.md says what each one shows.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "docs", "store", "screenshots");
const PORT = Number(process.env.MORSE_DEMO_PORT || 8787);

// [file the demo script writes, name in the store folder]
export const STORE_SHOTS = [
  ["21-web-point.png", "1-point-and-describe.png"],
  ["27-news-restyling-live.png", "2-it-changes-while-you-watch.png"],
  ["23-web-done.png", "3-add-what-the-app-is-missing.png"],
  ["50-godmode-toolbar.png", "4-edit-tools.png"],
  ["110-for-this-site.png", "5-mods-others-made.png"],
];
const SCRIPTS = ["demo/shoot-extension.js", "demo/shoot-godmode.js", "demo/shoot-gallery.js"];

const run = (file, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, file)], { cwd: root, env: { ...process.env, ...env }, stdio: "inherit" });
  child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`${file} exited with ${code}`))));
});

export function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "morse-store-"));
  const server = spawn(process.execPath, [path.join(root, "demo/serve.js")], { cwd: root, env: { ...process.env, MORSE_DEMO_PORT: String(PORT) }, stdio: "ignore" });
  process.on("exit", () => server.kill());
  await new Promise(r => setTimeout(r, 800));
  try {
    // A demo script that stops after the frames we need is fine; a missing frame is not.
    for (const s of SCRIPTS) await run(s, { SHOTS: tmp, MORSE_DEMO_PORT: String(PORT) }).catch(e => console.warn(`  ${e.message}`));
    await fs.mkdir(OUT, { recursive: true });
    for (const [from, to] of STORE_SHOTS) {
      const buf = await fs.readFile(path.join(tmp, from)).catch(() => { throw new Error(`The demo scripts didn't take ${from}.`); });
      const { width, height } = pngSize(buf);
      if (width !== 1280 || height !== 800) throw new Error(`${from} is ${width}x${height}; the store wants 1280x800.`);
      await fs.writeFile(path.join(OUT, to), buf);
      console.log(`  ${path.relative(root, path.join(OUT, to))}  ${width}x${height}`);
    }
  } finally {
    server.kill();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
