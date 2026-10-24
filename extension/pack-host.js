// Mod packs, extension side. background.js routes PACK_REQUESTS here. The
// packs you get updates from are kept in chrome.storage.local "morse.packs.subs";
// this service worker fetches them (never the page), at most once a day. See
// core/pack-host.js for the rules.

import { createPacks, PACK_REQUESTS } from "../core/pack-host.js";
import { validateMod } from "../core/mod.js";
import { serialized } from "./bar-host.js"; // the one queue every read-modify-write of "mods" goes through

export { PACK_REQUESTS };

const KEY = k => `morse.packs.${k}`;
const allMods = async () => (await chrome.storage.local.get("mods")).mods || {};

function textUrl(text, mime) {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(s)}`;
}

const packs = createPacks({
  store: {
    get: async k => (await chrome.storage.local.get(KEY(k)))[KEY(k)],
    set: (k, v) => chrome.storage.local.set({ [KEY(k)]: v }),
  },
  mods: {
    list: async () => Object.values(await allMods()),
    put: list => serialized(async () => {
      for (const m of list) validateMod(m);
      const all = await allMods();
      for (const m of list) all[m.id] = m;
      await chrome.storage.local.set({ mods: all });
    }),
    remove: ids => serialized(async () => {
      const all = await allMods();
      for (const id of ids) delete all[id];
      await chrome.storage.local.set({ mods: all });
    }),
  },
  writeFile: (filename, text) => chrome.downloads.download({ url: textUrl(text, "application/json"), filename: `morse/${filename}`, saveAs: false })
    .then(() => ({ path: `Downloads/morse/${filename}` })),
});

export function handlePack(msg) {
  return packs.handle(msg);
}
