// Installing a shared mod always goes through this confirmation: the share
// page can only ask. The user sees what the mod is, where it will run and its
// code, and nothing is saved unless they click Install.
onEvent(async msg => {
  if (msg.type !== "install.request") return;
  const reply = r => window.postMessage({ morseInstalled: r }, "*");
  let mod;
  try { mod = await call("mods.preview", { source: msg.source }); }
  catch (e) { return reply({ error: e.message }); }
  const where = mod.match?.app || (mod.match?.hosts || []).join(", ") || "this site";
  const everywhere = (mod.match?.hosts || []).some(h => h === "*");
  openModal(`
    <header><b>Install “${esc(mod.title)}”?</b><small>“${esc(mod.prompt)}”</small><button data-a="close">×</button></header>
    <p class="dim">It will run on <b>${esc(where)}</b>${everywhere ? " — that means every website you visit" : ""}. Read the code below before you install it: it can see what you see on those pages.</p>
    ${mod.css.trim() ? `<label>CSS</label><textarea class="code" readonly spellcheck="false">${esc(mod.css)}</textarea>` : ""}
    ${mod.js.trim() ? `<label>JavaScript</label><textarea class="code" readonly spellcheck="false">${esc(mod.js)}</textarea>` : ""}
    <footer><button data-a="close">Cancel</button><button class="primary" data-a="install">Install</button></footer>`);
  const done = r => { modal.hidden = true; reply(r); };
  modal.querySelector("[data-a=install]").onclick = async () => {
    try {
      const saved = await call("mods.import", { source: msg.source, url: location.href, app: S.app });
      done({ title: saved.title });
      await syncMods();
    } catch (e) { done({ error: e.message }); }
  };
  modal.querySelectorAll("[data-a=close]").forEach(b => b.addEventListener("click", () => reply({ error: "Cancelled" })));
});
