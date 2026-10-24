// User control state: pausing Morse (on one site or app, or everywhere) and
// "safe start", which notices when a page keeps closing or reloading within
// seconds after a mod ran and holds that mod back until the person decides.
//
// The hosts persist one object (chrome.storage.local "morse.control",
// ~/.morse/control.json); everything here is a pure function of it.
// Pure and dependency-free: runtime/bundle.js inlines it into the runtime.

export const SAFE_WINDOW = 6000;     // a page that ends this soon after a mod ran counts as a strike
export const SAFE_STRIKES = 3;       // strikes in a row before the mod is held back
export const SAFE_SPAN = 120000;     // a strike only counts if the next load comes within this
export const SAFE_MAX_RECORDS = 100; // tabs remembered for safe start

const emptyControl = () => ({ pause: { all: false, sites: {} }, safe: {} });

export function normalizeControl(c) {
  const out = emptyControl();
  if (!c || typeof c !== "object") return out;
  const p = c.pause && typeof c.pause === "object" ? c.pause : {};
  out.pause.all = p.all === true;
  if (p.sites && typeof p.sites === "object") {
    for (const [k, v] of Object.entries(p.sites)) if (k && v) out.pause.sites[k] = typeof v === "string" ? v : new Date(0).toISOString();
  }
  if (c.safe && typeof c.safe === "object") {
    for (const [k, v] of Object.entries(c.safe)) if (v && typeof v === "object") out.safe[k] = v;
  }
  return out;
}

// Pauses are filed under the desktop app's id, or the website's host.
export function controlKey({ url, app } = {}) {
  if (app) return String(app);
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? "file" : u.host || "*";
  } catch { return "*"; }
}

export function isPaused(c, where) {
  const s = normalizeControl(c);
  return s.pause.all || !!s.pause.sites[controlKey(where)];
}

// What the popup, the panel and the CLI show.
export function pauseInfo(c, where) {
  const s = normalizeControl(c);
  const key = where ? controlKey(where) : "";
  return { all: s.pause.all, here: !!(key && s.pause.sites[key]), key, sites: Object.keys(s.pause.sites).sort() };
}

// { all: true|false } pauses or resumes everywhere; { key, on } one site or app.
export function setPause(c, { all, key, on }) {
  const s = normalizeControl(c);
  const now = new Date().toISOString();
  if (typeof all === "boolean") s.pause.all = all;
  if (key) { if (on) s.pause.sites[key] ||= now; else delete s.pause.sites[key]; }
  return s;
}

// ---- safe start
//
// Each page load (per site and tab) records when it started, which mods ran
// and when, and the last time it was seen alive. When the next load in that
// tab comes and the previous one ended less than SAFE_WINDOW after a mod ran,
// that's a strike against the mod most likely to blame. SAFE_STRIKES in a row
// and the mod becomes the "suspect": the runtime holds it back and asks.

export const safeKey = (where, tab) => `${controlKey(where)}|${tab || ""}`;

function blame(applied) {
  const js = applied.filter(a => a.js);
  const pool = js.length ? js : applied;
  return pool.reduce((best, a) => (!best || String(a.updated || "") >= String(best.updated || "") ? a : best), null);
}

function prune(safe) {
  const keys = Object.keys(safe);
  if (keys.length <= SAFE_MAX_RECORDS) return safe;
  keys.sort((a, b) => (safe[b].s?.boot || 0) - (safe[a].s?.boot || 0));
  const out = {};
  for (const k of keys.slice(0, SAFE_MAX_RECORDS)) out[k] = safe[k];
  return out;
}

// A page loaded. -> { state, suspect }
export function safeBoot(c, key, now) {
  const s = normalizeControl(c);
  const r = { strikes: 0, blame: null, suspect: null, ...s.safe[key] };
  const prev = r.s;
  if (prev && Array.isArray(prev.applied) && prev.applied.length && prev.at) {
    const died = (prev.alive || prev.at) - prev.at < SAFE_WINDOW && now - prev.at < SAFE_SPAN;
    if (died) { r.strikes += 1; r.blame = blame(prev.applied); }
    else { r.strikes = 0; r.blame = null; }
  }
  if (r.strikes >= SAFE_STRIKES && r.blame) r.suspect = { id: r.blame.id, title: r.blame.title || "", strikes: r.strikes };
  r.s = { boot: now, at: 0, alive: now, applied: [] };
  s.safe = prune({ ...s.safe, [key]: r });
  return { state: s, suspect: r.suspect };
}

// A mod ran on the page.
export function safeApplied(c, key, mod, now) {
  const s = normalizeControl(c);
  const r = { strikes: 0, blame: null, suspect: null, ...s.safe[key] };
  const sess = r.s || { boot: now, applied: [] };
  const entry = { id: String(mod?.id || ""), title: String(mod?.title || "").slice(0, 120), updated: mod?.updated || "", js: !!mod?.js };
  sess.applied = [...(sess.applied || []).filter(a => a.id !== entry.id), entry];
  sess.at = now;
  sess.alive = now;
  r.s = sess;
  s.safe = { ...s.safe, [key]: r };
  return s;
}

// The page is still there. Past SAFE_WINDOW after the last mod ran, the mods
// that ran are cleared: strikes reset, and a suspect that ran fine is let go.
export function safeAlive(c, key, now) {
  const s = normalizeControl(c);
  const r = s.safe[key];
  if (!r?.s) return s;
  r.s.alive = Math.max(r.s.alive || 0, now);
  if (r.s.at && now - r.s.at >= SAFE_WINDOW) {
    r.strikes = 0;
    r.blame = null;
    if (r.suspect && r.s.applied?.some(a => a.id === r.suspect.id)) r.suspect = null;
  }
  return s;
}

// The person decided (turned the mod off, or back on): start counting afresh.
export function safeForgive(c, key) {
  const s = normalizeControl(c);
  const r = s.safe[key];
  if (r) { r.strikes = 0; r.blame = null; r.suspect = null; if (r.s) r.s.applied = []; }
  return s;
}
