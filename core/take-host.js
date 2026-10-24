// Take this, Bring here, host side: the list of taken features (core/take.js)
// and the runtime's taken.* requests. Shared by the Chrome extension
// (extension/take-host.js: chrome.storage.local, and the Morse helper's list
// when paired) and the computer (daemon/take.js: ~/.morse/taken.json, which
// the Morse helper also serves to Chrome over /v1/taken).
//
//   taken.list               -> { items, shared }
//   taken.put    { item }    -> { items, shared }   added, or put in place of the same id
//   taken.remove { takenId } -> { items, shared }
//
// `shared`: true when the other side (Chrome, or the desktop apps) sees the
// same list; false when it can't (not paired); the runtime says so in the
// Mods panel.
//
// createTakeHost({ load, save, remote?, shared?, stamp? })
//   load() / save(list)  this side's list
//   remote               the other side's list, when there is one: { list(), put(item), remove(id) },
//                        each resolving to its list, or null when it can't be reached
//   shared()             for a side with no remote: does the other side see this list?
//   stamp(item)          fills in what the host knows better than the page (the app's name)

import { cleanTaken, takenAdd, takenRemove, mergeTaken } from "./take.js";

export const TAKE_REQUESTS = new Set(["taken.list", "taken.put", "taken.remove"]);

export function createTakeHost({ load, save, remote = null, shared = async () => false, stamp = it => it }) {
  let queue = Promise.resolve();
  const serial = job => (queue = queue.then(job, job));
  const mine = async () => { const l = await load(); return Array.isArray(l) ? l : []; };
  const other = async fn => { if (!remote) return undefined; try { return await fn(remote); } catch { return null; } };
  const reply = async (items, far) => ({ items: items.map(i => ({ ...i })), shared: far === undefined ? !!(await shared()) : far !== null });

  async function handle(msg) {
    switch (msg.type) {
      case "taken.list": {
        const far = await other(r => r.list());
        return serial(async () => {
          const items = await mine();
          if (!Array.isArray(far)) return reply(items, far);
          // The other side's list wins for what both have seen: a feature
          // seen there before (synced) and gone now was deleted there. One
          // taken while they weren't paired goes over now.
          const there = new Set(far.map(i => i?.id));
          const only = items.filter(i => !there.has(i.id) && !i.synced);
          for (const it of only) await other(r => r.put(it));
          const merged = mergeTaken(items.filter(i => there.has(i.id) || only.includes(i)), far).map(i => ({ ...i, synced: true }));
          if (JSON.stringify(merged.map(i => i.id + i.updated)) !== JSON.stringify(items.map(i => i.id + i.updated)) || items.some(i => !i.synced)) await save(merged);
          return reply(merged, far);
        });
      }
      case "taken.put": {
        const item = cleanTaken(stamp({ ...msg.item, updated: new Date().toISOString() }));
        const far = await other(r => r.put(item));
        const items = await serial(async () => { const l = takenAdd(await mine(), { ...item, synced: !!far }); await save(l); return l; });
        return reply(items, far);
      }
      case "taken.remove": {
        const id = String(msg.takenId || "");
        const items = await serial(async () => { const l = takenRemove(await mine(), id); await save(l); return l; });
        return reply(items, await other(r => r.remove(id)));
      }
      default:
        throw new Error(`Unknown request ${msg.type}`);
    }
  }
  return { owns: msg => TAKE_REQUESTS.has(msg?.type), handle };
}
