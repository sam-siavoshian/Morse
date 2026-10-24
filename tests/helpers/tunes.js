// Tunes (demo/electron-app) packaged on the Electron runtime, for tests that
// open a real app. Built once per runtime and app source in
// ~/.cache/morse/tunes/<name>-<hash> and shared by every run and checkout;
// only the 3 most recently used of each name are kept
// (demo/electron-app/build.mjs cachedTunes). tests/electron.test.js uses the
// same cache.
import path from "node:path";
import { findElectron, buildTunes, cachedTunes } from "../../demo/electron-app/build.mjs";

export const electronDist = findElectron();
export const electronExe = electronDist && path.join(electronDist, { win32: "electron.exe", darwin: "Electron.app/Contents/MacOS/Electron" }[process.platform] || "electron");

export async function tunesApp(name = "TunesDesktop") {
  const { dir, exe } = await cachedTunes(name, out => buildTunes(out, { dist: electronDist }), { dist: electronDist });
  return { dir, exe };
}
