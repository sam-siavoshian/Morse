// Hotkeys: parse, format, match and vet keyboard shortcuts.
//
// A combo is a string of modifiers in a fixed order plus one physical key,
// named by KeyboardEvent.code so it doesn't change with the keyboard layout:
//   "Alt+Space", "Ctrl+Shift+Space", "Alt+Shift+KeyM", "Meta+Comma"
// "" means "use the platform default" and "none" means "turned off".
//
// Pure and dependency-free: the hosts import it, and runtime/bundle.js
// inlines it into the in-app runtime (so no imports here, ever).

export const HOTKEY_MODS = ["Ctrl", "Alt", "Shift", "Meta"];

export const HOTKEY_ACTIONS = [
  { id: "open", label: "Open Morse" },
  { id: "talk", label: "Push to talk", hold: true },
  { id: "mods", label: "Mods panel" },
  { id: "godmode", label: "Edit tools" },
];

export function detectPlatform(nav = globalThis.navigator) {
  const p = String(nav?.platform || nav?.userAgentData?.platform || nav?.userAgent || "");
  if (/mac|iphone|ipad|darwin/i.test(p)) return "mac";
  if (/win/i.test(p)) return "win";
  return "linux";
}

// Alt+Space opens the window menu on Windows and on GNOME/Xfce, and KRunner on
// KDE, so only macOS gets ⌥Space; everywhere else it's Ctrl+Shift+Space.
// Push to talk defaults to holding the open hotkey: tap to open, hold to talk.
export function defaultHotkeys(platform) {
  const open = platform === "mac" ? "Alt+Space" : "Ctrl+Shift+Space";
  return { open, talk: open, mods: "Alt+Shift+KeyM", godmode: "Alt+Shift+KeyG" };
}

const HK_MOD_ALIASES = {
  ctrl: "Ctrl", control: "Ctrl", ctl: "Ctrl", "⌃": "Ctrl",
  alt: "Alt", option: "Alt", opt: "Alt", "⌥": "Alt",
  shift: "Shift", "⇧": "Shift",
  meta: "Meta", cmd: "Meta", command: "Meta", super: "Meta", win: "Meta", os: "Meta", "⌘": "Meta",
};
const HK_KEY_ALIASES = {
  " ": "Space", space: "Space", ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote",
  "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "-": "Minus", "=": "Equal", "`": "Backquote",
  esc: "Escape", escape: "Escape", enter: "Enter", return: "Enter", tab: "Tab", backspace: "Backspace", delete: "Delete",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
const HK_MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock|AltGraph)$/;

export const isModifierCode = code => HK_MODIFIER_CODES.test(String(code || ""));

function normalizeKey(k) {
  if (!k) return "";
  if (HK_KEY_ALIASES[k] || HK_KEY_ALIASES[k.toLowerCase()]) return HK_KEY_ALIASES[k] || HK_KEY_ALIASES[k.toLowerCase()];
  if (/^[a-z]$/i.test(k)) return "Key" + k.toUpperCase();
  if (/^[0-9]$/.test(k)) return "Digit" + k;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
  return k;
}

// "cmd+shift+m" | "⌥Space" | "Alt+Shift+KeyM" -> { ctrl, alt, shift, meta, code } or null
export function parseCombo(str) {
  if (!str || str === "none") return null;
  const s = String(str).trim();
  const out = { ctrl: false, alt: false, shift: false, meta: false, code: "" };
  // Glyph form: leading modifier symbols, then the key.
  let rest = s;
  while (rest && "⌃⌥⇧⌘".includes(rest[0])) { out[HK_MOD_ALIASES[rest[0]].toLowerCase()] = true; rest = rest.slice(1); }
  const parts = rest.split("+").map(p => p.trim());
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const mod = HK_MOD_ALIASES[p.toLowerCase()];
    if (mod && i < parts.length - 1) { out[mod.toLowerCase()] = true; continue; }
    if (i !== parts.length - 1) return null;
    out.code = normalizeKey(p);
  }
  if (!out.code || isModifierCode(out.code)) return null;
  return out;
}

export function stringifyCombo(c) {
  if (!c || !c.code) return "";
  return [c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Shift", c.meta && "Meta", c.code].filter(Boolean).join("+");
}

export function normalizeCombo(str) {
  if (str === "none") return "none";
  return stringifyCombo(parseCombo(str));
}

// From a keydown. Modifier-only presses come back as { modifiers: [...] } so a
// recorder can show what's held so far.
export function comboFromEvent(e) {
  const c = { ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey, code: e.code || "" };
  if (!c.code || isModifierCode(c.code)) return { combo: "", partial: stringifyCombo({ ...c, code: "·" }).replace(/\+?·$/, "") };
  return { combo: stringifyCombo(c), partial: "" };
}

export function matchCombo(e, str) {
  const c = typeof str === "string" ? parseCombo(str) : str;
  if (!c) return false;
  return e.code === c.code && !!e.ctrlKey === c.ctrl && !!e.altKey === c.alt && !!e.shiftKey === c.shift && !!e.metaKey === c.meta;
}

// Releasing the key, or any modifier the combo needs, ends a hold.
export function releasesCombo(e, str) {
  const c = typeof str === "string" ? parseCombo(str) : str;
  if (!c) return false;
  if (e.code === c.code) return true;
  const m = String(e.code).replace(/(Left|Right)$/, "");
  return (m === "Control" && c.ctrl) || (m === "Alt" && c.alt) || (m === "Shift" && c.shift) || ((m === "Meta" || m === "OS") && c.meta);
}

const HK_KEY_LABELS = {
  Space: "Space", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`", Escape: "Esc", Delete: "Del", PageUp: "PgUp", PageDown: "PgDn",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", IntlBackslash: "§",
};
const HK_MAC_KEY_LABELS = { Enter: "↩", Backspace: "⌫", Tab: "⇥", Delete: "⌦", Escape: "⎋" };

