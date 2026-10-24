// Mods waiting for “Allow User Scripts”. In the extension, mod code runs only
// through Chrome's “Allow User Scripts” (extension/background.js cantRun).
// While it is off, a mod's style still shows and its code doesn't run at all;
// the host answers "exec" with { waiting: "userScripts" }. This says which
// mods here are waiting and how to turn it on: once per page in a notice, in
// the bar's note (59-onboarding.js), on each mod in the Mods panel
// (63-control.js) and in the toolbar popup (extension/popup.js). Coming back
// to the tab gives the waiting mods another try.
// Hooks, each marked "waiting hook": 30-mods.js (applyMod), 59-onboarding.js
// (the note), 60-generate.js (the result), 63-control.js (panel rows).

const Waiting = (() => {
  const ids = new Set();
  let told = false, timer = 0;
  const list = () => S.mods.filter(m => m.enabled && ids.has(m.id));
  const names = l => l.length === 1 ? `“${l[0].title}”` : l.length === 2 ? `“${l[0].title}” and “${l[1].title}”` : `${l.length} mods`;
  function text(l = list()) {
    return `${names(l)} ${l.length === 1 ? "adds features that wait" : "add features that wait"} for “Allow User Scripts”. The new look already shows.`;
  }
  const STEPS = "Open Morse's details, turn on “Allow User Scripts”, then come back to this tab.";
  // A saved mod's code didn't run because “Allow User Scripts” is off.
  function add(m) {
    ids.add(m.id);
    if (!told) { clearTimeout(timer); timer = setTimeout(tell, 400); } // one notice for every mod the first sync finds
    if (!panel.hidden) renderPanel();
  }
  function tell() {
    const l = list();
    if (!l.length || told) return;
    told = true;
    // Once per site in this tab: the bar's note and the Mods panel keep saying it.
    try { if (sessionStorage.getItem("morse:waiting-told")) return; sessionStorage.setItem("morse:waiting-told", "1"); } catch {}
    controlToast(`${text(l)} ${STEPS}`, [["Not now", () => {}], ["Open Morse's details", open]], { sticky: true, title: "Turn on “Allow User Scripts”" });
  }
  async function open() {
    let r = null;
    try { r = await call("onboarding.open", { what: "userscripts" }); } catch {}
    if (!r) toast("Open chrome://extensions, click Details under Morse, and turn on “Allow User Scripts”.");
  }
  // Back on this tab (maybe from Chrome's settings): try the waiting mods again.
  async function retry() {
    const l = list();
    if (!l.length) return;
    for (const m of l) ids.delete(m.id);
    for (const m of l) await applyMod(m).catch(() => {});
    const ran = l.filter(m => !ids.has(m.id));
    if (ran.length) toast(ran.length === 1 ? `“${ran[0].title}” is fully on now` : `${ran.length} mods are fully on now`);
    if (!panel.hidden) renderPanel();
  }
  listen("visibilitychange", () => { if (document.visibilityState === "visible") retry(); });
  listen("focus", () => retry());
  // The result of a new change whose code waits (or, on the practice page,
  // never runs). It never just looks done: the bar says the change needs
  // “Allow User Scripts” and offers the one click that opens it (offer).
  function note(res, id) {
    if (res?.waiting === "practice") return { note: "This is how it looks. What it adds works on real websites" };
    if (res?.waiting !== "userScripts") return {};
    ids.add(id); // once it is saved, the Mods panel and the bar's note list it
    return { note: "Needs “Allow User Scripts” to work. Only its look shows until you turn it on" };
  }
  function offer(res) {
    if (res?.waiting !== "userScripts" || actions.querySelector("[data-ob=userscripts]")) return;
    actions.insertAdjacentHTML("afterbegin", `<button type="button" class="primary" data-ob="userscripts">Turn on “Allow User Scripts”</button>`); // 59-onboarding.js opens Morse's details
    actions.querySelector("[data-a=keep]")?.classList.remove("primary");
  }
  return { add, has: id => ids.has(id), list, text, note, offer, quiet: false };
})();
