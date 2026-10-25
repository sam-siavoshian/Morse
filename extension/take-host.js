// Take this, Bring here in Chrome: the features taken on websites, kept in
// chrome.storage.local ("taken"). When this browser is paired with the Morse
// helper, the list is the same one desktop apps use (~/.morse/taken.json,
// daemon/bridge.js /v1/taken), so a feature taken in VS Code can be brought
// into a website and the other way around. core/take-host.js has the logic.

import { createTakeHost, TAKE_REQUESTS } from "../core/take-host.js";
import { helperUrl, serialized } from "./bar-host.js";

export { TAKE_REQUESTS };

// The pairing record the helper's pairing flow leaves (extension/background.js "helper").
async function pairing() {
  const h = (await chrome.storage.local.get("helper")).helper;
  return h?.token ? { url: await helperUrl(), token: h.token } : null;
}
// The helper's list, or null when this browser isn't paired or the helper is off.
async function helper(path, body) {
  const p = await pairing();
  if (!p) return null;
  const r = await fetch(`${p.url}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${p.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(2500),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return Array.isArray(j?.items) ? j.items : null;
}

export const Take = createTakeHost({
  load: async () => (await chrome.storage.local.get("taken")).taken ?? [],
  save: list => serialized(() => chrome.storage.local.set({ taken: list })), // hardening: one queue for storage writes
  remote: {
    list: () => helper("/v1/taken"),
    put: item => helper("/v1/taken", { item }),
    remove: id => helper("/v1/taken/remove", { id }),
  },
});