export function keyLabel(code, platform) {
  if (platform === "mac" && HK_MAC_KEY_LABELS[code]) return HK_MAC_KEY_LABELS[code];
  if (HK_KEY_LABELS[code]) return HK_KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return "Num" + code.slice(6);
  return code;
}

// Separate key caps: ["⌥", "Space"] on macOS, ["Ctrl", "Shift", "Space"] elsewhere.
// macOS orders modifiers ⌃⌥⇧⌘, like its menus do.
export function comboParts(str, platform) {
  const c = typeof str === "string" ? parseCombo(str) : str;
  if (!c) return [];
  const mac = platform === "mac";
  const metaName = platform === "win" ? "Win" : "Super";
  const mods = mac
    ? [c.ctrl && "⌃", c.alt && "⌥", c.shift && "⇧", c.meta && "⌘"]
    : [c.ctrl && "Ctrl", c.meta && metaName, c.alt && "Alt", c.shift && "Shift"];
  return [...mods.filter(Boolean), keyLabel(c.code, platform)];
}

export function formatCombo(str, platform) {
  if (str === "none") return "Off";
  const parts = comboParts(str, platform);
  if (!parts.length) return "";
  return platform === "mac" ? parts.join("") : parts.join("+");
}

// Modifiers as the recorder shows them while they're held: "⌥⇧" / "Alt+Shift+".
export function formatPartial(partial, platform) {
  if (!partial) return "";
  const c = { ctrl: /Ctrl/.test(partial), alt: /Alt/.test(partial), shift: /Shift/.test(partial), meta: /Meta/.test(partial) };
  const parts = comboParts({ ...c, code: "X" }, platform).slice(0, -1);
  return platform === "mac" ? parts.join("") : parts.map(p => p + "+").join("");
}

// ---- vetting
//
// Critical OS/browser shortcuts are rejected outright: binding them would quit,
// close or reload the app. Common app shortcuts are allowed with a warning.

const HK_CRITICAL = {
  mac: {
    "Meta+KeyQ": "quits the app", "Meta+KeyW": "closes the window or tab", "Meta+KeyT": "opens a new tab",
    "Meta+KeyN": "opens a new window", "Meta+KeyR": "reloads the page", "Meta+KeyL": "focuses the address bar",
    "Meta+KeyH": "hides the app", "Meta+KeyM": "minimizes the window", "Meta+Space": "opens Spotlight",
    "Meta+Tab": "switches apps", "Alt+Meta+Escape": "opens Force Quit", "Ctrl+Meta+KeyQ": "locks the screen",
    "Meta+Shift+KeyQ": "logs you out", "Meta+Shift+KeyW": "closes the window", "Ctrl+Meta+Space": "opens the emoji picker",
  },
  other: {
    "Alt+F4": "closes the window", "Alt+Tab": "switches windows", "Ctrl+KeyW": "closes the tab", "Ctrl+KeyT": "opens a new tab",
    "Ctrl+KeyN": "opens a new window", "Ctrl+KeyR": "reloads the page", "Ctrl+KeyL": "focuses the address bar",
    "Ctrl+KeyQ": "quits the app", "Ctrl+Shift+KeyQ": "quits the browser", "Ctrl+Shift+KeyW": "closes the window",
    "Ctrl+Shift+KeyN": "opens a private window", "Ctrl+Alt+Delete": "is reserved by the system", "Ctrl+Shift+Escape": "opens Task Manager",
    "Ctrl+Tab": "switches tabs", "Ctrl+Shift+Tab": "switches tabs", "Ctrl+F4": "closes the tab", "Meta+KeyL": "locks the computer",
    "Meta+Tab": "switches windows", "Alt+Escape": "switches windows",
  },
};
const HK_CRITICAL_WIN = { "Alt+Space": "opens the window menu on Windows" };
const HK_COMMON = {
  KeyC: "Copy", KeyV: "Paste", KeyX: "Cut", KeyZ: "Undo", KeyY: "Redo", KeyA: "Select all", KeyS: "Save", KeyF: "Find",
  KeyP: "Print", KeyK: "the command palette", KeyB: "Bold", KeyI: "Italic", KeyU: "Underline", KeyO: "Open",
  KeyD: "Bookmark", KeyE: "Search", KeyG: "Find next", KeyJ: "Downloads", KeyH: "History", Comma: "Settings",
  Equal: "Zoom in", Minus: "Zoom out", Digit0: "Reset zoom", Slash: "Search", Enter: "Send",
};


