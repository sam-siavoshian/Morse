// Hotkeys: parse, format, match and vet keyboard shortcuts.
//
// A combo is a string of modifiers in a fixed order plus one physical key,
// named by KeyboardEvent.code so it doesn't change with the keyboard layout:
//   "Alt+Space", "Ctrl+Shift+Space", "Alt+Shift+KeyM", "Meta+Comma"
// "" means "use the platform default" and "none" means "turned off".
//
// Pure: the hosts import it, and runtime/bundle.js inlines it into the in-app
// runtime (so no imports here besides core/i18n.js, which the bundle inlines
// first). Labels and messages are in the person's language (t()).
import { t } from "./i18n.js";

export const HOTKEY_MODS = ["Ctrl", "Alt", "Shift", "Meta"];

export const HOTKEY_ACTIONS = [
  { id: "open", get label() { return t("hk.open"); } },
  { id: "talk", get label() { return t("hk.talk"); }, hold: true },
  { id: "mods", get label() { return t("hk.mods"); } },
  { id: "godmode", get label() { return t("hk.godmode"); } },
  { id: "off", get label() { return t("hk.off"); } }, // the off switch (runtime/src/63-control.js)
];

export function detectPlatform(nav = globalThis.navigator) {
  const p = String(nav?.platform || nav?.userAgentData?.platform || nav?.userAgent || "");
  if (/mac|iphone|ipad|darwin/i.test(p)) return "mac";
  if (/win/i.test(p)) return "win";
  return "linux";
}

