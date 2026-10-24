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
  compareVersions, normVersion, briefSummary, MAX_MOD_BYTES, MAX_INDEX_BYTES,
} from "./gallery.js";

const TIMEOUT = 8000;
const MAX_ITEMS = 12; // per page
const MAX_CACHED_MODS = 200; // mod files kept; older ones are fetched again if needed

// store:      { get(key) -> value | undefined, set(key, value) }, async
// enabled():  the "Show mods others made" setting
// configured(): an index URL the person set, or ""
// demoIndex:  the local list for the demo sites (DEMO_INDEX_URL), only where
//             Morse is being worked on; "" (the default) never uses it
export function createGallery({ store, enabled = async () => true, configured = async () => "", demoIndex = "", fetch = globalThis.fetch, now = () => Date.now() }) {
  const inflight = new Map();

  // Reads at most `max` bytes: a huge (or endless) response is cut off, not
  // held in memory whole.
  async function readText(res, max) {
    if (Number(res.headers.get("content-length")) > max) { res.body?.cancel?.().catch(() => {}); throw new Error("The gallery file is too large."); }
    if (!res.body?.getReader) { const text = await res.text(); if (text.length > max) throw new Error("The gallery file is too large."); return text; }
    const reader = res.body.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { reader.cancel().catch(() => {}); throw new Error("The gallery file is too large."); }
      parts.push(value);
    }
    const all = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    return new TextDecoder().decode(all);
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
        body: res.status === 200 ? await readText(res, MAX_INDEX_BYTES) : "",
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
    // The list says where it runs (it may have narrowed since), and which
    // version is current: a newer copy in the cache doesn't outlive the list
    // going back to an older one (a bad version withdrawn).
    const current = hit?.mod && { ...hit.mod, match: entry.match };
    if (current && compareVersions(hit.mod.version, entry.version) === 0) return current;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), credentials: "omit" });
      if (!res.ok) throw new Error(`Couldn't reach the gallery (error ${res.status}). Try again later.`);
      const mod = validateMod(JSON.parse(await readText(res, MAX_MOD_BYTES)));
      if (mod.id !== entry.id) throw new Error("The gallery has the wrong file for this mod.");
      const out = { ...mod, match: entry.match, version: normVersion(mod.version ?? entry.version) };
      all[url] = { mod: out, at: now() };
      for (const k of Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0)).slice(MAX_CACHED_MODS)) delete all[k];
      await store.set("mods", all);
      return out;
    } catch {
      return current && compareVersions(hit.mod.version, entry.version) <= 0 ? current : null; // offline: the copy we have, if not one the list withdrew
    }
  }

  // -> { on, items: [{ ...entry, mod, summary }], site, index, offline, checked }
  async function list({ url, app = null, force = false }) {
    if (!(await enabled())) return { on: false, items: [] };
    const where = { url, app };
    const indexUrl = indexUrlFor(url, await configured(), demoIndex);
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
