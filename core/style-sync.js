// Your style, shared between Chrome and the desktop apps (dogfood: a style
// made in Chrome never reached the apps, though the toast said “every site
// and app”). The desktop keeps it in ~/.morse/style.json; the extension keeps
// its own copy in chrome.storage.local. When the extension is paired with the
// Morse helper, it reads and writes the desktop's copy through the helper
// (GET/POST /v1/style, daemon/bridge.js), so a style said in either place
// shows in both.
//
// Each copy is known by when it was last changed (`updated`, or "" for no
// style). The extension remembers the last time both agreed (`base`), so it
// can tell which side changed since:
//   only the helper's copy changed  -> take it (a style turned off there goes here too)
//   only this copy changed          -> send it
//   both changed                    -> the newer one wins
// The helper only accepts a copy sent against the one it has now (`was`), so a
// change made on the desktop in between is never lost; the next sync sees it.

import { hasStyle, normalizeStyle } from "./style.js";

// When a style was last changed; "" for none.
export const styleStamp = s => (s && hasStyle(s) ? normalizeStyle(s).updated || "-" : "");

// -> "pull" | "push" | null (nothing to do)
export function syncStep({ local, remote, base = "" }) {
  const l = styleStamp(local), r = styleStamp(remote);
  if (l === r) return null;
  if (r === base) return "push";
  if (l === base) return "pull";
  return l > r ? "push" : "pull"; // both changed: "" (removed) counts as oldest
}

// Taking the other copy keeps the sites this one already fitted the style to
// (`tried`: per site or app, and not part of `updated`).
function taken(remote, local) {
  if (!remote || !hasStyle(remote)) return null;
  const r = normalizeStyle(remote);
  const tried = { ...(local && hasStyle(local) ? normalizeStyle(local).tried : {}), ...r.tried };
  return normalizeStyle({ ...r, tried });
}

//   load() / save(style | null)  this copy
//   base: { get(), set(stamp) }  when both last agreed
//   remote: { get() -> { style } | undefined when it can't be reached, put(style | null, was) -> true | false }
//   onPulled()                   this copy changed: tell open pages
export function createStyleSync({ load, save, base, remote, onPulled = () => {} }) {
  async function once() {
    const r = await remote.get();
    if (r === undefined) return "offline";
    const local = await load();
    const agreed = (await base.get()) || "";
    const step = syncStep({ local, remote: r.style, base: agreed });
    if (!step) { if (agreed !== styleStamp(local)) await base.set(styleStamp(local)); return null; } // perf: no write when nothing changed (every page load, at most every 5 s)
    if (step === "pull") {
      const next = taken(r.style, local);
      await save(next);
      await base.set(styleStamp(next));
      try { onPulled(); } catch {}
      return "pull";
    }
    const mine = local && hasStyle(local) ? normalizeStyle(local) : null;
    if (!(await remote.put(mine, styleStamp(r.style)))) return "conflict"; // it changed meanwhile: next time
    await base.set(styleStamp(mine));
    return "push";
  }
  // One at a time. Asked while one runs: one more runs after it, shared by
  // everyone who asked meanwhile.
  let chain = Promise.resolve(), waiting = null;
  return {
    sync() {
      if (waiting) return waiting;
      const p = chain.then(() => { waiting = null; return once(); });
      waiting = p;
      chain = p.catch(() => {});
      return p;
    },
  };
}
