// Mod packs, host side: shared by the Chrome extension (extension/pack-host.js)
// and the Morse helper for desktop apps (daemon/packs.js), each with its own
// storage. Answers the runtime's pack.* requests (runtime/src/69-packs.js) and
// the `morse pack` commands.
//
//   pack.fetch       { url } a pack from an address -> the install review's preview
//   pack.install     { source, hash, picks, url?, subscribe? } after the review's Install
//   pack.status      the packs you get updates from, checked at most once a day
//   pack.update      { url, hash, picks } after the update review's Update
//   pack.unsubscribe { url } | { pack }   stop getting updates (the mods stay)
//   pack.share       { ids | pack, name, note, kind: "link" | "file" | "json" }
//   pack.enable      { pack, on } the pack's switch: every mod in it, on or off
// (A pack is named by "pack", never "id": every request's id is its own.)
//
// Updates are fetched like the gallery's list (core/gallery.js): at most once
// a day (or what the server's max-age says, within a week), with ETag /
// Last-Modified, size caps while reading, and the old copy kept when offline.
// Nothing installs or changes without the person pressing Install or Update:
// what they reviewed is checked by its hash.

import {
  parsePack, packPreview, planInstall, planUpdate, diffPack, makePack, encodePackLink, packFilename,
  packHash, checkPackUrl, packGroups, fromPack, MAX_PACK_BYTES,
} from "./pack.js";
import { parseImport } from "./backup.js";
import { needsFetch, maxAgeOf } from "./gallery.js";

export const PACK_REQUESTS = new Set(["pack.fetch", "pack.install", "pack.status", "pack.update", "pack.unsubscribe", "pack.share", "pack.enable"]);

const TIMEOUT = 8000;
const MAX_SUBS = 20;

// Reads at most `max` bytes: a huge (or endless) answer is cut off while
// reading, never held whole (as core/gallery-host.js reads the gallery).
export async function readCapped(res, max) {
  const big = "This pack is too big. Morse reads packs up to 2 MB.";
  if (Number(res.headers.get("content-length")) > max) { res.body?.cancel?.().catch(() => {}); throw new Error(big); }
  if (!res.body?.getReader) { const text = await res.text(); if (text.length > max) throw new Error(big); return text; }
  const reader = res.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); throw new Error(big); }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

