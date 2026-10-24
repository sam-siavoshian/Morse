// Version history for mods. Refining a mod pushes the version it replaces, so
// any earlier one can be brought back. Plain data and no imports: the hosts
// use it through core/mod.js, and runtime/bundle.js inlines it for the runtime.
//
//   mod.history  = [{ prompt, css, js, at }]  oldest first, at most HISTORY_CAP
//   mod.refined  = the follow-up that produced the current code (absent for
//                  the first version; mod.prompt always stays the original ask)
// Mods saved before history existed have neither field and stay valid.

export const HISTORY_CAP = 20;

// A mod's earlier versions, oldest first. Malformed entries are dropped.
export function versionsOf(mod) {
  const h = Array.isArray(mod?.history) ? mod.history : [];
  return h.filter(v => v && typeof v === "object" && typeof v.css === "string" && typeof v.js === "string")
    .map(v => ({ prompt: String(v.prompt ?? ""), css: v.css, js: v.js, at: typeof v.at === "string" ? v.at : null }))
    .slice(-HISTORY_CAP);
}

// The version a mod shows now, as a history entry.
export function currentVersion(mod) {
  return { prompt: mod.refined || mod.prompt || "", css: mod.css || "", js: mod.js || "", at: mod.updated || null };
}

function withCode(mod, v, now) {
  const out = { ...mod, css: v.css || "", js: v.js || "", updated: now };
  if (v.prompt && v.prompt !== mod.prompt) out.refined = v.prompt;
  else delete out.refined;
  return out;
}

// Replaces the code with `next` ({ prompt, css, js }) and keeps the version it
// replaces. `next.prompt` is the follow-up that asked for it.
export function reviseMod(mod, next, now = new Date().toISOString()) {
  const history = [...versionsOf(mod), currentVersion(mod)].slice(-HISTORY_CAP);
  return withCode({ ...mod, history }, next, now);
}

// Brings back version `index` of versionsOf(mod). The current version is kept
// in the history too, so restoring never loses anything.
export function restoreVersion(mod, index, now = new Date().toISOString()) {
  const v = versionsOf(mod)[index];
  return v ? reviseMod(mod, v, now) : mod;
}

// One step back: the newest earlier version becomes current and the current
// one is dropped (undo for a refine). null when there is nothing earlier.
export function stepBack(mod, now = new Date().toISOString()) {
  const h = versionsOf(mod);
  const v = h.pop();
  return v ? withCode({ ...mod, history: h }, v, now) : null;
}

// "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", "Mar 2".
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const date = new Date(t);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}