// -> { level: "ok" | "warn" | "error", message }
// others: { [actionId]: combo } for the other bindings (already resolved).
export function checkCombo(str, platform, { self = "", others = {} } = {}) {
  if (str === "none") return { level: "ok", message: "" };
  const c = parseCombo(str);
  if (!c) return { level: "error", message: "Add a letter or another key, not just Shift, Ctrl or Alt." };
  const combo = stringifyCombo(c);
  const shown = formatCombo(combo, platform);
  const fkey = /^F(1[3-9]|2[0-4])$/.test(c.code);
  const strong = c.ctrl || c.alt || c.meta;
  if (!strong && !fkey) {
    const need = platform === "mac" ? "⌘, ⌥ or ⌃" : "Ctrl or Alt";
    return { level: "error", message: c.shift ? `${shown} types a character. Add ${need}.` : `A single key would fire while you type. Add ${need}.` };
  }
  const table = platform === "mac" ? HK_CRITICAL.mac : { ...HK_CRITICAL.other, ...(platform === "win" ? HK_CRITICAL_WIN : {}) };
  if (table[combo]) return { level: "error", message: `${shown} ${table[combo]}. Pick another.` };
  for (const [id, other] of Object.entries(others)) {
    if (id === self || !other || normalizeCombo(other) !== combo) continue;
    const pair = [self, id].sort().join("+");
    if (pair === "open+talk") return { level: "ok", message: "Same as Open Morse: tap to open, hold to talk." };
    const label = HOTKEY_ACTIONS.find(a => a.id === id)?.label || id;
    return { level: "error", message: `Already used for ${label}.` };
  }
  const primary = platform === "mac" ? c.meta && !c.ctrl : c.ctrl && !c.meta;
  if (primary && !c.alt && HK_COMMON[c.code]) return { level: "warn", message: `${shown} is ${HK_COMMON[c.code]} in most apps. Morse will take it over.` };
  if (platform === "mac" && c.ctrl && !c.alt && !c.meta && c.code === "Space") return { level: "warn", message: "⌃Space switches the keyboard language on many Macs." };
  if (platform !== "mac" && c.ctrl && !c.alt && !c.shift && c.code === "Space") return { level: "warn", message: "Ctrl+Space opens suggestions in many code editors." };
  if (platform === "linux" && combo === "Alt+Space") return { level: "warn", message: "Alt+Space opens the window menu on GNOME and Xfce, and KRunner on KDE." };
  if (platform === "mac" && c.alt && !c.ctrl && !c.meta && /^(Key|Digit)/.test(c.code)) return { level: "warn", message: `${shown} types a special character in text fields. Morse will take it over.` };
  if (platform !== "mac" && c.alt && !c.ctrl && !c.meta && !c.shift && /^Key/.test(c.code)) return { level: "warn", message: `${shown} opens a menu in many desktop apps.` };
  return { level: "ok", message: "" };
}

// The bindings in effect: stored values over platform defaults; "none" is off ("").
export function resolveHotkeys(stored = {}, platform) {
  const d = defaultHotkeys(platform), out = {};
  for (const { id } of HOTKEY_ACTIONS) {
    const v = stored[id];
    out[id] = v === "none" ? "" : normalizeCombo(v) || d[id];
  }
  // Push to talk left at its default follows Open Morse (tap opens, hold talks).
  if (!stored.talk) out.talk = out.open;
  return out;
}
