function setCss(id, css) {
  let s = document.head.querySelector(`style[data-morse-css="${cssEsc(id)}"]`);
  if (!css) { s?.remove(); return; }
  if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
  if (s.textContent !== css) s.textContent = css;
}
async function applyMod(m) {
  if (modHeld(m)) return; // user control: off switch, pause, safe start (63-control.js)
  setCss(m.id, m.css);
  if (m.js.trim()) {
    const r = await call("exec", { modId: m.id, js: m.js });
    if (!r.ok) toast(`Couldn't run “${m.title}”: ${r.error}. Edit its code in Mods.`);
  }
  modRan(m); // safe start (63-control.js)
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
