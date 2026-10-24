// Your style in the Chrome extension: kept in chrome.storage.local ("style"),
// served to every tab (core/style-host.js has the logic). A change in one tab
// reaches the others: they re-read their mods, and the style comes first.
//
// Paired with the Morse helper, the style is shared with the desktop apps
// (core/style-sync.js): this copy is sent there when it changes, and the
// helper's copy is read when the worker starts, when it is paired, and when a
// page loads (at most every 5 s), so a style said in an app shows here too.

import { createStyleHost, STYLE_REQUESTS } from "../core/style-host.js";
import { createStyleSync } from "../core/style-sync.js";
import { pairing } from "./bar-host.js";

export { STYLE_REQUESTS };

const ports = new Set();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
const tellPages = () => { for (const p of ports) try { p.postMessage({ type: "mods.changed" }); } catch {} };

const load = async () => (await chrome.storage.local.get("style")).style ?? null;
const save = style => (style ? chrome.storage.local.set({ style }) : chrome.storage.local.remove("style"));

const helper = async (path, init = {}) => {
  const p = await pairing();
  if (!p?.token) return null;
  return fetch(`${p.url}${path}`, { ...init, headers: { Authorization: `Bearer ${p.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }, signal: AbortSignal.timeout(2000) });
};
const Shared = createStyleSync({
  load, save,
  base: { get: async () => (await chrome.storage.local.get("styleSync")).styleSync || "", set: v => chrome.storage.local.set({ styleSync: v }) },
  remote: {
    async get() {
      try { const r = await helper("/v1/style"); return r?.ok ? { style: (await r.json()).style ?? null } : undefined; } catch { return undefined; }
    },
    async put(style, was) {
      try { return !!(await helper("/v1/style", { method: "POST", body: JSON.stringify({ style, was }) }))?.ok; } catch { return false; }
    },
  },
  onPulled: tellPages,
});
let lastSync = 0;
export function syncStyle(soon = false) {
  if (soon && Date.now() - lastSync < 5000) return;
  lastSync = Date.now();
  Shared.sync().catch(() => {});
}
syncStyle();
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.helper) syncStyle(); }); // just paired

const host = createStyleHost({
  load, save,
  onChange: () => { tellPages(); syncStyle(); },
  reach: async () => ((await pairing()) ? "all" : "web"),
});
export const Style = {
  ...host,
  list(mods, where) { syncStyle(true); return host.list(mods, where); },
  handle: host.handle,
};
