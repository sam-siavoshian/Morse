// The only way the window can ask Morse Desktop for anything. Each request
// has one channel ("morse:<name>"), a check of its arguments, and one method
// to call. Requests from anything but Morse's own page in Morse's own window
// are refused. preload.cjs exposes exactly these names, nothing else
// (tests/desktop-app.test.js checks that the two lists match).
//
// No Electron here: main.js passes ipcMain, the service and `native` (the
// file picker, the link opener, the login item), and tests pass
// fakes.

export const CHANNEL = name => `morse:${name}`;
export const PUSH = "morse:changed"; // main -> window: something changed; carries the new state

const ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const id = v => { if (typeof v !== "string" || !ID.test(v)) throw new TypeError("bad id"); return v; };
const bool = v => { if (typeof v !== "boolean") throw new TypeError("bad switch"); return v; };
const oneOf = (...ok) => v => { if (!ok.includes(v)) throw new TypeError("bad choice"); return v; };
const opt = check => v => (v === undefined || v === null ? undefined : check(v));
// A shortcut the window recorded: "" puts the platform default back. "none"
// and "default" are words the service answers in a sentence; anything else
// must already be modifiers plus one key, the way core/hotkeys.js stores them.
const shortcut = v => {
  if (v === "" || v === "none" || v === "default") return v;
  if (typeof v !== "string" || v.length > 80 || !/^((Ctrl|Alt|Shift|Meta)\+){0,4}[A-Za-z0-9]{1,24}$/.test(v)) throw new TypeError("bad shortcut");
  return v;
};
const key = v => {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || v.length > 400 || /\s/.test(v.trim())) throw new TypeError("bad key");
  return v.trim();
};
const none = () => undefined;

// Links the window may open in the browser, by name. Never an address from the window.
export const LINKS = {
  docs: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/desktop-app.md",
  models: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/models.md",
  troubleshooting: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/troubleshooting.md",
};

// name -> [argument checks, (service, native, ...args) => result]
export const API = {
  state:              [[none], async (s, n) => ({ ...(await s.state()), update: n.updateStatus?.() || { phase: "idle" } })],
  refreshApps:        [[none], async (s, n) => ({ ...(await s.state({ fresh: true })), update: n.updateStatus?.() || { phase: "idle" } })],
  openApp:            [[id, opt(oneOf("y", "a"))], (s, n, appId, answer) => s.openApp(appId, { answer })],
  openBar:            [[id], (s, n, appId) => s.openBar(appId)],
  disconnectApp:      [[id], (s, n, appId) => s.disconnectApp(appId)],
  addApp:             [[none], async (s, n) => { const file = await n.pickApp(); return file ? s.addApp(file) : { cancelled: true }; }],
  modelChoices:       [[none], (s) => s.modelChoices()],
  chooseModel:        [[oneOf("claude-code", "codex", "api-key"), key], (s, n, choice, k) => s.chooseModel(choice, k)],
  checkModel:         [[none], (s) => s.check()],
  setModOn:           [[id, bool], (s, n, modId, on) => s.setModOn(modId, on)],
  deleteMod:          [[id], (s, n, modId) => s.deleteMod(modId)],
  undeleteMod:        [[id], (s, n, modId) => s.undeleteMod(modId)],
  setAllModsOff:      [[bool], (s, n, off) => s.setAllModsOff(off)],
  runChecks:          [[none], (s) => s.doctor()],
  setStartAtLogin:    [[bool], async (s, n, on) => { await n.setLoginItem(on); return s.setSetting("startAtLogin", on); }],
  // Always open with Morse: needs Morse running, so it opens at login with it.
  setAutoOpen:        [[bool], async (s, n, on) => { await n.setLoginItem(on); await s.setSetting("startAtLogin", on); return s.setSetting("autoOpen", on); }],
  setOpenShortcut:    [[shortcut], (s, n, combo) => s.setOpenShortcut(combo)],
  openLink:           [[oneOf(...Object.keys(LINKS))], (s, n, name) => n.openExternal(LINKS[name])],
  finishWelcome:      [[none], (s) => s.setSetting("welcomed", true)],
  installUpdate:      [[none], (s, n) => ({ ok: n.installUpdate() })],
  updateLater:        [[none], (s, n) => ({ ok: n.updateLater() })],
};

// Registers every channel. isTrusted(event): the request came from Morse's
// own page in Morse's own window (main.js). A refused or malformed request
// gets { error }, never a thrown error with internals in it.
export function registerIpc({ ipcMain, service, native, isTrusted, log = () => {} }) {
  for (const [name, [checks, run]] of Object.entries(API)) {
    ipcMain.handle(CHANNEL(name), async (event, ...args) => {
      if (!isTrusted(event)) { log(`refused ${name}: not Morse's own window`); return { error: "Not allowed." }; }
      if (args.length > checks.length) return { error: "Not allowed." };
      let clean;
      try { clean = checks.map((c, i) => c(args[i])); }
      catch { return { error: "Not allowed." }; }
      try { return (await run(service, native, ...clean)) ?? { ok: true }; }
      catch (e) { log(`${name} failed: ${e?.stack || e}`); return { error: e?.plain ? e.message : "Something went wrong. Try again." }; }
    });
  }
  return Object.keys(API).map(CHANNEL);
}

// morse://open, the only link Morse Desktop takes (it shows the window).
export function isOpenLink(link) {
  try { const u = new URL(String(link)); return u.protocol === "morse:" && (u.hostname || u.pathname.replace(/^\/+|\/+$/g, "")) === "open"; } catch { return false; }
}