// One chord on every platform, registered with the OS by the desktop process
// (desktop-app/shortcut.js) so the focused app can't eat it. Option+Space is
// not that chord: Windows, GNOME, Xfce and KDE own Alt+Space, so a global
// Option+Space never arrives. Control+Space switches the Mac input source.
// Command+Space is Spotlight. Ctrl+Alt+Space is free of those.
// Push to talk defaults to holding the open hotkey: tap to open, hold to talk.
export function defaultHotkeys(platform) {
  const open = "Ctrl+Alt+Space";
  return { open, talk: open, mods: "Alt+Shift+KeyM", godmode: "Alt+Shift+KeyG", off: "Alt+Shift+Digit0" };
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
  if (str === "none") return t("hk.offShort");
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

// What each one does: message ids "hk.does.<name>" (core/locales/en.js).
const HK_CRITICAL = {
  mac: {
    "Meta+KeyQ": "quitApp", "Meta+KeyW": "closeWindowOrTab", "Meta+KeyT": "newTab",
    "Meta+KeyN": "newWindow", "Meta+KeyR": "reload", "Meta+KeyL": "addressBar",
    "Meta+KeyH": "hideApp", "Meta+KeyM": "minimize", "Meta+Space": "spotlight",
    "Meta+Tab": "switchApps", "Alt+Meta+Escape": "forceQuit", "Ctrl+Meta+KeyQ": "lockScreen",
    "Meta+Shift+KeyQ": "logOut", "Meta+Shift+KeyW": "closeWindow", "Ctrl+Meta+Space": "emoji",
  },
  other: {
    "Alt+F4": "closeWindow", "Alt+Tab": "switchWindows", "Ctrl+KeyW": "closeTab", "Ctrl+KeyT": "newTab",
    "Ctrl+KeyN": "newWindow", "Ctrl+KeyR": "reload", "Ctrl+KeyL": "addressBar",
    "Ctrl+KeyQ": "quitApp", "Ctrl+Shift+KeyQ": "quitBrowser", "Ctrl+Shift+KeyW": "closeWindow",
    "Ctrl+Shift+KeyN": "privateWindow", "Ctrl+Alt+Delete": "system", "Ctrl+Shift+Escape": "taskManager",
    "Ctrl+Tab": "switchTabs", "Ctrl+Shift+Tab": "switchTabs", "Ctrl+F4": "closeTab", "Meta+KeyL": "lockComputer",
    "Meta+Tab": "switchWindows", "Alt+Escape": "switchWindows",
  },
};
const HK_CRITICAL_WIN = { "Alt+Space": "windowMenu" };
// Common app shortcuts: message ids "hk.app.<name>".
const HK_COMMON = {
  KeyC: "copy", KeyV: "paste", KeyX: "cut", KeyZ: "undo", KeyY: "redo", KeyA: "selectAll", KeyS: "save", KeyF: "find",
  KeyP: "print", KeyK: "palette", KeyB: "bold", KeyI: "italic", KeyU: "underline", KeyO: "open",
  KeyD: "bookmark", KeyE: "search", KeyG: "findNext", KeyJ: "downloads", KeyH: "history", Comma: "settings",
  Equal: "zoomIn", Minus: "zoomOut", Digit0: "resetZoom", Slash: "search", Enter: "send",
};


// -> { level: "ok" | "warn" | "error", message }
// others: { [actionId]: combo } for the other bindings (already resolved).
export function checkCombo(str, platform, { self = "", others = {} } = {}) {
  if (str === "none") return { level: "ok", message: "" };
  const c = parseCombo(str);
  if (!c) return { level: "error", message: t("hk.err.noKey") };
  const combo = stringifyCombo(c);
  const shown = formatCombo(combo, platform);
  const fkey = /^F(1[3-9]|2[0-4])$/.test(c.code);
  const strong = c.ctrl || c.alt || c.meta;
  if (!strong && !fkey) {
    const need = platform === "mac" ? t("hk.need.mac") : t("hk.need.other");
    return { level: "error", message: c.shift ? t("hk.err.typesChar", { shown, need }) : t("hk.err.single", { need }) };
  }
  const table = platform === "mac" ? HK_CRITICAL.mac : { ...HK_CRITICAL.other, ...(platform === "win" ? HK_CRITICAL_WIN : {}) };
  if (table[combo]) return { level: "error", message: t("hk.err.critical", { shown, what: t("hk.does." + table[combo]) }) };
  for (const [id, other] of Object.entries(others)) {
    if (id === self || !other || normalizeCombo(other) !== combo) continue;
    const pair = [self, id].sort().join("+");
    if (pair === "open+talk") return { level: "ok", message: t("hk.ok.openTalk") };
    const label = HOTKEY_ACTIONS.find(a => a.id === id)?.label || id;
    return { level: "error", message: t("hk.err.used", { label }) };
  }
  const primary = platform === "mac" ? c.meta && !c.ctrl : c.ctrl && !c.meta;
  if (primary && !c.alt && HK_COMMON[c.code]) return { level: "warn", message: t("hk.warn.common", { shown, what: t("hk.app." + HK_COMMON[c.code]) }) };
  if (platform === "mac" && c.ctrl && !c.alt && !c.meta && c.code === "Space") return { level: "warn", message: t("hk.warn.macCtrlSpace") };
  if (platform !== "mac" && c.ctrl && !c.alt && !c.shift && c.code === "Space") return { level: "warn", message: t("hk.warn.ctrlSpace") };
  if (platform === "linux" && combo === "Alt+Space") return { level: "warn", message: t("hk.warn.linuxAltSpace") };
  if (platform === "mac" && c.alt && !c.ctrl && !c.meta && /^(Key|Digit)/.test(c.code)) return { level: "warn", message: t("hk.warn.macAlt", { shown }) };
  if (platform !== "mac" && c.alt && !c.ctrl && !c.meta && !c.shift && /^Key/.test(c.code)) return { level: "warn", message: t("hk.warn.altMenu", { shown }) };
  return { level: "ok", message: "" };
}

// The open chord before Ctrl+Alt+Space. On a Mac the bar saved Option+Space
// itself ("" means "the default", but recording the keys stored "Alt+Space").
// That was the old default, not a choice. Windows and Linux never used it as
// the default, so a saved Alt+Space there is kept. Call once: after someone
// sets Option+Space on purpose, leave it alone.
export function migrateStoredOpen(stored = {}, platform) {
  const src = stored && typeof stored === "object" ? { ...stored } : {};
  if (platform === "mac" && normalizeCombo(src.open) === "Alt+Space") src.open = "";
  return src;
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

// Saving the shortcut that opens Morse. "" or "default" goes back to this
// computer's usual keys, and recording those keys again stores nothing, so an
// untouched shortcut stays the platform default. A combo Morse can't use
// (no real key, a key that types, one the system owns, or one Morse already
// uses) comes back as an error in the person's language. A warning is allowed.
export function decideOpenShortcut(stored = {}, next, platform) {
  if (next === "" || next === "default") return { ok: true, value: "", level: "ok", message: "" };
  const combo = normalizeCombo(next);
  if (!combo || combo === "none") return { ok: false, value: "", level: "error", message: combo === "none" ? t("hk.err.openOff") : t("hk.err.noKey") };
  const src = stored && typeof stored === "object" ? stored : {};
  const resolved = resolveHotkeys(src, platform);
  const others = { ...resolved };
  delete others.open;
  if (!src.talk) delete others.talk; // talk left alone follows Open Morse
  const verdict = checkCombo(combo, platform, { self: "open", others });
  if (verdict.level === "error") return { ok: false, value: "", level: "error", message: verdict.message };
  const value = combo === defaultHotkeys(platform).open ? "" : combo;
  return { ok: true, value, level: verdict.level, message: verdict.message || "" };
}
