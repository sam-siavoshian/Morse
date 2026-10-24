// Mods for this site, desktop side: the Morse helper fetches the gallery list
// and mod files (never the app's page) and keeps them in ~/.morse/gallery.json.
// See core/gallery-host.js for when it fetches.
//
// The list's address: MORSE_GALLERY_URL, or "gallery": { "index": "…" } in
// ~/.morse/config.json; otherwise the public gallery (or the local one for
// the demo sites served by `node demo/serve.js`).

import { promises as fs } from "node:fs";
import path from "node:path";
import { createGallery } from "../core/gallery-host.js";
import { HOME, ensureHome, loadPrefs, loadConfig } from "./store.js";

export const GALLERY_REQUESTS = new Set(["gallery.list"]);

const FILE = path.join(HOME, "gallery.json");
let queue = Promise.resolve();
const read = async () => { try { return JSON.parse(await fs.readFile(FILE, "utf8")) || {}; } catch { return {}; } };

export const gallery = createGallery({
  store: {
    get: async k => (await read())[k],
    set: (k, v) => (queue = queue.then(async () => {
      const all = await read();
      all[k] = v;
      await ensureHome();
      const tmp = `${FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(all));
      await fs.rename(tmp, FILE);
    }).catch(() => {})),
  },
  enabled: async () => (await loadPrefs()).gallery !== false,
  configured: async () => process.env.MORSE_GALLERY_URL || (await loadConfig()).gallery?.index || "",
});

export function handleGallery(msg, where) {
  if (msg.type === "gallery.list") return gallery.list({ url: where.url, app: where.app });
  throw new Error(`Unknown request ${msg.type}`);
}
