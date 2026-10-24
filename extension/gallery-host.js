// Mods for this site, extension side. background.js routes GALLERY_REQUESTS
// here. The list and the mod files are fetched by this service worker (never
// by the page) and kept in chrome.storage.local "morse.gallery.index" and
// "morse.gallery.mods"; see core/gallery-host.js for when it fetches.
//
// The list's address can be changed in chrome.storage.local
// "morse.gallery.url" (for a fork of the gallery, or a local copy).

import { createGallery } from "../core/gallery-host.js";
import { getPrefs } from "./bar-host.js";

export const GALLERY_REQUESTS = new Set(["gallery.list"]);

const KEY = k => `morse.gallery.${k}`;
const gallery = createGallery({
  store: {
    get: async k => (await chrome.storage.local.get(KEY(k)))[KEY(k)],
    set: (k, v) => chrome.storage.local.set({ [KEY(k)]: v }),
  },
  enabled: async () => (await getPrefs()).gallery !== false,
  configured: async () => (await chrome.storage.local.get(KEY("url")))[KEY("url")] || "",
});

export function handleGallery(msg, url) {
  if (msg.type === "gallery.list") return gallery.list({ url, app: null });
  throw new Error(`Unknown request ${msg.type}`);
}
