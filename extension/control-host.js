// Extension side of user control: pause (per site, everywhere), safe start,
// install review, export/import. The shared logic is core/control-host.js;
// this supplies chrome.storage and tells open tabs and the toolbar icon when
// the pause state changes. background.js routes CONTROL_REQUESTS here; the
// popup talks to it directly (control.* messages).

import { controlHandler, CONTROL_REQUESTS } from "../core/control-host.js";
import { serialized } from "./bar-host.js"; // the one queue every read-modify-write of "mods" goes through

export { CONTROL_REQUESTS };

const KEY = "morse.control";
const ports = new Set();

const getLocal = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;

async function badge(pause) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#55555c" });
    await chrome.action.setBadgeText({ text: pause?.all ? "off" : "" });
  } catch {}
}

const handle = controlHandler({
  load: () => getLocal(KEY, {}),
  save: state => chrome.storage.local.set({ [KEY]: state }),
  listMods: async () => Object.values(await getLocal("mods", {})),
  putMods: list => serialized(async () => {
    const all = await getLocal("mods", {});
    for (const m of list) all[m.id] = m;
    await chrome.storage.local.set({ mods: all });
  }),
  onPause: pause => {
    badge(pause);
    for (const p of ports) try { p.postMessage({ type: "control.changed", pause }); } catch {}
  },
});

export function handleControlRequest(msg, port) {
  // Safe start and the off switch are per tab: Chrome's tab id, not one the
  // page could change in its sessionStorage.
  const tab = port?.sender?.tab?.id;
  return handle(tab == null ? msg : { ...msg, tab: `tab${tab}` }, { url: msg.url || port?.sender?.tab?.url, app: null });
}

// Every tab's runtime connects on the "morse" port; keep them to broadcast to.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

// The popup (also when opened as a tab): control.get / control.pause / control.exportAll.
// Only the extension's own pages; content scripts use the port above.
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || typeof msg.type !== "string" || !CONTROL_REQUESTS.has(msg.type)) return false;
  if (sender.id !== chrome.runtime.id || !String(sender.url || "").startsWith(chrome.runtime.getURL(""))) return false;
  handle(msg, { url: msg.url, app: null }).then(result => respond({ result }), e => respond({ error: e.message || String(e) }));
  return true;
});

getLocal(KEY, {}).then(s => badge(s.pause)).catch(() => {});
