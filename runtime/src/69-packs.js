// Mod packs: several mods shared and installed together (core/pack.js). The
// host reads, fetches and saves (core/pack-host.js, "pack.*" requests); this
// file shows:
//
//   - the pack review: every mod in it, what each does (core/summary.js),
//     where it runs, Show code, notes for mods that can send data, read what
//     you type or run on every website. Untick what you don't want; a mod
//     with the same id as one of yours asks Keep both or Replace yours.
//     Nothing installs before Install.
//   - Make a pack… in the Mods panel: choose mods, name it, add a note, then
//     Copy link or Download pack file
//   - pack mods grouped under the pack's name, with one switch for the pack
//   - packs from an address: "Check this address for updates" is the
//     person's choice in the review; Update available on the pack, and an
//     update review (new, changed with diffs, removed) before anything changes
//
// Hooks (one marked line each): 63-control.js reviewImport (review,
// reviewAddress), 70-panel.js renderPanel and renderList (packPanel,
// packListHtml, packRows), 80-modals.js showImport (the hint), 10-dom.js (CSS).

const Packs = (() => {
  const st = { picking: null, subs: [], loading: null };
  // Words: message ids "pk.*" (core/locales/en.js); "wait.many" is "{n} mods".
  const modsN = n => t("wait.many", { n });
  const isAddress = s => /^https?:\/\/\S+$/i.test(String(s || "").trim()) && !String(s).includes("#m=");
  const packOf = m => (m?.pack && typeof m.pack.id === "string" ? m.pack : null);
  const wide = m => everywhere(m) || broadEndings(m).length > 0;
  const subFor = id => st.subs.find(s => s.id === id) || null;

  // What a mod does, in one line, the lines that say most first; the notes
  // (sends data, reads typing, builds its own code) are shown in full.
  const FIRST = ["network", "typing", "buttons", "adds", "hides", "text", "clicks", "acts", "storage", "cookies", "clipboard", "navigates", "loads", "device", "notify", "ongoing", "looks", "dynamic"];
  function brief(m) {
    const s = summarizeMod(m);
    if (s.empty) return { line: t("sum.empty"), notes: [] };
    const rank = i => (FIRST.includes(i.id) ? FIRST.indexOf(i.id) : FIRST.length);
    const buttons = s.items.some(i => i.id === "buttons");
    const items = s.items.filter(i => i.id !== "code" && !(buttons && i.id === "adds")).sort((a, b) => rank(a) - rank(b));
    return { line: items.map(i => i.text).join(" · "), notes: s.notes };
  }
  const wideNote = m => everywhere(m) ? t("install.everywhere") : t("install.broad", { endings: broadEndings(m).join(t("install.or")) });

  // One mod in a review: a tick, what it does, where, notes, Show code.
  function itemHtml(m, { kind = "add", ticked = true, clash = null, why = "" } = {}) {
    const b = brief(m);
    const hostHere = controlKey(here());
    const other = !m.match?.app && !(modHosts(m) || []).some(h => h === "*" || h === hostHere || (h.startsWith("*.") && hostHere.endsWith(h.slice(1))));
    return `<section class="pk-item" data-kind="${kind}" data-pkid="${esc(m.id)}">
      <label class="pk-pick"><input type="checkbox" data-pk="pick" ${ticked ? "checked" : ""}><span><b>${esc(m.title)}</b>
        <small class="ctl-from">${esc(t("ctl.for", { where: whereFor(m) }))}${m.author ? esc(t("ctl.madeBy", { author: m.author })) : ""}${other ? ` · <span>${t("ctl.notThisPage")}</span>` : ""}</small></span></label>
      <div class="pk-body">
        <p class="ctl-prompt">“${esc(m.prompt)}”</p>
        <p class="pk-does" data-s="does">${esc(b.line)}</p>
        ${wide(m) ? `<p class="ctl-warn" data-s="everywhere"><b>${t("ctl.note")}</b>${esc(wideNote(m))}${why ? ` ${esc(why)}` : ""}</p>` : ""}
        ${b.notes.map(n => `<p class="ctl-warn" data-s="${n.id}"><b>${t("ctl.note")}</b>${esc(n.text)}</p>`).join("")}
        ${clash?.kind === "update" ? `<p class="pk-clash" data-s="update">${t("pk.replaces")}</p>` : ""}
        ${clash?.kind === "clash" ? `<div class="pk-clash" data-s="clash"><p>${esc(t("pk.clash", { title: clash.title }))}</p>
          <div class="seg" role="radiogroup" aria-label="${esc(t("pk.clashWhat", { title: clash.title }))}"><button type="button" role="radio" aria-checked="true" data-pk-as="copy">${t("pk.keepBoth")}</button><button type="button" role="radio" aria-checked="false" data-pk-as="replace">${t("pk.replace")}</button></div></div>` : ""}
        <details class="ctl-code"><summary>${t("ctl.showCode")}</summary>${codeHtml(m)}</details>
      </div>
    </section>`;
  }
  // Ticks, and Keep both / Replace yours, inside an open review.
  function wireItems(onChange) {
    modal.querySelectorAll(".pk-item [data-pk=pick]").forEach(i => i.addEventListener("change", () => { i.closest(".pk-item").classList.toggle("off", !i.checked); onChange(); }));
    modal.querySelectorAll(".pk-item [data-pk=pick]").forEach(i => i.closest(".pk-item").classList.toggle("off", !i.checked));
    modal.querySelectorAll(".pk-clash .seg").forEach(seg => seg.addEventListener("click", e => {
      const b = e.target.closest("[data-pk-as]");
      if (!b) return;
      seg.querySelectorAll("[data-pk-as]").forEach(x => x.setAttribute("aria-checked", String(x === b)));
    }));
  }
  const picked = kind => [...modal.querySelectorAll(`.pk-item[data-kind="${kind}"]`)].filter(s => s.querySelector("[data-pk=pick]")?.checked);

  // ---- the install review (reviewImport hands packs here)
  // r: the host's preview { pack, hash, clash, errors, url?, source?, subscribed? }
  function review(r, { source, onDone = () => {} } = {}) {
    const pack = r.pack, mods = pack.mods;
    let finished = false;
    const done = x => { if (!finished) { finished = true; onDone(x); } };
    applyTheme();
    openModal(`
      <header><b>${esc(t("pk.title", { name: pack.name }))}</b>
        <small>${esc(t("pk.sub", { n: mods.length, by: pack.author ? t("pk.by", { author: pack.author }) : "" }))}</small>
        <button data-a="close" aria-label="${esc(t("btn.close"))}">×</button></header>
      ${pack.note ? `<p class="pk-note">“${esc(pack.note)}”</p>` : ""}
      <div class="pk-items">${mods.map(m => itemHtml(m, { ticked: !wide(m), clash: r.clash?.[m.id], why: t("pk.whyUnticked") })).join("")}</div>
      ${r.errors?.length ? `<p class="dim ctl-skip">${esc(t("ctl.skipped", { list: r.errors.join("; ") }))}</p>` : ""}
      ${r.url ? (r.subscribed
        ? `<p class="pk-subbed">${t("pk.subbed")}</p>`
        : `<label class="pk-sub"><input type="checkbox" data-pk="sub"><span><b>${t("pk.subCheck")}</b><small>${t("pk.subCheck.help")}</small></span></label>`) : ""}
      <footer><button data-a="close">${t("btn.cancel")}</button><button class="primary" data-pk="install" data-settle>${t("pk.install")}</button></footer>`, { review: true }); // top layer, 80-modals.js
    modal.querySelector(".card").classList.add("ctl-card", "pk-card");
    const go = modal.querySelector("[data-pk=install]");
    // Install turns on once the review has been seen (80-modals.js settleReview), and only with something ticked.
    const count = () => {
      const n = picked("add").length;
      go.textContent = n ? t("pk.installN", { n }) : t("pk.install");
      if (n) { go.dataset.settle = ""; settleReview(); } else { go.dataset.settle = "busy"; go.disabled = true; }
    };
    wireItems(count);
    count();
    modal.querySelector("footer [data-a=close]")?.focus(); // Cancel, never Install: a page could make someone press Enter
    const watch = new MutationObserver(() => { if (modal.hidden) { watch.disconnect(); done({ error: t("ctl.cancelled") }); } });
    watch.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    go.onclick = async () => {
      const picks = picked("add").map(s => ({ id: s.dataset.pkid, as: s.querySelector("[data-pk-as][aria-checked=true]")?.dataset.pkAs || "copy" }));
      if (!picks.length) return;
      go.disabled = true;
      go.dataset.settle = "busy"; // a review brought back on top doesn't turn it on again mid-install
      try {
        const res = await call("pack.install", { source: r.source ?? source, hash: r.hash, picks, url: r.url || "", subscribe: !!modal.querySelector("[data-pk=sub]")?.checked });
        watch.disconnect();
        modal.hidden = true;
        const n = res.saved.length;
        toast(`${t("pk.installed", { n, name: pack.name })}${res.subscribed ? ` ${t("pk.checksDaily")}` : ""}`);
        done({ title: pack.name, count: n, pack: true });
        await syncMods();
        load({ again: true });
      } catch (err) { go.dataset.settle = ""; settleReview(); toast(plainError(err)); }
    };
  }

  // An address (a team's pack file): the host fetches it, then the same review.
  async function reviewAddress(url, { onDone = () => {} } = {}) {
    let r;
    try { r = await call("pack.fetch", { url: url.trim() }); }
    catch (e) { const msg = plainError(e); toast(msg); return onDone({ error: msg }); }
    return review(r, { onDone });
  }

  // ---- the Mods panel: Make a pack… (70-panel.js renderPanel hook)
  function panelHtml() {
    if (!S.mods.some(m => m.kind !== "style")) return;
    const back = panel.querySelector(".ctl-backup");
    if (st.picking) return; // the strip at the top of the list has Cancel and Next
    const html = `<div class="ctl-backup pk-bar"><span class="eyebrow">${t("pk.eyebrow")}</span><button data-pk="make" title="${esc(t("pk.make.title"))}">${t("pk.make")}</button></div>`;
    if (back) back.insertAdjacentHTML("beforebegin", html);
    else panel.querySelector("footer")?.insertAdjacentHTML("beforebegin", html);
  }

  // The list, with each pack's mods under its name (70-panel.js renderList hook).
  function listHtml(shown) {
    const own = [], groups = new Map();
    for (const m of shown) {
      const p = packOf(m);
      if (!p) { own.push(m); continue; }
      if (!groups.has(p.id)) groups.set(p.id, []);
      groups.get(p.id).push(m);
    }
    return own.map(rowHtml).join("") + [...groups].map(([id, list]) => groupHtml(id, list)).join("");
  }
  function groupHtml(id, list) {
    const name = packOf(list[0]).name || id;
    const on = list.some(m => m.enabled);
    const sub = subFor(id), u = sub?.update;
    const parts = u ? updateParts(u) : [];
    const held = on && list.filter(m => m.enabled).every(m => modHeld(m));
    return `<section class="pk-group${on ? "" : " off"}" data-pack="${esc(id)}" aria-label="${esc(t("pk.groupAria", { name }))}">
      <div class="pk-head">
        <label class="sw" title="${esc(on ? t("pk.offAll") : t("pk.onAll"))}"><input type="checkbox" data-pk="toggle" aria-label="${esc(t("pk.toggleAria", { name }))}" ${on ? "checked" : ""}><span></span></label>
        <div class="pk-meta"><b>${esc(name)}</b><small>${esc(t("pk.meta", { n: list.length }))}${sub ? ` · ${t("pk.getsUpdates")}` : ""}${held ? ` · ${t("ctl.notRunning")}` : ""}</small></div>
        <div class="pk-btns"><button data-pk="share" title="${esc(t("pk.share.title"))}">${t("btn.copyLink")}</button>${sub ? `<button data-pk="unsub" title="${esc(t("pk.unsub.title"))}">${t("pk.unsub")}</button>` : ""}</div>
      </div>
      ${parts.length ? `<div class="gl-upd pk-upd" role="status"><p><b>${t("gl.updateAvailable")}</b> ${esc(parts.join(", "))}</p><button data-pk="update">${t("pk.review")}</button></div>` : ""}
      ${list.map(rowHtml).join("")}
    </section>`;
  }

  // After the list is drawn: while making a pack, a tick on every row and the
  // strip with Next (70-panel.js renderList hook).
  function decorate() {
    const list = panel.querySelector(".list");
    if (!list) return;
    list.classList.toggle("pk-picking", !!st.picking);
    if (!st.picking) return;
    for (const a of list.querySelectorAll("article[data-id]")) {
      const m = S.mods.find(x => x.id === a.dataset.id);
      if (!m) continue;
      a.insertAdjacentHTML("afterbegin", `<label class="pk-sel" title="${esc(t("pk.sel.title"))}"><input type="checkbox" data-pk="sel" aria-label="${esc(t("pk.selAria", { title: m.title }))}" ${st.picking.has(m.id) ? "checked" : ""}></label>`);
    }
    list.insertAdjacentHTML("afterbegin", `<div class="pk-pickbar" role="region" aria-label="${esc(t("pk.makeTitle"))}">
      <span><b>${t("pk.choose")}</b><small class="pk-n">${pickedText()}</small></span>
      <button data-pk="cancel">${t("btn.cancel")}</button><button class="primary" data-pk="next" ${st.picking.size ? "" : "disabled"}>${t("import.next")}</button></div>`);
  }
  const pickedText = () => (st.picking.size ? t("pk.chosen", { n: st.picking.size }) : t("pk.noneChosen"));
  function startPicking() {
    st.picking = new Set();
    renderPanel();
    panel.querySelector(".list")?.scrollTo({ top: 0 });
    panel.querySelector(".list [data-pk=sel]")?.focus({ preventScroll: true });
  }
  function stopPicking() { st.picking = null; if (!panel.hidden) renderPanel(); }

  // ---- Make a pack: name, note, then a link or a file
  function showMake(ids) {
    const mods = S.mods.filter(m => ids.includes(m.id)); // in the order the panel lists them
    if (!mods.length) return;
    openModal(`
      <header><b>${t("pk.makeTitle")}</b><small>${t("pk.makeSub")}</small><button data-a="close" aria-label="${esc(t("btn.close"))}">×</button></header>
      <label for="pk-name">${t("pk.name")}</label>
      <div class="field pk-field"><input id="pk-name" data-pk="name" maxlength="80" placeholder="${esc(t("pk.name.placeholder"))}" autocomplete="off" spellcheck="false"></div>
      <label for="pk-note">${t("pk.note")} <span class="dim">${t("pk.optional")}</span></label>
      <textarea class="pk-note-in" id="pk-note" data-pk="note" maxlength="500" rows="3" placeholder="${esc(t("pk.note.placeholder"))}"></textarea>
      <label>${t("pk.inPack")} <span class="dim">${esc(modsN(mods.length))}</span></label>
      <ul class="pk-list">${mods.map(m => `<li><b>${esc(m.title)}</b><small>${esc(t("pk.forWhere", { where: whereFor(m) }))}</small></li>`).join("")}</ul>
      <div class="link pk-link" hidden><input readonly aria-label="${esc(t("share.linkLabel"))}"><button data-pk="again">${t("pk.copyAgain")}</button></div>
      <p class="pk-err" role="alert"></p>
      <footer><button data-a="close">${t("btn.cancel")}</button><button data-pk="file">${t("pk.file")}</button><button class="primary" data-pk="link">${t("btn.copyLink")}</button></footer>`);
    modal.querySelector(".card").classList.add("pk-card");
    const name = modal.querySelector("[data-pk=name]"), note = modal.querySelector("[data-pk=note]");
    const err = modal.querySelector(".pk-err");
    name.focus();
    const ask = async kind => {
      err.textContent = "";
      if (!name.value.trim()) { err.textContent = t("pk.needName"); name.focus(); return null; }
      try { return await call("pack.share", { ids: mods.map(m => m.id), name: name.value, note: note.value, kind }); }
      catch (e) { err.textContent = plainError(e); return null; }
    };
    modal.querySelector("[data-pk=link]").onclick = async e => {
      const btn = e.currentTarget;
      const r = await ask("link");
      if (!r?.link) return;
      const box = modal.querySelector(".pk-link");
      box.hidden = false;
      box.querySelector("input").value = r.link;
      try { await copyText(r.link); btn.textContent = t("btn.copied"); } catch { box.querySelector("input").select(); }
      modal.querySelector("footer [data-a=close]").textContent = t("btn.done");
      st.picking = null;
      toast(t("pk.linkCopied", { name: name.value.trim() }));
    };
    modal.querySelector("[data-pk=again]").onclick = async () => { const v = modal.querySelector(".pk-link input").value; try { await copyText(v); toast(t("share.linkCopied")); } catch {} };
    modal.querySelector("[data-pk=file]").onclick = async () => {
      const r = await ask("file");
      if (!r) return;
      st.picking = null;
      modal.querySelector("footer [data-a=close]").textContent = t("btn.done");
      err.textContent = r.path ? t("share.savedTo", { path: r.path }) : t("share.downloaded");
      err.classList.add("ok");
    };
    name.addEventListener("keydown", e => { if (e.isTrusted && e.key === "Enter" && !e.isComposing) { e.preventDefault(); modal.querySelector("[data-pk=link]").click(); } });
    // Back to the panel as it was, minus the ticks, once the pack is made or the dialog closes.
    const watch = new MutationObserver(() => { if (modal.hidden) { watch.disconnect(); if (!panel.hidden) renderPanel(); } });
    watch.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }

  // ---- packs that update: the host checks them (at most once a day) when the panel opens
  function load({ again = false } = {}) {
    if (st.loading && !again) return st.loading;
    st.loading = call("pack.status", {}).then(r => {
      const before = JSON.stringify(st.subs.map(s => [s.id, s.hash, !!s.update]));
      st.subs = Array.isArray(r) ? r.filter(s => s && typeof s.id === "string") : [];
      if (JSON.stringify(st.subs.map(s => [s.id, s.hash, !!s.update])) !== before && !panel.hidden && !st.picking) renderPanel();
    }, () => {}).finally(() => { st.loading = null; }); // one at a time; the host answers from its cache within the day
    return st.loading;
  }

  // ---- the update review: what's new, what changed (with diffs), what's gone
  const countLine = (name, d) => (!d.added && !d.removed ? t("gl.noChange", { name }) : `${name}: ${[d.added && t("gl.linesAdded", { n: d.added }), d.removed && t("gl.linesRemoved", { n: d.removed })].filter(Boolean).join(", ")}`);
  function diffHtml(label, kind, d) {
    if (!d.added && !d.removed) return "";
    const rows = trimDiff(d.lines).map(l => l.op === "…"
      ? `<span class="skip">${esc(l.text)}</span>`
      : `<span class="${l.op === "+" ? "add" : l.op === "-" ? "del" : "ctx"}"><i aria-hidden="true">${l.op === " " ? "" : l.op}</i>${esc(shownCode(l.text)) || " "}</span>`).join("");
    return `<label>${label} <span class="dim">${kind} · ${t("gl.diff", { added: d.added, removed: d.removed })}</span></label><pre class="code gl-diff" tabindex="0">${rows}</pre>`;
  }
  const words = m => { const s = summarizeMod(m); return s.items.filter(i => i.id !== "code").map(i => i.text); };
  function changedHtml(c) {
    const ch = whatChanged(c.before, c.after, words);
    return `<section class="pk-item" data-kind="change" data-pkid="${esc(c.after.id)}">
      <label class="pk-pick"><input type="checkbox" data-pk="pick" checked><span><b>${esc(c.after.title)}</b><small class="ctl-from">${esc(t("ctl.for", { where: whereFor(c.after) }))}</small></span></label>
      <div class="pk-body">
        ${c.after.title !== c.before.title ? `<p class="pk-does">${esc(t("pk.wasCalled", { title: c.before.title }))}</p>` : ""}
        ${ch.added.length ? `<p class="pk-does"><b>${t("gl.nowAlso")}</b> ${ch.added.map(esc).join(" · ")}</p>` : ""}
        ${ch.removed.length ? `<p class="pk-does"><b>${t("gl.noLonger")}</b> ${ch.removed.map(esc).join(" · ")}</p>` : ""}
        ${c.wider?.length ? `<p class="ctl-warn" data-s="wider"><b>${t("ctl.note")}</b>${esc(t("pk.wider", { where: c.wider.includes("*") ? t("pk.everyWebsite") : c.wider.join(", ") }))}</p>` : c.match ? `<p class="pk-does">${esc(t("pk.runsNow", { now: whereFor(c.after), before: whereFor(c.before) }))}</p>` : ""}
        ${summarizeMod(c.after).notes.filter(n => !summarizeMod(c.before).notes.some(o => o.id === n.id)).map(n => `<p class="ctl-warn" data-s="${n.id}"><b>${t("ctl.note")}</b>${esc(n.text)}</p>`).join("")}
        <p class="dim pk-count">${esc(countLine(t("code.style"), ch.css))} · ${esc(countLine(t("code.script"), ch.js))}</p>
        <details class="ctl-code" ${ch.css.added + ch.css.removed + ch.js.added + ch.js.removed <= 40 ? "open" : ""}><summary>${t("pk.showChanges")}</summary>${diffHtml(t("code.style"), "CSS", ch.css)}${diffHtml(t("code.script"), "JavaScript", ch.js)}</details>
      </div>
    </section>`;
  }
  function removedHtml(m) {
    return `<section class="pk-item" data-kind="remove" data-pkid="${esc(m.id)}">
      <label class="pk-pick"><input type="checkbox" data-pk="pick" checked><span><b>${esc(m.title)}</b><small class="ctl-from">${esc(t("ctl.for", { where: whereFor(m) }))}</small></span></label>
      <div class="pk-body"><p class="pk-does">${t("pk.removedNote")}</p></div>
    </section>`;
  }
  // New since you last looked, not the mods you left out then.
  const freshOf = u => (Array.isArray(u.fresh) ? u.added.filter(m => u.fresh.includes(m.id)) : u.added);
  const updateParts = u => [u.changed.length && t("pk.changedN", { n: u.changed.length }), freshOf(u).length && t("pk.newN", { n: freshOf(u).length }), u.removed.length && t("pk.removedN", { n: u.removed.length })].filter(Boolean);
  function showUpdate(id) {
    const sub = subFor(id), u = sub?.update;
    if (!u) return;
    let site = sub.url;
    try { site = new URL(sub.url).host; } catch {}
    const fresh = freshOf(u), before = u.added.filter(m => !fresh.includes(m));
    const parts = updateParts(u);
    openModal(`
      <header><b>${esc(t("pk.updateTitle", { name: sub.name }))}</b><small>${esc(t("pk.updateSub", { site, checked: sub.checked ? t("pk.checked", { when: relativeTime(new Date(sub.checked).toISOString()) }) : "" }))}</small><button data-a="close" aria-label="${esc(t("btn.close"))}">×</button></header>
      <div class="gl-what"><h5 class="eyebrow">${t("gl.whatChanged")}</h5><p>${esc(parts.join(" · "))}</p>${u.note ? `<p class="gl-note">“${esc(u.note)}”</p>` : ""}</div>
      ${u.changed.length ? `<h4 class="ctl-h eyebrow">${t("pk.changed")}</h4><div class="pk-items">${u.changed.map(changedHtml).join("")}</div>` : ""}
      ${fresh.length ? `<h4 class="ctl-h eyebrow">${t("pk.newIn")}</h4><div class="pk-items">${fresh.map(m => itemHtml(m, { ticked: !wide(m), why: t("pk.whyUnticked") })).join("")}</div>` : ""}
      ${u.removed.length ? `<h4 class="ctl-h eyebrow">${t("pk.gone")}</h4><div class="pk-items">${u.removed.map(removedHtml).join("")}</div>` : ""}
      ${before.length ? `<details class="pk-before"><summary>${esc(t("pk.leftOut", { n: before.length }))}</summary><div class="pk-items">${before.map(m => itemHtml(m, { ticked: false })).join("")}</div></details>` : ""}
      <p class="dim gl-hist">${t("pk.history")}</p>
      <footer><button data-a="close">${t("gl.notNow")}</button><button class="primary" data-pk="apply" data-settle>${t("gl.updateBtn")}</button></footer>`, { review: true }); // top layer, 80-modals.js
    modal.querySelector(".card").classList.add("ctl-card", "pk-card");
    wireItems(() => {});
    modal.querySelector("footer [data-a=close]")?.focus();
    modal.querySelector("[data-pk=apply]").onclick = async e => {
      const ids = kind => picked(kind).map(s => s.dataset.pkid);
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.dataset.settle = "busy";
      try {
        const r = await call("pack.update", { url: sub.url, hash: sub.hash, picks: { add: ids("add"), change: ids("change"), remove: ids("remove") } });
        modal.hidden = true;
        toast(t("pk.updated", { name: r.name || sub.name }));
        sub.update = null;
        await syncMods();
        await load({ again: true });
      } catch (err) { btn.dataset.settle = ""; settleReview(); toast(plainError(err)); }
    };
  }

  // ---- the panel's pack buttons
  async function setPack(id, on) {
    const g = S.mods.find(m => packOf(m)?.id === id);
    const name = packOf(g)?.name || t("pk.thePack");
    try { await call("pack.enable", { pack: id, on }); } // "pack", not "id": a request's id is its own
    catch (e) { return toast(plainError(e)); }
    await syncMods();
    panel.querySelector(`.pk-group[data-pack="${cssEsc(id)}"] [data-pk=toggle]`)?.focus({ preventScroll: true });
    toast(on ? t("pk.turnedOn", { name }) : t("pk.turnedOff", { name }));
  }
  async function copyPackLink(id, btn) {
    try {
      const r = await call("pack.share", { pack: id, kind: "link" });
      await copyText(r.link);
      btn.textContent = t("btn.copied");
      setTimeout(() => { if (btn.isConnected) btn.textContent = t("btn.copyLink"); }, 1600);
      toast(t("pk.linkCopiedAll", { n: r.count }));
    } catch (e) { toast(plainError(e)); }
  }
  async function stopUpdates(id) {
    const sub = subFor(id);
    if (!sub) return;
    try { await call("pack.unsubscribe", { url: sub.url }); } catch (e) { return toast(plainError(e)); }
    st.subs = st.subs.filter(s => s !== sub);
    renderPanel();
    toast(t("pk.stopped", { name: sub.name }));
  }
  panel.addEventListener("click", ev => {
    const b = ev.target.closest("button[data-pk]");
    if (!b || !panel.contains(b)) return;
    const id = b.closest("[data-pack]")?.dataset.pack || "";
    const k = b.dataset.pk;
    if (k === "make") startPicking();
    if (k === "cancel") stopPicking();
    if (k === "next" && st.picking?.size) showMake([...st.picking]);
    if (k === "share" && id) copyPackLink(id, b);
    if (k === "unsub" && id) stopUpdates(id);
    if (k === "update" && id) showUpdate(id);
  });
  panel.addEventListener("change", ev => {
    const el = ev.target;
    if (el.dataset?.pk === "toggle") { const id = el.closest("[data-pack]")?.dataset.pack; if (id) setPack(id, el.checked); }
    if (el.dataset?.pk === "sel" && st.picking) {
      const id = el.closest("article")?.dataset.id;
      if (id) el.checked ? st.picking.add(id) : st.picking.delete(id);
      const n = panel.querySelector(".pk-pickbar .pk-n"), next = panel.querySelector(".pk-pickbar [data-pk=next]");
      if (n) n.textContent = pickedText();
      if (next) next.disabled = !st.picking.size;
    }
  });
  // While choosing, Space on a row ticks it instead of turning the mod off.
  panel.addEventListener("keydown", e => {
    if (!e.isTrusted || !st.picking || e.key !== " " || e.target.tagName !== "ARTICLE") return;
    e.preventDefault();
    e.stopPropagation();
    e.target.querySelector("[data-pk=sel]")?.click();
  }, true);
  // Ask the host when the panel opens (never on page load); stop choosing when it closes.
  new MutationObserver(() => { if (panel.hidden) st.picking = null; else load(); })
    .observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  return { isAddress, review, reviewAddress, panelHtml, listHtml, decorate, load, state: () => st };
})();

function packPanel() { Packs.panelHtml(); }                 // 70-panel.js hook: Make a pack…
function packListHtml(shown) { return Packs.listHtml(shown); } // 70-panel.js hook: pack mods under the pack's name
function packRows() { Packs.decorate(); }                    // 70-panel.js hook: ticks while making a pack
