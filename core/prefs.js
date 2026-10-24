// User settings for the command bar (hotkeys, voice, appearance), as the
// hosts persist them (settings.get / settings.set) and the runtime reads them.
// Model settings (provider, base URL, key) live elsewhere and never reach the
// page; nothing secret belongs here.
//
// Pure and dependency-free: runtime/bundle.js inlines it into the runtime.

export const DEFAULT_PREFS = {
  hotkeys: { open: "", talk: "", mods: "", godmode: "" }, // "" = platform default, "none" = off
  voice: { autoSubmit: false },
  welcome: true,
  effects: "",        // "" = follow prefers-reduced-motion (full, or subtle when reduced); "full" | "subtle" | "off"
  barPosition: "auto", // "auto" (away from what you point at) | "top" | "bottom"
  theme: "auto",       // "auto" (match the app) | "light" | "dark"
};

const PREF_COMBO = /^((Ctrl|Alt|Shift|Meta)\+){0,4}[A-Za-z0-9]{1,24}$/;
const pickPref = (v, allowed, d) => (allowed.includes(v) ? v : d);

export function normalizePrefs(p) {
  const src = p && typeof p === "object" ? p : {};
  const hk = src.hotkeys && typeof src.hotkeys === "object" ? src.hotkeys : {};
  const hotkeys = {};
  for (const id of Object.keys(DEFAULT_PREFS.hotkeys)) {
    const v = hk[id];
    hotkeys[id] = v === "none" || (typeof v === "string" && PREF_COMBO.test(v)) ? v : "";
  }
  return {
    hotkeys,
    voice: { autoSubmit: !!src.voice?.autoSubmit },
    welcome: src.welcome !== false,
    effects: pickPref(src.effects, ["", "full", "subtle", "off"], ""),
    barPosition: pickPref(src.barPosition, ["auto", "top", "bottom"], "auto"),
    theme: pickPref(src.theme, ["auto", "light", "dark"], "auto"),
  };
}

// One level deep, so a patch like { hotkeys: { open: "Alt+KeyK" } } keeps the
// other hotkeys.
export function mergePrefs(base, patch) {
  const a = normalizePrefs(base), out = { ...a };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? { ...a[k], ...v } : v;
  }
  return normalizePrefs(out);
}

// Prompt history: newest last; repeating a prompt moves it to the end; capped.
export const HISTORY_MAX = 50;
export function pushHistory(list, text) {
  const t = String(text || "").trim();
  const out = (Array.isArray(list) ? list : []).filter(x => typeof x === "string" && x !== t);
  if (t) out.push(t.slice(0, 2000));
  return out.slice(-HISTORY_MAX);
}
