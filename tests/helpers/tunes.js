// Tunes (demo/electron-app) packaged on the Electron runtime, for tests that
// open a real app. Built once per runtime and app source in
// ~/.cache/morse/tunes/<name>-<hash> (hard links to the runtime, so it takes
// almost no room) and renamed into place when done, so runs side by side
// share one copy. tests/electron.test.js keeps its own copies the same way.
import os from "node:os";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { findElectron, electronVersion, buildTunes, pruneBuilds } from "../../demo/electron-app/build.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const electronDist = findElectron();
export const electronExe = electronDist && path.join(electronDist, { win32: "electron.exe", darwin: "Electron.app/Contents/MacOS/Electron" }[process.platform] || "electron");

export async function tunesApp(name = "TunesDesktop") {
  const src = path.join(root, "demo", "electron-app");
  const h = createHash("sha256").update(`${electronDist}\0${electronVersion(electronDist)}\0${name}\0`);
  for (const f of [...(await fs.readdir(src)).sort().map(f => path.join(src, f)), path.join(root, "demo", "sites", "tunes", "index.html")]) h.update(f).update(await fs.readFile(f));
  const cache = path.join(os.homedir(), ".cache", "morse", "tunes");
  const dir = path.join(cache, `${name}-${h.digest("hex").slice(0, 12)}`);
  const result = { dir, exe: path.join(dir, process.platform === "win32" ? "Tunes.exe" : "tunes") };
  // soak: marked as used, then only the few most recent builds stay (build.mjs pruneBuilds)
  if (existsSync(path.join(dir, ".built"))) { await fs.utimes(dir, new Date(), new Date()).catch(() => {}); await pruneBuilds(cache); return result; }
  await fs.mkdir(cache, { recursive: true });
  const tmp = `${dir}.${process.pid}.tmp`;
  try {
    await buildTunes(tmp, { dist: electronDist });
    await fs.writeFile(path.join(tmp, ".built"), "");
    await fs.rename(tmp, dir).catch(e => { if (!existsSync(path.join(dir, ".built"))) throw e; });
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  await pruneBuilds(cache); // soak
  return result;
}
