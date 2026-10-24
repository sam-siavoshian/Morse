// Mods for this site: mods other people made for the page you're on, from the
// Morse gallery (site/mods/index.json). The host fetches and caches the list
// (core/gallery-host.js); this file only asks it ("gallery.list") and shows:
//
//   - a quiet "2 mods for youtube.com" in the Mods panel (For this site),
//     and as the last suggestion chip in the empty bar
//   - Try it: runs the mod on this page without saving it, with Keep and
//     Remove (applyMod / removeMod, the same path saved mods take)
//   - Install…: the install review (reviewImport, 63-control.js); nothing
//     installs without it
//   - Update available on a panel row when the gallery has a newer version;
//     Update… shows what changed before anything is replaced
//   - Submit to the gallery… in the Share dialog: a prefilled GitHub issue
//
// Hooks: 70-panel.js (gallerySectionHtml, galleryRowHtml), 80-modals.js
// (galleryShareHtml), 56-settings.js (Show mods others made), 10-dom.js (CSS).
// Pure logic (versions, matching, diffs, the issue link) is core/gallery.js.

const Gallery = (() => {
  const st = { key: "", items: [], site: "", loading: null, expanded: false, trial: null };
  const pageKey = () => `${location.host}|${S.app || ""}`;
  const where = () => S.appName || st.site || location.host || "this site";
  const countText = n => `${n} mod${n === 1 ? "" : "s"} for ${where()}`;

  // What a mod does, in a few words: core/summary.js (the same lines as the
  // install review), the ones that say most first; core/gallery.js
  // briefSummary for a runtime without it.
  const FIRST = ["network", "typing", "buttons", "adds", "hides", "text", "clicks", "acts", "storage", "cookies", "clipboard", "navigates", "loads", "device", "notify", "ongoing", "looks", "dynamic"];
  function summarize(mod) {
    if (typeof summarizeMod === "function") {
      try {
        const rank = i => (FIRST.includes(i.id) ? FIRST.indexOf(i.id) : FIRST.length);
        const items = summarizeMod(mod).items, buttons = items.some(i => i.id === "buttons");
        return items.filter(i => i.id !== "code" && !(buttons && i.id === "adds")).sort((a, b) => rank(a) - rank(b)).map(i => i.text);
      } catch {}
    }
    return briefSummary(mod);
  }
  function careful(mod) {
    if (typeof summarizeMod === "function") { try { return summarizeMod(mod).notes.length > 0; } catch {} }
    return needsCarefulLook(mod);
  }

  // ---- the list for this page, from the host
  function load({ again = false } = {}) {
    if (!PREFS.gallery) { st.items = []; st.key = ""; return Promise.resolve(); }
    const key = pageKey();
    if (!again && st.key === key && st.loading) return st.loading;
    st.key = key;
    st.loading = call("gallery.list", { url: location.href, app: S.app })
      .then(r => {
        if (st.key !== key) return;
        st.items = Array.isArray(r?.items) ? r.items.filter(e => e && typeof e.id === "string" && e.mod && typeof e.mod.css === "string") : [];
        st.site = typeof r?.site === "string" ? r.site : "";
      }, () => { if (st.key === key) st.items = []; }) // an older host, or offline with nothing cached
      .then(changed);
    return st.loading;
  }
  const installedOf = e => S.mods.find(m => galleryIdOf(m) === e.id);
  const fresh = () => (PREFS.gallery ? st.items.filter(e => !installedOf(e)) : []);
  const byId = id => st.items.find(e => e.id === id);
  const installable = e => ({ ...asReviewed(e.mod), ...(e.mod.author || !e.author ? {} : { author: e.author }), enabled: true, imported: true, gallery: { id: e.id, version: e.mod.version ?? e.version } });

  // ---- the Mods panel (70-panel.js hooks)
  function sectionHtml() {
    if (!PREFS.gallery || PanelUI.q) return "";
    const list = fresh();
    if (!list.length) return "";
    const open = st.expanded;
    return `<section class="gl-site${open ? " open" : ""}" aria-label="For this site">
      <h4>For this site</h4>
      <button type="button" class="gl-head" data-gl="expand" aria-expanded="${open}">
        <span class="gl-mark" aria-hidden="true">${radar(14)}</span>
        <span class="gl-count"><b>${esc(countText(list.length))}</b><small>Made by other people</small></span>
        <span class="gl-show">${open ? "Hide" : "Show"}</span>
      </button>
      ${open ? `<div class="gl-items">${list.map(itemHtml).join("")}</div>
      <p class="gl-foot"><span>From the Morse gallery</span><button type="button" class="gl-link" data-gl="off">Stop showing these</button></p>` : ""}
    </section>`;
  }
  function itemHtml(e) {
    const m = e.mod, trying = st.trial?.id === e.id;
    const sum = summarize(m).slice(0, 3);
    const v = e.mod.version ?? e.version;
    return `<div class="gl-item${trying ? " trying" : ""}" data-glid="${esc(e.id)}">
      <b>${esc(m.title || e.title)}</b>
      <small class="gl-req">“${esc(m.prompt || e.prompt)}”</small>
      ${sum.length ? `<p class="gl-sum">${sum.map(esc).join(" · ")}</p>` : ""}
      <small class="gl-by">${e.author ? `by ${esc(e.author)}` : "From the gallery"}${compareVersions(v, 1) > 0 ? ` · version ${esc(String(v))}` : ""}</small>
      ${trying ? `<p class="gl-trying" role="status">On this page now. Nothing is saved yet.</p>` : ""}
      <div class="gl-btns">${trying
        ? `<button type="button" class="primary" data-gl="keep">Save</button><button type="button" data-gl="remove">Undo</button>`
        : `${careful(m) ? "" : `<button type="button" data-gl="try">Try it</button>`}<button type="button" data-gl="install">Install…</button>`}</div>
    </div>`;
  }
  function rowHtml(m) {
    if (!PREFS.gallery) return "";
    const e = updateFor(m, st.items);
    if (!e) return "";
    const v = e.mod.version ?? e.version;
    return `<div class="gl-upd" role="status"><p><b>Update available.</b> Version ${esc(String(v))}${e.changes ? `: ${esc(e.changes)}` : ""}</p><button type="button" data-gl="update" data-id="${esc(m.id)}">Update…</button></div>`;
  }

  // Re-render the panel without losing the focused gallery button.
  function rerender(focus = null) {
    if (panel.hidden) return;
    const a = root.activeElement;
    const mine = focus || (a && panel.contains(a) && a.closest(".gl-site") && a.dataset.gl
      ? { g: a.dataset.gl, gid: a.closest("[data-glid]")?.dataset.glid || "" } : null);
    renderPanel();
    if (!mine) return;
    const scope = mine.gid ? panel.querySelector(`[data-glid="${cssEsc(mine.gid)}"]`) : panel.querySelector(".gl-site");
    const b = scope?.querySelector(`[data-gl="${mine.g}"]`) || scope?.querySelector("[data-gl]") || panel.querySelector(".gl-head");
    b?.focus({ preventScroll: true });
  }
  function changed() { rerender(); placeChip(); }

  // ---- Try it, then Save or Undo
  // Try it shows the install review first (what it does, where it runs, the
  // code), with Try it in place of Install: nothing runs before that click.
  // A mod that can send data elsewhere or read what you type goes to Install…
  // instead, never onto the page on a trial.
  function tryIt(e) {
    if (careful(e.mod)) return install(e);
    if (typeof reviewImport !== "function") return install(e);
    return reviewImport(JSON.stringify(installable(e)), { trial: { run: () => startTrial(e) } });
  }
  async function startTrial(e) {
    if (st.trial) await endTrial({ quiet: true });
    st.trial = { id: e.id, title: e.mod.title || e.title };
    st.expanded = true;
    showStrip();
    rerender({ g: "keep", gid: e.id });
    try { await applyMod({ ...e.mod, enabled: true }); }
    catch (err) { toast(`Couldn't try “${st.trial?.title}”. ${plainError(err)}`); }
  }
  async function endTrial({ quiet = false } = {}) {
    const t = st.trial;
    if (!t) return;
    st.trial = null;
    hideStrip();
    await removeMod(t.id).catch(() => {});
    rerender({ g: "try", gid: t.id });
    placeChip();
    if (!quiet) toast(`Took “${t.title}” off the page. Nothing was saved.`);
  }
  async function keep() {
    const t = st.trial, e = t && byId(t.id);
    if (!e) return endTrial({ quiet: true });
    const now = new Date().toISOString();
    const mod = { ...installable(e), importedFrom: "gallery", importedAt: now, created: now, updated: now };
    // Kept after its review: saved the way Install… saves (the host keeps the
    // gallery's match, which mods.save would refuse to widen to).
    try { await call("control.install", { url: location.href, app: S.app, mods: [mod], kind: "mod" }); }
    catch (err) { return toast(`Couldn't save “${t.title}”. ${plainError(err)}`); }
    st.trial = null;
    hideStrip();
    await syncMods().catch(() => {}); // runs it again as a saved mod (core/kit.js turns the trial off first)
    changed();
    toast(`Saved “${mod.title}”. It will be here next time.`);
  }

  // ---- Install…: the same review every shared mod goes through
  function install(e) {
    const source = JSON.stringify(installable(e));
    if (typeof reviewImport === "function") return reviewImport(source, { onDone: () => {} }); // 63-control.js
    listeners.forEach(fn => fn({ type: "install.request", source })); // a runtime without reviewImport: its install.request review
  }

  // ---- Update…: what changed, then the new version replaces the old one
  // (which stays in History).
  function diffHtml(label, kind, d) {
    if (!d.added && !d.removed) return "";
    const rows = trimDiff(d.lines).map(l => l.op === "…"
      ? `<span class="skip">${esc(l.text)}</span>`
      : `<span class="${l.op === "+" ? "add" : l.op === "-" ? "del" : "ctx"}"><i aria-hidden="true">${l.op === " " ? "" : l.op}</i>${esc(l.text) || " "}</span>`).join("");
    return `<label>${label} <span class="dim">${kind} · ${d.added} added, ${d.removed} removed</span></label><pre class="code gl-diff" tabindex="0">${rows}</pre>`;
  }
  const lines = (n, word) => `${n} line${n === 1 ? "" : "s"} ${word}`;
  function countLine(name, d) {
    if (!d.added && !d.removed) return `${name}: no change`;
    return `${name}: ${[d.added && lines(d.added, "added"), d.removed && lines(d.removed, "removed")].filter(Boolean).join(", ")}`;
  }
  function showUpdate(m) {
    const e = updateFor(m, st.items);
    if (!e) return;
    const next = e.mod, from = installedVersion(m), to = next.version ?? e.version;
    const ch = whatChanged(m, next, summarize);
    const worry = careful(next) && !careful(m);
    openModal(`
      <header><b>Update “${esc(m.title)}”?</b><small>Version ${esc(String(from))} to version ${esc(String(to))}, from the Morse gallery${e.author ? ` · by ${esc(e.author)}` : ""}</small><button data-a="close" aria-label="Close">×</button></header>
      <div class="gl-what">
        <h5>What changed</h5>
        ${e.changes ? `<p class="gl-note">${esc(e.changes)}</p>` : ""}
        ${ch.added.length ? `<p><b>Now also:</b> ${ch.added.map(esc).join(" · ")}</p>` : ""}
        ${ch.removed.length ? `<p><b>No longer:</b> ${ch.removed.map(esc).join(" · ")}</p>` : ""}
        ${worry ? `<p class="gl-warn">The new version can send information to another website or read what you type. Update only if you trust the person who made it.</p>` : ""}
        <p class="dim">${esc(countLine("Style", ch.css))} · ${esc(countLine("Script", ch.js))}</p>
      </div>
      ${diffHtml("Style", "CSS", ch.css)}${diffHtml("Script", "JavaScript", ch.js)}
      <p class="dim gl-hist">Your version stays in History, so you can go back to it.</p>
      <footer><button data-a="close">Not now</button><button class="primary" data-gl="apply" data-settle>Update</button></footer>`, { review: true }); // top layer, 80-modals.js
    modal.querySelector("footer [data-a=close]")?.focus();
    modal.querySelector("[data-gl=apply]").onclick = () => applyUpdate(m, e);
  }
  async function applyUpdate(m, e) {
    const v = e.mod.version ?? e.version;
    const next = {
      ...reviseMod(m, { prompt: `Updated to version ${v} from the gallery`, css: e.mod.css, js: e.mod.js }),
      title: e.mod.title || m.title, version: v, gallery: { id: e.id, version: v },
    };
    let saved;
    try { saved = (await call("mods.save", { mod: next })) || next; }
    catch (err) { return toast(`Couldn't update “${m.title}”. ${plainError(err)}`); }
    modal.hidden = true;
    S.mods = S.mods.map(x => (x.id === m.id ? saved : x));
    await removeMod(m.id).catch(() => {});
    if (saved.enabled) await applyMod(saved);
    if (!panel.hidden) renderPanel();
    toast(`Updated “${saved.title}” to version ${v}. The old one is in History.`);
  }

  // ---- Submit to the gallery… (Share dialog, 80-modals.js hook)
  function shareHtml(m) {
    if (!m || typeof m.id !== "string" || m.gallery || byId(galleryIdOf(m) || "")) return "";
    return `<button data-gl="submit" data-id="${esc(m.id)}">Submit to the gallery…</button>`;
  }
  async function submit(m) {
    const r = submitIssue(m, { site: S.appName || location.host, summary: summarize(m) });
    let file = null;
    if (r.attached) file = await call("share", { mod: forGallery(m), kind: "json" }).catch(() => null);
    try {
      await call("open", { url: r.url });
      toast(r.attached
        ? `Opened GitHub to send your mod to the gallery. It's too long for the link, so it was saved${file?.path ? ` to ${file.path}` : ""}. Attach that file there.`
        : "Opened GitHub with your mod filled in. Read it over, then send it.");
    } catch (err) { toast(`Couldn't open GitHub. ${plainError(err)}`); }
  }
  modal.addEventListener("click", ev => {
    const b = ev.target.closest("[data-gl=submit]");
    if (!b) return;
    const m = S.mods.find(x => x.id === b.dataset.id) || (S.draft?.id === b.dataset.id ? S.draft : null);
    if (m) submit(m);
  });

  // ---- the panel's gallery buttons
  async function turnOff() {
    await endTrial({ quiet: true });
    await savePrefs({ gallery: false });
    toast("Mods others made are hidden. Turn them back on in Settings.");
  }
  panel.addEventListener("click", ev => {
    const b = ev.target.closest("[data-gl]");
    if (!b || !panel.contains(b)) return;
    const g = b.dataset.gl, e = byId(b.closest("[data-glid]")?.dataset.glid || "");
    if (g === "expand") { st.expanded = !st.expanded; rerender({ g: "expand" }); }
    if (g === "try" && e) tryIt(e);
    if (g === "install" && e) install(e);
    if (g === "keep") keep();
    if (g === "remove") endTrial();
    if (g === "off") turnOff();
    if (g === "update") { const m = S.mods.find(x => x.id === b.dataset.id); if (m) showUpdate(m); }
  });

  // ---- while trying: a small strip at the top with Save and Undo, so the
  // choice stays in reach with the panel closed.
  const strip = document.createElement("div");
  strip.className = "gl-trial";
  strip.hidden = true;
  strip.setAttribute("role", "region");
  strip.setAttribute("aria-label", "Trying a mod");
  root.append(strip);
  function showStrip() {
    strip.innerHTML = `<span class="gl-mark" aria-hidden="true">${radar(12)}</span><span class="gl-txt"><b>Trying “${esc(st.trial.title)}”</b><small>Nothing is saved yet</small></span><button type="button" data-gl="remove">Undo</button><button type="button" class="primary" data-gl="keep">Save</button>`;
    strip.hidden = false;
  }
  function hideStrip() { strip.hidden = true; strip.innerHTML = ""; }
  strip.addEventListener("click", ev => {
    const g = ev.target.closest("[data-gl]")?.dataset.gl;
    if (g === "keep") keep();
    if (g === "remove") endTrial();
  });
  for (const t of ["keydown", "keyup", "keypress"]) strip.addEventListener(t, ev => ev.stopPropagation());

  // ---- the chip in the empty bar (after the suggestions, 58-suggest.js)
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "sug gl-sug";
  chip.tabIndex = -1;
  chip.addEventListener("click", ev => { ev.stopPropagation(); openSection(); });
  function placeChip() {
    const n = sugEl.hidden || S.target ? 0 : fresh().length;
    if (!n) { if (chip.isConnected) chip.remove(); return; }
    const text = countText(n);
    if (chip.dataset.text !== text) {
      chip.dataset.text = text;
      chip.innerHTML = `<span class="gl-mark" aria-hidden="true">${radar(12)}</span>${esc(text)}`;
      chip.title = "See mods other people made for this site";
    }
    if (sugEl.lastElementChild !== chip) sugEl.append(chip);
  }
  new MutationObserver(placeChip).observe(sugEl, { attributes: true, attributeFilter: ["hidden"], childList: true });
  async function openSection() {
    st.expanded = true;
    await openPanel();
    const sec = panel.querySelector(".gl-site");
    if (!sec) return;
    sec.scrollIntoView({ block: "start" });
    sec.querySelector("[data-gl=try], [data-gl=install]")?.focus({ preventScroll: true });
  }

  // Ask the host when the bar or the panel opens (never on page load), and
  // again on another site of a single-page app.
  new MutationObserver(() => { if (!bar.hidden || !panel.hidden) load(); })
    .observe(bar, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(() => { if (!panel.hidden) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  let was = PREFS.gallery;
  prefsSubs.add(p => {
    if (p.gallery === was) return;
    was = p.gallery;
    if (!p.gallery) { endTrial({ quiet: true }); st.items = []; st.key = ""; changed(); }
    else if (!bar.hidden || !panel.hidden) load({ again: true });
  });

  return { load, sectionHtml, rowHtml, shareHtml, state: () => st };
})();

function gallerySectionHtml() { return Gallery.sectionHtml(); } // 70-panel.js hook
function galleryRowHtml(m) { return Gallery.rowHtml(m); }        // 70-panel.js hook
function galleryShareHtml(m) { return Gallery.shareHtml(m); }    // 80-modals.js hook
