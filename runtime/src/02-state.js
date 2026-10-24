const S = {
  open: false, picking: false, target: null, phase: "idle",
  draft: null, before: null, after: null, label: "", mode: "", app: null,
  mods: [], url: location.href,
};
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const HOTKEY = isMac ? "⌥ Space" : "Alt+Space";
