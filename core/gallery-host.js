// Mods for this site, host side: fetches the gallery list and the mod files,
// keeps them in the host's storage, and answers the runtime's "gallery.list".
// Shared by the Chrome extension (extension/gallery-host.js) and the Morse
// helper for desktop apps (daemon/gallery.js); each passes its own storage.
//
// The page never fetches anything: it asks the host, the host reads its cache
// and goes to the network at most once a day (core/gallery.js needsFetch).
// With "Show mods others made" off, nothing is fetched at all.

import { modMatches, validateMod, hostOf } from "./mod.js";
import {
  indexUrlFor, matchEntries, modUrl, needsFetch, conditionalHeaders, afterResponse, afterFailure,
  compareVersions, normVersion, briefSummary, MAX_MOD_BYTES,
} from "./gallery.js";

const TIMEOUT = 8000;
const MAX_ITEMS = 12; // per page

// store:      { get(key) -> value | undefined, set(key, value) }, async
// enabled():  the "Show mods others made" setting
// configured(): an index URL the person set, or ""
export function createGallery({ store, enabled = async () => true, configured = async () => "", fetch = globalThis.fetch, now = () => Date.now() }) {
  const inflight = new Map();

  async function readText(res, max) {
    const text = await res.text();
    if (text.length > max) throw new Error("too big");
    return text;
  }

  async function refresh(url, cache) {
    let next;
    try {
      const res = await fetch(url, { headers: conditionalHeaders(cache), signal: AbortSignal.timeout(TIMEOUT), credentials: "omit" });
      next = afterResponse(cache, {
        status: res.status,
        etag: res.headers.get("etag") || "",
        lastModified: res.headers.get("last-modified") || "",
        cacheControl: res.headers.get("cache-control") || "",
        body: res.status === 200 ? await readText(res, 4 * 1024 * 1024) : "",
      }, now());
    } catch (e) {
      next = afterFailure(cache, now(), "Couldn't reach the gallery.");
    }
    const all = (await store.get("index")) || {};
    all[url] = next;
    // Only the lists in use are kept.
    for (const k of Object.keys(all)) if (k !== url && now() - (all[k].fetchedAt || all[k].failedAt || 0) > 30 * 864e5) delete all[k];
    await store.set("index", all);
    return next;
  }

  async function index(url, { force = false } = {}) {
    const cache = ((await store.get("index")) || {})[url];
    if (!force && !needsFetch(cache, now())) return cache;
    if (!inflight.has(url)) inflight.set(url, refresh(url, cache).finally(() => inflight.delete(url)));
    return inflight.get(url);
  }

  // A mod file, from the cache when it is the version the list names.
  async function modFor(entry, indexUrl) {
    const url = modUrl(entry, indexUrl);
    const all = (await store.get("mods")) || {};
    const hit = all[url];
    if (hit && compareVersions(hit.mod?.version, entry.version) >= 0) return hit.mod;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), credentials: "omit" });
      if (!res.ok) throw new Error(`error ${res.status}`);
      const mod = validateMod(JSON.parse(await readText(res, MAX_MOD_BYTES)));
      if (mod.id !== entry.id) throw new Error("the file is for another mod");
      const out = { ...mod, match: entry.match, version: normVersion(mod.version ?? entry.version) };
      all[url] = { mod: out, at: now() };
      await store.set("mods", all);
      return out;
    } catch {
      return hit?.mod || null; // offline: the copy we have
    }
  }

  // -> { on, items: [{ ...entry, mod, summary }], site, index, offline, checked }
  async function list({ url, app = null, force = false }) {
    if (!(await enabled())) return { on: false, items: [] };
    const where = { url, app };
    const indexUrl = indexUrlFor(url, await configured());
    const cache = await index(indexUrl, { force });
    const entries = matchEntries(cache?.entries, where, modMatches).slice(0, MAX_ITEMS);
    const items = [];
    for (const e of entries) {
      const mod = await modFor(e, indexUrl);
      if (mod) items.push({ ...e, version: mod.version, mod, summary: briefSummary(mod) });
    }
    return {
      on: true, items,
      site: app || hostOf(url),
      index: indexUrl,
      offline: !!cache?.failedAt,
      checked: cache?.fetchedAt || 0,
    };
  }

  // Forget the cached list and files (for tests and "check again").
  async function clear() { await store.set("index", {}); await store.set("mods", {}); }

  return { list, index, clear };
}
