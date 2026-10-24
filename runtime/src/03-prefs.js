// Settings the user controls from the bar (hotkeys, voice, appearance). The
// shape and defaults are core/prefs.js and the hotkey logic is core/hotkeys.js,
// both inlined above by runtime/bundle.js. The host persists them
// (settings.get / settings.set); an older host without those falls back to
// this page's localStorage.

const PLATFORM = detectPlatform(navigator);
let PREFS = normalizePrefs({});
let HOTKEYS = resolveHotkeys(PREFS.hotkeys, PLATFORM);
const prefsSubs = new Set();

const hotkey = id => HOTKEYS[id] || "";
const hotkeyText = id => formatCombo(hotkey(id), PLATFORM);
const primaryMod = PLATFORM === "mac" ? "⌘" : "Ctrl";
// Key caps for a combo or a list of key names.
function caps(keys) {
  const parts = Array.isArray(keys) ? keys : comboParts(keys, PLATFORM);
  return parts.length ? `<span class="caps">${parts.map(k => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : `<span class="caps off">Off</span>`;
}

function reducedMotion() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } }
function effectLevel() { return PREFS.effects || (reducedMotion() ? "subtle" : "full"); }
function themeOverride() { return PREFS.theme === "auto" ? "" : PREFS.theme; }

function setPrefs(p) {
  PREFS = normalizePrefs(p);
  HOTKEYS = resolveHotkeys(PREFS.hotkeys, PLATFORM);
  HOTKEY = hotkeyText("open") || HOTKEY;
  hostEl.dataset.fx = effectLevel();
  applyTheme();
  prefsSubs.forEach(fn => { try { fn(PREFS); } catch (e) { console.warn("[morse]", e); } });
}

const PREFS_LS = "morse:settings";
const lsPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_LS) || "null"); } catch { return null; } };

async function loadPrefs() {
  try { setPrefs(await call("settings.get")); }
  catch { setPrefs(lsPrefs() || {}); }
}
// Picks up changes made in another tab or window when this one regains focus.
let prefsAt = 0;
function refreshPrefs() {
  if (Date.now() - prefsAt < 1500) return;
  prefsAt = Date.now();
  loadPrefs().catch(() => {});
}
addEventListener("focus", refreshPrefs);

async function savePrefs(patch) {
  setPrefs(mergePrefs(PREFS, patch));
  try {
    const saved = await call("settings.set", { settings: patch });
    if (saved) setPrefs(saved);
  } catch {
    try { localStorage.setItem(PREFS_LS, JSON.stringify(PREFS)); } catch {}
  }
  prefsAt = Date.now();
  return PREFS;
}
