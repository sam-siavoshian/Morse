const S = B.S; // shared with boot.js: open, phase, target, draft, label, mode, app, mods, url…
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
let HOTKEY = isMac ? "⌥Space" : "Alt+Space"; // updated from settings (03-prefs.js)
