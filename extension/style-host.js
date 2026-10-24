// Your style in the Chrome extension: kept in chrome.storage.local ("style"),
// served to every tab (core/style-host.js has the logic). A change in one tab
// reaches the others: they re-read their mods, and the style comes first.

import { createStyleHost, STYLE_REQUESTS } from "../core/style-host.js";

export { STYLE_REQUESTS };

const ports = new Set();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

export const Style = createStyleHost({
  load: async () => (await chrome.storage.local.get("style")).style ?? null,
  save: style => (style ? chrome.storage.local.set({ style }) : chrome.storage.local.remove("style")),
  onChange: () => { for (const p of ports) try { p.postMessage({ type: "mods.changed" }); } catch {} },
});
