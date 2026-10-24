function setCss(id, css) {
  let s = document.head.querySelector(`style[data-morse-css="${cssEsc(id)}"]`);
  if (!css) { s?.remove(); return; }
  if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
  if (s.textContent !== css) s.textContent = css;
}
async function applyMod(m) {
  setCss(m.id, m.css);
  if (m.js.trim()) {
    const r = await call("exec", { modId: m.id, js: m.js });
    if (!r.ok) { console.warn("[morse]", m.title, r.error); toast(`Couldn't run “${m.title}” here. Turn it off or edit its code in Mods.`); }
  }
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
