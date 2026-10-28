// An unsaved change (the preview on the bar, before Save or Undo). It is not a
// mod yet: one per app, or per site, kept until the person saves or undoes it,
// including across a reload. Plain data. The hosts store the map; the runtime
// only sends a draft and applies what comes back.

const CAP = 500_000;
const HISTORY_CAP = 20;

function clip(s, n) {
  s = typeof s === "string" ? s : s == null ? "" : String(s);
  return s.length > n ? s.slice(0, n) : s;
}

// Same filing as a mod (core/mod.js hostOf): the host for a page, the path
// for a local file.
export function pendingHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? `file://${u.host}${u.pathname}` : u.host;
  } catch { return "*"; }
}

// Desktop apps share one in-progress change, whichever window it was made in.
// A browser keeps one per site.
export function pendingScope(where) {
  if (where && where.app) return `app:${clip(String(where.app), 80)}`;
  return `host:${pendingHost(where && where.url)}`;
}

function asMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (k.startsWith("app:") || k.startsWith("host:")) out[k] = v;
  return out;
}

function historyOf(draft) {
  const h = Array.isArray(draft.history) ? draft.history : [];
  return h.filter(v => v && typeof v === "object" && typeof v.css === "string" && typeof v.js === "string" && v.css.length <= CAP && v.js.length <= CAP)
    .slice(-HISTORY_CAP)
    .map(v => ({ prompt: clip(v.prompt, 2000), css: v.css, js: v.js, at: typeof v.at === "string" ? v.at.slice(0, 40) : null }));
}

function targetOf(draft) {
  const t = draft.target && typeof draft.target === "object" ? draft.target : null;
  if (!t || typeof t.selector !== "string" || !t.selector || t.selector.length > 500) return null;
  return { selector: t.selector, label: clip(t.label, 120) };
}

function styleOf(draft) {
  const s = draft.style;
  if (!s || typeof s !== "object" || typeof s.parent !== "string" || !s.parent) return null;
  return { parent: clip(s.parent, 40), title: clip(s.title, 120), prompt: clip(s.prompt, 500) };
}

// null when this isn't a change worth keeping (no id, no code, or too big).
export function sanitizePending(draft, at) {
  if (!draft || typeof draft !== "object") return null;
  const id = typeof draft.id === "string" ? draft.id : "";
  if (!/^[\w-]{1,40}$/.test(id)) return null;
  if (typeof draft.css !== "string" || typeof draft.js !== "string") return null;
  if (draft.css.length > CAP || draft.js.length > CAP) return null;
  if (!draft.css.trim() && !draft.js.trim()) return null;
  const style = styleOf(draft);
  return {
    id, title: clip(draft.title, 200), request: clip(draft.request || draft.prompt, 4000), prompt: clip(draft.prompt || draft.request, 4000),
    css: draft.css, js: draft.js, history: historyOf(draft), refined: clip(draft.refined, 2000),
    updated: typeof draft.updated === "string" ? draft.updated.slice(0, 40) : "",
    model: clip(draft.model, 80),
    ...(typeof draft.secs === "string" ? { secs: clip(draft.secs, 12) } : {}),
    ...(Number.isFinite(draft.attempts) ? { attempts: draft.attempts } : {}),
    target: targetOf(draft),
    ...(style ? { style } : {}),
    at: typeof at === "string" && at ? at.slice(0, 40) : new Date().toISOString(),
  };
}

function trim(map, cap) {
  const keys = Object.keys(map);
  if (keys.length <= cap) return map;
  const ordered = keys.sort((a, b) => String(map[a]?.at || "").localeCompare(String(map[b]?.at || "")));
  const drop = new Set(ordered.slice(0, keys.length - cap));
  const out = {};
  for (const k of keys) if (!drop.has(k)) out[k] = map[k];
  return out;
}

// The whole map, with this page's change replaced. null if `draft` isn't one.
export function packPending(map, where, draft, now = new Date().toISOString()) {
  const item = sanitizePending(draft, now);
  if (!item) return null;
  return trim({ ...asMap(map), [pendingScope(where)]: item }, 40);
}

export function readPending(map, where) {
  const item = asMap(map)[pendingScope(where)];
  return sanitizePending(item, item?.at);
}

// Drops this page's change. A clear for an older id leaves the newer one.
export function dropPending(map, where, id) {
  const base = asMap(map);
  const scope = pendingScope(where);
  const cur = base[scope];
  if (!cur) return base;
  if (id && cur.id !== id) return base;
  const next = { ...base };
  delete next[scope];
  return next;
}
