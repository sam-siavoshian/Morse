// The only way the window can ask Morse Desktop for anything. Each request
// has one channel ("morse:<name>"), a check of its arguments, and one method
// to call. Requests from anything but Morse's own page in Morse's own window
// are refused. preload.cjs exposes exactly these names, nothing else
// (tests/desktop-app.test.js checks that the two lists match).
//
// No Electron here: main.js passes ipcMain, the service and `native` (the
// file picker, the folder and link openers, the login item), and tests pass
// fakes.

export const CHANNEL = name => `morse:${name}`;
export const PUSH = "morse:changed"; // main -> window: something changed; carries the new state

const ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const id = v => { if (typeof v !== "string" || !ID.test(v)) throw new TypeError("bad id"); return v; };
const bool = v => { if (typeof v !== "boolean") throw new TypeError("bad switch"); return v; };
const oneOf = (...ok) => v => { if (!ok.includes(v)) throw new TypeError("bad choice"); return v; };
const opt = check => v => (v === undefined || v === null ? undefined : check(v));
const key = v => {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || v.length > 400 || /\s/.test(v.trim())) throw new TypeError("bad key");
  return v.trim();
};
const none = () => undefined;
const askId = v => { if (typeof v !== "string" || !/^[\w-]{10,64}$/.test(v)) throw new TypeError("bad request id"); return v; };

// Links the window may open in the browser, by name. Never an address from the window.
export const LINKS = {
  docs: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/desktop-app.md",
  models: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/models.md",
  chrome: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/getting-started.md", // no anchor: the page's headings are changing (onboarding v2)
  troubleshooting: "https://github.com/sam-siavoshian/RRAA/blob/main/docs/troubleshooting.md",
};

// name -> [argument checks, (service, native, ...args) => result]
export const API = {
  state:              [[none], (s) => s.state()],
  refreshApps:        [[none], (s) => s.state({ fresh: true })],
  openApp:            [[id, opt(oneOf("y", "a"))], (s, n, appId, answer) => s.openApp(appId, { answer })],
  disconnectApp:      [[id], (s, n, appId) => s.disconnectApp(appId)],
  addApp:             [[none], async (s, n) => { const file = await n.pickApp(); return file ? s.addApp(file) : { cancelled: true }; }],
  modelChoices:       [[none], (s) => s.modelChoices()],
  chooseModel:        [[oneOf("claude-code", "codex", "api-key"), key], (s, n, choice, k) => s.chooseModel(choice, k)],
  checkModel:         [[none], (s) => s.check()],
  setHelper:          [[bool], (s, n, on) => s.setSetting("helper", on).then(() => s.chrome())],
  newPairingCode:     [[none], (s) => s.newCode()],
  answerAsk:          [[askId, bool], (s, n, id, allow) => s.answerAsk(id, allow)],
  signOutBrowsers:    [[none], (s) => s.signOutBrowsers()],
  showExtensionFolder:[[none], async (s, n) => n.showFolder(await s.extensionFolder())],
  setModOn:           [[id, bool], (s, n, modId, on) => s.setModOn(modId, on)],
  setAllModsOff:      [[bool], (s, n, off) => s.setAllModsOff(off)],
  runChecks:          [[none], (s) => s.doctor()],
  setStartAtLogin:    [[bool], async (s, n, on) => { await n.setLoginItem(on); return s.setSetting("startAtLogin", on); }],
  openLink:           [[oneOf(...Object.keys(LINKS))], (s, n, name) => n.openExternal(LINKS[name])],
  finishWelcome:      [[none], (s) => s.setSetting("welcomed", true)],
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
