async function openPanel() {
  closeBar();
  applyTheme();
  panel.hidden = false;
  await syncMods().catch(() => {});
  renderPanel();
}
function renderPanel() {
  const where = S.appName || location.host || "this page";
  panel.innerHTML = `
    <header><span class="mark">${radar(16)}</span><div><b>Mods</b><small>${esc(where)}</small></div><button data-a="close" title="Close">×</button></header>
    <div class="list">${S.mods.length ? S.mods.map(m => `
      <article data-id="${esc(m.id)}" class="${m.enabled ? "" : "off"}">
        <label class="sw"><input type="checkbox" data-a="toggle" ${m.enabled ? "checked" : ""} aria-label="${esc(m.title)}"><span></span></label>
        <div class="meta"><b>${esc(m.title)}</b><small>“${esc(m.prompt)}”</small>
          <div class="tags">${m.css.trim() ? "<span>style</span>" : ""}${m.js.trim() ? "<span>script</span>" : ""}${m.target ? `<span>${esc(m.target.label || "")}</span>` : "<span>whole page</span>"}</div>
        </div>
        <div class="btns"><button data-a="share" title="Share">Share</button><button data-a="code" title="Edit code">Edit code</button><button data-a="del" title="Delete">Delete</button></div>
      </article>`).join("") : `<p class="empty">${radar(22)}<br>No mods here yet.<br>Press <kbd>${HOTKEY}</kbd>, point at something and describe what you want.</p>`}
    </div>
    <footer><button data-a="import">Install a mod…</button><span>${esc(S.label)}</span></footer>`;
}
panel.addEventListener("click", async e => {
  const btn = e.target.closest("[data-a]");
  if (!btn) return;
  const a = btn.dataset.a;
  const m = S.mods.find(x => x.id === btn.closest("article")?.dataset.id);
  if (a === "close") panel.hidden = true;
  if (a === "toggle" && m) {
    m.enabled = btn.checked;
    await call("mods.save", { mod: m });
    m.enabled ? await applyMod(m) : await removeMod(m.id);
    renderPanel();
  }
  if (a === "del" && m) {
    await removeMod(m.id);
    await call("mods.delete", { modId: m.id });
    S.mods = S.mods.filter(x => x !== m);
    renderPanel();
  }
  if (a === "code" && m) showCode(m);
  if (a === "share" && m) showShare(m);
  if (a === "import") showImport();
});
