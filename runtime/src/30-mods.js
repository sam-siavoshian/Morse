function setCss(id, css) {
  let s = document.head.querySelector(`style[data-morse-css="${cssEsc(id)}"]`);
  if (!css) { s?.remove(); return; }
  if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
  if (s.textContent !== css) s.textContent = css;
}
async function applyMod(m) {
  if (modHeld(m)) return; // user control: off switch, pause, safe start (63-control.js)
  const look = guardBefore(m); if (!look) return; // guard hook: CSS that hides the whole page isn't applied (64-guard.js)
  setCss(m.id, m.css);
  if (m.js.trim()) {
    const r = await call("exec", { modId: m.id, js: m.js });
    if (r?.waiting) return Waiting.add(m); // waiting hook: “Allow User Scripts” is off; the style shows, the code never ran (64-waiting.js)
    Health.ran(m, r); // repair: the panel marks mods that stopped working (70-panel.js)
    if (!r.ok && !guardPaused(m, r) /* guard hook: 64-guard.js says why */) { console.warn("[morse]", m.title, r.error); toast(t("mod.failedHere", { title: m.title })); }
  }
  modRan(m); // safe start (63-control.js)
  guardAfter(m, look); // guard hook: its code hid the page (64-guard.js)
}
async function removeMod(id) { setCss(id, ""); await call("off", { modId: id }); }
async function syncMods() {
  const list = await call("mods.list", { url: location.href, app: S.app });
  const prev = new Map(S.mods.map(m => [m.id, m]));
  S.mods = list;
  for (const m of list) {
    const was = prev.get(m.id);
    if (m.enabled && (!was || !was.enabled || was.updated !== m.updated)) await applyMod(m);
    if (!m.enabled && was?.enabled) await removeMod(m.id);
  }
  for (const id of prev.keys()) if (!list.find(m => m.id === id)) await removeMod(id);
  if (!panel.hidden) renderPanel();
}