// store:     { get(key), set(key, value) }, async (the packs you get updates from)
// mods:      { list(), put(mods), remove(ids) }, async (every saved mod)
// writeFile: (filename, text) -> { path } (a pack file to share)
export function createPacks({ store, mods, writeFile = null, fetch = globalThis.fetch, now = () => Date.now() }) {
  const inflight = new Map();
  let queue = Promise.resolve();
  const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
  const subsNow = async () => { const s = await store.get("subs"); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; };
  const editSubs = fn => serial(async () => { const s = await subsNow(); const r = await fn(s); await store.set("subs", s); return r; });

  // Fetches an address once. -> { text, etag, lastModified, maxAge, status }
  async function get(url, cache = null) {
    const headers = {};
    if (cache?.text && cache.etag) headers["If-None-Match"] = cache.etag;
    else if (cache?.text && cache.lastModified) headers["If-Modified-Since"] = cache.lastModified;
    let res;
    try { res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT), credentials: "omit", redirect: "follow" }); }
    catch { throw new Error("Couldn't reach the pack's address. Check your connection and try again."); }
    if (res.url && res.url !== url) checkPackUrl(res.url); // redirected: the end has to be https too
    const meta = { status: res.status, etag: res.headers.get("etag") || "", lastModified: res.headers.get("last-modified") || "", maxAge: maxAgeOf(res.headers.get("cache-control")) };
    if (res.status === 304) return meta;
    if (res.status !== 200) { res.body?.cancel?.().catch(() => {}); throw new Error(`Couldn't get the pack from this address (error ${res.status}). Check the address and try again.`); }
    return { ...meta, text: await readCapped(res, MAX_PACK_BYTES) };
  }

  // One subscription's check: the cache after it. Offline or broken keeps the old copy.
  async function refresh(sub) {
    const cache = sub.cache || {};
    let next;
    try {
      const r = await get(sub.url, cache);
      if (r.status === 304 && cache.text) next = { ...cache, fetchedAt: now(), failedAt: 0, error: "", maxAge: r.maxAge || cache.maxAge || 0 };
      else {
        const { pack } = parsePack(r.text);
        if (pack.id !== sub.id) throw new Error("The address has a different pack now. Morse kept the copy you have.");
        next = { text: r.text, hash: await packHash(pack), etag: r.etag, lastModified: r.lastModified, maxAge: r.maxAge, fetchedAt: now(), failedAt: 0, error: "" };
      }
    } catch (e) {
      next = { fetchedAt: 0, ...cache, failedAt: now(), error: String(e?.message || "Couldn't reach the pack's address.") };
    }
    await editSubs(s => { if (s[sub.url]) s[sub.url].cache = next; });
    return next;
  }
  function check(sub, force) {
    if (!force && !needsFetch(sub.cache?.text ? sub.cache : null, now())) return Promise.resolve(sub.cache);
    if (!inflight.has(sub.url)) inflight.set(sub.url, refresh(sub).finally(() => inflight.delete(sub.url)));
    return inflight.get(sub.url);
  }

  // -> [{ url, id, name, checked, offline, error, hash, declined, update }]
  // update is null, or { added, removed, changed, same } against your mods.
  async function status({ force = false } = {}) {
    const subs = Object.values(await subsNow());
    const caches = await Promise.all(subs.map(s => check(s, force).catch(() => s.cache)));
    const all = subs.some((s, i) => caches[i]?.hash && caches[i].hash !== s.reviewed) ? await mods.list() : [];
    return subs.map((s, i) => {
      const c = caches[i] || {};
      let update = null, name = s.name;
      if (c.text && c.hash && c.hash !== s.reviewed) {
        try {
          const { pack } = parsePack(c.text);
          const d = diffPack(all, pack);
          name = pack.name;
          // Mods you left out before aren't news: they come along, unticked, with a real change.
          const fresh = d.added.filter(m => !(s.declined || []).includes(m.id));
          if (fresh.length || d.removed.length || d.changed.length) update = { ...d, fresh: fresh.map(m => m.id), note: pack.note, author: pack.author || "" };
        } catch {}
      }
      return { url: s.url, id: s.id, name, checked: c.fetchedAt || 0, offline: !!c.failedAt, error: c.failedAt ? c.error || "" : "", hash: c.hash || "", declined: s.declined || [], update };
    });
  }

  // A pack from an address, for the install review (nothing is saved).
  async function fetchAddress(url) {
    const href = checkPackUrl(url);
    const r = await get(href);
    const parsed = parsePack(r.text);
    const subs = await subsNow();
    return packPreview(parsed, await mods.list(), { url: href, source: r.text, subscribed: !!subs[href] });
  }

  // What the review showed, installed: the source is read again and must be
  // the same pack (its hash), and clashes are decided by the person's picks.
  async function install({ source, hash, picks, url = "", subscribe = false }) {
    const r = await parseImport(String(source ?? ""));
    if (r.kind !== "pack") throw new Error("This isn't a Morse pack. Check that you copied all of it.");
    if (!hash || (await packHash(r.pack)) !== hash) throw new Error("This pack changed while you were looking at it. Open it again to see what's in it now.");
    const href = subscribe ? checkPackUrl(url) : "";
    const { put } = planInstall(r.pack, picks, await mods.list(), { url: href, now: new Date(now()) });
    await mods.put(put);
    if (href) {
      await editSubs(s => {
        if (!s[href] && Object.keys(s).length >= MAX_SUBS) throw new Error(`You get updates from ${MAX_SUBS} packs already. Stop one first.`);
        const chosen = new Set((picks || []).map(p => p?.id));
        s[href] = {
          url: href, id: r.pack.id, name: r.pack.name, since: new Date(now()).toISOString(), reviewed: hash,
          declined: r.pack.mods.map(m => m.id).filter(id => !chosen.has(id)),
          cache: { text: typeof source === "string" && !source.includes("#m=") ? source : JSON.stringify(r.pack), hash, fetchedAt: now(), failedAt: 0, error: "", maxAge: 0 },
        };
      });
    }
    return { saved: put.map(m => ({ id: m.id, title: m.title })), pack: { id: r.pack.id, name: r.pack.name }, subscribed: !!href };
  }

  async function update({ url, hash, picks = {} }) {
    const sub = (await subsNow())[url];
    if (!sub) throw new Error("You don't get updates from this pack anymore.");
    let pack;
    try { pack = parsePack(sub.cache?.text || "").pack; } catch { throw new Error("Morse doesn't have a copy of this pack's update. Try again later."); }
    if (!hash || sub.cache.hash !== hash) throw new Error("This pack changed while you were looking at it. Open the update again to see what's in it now.");
    const all = await mods.list();
    const d = diffPack(all, pack);
    const plan = planUpdate(all, pack, picks, { url, now: new Date(now()) });
    await mods.put(plan.put);
    if (plan.remove.length) await mods.remove(plan.remove);
    const added = new Set(picks.add || []);
    await editSubs(s => { if (s[url]) Object.assign(s[url], { reviewed: hash, name: pack.name, declined: d.added.map(m => m.id).filter(id => !added.has(id)) }); });
    return { saved: plan.put.length, removed: plan.remove.length, name: pack.name };
  }

  async function unsubscribe({ url = "", pack: id = "" }) {
    return editSubs(s => {
      const gone = Object.values(s).filter(x => x.url === url || (id && x.id === id));
      for (const x of gone) delete s[x.url];
      return gone.length;
    });
  }

  async function share({ ids = [], pack = "", name = "", note = "", author = "", kind = "link" }) {
    const all = await mods.list();
    let chosen, packId = "";
    if (pack) {
      chosen = all.filter(m => fromPack(m, pack));
      packId = pack;
      name ||= chosen[0]?.pack?.name || "";
    } else {
      chosen = (Array.isArray(ids) ? ids : []).map(id => all.find(m => m.id === id));
      if (chosen.some(m => !m)) throw new Error("Some of these mods aren't saved anymore. Choose them again.");
    }
    const p = makePack(chosen, { name, note, author, id: packId, now: new Date(now()) });
    if (kind === "json") return { pack: p, text: JSON.stringify(p, null, 2), filename: packFilename(p) };
    if (kind === "file") {
      if (!writeFile) throw new Error("This version of Morse can't save files.");
      return { ...(await writeFile(packFilename(p), JSON.stringify(p, null, 2))), count: p.mods.length };
    }
    return { link: await encodePackLink(p), count: p.mods.length };
  }

  async function enable({ pack: id, on }) {
    const list = (await mods.list()).filter(m => fromPack(m, id));
    const changed = list.filter(m => (m.enabled !== false) !== !!on).map(m => ({ ...m, enabled: !!on }));
    if (changed.length) await mods.put(changed);
    return { count: list.length, changed: changed.length };
  }

  async function list() {
    const subs = await subsNow();
    return { packs: packGroups(await mods.list()), subs: Object.values(subs).map(s => ({ url: s.url, id: s.id, name: s.name, checked: s.cache?.fetchedAt || 0, offline: !!s.cache?.failedAt })) };
  }

  async function handle(msg) {
    switch (msg.type) {
      case "pack.fetch": return fetchAddress(msg.url);
      case "pack.install": return install(msg);
      case "pack.status": return status({ force: !!msg.force });
      case "pack.update": return update(msg);
      case "pack.unsubscribe": return unsubscribe(msg);
      case "pack.share": return share(msg);
      case "pack.enable": return enable(msg);
    }
    throw new Error(`Unknown request ${msg.type}`);
  }

  return { handle, status, fetchAddress, install, update, unsubscribe, share, enable, list };
}
